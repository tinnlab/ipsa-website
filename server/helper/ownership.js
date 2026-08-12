import { Meteor } from "meteor/meteor";
import {
    analysisOwnerSelector,
    collectAnalysisIds,
    isOwnedBy,
    isValidId,
    NOT_AUTHORIZED,
    SESSION_NOT_FOUND,
} from "../../imports/utils/ownership";

// Shared per-study authorization guards.
//
// Every study-scoped read and write funnels through here so the rule lives in exactly one place:
// a caller may touch a study only when Session.userId === the authenticated userId. Extracted with
// an injectable `collections` default and no dependency on `this`, following removeStudy /
// extendStudy in server/startup/cron-job.js — that keeps the control flow unit-testable with fakes
// and, critically, lets server-to-server callers (which have no method invocation and therefore no
// this.userId) pass an explicit requesterUserId or skip the guard deliberately.
//
// Error codes follow the repo-wide convention (queue.js / aiWorkflow.js / cron-job.js):
// 'not-authorized' for a caller who may not touch this study, 'session-not-found' when it is gone.
// As documented at cron-job.js:344-346, distinguishing the two is a benign existence oracle we
// accept: Session._id values are non-enumerable Random.id()s (~101 bits), and a distinct
// not-found surfaces a legitimate owner's stale link instead of a confusing permission error.

// The codes themselves now live in imports/utils/ownership.js so the CLIENT can recognise them
// (it has no other way to tell a denied study from a still-loading one). Re-exported here so
// server-side importers keep taking them from the guard module. The MESSAGES stay server-side: they
// are prose, and no caller should ever branch on them.
export { NOT_AUTHORIZED, SESSION_NOT_FOUND };
export const NOT_LOGGED_IN_MESSAGE = "You must be logged in.";
export const STUDY_NOT_FOUND_MESSAGE = "Study not found";
export const NOT_OWNER_MESSAGE = "You can only access your own studies.";

const requireCollections = (collections) => {
    const resolved = collections || (typeof DBCollections !== "undefined" ? DBCollections : undefined);
    if (!resolved) {
        throw new Meteor.Error("collections-unavailable", "Database collections are unavailable.");
    }
    return resolved;
};

// Non-throwing lookups. Publications use these: a publish function that throws sends a noisy
// error to every subscriber, so an unauthorized subscription should simply publish nothing
// (this.ready()) exactly as the existing massAnalysisQueue publications do.

export const findOwnedSession = async ({ sessionId, requesterUserId, collections } = {}) => {
    const C = requireCollections(collections);
    // isValidId, not a truthiness test: a client can send an object, and {$ne: null} is truthy.
    if (!isValidId(sessionId) || !isValidId(requesterUserId)) return null;
    const session = await C.Session.findOneAsync({ _id: sessionId });
    return isOwnedBy(session, requesterUserId) ? session : null;
};

export const findOwnedSessionForAnalysis = async ({ analysisId, requesterUserId, collections } = {}) => {
    const C = requireCollections(collections);
    if (!isValidId(analysisId) || !isValidId(requesterUserId)) return null;
    const session = await C.Session.findOneAsync(analysisOwnerSelector(analysisId));
    return isOwnedBy(session, requesterUserId) ? session : null;
};

// Resolve an analysisId to its owning study without checking who is asking. Server-to-server
// callers (the mass-analysis worker, consensus) need this; anything reachable from a client must
// use assertOwnsAnalysis instead.
export const resolveSessionForAnalysis = async (analysisId, { collections } = {}) => {
    const C = requireCollections(collections);
    if (!isValidId(analysisId)) return null;
    return C.Session.findOneAsync(analysisOwnerSelector(analysisId));
};

// Throwing guards. Meteor methods and REST handlers use these.

export const assertOwnsSession = async ({ sessionId, requesterUserId, collections } = {}) => {
    const C = requireCollections(collections);
    if (!isValidId(requesterUserId)) throw new Meteor.Error(NOT_AUTHORIZED, NOT_LOGGED_IN_MESSAGE);
    // Type check, not just presence: an object id would reach Mongo as a query operator.
    if (!isValidId(sessionId)) throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    const session = await C.Session.findOneAsync({ _id: sessionId });
    if (!session) throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    if (!isOwnedBy(session, requesterUserId)) throw new Meteor.Error(NOT_AUTHORIZED, NOT_OWNER_MESSAGE);
    return session;
};

// For the many read paths that take BOTH a sessionId and an analysisId: prove the caller owns the
// study, then prove the analysis actually belongs to it. Checking only the session would let a
// caller pair their own sessionId with a foreign analysisId (the per-analysis rows carry no
// userId), and checking only the analysis would leave the sessionId-driven part of the query
// pointed at someone else's study. One Session read covers both.
export const assertOwnsSessionAnalysis = async ({ sessionId, analysisId, requesterUserId, collections } = {}) => {
    const session = await assertOwnsSession({ sessionId, requesterUserId, collections });
    if (!isValidId(analysisId) || !collectAnalysisIds(session).includes(analysisId)) {
        throw new Meteor.Error(NOT_AUTHORIZED, NOT_OWNER_MESSAGE);
    }
    return session;
};

// The ownership guards decide authorization by asking whether an analysisId appears in a session's
// analyses[]/metaAnalyses[]. Those arrays are written by client-facing methods, so an id the caller
// chooses must never be allowed to collide with one that already exists: otherwise a caller can
// push a VICTIM's analysisId into their OWN study and every membership test then says yes.
//
// Enforcing global uniqueness closes that without changing the client's id-minting contract. Cheap
// now that Session is indexed on analyses.id and metaAnalyses.id.
export const assertAnalysisIdIsNew = async ({ analysisId, collections } = {}) => {
    const C = requireCollections(collections);
    if (!isValidId(analysisId)) {
        throw new Meteor.Error("invalid-analysis-id", "An analysis id must be a non-empty string.");
    }
    const existing = await C.Session.findOneAsync(
        analysisOwnerSelector(analysisId),
        { fields: { _id: 1 } }
    );
    if (existing) {
        throw new Meteor.Error("analysis-id-in-use", "That analysis id is already in use.");
    }
};

export const READ_ONLY_MESSAGE = "This study was shared with you as view-only and cannot be changed.";

// True for a study imported in 'results' mode. readOnly is the canonical flag; editable === false
// is also set, which the pre-existing client-side checks in the Session wizard already respect.
export const isReadOnlySession = (session) => Boolean(session && session.readOnly === true);

// Mutation is allowed iff the caller owns the study AND it is not a view-only import. Server-side
// enforcement is the real control: the client hides the corresponding buttons, but a read-only
// study has to reject the write even when the client is bypassed entirely.
export const assertWritableSession = async ({ sessionId, requesterUserId, collections } = {}) => {
    const session = await assertOwnsSession({ sessionId, requesterUserId, collections });
    if (isReadOnlySession(session)) {
        throw new Meteor.Error("read-only-study", READ_ONLY_MESSAGE);
    }
    return session;
};

export const assertWritableAnalysis = async ({ analysisId, requesterUserId, collections } = {}) => {
    const session = await assertOwnsAnalysis({ analysisId, requesterUserId, collections });
    if (isReadOnlySession(session)) {
        throw new Meteor.Error("read-only-study", READ_ONLY_MESSAGE);
    }
    return session;
};

export const assertWritableSessionAnalysis = async ({ sessionId, analysisId, requesterUserId, collections } = {}) => {
    const session = await assertOwnsSessionAnalysis({ sessionId, analysisId, requesterUserId, collections });
    if (isReadOnlySession(session)) {
        throw new Meteor.Error("read-only-study", READ_ONLY_MESSAGE);
    }
    return session;
};

// MassAnalysisQueue rows carry no userId, only the sessionId they belong to. Resolve through that.
export const assertOwnsMassAnalysis = async ({ massAnalysisId, requesterUserId, collections } = {}) => {
    const C = requireCollections(collections);
    if (!isValidId(requesterUserId)) throw new Meteor.Error(NOT_AUTHORIZED, NOT_LOGGED_IN_MESSAGE);
    if (!isValidId(massAnalysisId)) throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    const queue = await C.MassAnalysisQueue.findOneAsync({ _id: massAnalysisId });
    if (!queue) throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    return assertOwnsSession({ sessionId: queue.sessionId, requesterUserId, collections });
};

export const assertOwnsAnalysis = async ({ analysisId, requesterUserId, collections } = {}) => {
    const C = requireCollections(collections);
    if (!isValidId(requesterUserId)) throw new Meteor.Error(NOT_AUTHORIZED, NOT_LOGGED_IN_MESSAGE);
    if (!isValidId(analysisId)) throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    const session = await C.Session.findOneAsync(analysisOwnerSelector(analysisId));
    if (!session) throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    if (!isOwnedBy(session, requesterUserId)) throw new Meteor.Error(NOT_AUTHORIZED, NOT_OWNER_MESSAGE);
    return session;
};

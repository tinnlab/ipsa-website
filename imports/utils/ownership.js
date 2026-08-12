// Pure ownership predicates and selectors, extracted so the rules can be unit-tested without a
// database. The server-side guards in server/helper/ownership.js are thin wrappers around these.

// The two error codes the guards in server/helper/ownership.js throw. They live in this isomorphic
// module because the CLIENT has to recognise them: publications answer a non-owner with this.ready()
// and no documents, so an empty collection is indistinguishable from "still loading" and a rejected
// METHOD is the only signal that a study is off-limits. The server module re-exports these, so its
// own importers are unaffected.
export const NOT_AUTHORIZED = "not-authorized";
export const SESSION_NOT_FOUND = "session-not-found";

// One predicate for both codes, because the UI deliberately does not distinguish them: telling a
// stranger "not found" rather than "not yours" would confirm which study ids exist.
// Meteor.Error carries the code on `.error`; a plain Error, a disconnect or a 500 has none and must
// NOT be read as a denial, or a transient blip would eject a legitimate owner from their own study.
export const isStudyAccessError = (error) =>
    Boolean(error) && (error.error === NOT_AUTHORIZED || error.error === SESSION_NOT_FOUND);

// Ids arriving from a client are EJSON-decoded, so a caller can send an OBJECT where a string is
// expected — e.g. {$in: ["my-analysis", "someone-elses-analysis"]}. Such a value passes straight
// into a Mongo selector as an operator, which can both satisfy an ownership lookup (the $or
// matches the attacker's own study) and then widen the data query behind it to other users' rows.
// Every id crossing a trust boundary must therefore be proven to be a plain non-empty string
// before it reaches a selector.
export const isValidId = (value) => typeof value === "string" && value.length > 0;

// Same rule for the id ARRAYS a few endpoints accept (databaseIds).
export const isValidIdArray = (value) =>
    Array.isArray(value) && value.every((entry) => isValidId(entry));

// A study is owned by exactly one account: Session.userId is a plain Meteor userId string.
// Written defensively — a session doc missing userId (legacy/partial row) is owned by nobody,
// never by whoever happens to be asking.
export const isOwnedBy = (session, userId) =>
    Boolean(session && userId && session.userId === userId);

// Reverse lookup from an analysisId back to its owning study.
//
// Both arrays must be searched: entries of `metaAnalyses[]` carry real analysisIds that fan out
// to the same per-analysis collections as `analyses[]` (AnalysisResult rows with inputType
// 'meta', AnalysisConfigSnapshot rows with inputType 'metaDE'), and the delete cascade already
// treats them as one namespace via collectSessionAnalysisIds. Searching only `analyses[]` would
// leave every meta-analysis id unguarded.
// Callers must have already validated analysisId with isValidId; the guards in
// server/helper/ownership.js do this before building the selector.
export const analysisOwnerSelector = (analysisId) => ({
    $or: [{ "analyses.id": analysisId }, { "metaAnalyses.id": analysisId }],
});

// True when every requested analysisId belongs to the given session. Used when a caller supplies
// a list of ids (e.g. a share selection) that must all be covered by one study.
export const sessionOwnsAllAnalyses = (session, analysisIds) => {
    if (!session || !Array.isArray(analysisIds) || analysisIds.length === 0) return false;
    const owned = new Set(collectAnalysisIds(session));
    return analysisIds.every((id) => owned.has(id));
};

// Every analysisId a session owns, across both arrays. Mirrors collectSessionAnalysisIds in
// imports/utils/retention.js (the delete cascade's view of the same namespace); kept here so
// ownership code does not have to import the retention module.
export const collectAnalysisIds = (session) => {
    if (!session) return [];
    const ids = [];
    for (const entry of session.analyses || []) {
        if (entry && entry.id) ids.push(entry.id);
    }
    for (const entry of session.metaAnalyses || []) {
        if (entry && entry.id) ids.push(entry.id);
    }
    return [...new Set(ids)];
};

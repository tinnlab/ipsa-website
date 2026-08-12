import {Meteor} from 'meteor/meteor'
import {findOwnedSession, findOwnedSessionForAnalysis} from '../../helper/ownership'

// Every publication here serves study-scoped data, so every one is filtered to the subscriber's
// own studies (Session.userId === this.userId). Before this, none of them checked anything: any
// client could subscribe with a sessionId or analysisId it did not own and receive the full
// results, configs and snapshots of another user's study.
//
// Two shapes are used:
//   * sessionId-keyed — fold `userId: this.userId` straight into the Session selector, or resolve
//     the owned session first when the published collection is keyed by sessionId alone.
//   * analysisId-keyed — resolve the owning study first (findOwnedSessionForAnalysis searches both
//     analyses[] and metaAnalyses[]), then publish. There is no userId on the per-analysis rows.
//
// Unauthorized subscriptions return this.ready() rather than throwing: a throwing publish function
// surfaces an error on the client for what is simply "nothing to show", and the existing
// massAnalysisQueue publications already established this idiom.
//
// The publish functions are async because the ownership resolution is a database read. Meteor 3
// supports async publish functions returning a cursor or an array of cursors.

// Session docs carry the workspace recovery credential (an unsalted SHA-256 of the workspace
// password, see workspace.save). Nothing on the client needs it, and publishing it puts a
// crackable hash in the browser for every study the user can see — and workspace.recover accepts
// that credential to transfer study ownership. Excluded from every Session publication.
// importedFrom is excluded too: it records the donor's userId and sessionId, which the recipient
// has no use for and which contradicts share.preview's deliberate refusal to identify the source.
// They cannot read the donor's data with those ids, but they are correlatable across shares.
// readOnly stays, since the client needs it to render the view-only state.
const SESSION_PUBLIC_FIELDS = {workspacePassword: 0, importedFrom: 0};

Meteor.publish({
    async 'analysis.session'(sessionId) {
        if (!this.userId) return this.ready();
        return DBCollections.Session.find(
            {_id: sessionId, userId: this.userId},
            {fields: SESSION_PUBLIC_FIELDS}
        )
    },
    // The userId argument is ignored: it used to be taken from the client verbatim, so anyone
    // could subscribe with someone else's userId and enumerate that account's entire study list.
    // The parameter is kept so the existing subscribe call sites need no change.
    async 'session.all'(userId) {
        if (!this.userId) return this.ready();
        return DBCollections.Session.find({userId: this.userId}, {fields: SESSION_PUBLIC_FIELDS});
    },
    async 'analysis.changeLog'({analysisId, time}) {
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisLog.find({analysisId, time: {$gte: time}})
    },
    async 'analysis.config'({analysisId, inputType, keys}) {
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisConfig.find({analysisId, inputType, key: {$in: keys}})
    },
    async 'session.config'({sessionId, keys}) {
        if (!await findOwnedSession({sessionId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.SessionConfig.find({sessionId, key: {$in: keys}})
    },
    async 'analysis.running.logs'({analysisId, inputType}) {
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisLog.find({analysisId, inputType})
    },
    async 'analysis.results'({analysisId, inputType}) {
        if (!analysisId || !inputType) return this.ready();
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisResult.find({analysisId, inputType})
    },
    async 'analysis.results.api'({analysisId, inputType}) {
        if (!analysisId || !inputType) return this.ready();
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisResult.find(
            {analysisId, inputType},
            {fields: {_id: 1, analysisId: 1, inputType: 1, databaseId: 1, key: 1}}
        )
    },
    async 'analysisConfig.snapshot'({analysisId, inputType, keys}) {
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisConfigSnapshot.find({analysisId, inputType, key: {$in: keys}})
    },
    async 'analysisConfig'({analysisId, inputType, key}) {
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisConfig.find({analysisId, inputType, key});
    },
    async 'analysisConfig.snapshot.deGenes'({analysisId, inputType}) {
        if (!await findOwnedSessionForAnalysis({analysisId, requesterUserId: this.userId})) return this.ready();
        return DBCollections.AnalysisConfigSnapshot.find({analysisId, inputType, key: "DEGenes"});
    }
});

// Four publications were removed here rather than guarded, all with zero client subscribers:
//   'analysis.all'                       — published the entire Analysis collection.
//   'analysisConfig.snapshot.deAnalysis' — selector was {inputType, key} with no analysisId, so it
//                                          published every user's snapshots for that key.
//   'analysis.results.pathwayAnalysis'   — selector was {inputType} alone, same problem.
//   'analysis.results.db.method'         — returned findOne() (a document, not a cursor), so it
//                                          never published anything; it was dead on arrival.
// Guarding a publication nobody subscribes to would leave dead code carrying a data-leak shape.

// Mass Analysis Queue publications
Meteor.publish('massAnalysisQueue', async function (sessionId) {
    if (!this.userId) {
        return this.ready();
    }

    // Routed through findOwnedSession rather than hand-rolling the lookup, so sessionId passes the
    // isValidId type check. Hand-rolling it left the argument untyped: subscribing with
    // {$ne: null} produced the selector {_id: {$ne: null}, userId: this.userId}, which matched one
    // of the caller's OWN sessions and satisfied the guard — and the published selector below then
    // used the same operator, returning every user's rows.
    const session = await findOwnedSession({sessionId, requesterUserId: this.userId});

    if (!session) {
        return this.ready();
    }

    // Publish on the resolved session._id, which is a proven string, never the raw argument.
    return DBCollections.MassAnalysisQueue.find({sessionId: session._id});
});

Meteor.publish('massAnalysisQueueItems', async function (massAnalysisIds) {
    if (!this.userId || !massAnalysisIds || !Array.isArray(massAnalysisIds)) {
        return this.ready();
    }

    // Verify user has access to these mass analyses
    const sessions = await DBCollections.Session.find({
        userId: this.userId
    }).fetchAsync();
    const sessionIds = sessions.map(s => s._id);

    const accessibleMassAnalyses = await DBCollections.MassAnalysisQueue.find({
        _id: {$in: massAnalysisIds},
        sessionId: {$in: sessionIds}
    }).fetchAsync();

    const accessibleIds = accessibleMassAnalyses.map(ma => ma._id);

    return DBCollections.MassAnalysisQueueItem.find({
        massAnalysisId: {$in: accessibleIds}
    });
});

// Global mass analysis status (for admin)
Meteor.publish('massAnalysisGlobalStatus', async function () {
    if (!this.userId) {
        return this.ready();
    }

    // The admin lookup was also missing its await, so `user` was a Promise and user.profile was
    // undefined — this publication has been failing CLOSED (returning nothing, even for real
    // admins) rather than open. Awaiting it restores admin visibility.
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user || !user.profile?.roles?.includes('admin')) {
        return this.ready();
    }

    return [
        DBCollections.MassAnalysisQueue.find({}, {
            fields: {
                sessionId: 1,
                status: 1,
                total: 1,
                completed: 1,
                failed: 1,
                createdAt: 1,
                currentAnalysis: 1
            },
            sort: {createdAt: -1},
            limit: 50
        }),
        DBCollections.MassAnalysisQueueItem.find({}, {
            fields: {
                massAnalysisId: 1,
                analysisName: 1,
                status: 1,
                createdAt: 1,
                startedAt: 1,
                completedAt: 1
            },
            sort: {createdAt: -1},
            limit: 100
        })
    ];
});

// Update existing session publication to include mass analysis info
Meteor.publish('session.withMassAnalysis', async function (sessionId) {
    if (!this.userId) {
        return this.ready();
    }

    // See massAnalysisQueue above for why this goes through findOwnedSession. Untyped, this was the
    // worst hole on the branch: subscribing with {$ne: null} matched one of the caller's own
    // sessions, then published Session.find({_id: {$ne: null}}) — EVERY study of every user, with
    // no field projection, including workspacePassword hashes.
    const session = await findOwnedSession({sessionId, requesterUserId: this.userId});

    if (!session) {
        return this.ready();
    }

    return [
        DBCollections.Session.find({_id: session._id}, {fields: SESSION_PUBLIC_FIELDS}),
        DBCollections.MassAnalysisQueue.find({sessionId: session._id})
    ];
});

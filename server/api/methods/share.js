import {Meteor} from 'meteor/meteor';
import {check, Match} from 'meteor/check';
import {Random} from 'meteor/random';
import {DDPRateLimiter} from 'meteor/ddp-rate-limiter';
import {assertOwnsSession, isReadOnlySession} from '../../helper/ownership';
import {collectAnalysisIds, isValidId} from '/imports/utils/ownership';
import {
    SHARE_MODES,
    expiryFromDays,
    isValidExpiryDays,
    isShareUsable,
} from '/imports/utils/shareLink';
import {
    resolveShareSelection,
    shareSelectionNames,
    validateShareSelection,
} from '/imports/utils/shareSelection';
import {cloneStudy} from '../../helper/cloneStudy';

// Owner-side management of share links.
//
// A StudyShare stores REFERENCES ONLY — owner, source session, mode, the selected analysisIds and
// an expiry. Nothing is copied at share time; the clone reads through these ids when a recipient
// imports, so creating a link is cheap and a study that changes afterwards shares its current
// state. The trade-off is that a share can go stale (analyses deleted), which share.import handles.

// Fill in consensus for cloned analyses that had none. Cached consensus rides along with the
// AnalysisResult copy, so this runs only for analyses the donor never computed — usually none.
// Best-effort by design: an import that produced a viewable study should not fail because one
// optional panel could not be regenerated.
const recomputeMissingConsensus = async ({sessionId, analysisIds, onProgress}) => {
    const missing = [];
    for (const analysisId of analysisIds) {
        const existing = await DBCollections.AnalysisResult.findOneAsync({analysisId, key: 'consensus'});
        if (!existing) missing.push(analysisId);
    }
    if (missing.length === 0) return {recomputed: 0, failed: 0};

    let recomputed = 0;
    let failed = 0;
    for (const [index, analysisId] of missing.entries()) {
        await onProgress(`Computing consensus ${index + 1}/${missing.length}`, 95);
        try {
            const inputType = await inputTypeForAnalysis(sessionId, analysisId);
            // Server-side call: no connection, so consensus.processAnalysis skips its ownership
            // gate — correct here, the caller's ownership of the CLONE was just established by
            // creating it. Deterministic given the same inputs, so results are unchanged.
            await Meteor.callAsync('consensus.processAnalysis', {analysisId, sessionId, inputType});
            recomputed += 1;
        } catch (error) {
            failed += 1;
            console.error(`[share.import] consensus recompute failed for ${analysisId}:`, error.message);
        }
    }
    return {recomputed, failed};
};

const inputTypeForAnalysis = async (sessionId, analysisId) => {
    const session = await DBCollections.Session.findOneAsync({_id: sessionId}, {fields: {analyses: 1}});
    const entry = (session?.analyses || []).find((a) => a.id === analysisId);
    return entry?.input || 'ora';
};

// Authority over a link follows the STUDY, not whoever happened to mint it.
//
// Session.userId is reassignable — all three recovery flows transfer a study to a new account. If
// this keyed on share.ownerUserId, a link minted by the previous owner would keep producing copies
// of the new owner's study (including results added after the transfer, since nothing is
// materialised at share time) while the new owner could neither see nor revoke it.
const assertOwnsShare = async (shareId, requesterUserId) => {
    check(shareId, String);
    if (!isValidId(requesterUserId)) {
        throw new Meteor.Error('not-authorized', 'You must be logged in.');
    }
    const share = await DBCollections.StudyShare.findOneAsync({_id: shareId});
    if (!share) {
        throw new Meteor.Error('share-not-found', 'Share link not found.');
    }
    await assertOwnsSession({sessionId: share.sourceSessionId, requesterUserId});
    return share;
};

// An import copies an entire study and, for a full clone, its uploaded files — so it is the most
// expensive thing an unprivileged caller can trigger, and every visitor is auto-issued an account.
// share.import calls this.unblock(), so without a limit one client can run many in parallel.
// Creation is limited too, more loosely, since each link is a small row.
DDPRateLimiter.addRule({
    type: 'method',
    name: 'share.import',
    connectionId: () => true,
}, 5, 60 * 1000);

DDPRateLimiter.addRule({
    type: 'method',
    name: 'share.create',
    connectionId: () => true,
}, 30, 60 * 1000);

Meteor.methods({
    async 'share.create'({sessionId, analysisIds, mode, expiryDays}) {
        check(sessionId, String);
        check(analysisIds, [String]);
        check(mode, String);
        check(expiryDays, Number);

        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});

        if (!SHARE_MODES.includes(mode)) {
            throw new Meteor.Error('invalid-mode', 'Unknown share mode.');
        }
        // "View only" has to hold transitively. A results-only import has no uploaded inputs, so a
        // 'full' onward share would promise something it cannot deliver — and would quietly widen
        // what the original owner agreed to hand out.
        if (isReadOnlySession(session) && mode !== 'results') {
            throw new Meteor.Error(
                'invalid-mode',
                'This study was shared with you as view-only, so it can only be passed on as results only.'
            );
        }
        if (!isValidExpiryDays(expiryDays)) {
            throw new Meteor.Error('invalid-expiry', 'Choose an expiry between 1 and 90 days.');
        }
        if (analysisIds.length === 0) {
            throw new Meteor.Error('no-analyses', 'Select at least one analysis to share.');
        }

        // Every selected id must belong to THIS study. Without this the share record could name a
        // foreign analysisId, and the import would then clone it on the recipient's behalf —
        // laundering another user's data through a link the caller is allowed to create.
        const owned = new Set(collectAnalysisIds(session));
        const foreign = analysisIds.filter((id) => !owned.has(id));
        if (foreign.length > 0) {
            throw new Meteor.Error('not-authorized', 'Those analyses do not belong to this study.');
        }

        // Reconcile meta-analyses against their sources, and store the RESULT rather than the request.
        // This runs after the ownership check above, over ids already proven to belong to this study, so
        // it can only ever produce a subset of them plus this study's own metas — it cannot widen what the
        // caller is allowed to hand out. It runs here and not only in the modal because share.create is
        // directly callable.
        const resolved = resolveShareSelection(session, analysisIds);
        if (resolved.allIds.length === 0) {
            // Distinct from the empty-selection message above: the caller DID choose something, so
            // telling them to choose something would describe what they just did. This fires when the
            // choice was meta-analyses only, which cannot travel without their analyses.
            throw new Meteor.Error(
                'no-analyses',
                'A meta-analysis can only be shared together with every analysis it was computed from. Select those too.'
            );
        }

        const shareId = Random.id();
        await DBCollections.StudyShare.insertAsync({
            _id: shareId,
            ownerUserId: this.userId,
            sourceSessionId: sessionId,
            mode,
            analysisIds: resolved.allIds,
            createdAt: new Date(),
            expiresAt: expiryFromDays(expiryDays, Date.now()),
            revokedAt: null,
            importCount: 0,
        });
        return shareId;
    },

    // The owner's list of links for one study, with the study's analysis names resolved so the UI
    // can show what each link actually shares.
    async 'share.list'({sessionId}) {
        check(sessionId, String);
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});

        // Keyed on the study, not on who minted the link, so the current owner sees every link
        // pointing at their study — including any that predate an ownership transfer.
        const shares = await DBCollections.StudyShare.find(
            {sourceSessionId: sessionId},
            {sort: {createdAt: -1}}
        ).fetchAsync();

        // `name || id`: reading the name alone reported a live but unnamed entry as '(removed)'.
        const namesById = new Map(
            [...(session.analyses || []), ...(session.metaAnalyses || [])]
                .filter((entry) => entry && entry.id)
                .map((entry) => [entry.id, entry.name || entry.id])
        );

        return shares.map((share) => ({
            ...share,
            analysisNames: (share.analysisIds || []).map((id) => namesById.get(id) || '(removed)'),
        }));
    },

    async 'share.extend'({shareId, expiryDays}) {
        check(expiryDays, Number);
        const share = await assertOwnsShare(shareId, this.userId);
        if (!isValidExpiryDays(expiryDays)) {
            throw new Meteor.Error('invalid-expiry', 'Choose an expiry between 1 and 90 days.');
        }
        // Extending a revoked link would silently resurrect it; revocation is meant to be final.
        if (share.revokedAt) {
            throw new Meteor.Error('share-revoked', 'This link has been disabled and cannot be extended.');
        }
        const expiresAt = expiryFromDays(expiryDays, Date.now());
        await DBCollections.StudyShare.updateAsync({_id: shareId}, {$set: {expiresAt}});
        return expiresAt;
    },

    // Disable without deleting, so the owner keeps a record that the link existed.
    async 'share.revoke'({shareId}) {
        await assertOwnsShare(shareId, this.userId);
        await DBCollections.StudyShare.updateAsync({_id: shareId}, {$set: {revokedAt: new Date()}});
        return true;
    },

    async 'share.remove'({shareId}) {
        await assertOwnsShare(shareId, this.userId);
        await DBCollections.StudyShare.removeAsync({_id: shareId});
        return true;
    },

    // Runs as the RECIPIENT: the clone is created under this.userId, so a share link is a
    // capability to receive a copy and never grants access to the donor study itself.
    // progressId is minted by the CLIENT and passed in, so it can subscribe to the progress
    // document before this method returns. The method resolves only once the whole clone is done,
    // so a server-generated id would arrive too late to report anything.
    async 'share.import'({shareId, progressId}) {
        check(shareId, String);
        check(progressId, Match.Optional(String));
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in.');
        }
        // The clone runs long (large result payloads, and possibly R for missing consensus), so it
        // must not hold the client's method queue.
        this.unblock();

        const share = await DBCollections.StudyShare.findOneAsync({_id: shareId});
        if (!share || !isShareUsable(share, Date.now())) {
            throw new Meteor.Error('share-unavailable', 'This link is no longer available.');
        }

        const sourceSession = await DBCollections.Session.findOneAsync({_id: share.sourceSessionId});
        if (!sourceSession) {
            throw new Meteor.Error('share-unavailable', 'The shared study no longer exists.');
        }
        // The study may have changed hands since the link was minted. Consent to share does not
        // transfer with it, so a link outlives its authority and stops working.
        if (sourceSession.userId !== share.ownerUserId) {
            throw new Meteor.Error('share-unavailable', 'This link is no longer available.');
        }

        // Analyses can be deleted after the link is created, so re-check the stored list against the
        // study as it is NOW rather than trusting it. validateShareSelection also drops a stored
        // meta-analysis whose sources are no longer all coming along — and, because it never adds, a meta
        // computed after the link was minted stays out. share.preview answers with the same function, so
        // what the landing page promised is what arrives here.
        const {allIds: analysisIds} = validateShareSelection(sourceSession, share.analysisIds);
        if (analysisIds.length === 0) {
            throw new Meteor.Error('share-unavailable', 'The shared analyses no longer exist.');
        }

        // Refuse while the donor is mid-run: its results are being rewritten underneath us and the
        // copy would capture a half-written state.
        const running = await DBCollections.AnalysisLog.findOneAsync({
            analysisId: {$in: analysisIds},
            isRunning: true,
        });
        if (running) {
            throw new Meteor.Error('analysis-running', 'That study is running an analysis right now. Try again shortly.');
        }

        // Upsert rather than insert: the client may have already created the placeholder it is
        // subscribed to. userId is stamped from this.userId, never from the caller's payload, so a
        // supplied id cannot be used to write into someone else's progress document — and the
        // selector pins userId too, so a collision with another user's id is a no-op rather than a
        // takeover.
        const importProgressId = progressId || Random.id();
        await DBCollections.ShareImportProgress.upsertAsync({
            _id: importProgressId,
            userId: this.userId,
        }, {$set: {
            userId: this.userId,
            shareId,
            stage: 'Starting',
            percent: 0,
            status: 'running',
            newSessionId: null,
            error: null,
            createdAt: new Date(),
        }});

        // Every progress write is scoped by userId as well as _id, so it can only ever touch this
        // caller's own document.
        const onProgress = async (stage, percent) => {
            await DBCollections.ShareImportProgress.updateAsync(
                {_id: importProgressId, userId: this.userId},
                {$set: {stage, percent}}
            );
        };

        try {
            const result = await cloneStudy({
                sourceSession,
                analysisIds,
                targetUserId: this.userId,
                mode: share.mode,
                shareId,
                onProgress,
            });

            // Consensus results are ordinary AnalysisResult rows, so anything the owner had already
            // computed came across with the copy. Only genuinely missing ones are recomputed, and a
            // failure is logged rather than failing the import — the study is still viewable.
            await recomputeMissingConsensus({
                sessionId: result.sessionId,
                analysisIds: result.clonedAnalysisIds,
                onProgress,
            });

            await DBCollections.StudyShare.updateAsync({_id: shareId}, {$inc: {importCount: 1}});
            await DBCollections.ShareImportProgress.updateAsync({_id: importProgressId, userId: this.userId}, {
                $set: {stage: 'Done', percent: 100, status: 'completed', newSessionId: result.sessionId},
            });

            return {progressId: importProgressId, sessionId: result.sessionId, counts: result.counts};
        } catch (error) {
            console.error('[share.import] failed:', error);
            // Only a Meteor.Error's `reason` is shown: those are written here, for the recipient. An
            // internal error's `message` is not — it is phrased for a developer and can name the DONOR's
            // ids, which this method is otherwise careful never to disclose (see share.preview below).
            // The full error is on the server console either way.
            await DBCollections.ShareImportProgress.updateAsync({_id: importProgressId, userId: this.userId}, {
                $set: {
                    status: 'failed',
                    error: (error instanceof Meteor.Error && error.reason) || 'Import failed',
                },
            });
            throw error;
        }
    },

    // What the recipient sees BEFORE importing: enough to decide, and nothing more. Deliberately
    // does not return analysisIds, the source sessionId or the owner's identity — a link is a
    // capability to receive a copy, not a window into the donor study.
    async 'share.preview'({shareId}) {
        check(shareId, String);
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in.');
        }

        const share = await DBCollections.StudyShare.findOneAsync({_id: shareId});
        if (!share || !isShareUsable(share, Date.now())) {
            throw new Meteor.Error('share-unavailable', 'This link is no longer available.');
        }

        const session = await DBCollections.Session.findOneAsync(
            {_id: share.sourceSessionId},
            {fields: {name: 1, analyses: 1, metaAnalyses: 1, userId: 1}}
        );
        if (!session) {
            throw new Meteor.Error('share-unavailable', 'The shared study no longer exists.');
        }
        // Same check as share.import: a link does not survive the study changing hands.
        if (session.userId !== share.ownerUserId) {
            throw new Meteor.Error('share-unavailable', 'This link is no longer available.');
        }

        // The same reconciliation share.import will perform, so the recipient is promised precisely what
        // they will receive — including a meta-analysis being left out because one of its analyses has
        // since been deleted.
        const resolved = validateShareSelection(session, share.analysisIds);
        const {analysisNames, metaAnalysisNames} = shareSelectionNames(session, resolved);

        if (resolved.allIds.length === 0) {
            throw new Meteor.Error('share-unavailable', 'The shared analyses no longer exist.');
        }

        return {
            studyName: session.name,
            mode: share.mode,
            analysisNames,
            metaAnalysisNames,
            expiresAt: share.expiresAt,
            // True when the caller already owns the source study, so the UI can say so rather than
            // letting them make a pointless copy of their own work.
            isOwnStudy: share.ownerUserId === this.userId,
        };
    },
});

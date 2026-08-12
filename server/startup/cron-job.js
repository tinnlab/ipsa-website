import { Meteor } from 'meteor/meteor';
import * as schedule from "node-schedule"
import path from "path"
import fs from "fs"
const fsp = fs.promises
import {
    TMP_SCRATCH_MAX_AGE_MS,
    daysToMs,
    newestMtimeMs,
    selectStaleSessions,
    selectExpiredSessions,
    isSessionExpired,
    collectSessionAnalysisIds,
    backfilledExpiry,
    extendedExpiry,
    isScratchStale,
    isReapableScratchName,
    sessionExpiryDays,
} from "../helper/retention";

// Bound recursion (defense against accidental/malicious symlink loops in user upload trees).
const MAX_WALK_DEPTH = 32;

// Newest file mtime (epoch ms) anywhere under `dir`, or null if missing/empty. Async (so a
// large tree never blocks the Meteor event loop) and symlink-safe: lstat is used and symlinks
// are skipped, so a link can neither be followed into a loop nor have its target's mtime
// counted. Best-effort: any stat/readdir error is skipped rather than aborting the sweep.
const newestMtimeInDir = async (dir, depth = 0) => {
    if (depth > MAX_WALK_DEPTH) return null;
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
        return null; // missing or unreadable
    }
    let newest = null;
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        try {
            if (entry.isSymbolicLink()) continue; // never follow symlinks
            if (entry.isDirectory()) {
                const sub = await newestMtimeInDir(full, depth + 1);
                newest = newestMtimeMs([newest, sub]);
            } else if (entry.isFile()) {
                const { mtimeMs } = await fsp.lstat(full);
                newest = newestMtimeMs([newest, mtimeMs]);
            }
        } catch (e) {
            // skip unreadable entry
        }
    }
    return newest;
};

// Set of analysisIds with a currently-running analysis, so we never purge the upload of a
// live job (a re-run of a 90+-day-old session reads its file while we'd otherwise delete it).
export const fetchRunningAnalysisIds = async (AnalysisLog) => {
    if (!AnalysisLog) return new Set();
    const running = await AnalysisLog.find(
        { isRunning: true },
        { fields: { analysisId: 1 } }
    ).fetchAsync();
    return new Set(running.map((r) => r.analysisId));
};

// Delete the on-disk upload dir of every session whose newest file is older than the retention
// window. Keeps the Session doc and all analysis result/config/log rows — only the reclaimable
// file bytes go. A later missing file is surfaced to the user as a re-upload prompt
// (server/helper/assertInputFileExists.js). Deps are injectable for testing.
export const purgeStaleSessionUploads = async ({
    nowMs = Date.now(),
    tempUploadDir = Meteor.settings.private.tempUploadDir,
    retentionMs = daysToMs(sessionExpiryDays()), // shared clamped window (single source of truth)
    Sessions = (typeof DBCollections !== "undefined" ? DBCollections.Session : undefined),
    AnalysisLog = (typeof DBCollections !== "undefined" ? DBCollections.AnalysisLog : undefined),
    runningAnalysisIds = undefined,
} = {}) => {
    if (!Sessions) return { scanned: 0, purged: 0, skippedActive: 0 };

    const running = runningAnalysisIds ?? (await fetchRunningAnalysisIds(AnalysisLog));

    const sessions = await Sessions.find(
        {},
        { fields: { _id: 1, userId: 1, analyses: 1, dataPurgedAt: 1 } }
    ).fetchAsync();

    // Annotate each session with its upload dir + newest mtime (await, in series — see comment
    // above about not blocking the event loop), then let the pure selector decide staleness.
    const annotated = [];
    for (const s of sessions) {
        if (!s.userId || !s._id) continue;
        const dir = path.join(tempUploadDir, s.userId, s._id);
        annotated.push({
            _id: s._id,
            dir,
            analyses: Array.isArray(s.analyses) ? s.analyses : [],
            newestMtimeMs: await newestMtimeInDir(dir),
        });
    }

    const stale = selectStaleSessions(annotated, nowMs, retentionMs);

    let purged = 0;
    let skippedActive = 0;
    for (const s of stale) {
        // Never delete the input of a session with a running analysis. This retired mtime-purge
        // checks only s.analyses (not metaAnalyses) — it is no longer scheduled; the active
        // expiry path (deleteExpiredStudies/deleteStudyCompletely) guards on collectSessionAnalysisIds,
        // which covers meta-analyses too.
        if (s.analyses.some((a) => a && running.has(a.id))) {
            skippedActive += 1;
            continue;
        }
        try {
            // Re-check mtime immediately before deleting to narrow the TOCTOU window (a fresh
            // upload / re-run between the scan and now must not be purged).
            const recheck = await newestMtimeInDir(s.dir);
            if (recheck !== null && nowMs - recheck <= retentionMs) continue;

            await fsp.rm(s.dir, { recursive: true, force: true });
            await Sessions.updateAsync({ _id: s._id }, { $set: { dataPurgedAt: new Date(nowMs) } });
            purged += 1;
            console.log(`[retention] purged stale upload dir for session ${s._id}`);

            // Best-effort: drop the now-empty per-user parent dir so inodes don't accumulate.
            try { await fsp.rmdir(path.dirname(s.dir)); } catch (e) { /* not empty / gone */ }
        } catch (e) {
            console.error(`[retention] failed to purge ${s.dir}:`, e);
        }
    }
    return { scanned: annotated.length, purged, skippedActive };
};

// Every collection that stores rows OWNED by a study, so a deleted study leaves nothing behind.
// Split by the key each is queried on: per-analysis rows (one study fans out to many analysisIds
// — regular + meta) vs. per-session rows. A collection missing at runtime is skipped (test/DI).
const perAnalysisCollections = (C) => [
    C.AnalysisConfig,          // DE settings + per-analysis result payloads (key/value rows)
    C.AnalysisConfigSnapshot,  // immutable creation-time snapshot (volcano data, DE genes, ...)
    C.AnalysisResult,          // pathway/enrichment result rows
    C.AnalysisLog,             // run logs / progress messages
    C.MassAnalysisQueueItem,   // per-dataset mass-analysis queue items
    C.BatchInfo,               // generated AI-interpretation reports for the study's analyses
].filter(Boolean);
const perSessionCollections = (C) => [
    C.SessionConfig,           // session-scoped config (key/value)
    C.MassAnalysisQueue,       // mass-analysis batch record for the session
    C.PromptQueue,             // generated report payloads/prompts (paired with BatchInfo)
    C.LlmQueue,                // transient per-session LLM job records
].filter(Boolean);
// NOTE: SessionRecoveryLog is intentionally NOT cascaded — it is an audit trail (and most of its
// rows key on a `sessionIds` array, not a single `sessionId`), not study-owned data.
// WorkflowExecutions/WorkflowSteps are cascaded in a dedicated block (see deleteStudyCompletely)
// matching a WorkflowExecutions row by EITHER its sessionId OR a study analysisId — both are
// Match.Optional at the write boundary, so matching on either is robust against a row missing one.
// WorkflowSteps carry only workflowId, gathered from those execs.

// True when `child` resolves to a path inside `parent` (defense against a crafted userId/_id with
// `../` segments turning an rm into a traversal delete). Compares canonicalized paths.
export const isPathInside = (parent, child) => {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
};

// True if any of the given analysisIds currently has a running analysis (AnalysisLog.isRunning).
// Used to avoid deleting a study's inputs/results out from under a live R job.
export const anyRunningAnalysis = async (AnalysisLog, analysisIds) => {
    if (!AnalysisLog || !analysisIds || !analysisIds.length) return false;
    const running = await AnalysisLog.find(
        { analysisId: { $in: analysisIds }, isRunning: true },
        { fields: { analysisId: 1 } }
    ).fetchAsync();
    return running.length > 0;
};

// Hard-delete ONE study: its on-disk upload dir plus every row it owns across the collections
// above, then the Session doc itself. This is the single cascade shared by the manual
// `session.remove` method and the daily expiry sweep, so both delete a study the same way and
// files never outlive their study. Deps are injectable for testing. Best-effort per step: a
// failure in one collection is logged and does not abort the rest of the cascade.
export const deleteStudyCompletely = async ({
    session,
    tempUploadDir = Meteor.settings.private.tempUploadDir,
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
    rm = (dir) => fsp.rm(dir, { recursive: true, force: true }),
    anyRunningFn = anyRunningAnalysis,
} = {}) => {
    if (!session || !session._id || !collections) return { removed: false, analysisIds: 0 };
    const C = collections;
    const analysisIds = collectSessionAnalysisIds(session);

    // 0) Final atomic running-analysis guard, immediately before any deletion, so BOTH the manual
    //    (removeStudy) and sweep (deleteExpiredStudies) paths are protected against a race where an
    //    analysis flips to running between an earlier check and this cascade. Never delete a
    //    study's inputs/results out from under a live R job.
    if (analysisIds.length && await anyRunningFn(C.AnalysisLog, analysisIds)) {
        return { removed: false, analysisIds: 0, skippedActive: true };
    }

    // 1) On-disk upload dir for this session (tempUploadDir/userId/sessionId), then the now-empty
    //    per-user parent dir (best-effort) so inodes don't accumulate. Containment-checked: a
    //    crafted userId/_id with `../` segments must never let the rm escape tempUploadDir.
    if (session.userId && tempUploadDir) {
        const dir = path.join(tempUploadDir, String(session.userId), String(session._id));
        if (!isPathInside(tempUploadDir, dir)) {
            console.error(`[retention] refusing to remove upload dir outside tempUploadDir for study ${session._id}: ${dir}`);
        } else {
            try {
                await rm(dir);
                try { await fsp.rmdir(path.dirname(dir)); } catch (e) { /* parent not empty / gone */ }
            } catch (e) {
                console.error(`[retention] failed to remove upload dir for study ${session._id}:`, e);
            }
        }
    } else if (tempUploadDir && !session.userId) {
        // No userId → the upload path can't be derived; any on-disk files would be orphaned. Surface
        // it rather than silently skipping (the upload dir is tempUploadDir/userId/sessionId).
        console.warn(`[retention] study ${session._id} has no userId; skipping upload-dir removal (possible orphaned files)`);
    }

    // 2) Workflow records. A WorkflowExecutions row carries the study's sessionId AND a study
    //    analysisId, but BOTH are Match.Optional at the write boundary, so match on EITHER to be
    //    robust against a row missing one of them. WorkflowSteps key only on workflowId, so gather
    //    this study's workflowIds from its executions FIRST, delete the steps, then the executions.
    if (C.WorkflowExecutions) {
        try {
            const wfSelector = analysisIds.length
                ? { $or: [{ sessionId: session._id }, { analysisId: { $in: analysisIds } }] }
                : { sessionId: session._id };
            const execs = await C.WorkflowExecutions.find(
                wfSelector,
                { fields: { workflowId: 1 } }
            ).fetchAsync();
            const workflowIds = Array.from(new Set(execs.map((e) => e.workflowId).filter(Boolean)));
            if (workflowIds.length && C.WorkflowSteps) {
                await C.WorkflowSteps.removeAsync({ workflowId: { $in: workflowIds } });
            }
            await C.WorkflowExecutions.removeAsync(wfSelector);
        } catch (e) {
            console.error(`[retention] workflow cascade failed for study ${session._id}:`, e);
        }
    }

    // 3) Per-analysis rows across every analysisId-keyed collection.
    if (analysisIds.length) {
        for (const coll of perAnalysisCollections(C)) {
            try { await coll.removeAsync({ analysisId: { $in: analysisIds } }); }
            catch (e) { console.error(`[retention] per-analysis cascade failed for study ${session._id}:`, e); }
        }
    }

    // 4) Per-session rows.
    for (const coll of perSessionCollections(C)) {
        try { await coll.removeAsync({ sessionId: session._id }); }
        catch (e) { console.error(`[retention] per-session cascade failed for study ${session._id}:`, e); }
    }

    // 4b) Share links pointing AT this study. Kept out of perSessionCollections because that loop
    // removes by `sessionId` and StudyShare keys on `sourceSessionId`. Without this the rows
    // outlive the study: import and preview both refuse once the session is gone, so it is not a
    // hole, but since authority over a link now resolves through the session they would also be
    // unremovable — dead rows nobody can reach.
    if (C.StudyShare) {
        try { await C.StudyShare.removeAsync({ sourceSessionId: session._id }); }
        catch (e) { console.error(`[retention] share-link cascade failed for study ${session._id}:`, e); }
    }

    // 5) The Session doc itself.
    try { await C.Session.removeAsync({ _id: session._id }); }
    catch (e) { console.error(`[retention] failed to remove Session doc ${session._id}:`, e); }

    return { removed: true, analysisIds: analysisIds.length };
};

// Delete every study whose `expiredAt` is in the past, cascading files + owned rows via
// deleteStudyCompletely. This is the single driver that now aligns study lifetime with file
// lifetime (the old mtime-based upload purge kept the doc; expiry hard-deletes the whole study).
// A study with a running analysis is skipped even if expired — a long re-run must finish rather
// than have its inputs/results deleted from under it. Deps are injectable for testing.
export const deleteExpiredStudies = async ({
    nowMs = Date.now(),
    tempUploadDir = Meteor.settings.private.tempUploadDir,
    Sessions = (typeof DBCollections !== "undefined" ? DBCollections.Session : undefined),
    AnalysisLog = (typeof DBCollections !== "undefined" ? DBCollections.AnalysisLog : undefined),
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
    runningAnalysisIds = undefined,
    rm = undefined,
} = {}) => {
    if (!Sessions) return { scanned: 0, deleted: 0, skippedActive: 0 };

    const running = runningAnalysisIds ?? (await fetchRunningAnalysisIds(AnalysisLog));
    // Push the expiry predicate into Mongo to bound the scan (don't load every Session each night).
    // selectExpiredSessions re-validates in JS (belt-and-suspenders + malformed-date safety).
    const sessions = await Sessions.find(
        { expiredAt: { $lt: new Date(nowMs) } },
        { fields: { _id: 1, userId: 1, analyses: 1, metaAnalyses: 1, expiredAt: 1 } }
    ).fetchAsync();

    const expired = selectExpiredSessions(sessions, nowMs);

    let deleted = 0;
    let skippedActive = 0;
    let skipped = 0; // extended-since-scan / malformed no-op
    for (const s of expired) {
        const ids = collectSessionAnalysisIds(s);
        // Fast skip against the scan-time snapshot; deleteStudyCompletely does the final atomic
        // running-analysis re-check just before deleting (closing the TOCTOU window) and returns
        // skippedActive when it refuses, so a study that started running after the scan is spared.
        if (ids.some((id) => running.has(id))) {
            skippedActive += 1;
            continue;
        }
        // Re-read expiredAt immediately before deleting: a user who Extends a study between the
        // scan and now must not have it deleted (expiry TOCTOU, mirrors the running-analysis one).
        const fresh = await Sessions.findOneAsync({ _id: s._id }, { fields: { expiredAt: 1 } });
        if (!fresh || !isSessionExpired({ expiredAt: fresh.expiredAt, nowMs })) {
            skipped += 1;
            continue;
        }
        const res = await deleteStudyCompletely({
            session: s,
            tempUploadDir,
            collections,
            ...(rm ? { rm } : {}),
        });
        if (res && res.removed) {
            deleted += 1;
            console.log(`[retention] deleted expired study ${s._id}`);
        } else if (res && res.skippedActive) {
            skippedActive += 1; // refused: an analysis flipped to running between scan and delete
        } else {
            skipped += 1; // malformed/no-op
        }
    }
    return { scanned: sessions.length, deleted, skippedActive, skipped };
};

// Ownership- and running-guarded study removal, shared by the `session.remove` Meteor method
// (which supplies the authenticated userId). Extracted so the control flow — not-found early
// return, ownership refusal, running-analysis refusal, cascade — is unit-testable with injected
// fakes. The login gate stays in the method (it needs `this.userId`).
export const removeStudy = async ({
    sessionId,
    requesterUserId,
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
    deleteFn = deleteStudyCompletely,
    anyRunningFn = anyRunningAnalysis,
} = {}) => {
    if (!collections) {
        throw new Meteor.Error('collections-unavailable', 'Database collections are unavailable.');
    }
    const session = await collections.Session.findOneAsync({ _id: sessionId });
    if (!session) return { removed: false }; // already gone (e.g. swept) — client shows no false success
    // not-found (above) returns silently while not-owned (below) throws — a benign existence-oracle
    // we accept: Session ._id are non-enumerable Random.id()s (~101 bits), and throwing not-authorized
    // matches the repo-wide convention (queue.js / aiWorkflow.js) and surfaces a legit owner's mis-click.
    if (session.userId !== requesterUserId) {
        throw new Meteor.Error('not-authorized', 'You can only remove your own studies.');
    }
    if (await anyRunningFn(collections.AnalysisLog, collectSessionAnalysisIds(session))) {
        throw new Meteor.Error('analysis-running', 'Cannot remove a study while one of its analyses is running.');
    }
    const res = await deleteFn({ session, collections });
    // deleteStudyCompletely's final atomic guard can also refuse (analysis flipped to running in
    // the race window) — surface that as the SAME error so the user never gets a false "removed"
    // success when nothing was deleted.
    if (res && res.skippedActive) {
        throw new Meteor.Error('analysis-running', 'Cannot remove a study while one of its analyses is running.');
    }
    return res;
};

// Ownership-guarded expiry extension, shared by the `session.extendExpiration` Meteor method
// (which supplies the authenticated userId). Extracted so the control flow — not-found and
// ownership guards, server-side expiry computation — is unit-testable with injected fakes. The
// login gate stays in the method. Returns the new expiredAt (Date).
export const extendStudy = async ({
    sessionId,
    requesterUserId,
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
    // Default computes the new expiry with the operator-configured window (dataRetentionDays).
    extendFn = (cur) => extendedExpiry(cur, Date.now(), sessionExpiryDays()),
} = {}) => {
    if (!collections) {
        throw new Meteor.Error('collections-unavailable', 'Database collections are unavailable.');
    }
    const session = await collections.Session.findOneAsync({ _id: sessionId });
    if (!session) {
        // Error CODE follows the codebase convention (session-not-found); the user-facing reason
        // uses "Study" terminology to match the rest of this feature's messages.
        throw new Meteor.Error('session-not-found', 'Study not found');
    }
    if (session.userId !== requesterUserId) {
        throw new Meteor.Error('not-authorized', 'You can only extend your own studies.');
    }
    const newExpiredAt = extendFn(session.expiredAt);
    await collections.Session.updateAsync({ _id: sessionId }, { $set: { expiredAt: newExpiredAt } });
    return newExpiredAt;
};

// One-time, idempotent backfill for legacy studies created under the old 14-day window. Any study
// still carrying a short expiry is granted a GRACE window from deploy time (backfilledExpiry), so
// the first expiry sweep after deploy NEVER deletes a pre-existing study — including studies
// created long ago that would otherwise already be past a createdAt+window expiry. Normal expiry
// resumes after the grace period. Idempotent (backfilledExpiry returns null once a doc carries a
// full/future window), so it is safe to run on every startup and only writes docs that need it.
// Deps injectable for testing; nowMs captured once so the whole backfill shares one deploy instant.
export const backfillLegacyExpiry = async ({
    Sessions = (typeof DBCollections !== "undefined" ? DBCollections.Session : undefined),
    nowMs = Date.now(),
} = {}) => {
    if (!Sessions) return { updated: 0 };
    const days = sessionExpiryDays();
    const sessions = await Sessions.find({}, { fields: { createdAt: 1, expiredAt: 1 } }).fetchAsync();
    let updated = 0;
    for (const s of sessions) {
        const target = backfilledExpiry(s.createdAt, s.expiredAt, days, nowMs);
        if (target) {
            await Sessions.updateAsync({ _id: s._id }, { $set: { expiredAt: target } });
            updated += 1;
        }
    }
    if (updated) console.log(`[retention] backfilled expiredAt on ${updated} legacy studies`);
    return { updated };
};

// Reap rEval's transient R scratch in tempDir (.data/tmp) older than maxAgeMs. Only files whose
// names match the rEval scratch shape are touched (isReapableScratchName) — long-lived
// reference caches and *.rds handoffs that also live in tempDir are left untouched. Also fixes
// a pre-existing leak: rEval never unlinks its Rcmd wrapper .R file.
export const reapTempScratch = async ({
    nowMs = Date.now(),
    tempDir = Meteor.settings.private.tempDir,
    maxAgeMs = TMP_SCRATCH_MAX_AGE_MS,
} = {}) => {
    let entries;
    try {
        entries = await fsp.readdir(tempDir, { withFileTypes: true });
    } catch (e) {
        return { reaped: 0 };
    }
    let reaped = 0;
    for (const entry of entries) {
        if (!entry.isFile() || !isReapableScratchName(entry.name)) continue;
        const full = path.join(tempDir, entry.name);
        try {
            const { mtimeMs } = await fsp.lstat(full);
            if (isScratchStale(mtimeMs, nowMs, maxAgeMs)) {
                await fsp.unlink(full);
                reaped += 1;
            }
        } catch (e) {
            // skip in-use/unreadable file
        }
    }
    return { reaped };
};

export const runRetentionSweep = async () => {
    try {
        // Expiry is now the single deletion driver: a study and its files/rows are hard-deleted
        // together once expiredAt passes (aligned windows). The old mtime-based upload purge is
        // retired (purgeStaleSessionUploads kept for tooling/tests but no longer scheduled).
        const studies = await deleteExpiredStudies({});
        const scratch = await reapTempScratch({});
        console.log(
            `[retention] sweep done: scanned ${studies.scanned} studies, deleted ${studies.deleted} expired (skipped ${studies.skippedActive} active, ${studies.skipped || 0} no-op), reaped ${scratch.reaped} scratch files`
        );
    } catch (e) {
        console.error("[retention] sweep failed:", e);
    }
};

Meteor.startup(async () => {
    // Don't schedule the real daily job under `meteor test` (the test imports the runner
    // functions from this module; importing must not register production cron).
    if (Meteor.isTest || Meteor.isAppTest) return;

    // Grant legacy studies a grace window from deploy BEFORE scheduling the sweep, so NO
    // pre-existing study (even one created long ago under the old 14-day window) is hard-deleted on
    // the first run. Idempotent; awaited so the sweep never races ahead of the backfill.
    try {
        await backfillLegacyExpiry({});
    } catch (e) {
        console.error("[retention] legacy expiredAt backfill failed:", e);
    }

    // Daily at 03:00 server-local time: hard-delete studies past their expiredAt (cascading the
    // study's upload files + all owned DB rows), and reap stale R scratch.
    schedule.scheduleJob('0 3 * * *', () => {
        runRetentionSweep();
    });
});

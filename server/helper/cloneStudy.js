import {Meteor} from 'meteor/meteor';
import {Random} from 'meteor/random';
import path from 'path';
import fs from 'fs';
const fsp = fs.promises;
import {isPathInside} from '/server/startup/cron-job';
import {daysToMs, sessionExpiryDays} from '/server/helper/retention';
import {
    WORKFLOW_FIELDS_TO_DROP,
    buildIdMap,
    isTerminalWorkflow,
    metaAnalysisIsCloneable,
    remapConfigValue,
    remapMetaAnalysisEntry,
} from '/imports/utils/cloneIdMap';

// Clone selected analyses of one study into a NEW study owned by someone else.
//
// The collection list is the INVERSE of the delete cascade in server/startup/cron-job.js
// (perAnalysisCollections / perSessionCollections). That cascade is the authoritative statement of
// what a study owns, so deriving the clone from it keeps the two in step: anything the cascade
// deletes is something the clone has to consider copying.
//
// The invariant that matters most is that the DONOR study is never touched. Every write below
// targets freshly minted ids, and the three references that could point back at the donor —
// meta-analysis sources, custom gene-set ids, workflow ids — are remapped by imports/utils/cloneIdMap
// (unit-tested there) rather than by ad-hoc code here.

// Copy rows in chunks. AnalysisResult.value holds one entry per gene set per database and
// AnalysisConfig embeds geneStats / volcanoPlotData / mappedGeneIds, so a study runs to tens of MB;
// a single insertMany of everything would spike memory and can exceed the driver's batch limits.
const INSERT_CHUNK = 200;

const insertRows = async (collection, rows) => {
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await collection.rawCollection().insertMany(rows.slice(i, i + INSERT_CHUNK));
    }
    return rows.length;
};

// Recursively copy the study's upload directory. Mandatory for a full clone: getUserDataPath builds
// the read path from the CURRENT caller's userId, so files left under the donor's directory would be
// invisible to the recipient and every re-run would fail with "input file missing". Both sides are
// confined with the same guard the retention cascade uses before touching this tree.
const copyUploadDir = async ({sourceUserId, sourceSessionId, targetUserId, targetSessionId}) => {
    const uploadRoot = Meteor.settings.private.tempUploadDir;
    if (!uploadRoot || !sourceUserId) return {copied: 0};

    const from = path.join(uploadRoot, String(sourceUserId), String(sourceSessionId));
    const to = path.join(uploadRoot, String(targetUserId), String(targetSessionId));
    if (!isPathInside(uploadRoot, from) || !isPathInside(uploadRoot, to)) {
        throw new Meteor.Error('invalid-path', 'Refusing to copy outside the upload directory.');
    }

    let entries;
    try {
        entries = await fsp.readdir(from, {withFileTypes: true});
    } catch (e) {
        return {copied: 0}; // nothing uploaded, or the directory was swept — not fatal
    }

    await fsp.mkdir(to, {recursive: true});
    let copied = 0;
    for (const entry of entries) {
        // Skip transient chunk directories from an interrupted chunked upload, and never follow a
        // symlink out of the tree.
        if (entry.isSymbolicLink() || entry.isDirectory()) continue;
        if (!entry.isFile()) continue;
        try {
            await fsp.copyFile(path.join(from, entry.name), path.join(to, entry.name));
            copied += 1;
        } catch (e) {
            console.error(`[clone] failed to copy ${entry.name}:`, e.message);
        }
    }
    return {copied};
};

// Load the donor rows for one per-analysis collection, keyed on the selected ids.
const fetchByAnalysisIds = (collection, analysisIds) =>
    collection.find({analysisId: {$in: analysisIds}}).fetchAsync();

/**
 * @param sourceSession  the donor Session document (already ownership-checked by the caller)
 * @param analysisIds    the subset of the donor's analyses to clone
 * @param targetUserId   the recipient
 * @param mode           'results' (read-only, no inputs) | 'full' (editable deep clone)
 * @param onProgress     async (stage, percent) => void, drives the recipient's progress modal
 */
export const cloneStudy = async ({
    sourceSession,
    analysisIds,
    targetUserId,
    mode,
    shareId,
    onProgress = async () => {},
    collections = (typeof DBCollections !== 'undefined' ? DBCollections : undefined),
}) => {
    const C = collections;
    if (!C) throw new Meteor.Error('collections-unavailable', 'Database collections are unavailable.');

    const readOnly = mode === 'results';
    const selected = new Set(analysisIds);

    // --- id maps -------------------------------------------------------------------------------
    // Everything downstream rewrites through these, so a donor id can never survive into the clone.
    //
    // Only ids that will actually END UP in the new session's arrays get mapped. Mapping a selected
    // id that is then dropped (a meta-analysis missing some of its sources) would copy its rows
    // under a new analysisId that appears in no session array — unreachable by every guard and
    // invisible to the delete cascade, so it could never be reclaimed.
    const analysisEntryIds = (sourceSession.analyses || [])
        .filter((entry) => entry && selected.has(entry.id))
        .map((entry) => entry.id);
    const analysisIdMap = buildIdMap(analysisEntryIds, () => Random.id());

    // Meta-analyses come along only when EVERY analysis they were computed from is in the selection;
    // otherwise the cloned entry would reference the donor's analyses. See cloneIdMap for why that
    // also endangers the donor: the delete cascade collects metaAnalyses[].id.
    //
    // Cloneability is tested against the ids that will actually EXIST in the clone (the keys of
    // analysisIdMap), not against the raw selection. `selected` is the union of both session arrays, so a
    // source id could be present there while being absent from the map — and remapMetaAnalysisEntry would
    // then be handed an id it cannot rewrite.
    //
    // The `selected.has(entry.id)` half stays: the caller decides which metas are being shared, and this
    // must not start cloning one merely because its sources happen to be along for the ride.
    // DONOR ids, deliberately not named clonedAnalysisIds: this function already returns a
    // `clonedAnalysisIds` of the NEW ids, and two opposite meanings under one name is how someone later
    // hands donor ids to recomputeMissingConsensus.
    const donorAnalysisIdsBeingCloned = new Set(analysisIdMap.keys());
    const cloneableMeta = (sourceSession.metaAnalyses || [])
        .filter((entry) => selected.has(entry.id)
            && metaAnalysisIsCloneable(entry, donorAnalysisIdsBeingCloned));
    const metaIdMap = buildIdMap(cloneableMeta.map((entry) => entry.id), () => Random.id());

    // SessionConfig._id IS the custom gene-set id and is referenced from selectedDatasets,
    // geneStats and selectedRows. It has to change (primary key), so those references move with it.
    const sessionConfigRows = await C.SessionConfig.find({sessionId: sourceSession._id}).fetchAsync();
    const geneSetIdMap = buildIdMap(sessionConfigRows.map((row) => row._id), () => Random.id());

    // Every analysisId the clone will own, donor id -> clone id.
    const allIdMap = new Map([...analysisIdMap, ...metaIdMap]);
    const sourceAnalysisIds = [...allIdMap.keys()];
    // Returns undefined for an unmapped id rather than falling back to the donor's. A fallback
    // would let a donor analysisId ride into a cloned row via the sessionId arm of the report and
    // workflow queries below — and the DONOR's delete cascade, which matches on their own
    // analysisIds, would then delete the RECIPIENT's rows.
    const mapAnalysisId = (id) => allIdMap.get(id);
    // A row is only cloneable if any analysisId it carries is one we are remapping.
    const analysisIdIsCloneable = (id) => id === undefined || id === null || allIdMap.has(id);

    await onProgress('Preparing', 5);

    // --- the new Session -----------------------------------------------------------------------
    const newSessionId = Random.id();
    const clonedAnalyses = (sourceSession.analyses || [])
        .filter((entry) => entry && analysisIdMap.has(entry.id))
        .map((entry) => {
            // The mass-analysis pointers are deliberately dropped. The clone gets no
            // MassAnalysisQueue/QueueItem rows (pure run state), so a surviving massAnalysisId
            // would point at the DONOR's queue row — and the AI wizard, which collects these ids
            // and calls massAnalysis.getMetadata, would resolve to the donor's study and be
            // refused, making the wizard unusable on any cloned mass-analysis study.
            const {massAnalysisId, groupId, groupName, groupDescription, isMassAnalysis, ...rest} = entry;
            return {...rest, id: analysisIdMap.get(entry.id)};
        });

    if (clonedAnalyses.length === 0) {
        throw new Meteor.Error('nothing-to-clone', 'None of the shared analyses exist any more.');
    }

    // geneSetIdMap too: a pathway-level meta records the databaseId it was computed over, which for a
    // custom gene set is that gene set's SessionConfig._id and has therefore changed with the clone.
    const clonedMeta = cloneableMeta.map(
        (entry) => remapMetaAnalysisEntry(entry, analysisIdMap, metaIdMap, geneSetIdMap)
    );

    await C.Session.insertAsync({
        _id: newSessionId,
        userId: targetUserId,
        name: sourceSession.name,
        analyses: clonedAnalyses,
        ...(clonedMeta.length ? {metaAnalyses: clonedMeta} : {}),
        activeAnalysis: clonedAnalyses[0].id,
        createdAt: new Date(),
        expiredAt: new Date(Date.now() + daysToMs(sessionExpiryDays())),
        status: 'Active',
        // editable:false rides the pre-existing client convention (checked in the Session wizard
        // sections); readOnly is the canonical flag the new server-side guards test.
        editable: !readOnly,
        readOnly,
        globalSettings: sourceSession.globalSettings,
        transferHistory: [],
        importedFrom: {
            shareId,
            sourceSessionId: sourceSession._id,
            ownerUserId: sourceSession.userId,
            mode,
            importedAt: new Date(),
        },
        // Deliberately NOT copied: workspaceName / workspaceEmail / workspacePassword / hasWorkspace
        // (the donor's recovery credential must not follow the copy) and dataPurgedAt.
    });

    await onProgress('Copying configuration', 20);

    // --- per-session rows ----------------------------------------------------------------------
    // SessionConfig only; MassAnalysisQueue / PromptQueue / LlmQueue are handled below or skipped.
    // A custom gene set stores its id in BOTH the row _id and value.id, so the inner copy has to
    // move with it — otherwise every consumer that matches on value.id still sees the donor's id.
    await insertRows(C.SessionConfig, sessionConfigRows.map((row) => ({
        ...row,
        _id: geneSetIdMap.get(row._id) || Random.id(),
        sessionId: newSessionId,
        value: remapConfigValue(row.key, row.value, geneSetIdMap),
    })));

    // --- per-analysis config + snapshots -------------------------------------------------------
    const remapConfigRow = (row) => ({
        ...row,
        _id: Random.id(),
        analysisId: mapAnalysisId(row.analysisId),
        value: remapConfigValue(row.key, row.value, geneSetIdMap),
    });

    // Counts are captured as numbers as we go. Holding the row arrays until the end — which the
    // returned counts object would do — keeps the entire study resident for the whole clone, and a
    // study runs to tens of MB.
    const counts = {configs: 0, snapshots: 0, results: 0, reports: 0, workflows: 0};

    {
        const configRows = await fetchByAnalysisIds(C.AnalysisConfig, sourceAnalysisIds);
        counts.configs = configRows.length;
        await insertRows(C.AnalysisConfig, configRows.map(remapConfigRow));
    }

    {
        const snapshotRows = await fetchByAnalysisIds(C.AnalysisConfigSnapshot, sourceAnalysisIds);
        counts.snapshots = snapshotRows.length;
        await insertRows(C.AnalysisConfigSnapshot, snapshotRows.map((row) => ({
            ...remapConfigRow(row),
            ...(row.sessionId ? {sessionId: newSessionId} : {}),
        })));
    }

    await onProgress('Copying results', 45);

    // --- results (includes the consensus rows, which are ordinary AnalysisResult rows) ----------
    const resultRows = await fetchByAnalysisIds(C.AnalysisResult, sourceAnalysisIds);
    counts.results = resultRows.length;
    await insertRows(C.AnalysisResult, resultRows.map((row) => ({
        ...row,
        _id: Random.id(),
        analysisId: mapAnalysisId(row.analysisId),
        // For a CUSTOM gene set, databaseId is that gene set's id — which the clone regenerated.
        // Left alone, the result rows would still be keyed by the donor's id while the configs were
        // rewritten to the new one: the custom branch would be orphaned in the results tree and
        // resolve to no name. Built-in database ids are not in the map and pass through.
        databaseId: geneSetIdMap.get(row.databaseId) || row.databaseId,
    })));

    await onProgress('Copying reports', 65);

    // --- AI interpretation: BatchInfo + PromptQueue + WorkflowExecutions/Steps ------------------
    // userId must be rewritten or the recipient cannot read their own reports: every queue and
    // workflow read filters on this.userId.
    // The sessionId arm can match a report belonging to an analysis that is NOT in this selection
    // (an unshared one, or a meta dropped as non-cloneable). Such a row is skipped rather than
    // copied with the donor's analysisId intact — otherwise the DONOR's delete cascade, which
    // matches on their own analysisIds, would later delete the RECIPIENT's reports.
    const batchRows = (await C.BatchInfo.find({
        $or: [{sessionId: sourceSession._id}, {analysisId: {$in: sourceAnalysisIds}}],
    }).fetchAsync()).filter((row) => analysisIdIsCloneable(row.analysisId));
    counts.reports = batchRows.length;
    const batchIdMap = buildIdMap(batchRows.map((row) => row._id), () => Random.id());

    await insertRows(C.BatchInfo, batchRows.map((row) => ({
        ...row,
        _id: batchIdMap.get(row._id),
        userId: targetUserId,
        sessionId: newSessionId,
        analysisId: mapAnalysisId(row.analysisId),
    })));

    // PromptQueue carries no analysisId — it reaches the analysis only through batchId.
    const promptRows = await C.PromptQueue.find({batchId: {$in: [...batchIdMap.keys()]}}).fetchAsync();
    await insertRows(C.PromptQueue, promptRows.map((row) => ({
        ...row,
        _id: Random.id(),
        batchId: batchIdMap.get(row.batchId),
        userId: targetUserId,
        sessionId: newSessionId,
    })));

    // Mirrors the cascade's selector: a workflow row may carry either key. Same filter as BatchInfo
    // above, for the same reason.
    const workflowRows = (await C.WorkflowExecutions.find({
        $or: [{sessionId: sourceSession._id}, {analysisId: {$in: sourceAnalysisIds}}],
    }).fetchAsync()).filter((row) => analysisIdIsCloneable(row.analysisId));
    // Only terminal rows: a pending one would poll an external job that is not ours, and two rows
    // polling one job would both claim its result.
    const terminalWorkflows = workflowRows.filter(isTerminalWorkflow);
    counts.workflows = terminalWorkflows.length;
    const workflowIdMap = buildIdMap(terminalWorkflows.map((row) => row.workflowId), () => Random.id());

    await insertRows(C.WorkflowExecutions, terminalWorkflows.map((row) => {
        const cloned = {
            ...row,
            _id: Random.id(),
            // workflowId's index is NOT unique and every read is findOneAsync({workflowId}), so a
            // duplicate would resolve non-deterministically between the two studies — and the
            // delete cascade would take the other study's WorkflowSteps with it.
            workflowId: workflowIdMap.get(row.workflowId),
            userId: targetUserId,
            sessionId: newSessionId,
            analysisId: mapAnalysisId(row.analysisId),
        };
        for (const field of WORKFLOW_FIELDS_TO_DROP) delete cloned[field];
        return cloned;
    }));

    const stepRows = await C.WorkflowSteps.find({
        workflowId: {$in: [...workflowIdMap.keys()]},
    }).fetchAsync();
    await insertRows(C.WorkflowSteps, stepRows.map((row) => ({
        ...row,
        _id: Random.id(),
        workflowId: workflowIdMap.get(row.workflowId),
        userId: targetUserId,
    })));

    // --- full-clone extras ---------------------------------------------------------------------
    let filesCopied = 0;
    if (!readOnly) {
        await onProgress('Copying uploaded files', 80);
        const {copied} = await copyUploadDir({
            sourceUserId: sourceSession.userId,
            sourceSessionId: sourceSession._id,
            targetUserId,
            targetSessionId: newSessionId,
        });
        filesCopied = copied;

        // Run logs come along so the study reads as a completed run, with isRunning cleared: the
        // donor's in-flight state is not ours, and a stale isRunning would block deletion.
        const logRows = await fetchByAnalysisIds(C.AnalysisLog, sourceAnalysisIds);
        await insertRows(C.AnalysisLog, logRows.map((row) => ({
            ...row,
            _id: Random.id(),
            analysisId: mapAnalysisId(row.analysisId),
            isRunning: false,
        })));
    }
    // A results-only clone deliberately gets no uploads, no logs and no queue rows: it exists to be
    // viewed, and without inputs it cannot be re-run even if a guard were missed.

    await onProgress('Finishing', 95);

    return {
        sessionId: newSessionId,
        analysisIdMap,
        metaIdMap,
        clonedAnalysisIds: [...analysisIdMap.values()],
        counts: {
            ...counts,
            analyses: clonedAnalyses.length,
            metaAnalyses: clonedMeta.length,
            files: filesCopied,
        },
    };
};

// Pure id-remapping for the study clone.
//
// Cloning a study is mostly mechanical row copying, but three references make it subtle. Each of
// these, if got wrong, corrupts the DONOR study rather than the copy — which is the failure mode
// worth guarding hardest, because the donor's owner never took any action:
//
//   1. metaAnalyses[].pathwayLevel.selectedAnalyses holds analysisIds. Copied verbatim, the clone's
//      meta-analysis points at the donor's analyses. And because the delete cascade collects
//      metaAnalyses[].id, deleting the CLONE would then wipe the donor's meta results.
//   2. SessionConfig._id doubles as the custom gene-set id and is referenced from
//      AnalysisConfig.selectedDatasets and geneStats[].id. The _id must change (it is a primary
//      key), so every reference to it has to be rewritten in step.
//   3. WorkflowExecutions.workflowId has a NON-UNIQUE index and every read is findOneAsync({workflowId}),
//      so a duplicated id makes reads non-deterministic between the two studies.
//
// These helpers are pure and take an explicit id-minting function so they can be tested without
// Meteor's Random.

// Map every selected id to a fresh one. mintId is injected (Random.id in production).
export const buildIdMap = (ids, mintId) => {
    const map = new Map();
    for (const id of ids) {
        if (typeof id === 'string' && id.length > 0 && !map.has(id)) {
            map.set(id, mintId());
        }
    }
    return map;
};

// A meta-analysis is only meaningful when EVERY analysis it was computed from comes along. Cloning
// a partial selection would leave it referencing analyses that are not in the new study.
export const metaAnalysisIsCloneable = (metaEntry, clonedAnalysisIds) => {
    if (!metaEntry || !metaEntry.id) return false;
    const sources = metaSourceAnalysisIds(metaEntry);
    // A meta entry with no recorded sources cannot be shown to be self-contained, so it is dropped
    // rather than cloned on faith.
    if (sources.length === 0) return false;
    return sources.every((id) => clonedAnalysisIds.has(id));
};

// Source analysisIds referenced by a meta-analysis entry, across both levels.
//
// selectedAnalyses is written by a client-facing method that validates only the entry's `id`, so it can
// be any shape at all. Array.isArray is load-bearing rather than defensive tidiness: a for..of over a
// plain object throws, and this now runs on the SHARE paths too — inside share.preview, which is not
// wrapped in a try/catch, and inside the share modal's render.
export const metaSourceAnalysisIds = (metaEntry) => {
    if (!metaEntry) return [];
    const ids = [];
    for (const level of [metaEntry.geneLevel, metaEntry.pathwayLevel]) {
        if (!Array.isArray(level?.selectedAnalyses)) continue;
        for (const id of level.selectedAnalyses) {
            if (isSourceAnalysisId(id)) ids.push(id);
        }
    }
    return [...new Set(ids)];
};

// What counts as a source id. metaSourceAnalysisIds and remapMetaAnalysisEntry MUST agree on this: the
// first decides whether a meta is cloneable, the second rewrites it, and a value one accepts but the
// other does not is exactly how a meta passes the gate and then fails mid-clone.
const isSourceAnalysisId = (id) => typeof id === 'string' && id.length > 0;

// Rewrite a meta-analysis entry onto the cloned analyses: new own id, remapped source ids.
//
// An unmapped source id THROWS rather than falling back to the donor's id — that fallback is precisely
// the leak the header above warns about. It is not silently dropped either: selectedAnalyses is the
// meta's own record of what it was computed from, so a shortened list would misreport its inputs,
// disagree with the datasets the builder displays, and change the cloneability verdict if the recipient
// re-shares. Callers establish the invariant by filtering with metaAnalysisIsCloneable first, so getting
// here is a bug in the caller and should say so rather than quietly producing a plausible entry.
export const remapMetaAnalysisEntry = (metaEntry, analysisIdMap, metaIdMap, geneSetIdMap = new Map()) => {
    const remapSourceId = (id) => {
        const mapped = analysisIdMap.get(id);
        if (!mapped) {
            throw new Error(
                `remapMetaAnalysisEntry: meta-analysis ${metaEntry?.id} references unmapped analysis ${id}`
            );
        }
        return mapped;
    };

    // pathwayLevel.database is the databaseId the meta was computed over, and for a CUSTOM gene set that
    // is the gene set's SessionConfig._id — which the clone regenerates, exactly as AnalysisResult
    // .databaseId does. A built-in database id is not in the map and passes through untouched.
    const remapDatabase = (level) => (
        'database' in level ? {database: geneSetIdMap.get(level.database) || level.database} : {}
    );

    const remapLevel = (level) => {
        if (!level) return level;
        // A non-array is EMPTIED, not passed through. metaSourceAnalysisIds skips it when judging
        // cloneability, so the verdict was reached as though it held nothing — and copying it verbatim
        // would carry whatever ids it contains into the clone unremapped, which is the donor-id leak the
        // header warns about. An array-LIKE object ({"0": "someDonorId"}) is the reachable shape.
        if (!Array.isArray(level.selectedAnalyses)) {
            return {...level, ...remapDatabase(level), selectedAnalyses: []};
        }
        return {
            ...level,
            ...remapDatabase(level),
            // Filtered by the SAME rule metaSourceAnalysisIds applies before judging cloneability.
            // Without that, a null or empty entry is invisible to the verdict but still reaches
            // remapSourceId, and the meta passes the gate only to abort the import. Dropping a value
            // that was never an analysis id is not the shortening the comment above warns about.
            selectedAnalyses: level.selectedAnalyses.filter(isSourceAnalysisId).map(remapSourceId),
        };
    };

    const cloned = {
        ...metaEntry,
        id: metaIdMap.get(metaEntry.id) || metaEntry.id,
    };
    if (metaEntry.geneLevel) cloned.geneLevel = remapLevel(metaEntry.geneLevel);
    if (metaEntry.pathwayLevel) cloned.pathwayLevel = remapLevel(metaEntry.pathwayLevel);
    return cloned;
};

// AnalysisConfig.selectedDatasets is a flat list of database ids, some of which are custom
// gene-set ids that changed with the clone.
export const remapSelectedDatasets = (value, geneSetIdMap) => {
    if (!Array.isArray(value)) return value;
    return value.map((id) => geneSetIdMap.get(id) || id);
};

// geneStats is a list of {id, name, geneSets, ...}; the id of a custom entry is its
// SessionConfig._id and must follow the same remap.
export const remapGeneStats = (value, geneSetIdMap) => {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const mapped = geneSetIdMap.get(entry.id);
        return mapped ? {...entry, id: mapped} : entry;
    });
};

// selectedRows mirrors the gene-set selection and can reference the same ids.
export const remapSelectedRows = (value, geneSetIdMap) => {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
        if (typeof entry === 'string') return geneSetIdMap.get(entry) || entry;
        if (entry && typeof entry === 'object' && geneSetIdMap.has(entry.id)) {
            return {...entry, id: geneSetIdMap.get(entry.id)};
        }
        return entry;
    });
};

// A custom gene set carries its own id INSIDE its value as well as in the row's _id
// (analysis.js writes `value.id = customGeneSetId`). Both the SessionConfig row and the
// 'customGeneSets' snapshot copy of it therefore need the inner id rewritten too.
export const remapCustomGeneSetValue = (value, geneSetIdMap) => {
    if (Array.isArray(value)) {
        return value.map((entry) => remapCustomGeneSetValue(entry, geneSetIdMap));
    }
    if (!value || typeof value !== 'object') return value;
    const mapped = geneSetIdMap.get(value.id);
    return mapped ? {...value, id: mapped} : value;
};

// Apply whichever remap a given AnalysisConfig / AnalysisConfigSnapshot key needs. Keys with no
// custom-gene-set references pass through untouched.
export const remapConfigValue = (key, value, geneSetIdMap) => {
    if (!geneSetIdMap || geneSetIdMap.size === 0) return value;
    switch (key) {
        case 'selectedDatasets':
            return remapSelectedDatasets(value, geneSetIdMap);
        case 'geneStats':
            return remapGeneStats(value, geneSetIdMap);
        case 'selectedRows':
            return remapSelectedRows(value, geneSetIdMap);
        case 'customGeneSets':
            // analysis.start snapshots the SessionConfig row verbatim under this key, so the id
            // inside the value travels with it and has to move in step with SessionConfig._id.
            return remapCustomGeneSetValue(value, geneSetIdMap);
        default:
            return value;
    }
};

// Fields that must never survive a clone of a WorkflowExecutions row. externalJobId points at a job
// on the external pipeline — two rows polling one job would both claim its result — and outputPath
// is a filesystem path on that external service.
export const WORKFLOW_FIELDS_TO_DROP = ['externalJobId', 'outputPath'];

// Only terminal workflow rows are worth cloning; a pending one would poll a job that is not ours.
export const isTerminalWorkflow = (workflow) =>
    Boolean(workflow) && ['completed', 'failed'].includes(workflow.status);

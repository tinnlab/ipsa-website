// Which levels of a meta-analysis (gene, pathway) a study can actually run, and why not when it
// cannot. Pure and dependency-free so the Meta-analysis builder and the server-side Mocha runner
// share it. The builder locks each level's checkbox to this verdict: checked where the level is
// runnable, unchecked where it is not, with the reason shown next to it. Its submit validation
// stays in place as the backstop.

// A meta-analysis combines datasets, so every level needs at least this many.
export const META_MIN_ANALYSES = 2;

export const META_GENE_LEVEL_NO_STATS_REASON =
    'No analysis in this study has gene-level fold-change and p-value statistics, so gene-level ' +
    'meta-analysis is not available. Gene-list (ORA) uploads and single-metric ranked lists carry none, ' +
    'and an expression analysis has them only after it has been run.';

export const META_GENE_LEVEL_TOO_FEW_REASON =
    'Only one analysis in this study has gene-level fold-change and p-value statistics; gene-level ' +
    'meta-analysis needs at least two.';

export const META_PATHWAY_LEVEL_TOO_FEW_REASON =
    'No pathway database and enrichment method has results for at least two analyses in this study, ' +
    'so pathway-level meta-analysis is not available.';

export const META_NOTHING_AVAILABLE_TITLE = 'Meta-analysis is not available for this study';

export const metaGeneLevelIncludedNote = (count) =>
    `Included: ${count} analyses have gene-level fold-change and p-value statistics.`;

export const metaPathwayLevelIncludedNote = () =>
    'Included: at least two analyses have pathway enrichment results for the same database and method.';

/**
 * Shown under the pathway selectors when the CURRENT database + method pair cannot be pooled,
 * although another pair can. It does not change the checkbox; it tells the user to pick another pair.
 */
export const metaPathwayCombinationShortfallReason = (count, databaseName, method) =>
    `${count === 0 ? 'No analysis has' : 'Only one analysis has'} ${String(method || '').toUpperCase()} ` +
    `results for ${databaseName}; pathway-level meta-analysis needs at least two. ` +
    'Choose another database or enrichment method.';

/**
 * Gene-level capability. `selectableAnalysisIds` is buildGeneLevelData(...).initialSelectedItems,
 * which already holds only the eligible analyses that have gene-level results, so it is reused
 * here rather than recomputed.
 *
 * @param {string[]} selectableAnalysisIds
 * @returns {{available: boolean, count: number, reason: string|null}}
 */
export const geneLevelCapability = (selectableAnalysisIds) => {
    const count = new Set((selectableAnalysisIds || []).filter(Boolean)).size;
    if (count >= META_MIN_ANALYSES) return {available: true, count, reason: null};
    return {
        available: false,
        count,
        reason: count === 0 ? META_GENE_LEVEL_NO_STATS_REASON : META_GENE_LEVEL_TOO_FEW_REASON,
    };
};

/**
 * Distinct analyses per database and enrichment method, from the builder's resultsByDb
 * ({dbId: [{analysisId, key: method, value}]}). Counts an analysis the same way the pathway tree
 * marks it selectable: it has an entry for that database and method.
 *
 * @param {Object} resultsByDb
 * @returns {Object<string, Object<string, number>>} dbId -> method -> analysis count
 */
export const pathwayCombinationCounts = (resultsByDb) => {
    const counts = {};
    Object.keys(resultsByDb || {}).forEach((db) => {
        const rows = Array.isArray(resultsByDb[db]) ? resultsByDb[db] : [];
        const byMethod = {};
        rows.forEach((row) => {
            if (!row || !row.analysisId || !row.key) return;
            (byMethod[row.key] = byMethod[row.key] || new Set()).add(row.analysisId);
        });
        counts[db] = Object.fromEntries(Object.entries(byMethod).map(([m, ids]) => [m, ids.size]));
    });
    return counts;
};

/** Analyses with results for one database + method pair. */
export const pathwayCombinationCount = (resultsByDb, db, method) =>
    pathwayCombinationCounts(resultsByDb)?.[db]?.[method] || 0;

/**
 * Pathway-level capability, decided STATICALLY: runnable when some database + method pair has
 * results for at least two analyses. It deliberately does not follow the database / method
 * dropdowns, so the checkbox never flips while the user is choosing; a pair that falls short is
 * reported under the dropdowns instead (see metaPathwayCombinationShortfallReason).
 *
 * @param {Object} resultsByDb
 * @returns {{available: boolean, reason: string|null}}
 */
export const pathwayLevelCapability = (resultsByDb) => {
    const counts = pathwayCombinationCounts(resultsByDb);
    const available = Object.values(counts).some((byMethod) =>
        Object.values(byMethod).some((n) => n >= META_MIN_ANALYSES));
    return {available, reason: available ? null : META_PATHWAY_LEVEL_TOO_FEW_REASON};
};

/**
 * The database + method pair the builder starts on. The first pair (databases in their given
 * order, methods in order of first appearance) that at least two analyses share, so the default is
 * never one that cannot run. With no such pair it falls back to what the builder always picked:
 * the first database and the first method seen anywhere.
 *
 * @param {Object} resultsByDb
 * @returns {{database: string, method: string}}
 */
export const defaultPathwayCombination = (resultsByDb) => {
    const databases = Object.keys(resultsByDb || {});
    const methodOrder = [];
    databases.forEach((db) => (Array.isArray(resultsByDb[db]) ? resultsByDb[db] : []).forEach((row) => {
        if (row && row.key && !methodOrder.includes(row.key)) methodOrder.push(row.key);
    }));
    const counts = pathwayCombinationCounts(resultsByDb);
    for (const db of databases) {
        for (const method of methodOrder) {
            if ((counts[db]?.[method] || 0) >= META_MIN_ANALYSES) return {database: db, method};
        }
    }
    return {database: databases[0] || '', method: methodOrder[0] || ''};
};

// Pure, dependency-free helpers for the gene-level Meta-analysis builder.
// Lives under imports/utils (NOT imports/**/client/**) so it can be imported on
// both client and server — including the server-side Mocha runner.

/**
 * Resolve a human-readable name for an analysis, tolerating a missing entry.
 *
 * On the Visualization page the `analyses` map (analysesObj) is filtered down to
 * analyses that have pathway-enrichment results, while `configs` keeps every
 * analysis that has config snapshots. An Expression analysis with gene data but
 * no pathway results therefore lives in `configs` but is absent from `analyses`,
 * so `analyses[id]` is undefined. Each config object already carries the analysis
 * `name` (the server builds it from the analysis itself), so we prefer that and
 * fall back to the analyses map, then to the raw id — never throwing.
 *
 * @param {Object} analyses - map of analysisId -> analysis ({name})
 * @param {string} id - analysis id
 * @param {string} [fallbackName] - name carried on the config object, if any
 * @returns {string}
 */
export const analysisDisplayName = (analyses, id, fallbackName) => {
    return fallbackName ?? analyses?.[id]?.name ?? id;
};

/**
 * Build the data the gene-level meta-analysis section needs from the page state.
 *
 * Only Expression analyses are eligible for gene-level meta-analysis (PGSEA is
 * 2-column Gene+Statistic and lacks fold-change + p-value + standard errors, and
 * ORA has no per-gene stats). Expression analyses that have not been run yet have
 * no DE results (`hasGeneResults` is falsy) — they are kept in the tree but shown
 * disabled with a "(No DE results)" label (mirroring the pathway tree) and are NOT
 * pre-selected, so an empty dataset can't be fed into the meta-analysis. Names are
 * resolved via {@link analysisDisplayName} so a config whose analysis is missing
 * from `analyses` does not crash the builder.
 *
 * @param {Object|Array} configs - analysis configs keyed by id (or an array)
 * @param {Object} analyses - map of analysisId -> analysis ({name})
 * @returns {{expressionData: Array, geneTreeData: Array, initialSelectedItems: string[]}}
 */
export const buildGeneLevelData = (configs, analyses) => {
    const configList = configs ? Object.values(configs) : [];

    // Require an analysisId so we never emit TreeSelect entries with undefined
    // value/key (which would collide and pre-select `undefined`). This mirrors the
    // page-level filter that only keeps configs with an analysisId.
    const expressionData = configList.filter(e => e && e.inputType === "expression" && e.analysisId);

    const geneTreeData = expressionData.map(e => {
        const name = analysisDisplayName(analyses, e.analysisId, e.name);
        const hasResults = !!e.hasGeneResults;
        return {
            title: hasResults ? name : `${name} (No DE results)`,
            value: e.analysisId,
            key: e.analysisId,
            disabled: !hasResults,
            disableCheckbox: !hasResults,
        };
    });

    // Only pre-select analyses that actually have DE results.
    const initialSelectedItems = geneTreeData
        .filter(e => !e.disabled)
        .map(e => e.value);

    return {expressionData, geneTreeData, initialSelectedItems};
};

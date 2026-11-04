// Pure, dependency-free helpers for the gene-level Meta-analysis builder, and the shared
// analysis-name resolution every view uses to turn an analysis id into something readable.
// Lives under imports/utils (NOT imports/**/client/**) so it can be imported on
// both client and server — including the server-side Mocha runner.

// A non-empty string, or undefined. Used so that a name recorded as '' is treated as "no name" and
// falls through to the next source instead of winning and rendering blank.
const named = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * Resolve an analysis id to its name, or undefined when nothing in this study names it.
 *
 * Meta-analyses live on `Session.metaAnalyses[]`, a DIFFERENT array from `Session.analyses[]`, and
 * both are published to the client. Callers that consulted only the `analyses` map therefore
 * resolved a meta-analysis id to nothing at all — which is why the AI wizard showed raw ids in its
 * Review step and tab titles, saved reports named "Analysis <id>", and one label rendered as a bare
 * ':' with no name in front of it.
 *
 * @param {Object} analyses - map of analysisId -> analysis ({name})
 * @param {string} id - analysis id
 * @param {Array} [metaAnalyses] - Session.metaAnalyses[] ({id, name})
 * @returns {string|undefined}
 */
export const resolveAnalysisName = (analyses, id, metaAnalyses) => {
    const own = named(analyses?.[id]?.name);
    if (own) return own;
    const meta = (metaAnalyses || []).find((entry) => entry && entry.id === id);
    return named(meta?.name);
};

/**
 * Resolve a human-readable name for an analysis, tolerating a missing entry.
 *
 * On the Visualization page the `analyses` map (analysesObj) is filtered down to
 * analyses that have pathway-enrichment results, while `configs` keeps every
 * analysis that has config snapshots. An Expression analysis with gene data but
 * no pathway results therefore lives in `configs` but is absent from `analyses`,
 * so `analyses[id]` is undefined. Each config object already carries the analysis
 * `name` (the server builds it from the analysis itself), so we prefer that and
 * fall back to the analyses map, then to the meta-analyses list, then to the raw
 * id — never throwing.
 *
 * An EMPTY-STRING name no longer wins at any level: it used to, because `??` only
 * skips null/undefined, so a config carrying `name: ''` rendered blank instead of
 * falling through to a name that existed.
 *
 * @param {Object} analyses - map of analysisId -> analysis ({name})
 * @param {string} id - analysis id
 * @param {string} [fallbackName] - name carried on the config object, if any
 * @param {Array} [metaAnalyses] - Session.metaAnalyses[] ({id, name})
 * @returns {string}
 */
export const analysisDisplayName = (analyses, id, fallbackName, metaAnalyses) => {
    return named(fallbackName) ?? resolveAnalysisName(analyses, id, metaAnalyses) ?? id;
};

/**
 * A label that is about to be followed by punctuation — a ':' in the wizard's review step.
 *
 * Never returns an empty string, so the punctuation can never end up standing on its own. The
 * review step used to render `<Text strong>{analyses[id]?.name}:</Text>` with no fallback at all,
 * which for a meta-analysis produced a lone ':' on its own line.
 *
 * @param {*} value - the candidate label
 * @param {string} [fallback] - what to show when there is no usable label
 * @returns {string}
 */
export const nonEmptyLabel = (value, fallback = 'Unnamed analysis') => {
    return named(value) ?? named(fallback) ?? 'Unnamed';
};

/**
 * Build the data the gene-level meta-analysis section needs from the page state.
 *
 * Expression and PGSEA (ranked gene list with statistics) analyses are eligible for
 * gene-level meta-analysis; ORA has no per-gene stats. A PGSEA analysis qualifies only when
 * its upload carried fold-change AND p-value columns: analysis.start then writes its
 * volcanoPlotData with a logFCSE derived from FC and p (imports/utils/pgseaLogFCSE.js).
 * A single-metric PGSEA analysis has no such rows, so — exactly like an Expression analysis
 * that has not been run — its `hasGeneResults` is falsy and it is kept in the tree but shown
 * disabled with a label saying why, and NOT pre-selected, so an empty dataset can't be fed
 * into the meta-analysis. Names are
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
    const expressionData = configList.filter(e =>
        e && (e.inputType === "expression" || e.inputType === "pgsea") && e.analysisId);

    const geneTreeData = expressionData.map(e => {
        const name = analysisDisplayName(analyses, e.analysisId, e.name);
        const hasResults = !!e.hasGeneResults;
        const missing = e.inputType === "pgsea" ? "(No fold-change and p-value statistics)" : "(No DE results)";
        return {
            title: hasResults ? name : `${name} ${missing}`,
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

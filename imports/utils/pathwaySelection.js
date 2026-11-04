// Pure, dependency-free helpers for ranking and selecting pathways.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported on both client and server — including the server-side Mocha runner.
//
// This module is the single source of truth for how the pathway selection table
// ranks rows. Both the AntD table column `sorter`s (in AnalysisWizard.jsx) and the
// "Top N" selection logic import from here, so the order the user SEES in the table
// can never diverge from which pathways "Top N" actually picks.

export const PATHWAY_COLUMNS = {
    P_VALUE: 'pValue',
    P_VALUE_FDR: 'pValueFDR',
    SCORE: 'score',
    NAME: 'name',
};

// Default table sort, also used for the on-load auto-selection.
export const DEFAULT_SORT = { columnKey: PATHWAY_COLUMNS.P_VALUE, order: 'ascend' };

export const SELECTION_MODES = { TOP: 'top', ALL_SIGNIFICANT: 'allSignificant', ALL: 'all' };

export const SIGNIFICANCE_FDR_THRESHOLD = 0.05;

// Treat missing / non-finite numbers as "worst" so they always sort to the end,
// regardless of ascending/descending direction (they sort last for the ascending
// comparator; AntD/`selectPathways` negate the result for descending).
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY);
const absNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : Number.NEGATIVE_INFINITY);

// Tie-break by absolute enrichment score, largest magnitude first. Matches the
// long-standing behavior of the FDR sort in the pathway table.
const byAbsScoreDesc = (a, b) => absNum(b.score) - absNum(a.score);

// The numeric value a given column ranks on (null for the non-numeric name column).
const activeValue = (p, columnKey) => {
    switch (columnKey) {
        case PATHWAY_COLUMNS.P_VALUE_FDR: return p?.pValueFDR;
        case PATHWAY_COLUMNS.SCORE: return p?.score;
        case PATHWAY_COLUMNS.NAME: return null; // name is never "missing" for ranking
        default: return p?.pValue; // pValue + unknown-key fallback (matches comparePathways)
    }
};

// A row is "missing" for a numeric column when its value isn't a finite number.
// Such rows are never meaningful "top" results, so they always sort to the end
// regardless of ascending/descending (pure comparator negation would otherwise
// float them to the TOP under 'descend' and pollute Top-N).
const isMissingFor = (p, columnKey) =>
    columnKey !== PATHWAY_COLUMNS.NAME &&
    !(typeof activeValue(p, columnKey) === 'number' && Number.isFinite(activeValue(p, columnKey)));

/**
 * Returns an ASCENDING comparator(a, b) for the given table column. AntD applies
 * the sort direction itself (and `selectPathways` mirrors that by negating the
 * result for `descend`), so these comparators only ever describe ascending order.
 *
 * - pValue:    smaller p-value first, tie-break |score| desc
 * - pValueFDR: smaller FDR first, tie-break |score| desc
 * - score:     smaller |score| first (so `descend` => most enriched magnitude first),
 *              tie-break smaller FDR first
 * - name:      locale alphabetical
 */
export function comparePathways(columnKey) {
    switch (columnKey) {
        case PATHWAY_COLUMNS.P_VALUE:
            return (a, b) => {
                const d = num(a.pValue) - num(b.pValue);
                return d !== 0 ? d : byAbsScoreDesc(a, b);
            };
        case PATHWAY_COLUMNS.P_VALUE_FDR:
            return (a, b) => {
                const d = num(a.pValueFDR) - num(b.pValueFDR);
                return d !== 0 ? d : byAbsScoreDesc(a, b);
            };
        case PATHWAY_COLUMNS.SCORE:
            return (a, b) => {
                const d = absNum(a.score) - absNum(b.score);
                return d !== 0 ? d : num(a.pValueFDR) - num(b.pValueFDR);
            };
        case PATHWAY_COLUMNS.NAME:
            return (a, b) => (a.name || '').localeCompare(b.name || '');
        default:
            return comparePathways(DEFAULT_SORT.columnKey);
    }
}

/**
 * Pathways passing the interpretation page's pathway thresholds: FDR at or below
 * `maxFdr` AND |score| at or above `minAbsScore` (inclusive, like every other IPSA
 * filter). A non-finite FDR is treated as 1 and a non-finite score as magnitude 0,
 * mirroring geneSelection's filterGenes, so a row with missing statistics is kept
 * only by thresholds that keep everything. Never mutates the input.
 *
 * The threshold names differ from the row fields on purpose: `{fdr, score}` would
 * invite comparing a row's score with itself.
 *
 * @param {Array<object>} pathways
 * @param {{maxFdr:number, minAbsScore:number}} thresholds
 * @returns {Array<object>} the passing pathways, in input order
 */
export function filterPathwaysByThreshold(pathways, { maxFdr, minAbsScore } = {}) {
    return (pathways || []).filter((row) => {
        const rowFdr = Number.isFinite(row?.pValueFDR) ? row.pValueFDR : 1;
        const rowAbsScore = Number.isFinite(row?.score) ? Math.abs(row.score) : 0;
        return rowFdr <= maxFdr && rowAbsScore >= minAbsScore;
    });
}

/**
 * Rank `pathways` exactly as the table displays them for the given column/order,
 * then apply the selection mode. Never mutates the input.
 *
 * When `thresholds` is given, the pathways are first narrowed with
 * filterPathwaysByThreshold, so "top N" means the top N of the pathways that pass
 * and "all significant" means the passing pathways that are also significant.
 * SELECTION_MODES.ALL ignores the thresholds: it is literally every pathway.
 *
 * @param {Array<object>} pathways  pathway objects ({pValue, pValueFDR, score, ...})
 * @param {string} columnKey        one of PATHWAY_COLUMNS values (the active sort column)
 * @param {string} order            'ascend' | 'descend'
 * @param {string} mode             one of SELECTION_MODES ('top' | 'allSignificant' | 'all')
 * @param {number|string} n         count for 'top' mode (ignored otherwise)
 * @param {{maxFdr:number, minAbsScore:number}} [thresholds] optional pre-filter
 * @returns {Array<object>}         selected pathways, in ranked order
 */
export function selectPathways(pathways, columnKey, order, mode, n, thresholds) {
    const cmp = comparePathways(columnKey);
    const pool = (thresholds && mode !== SELECTION_MODES.ALL)
        ? filterPathwaysByThreshold(pathways, thresholds)
        : (pathways || []);
    // Negating the comparator for `descend` reproduces AntD's displayed order
    // (including tie-breaks) so the ranking matches what the user sees, but rows
    // with a missing value for the active column are always pushed to the end so
    // they never occupy the top of a descending Top-N.
    const sorted = [...pool].sort((a, b) => {
        const am = isMissingFor(a, columnKey);
        const bm = isMissingFor(b, columnKey);
        if (am !== bm) return am ? 1 : -1;
        return order === 'descend' ? -cmp(a, b) : cmp(a, b);
    });

    if (mode === SELECTION_MODES.ALL_SIGNIFICANT) {
        // Significance is always FDR-based, independent of the active sort column,
        // to stay consistent with the table's `significant-row` highlight. Inclusive
        // (was `<`): a pathway at exactly the threshold is significant, as it is in
        // every other IPSA filter.
        return sorted.filter((p) => p.pValueFDR <= SIGNIFICANCE_FDR_THRESHOLD);
    }
    if (mode === SELECTION_MODES.ALL) {
        return sorted;
    }
    const count = Number.parseInt(n, 10);
    return sorted.slice(0, Number.isFinite(count) && count > 0 ? count : 0);
}

/**
 * How many pathways are RANKED for the KEGG map. Unchanged from the inline `slice(0, 300)`.
 * Note the map itself preselects only the top one (it is a single-pathway, radio-select view);
 * the caller takes `pathwayIds[0]`. The full ranking is still computed so that "top" means the
 * table's own first row.
 */
export const KEGG_MAP_TOP_N = 300;

// A plain object: not null, not an array. The array exclusion is the whole point rather than
// defensive noise — see selectConsensusPathwayIds' note on the initial `[]`.
const isPlainObject = (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const usableId = (v) => v !== undefined && v !== null && v !== '';

/**
 * The pathway id of a result row.
 *
 * The two sources DO NOT SHARE A SHAPE, which is the second, entirely separate reason the KEGG map
 * reported no pathways:
 *
 *   consensus   (visualization.getConsensusAnalysisResult) -> {ID, pValue, pFDR, name}
 *   per-method  (/api/resultData)                          -> {pathway, pValue, pValueFDR, score, _row}
 *
 * The inline version read `.pathway` from both. For every study that HAS a consensus row that
 * mapped the entire ranked list to undefined and stored [undefined] — so those panes reported "no
 * significant pathways" deterministically, on every load, with no race involved and no reload that
 * could clear it. Reading both spellings is the fix; it is not defensive tolerance of a sloppy
 * shape, it is the actual contract of the two producers.
 */
const pathwayIdOf = (row) => {
    if (!row) return undefined;
    return usableId(row.pathway) ? row.pathway : row.ID;
};

/**
 * Which pathways the KEGG map should preselect: the newest consensus result if it has any rows,
 * otherwise the first non-empty per-method result.
 *
 * WHY THIS IS A FUNCTION. Inline, this logic ended with
 *
 *     let topSelectedPathway = selectedPathways[0]
 *     setPathwayId([topSelectedPathway])
 *
 * so an empty source stored `[undefined]` — an array of length ONE containing undefined. That is
 * not "nothing selected"; it is a value no length check catches, and the render guard grew an
 * explicit `pathwayId.includes(undefined)` test to cope with it. A study with hundreds of
 * significant pathways then rendered "no significant pathways found" because of that one entry.
 * The guarantee below — the trailing filter — is what makes that state unrepresentable, and it is
 * why the caller no longer needs an `includes(undefined)` test.
 *
 * The ranking is delegated to `selectPathways` rather than repeated. That is not just reuse: the
 * inline version did `pathwayResults.sort(...)` IN PLACE, mutating either `consensusResults[0].value`
 * or `results[methodKey]` — fetched data other code holds a reference to — and compared with
 * `a.pValue - b.pValue`, which is NaN when a p-value is missing and silently corrupts the sort.
 * `selectPathways` copies first and ranks missing values last. It also applies the table's
 * |score|-descending tie-break, so the pathway auto-selected here is the one the adjacent
 * SelectableResult table shows first — the invariant this module exists to hold. That tie-break is
 * inert for consensus rows, which carry no `score`: equal p-values there keep their arrival order.
 *
 * Never mutates its inputs.
 *
 * @param {Array<{value?: Array}>|null|undefined} consensusResults rows from
 *        visualization.getConsensusAnalysisResult, newest first
 * @param {Object|null|undefined} methodResults per-method results keyed by method name, as returned
 *        by extractMethodResults. Anything that is not a plain object (including an ARRAY — the
 *        state this used to be initialised to, which passed the old `typeof x === 'object'` guard
 *        while `Object.keys([])` came back empty) counts as "no fallback available".
 * @param {number} [topN=KEGG_MAP_TOP_N]
 * @returns {{pathwayIds: string[], methodUsed: string}} `pathwayIds` is ALWAYS an array of defined,
 *          non-empty ids; an empty or not-yet-fetched source yields [], never [undefined].
 */
export function selectConsensusPathwayIds(consensusResults, methodResults, topN = KEGG_MAP_TOP_N) {
    let pathwayResults = [];
    let methodUsed = 'consensus';

    const consensusRows = Array.isArray(consensusResults) ? consensusResults[0]?.value : undefined;
    if (Array.isArray(consensusRows) && consensusRows.length > 0) {
        pathwayResults = consensusRows;
    } else if (isPlainObject(methodResults)) {
        for (const methodKey of Object.keys(methodResults)) {
            const rows = methodResults[methodKey];
            if (Array.isArray(rows) && rows.length > 0) {
                pathwayResults = rows;
                methodUsed = methodKey;
                break;
            }
        }
    }

    const pathwayIds = selectPathways(
        pathwayResults,
        DEFAULT_SORT.columnKey,
        DEFAULT_SORT.order,
        SELECTION_MODES.TOP,
        topN
    )
        .map(pathwayIdOf)
        // The guarantee. A row with no usable id would otherwise become an `undefined` entry that
        // every downstream selection test has to know about.
        .filter(usableId);

    return {pathwayIds, methodUsed};
}

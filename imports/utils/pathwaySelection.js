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
 * Rank `pathways` exactly as the table displays them for the given column/order,
 * then apply the selection mode. Never mutates the input.
 *
 * @param {Array<object>} pathways  pathway objects ({pValue, pValueFDR, score, ...})
 * @param {string} columnKey        one of PATHWAY_COLUMNS values (the active sort column)
 * @param {string} order            'ascend' | 'descend'
 * @param {string} mode             one of SELECTION_MODES ('top' | 'allSignificant' | 'all')
 * @param {number|string} n         count for 'top' mode (ignored otherwise)
 * @returns {Array<object>}         selected pathways, in ranked order
 */
export function selectPathways(pathways, columnKey, order, mode, n) {
    const cmp = comparePathways(columnKey);
    // Negating the comparator for `descend` reproduces AntD's displayed order
    // (including tie-breaks) so the ranking matches what the user sees, but rows
    // with a missing value for the active column are always pushed to the end so
    // they never occupy the top of a descending Top-N.
    const sorted = [...(pathways || [])].sort((a, b) => {
        const am = isMissingFor(a, columnKey);
        const bm = isMissingFor(b, columnKey);
        if (am !== bm) return am ? 1 : -1;
        return order === 'descend' ? -cmp(a, b) : cmp(a, b);
    });

    if (mode === SELECTION_MODES.ALL_SIGNIFICANT) {
        // Significance is always FDR-based, independent of the active sort column,
        // to stay consistent with the table's `significant-row` highlight.
        return sorted.filter((p) => p.pValueFDR < SIGNIFICANCE_FDR_THRESHOLD);
    }
    if (mode === SELECTION_MODES.ALL) {
        return sorted;
    }
    const count = Number.parseInt(n, 10);
    return sorted.slice(0, Number.isFinite(count) && count > 0 ? count : 0);
}

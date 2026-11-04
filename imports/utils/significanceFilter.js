// Pure, dependency-free significance predicate shared by the visualization filters
// (pathway Venn diagram, multi-analysis forest plot). Lives under imports/utils so the
// server-side Mocha runner can import it.
//
// IPSA reads every user-facing filter as "FDR <= x and |Score| >= y", so both comparisons
// are inclusive: a row sitting exactly on a threshold passes. A threshold of 0 means
// "this filter is off" and lets every row through, which is the meaning the toolbars'
// `threshold === 0 ||` guards have always had.

/**
 * Does `row` pass the FDR and |score| thresholds?
 *
 * @param {object} row                       a result row
 * @param {object} thresholds
 * @param {number} thresholds.fdr            maximum FDR (inclusive); 0 disables the FDR filter
 * @param {number} thresholds.score          minimum |score| (inclusive); 0 disables the score filter
 * @param {string} [thresholds.fdrKey]       field holding the FDR (default 'pValueFDR')
 * @param {string} [thresholds.scoreKey]     field holding the score (default 'score')
 * @returns {boolean}
 */
export function passesSignificance(row, {fdr, score, fdrKey = 'pValueFDR', scoreKey = 'score'} = {}) {
    if (!row) return false;
    const passesFdr = fdr === 0 || row[fdrKey] <= fdr;
    const passesScore = score === 0 || Math.abs(row[scoreKey]) >= score;
    return passesFdr && passesScore;
}

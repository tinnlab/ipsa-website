// Pure, dependency-free helpers for the differential-expression (DE) wizard flow.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported on both client and server — including the server-side Mocha runner.

/**
 * Decide whether Step 5 should pre-compute the DE volcano preview before running
 * pathway analysis. DE is only meaningful for the `expression` input type, and we
 * only need to (re)compute the preview when there is no volcano data yet.
 *
 * Note: this is purely for the volcano-plot PREVIEW — the pathway analysis itself
 * recomputes DE from the raw expression file, so a failure here must never block
 * the run.
 */
export const shouldAutoRunDE = ({inputType, volcanoPlotData} = {}) => {
    if (inputType !== 'expression') return false;
    return !Array.isArray(volcanoPlotData) || volcanoPlotData.length === 0;
};

/**
 * Extract a human-meaningful message from an error thrown by a Meteor method.
 * Meteor.Error puts the useful text on `.reason`; plain Errors use `.message`.
 * Falls back to a generic string so the UI never shows "undefined".
 */
export const extractErrorMessage = (err) => {
    if (!err) return 'Failed to start analysis';
    return err.reason || err.message || 'Failed to start analysis';
};

// Error code the server (server/helper/assertInputFileExists.js) throws when a session's
// uploaded data file is gone from disk (wiped by an old redeploy, or auto-purged after long
// inactivity). Kept here as a plain string so this module stays dependency-free.
export const INPUT_FILE_MISSING_ERROR = 'input-file-missing';

/**
 * True when an error from a Meteor method signals that the uploaded data file is no longer
 * available on the server. Lets the UI show a "please re-upload" prompt instead of a generic
 * failure toast. Robust to the error being a Meteor.Error (`.error`) at the top level.
 */
export const isMissingInputError = (err) => {
    return !!err && err.error === INPUT_FILE_MISSING_ERROR;
};

/**
 * Count differentially expressed genes in volcano data that pass the given
 * thresholds (FDR-adjusted p-value AND absolute log2 fold-change). Mirrors the
 * up/down-regulated significance test used by the volcano plot / Step 5 summary.
 */
export const countDeGenes = (volcanoPlotData, {maxAdjustedPValue, minLogFoldChange} = {}) => {
    if (!Array.isArray(volcanoPlotData)) return 0;
    return volcanoPlotData.filter(gene =>
        gene &&
        gene.pValue <= maxAdjustedPValue &&
        Math.abs(gene.FC) >= minLogFoldChange
    ).length;
};

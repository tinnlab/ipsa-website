// Pure, dependency-free validation for the meta-analysis method name. Lives under
// imports/utils (NOT imports/**/client/**) so it can be imported on the server
// (analysis.js) and unit-tested by the server-side Mocha runner without pulling in
// Meteor server deps.

// The full set of meta-analysis methods understood by BOTH DEMetaAnalysis.js and
// PathwayMetaAnalysis.js (their R `match.arg` allow-lists). Kept here so an unknown
// method is rejected at the client-callable boundary rather than failing deep in R,
// and so the persisted `method` is always one the UI understands.
export const VALID_R_META_METHODS = ['stouffer', 'fisher', 'addCLT', 'geoMean', 'minP', 'REML'];

// Characters safe to interpolate into an R string / file path — rejects anything
// (quotes, parens, slashes, semicolons) that could break out of the R string literal.
export const R_METHOD_FORMAT = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a client-supplied meta-analysis method name. Defence in depth: the
 * character check rejects injection attempts with a clear message before the
 * allow-list rejects clean-but-unknown values.
 *
 * @param {*} method - the candidate method name
 * @returns {string|null} an error reason, or null if the method is valid
 */
export function rMetaMethodError(method) {
    if (typeof method !== 'string' || !R_METHOD_FORMAT.test(method)) {
        return 'selectedMethod contains unexpected characters';
    }
    if (!VALID_R_META_METHODS.includes(method)) {
        return `Unknown meta-analysis method: ${method}`;
    }
    return null;
}

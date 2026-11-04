// Pure, dependency-free reader for the /api/resultData payload shape.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and can be
// imported on both client and server — including the server-side Mocha runner.
//
// WHY THIS EXISTS: three panes in Visualization/index.jsx (KEGGMap, ForestChartTable,
// NegBarChartTable) each did the same unguarded two-level index on the response:
//
//     setResult(resJson[geneSet.id][analysisId])
//
// That has two distinct failure modes, and neither of them tells the user the truth.
//
//   1. `resJson[geneSet.id]` absent — which happens whenever the analysis has no result rows for
//      this database yet (still running, failed, or only other databases were run). Indexing
//      `undefined` throws a TypeError INSIDE the fetch's try block, the catch swallows it, the
//      finally clears the loading flag, and `result` keeps its initial value. The pane then renders
//      "No significant pathways were identified" for a study that may well have them. A non-ok
//      response (401 after a token blip, 403 after a share is revoked, 500 on a restart) lands in
//      exactly the same place, because the `!response.ok` throw is caught by the same catch.
//
//   2. `resJson[geneSet.id]` present but the analysisId key absent — `setResult(undefined)` then
//      succeeds and every later read of `result` throws: `Object.keys(result)` in the render guard
//      and in the sorting-options effect, and `result.length` in the ranking effect. There is no
//      React error boundary anywhere in imports/ or client/, so that throw is not contained to the
//      panel — it unmounts the tree and blanks the page.
//
// Mode 2 is NOT reachable through /api/resultData as the server is written today:
// getResultsForAnalysis (server/api/methods/visualizationCore.js) selects on `analysisId`, and
// groupResultsByDbAnalysisMethod (server/helper/getAnalysisResultRest.js) keys
// resultData[databaseId][analysisId] from exactly those rows, so a present database key always
// carries the requested analysis. It is guarded here as insurance against that invariant changing,
// not as a fix for an observed crash. Mode 1 is reachable and is a real false negative.
//
// Returning a discriminated result instead of throwing is the point: the caller can distinguish
// "loaded, and there is genuinely nothing" from "we never got the data", which the swallowing catch
// made impossible.

/**
 * Pull one analysis's per-method results out of an /api/resultData payload.
 *
 * The payload shape is {databaseId: {analysisId: {method: rows}}}.
 *
 * Never throws, and never returns `undefined`: callers put the value straight into React state and
 * then read `Object.keys(...)` off it, so `undefined` there is the crash described above.
 *
 * NOTE what `null` does and does not mean. It means "the response carried nothing for this
 * database and analysis" — which is a real, successful answer for an analysis that has not written
 * results for this database. It is NOT an error signal, and callers must not render "could not
 * load" for it; that would trade one false negative for another. A genuine failure is the throw or
 * the non-ok status at the call site, which the caller flags separately.
 *
 * @param {*} resJson       parsed /api/resultData body (any shape; nothing is trusted)
 * @param {*} databaseId    gene-set database id, e.g. the KEGG id
 * @param {*} analysisId
 * @returns {Object|null}   the {method: rows} map, or null when it is absent or not an object
 */
export function extractMethodResults(resJson, databaseId, analysisId) {
    if (!isPlainObject(resJson)) return null;

    const forDatabase = resJson[databaseId];
    if (!isPlainObject(forDatabase)) return null;

    const forAnalysis = forDatabase[analysisId];
    if (!isPlainObject(forAnalysis)) return null;

    return forAnalysis;
}

// A plain object: not null, not an array. The array exclusion is load-bearing rather than
// defensive — `results` was initialised to `[]` in KEGGMap, and `typeof [] === 'object'` let an
// empty array flow into code that then did Object.keys() on it and concluded "no pathways".
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

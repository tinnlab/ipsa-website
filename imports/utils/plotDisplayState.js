// Pure, dependency-free helper for deciding what a pathway plot should render.
// Lives under imports/utils (NOT imports/**/client/**) so it can be imported on
// both client and server — including the server-side Mocha runner.

/**
 * Decide the display state of the Circos plot (and the sibling pathway plots that
 * share its data pipeline). The plot's data arrives from several independent async
 * sources, so the naive "if no data, say 'no significant pathway'" check fires
 * *while data is still loading*, producing a confusing flash before the chart
 * appears. This helper gates every "no data" verdict behind "all sources settled".
 *
 * Returns one of:
 *   'loading'      -> still fetching/deriving/building; show a spinner.
 *   'no-de-genes'  -> no significant differentially expressed genes.
 *   'no-result'    -> this method produced no result.
 *   'no-pathways'  -> no significant pathways for this database.
 *   'ready'        -> render the chart.
 *
 * The key anti-flash rules:
 *   - while any async source is in flight (`isLoadingData` / `loadingDEGenes`) we
 *     stay in 'loading' instead of falling through to a "no data" message;
 *   - after the result is in but its pathways have not been computed yet
 *     (`pathwaysResolved === false`) we stay in 'loading';
 *   - once pathways ARE selected but the chart nodes are not built yet
 *     (`inputGenesPathways` empty) we stay in 'loading' — this closes the gap
 *     between selecting pathways and the chart-building fetch flipping its flag.
 *
 * @param {Object} params
 * @param {boolean} params.isLoadingData        method-results fetch or chart build in flight
 * @param {boolean} params.loadingDEGenes       fold-change/p-value fetch + DE-gene derivation in flight
 * @param {Array}   params.result               method results
 * @param {Array}   params.DEGenes              differentially expressed genes
 * @param {boolean} params.pathwaysResolved     selected-pathways have been computed for the current result
 * @param {Array}   params.selectedPathwaysForDb pathways selected for this database
 * @param {Array}   params.inputGenesPathways   built chart nodes (pathways + genes)
 * @returns {'loading'|'no-de-genes'|'no-result'|'no-pathways'|'ready'}
 */
export const computePlotDisplayState = ({
    isLoadingData = false,
    loadingDEGenes = false,
    result = [],
    DEGenes = [],
    pathwaysResolved = false,
    selectedPathwaysForDb = [],
    inputGenesPathways = [],
} = {}) => {
    if (isLoadingData || loadingDEGenes) return 'loading';
    if (!Array.isArray(DEGenes) || DEGenes.length === 0) return 'no-de-genes';
    if (!Array.isArray(result) || result.length === 0) return 'no-result';
    // Result is in but its pathways have not been computed yet — still loading.
    if (!pathwaysResolved) return 'loading';
    if (!Array.isArray(selectedPathwaysForDb) || selectedPathwaysForDb.length === 0) return 'no-pathways';
    // Pathways selected but chart nodes not built yet — still loading (closes the blink gap).
    if (!Array.isArray(inputGenesPathways) || inputGenesPathways.length === 0) return 'loading';
    return 'ready';
};

/** Human-readable message for each non-'ready', non-'loading' state. */
export const PLOT_STATE_MESSAGES = {
    'no-de-genes': 'No significant differentially expressed genes were identified.',
    'no-result': 'No result found for this method.',
    'no-pathways': 'No significant pathways were identified',
};

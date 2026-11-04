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

/**
 * The same loading-vs-no-data decision for the panes whose data comes from plain fetches:
 * KEGGMap, ForestChartTable and NegBarChartTable.
 *
 * Deliberately thin. Those three panes look near-identical but their "do we have data?" tests are
 * NOT the same — ForestChartTable additionally requires `initialTreeData`, NegBarChartTable does
 * not, and KEGGMap tests a selected-pathway list — and that divergence is long-standing (the
 * commented-out predecessors of both render guards show it too). A fatter helper taking each pane's
 * raw state would have to carry a flag meaning "this one is stricter", which hides the difference
 * rather than expressing it. So each caller computes its own `hasData` and this function owns only
 * the part that is genuinely common, and genuinely subtle:
 *
 *   - `loading` outranks everything, so no "no data" verdict can fire mid-flight;
 *   - a fetch that FAILED but still left us with data renders the data — a transient failure must
 *     not blank a pane that has something to show;
 *   - a fetch that failed and left us with nothing says so, instead of claiming there are no
 *     significant pathways. Those are different facts, and reporting the second for the first is
 *     the false negative this helper exists to stop: the user cannot tell a real empty result from
 *     a dropped request, so the bug hides.
 *
 * @param {Object} params
 * @param {boolean} params.loading  any fetch this pane depends on is still in flight
 * @param {boolean} params.failed   any of those fetches failed or returned nothing usable
 * @param {boolean} params.hasData  the caller's own "there is something to render" predicate
 * @returns {'loading'|'ready'|'load-failed'|'no-pathways'}
 */
export const computeFetchedPlotState = ({
    loading = false,
    failed = false,
    hasData = false,
} = {}) => {
    if (loading) return 'loading';
    if (hasData) return 'ready';
    if (failed) return 'load-failed';
    return 'no-pathways';
};

/** Human-readable message for each non-'ready', non-'loading' state. */
export const PLOT_STATE_MESSAGES = {
    'no-de-genes': 'No significant differentially expressed genes were identified.',
    'no-result': 'No result found for this method.',
    'no-pathways': 'No significant pathways were identified',
    // Distinct from 'no-pathways' on purpose. These panes previously swallowed every fetch error
    // and rendered the "no pathways" copy, so a dropped request was indistinguishable from a real
    // empty result — which is why the KEGG false negative went unreported for so long.
    'load-failed': 'Could not load pathway results. Reload the page to try again.',
};

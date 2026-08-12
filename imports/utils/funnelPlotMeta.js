// Pure, dependency-free helpers for the pathway-level Meta-analysis Funnel Plot.
// Lives under imports/utils (NOT imports/**/client/**) so it can be imported on
// both client and server — including the server-side Mocha runner.
//
// A funnel plot needs a standard error (seTE). In the pathway meta-analysis only
// the REML method produces one (for REML it is the pooled fixed-effect SE of each
// pathway's meta-estimate); the p-value combination methods —
// stouffer/fisher/addCLT/geoMean/minP — have no concept of a standard error.
// These helpers are extracted from FunnelPlotPathway.jsx so the point-filtering
// and empty-state messaging are unit-testable and shared with the component.

// The only meta-analysis method that yields a standard error.
export const SE_METHOD = "REML";

// Human-readable label for SE_METHOD — the MetaAnalysisBuilder dropdown shows
// "Restricted maximum likelihood"; we append the "(REML)" abbreviation in user-facing
// messages so non-expert users can connect the method name to the common acronym.
export const SE_METHOD_LABEL = "Restricted maximum likelihood (REML)";

// The p-value combination methods that do NOT produce a standard error, labelled
// exactly as in the MetaAnalysisBuilder dropdown so users recognise them. These are
// the five non-REML methods; together with REML they cover all six valid methods.
export const NON_SE_METHOD_LABELS = ["Fisher", "Stouffer", "addCLT", "Minimum p-value", "Geometric mean"];

export const FUNNEL_EMPTY_GENERIC =
    "No meta-analysis data available for funnel plot. Please run a meta-analysis first.";

export const FUNNEL_EMPTY_REQUIRES_REML =
    `A funnel plot needs a standard error (SE) — a measure of how precise each pathway's ` +
    `combined effect estimate is. Only the ${SE_METHOD_LABEL} method computes an SE; the ` +
    `p-value combination methods (${NON_SE_METHOD_LABELS.join(", ")}) do not. Re-run the ` +
    `meta-analysis with ${SE_METHOD_LABEL} to view this plot.`;

export const FUNNEL_EMPTY_REML_NO_SE =
    `This ${SE_METHOD_LABEL} meta-analysis produced no pathways with a usable standard error ` +
    `(SE) — the per-pathway precision a funnel plot is built from — so the plot is empty.`;

/**
 * Build the funnel-plot points for one database's meta-analysis results.
 *
 * Keeps one point per pathway that has a valid, positive, finite standard error
 * (seTE) and a usable p-value (a funnel plot is undefined without an SE). Points
 * from non-REML results — which carry no seTE — are therefore all dropped. The
 * filter mirrors the original inline logic in FunnelPlotPathway.jsx so the
 * component and its tests share one implementation.
 *
 * @param {Array<{value?: Array}>} metaResultsForDb - meta-analysis result docs for one database
 * @param {(id: string) => string} [resolveName] - maps a pathway ID to a display name (defaults to the ID)
 * @returns {Array<{pathwayName: string, pathwayId: string, score: number, se: number, pValue: number, pValueFDR: *}>}
 */
export function buildFunnelPoints(metaResultsForDb, resolveName = (id) => id) {
    const points = [];
    if (!Array.isArray(metaResultsForDb)) return points;

    metaResultsForDb.forEach((metaResult) => {
        if (!metaResult || !Array.isArray(metaResult.value)) return;

        metaResult.value.forEach((pathway) => {
            if (!pathway) return;
            const pValue = pathway.pValue;
            const score = pathway.normalizedScore || 0;
            const se = pathway.seTE;

            // Skip if no valid SE or p-value.
            if (!se || !pValue || pValue === 0 || pValue === 1) return;
            if (isNaN(se) || !isFinite(se) || se <= 0) return;

            points.push({
                pathwayName: resolveName(pathway.ID),
                pathwayId: pathway.ID,
                score,
                se,
                pValue,
                pValueFDR: pathway.pFDR,
            });
        });
    });

    return points;
}

/**
 * True if the given meta results yield at least one plottable funnel point (i.e. a
 * REML result with a usable standard error). Used to hide funnel tabs for databases
 * that have no plottable data so only databases with a viewable funnel are shown.
 *
 * @param {Array} metaResultsForDb - meta-analysis result docs (already filtered to a database)
 * @returns {boolean}
 */
export function hasFunnelData(metaResultsForDb) {
    return buildFunnelPoints(metaResultsForDb).length > 0;
}

/**
 * Choose the empty-state message to show when no funnel points are plottable for
 * a database's meta results. Distinguishes three cases:
 *   - no results yet                       -> generic "run a meta-analysis first"
 *   - non-REML method (no standard errors) -> "requires REML" hint
 *   - REML ran but produced no usable SE   -> "REML produced no usable SE"
 *
 * Legacy results predate the persisted `method` field; for those the method is
 * inferred from whether any value carries a valid seTE.
 *
 * @param {Array<{method?: string, value?: Array}>} metaResultsForDb - meta-analysis result docs for one database
 * @returns {string} one of the FUNNEL_EMPTY_* messages
 */
export function funnelEmptyStateMessage(metaResultsForDb) {
    if (!Array.isArray(metaResultsForDb) || metaResultsForDb.length === 0) {
        return FUNNEL_EMPTY_GENERIC;
    }

    const methods = metaResultsForDb
        .map((m) => m && m.method)
        .filter((m) => m != null);

    const hasRows = metaResultsForDb.some(
        (m) => Array.isArray(m && m.value) && m.value.length > 0
    );

    if (methods.length > 0) {
        // Method is recorded, so the analysis already ran. If none used REML, the
        // missing standard errors are expected — explain why. If REML ran, an empty
        // plot means it produced no pathway with a usable standard error.
        return methods.includes(SE_METHOD) ? FUNNEL_EMPTY_REML_NO_SE : FUNNEL_EMPTY_REQUIRES_REML;
    }

    // Legacy results (no stored method): infer from the data. No valid seTE
    // anywhere means it was a non-REML run.
    const hasAnySeTE = metaResultsForDb.some(
        (m) =>
            Array.isArray(m && m.value) &&
            m.value.some(
                (p) =>
                    p &&
                    typeof p.seTE === "number" &&
                    isFinite(p.seTE) &&
                    p.seTE > 0
            )
    );
    if (hasRows && !hasAnySeTE) return FUNNEL_EMPTY_REQUIRES_REML;

    return FUNNEL_EMPTY_GENERIC;
}

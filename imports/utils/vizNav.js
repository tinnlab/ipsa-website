// Pure, dependency-free helpers for the Visualization page navigation.
// Lives under imports/utils (NOT imports/**/client/**) so it can be imported on
// both client and server — including the server-side Mocha runner.

/**
 * Resolve which analysis tab the Visualization page should open on.
 *
 * Regular-analysis tabs are keyed by their 1-based position ("1".."5"). When the
 * user navigates here from a specific analysis (e.g. "Visualize Results" on
 * analysis 3), that analysis id is passed via the `?analysisId=` query param and
 * we open the matching tab. With no/unknown id (e.g. Recent Sessions, Mass
 * Analysis), we fall back to the first analysis — the previous default behaviour.
 *
 * @param {{regularAnalyses?: Array<{id: string}>, analysisId?: string|null}} params
 * @returns {{tabKey: string, analysisId: string|undefined}}
 */
export const resolveInitialAnalysisTab = ({regularAnalyses, analysisId} = {}) => {
    const analyses = Array.isArray(regularAnalyses) ? regularAnalyses : [];

    if (analysisId) {
        const index = analyses.findIndex(a => a && a.id === analysisId);
        if (index >= 0) {
            return {tabKey: String(index + 1), analysisId};
        }
    }

    // Fallback: first analysis (tab "1"), or a safe default when there are none.
    return {tabKey: '1', analysisId: analyses[0]?.id};
};

/**
 * Build a per-analysis section anchor id for the Quick Navigation sidebar.
 *
 * Each analysis tab renders the same set of section anchors (summary, forest, …).
 * Ant Design keeps previously-opened tab panes mounted, so a generic id like
 * "summary" would appear multiple times in the DOM and `document.getElementById`
 * would always resolve to the first (hidden) one — breaking navigation for every
 * analysis except the first opened. Suffixing the id with the analysis id keeps
 * each anchor unique so the sidebar targets the active analysis's section.
 *
 * Returns the bare baseId when no analysisId is given (e.g. meta-analysis
 * sections, which are unique already).
 *
 * @param {string} baseId - section base id (e.g. "summary", "forest")
 * @param {string} [analysisId] - owning analysis id
 * @returns {string}
 */
export const sectionAnchorId = (baseId, analysisId) => {
    return analysisId ? `${baseId}-${analysisId}` : baseId;
};

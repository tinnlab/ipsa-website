// Pure, dependency-free helpers for the AI-interpretation insight views.
// Lives under imports/utils so it is importable on both client and server
// (including the server-side Mocha runner).
//
// Covers five small decisions that drive the JSX, so the behavior is unit
// testable without rendering React:
//   - firstPanelKeys:    which Collapse panel is open by default (first one).
//   - insightItemModel:  the normalized fields a shared insight-list item shows.
//                        Deliberately carries NO "publication-ready" flag — the
//                        Completed status tag already conveys that, so the
//                        redundant tag is gone.
//   - resolveViewInsight: where "View insight" sends the user. When the host
//                        passes an onViewInsight callback (AIInterpretation), we
//                        lift to it so the report renders full-width with no
//                        sidebar; otherwise we fall back to the wizard's internal
//                        'viewer' view.
//   - resolveExitWizard: the mirror image — where LEAVING the wizard sends the
//                        user. Same seam, same rule: a host that owns the reports
//                        list takes control back; otherwise the wizard falls back
//                        to its own internal dashboard.
//   - reportHeaderModel: what the open report's persistent header names, so the
//                        header and the list agree on the report's title.

/**
 * Default-open keys for a Collapse: the first panel only (or none when empty).
 * @param {Array<{key: *}>} items Collapse items (each with a `.key`)
 * @returns {Array<*>} `[firstKey]` or `[]`
 */
export function firstPanelKeys(items) {
    const list = items || [];
    return list.length > 0 ? [list[0].key] : [];
}

/**
 * Normalize a batch document into the fields the shared insight-list item shows.
 * Never includes a publication-ready flag (the Completed status tag suffices).
 * @param {object} batch
 * @returns {{id: *, title: string, statusKey: string, createdAt: *}}
 */
export function insightItemModel(batch) {
    const b = batch || {};
    return {
        id: b._id,
        title: b.insightName || 'Untitled report',
        statusKey: b.status || 'completed',
        createdAt: b.createdAt,
    };
}

/**
 * Decide what "View insight" does.
 * @param {*} batchId
 * @param {{onViewInsight?: Function, setView?: Function, setSelectedInsight?: Function}} handlers
 */
export function resolveViewInsight(batchId, { onViewInsight, setView, setSelectedInsight } = {}) {
    if (typeof onViewInsight === 'function') {
        // Lift to the parent: it renders the report full-width without the sidebar.
        onViewInsight(batchId);
        return;
    }
    if (typeof setSelectedInsight === 'function') setSelectedInsight(batchId);
    if (typeof setView === 'function') setView('viewer');
}

/**
 * Decide what leaving the wizard does.
 *
 * The wizard has its own reports list (InsightDashboard) and every exit path used to land there.
 * When a host owns the list — AIInterpretation, which shows the reports of the selected study or
 * analysis — that would be a SECOND, differently-scoped list of the same reports, appearing only
 * after certain actions. So a host that supplies onExitWizard takes control back and the wizard's
 * internal dashboard is never shown; with no callback the fallback is exactly the old behaviour.
 *
 * @param {{onExitWizard?: Function, setView?: Function}} handlers
 */
export function resolveExitWizard({ onExitWizard, setView } = {}) {
    if (typeof onExitWizard === 'function') {
        onExitWizard();
        return;
    }
    if (typeof setView === 'function') setView('dashboard');
}

/**
 * What the open report's persistent header names: the report itself plus the study and analysis it
 * belongs to, so a user with many versions of one analysis can tell which one they are reading.
 *
 * The title reuses insightItemModel, so the header and the list render the SAME string with the
 * same fallback rather than two independently-drifting notions of a report's name. `reportName`
 * takes precedence when the host has a fresher copy than the document the viewer fetched on mount
 * — that is what keeps the header correct across a rename without a reload.
 *
 * Empty segments come back as '' so the caller can drop them from the breadcrumb.
 *
 * @param {{batch?: object, studyName?: string, analysisName?: string, reportName?: string}} input
 * @returns {{reportTitle: string, studyName: string, analysisName: string}}
 */
export function reportHeaderModel({ batch, studyName, analysisName, reportName } = {}) {
    const b = batch || {};
    return {
        reportTitle: reportName || insightItemModel(b).title,
        studyName: studyName || '',
        // The name denormalized onto the batch is the fallback: the host resolves the live name
        // from the study, but the wizard's own viewer path has no study to consult.
        analysisName: analysisName || b.analysisName || '',
    };
}

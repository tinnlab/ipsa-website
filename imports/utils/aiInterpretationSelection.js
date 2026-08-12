// Pure, dependency-free helpers for the AI-interpretation sidebar selection, so the click →
// wizard-preselection behavior can be unit-tested without rendering the antd Tree.
//
// The sidebar tree has two selectable node kinds under each study:
//   - a STUDY node ("big analysis") whose key is the bare session id (no '|'); clicking it
//     opens the interpretation picker scoped to that study's analyses with NOTHING pre-selected,
//     so the user chooses which analysis to interpret.
//   - an ANALYSIS node whose key is `${sessionId}|${analysisId}`; clicking it opens the same
//     picker with that analysis pre-selected automatically.

// Map a selected tree (key, node) to the `selectedAnalysis` descriptor the page tracks.
// A key containing '|' is an analysis; otherwise it is a study (analysisId = null).
// `displayName` (not `analysisName`) because for a study selection it holds the STUDY name — the
// case-neutral name keeps the field honest for both branches.
export function resolveTreeSelection(key, node = {}) {
    if (typeof key !== 'string' || key.length === 0) return null;
    if (key.includes('|')) {
        const [sessionId, analysisId] = key.split('|');
        return { sessionId, analysisId, displayName: node.analysisName };
    }
    return { sessionId: key, analysisId: null, displayName: node.studyName };
}

// The wizard's pre-selection: a single-element array when a specific analysis was clicked, or an
// empty array when a study was clicked (leave the picker open for the user to choose).
export function initialSelectedAnalysesFor(selectedAnalysis) {
    return selectedAnalysis && selectedAnalysis.analysisId ? [selectedAnalysis.analysisId] : [];
}

// Resolve an analysis id to its display name within a study. Regular analyses and meta-analyses
// both live on the Session document (analyses[] and metaAnalyses[]), and both are published to the
// client, so the lookup needs no round-trip and is available the moment the studies load.
// Returns null when the id is not part of this study.
export function analysisNameInStudy(study, analysisId) {
    if (!study || !analysisId) return null;
    const found = (study.analyses || []).find(a => a && a.id === analysisId)
        || (study.metaAnalyses || []).find(a => a && a.id === analysisId);
    return found?.name || null;
}

// Map a query string to the SAME selection the equivalent sidebar click produces, so arriving by
// link and arriving by click land in exactly the same place.
//
// Two producers exist, and they differ in how much they know:
//   - Visualization's "Generate Insight" sends `?sessionId=` alone     -> STUDY selection.
//   - Step5_RunAnalysis's "Interpret" sends `?sessionId=&analysisId=`  -> ANALYSIS selection.
// analysisId used to be ignored outright, so arriving from a just-finished analysis landed on a
// study-level selection even though the link named the analysis.
//
// Returns null when sessionId is missing or names a study that is not loaded, so a stale or
// hand-edited link simply lands on the overview rather than selecting nothing and looking broken.
// An analysisId that does not belong to the study is likewise ignored rather than trusted, falling
// back to the study — such an id matches no reports and no wizard entry, so honouring it would
// produce a convincing-looking view of nothing.
export function resolveDeepLinkSelection(search, studies = []) {
    const params = new URLSearchParams(typeof search === 'string' ? search : '');
    const sessionId = params.get('sessionId');
    if (!sessionId) return null;

    const study = (studies || []).find(s => s && s._id === sessionId);
    if (!study) return null;

    const analysisId = params.get('analysisId');
    const analysisName = analysisNameInStudy(study, analysisId);
    if (analysisName) return { sessionId, analysisId, displayName: analysisName };

    return { sessionId, analysisId: null, displayName: study.name };
}

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

// ---------------------------------------------------------------------------------------------
// The AI-interpretation page's URL, in one place.
//
// `${urlPrefix}/ai-interpretation` is a static route with no path params, so everything the page
// needs to reopen itself travels in the QUERY string:
//
//   ?sessionId=<Session._id>&analysisId=<analysis id>&reportId=<BatchInfo._id>
//
// sessionId/analysisId already existed — Visualization's "Generate Insight" sends the first,
// Step5_RunAnalysis's "Interpret" sends both. reportId is new: it names the open report, so a
// refresh or a pasted link lands back on it instead of on the list. Parsing and building live here
// rather than inline in the pages so the three producers cannot drift apart, and so the format is
// testable without a router.

// Read the ids out of a query string. An absent param and an empty one (`?reportId=`) mean the same
// thing — absent — because a blank id names nothing. All three keys are always present in the
// result so callers can destructure without guards.
export function parseAIInterpretationLink(search) {
    const params = new URLSearchParams(typeof search === 'string' ? search : '');
    const read = (key) => params.get(key) || null;
    return {
        sessionId: read('sessionId'),
        analysisId: read('analysisId'),
        reportId: read('reportId'),
    };
}

// The inverse. Empty/missing ids are omitted rather than written as blanks, and the key order is
// FIXED (sessionId, analysisId, reportId) so a rebuilt link is byte-identical to the hand-written
// ones the producer pages send today — which is what lets them all adopt this builder without
// changing a single URL. Returns '' (not '?') when there is nothing to say, which is what
// `navigate({search})` wants for "the bare page".
export function buildAIInterpretationLink({ sessionId, analysisId, reportId } = {}) {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (analysisId) params.set('analysisId', analysisId);
    if (reportId) params.set('reportId', reportId);
    const query = params.toString();
    return query ? `?${query}` : '';
}

// The part of the URL that names a SELECTION, ignoring which report is open.
//
// This is load-bearing. The page re-applies a deep-linked selection when and only when this key
// changes, so opening or closing a report — which moves reportId alone — cannot reset the sidebar,
// close the wizard, or fight a click the user just made. The previous guard was a once-only
// boolean, which consumed the URL forever and left Back/Forward moving the address bar and nothing
// else.
export function selectionKeyFromSearch(search) {
    const { sessionId, analysisId } = parseAIInterpretationLink(search);
    return `${sessionId || ''}|${analysisId || ''}`;
}

// Resolve ?reportId= against the batch list the page has ALREADY loaded (queue.getUserBatches,
// which the server scopes to the owner). No second round-trip, and no new trust: an id that is not
// in that list is one the server would refuse anyway, so a guessable URL grants nothing on its own.
//
// The answer is three-way rather than a boolean because of the load race. `batches` starts empty,
// and an empty list is indistinguishable from "no such report" — answering "unknown" there would
// flash a false error on every pasted link before the fetch lands. 'pending' says "ask again";
// only a LOADED list can produce 'unknown'.
//
//   {status:'none',    batchId:null}   -> no report named; show the list
//   {status:'pending', batchId}        -> named, list not loaded yet; show a spinner
//   {status:'ok',      batchId, batch} -> open it
//   {status:'unknown', batchId}        -> stale, deleted or foreign; fall back to the list and say so
export function resolveDeepLinkReport(search, batches, batchesLoaded = false) {
    const { reportId } = parseAIInterpretationLink(search);
    if (!reportId) return { status: 'none', batchId: null, batch: null };
    if (!batchesLoaded) return { status: 'pending', batchId: reportId, batch: null };

    const batch = (batches || []).find(b => b && b._id === reportId) || null;
    if (!batch) return { status: 'unknown', batchId: reportId, batch: null };

    return { status: 'ok', batchId: reportId, batch };
}

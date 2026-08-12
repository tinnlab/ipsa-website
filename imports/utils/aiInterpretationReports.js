// Pure, dependency-free helpers for the AI-interpretation REPORTS view — the layer between
// "the user picked something in the sidebar" and "the user asked to generate".
//
// The page shows one hierarchy at every level: selection -> its reports -> (optionally) generate.
// These helpers answer the three questions that drives that middle screen, so the behaviour is
// unit-testable without rendering the antd Tree or the report list:
//
//   - batchesForSelection:   which reports belong to the current selection.
//   - groupBatchesByAnalysis: how they are grouped and labelled.
//   - isReadOnlyStudy:       whether the actions (rename/delete/generate) may be offered at all.
//
// Companion to aiInterpretationSelection.js, which resolves the selection itself and owns the
// analysis-name lookup these helpers reuse.

import { analysisNameInStudy } from './aiInterpretationSelection';

// Newest first. Kept private: every list on the page is ordered this way, and the callers should
// not have to remember to sort.
function byCreatedAtDesc(a, b) {
    return new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);
}

/**
 * The reports in scope for the current sidebar selection.
 *
 * A STUDY selection (analysisId == null) covers the WHOLE study — every analysis and every
 * meta-analysis under it — which is why this keys on sessionId rather than analysisId. The
 * previous per-analysis memo filtered on analysisId alone and so could never serve the study case.
 *
 * An ANALYSIS selection additionally pins sessionId: analysis ids are unique across studies
 * (assertAnalysisIdIsNew enforces it server-side), so this is belt-and-braces rather than a
 * behaviour change, and it keeps a stale batch pointing at a re-used id out of the wrong study.
 *
 * @param {Array<object>} batches   all of the user's batches
 * @param {?{sessionId: string, analysisId: ?string}} selection
 * @returns {Array<object>} matching batches, newest first (a new array; the input is not mutated)
 */
export function batchesForSelection(batches, selection) {
    if (!selection || !selection.sessionId) return [];
    const list = batches || [];

    const matches = selection.analysisId
        ? list.filter(b => b && b.analysisId === selection.analysisId && b.sessionId === selection.sessionId)
        : list.filter(b => b && b.sessionId === selection.sessionId);

    return matches.slice().sort(byCreatedAtDesc);
}

/**
 * Group scoped batches by analysis, so a study's reports read exactly like the overview's
 * study -> analysis nesting instead of one undifferentiated pile. An analysis selection simply
 * yields a single group.
 *
 * Group order follows first appearance in `batches`, which — since the input is already sorted
 * newest-first — puts the most recently used analysis at the top.
 *
 * @param {Array<object>} batches scoped batches (already ordered; order is preserved within groups)
 * @param {?object} study the Session document, used to resolve names
 * @returns {Array<{analysisId: *, analysisName: string, batches: Array<object>}>}
 */
export function groupBatchesByAnalysis(batches, study) {
    const groups = new Map();

    (batches || []).forEach(batch => {
        if (!batch) return;
        const analysisId = batch.analysisId;
        if (!groups.has(analysisId)) {
            groups.set(analysisId, {
                analysisId,
                // The study document is authoritative (it reflects renames); the name denormalized
                // onto the batch at generation time is the fallback for an analysis that has since
                // been deleted, so its reports stay labelled rather than going anonymous.
                analysisName: analysisNameInStudy(study, analysisId) || batch.analysisName || 'Unknown Analysis',
                batches: []
            });
        }
        groups.get(analysisId).batches.push(batch);
    });

    return Array.from(groups.values());
}

/**
 * True when the study is a view-only import. Rename, delete and generate all write to the study
 * and the server refuses them there, so every list must withhold those actions — the same rule
 * InsightDashboard applies via the GlobalSettings provider, read here straight off the Session
 * document because this page shows several studies at once and has no single session context.
 *
 * Defaults to false for a study that is not loaded: the server rejects the write regardless, so
 * hiding the controls is a UX affordance, not the control.
 */
export function isReadOnlyStudy(studies, sessionId) {
    if (!sessionId) return false;
    const study = (studies || []).find(s => s && s._id === sessionId);
    return study?.readOnly === true;
}

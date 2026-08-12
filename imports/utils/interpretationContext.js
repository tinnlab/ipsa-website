/**
 * Shape a report's stored interpretation context into ordered, display-ready rows.
 *
 * The context is what the user entered before generating the report (organism,
 * tissue, disease, etc.). It is persisted on the BatchInfo doc as
 * `interpretationContext = { consolidatedMetadata, contextFields, customContext }`.
 *
 * Pure function (no React / Meteor) so it can be unit-tested directly and reused.
 * Returns an array of `{ label, value }` rows with empty values skipped; returns
 * `[]` when no context was recorded (e.g. reports created before this feature).
 *
 * @param {object} batch - a BatchInfo document.
 * @returns {Array<{label: string, value: string}>}
 */

// Friendly labels for the study_type keys emitted by MetadataTemplateModal.
// Unknown keys fall back to the raw stored value.
const STUDY_TYPE_LABELS = {
    disease: 'Disease-Focused Study',
    experimental: 'Treatment/Exposure Study'
};

export function formatInterpretationContext(batch) {
    const ctx = batch && batch.interpretationContext;
    if (!ctx || typeof ctx !== 'object') return [];

    const rows = [];
    const push = (label, value) => {
        if (value === undefined || value === null) return;
        const str = String(value).trim();
        if (str.length === 0) return;
        rows.push({ label, value: str });
    };

    // Preferred: the consolidated metadata captured by the context modal.
    const meta = ctx.consolidatedMetadata || {};
    push('Organism', meta.organism);
    push('Tissue', meta.tissue);
    push('Disease', meta.disease);
    push('Comparison', meta.comparison);
    push('Experimental Context', meta.experimental_context);
    push('Study Type', meta.study_type && (STUDY_TYPE_LABELS[meta.study_type] || meta.study_type));

    // Fallback: legacy per-analysis context fields, used only when the modal
    // metadata was not provided.
    if (rows.length === 0) {
        const fields = Array.isArray(ctx.contextFields)
            ? (ctx.contextFields[0] || {})
            : (ctx.contextFields || {});
        push('Tissue', fields.tissueType);
        push('Disease', fields.disease);
        push('Condition', fields.condition);
        push('Control', fields.control);
        push('Description', fields.description);
    }

    // Free-text additional context is always appended when present.
    push('Additional Context', ctx.customContext);

    return rows;
}

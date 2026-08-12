// Pure decision logic for the AI-interpretation wizard's two section checkboxes ("Pathways" and
// "DE Genes"), extracted so the three things that must agree — what is SENT to the pipeline, what
// the review step SUMMARISES, and what is STORED on the batch — are all computed once, from one
// function, and cannot drift apart.
//
// They had drifted: pathways were gated on `selectedSections.pathways` at submit while genes were
// pushed unconditionally, so unticking "DE Genes" hid the panel and printed "Pathways only" while
// still shipping the full gene list.
//
// Same extraction pattern (and testability motive) as imports/utils/geneSelection.js and
// imports/utils/aiInterpretationSelection.js: no React, no antd, no Meteor.

// Flatten one section's per-analysis selections, gated on its checkbox. The `Array.isArray` guard
// reproduces the original `if (selected[analysisId])` truthiness check — an analysis the user
// never opened has no entry at all.
const collectSection = (enabled, byAnalysisId, analysisIds) => {
    if (!enabled) return [];
    const collected = [];
    analysisIds.forEach((analysisId) => {
        const rows = byAnalysisId ? byAnalysisId[analysisId] : null;
        if (Array.isArray(rows)) collected.push(...rows);
    });
    return collected;
};

/**
 * Assemble the pathway and gene lists a submission should carry, plus the sections that submission
 * ACTUALLY contains.
 *
 * `sections` is deliberately derived from the assembled lists rather than copied from the
 * checkboxes. A checkbox says what the user asked for; this says what is going out — and those two
 * differ in a case that predates the gating bug: when an analysis has no gene-level data the
 * "DE Genes" card never renders, so `selectedSections.genes` stays at its `true` default and the
 * review step claimed "Pathways and DE Genes" for a report that shipped zero genes.
 */
export function collectSubmissionSelections({
    analysisIds,
    selectedSections,
    selectedPathways,
    selectedGenes
} = {}) {
    const ids = Array.isArray(analysisIds) ? analysisIds : [];
    const sections = selectedSections || {};

    const pathways = collectSection(!!sections.pathways, selectedPathways, ids);
    const genes = collectSection(!!sections.genes, selectedGenes, ids);

    return {
        pathways,
        genes,
        sections: {
            pathways: pathways.length > 0,
            genes: genes.length > 0
        }
    };
}

/**
 * The review step's "Selected Sections" line, read off the effective sections above so it describes
 * the payload rather than the checkboxes.
 */
export function describeSelectedSections(sections = {}) {
    if (sections.pathways && sections.genes) return 'Pathways and DE Genes';
    if (sections.pathways) return 'Pathways only';
    if (sections.genes) return 'DE Genes only';
    return 'None selected';
}

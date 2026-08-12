// How a single-analysis submission fills `pathways[].genes` for the interpretation pipeline.
//
// Two modes, because the answer genuinely differs:
//
//   - DE genes present: keep only the members that are among the SELECTED DE genes, named by the
//     DE rows themselves. This is the long-standing behaviour and is reproduced exactly.
//
//   - DE genes absent (the user unticked "DE Genes", or the analysis has no gene-level data):
//     filtering against an empty set would empty EVERY pathway's gene list. That is not a
//     pathway-only report, it is a report whose pathways lost their membership: the per-theme
//     pathway tables in the delivered report take their gene counts from this list
//     (step06_report_generation.py:515-516), as does the tissue-specificity filter prompt
//     (step01_pathway_themes.py:555-556) — both reached, when the DE list is empty, through the
//     semantic-clustering fallback at pathway_clustering_service.py:302-304, which carries
//     `gene_count` from `pathway['genes']` at :827/:856/:885. So send the full membership, which is
//     also what `PathwayInput.genes` is documented as ("All genes in pathway").
//
//     That membership is NOT taken from the payload. What the wizard sends as `pathway.genes` is
//     whatever `geneSet.getByIds` returned, and that read is not organism-scoped
//     (server/api/methods/geneSet.js:140) while GO/MitoCarta ids are shared across organisms — so
//     for a human analysis it can be another species' gene list entirely. Verified on review data:
//     GO:0032809 exists for 51 organisms, the client's Map kept the RAT one, and its members
//     intersect the analysis's 420 human DE genes 0 times (the organism-scoped list intersects them
//     180 times). The caller therefore supplies membership resolved server-side, organism-scoped,
//     by `getDatasetPathways` — the same route the meta per-dataset payload uses.
//
// Kept pure and out of aiWorkflow.js so the four submission shapes can be asserted directly, the
// way imports/utils/datasetPathways.js does for the meta per-dataset payload.

/**
 * The id a pathway is matched by across the payload and the server-side resolution. `originalId` is
 * the database's own id (e.g. "GO:0032809"); `id` is the wizard's composite "<db>:<originalId>" and
 * is only a fallback, matching what the payload already uses for `pathwayId`.
 */
export function pathwayLookupKey(pathway) {
    const raw = pathway && (pathway.originalId ?? pathway.id);
    return raw === undefined || raw === null ? '' : String(raw);
}

/**
 * Resolve one pathway's gene list to the symbols the pipeline should receive.
 *
 * @param pathway                the pathway as the wizard sent it
 * @param selectedGeneIds        Set of selected DE gene ids; empty selects the pathway-only mode
 * @param geneIdToSymbol         Map of DE gene id -> symbol, from the submission's own DE rows
 * @param membershipByPathwayId  Map of pathway id -> member SYMBOLS, resolved server-side and
 *                               organism-scoped. Used only in pathway-only mode; a pathway missing
 *                               from it gets an empty list rather than a guess.
 */
export function resolvePathwayGenes({
    pathway,
    selectedGeneIds,
    geneIdToSymbol,
    membershipByPathwayId
} = {}) {
    const selected = selectedGeneIds instanceof Set ? selectedGeneIds : new Set();

    if (selected.size === 0) {
        const members = membershipByPathwayId instanceof Map
            ? membershipByPathwayId.get(pathwayLookupKey(pathway))
            : null;
        return Array.isArray(members) ? members.filter(Boolean) : [];
    }

    const members = pathway && Array.isArray(pathway.genes) ? pathway.genes : [];
    return members
        .filter((geneId) => selected.has(String(geneId)))
        .map((geneId) => {
            const key = String(geneId);
            const symbol = geneIdToSymbol ? geneIdToSymbol.get(key) : null;
            return symbol || key; // symbol, or the id — unchanged from the original transform
        })
        .filter(Boolean);
}

/**
 * Index the server-resolved pathways (`getDatasetPathways` output) by pathway id, for the lookup
 * above. Later entries do not overwrite earlier non-empty ones, so a duplicate id from a second
 * database cannot blank a list that was already resolved.
 */
export function indexPathwayMembership(resolvedPathways) {
    const index = new Map();
    (Array.isArray(resolvedPathways) ? resolvedPathways : []).forEach((pathway) => {
        const key = pathway && pathway.pathwayId === undefined ? '' : String(pathway.pathwayId);
        if (key === '') return;
        const genes = Array.isArray(pathway.genes) ? pathway.genes : [];
        const existing = index.get(key);
        if (existing && existing.length > 0 && genes.length === 0) return;
        index.set(key, genes);
    });
    return index;
}

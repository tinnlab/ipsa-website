// AI-interpretation wizard section gating: what a submission carries, what the review step says
// about it, and how a pathway's member list is named in each mode (pure).
import assert from "assert";
import {
    collectSubmissionSelections,
    describeSelectedSections,
} from "../imports/utils/aiSectionGating";
import {
    indexPathwayMembership,
    pathwayLookupKey,
    resolvePathwayGenes,
} from "../imports/utils/aiPathwayGenes";

const ANALYSIS = "an1";
const PATHWAYS = { [ANALYSIS]: [{ id: "kegg:hsa04110", name: "Cell cycle" }] };
const GENES = { [ANALYSIS]: [{ id: "7157", name: "TP53" }, { id: "672", name: "BRCA1" }] };

const submit = (sections, overrides = {}) =>
    collectSubmissionSelections({
        analysisIds: [ANALYSIS],
        selectedSections: sections,
        selectedPathways: PATHWAYS,
        selectedGenes: GENES,
        ...overrides,
    });

describe("ai wizard section gating", function () {
    describe("collectSubmissionSelections", function () {
        it("sends both lists when both sections are ticked", function () {
            const { pathways, genes, sections } = submit({ pathways: true, genes: true });
            assert.strictEqual(pathways.length, 1);
            assert.strictEqual(genes.length, 2);
            assert.deepStrictEqual(sections, { pathways: true, genes: true });
        });

        // The defect: genes were pushed with no gate, so unticking shipped them anyway.
        it("sends NO genes when DE Genes is unticked", function () {
            const { pathways, genes, sections } = submit({ pathways: true, genes: false });
            assert.strictEqual(pathways.length, 1);
            assert.deepStrictEqual(genes, []);
            assert.deepStrictEqual(sections, { pathways: true, genes: false });
        });

        it("sends NO pathways when Pathways is unticked", function () {
            const { pathways, genes, sections } = submit({ pathways: false, genes: true });
            assert.deepStrictEqual(pathways, []);
            assert.strictEqual(genes.length, 2);
            assert.deepStrictEqual(sections, { pathways: false, genes: true });
        });

        // Gating happens at submit only: the caller's selection state is never mutated, so
        // re-ticking the box restores exactly what the user had chosen.
        it("does not mutate the caller's selection state", function () {
            const selectedGenes = { [ANALYSIS]: [{ id: "7157", name: "TP53" }] };
            submit({ pathways: true, genes: false }, { selectedGenes });
            assert.deepStrictEqual(selectedGenes[ANALYSIS], [{ id: "7157", name: "TP53" }]);
        });

        // The pre-existing second lie: with no gene-level data the DE Genes card never renders, so
        // the flag keeps its `true` default. The sections must describe the payload, not the flag.
        it("reports genes as absent when the analysis has no gene data", function () {
            const { genes, sections } = collectSubmissionSelections({
                analysisIds: [ANALYSIS],
                selectedSections: { pathways: true, genes: true },
                selectedPathways: PATHWAYS,
                selectedGenes: {},
            });
            assert.deepStrictEqual(genes, []);
            assert.deepStrictEqual(sections, { pathways: true, genes: false });
        });

        it("flattens every selected analysis, skipping ones with no entry", function () {
            const { pathways } = collectSubmissionSelections({
                analysisIds: ["a", "b", "c"],
                selectedSections: { pathways: true, genes: false },
                selectedPathways: { a: [{ id: 1 }], c: [{ id: 2 }, { id: 3 }] },
                selectedGenes: {},
            });
            assert.deepStrictEqual(pathways.map(p => p.id), [1, 2, 3]);
        });

        it("tolerates missing arguments", function () {
            assert.deepStrictEqual(collectSubmissionSelections(), {
                pathways: [],
                genes: [],
                sections: { pathways: false, genes: false },
            });
        });
    });

    describe("describeSelectedSections", function () {
        it("names each combination", function () {
            const d = describeSelectedSections;
            assert.strictEqual(d({ pathways: true, genes: true }), "Pathways and DE Genes");
            assert.strictEqual(d({ pathways: true, genes: false }), "Pathways only");
            assert.strictEqual(d({ pathways: false, genes: true }), "DE Genes only");
            assert.strictEqual(d({ pathways: false, genes: false }), "None selected");
            assert.strictEqual(d(), "None selected");
        });

        it("says 'Pathways only' for an analysis with no gene data", function () {
            const { sections } = collectSubmissionSelections({
                analysisIds: [ANALYSIS],
                selectedSections: { pathways: true, genes: true },
                selectedPathways: PATHWAYS,
                selectedGenes: {},
            });
            assert.strictEqual(describeSelectedSections(sections), "Pathways only");
        });
    });
});

describe("ai pathway gene resolution", function () {
    // What the wizard sends: Entrez member ids (the symbol map behind /api/mappedGeneIds is empty
    // by design), and — for a GO/MitoCarta id — potentially another species' list entirely.
    const PATHWAY = { originalId: "GO:0032809", id: "db1:GO:0032809", genes: ["7157", "1017", "672"] };
    const geneIdToSymbol = new Map([["7157", "TP53"], ["672", "BRCA1"]]);
    // What the server resolves for the analysis's OWN organism, keyed by pathway id.
    const membershipByPathwayId = new Map([["GO:0032809", ["TP53", "CDK2", "BRCA1"]]]);

    describe("with DE genes selected (unchanged behaviour)", function () {
        const selectedGeneIds = new Set(["7157", "672"]);

        it("keeps only selected DE members and names them from the DE rows", function () {
            const symbols = resolvePathwayGenes({
                pathway: PATHWAY,
                selectedGeneIds,
                geneIdToSymbol,
                membershipByPathwayId,
            });
            assert.deepStrictEqual(symbols, ["TP53", "BRCA1"]);
        });

        it("falls back to the id when the DE row carries no symbol", function () {
            const symbols = resolvePathwayGenes({
                pathway: { originalId: "p", genes: [7157] },
                selectedGeneIds,
                geneIdToSymbol: new Map(),
            });
            assert.deepStrictEqual(symbols, ["7157"]);
        });

        it("returns an empty list for a pathway with no selected members", function () {
            const symbols = resolvePathwayGenes({
                pathway: { originalId: "p", genes: ["1017"] },
                selectedGeneIds,
                geneIdToSymbol,
            });
            assert.deepStrictEqual(symbols, []);
        });
    });

    describe("with no DE genes (pathway-only)", function () {
        it("sends the server-resolved membership rather than emptying the pathway", function () {
            const symbols = resolvePathwayGenes({
                pathway: PATHWAY,
                selectedGeneIds: new Set(),
                geneIdToSymbol: new Map(),
                membershipByPathwayId,
            });
            assert.deepStrictEqual(symbols, ["TP53", "CDK2", "BRCA1"]);
        });

        // The payload's own member list is not organism-scoped, so it must not be the source here.
        it("ignores the payload's member list entirely", function () {
            const symbols = resolvePathwayGenes({
                pathway: { originalId: "GO:0032809", genes: ["999", "998", "997"] },
                selectedGeneIds: new Set(),
                membershipByPathwayId,
            });
            assert.deepStrictEqual(symbols, ["TP53", "CDK2", "BRCA1"]);
        });

        it("yields an empty list for a pathway the server could not resolve", function () {
            const symbols = resolvePathwayGenes({
                pathway: { originalId: "GO:9999999", genes: ["7157"] },
                selectedGeneIds: new Set(),
                membershipByPathwayId,
            });
            assert.deepStrictEqual(symbols, []);
        });

        it("matches on the composite id when there is no originalId", function () {
            const symbols = resolvePathwayGenes({
                pathway: { id: "GO:0032809" },
                selectedGeneIds: new Set(),
                membershipByPathwayId,
            });
            assert.deepStrictEqual(symbols, ["TP53", "CDK2", "BRCA1"]);
        });

        it("yields an empty list when no membership was resolved at all", function () {
            const symbols = resolvePathwayGenes({
                pathway: PATHWAY,
                selectedGeneIds: new Set(),
                membershipByPathwayId: new Map(),
            });
            assert.deepStrictEqual(symbols, []);
        });
    });

    describe("pathwayLookupKey", function () {
        it("prefers originalId, falls back to id, and is empty for neither", function () {
            assert.strictEqual(pathwayLookupKey({ originalId: "a", id: "db:a" }), "a");
            assert.strictEqual(pathwayLookupKey({ id: "db:a" }), "db:a");
            assert.strictEqual(pathwayLookupKey({}), "");
            assert.strictEqual(pathwayLookupKey(undefined), "");
        });
    });

    describe("indexPathwayMembership", function () {
        it("indexes getDatasetPathways output by pathway id", function () {
            const index = indexPathwayMembership([
                { pathwayId: "GO:1", genes: ["A", "B"] },
                { pathwayId: "GO:2", genes: [] },
            ]);
            assert.deepStrictEqual(index.get("GO:1"), ["A", "B"]);
            assert.deepStrictEqual(index.get("GO:2"), []);
        });

        // The same id can appear for two databases in one analysis; a later empty list must not
        // blank a membership that was already resolved.
        it("does not let a later empty list overwrite a resolved one", function () {
            const index = indexPathwayMembership([
                { pathwayId: "GO:1", genes: ["A"] },
                { pathwayId: "GO:1", genes: [] },
            ]);
            assert.deepStrictEqual(index.get("GO:1"), ["A"]);
        });

        it("tolerates a missing list", function () {
            assert.strictEqual(indexPathwayMembership(undefined).size, 0);
        });
    });
});

// datasets[].pathways mapping for the meta / mass-analysis interpretation payload (pure).
//
// Regression context: getDatasetPathways read the pathway name and gene list off the result rows
// themselves (`row.name || row.pathway || row.ID`, `row.genes || []`). Those fallbacks only fit the
// CONSENSUS row shape; what a per-method run stores is what ora.js / fgsea.js persist — four
// columns, no `name` and no `genes`. So for every standard database the name shipped as the raw id
// ("path:hsa03010" printed in real comparative reports) and the gene list was always empty. Both
// type-check against the pipeline's PathwayInput model, so nothing rejected them.
import assert from "assert";
import {
    indexGeneSets,
    indexGeneSymbols,
    mapDatasetPathways,
    readPathwayFDR,
    readPathwayId,
    selectSignificantPathwayIds,
} from "../imports/utils/datasetPathways";

// Real row shapes observed in the database (analysisResults.value), mass analysis
// jEbBJJkNkfRqACxyG against KEGG human.
const FGSEA_NS = {
    pathway: "path:hsa00010",
    pValue: 0.6348230603090215,
    pValueFDR: 0.875777505060994,
    score: -0.9079303773015736,
    _row: "path:hsa00010",
};

const FGSEA_SIG = {
    pathway: "path:hsa03010",
    pValue: 0.0000012,
    pValueFDR: 0.0001,
    score: -1.8321,
    _row: "path:hsa03010",
};

// Consensus / meta rows carry their own name (and, for the meta level, normalizedScore).
const CONSENSUS_SIG = {
    ID: "path:hsa04110",
    name: "Cell cycle",
    genes: ["TP53", "MDM2"],
    pValue: 0.00001,
    pValueFDR: 0.001,
    score: 1.4,
    normalizedScore: 2.1,
};

// ORA rows whose FDR arrives as `pFDR`.
const ORA_PFDR = {
    pathway: "path:hsa04151",
    pValue: 0.0001,
    pFDR: 0.01,
    score: 3,
};

// GeneSet documents, scoped to one (database, organism) by the caller. `genes` are bare Entrez ids
// for every gene-set builder in this codebase.
const GENE_SET_DOCS = [
    {id: "path:hsa03010", name: "Ribosome", genes: ["6122", "6124"]},
    {id: "path:hsa04110", name: "Cell cycle", genes: ["7157"]},
    {id: "path:hsa04151", name: "PI3K-Akt signaling pathway", genes: ["6122", "6122", "9999"]},
];

const GENE_INFO_DOCS = [
    {_id: "6122", taxId: "9606", symbol: "RPL3"},
    {_id: "6124", taxId: "9606", symbol: "RPL4"},
    {_id: "7157", taxId: "9606", symbol: "TP53"},
];

const CUSTOM_MAP = {
    "Hypoxia core": {
        name: "Hypoxia core response",
        genes: ["HIF1A", "VEGFA"],
        customGeneSetName: "Upload 1",
    },
};

const gsIndex = () => indexGeneSets(GENE_SET_DOCS);
const symIndex = () => indexGeneSymbols(GENE_INFO_DOCS);

// The default call shape: everything resolvable, mirroring what the Mongo layer passes.
const mapAll = (rows, overrides = {}) => mapDatasetPathways({
    rows,
    source: "KEGG",
    geneSetIndex: gsIndex(),
    symbolIndex: symIndex(),
    resolvableIds: new Set(selectSignificantPathwayIds(rows)),
    ...overrides,
});

describe("dataset pathways → interpretation payload", function () {
    describe("standard databases (the defect)", function () {
        it("resolves a real name and real gene symbols for a per-method fgsea row", function () {
            const {pathways, unnamed, symbolless} = mapAll([FGSEA_SIG]);

            assert.strictEqual(pathways.length, 1);
            assert.strictEqual(pathways[0].name, "Ribosome");
            assert.deepStrictEqual(pathways[0].genes, ["RPL3", "RPL4"]);
            assert.strictEqual(pathways[0].source, "KEGG");
            assert.strictEqual(unnamed, 0);
            assert.strictEqual(symbolless, 0);
        });

        it("never emits the raw database id as the name when the gene set is known", function () {
            const {pathways} = mapAll([FGSEA_SIG]);
            assert.ok(!/^path:/.test(pathways[0].name), "name must not be a raw pathway id");
        });

        it("dedupes repeated member ids", function () {
            // path:hsa04151 lists 6122 twice.
            const {pathways} = mapAll([ORA_PFDR]);
            assert.deepStrictEqual(pathways[0].genes, ["RPL3"]);
        });
    });

    describe("consensus rows", function () {
        it("keeps the row's own name and genes", function () {
            const {pathways} = mapAll([CONSENSUS_SIG]);
            assert.strictEqual(pathways[0].name, "Cell cycle");
            assert.deepStrictEqual(pathways[0].genes, ["TP53", "MDM2"]);
        });

        it("fills genes from the index when the row carries none", function () {
            const row = {ID: "path:hsa04110", name: "Cell cycle", pValue: 0.00001, pValueFDR: 0.001};
            const {pathways} = mapAll([row]);
            assert.deepStrictEqual(pathways[0].genes, ["TP53"]);
        });
    });

    describe("custom gene sets", function () {
        it("passes GMT symbols through without consulting the Entrez symbol index", function () {
            const row = {pathway: "Hypoxia core", pValue: 0.001, pValueFDR: 0.002, score: 1.1};
            const {pathways, symbolless} = mapDatasetPathways({
                rows: [row],
                source: "Upload 1",
                // An empty symbol index: routing GMT symbols through it would drop them all.
                geneSetIndex: new Map(),
                symbolIndex: new Map(),
                customPathways: CUSTOM_MAP,
                resolvableIds: new Set(["Hypoxia core"]),
            });

            assert.strictEqual(pathways[0].name, "Hypoxia core response");
            assert.deepStrictEqual(pathways[0].genes, ["HIF1A", "VEGFA"]);
            assert.strictEqual(symbolless, 0);
        });
    });

    describe("hard invariants", function () {
        it("keeps pathwayId byte-identical to the row's id for every shape", function () {
            const rows = [FGSEA_NS, FGSEA_SIG, CONSENSUS_SIG, ORA_PFDR];
            const {pathways} = mapAll(rows);
            assert.deepStrictEqual(
                pathways.map(p => p.pathwayId),
                ["path:hsa00010", "path:hsa03010", "path:hsa04110", "path:hsa04151"]
            );
        });

        it("emits exactly one row per input row, in order — nothing is filtered here", function () {
            const rows = [FGSEA_NS, FGSEA_SIG, CONSENSUS_SIG, ORA_PFDR];
            const {pathways, total} = mapAll(rows);
            assert.strictEqual(pathways.length, rows.length);
            assert.strictEqual(total, rows.length);
        });

        it("forwards ES and NES exactly as before", function () {
            const {pathways} = mapAll([FGSEA_SIG, CONSENSUS_SIG, {pathway: "x"}]);
            // fgsea: score is the NES, so both fields carry it.
            assert.strictEqual(pathways[0].ES, -1.8321);
            assert.strictEqual(pathways[0].NES, -1.8321);
            // meta: NES prefers normalizedScore.
            assert.strictEqual(pathways[1].ES, 1.4);
            assert.strictEqual(pathways[1].NES, 2.1);
            // absent score falls back to 0.
            assert.strictEqual(pathways[2].ES, 0);
            assert.strictEqual(pathways[2].NES, 0);
        });

        it("honours the pFDR fallback and defaults missing p-values to 1", function () {
            const {pathways} = mapAll([ORA_PFDR, {pathway: "path:hsa00010"}]);
            assert.strictEqual(pathways[0].pValueFDR, 0.01);
            assert.strictEqual(pathways[0].pValue, 0.0001);
            assert.strictEqual(pathways[1].pValueFDR, 1);
            assert.strictEqual(pathways[1].pValue, 1);
        });

        it("does not mutate the input rows", function () {
            const row = {...FGSEA_SIG};
            mapAll([row]);
            assert.deepStrictEqual(row, FGSEA_SIG);
        });
    });

    describe("unresolvable names are counted, never disguised", function () {
        it("keeps the id as the name and counts it", function () {
            const orphan = {pathway: "path:hsa99999", pValue: 0.001, pValueFDR: 0.002, score: 1};
            const {pathways, unnamed, unnamedIds, sampleKeys} = mapAll([orphan]);

            assert.strictEqual(pathways[0].name, "path:hsa99999");
            assert.strictEqual(pathways[0].pathwayId, "path:hsa99999");
            assert.strictEqual(unnamed, 1);
            assert.deepStrictEqual(unnamedIds, ["path:hsa99999"]);
            assert.ok(sampleKeys.includes("pathway"), "row keys are reported so the log names the shape");
        });

        it("never collapses an identifiable pathway onto 'Unknown Pathway'", function () {
            const orphan = {pathway: "path:hsa99999", pValueFDR: 0.002};
            const {pathways} = mapAll([orphan]);
            assert.notStrictEqual(pathways[0].name, "Unknown Pathway");
            assert.notStrictEqual(pathways[0].name, "");
        });

        it("does not raise a false alarm for a row we never tried to resolve", function () {
            // FGSEA_NS has FDR 0.87, so it is not in resolvableIds and is dropped by the caller.
            const {unnamed} = mapAll([FGSEA_NS]);
            assert.strictEqual(unnamed, 0);
        });

        it("still emits a string name for a row carrying no id at all", function () {
            // Would otherwise be null, which fails the pipeline's PathwayInput and rejects the
            // whole submission rather than one row.
            const {pathways, unnamed} = mapDatasetPathways({
                rows: [{pValue: 0.01, pValueFDR: 0.02}],
                source: "KEGG",
            });
            assert.strictEqual(pathways[0].name, "Unknown Pathway");
            assert.strictEqual(pathways[0].pathwayId, "Unknown Pathway");
            assert.strictEqual(unnamed, 1);
        });
    });

    describe("unresolvable symbols are dropped, never emitted as ids", function () {
        it("drops the member and counts it", function () {
            // path:hsa04151 lists 9999, which has no GeneInfo document.
            const {pathways, symbolless, symbollessIds} = mapAll([ORA_PFDR]);

            assert.deepStrictEqual(pathways[0].genes, ["RPL3"]);
            assert.strictEqual(symbolless, 1);
            assert.deepStrictEqual(symbollessIds, ["9999"]);
        });

        it("never returns a numeric Entrez id as a gene symbol", function () {
            const {pathways} = mapDatasetPathways({
                rows: [FGSEA_SIG, ORA_PFDR],
                source: "KEGG",
                geneSetIndex: gsIndex(),
                symbolIndex: new Map(), // GeneInfo unavailable
                resolvableIds: new Set(["path:hsa03010", "path:hsa04151"]),
            });

            pathways.forEach(p => {
                assert.deepStrictEqual(p.genes, []);
                assert.ok(!p.genes.some(g => /^\d+$/.test(g)));
            });
        });

        it("counts an empty gene set definition apart from a symbol failure", function () {
            const {symbolless, emptyMembership} = mapDatasetPathways({
                rows: [FGSEA_SIG],
                source: "KEGG",
                geneSetIndex: indexGeneSets([{id: "path:hsa03010", name: "Ribosome", genes: []}]),
                symbolIndex: symIndex(),
                resolvableIds: new Set(["path:hsa03010"]),
            });
            assert.strictEqual(symbolless, 0);
            assert.strictEqual(emptyMembership, 1);
        });
    });

    describe("readers and the query-narrowing drift guard", function () {
        it("reads ids and FDRs the same way the emitter does", function () {
            assert.strictEqual(readPathwayId(FGSEA_SIG), "path:hsa03010");
            assert.strictEqual(readPathwayId(CONSENSUS_SIG), "path:hsa04110");
            assert.strictEqual(readPathwayFDR(ORA_PFDR), 0.01);
            assert.strictEqual(readPathwayFDR({}), 1);
        });

        it("selects exactly the ids below the 0.05 threshold, deduped", function () {
            const rows = [
                {pathway: "a", pValueFDR: 0.049},
                {pathway: "b", pValueFDR: 0.05},
                {pathway: "c"},
                {pathway: "a", pValueFDR: 0.01},
            ];
            assert.deepStrictEqual(selectSignificantPathwayIds(rows), ["a"]);
        });

        it("never leaves a pathway the caller keeps unresolved", function () {
            // The load-bearing guarantee behind narrowing the GeneSet query: the set of ids we look
            // up must equal the set of ids that survive the caller's filter.
            const rows = [FGSEA_NS, FGSEA_SIG, CONSENSUS_SIG, ORA_PFDR];
            const selected = new Set(selectSignificantPathwayIds(rows));
            const kept = new Set(
                mapAll(rows).pathways.filter(p => p.pValueFDR < 0.05).map(p => p.pathwayId)
            );
            assert.deepStrictEqual(Array.from(selected).sort(), Array.from(kept).sort());
        });
    });

    describe("absent data", function () {
        [undefined, null, [], "not an array"].forEach((input) => {
            it(`degrades to an empty result for ${JSON.stringify(input)}`, function () {
                const result = mapDatasetPathways({rows: input, source: "KEGG"});
                assert.deepStrictEqual(result.pathways, []);
                assert.strictEqual(result.total, 0);
                assert.strictEqual(result.unnamed, 0);
                assert.strictEqual(result.symbolless, 0);
            });
        });

        it("indexers tolerate junk input", function () {
            assert.strictEqual(indexGeneSets(undefined).size, 0);
            assert.strictEqual(indexGeneSymbols(null).size, 0);
            assert.strictEqual(indexGeneSymbols([{_id: "1", symbol: "  "}]).size, 0);
        });

        it("mapDatasetPathways is callable with no arguments at all", function () {
            assert.deepStrictEqual(mapDatasetPathways().pathways, []);
        });
    });
});

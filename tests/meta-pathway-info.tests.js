// Meta-analysis pathway resolution: custom gene sets, and the silent drop.
//
// Regression context. The AI-interpretation wizard's meta branch resolved every pathway's name and
// genes with `geneSet.getByIds` — `GeneSet.find({id: {$in: ids}})`. A custom gene set is NEVER in
// `GeneSet`; it is a `SessionConfig` row (plus an `AnalysisConfigSnapshot` copy). Every row of a
// custom database therefore missed the lookup, and `if (pathwayInfo)` discarded it silently.
//
// The reported symptom was "149 pathways uploaded, 145 shown". That was a coincidence: the upload
// was MitoPathways and a built-in MitoCarta import existed whose pathway ids ARE its pathway names,
// so 145 of the 149 names collided with it. Measured in cpa-review-mongo: MitoCarta
// (iQgACWTCwvkvfSBSh) holds 146 pathways per organism; `Tetrahydrobiopterin synthesis` is in the
// import but the GMT misspells it `Tetrahydobiopterin`; `OXA`, `Vitamin B1 metabolism` and
// `mtDNA modifications` are absent from the import entirely. That is exactly the four.
//
// The case that actually matters is the one nobody hit by luck: a bespoke signature list whose
// names match no built-in database at all resolved NOTHING, and the table rendered empty.

import assert from "assert";
import {
    indexCustomGeneSets,
    resolveDatabaseName,
    buildMetaPathwayRows,
    findReportMetaAnalysis,
} from "/imports/utils/metaPathwayInfo";

// The SessionConfig.value shape written by `session.add.custom.geneSets` (analysis.js): `value.id`
// doubles as SessionConfig._id AND as the databaseId on the AnalysisResult rows. Per pathway,
// `genes` is what the user uploaded (symbols) and `mappedGenes` is the Entrez form minted for the
// R runners.
const CUSTOM_VALUE = {
    id: "DhkjxqznPtwcnxYY5",
    name: "MitoPathways3.0",
    isCustom: true,
    isEnabled: true,
    taxId: "9606",
    geneSets: [
        {id: "OXA", name: "OXA", genes: ["OXA1L", "COX18"], mappedGenes: ["5018", "285489"]},
        {
            id: "Tetrahydobiopterin synthesis",
            name: "Tetrahydobiopterin synthesis",
            genes: ["GCH1", "PTS"],
            mappedGenes: ["2643", "5805"],
        },
        {id: "mtDNA modifications", name: "mtDNA modifications", genes: ["TFAM"], mappedGenes: ["7019"]},
    ],
};

// Real meta row shape: AnalysisResult{inputType:'meta'}.value, observed on analysis
// RKDbsh2hqjDBBHYSs against MitoCarta. No `name`, no `genes` — hence the lookup.
const metaRow = (ID, extra = {}) => ({
    ID,
    pValue: 0.000003645,
    pFDR: 0.0001,
    score: -2.3042,
    normalizedScore: -2.3042,
    ...extra,
});

describe("meta-analysis pathway info", function () {
    describe("a custom gene set matching no built-in database", function () {
        // THE case the original code turned into an empty table with no error.
        it("renders every one of its pathways, not zero", function () {
            const bespoke = {
                id: "customSignature1",
                name: "My signature list",
                geneSets: [
                    {id: "SIG_A", name: "Signature A", genes: ["AAA"]},
                    {id: "SIG_B", name: "Signature B", genes: ["BBB"]},
                    {id: "SIG_C", name: "Signature C", genes: ["CCC"]},
                ],
            };
            const index = indexCustomGeneSets([bespoke]);
            const rows = ["SIG_A", "SIG_B", "SIG_C"].map((id) => metaRow(id));

            const {pathways, unresolved} = buildMetaPathwayRows({
                rows,
                databaseName: "My signature list",
                // An empty built-in index: this is what geneSet.getByIds returns for a bespoke list.
                customPathways: index.get("customSignature1").pathways,
                builtInPathways: new Map(),
            });

            assert.strictEqual(pathways.length, 3);
            assert.strictEqual(unresolved, 0);
            assert.deepStrictEqual(
                pathways.map((p) => p.name),
                ["Signature A", "Signature B", "Signature C"]
            );
        });
    });

    describe("the reported 145-of-149 case", function () {
        it("keeps the rows a built-in import happens not to contain", function () {
            const index = indexCustomGeneSets([CUSTOM_VALUE]);
            // A built-in index standing in for MitoCarta: it has the correctly-spelled name and
            // knows nothing of OXA or mtDNA modifications.
            const builtIn = new Map([
                ["Tetrahydrobiopterin synthesis", {name: "Tetrahydrobiopterin synthesis", genes: []}],
            ]);
            const rows = [
                metaRow("OXA"),
                metaRow("Tetrahydobiopterin synthesis"),
                metaRow("mtDNA modifications"),
            ];

            const {pathways, unresolved} = buildMetaPathwayRows({
                rows,
                databaseName: "MitoPathways3.0",
                customPathways: index.get("DhkjxqznPtwcnxYY5").pathways,
                builtInPathways: builtIn,
            });

            assert.strictEqual(pathways.length, 3);
            assert.strictEqual(unresolved, 0);
            assert.deepStrictEqual(
                pathways.map((p) => p.name),
                ["OXA", "Tetrahydobiopterin synthesis", "mtDNA modifications"]
            );
        });

        it("never falls back to a built-in pathway that merely shares a name", function () {
            // The accidental name-matching that made this look like "4 missing" rather than "the
            // wrong collection". A custom database must resolve only from its own gene set.
            const index = indexCustomGeneSets([CUSTOM_VALUE]);
            const builtIn = new Map([["OXA", {name: "Some other OXA", genes: ["WRONG"]}]]);

            const {pathways} = buildMetaPathwayRows({
                rows: [metaRow("OXA")],
                databaseName: "MitoPathways3.0",
                customPathways: index.get("DhkjxqznPtwcnxYY5").pathways,
                builtInPathways: builtIn,
            });

            assert.strictEqual(pathways[0].name, "OXA");
            assert.deepStrictEqual(pathways[0].genes, ["OXA1L", "COX18"]);
        });
    });

    describe("genes", function () {
        it("uses the uploaded symbols, never the Entrez mappedGenes", function () {
            const index = indexCustomGeneSets([CUSTOM_VALUE]);
            const {pathways} = buildMetaPathwayRows({
                rows: [metaRow("Tetrahydobiopterin synthesis")],
                databaseName: "MitoPathways3.0",
                customPathways: index.get("DhkjxqznPtwcnxYY5").pathways,
            });

            // The symbols as uploaded. `mappedGenes` (["2643","5805"]) would be Entrez ids, which
            // the consumer keys on symbols and so would match nothing while looking valid.
            assert.deepStrictEqual(pathways[0].genes, ["GCH1", "PTS"]);
        });

        it("does not route custom symbols through an Entrez symbol map", function () {
            // The wizard's geneIdToSymbolMap is empty in production (issue #172). Routing GMT
            // symbols through it would drop every gene. The custom branch never consults it.
            const index = indexCustomGeneSets([CUSTOM_VALUE]);
            const {pathways} = buildMetaPathwayRows({
                rows: [metaRow("OXA")],
                databaseName: "MitoPathways3.0",
                customPathways: index.get("DhkjxqznPtwcnxYY5").pathways,
                builtInPathways: new Map(),
            });

            assert.deepStrictEqual(pathways[0].genes, ["OXA1L", "COX18"]);
        });

        it("emits an empty list, never undefined, when nothing resolves", function () {
            const {pathways} = buildMetaPathwayRows({
                rows: [metaRow("nowhere")],
                databaseName: "KEGG",
                builtInPathways: new Map(),
            });
            assert.deepStrictEqual(pathways[0].genes, []);
        });
    });

    describe("the silent drop", function () {
        it("keeps an unresolvable row, naming it with its id, and counts it", function () {
            const {pathways, unresolved, unresolvedIds} = buildMetaPathwayRows({
                rows: [metaRow("path:hsa04110"), metaRow("path:hsa00010")],
                databaseName: "KEGG",
                builtInPathways: new Map([
                    ["path:hsa04110", {name: "Cell cycle", genes: ["CDK1"]}],
                ]),
            });

            // ONE ROW OUT PER ROW IN. The dropped row carried a correct p-value and FDR, and its
            // originalId is the pipeline's cross-dataset matching key.
            assert.strictEqual(pathways.length, 2);
            assert.strictEqual(pathways[0].name, "Cell cycle");
            assert.strictEqual(pathways[1].name, "path:hsa00010");
            assert.strictEqual(unresolved, 1);
            assert.deepStrictEqual(unresolvedIds, ["path:hsa00010"]);
        });

        it("preserves the statistics of a row it could not name", function () {
            const {pathways} = buildMetaPathwayRows({
                rows: [metaRow("unknown", {pValue: 0.004, pFDR: 0.02, score: 1.5, normalizedScore: 1.7})],
                databaseName: "KEGG",
                builtInPathways: new Map(),
            });

            assert.strictEqual(pathways[0].pValue, 0.004);
            assert.strictEqual(pathways[0].pValueFDR, 0.02);
            assert.strictEqual(pathways[0].score, 1.5);
            assert.strictEqual(pathways[0].normalizedScore, 1.7);
            assert.strictEqual(pathways[0].originalId, "unknown");
        });

        it("counts a blank name as unresolved rather than emitting an empty label", function () {
            const {pathways, unresolved} = buildMetaPathwayRows({
                rows: [metaRow("path:hsa00010")],
                databaseName: "KEGG",
                builtInPathways: new Map([["path:hsa00010", {name: "   ", genes: []}]]),
            });
            assert.strictEqual(pathways[0].name, "path:hsa00010");
            assert.strictEqual(unresolved, 1);
        });

        it("emits a string name for a row carrying no id at all", function () {
            const {pathways, unresolved, unresolvedIds} = buildMetaPathwayRows({
                rows: [metaRow(undefined)],
                databaseName: "KEGG",
                builtInPathways: new Map(),
            });
            // Never null: the pipeline's PathwayInput model requires a string here.
            assert.strictEqual(pathways[0].name, "Unknown Pathway");
            assert.strictEqual(unresolved, 1);
            assert.deepStrictEqual(unresolvedIds, ["<no id>"]);
        });

        it("samples at most ten ids while counting them all", function () {
            const rows = Array.from({length: 25}, (_, n) => metaRow(`missing:${n}`));
            const {unresolved, unresolvedIds} = buildMetaPathwayRows({
                rows,
                databaseName: "KEGG",
                builtInPathways: new Map(),
            });
            assert.strictEqual(unresolved, 25);
            assert.strictEqual(unresolvedIds.length, 10);
        });
    });

    describe("built-in databases are unchanged", function () {
        it("resolves names and genes exactly as before", function () {
            const {pathways, unresolved} = buildMetaPathwayRows({
                rows: [metaRow("path:hsa04110")],
                databaseName: "KEGG",
                builtInPathways: new Map([
                    ["path:hsa04110", {name: "Cell cycle", genes: ["CDK1", "CCNB1"]}],
                ]),
            });

            assert.strictEqual(unresolved, 0);
            assert.deepStrictEqual(pathways[0], {
                id: "KEGG:path:hsa04110",
                originalId: "path:hsa04110",
                name: "Cell cycle",
                pValue: 0.000003645,
                pValueFDR: 0.0001,
                score: -2.3042,
                normalizedScore: -2.3042,
                database: "KEGG",
                genes: ["CDK1", "CCNB1"],
            });
        });
    });

    describe("database display name", function () {
        it("uses the custom gene set's name, not its Random.id", function () {
            const index = indexCustomGeneSets([CUSTOM_VALUE]);
            assert.strictEqual(
                resolveDatabaseName("DhkjxqznPtwcnxYY5", {}, index.get("DhkjxqznPtwcnxYY5")),
                "MitoPathways3.0"
            );
        });

        it("leaves a built-in database's name alone", function () {
            assert.strictEqual(
                resolveDatabaseName("2GwfEq5Xu7T5MqgZG", {"2GwfEq5Xu7T5MqgZG": "KEGG"}, undefined),
                "KEGG"
            );
        });

        it("still falls back to the id when nothing knows the database", function () {
            assert.strictEqual(resolveDatabaseName("unknownDb", {}, undefined), "unknownDb");
        });
    });

    describe("indexCustomGeneSets", function () {
        it("keys on value.id, the same identity used as the databaseId", function () {
            const index = indexCustomGeneSets([CUSTOM_VALUE]);
            assert.deepStrictEqual([...index.keys()], ["DhkjxqznPtwcnxYY5"]);
            assert.strictEqual(index.get("DhkjxqznPtwcnxYY5").pathways.size, 3);
        });

        it("merges the live row with its snapshot copy instead of overwriting", function () {
            // Both sources carry the same value.id: SessionConfig (live, current name) and
            // AnalysisConfigSnapshot (frozen at analysis.start). The caller passes live first.
            const renamed = {...CUSTOM_VALUE, name: "MitoPathways (renamed)"};
            const stale = {...CUSTOM_VALUE, name: "MitoPathways3.0"};
            const index = indexCustomGeneSets([renamed, stale]);

            assert.strictEqual(index.size, 1);
            assert.strictEqual(index.get("DhkjxqznPtwcnxYY5").name, "MitoPathways (renamed)");
            assert.strictEqual(index.get("DhkjxqznPtwcnxYY5").pathways.size, 3);
        });

        it("recovers a name from the snapshot when the live row has lost it", function () {
            const index = indexCustomGeneSets([
                {...CUSTOM_VALUE, name: "  "},
                {...CUSTOM_VALUE, name: "MitoPathways3.0"},
            ]);
            assert.strictEqual(index.get("DhkjxqznPtwcnxYY5").name, "MitoPathways3.0");
        });

        it("skips rows with no usable id rather than indexing them under a coerced key", function () {
            const index = indexCustomGeneSets([
                {id: undefined, name: "no id", geneSets: []},
                {id: "  ", name: "blank id", geneSets: []},
                CUSTOM_VALUE,
            ]);
            assert.deepStrictEqual([...index.keys()], ["DhkjxqznPtwcnxYY5"]);
        });

        it("tolerates a gene set with no geneSets array", function () {
            const index = indexCustomGeneSets([{id: "empty", name: "Empty"}]);
            assert.strictEqual(index.get("empty").pathways.size, 0);
        });
    });

    describe("absent data", function () {
        [undefined, null, [], "not an array", {}].forEach((value) => {
            it(`indexCustomGeneSets degrades to an empty index for ${JSON.stringify(value)}`, function () {
                assert.strictEqual(indexCustomGeneSets(value).size, 0);
            });
        });

        it("buildMetaPathwayRows is callable with no arguments at all", function () {
            assert.deepStrictEqual(buildMetaPathwayRows(), {
                pathways: [],
                unresolved: 0,
                unresolvedIds: [],
            });
        });

        it("ignores a non-object row instead of throwing", function () {
            const {pathways} = buildMetaPathwayRows({
                rows: [null, "junk", metaRow("path:hsa04110")],
                databaseName: "KEGG",
                builtInPathways: new Map(),
            });
            assert.strictEqual(pathways.length, 1);
        });

        it("treats a non-Map lookup as empty rather than throwing", function () {
            const {pathways, unresolved} = buildMetaPathwayRows({
                rows: [metaRow("x")],
                databaseName: "KEGG",
                builtInPathways: {x: {name: "plain object, not a Map"}},
            });
            assert.strictEqual(pathways.length, 1);
            assert.strictEqual(unresolved, 1);
        });
    });

    // The report viewer's Consensus Results modal decides between the single-analysis and the meta
    // loader with this. A meta report stores the META id as BatchInfo.analysisId, which
    // getConfigurations' analyses[] never contains; treating it as single-analysis threw on
    // `analysis.input` and left the modal's Pathways card empty.
    describe("findReportMetaAnalysis", function () {
        const analyses = [{id: "a1", input: "pgsea"}, {id: "a2", input: "pgsea"}];
        const metaAnalyses = [{id: "m1", pathwayLevel: {method: "stouffer", status: "completed"}}];

        it("returns the meta entry for a meta report id", function () {
            assert.strictEqual(findReportMetaAnalysis("m1", analyses, metaAnalyses), metaAnalyses[0]);
        });

        it("returns null for an ordinary analysis id, even if a meta shares nothing with it", function () {
            assert.strictEqual(findReportMetaAnalysis("a1", analyses, metaAnalyses), null);
        });

        it("prefers the ordinary analysis when an id is in both lists", function () {
            assert.strictEqual(findReportMetaAnalysis("a2", analyses, [{id: "a2"}]), null);
        });

        it("returns null for an unknown id or missing lists", function () {
            assert.strictEqual(findReportMetaAnalysis("zz", analyses, metaAnalyses), null);
            assert.strictEqual(findReportMetaAnalysis("m1", undefined, undefined), null);
            assert.strictEqual(findReportMetaAnalysis(undefined, analyses, metaAnalyses), null);
            assert.strictEqual(findReportMetaAnalysis("m1", null, [null, {id: "m1"}]).id, "m1");
        });
    });
});

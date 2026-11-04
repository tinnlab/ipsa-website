import assert from "assert";
import {buildGeneLevelData} from "../imports/utils/metaAnalysisGeneLevel";
import {
    defaultPathwayCombination,
    geneLevelCapability,
    META_GENE_LEVEL_NO_STATS_REASON,
    META_GENE_LEVEL_TOO_FEW_REASON,
    META_PATHWAY_LEVEL_TOO_FEW_REASON,
    metaPathwayCombinationShortfallReason,
    pathwayCombinationCount,
    pathwayCombinationCounts,
    pathwayLevelCapability,
} from "../imports/utils/metaAnalysisLevels";

// The Meta-analysis builder locks each level's checkbox to these verdicts.

const row = (analysisId, key) => ({analysisId, key, value: [{ID: "p1"}]});

describe("geneLevelCapability (meta-analysis gene-level lock)", function () {
    const cfg = (analysisId, inputType, hasGeneResults) => ({analysisId, inputType, hasGeneResults, name: analysisId});

    it("is available with two analyses that have gene-level statistics", function () {
        const {initialSelectedItems} = buildGeneLevelData(
            {a: cfg("a", "expression", true), b: cfg("b", "pgsea", true)}, {});
        assert.deepStrictEqual(geneLevelCapability(initialSelectedItems), {available: true, count: 2, reason: null});
    });

    it("is unavailable for an ORA-only study, naming the missing statistics", function () {
        const {initialSelectedItems} = buildGeneLevelData({a: cfg("a", "ora"), b: cfg("b", "ora")}, {});
        const cap = geneLevelCapability(initialSelectedItems);
        assert.strictEqual(cap.available, false);
        assert.strictEqual(cap.reason, META_GENE_LEVEL_NO_STATS_REASON);
    });

    it("is unavailable for single-metric PGSEA uploads, which have no gene-level rows", function () {
        const {initialSelectedItems} = buildGeneLevelData(
            {a: cfg("a", "pgsea", false), b: cfg("b", "pgsea", false)}, {});
        assert.strictEqual(geneLevelCapability(initialSelectedItems).reason, META_GENE_LEVEL_NO_STATS_REASON);
    });

    it("is unavailable with only ONE eligible analysis, which the old auto-uncheck let through", function () {
        const {initialSelectedItems} = buildGeneLevelData(
            {a: cfg("a", "expression", true), b: cfg("b", "pgsea", false), c: cfg("c", "ora")}, {});
        const cap = geneLevelCapability(initialSelectedItems);
        assert.strictEqual(cap.available, false);
        assert.strictEqual(cap.count, 1);
        assert.strictEqual(cap.reason, META_GENE_LEVEL_TOO_FEW_REASON);
    });

    it("counts distinct ids and tolerates missing input", function () {
        assert.strictEqual(geneLevelCapability(["a", "a"]).available, false);
        assert.strictEqual(geneLevelCapability(undefined).reason, META_GENE_LEVEL_NO_STATS_REASON);
        assert.strictEqual(geneLevelCapability([null, "", "a"]).count, 1);
    });
});

describe("pathwayLevelCapability (meta-analysis pathway-level lock)", function () {
    it("is available when two analyses share a database and method", function () {
        const cap = pathwayLevelCapability({kegg: [row("a", "ora"), row("b", "ora")]});
        assert.deepStrictEqual(cap, {available: true, reason: null});
    });

    it("is available for an ORA-only study: ORA has pathway results even without gene statistics", function () {
        assert.strictEqual(pathwayLevelCapability({kegg: [row("a", "ora"), row("b", "ora"), row("c", "ora")]}).available, true);
    });

    it("is unavailable when no single pair has two analyses, even with two analyses overall", function () {
        const cap = pathwayLevelCapability({kegg: [row("a", "ora")], reactome: [row("b", "ora")], go: [row("a", "fgsea")]});
        assert.strictEqual(cap.available, false);
        assert.strictEqual(cap.reason, META_PATHWAY_LEVEL_TOO_FEW_REASON);
    });

    it("does not count one analysis twice for the same pair", function () {
        assert.strictEqual(pathwayLevelCapability({kegg: [row("a", "ora"), row("a", "ora")]}).available, false);
    });

    it("is unavailable for no results, and tolerates malformed rows", function () {
        assert.strictEqual(pathwayLevelCapability({}).available, false);
        assert.strictEqual(pathwayLevelCapability(undefined).available, false);
        assert.strictEqual(pathwayLevelCapability({kegg: null, go: [null, {key: "ora"}, {analysisId: "a"}]}).available, false);
    });
});

describe("pathwayCombinationCounts / pathwayCombinationCount", function () {
    it("counts distinct analyses per database and method", function () {
        const counts = pathwayCombinationCounts({
            kegg: [row("a", "ora"), row("b", "ora"), row("a", "fgsea"), row("b", "ora")],
            go: [row("c", "fgsea")],
        });
        assert.deepStrictEqual(counts, {kegg: {ora: 2, fgsea: 1}, go: {fgsea: 1}});
    });

    it("returns 0 for an absent pair", function () {
        assert.strictEqual(pathwayCombinationCount({kegg: [row("a", "ora")]}, "go", "ora"), 0);
        assert.strictEqual(pathwayCombinationCount({kegg: [row("a", "ora")]}, "kegg", "ora"), 1);
    });
});

describe("defaultPathwayCombination", function () {
    it("keeps the first database and method when that pair is runnable (today's default)", function () {
        assert.deepStrictEqual(
            defaultPathwayCombination({kegg: [row("a", "ora"), row("b", "ora")], go: [row("a", "ora"), row("b", "ora")]}),
            {database: "kegg", method: "ora"});
    });

    it("skips a first pair that only one analysis has", function () {
        assert.deepStrictEqual(
            defaultPathwayCombination({kegg: [row("a", "ora")], go: [row("a", "ora"), row("b", "ora")]}),
            {database: "go", method: "ora"});
        assert.deepStrictEqual(
            defaultPathwayCombination({kegg: [row("a", "ora"), row("a", "fgsea"), row("b", "fgsea")]}),
            {database: "kegg", method: "fgsea"});
    });

    it("falls back to the first database and first method when nothing is runnable", function () {
        assert.deepStrictEqual(
            defaultPathwayCombination({kegg: [row("a", "ora")], go: [row("b", "fgsea")]}),
            {database: "kegg", method: "ora"});
        assert.deepStrictEqual(defaultPathwayCombination({}), {database: "", method: ""});
    });
});

describe("metaPathwayCombinationShortfallReason", function () {
    it("names the method and database, and distinguishes none from one", function () {
        const none = metaPathwayCombinationShortfallReason(0, "KEGG", "fgsea");
        const one = metaPathwayCombinationShortfallReason(1, "KEGG", "fgsea");
        assert.match(none, /^No analysis has FGSEA results for KEGG/);
        assert.match(one, /^Only one analysis has FGSEA results for KEGG/);
        assert.match(one, /Choose another database or enrichment method/);
    });
});

import assert from "assert";
import {
    classifyGene,
    parseGeneQuery,
    matchGenesToSelection,
    selectSignificantGeneIds,
    selectTopSignificantGeneIds,
} from "../imports/utils/volcanoGeneSelect";

const thresholds = {maxAdjustedPValue: 0.05, minLogFoldChange: 1.0};

// Fixture mirrors the plot's row shape { id, name, FC, pValue }.
const genes = [
    {id: "7157", name: "TP53", FC: 2.0, pValue: 0.001},   // up (most significant)
    {id: "1956", name: "EGFR", FC: 1.5, pValue: 0.02},    // up
    {id: "4609", name: "MYC", FC: -1.8, pValue: 0.01},    // down
    {id: "3845", name: "KRAS", FC: -3.0, pValue: 0.04},   // down
    {id: "999", name: "NSP", FC: 3.0, pValue: 0.5},       // non-sig (p too high)
    {id: "888", name: "NSFC", FC: 0.2, pValue: 0.001},    // non-sig (|FC| too low)
];

describe("volcanoGeneSelect.classifyGene", function () {
    it("classifies up / down / non-significant with the inclusive plot predicate", function () {
        assert.strictEqual(classifyGene(genes[0], thresholds), "up");
        assert.strictEqual(classifyGene(genes[2], thresholds), "down");
        assert.strictEqual(classifyGene(genes[4], thresholds), "nonsig"); // fails p
        assert.strictEqual(classifyGene(genes[5], thresholds), "nonsig"); // fails FC
    });

    it("is inclusive at the exact threshold boundary", function () {
        assert.strictEqual(classifyGene({FC: 1.0, pValue: 0.05}, thresholds), "up");
        assert.strictEqual(classifyGene({FC: -1.0, pValue: 0.05}, thresholds), "down");
    });

    it("treats missing / non-finite values as non-significant", function () {
        assert.strictEqual(classifyGene({FC: NaN, pValue: 0.01}, thresholds), "nonsig");
        assert.strictEqual(classifyGene({FC: 2, pValue: undefined}, thresholds), "nonsig");
        assert.strictEqual(classifyGene(null, thresholds), "nonsig");
    });

    it("normalizes string thresholds (antd Inputs) and classifies identically", function () {
        const strThr = {maxAdjustedPValue: "0.05", minLogFoldChange: "1.0"};
        assert.strictEqual(classifyGene(genes[0], strThr), "up");
        assert.strictEqual(classifyGene(genes[2], strThr), "down");
        assert.strictEqual(classifyGene(genes[4], strThr), "nonsig");
    });

    it("classifies everything non-significant with empty/default thresholds", function () {
        // Number(undefined) === NaN => all comparisons false => nonsig.
        assert.strictEqual(classifyGene(genes[0], {}), "nonsig");
    });
});

describe("volcanoGeneSelect.parseGeneQuery", function () {
    it("splits on commas, semicolons, and any whitespace", function () {
        assert.deepStrictEqual(parseGeneQuery("TP53, EGFR;MYC\nKRAS\tFOS"),
            ["TP53", "EGFR", "MYC", "KRAS", "FOS"]);
    });

    it("trims, drops empties, and de-duplicates case-insensitively (first-seen casing wins)", function () {
        assert.deepStrictEqual(parseGeneQuery("  TP53 ,, tp53 , EGFR ,TP53"),
            ["TP53", "EGFR"]);
    });

    it("returns [] for empty / non-string input", function () {
        assert.deepStrictEqual(parseGeneQuery(""), []);
        assert.deepStrictEqual(parseGeneQuery(null), []);
        assert.deepStrictEqual(parseGeneQuery(undefined), []);
    });

    it("ignores leading / trailing / delimiter-only content", function () {
        assert.deepStrictEqual(parseGeneQuery("TP53,"), ["TP53"]);
        assert.deepStrictEqual(parseGeneQuery(",TP53;"), ["TP53"]);
        assert.deepStrictEqual(parseGeneQuery(" , ; "), []);
    });
});

describe("volcanoGeneSelect.matchGenesToSelection", function () {
    it("matches by display symbol, case-insensitively", function () {
        const {matchedIds, unmatched} = matchGenesToSelection(["tp53", "Egfr"], genes);
        assert.deepStrictEqual(matchedIds, ["7157", "1956"]);
        assert.deepStrictEqual(unmatched, []);
    });

    it("matches by raw id", function () {
        const {matchedIds, unmatched} = matchGenesToSelection(["4609", "3845"], genes);
        assert.deepStrictEqual(matchedIds, ["4609", "3845"]);
        assert.deepStrictEqual(unmatched, []);
    });

    it("reports tokens that match nothing", function () {
        const {matchedIds, unmatched} = matchGenesToSelection(["TP53", "NOTAGENE", "zzz"], genes);
        assert.deepStrictEqual(matchedIds, ["7157"]);
        assert.deepStrictEqual(unmatched, ["NOTAGENE", "zzz"]);
    });

    it("de-duplicates when a symbol and id refer to the same gene", function () {
        const {matchedIds} = matchGenesToSelection(["TP53", "7157"], genes);
        assert.deepStrictEqual(matchedIds, ["7157"]);
    });

    it("gives ids precedence over a colliding symbol (two-pass indexing)", function () {
        // Gene A's symbol equals gene B's id -> the token resolves to gene B (by id).
        const rows = [
            {id: "500", name: "X", FC: 1, pValue: 0.01},   // symbol "X"
            {id: "X", name: "FOO", FC: 1, pValue: 0.01},   // id "X"
        ];
        assert.deepStrictEqual(matchGenesToSelection(["X"], rows).matchedIds, ["X"]);
    });

    it("returns raw ids, including numeric ids, and skips null id/name rows", function () {
        const rows = [
            {id: 7157, name: "TP53", FC: 2, pValue: 0.01},
            {id: null, name: "ORPHAN", FC: 1, pValue: 0.01},
            {id: "12", name: null, FC: 1, pValue: 0.01},
        ];
        assert.deepStrictEqual(matchGenesToSelection(["tp53"], rows).matchedIds, [7157]);
        assert.deepStrictEqual(matchGenesToSelection(["ORPHAN"], rows).unmatched, ["ORPHAN"]);
        assert.deepStrictEqual(matchGenesToSelection(["12"], rows).matchedIds, ["12"]);
    });

    it("handles empty tokens and empty data", function () {
        assert.deepStrictEqual(matchGenesToSelection([], genes), {matchedIds: [], unmatched: []});
        assert.deepStrictEqual(matchGenesToSelection(null, genes), {matchedIds: [], unmatched: []});
        assert.deepStrictEqual(matchGenesToSelection(["TP53"], []), {matchedIds: [], unmatched: ["TP53"]});
    });
});

describe("volcanoGeneSelect preset selectors", function () {
    it("selectSignificantGeneIds returns all up / down / both", function () {
        assert.deepStrictEqual(selectSignificantGeneIds(genes, thresholds, "up"), ["7157", "1956"]);
        assert.deepStrictEqual(selectSignificantGeneIds(genes, thresholds, "down"), ["4609", "3845"]);
        assert.deepStrictEqual(
            selectSignificantGeneIds(genes, thresholds, "both").sort(),
            ["1956", "3845", "4609", "7157"]
        );
    });

    it("selectTopSignificantGeneIds ranks by smallest p-value and caps at topN", function () {
        // significant p-values: TP53 0.001, MYC 0.01, EGFR 0.02, KRAS 0.04
        assert.deepStrictEqual(selectTopSignificantGeneIds(genes, thresholds, 2, "both"),
            ["7157", "4609"]);
    });

    it("selectTopSignificantGeneIds honours direction", function () {
        assert.deepStrictEqual(selectTopSignificantGeneIds(genes, thresholds, 1, "down"),
            ["4609"]);
    });

    it("returns [] for a non-positive / invalid topN", function () {
        assert.deepStrictEqual(selectTopSignificantGeneIds(genes, thresholds, 0, "both"), []);
        assert.deepStrictEqual(selectTopSignificantGeneIds(genes, thresholds, "x", "both"), []);
    });
});

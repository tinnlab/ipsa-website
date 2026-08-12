import assert from "assert";
import {
    comparePathways,
    selectPathways,
    DEFAULT_SORT,
    SELECTION_MODES,
    PATHWAY_COLUMNS,
    SIGNIFICANCE_FDR_THRESHOLD,
} from "../imports/utils/pathwaySelection";

// Fixture where pValue, pValueFDR and |score| orderings all disagree, so each
// test actually distinguishes which metric drove the ranking.
//   id   pValue   pValueFDR   score
//   a    0.001    0.040       +1.0
//   b    0.010    0.010      -9.0
//   c    0.050    0.200       +3.0
//   d    0.002    0.010       +0.5   (FDR tie with b; smaller |score|)
const makeFixture = () => [
    { id: "a", name: "Alpha", pValue: 0.001, pValueFDR: 0.040, score: 1.0 },
    { id: "b", name: "Bravo", pValue: 0.010, pValueFDR: 0.010, score: -9.0 },
    { id: "c", name: "Charlie", pValue: 0.050, pValueFDR: 0.200, score: 3.0 },
    { id: "d", name: "Delta", pValue: 0.002, pValueFDR: 0.010, score: 0.5 },
];

const ids = (rows) => rows.map((r) => r.id);

describe("pathwaySelection", function () {
    describe("selectPathways - top N by column", function () {
        it("ranks top-N by pValue ascending (the new default)", function () {
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 2);
            assert.deepStrictEqual(ids(top), ["a", "d"]); // 0.001, 0.002
        });

        it("ranks top-N by pValueFDR ascending (the previous default behavior)", function () {
            // FDR order: b & d tie at 0.010 -> tie-break |score| desc -> b(9) before d(0.5); then a(0.040).
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE_FDR, "ascend", SELECTION_MODES.TOP, 3);
            assert.deepStrictEqual(ids(top), ["b", "d", "a"]);
        });

        it("differs between pValue and pValueFDR when the columns disagree", function () {
            const byP = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 1);
            const byFdr = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE_FDR, "ascend", SELECTION_MODES.TOP, 1);
            assert.deepStrictEqual(ids(byP), ["a"]);
            assert.deepStrictEqual(ids(byFdr), ["b"]);
        });

        it("ranks top by score descending using |score| (most enriched magnitude first)", function () {
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.SCORE, "descend", SELECTION_MODES.TOP, 2);
            // |score|: b 9, c 3, a 1, d 0.5  -> negative -9 outranks positive +3
            assert.deepStrictEqual(ids(top), ["b", "c"]);
        });

        it("ranks top by score ascending = smallest magnitude first", function () {
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.SCORE, "ascend", SELECTION_MODES.TOP, 2);
            assert.deepStrictEqual(ids(top), ["d", "a"]); // 0.5, 1.0
        });

        it("ranks top by name alphabetically (ascending)", function () {
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.NAME, "ascend", SELECTION_MODES.TOP, 2);
            assert.deepStrictEqual(ids(top), ["a", "b"]); // Alpha, Bravo
        });

        it("the default sort (DEFAULT_SORT) selects by pValue and differs from the old FDR default", function () {
            const fx = makeFixture();
            const byDefault = selectPathways(fx, DEFAULT_SORT.columnKey, DEFAULT_SORT.order, SELECTION_MODES.TOP, 2);
            const byPValue = selectPathways(fx, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 2);
            const byOldFdr = selectPathways(fx, PATHWAY_COLUMNS.P_VALUE_FDR, "ascend", SELECTION_MODES.TOP, 2);
            assert.deepStrictEqual(ids(byDefault), ids(byPValue)); // new default == pValue
            assert.deepStrictEqual(ids(byDefault), ["a", "d"]);
            assert.notDeepStrictEqual(ids(byDefault), ids(byOldFdr)); // behavior change is real
        });
    });

    describe("tie-breaks and order direction", function () {
        it("breaks an FDR tie by larger |score| first", function () {
            const rows = [
                { id: "x", pValueFDR: 0.01, score: 2 },
                { id: "y", pValueFDR: 0.01, score: -8 },
            ];
            const top = selectPathways(rows, PATHWAY_COLUMNS.P_VALUE_FDR, "ascend", SELECTION_MODES.ALL);
            assert.deepStrictEqual(ids(top), ["y", "x"]);
        });

        it("breaks a |score| tie by smaller pValueFDR first", function () {
            const rows = [
                { id: "hi", score: 5, pValueFDR: 0.20 },
                { id: "lo", score: -5, pValueFDR: 0.01 }, // same |score|, smaller FDR
            ];
            const top = selectPathways(rows, PATHWAY_COLUMNS.SCORE, "ascend", SELECTION_MODES.ALL);
            assert.deepStrictEqual(ids(top), ["lo", "hi"]);
        });

        it("descending reverses the ranking (negated comparator, matching AntD)", function () {
            const asc = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.ALL);
            const desc = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "descend", SELECTION_MODES.ALL);
            assert.deepStrictEqual(ids(desc), ids(asc).reverse());
        });
    });

    describe("selection modes", function () {
        it("allSignificant filters by FDR but ORDERS by the chosen sort column", function () {
            const sig = selectPathways(makeFixture(), PATHWAY_COLUMNS.SCORE, "descend", SELECTION_MODES.ALL_SIGNIFICANT);
            assert.ok(sig.every((p) => p.pValueFDR < SIGNIFICANCE_FDR_THRESHOLD));
            // a(0.040), b(0.010), d(0.010) qualify; c(0.200) does not.
            // Ordered by |score| descending: b(9), a(1), d(0.5).
            assert.deepStrictEqual(ids(sig), ["b", "a", "d"]);
        });

        it("all returns every pathway in ranked order, none dropped", function () {
            const all = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.ALL);
            assert.strictEqual(all.length, 4);
            // pValue ascending: a(.001), d(.002), b(.010), c(.050)
            assert.deepStrictEqual(ids(all), ["a", "d", "b", "c"]);
        });
    });

    describe("top-N edge cases", function () {
        it("n greater than length returns all rows", function () {
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 999);
            assert.strictEqual(top.length, 4);
        });

        it("n of 0, NaN, or undefined returns an empty array without throwing", function () {
            const fx = makeFixture();
            assert.deepStrictEqual(selectPathways(fx, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 0), []);
            assert.deepStrictEqual(selectPathways(fx, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, "abc"), []);
            assert.deepStrictEqual(selectPathways(fx, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, undefined), []);
        });

        it("accepts a numeric string for n (as the UI passes it)", function () {
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, "2");
            assert.deepStrictEqual(ids(top), ["a", "d"]);
        });
    });

    describe("robustness", function () {
        it("does not mutate the input array", function () {
            const fx = makeFixture();
            const before = ids(fx);
            selectPathways(fx, PATHWAY_COLUMNS.SCORE, "descend", SELECTION_MODES.TOP, 2);
            assert.deepStrictEqual(ids(fx), before);
        });

        it("returns [] for empty and null inputs", function () {
            assert.deepStrictEqual(selectPathways([], PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 5), []);
            assert.deepStrictEqual(selectPathways(null, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 5), []);
        });

        it("sorts rows with missing/NaN values to the end on ascending", function () {
            const rows = [
                { id: "good1", pValue: 0.01, score: 1 },
                { id: "missing", score: 1 }, // no pValue
                { id: "good2", pValue: 0.02, score: 1 },
                { id: "nan", pValue: NaN, score: 1 },
            ];
            const top = selectPathways(rows, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.ALL);
            assert.deepStrictEqual(ids(top).slice(0, 2), ["good1", "good2"]);
            assert.deepStrictEqual(ids(top).slice(2).sort(), ["missing", "nan"]);
        });

        it("keeps missing/NaN values LAST even on descending (no top-N pollution)", function () {
            const rows = [
                { id: "good1", pValue: 0.01, score: 1 },
                { id: "missing", score: 1 }, // no pValue
                { id: "good2", pValue: 0.02, score: 1 },
            ];
            const top = selectPathways(rows, PATHWAY_COLUMNS.P_VALUE, "descend", SELECTION_MODES.ALL);
            // descend ranks good2 before good1, and the missing row must stay last.
            assert.deepStrictEqual(ids(top), ["good2", "good1", "missing"]);
            // The headline case: top-1 of a descending sort is a real row, not the missing one.
            const top1 = selectPathways(rows, PATHWAY_COLUMNS.P_VALUE, "descend", SELECTION_MODES.TOP, 1);
            assert.deepStrictEqual(ids(top1), ["good2"]);
        });
    });

    describe("constants and comparator", function () {
        it("DEFAULT_SORT is pValue ascending", function () {
            assert.deepStrictEqual(DEFAULT_SORT, { columnKey: PATHWAY_COLUMNS.P_VALUE, order: "ascend" });
        });

        it("comparePathways falls back to the default column for an unknown key", function () {
            const fallback = selectPathways(makeFixture(), "totally-unknown", "ascend", SELECTION_MODES.ALL);
            const byDefault = selectPathways(makeFixture(), DEFAULT_SORT.columnKey, "ascend", SELECTION_MODES.ALL);
            assert.deepStrictEqual(ids(fallback), ids(byDefault));
        });

        it("comparePathways returns a usable ascending comparator for each column", function () {
            const pv = comparePathways(PATHWAY_COLUMNS.P_VALUE);
            assert.ok(pv({ pValue: 0.001, score: 0 }, { pValue: 0.01, score: 0 }) < 0);

            const fdr = comparePathways(PATHWAY_COLUMNS.P_VALUE_FDR);
            assert.ok(fdr({ pValueFDR: 0.01, score: 0 }, { pValueFDR: 0.2, score: 0 }) < 0);

            const score = comparePathways(PATHWAY_COLUMNS.SCORE);
            // ascending = smaller |score| first, so the smaller-magnitude row compares less.
            assert.ok(score({ score: 1, pValueFDR: 0 }, { score: -9, pValueFDR: 0 }) < 0);

            const name = comparePathways(PATHWAY_COLUMNS.NAME);
            assert.ok(name({ name: "Alpha" }, { name: "Beta" }) < 0);
        });
    });
});

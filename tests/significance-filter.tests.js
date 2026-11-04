import assert from "assert";
import { passesSignificance } from "../imports/utils/significanceFilter";

// passesSignificance backs the pathway Venn diagram and the multi-analysis forest plot:
// "FDR <= x and |Score| >= y", where a 0 threshold turns that half of the filter off.
describe("significanceFilter", function () {
    describe("passesSignificance", function () {
        it("is inclusive at both boundaries", function () {
            assert.strictEqual(passesSignificance({ pValueFDR: 0.05, score: 1.5 }, { fdr: 0.05, score: 1.5 }), true);
            assert.strictEqual(passesSignificance({ pValueFDR: 0.05, score: -1.5 }, { fdr: 0.05, score: 1.5 }), true);
        });

        it("rejects a row just past either threshold", function () {
            assert.strictEqual(passesSignificance({ pValueFDR: 0.0501, score: 9 }, { fdr: 0.05, score: 1.5 }), false);
            assert.strictEqual(passesSignificance({ pValueFDR: 0.001, score: 1.49 }, { fdr: 0.05, score: 1.5 }), false);
        });

        it("compares |score|, so a strongly negative score passes", function () {
            assert.strictEqual(passesSignificance({ pValueFDR: 0.01, score: -9 }, { fdr: 0.05, score: 1 }), true);
        });

        it("treats an FDR threshold of 0 as 'filter off'", function () {
            assert.strictEqual(passesSignificance({ pValueFDR: 0.9, score: 2 }, { fdr: 0, score: 1 }), true);
            // The score half still applies.
            assert.strictEqual(passesSignificance({ pValueFDR: 0.9, score: 0.5 }, { fdr: 0, score: 1 }), false);
        });

        it("treats a score threshold of 0 as 'filter off'", function () {
            assert.strictEqual(passesSignificance({ pValueFDR: 0.01, score: 0 }, { fdr: 0.05, score: 0 }), true);
            assert.strictEqual(passesSignificance({ pValueFDR: 0.01 }, { fdr: 0.05, score: 0 }), true);
            // The FDR half still applies.
            assert.strictEqual(passesSignificance({ pValueFDR: 0.2, score: 5 }, { fdr: 0.05, score: 0 }), false);
        });

        it("FDR 1.0 keeps a row with FDR exactly 1 (the forest plot's 'show all')", function () {
            assert.strictEqual(passesSignificance({ pValueFDR: 1, score: 0.1 }, { fdr: 1, score: 0 }), true);
        });

        it("rejects a row with missing statistics under a real filter", function () {
            assert.strictEqual(passesSignificance({ score: 9 }, { fdr: 0.05, score: 1 }), false);
            assert.strictEqual(passesSignificance({ pValueFDR: 0.01 }, { fdr: 0.05, score: 1 }), false);
            assert.strictEqual(passesSignificance(null, { fdr: 0, score: 0 }), false);
        });

        it("reads custom field names", function () {
            const row = { pFDR: 0.01, nes: -2 };
            assert.strictEqual(passesSignificance(row, { fdr: 0.05, score: 2, fdrKey: "pFDR", scoreKey: "nes" }), true);
        });
    });
});

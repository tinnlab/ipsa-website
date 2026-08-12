import assert from "assert";
import {
    shouldAutoRunDE,
    extractErrorMessage,
    countDeGenes,
} from "../imports/utils/deAnalysisUtils";
import { VALIDATION_MAX_TOKENS } from "../server/llm/validators/dataValidator";

describe("DE wizard helpers (deAnalysisUtils)", function () {
    describe("shouldAutoRunDE", function () {
        it("is true for expression input with no volcano data yet", function () {
            assert.strictEqual(shouldAutoRunDE({ inputType: "expression" }), true);
            assert.strictEqual(shouldAutoRunDE({ inputType: "expression", volcanoPlotData: [] }), true);
            assert.strictEqual(shouldAutoRunDE({ inputType: "expression", volcanoPlotData: null }), true);
        });

        it("is false for expression input once volcano data exists", function () {
            assert.strictEqual(
                shouldAutoRunDE({ inputType: "expression", volcanoPlotData: [{ FC: 1, pValue: 0.01 }] }),
                false
            );
        });

        it("is false for non-expression input types", function () {
            assert.strictEqual(shouldAutoRunDE({ inputType: "ora" }), false);
            assert.strictEqual(shouldAutoRunDE({ inputType: "pgsea", volcanoPlotData: [] }), false);
            assert.strictEqual(shouldAutoRunDE({}), false);
        });
    });

    describe("extractErrorMessage", function () {
        it("prefers a Meteor error's .reason", function () {
            assert.strictEqual(
                extractErrorMessage({ reason: "No gene statistics found", message: "[analysis.start.error]" }),
                "No gene statistics found"
            );
        });

        it("falls back to .message when there is no .reason", function () {
            assert.strictEqual(extractErrorMessage(new Error("boom")), "boom");
        });

        it("falls back to a generic default for empty/missing errors", function () {
            assert.strictEqual(extractErrorMessage(null), "Failed to start analysis");
            assert.strictEqual(extractErrorMessage({}), "Failed to start analysis");
        });
    });

    describe("countDeGenes", function () {
        const thresholds = { maxAdjustedPValue: 0.05, minLogFoldChange: 1.0 };
        const data = [
            { name: "UP", FC: 2.0, pValue: 0.01 },   // significant up
            { name: "DOWN", FC: -1.5, pValue: 0.02 },  // significant down
            { name: "NS_P", FC: 3.0, pValue: 0.5 },    // fails p-value
            { name: "NS_FC", FC: 0.2, pValue: 0.001 }, // fails fold-change
        ];

        it("counts genes passing both thresholds (up and down regulated)", function () {
            assert.strictEqual(countDeGenes(data, thresholds), 2);
        });

        it("returns 0 for empty / undefined input", function () {
            assert.strictEqual(countDeGenes([], thresholds), 0);
            assert.strictEqual(countDeGenes(undefined, thresholds), 0);
            assert.strictEqual(countDeGenes(null, thresholds), 0);
        });
    });

    describe("VALIDATION_MAX_TOKENS (Fix 5 regression)", function () {
        it("stays well under the model context so it never triggers the HTTP 400", function () {
            // Must leave room for the prompt under the ~131072 gpt-oss context.
            assert.ok(VALIDATION_MAX_TOKENS <= 100000, `too large: ${VALIDATION_MAX_TOKENS}`);
            assert.ok(VALIDATION_MAX_TOKENS > 0);
        });
    });
});

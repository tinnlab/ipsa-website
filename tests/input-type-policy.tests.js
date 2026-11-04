// The input-type policy behind Biological Interpretation gating and the pgsea 3-column
// requirement — imports/utils/inputTypePolicy.js. Pure module; runs server-side.
import assert from "assert";
import {
    resolveInputTypePolicy,
    isInputTypeBlocked,
    isInterpretationBlocked,
    interpretationUnavailableReason,
    interpretationRefusal,
    INTERPRETATION_BLOCKED_REASON,
    INTERPRETATION_NO_GENE_RESULTS_REASON,
} from "../imports/utils/inputTypePolicy";

describe("resolveInputTypePolicy", function () {
    it("defaults to blocking ora and requiring statistics when the keys are absent", function () {
        assert.deepStrictEqual(resolveInputTypePolicy({}), {
            interpretationBlockedInputTypes: ["ora"],
            pgseaRequireStatsColumns: true,
        });
        assert.deepStrictEqual(resolveInputTypePolicy(undefined), resolveInputTypePolicy({}));
    });

    it("honours the revert values", function () {
        assert.deepStrictEqual(
            resolveInputTypePolicy({ interpretationBlockedInputTypes: [], pgseaRequireStatsColumns: false }),
            { interpretationBlockedInputTypes: [], pgseaRequireStatsColumns: false }
        );
    });

    it("ignores malformed values rather than opening a gate by accident", function () {
        assert.deepStrictEqual(
            resolveInputTypePolicy({ interpretationBlockedInputTypes: "ora", pgseaRequireStatsColumns: "no" }),
            { interpretationBlockedInputTypes: ["ora"], pgseaRequireStatsColumns: true }
        );
    });
});

describe("isInterpretationBlocked", function () {
    it("blocks a single ora analysis and allows expression / pgsea", function () {
        assert.strictEqual(isInterpretationBlocked(["ora"]), true);
        assert.strictEqual(isInterpretationBlocked(["expression"]), false);
        assert.strictEqual(isInterpretationBlocked(["pgsea"]), false);
    });

    it("blocks a meta only when EVERY dataset is blocked; a mixed meta is allowed", function () {
        assert.strictEqual(isInterpretationBlocked(["ora", "ora"]), true);
        assert.strictEqual(isInterpretationBlocked(["ora", "pgsea"]), false);
    });

    it("does not block when the type is unknown, or when the list is empty", function () {
        assert.strictEqual(isInterpretationBlocked([undefined]), false);
        assert.strictEqual(isInterpretationBlocked([]), false);
    });

    it("follows the configured list", function () {
        assert.strictEqual(isInterpretationBlocked(["ora"], []), false);
        assert.strictEqual(isInputTypeBlocked("pgsea", ["pgsea"]), true);
    });
});

describe("interpretationUnavailableReason", function () {
    it("refuses a blocked type with the input-type message, even when it has results", function () {
        assert.strictEqual(
            interpretationUnavailableReason({ inputType: "ora", hasGeneResults: true }),
            INTERPRETATION_BLOCKED_REASON
        );
    });

    it("refuses an unblocked analysis with no gene-level results with the no-results message", function () {
        // A stored single-metric pgsea analysis, a mass expression analysis, or one not run yet.
        for (const a of [{ inputType: "pgsea" }, { inputType: "expression", hasGeneResults: false }]) {
            assert.strictEqual(interpretationUnavailableReason(a), INTERPRETATION_NO_GENE_RESULTS_REASON);
        }
    });

    it("allows expression and pgsea analyses that have gene-level results", function () {
        assert.strictEqual(interpretationUnavailableReason({ inputType: "expression", hasGeneResults: true }), null);
        assert.strictEqual(interpretationUnavailableReason({ inputType: "pgsea", hasGeneResults: true }), null);
    });

    it("lets the flag's revert value really re-enable ora (pathway-only by construction)", function () {
        // ora never has volcanoPlotData; if the no-results check applied to it, emptying
        // interpretationBlockedInputTypes would revert nothing.
        assert.strictEqual(interpretationUnavailableReason({ inputType: "ora", hasGeneResults: false }, []), null);
        assert.strictEqual(interpretationRefusal([{ inputType: "ora" }], { isMeta: false, blocked: [] }), null);
        assert.strictEqual(interpretationRefusal([{ inputType: "ora" }, { inputType: "ora" }], { isMeta: true, blocked: [] }), null);
    });

    it("keeps refusing gene-less pgsea/expression when the ora flag is reverted", function () {
        assert.strictEqual(
            interpretationRefusal([{ inputType: "ora" }, { inputType: "pgsea" }], { isMeta: true, blocked: [] }).code,
            "interpretation-unavailable-no-gene-results"
        );
    });
});

describe("interpretationRefusal (the aiWorkflow.startPublicationReady gate)", function () {
    it("refuses a single ora analysis for its input type", function () {
        assert.strictEqual(
            interpretationRefusal([{ inputType: "ora", hasGeneResults: false }], { isMeta: false }).code,
            "interpretation-unavailable-input-type"
        );
    });

    it("refuses a single gene-less pgsea analysis for missing results, with its own message", function () {
        const r = interpretationRefusal([{ inputType: "pgsea", hasGeneResults: false }], { isMeta: false });
        assert.strictEqual(r.code, "interpretation-unavailable-no-gene-results");
        assert.strictEqual(r.reason, INTERPRETATION_NO_GENE_RESULTS_REASON);
    });

    it("allows a single analysis with gene-level results", function () {
        assert.strictEqual(interpretationRefusal([{ inputType: "pgsea", hasGeneResults: true }], { isMeta: false }), null);
    });

    it("refuses a meta of gene-less pgsea datasets (the case-study shape)", function () {
        const datasets = Array.from({ length: 14 }, () => ({ inputType: "pgsea", hasGeneResults: false }));
        assert.strictEqual(interpretationRefusal(datasets, { isMeta: true }).code,
            "interpretation-unavailable-no-gene-results");
    });

    it("refuses a meta whose every dataset is blocked", function () {
        assert.strictEqual(
            interpretationRefusal([{ inputType: "ora" }, { inputType: "ora" }], { isMeta: true }).code,
            "interpretation-unavailable-input-type"
        );
    });

    it("lets a MIXED meta through (documented gap: its gene-less datasets stay gene-less)", function () {
        assert.strictEqual(interpretationRefusal([
            { inputType: "ora", hasGeneResults: false },
            { inputType: "pgsea", hasGeneResults: true },
        ], { isMeta: true }), null);
    });
});

describe("refusal messages", function () {
    it("are distinct, and the no-results one does not blame the input type", function () {
        assert.notStrictEqual(INTERPRETATION_BLOCKED_REASON, INTERPRETATION_NO_GENE_RESULTS_REASON);
        assert.match(INTERPRETATION_BLOCKED_REASON, /no gene-level statistics/);
        assert.doesNotMatch(INTERPRETATION_NO_GENE_RESULTS_REASON, /input type/i);
    });
});

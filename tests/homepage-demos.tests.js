import assert from "assert";
import { resolveAnalysisName, DEFAULT_ANALYSIS_NAME, MAX_ANALYSIS_NAME_LENGTH } from "../imports/utils/analysisName";
import { shouldAutoloadExample } from "../imports/utils/exampleAutoload";
import { resolveVideoTutorial } from "../imports/utils/videoTutorial";

describe("resolveAnalysisName (the name a new analysis is created with)", function () {
    it("uses the supplied name, trimmed", function () {
        assert.strictEqual(resolveAnalysisName("  Demo - Expression Data Analysis  "), "Demo - Expression Data Analysis");
    });

    it("falls back to 'Analysis' when no name is given — the two callers that pass none must not change", function () {
        assert.strictEqual(resolveAnalysisName(undefined), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName(undefined), "Analysis");
    });

    it("falls back rather than throwing for anything that is not a string", function () {
        assert.strictEqual(resolveAnalysisName(null), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName(42), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName({}), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName({ $ne: null }), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName([]), DEFAULT_ANALYSIS_NAME);
    });

    it("falls back for empty and whitespace-only names", function () {
        assert.strictEqual(resolveAnalysisName(""), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName("   "), DEFAULT_ANALYSIS_NAME);
        assert.strictEqual(resolveAnalysisName("\t\n "), DEFAULT_ANALYSIS_NAME);
    });

    it("measures length AFTER trimming, so trailing spaces cannot push a legal name over", function () {
        const exact = "x".repeat(MAX_ANALYSIS_NAME_LENGTH);
        assert.strictEqual(resolveAnalysisName(`  ${exact}  `), exact);
    });

    it("truncates rather than rejects an over-long name — the caller has no way to recover", function () {
        const tooLong = "x".repeat(MAX_ANALYSIS_NAME_LENGTH + 50);
        const result = resolveAnalysisName(tooLong);
        assert.strictEqual(result.length, MAX_ANALYSIS_NAME_LENGTH);
    });

    it("honours an explicit fallback", function () {
        assert.strictEqual(resolveAnalysisName("", { fallback: "Untitled" }), "Untitled");
    });
});

describe("shouldAutoloadExample (homepage demo boxes seeding Step 2)", function () {
    const ready = { shouldLoadExample: true, inputType: "ora", isLoading: false, data: {} };

    it("loads for a fresh ora/pgsea analysis", function () {
        assert.strictEqual(shouldAutoloadExample(ready), true);
        assert.strictEqual(shouldAutoloadExample({ ...ready, inputType: "pgsea" }), true);
    });

    it("loads for a fresh expression analysis", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, inputType: "expression" }), true);
    });

    it("does nothing once the wizard's latch says the example was already consumed", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, shouldLoadExample: false }), false);
    });

    it("requires the latch to be exactly true, not merely truthy", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, shouldLoadExample: 1 }), false);
        assert.strictEqual(shouldAutoloadExample({ ...ready, shouldLoadExample: "yes" }), false);
    });

    it("waits while the stored input is still being fetched", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, isLoading: true }), false);
    });

    it("treats a null / non-object fetch result as not ready, never as empty", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, data: null }), false);
        assert.strictEqual(shouldAutoloadExample({ ...ready, data: undefined }), false);
        assert.strictEqual(shouldAutoloadExample({ ...ready, data: "" }), false);
    });

    it("never overwrites an analysis that already has ora/pgsea input", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, data: { input: "TP53\nEGFR" } }), false);
        assert.strictEqual(
            shouldAutoloadExample({ ...ready, inputType: "pgsea", data: { input: "TP53\t1.2" } }),
            false
        );
    });

    it("treats empty and whitespace-only stored input as empty — a user mid-edit may be on '   '", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, data: { input: "" } }), true);
        assert.strictEqual(shouldAutoloadExample({ ...ready, data: { input: "   " } }), true);
    });

    it("pgsea with inputRaw but no canonical input still counts as empty", function () {
        assert.strictEqual(
            shouldAutoloadExample({ ...ready, inputType: "pgsea", data: { inputRaw: "Gene\tFC\tP" } }),
            true
        );
    });

    it("never overwrites an expression analysis that already has its matrix", function () {
        assert.strictEqual(
            shouldAutoloadExample({ ...ready, inputType: "expression", data: { expressionFile: "GSE48350-expression.csv" } }),
            false
        );
    });

    it("a group file alone does not count — the two are written together, so the matrix is the signal", function () {
        assert.strictEqual(
            shouldAutoloadExample({ ...ready, inputType: "expression", data: { groupFile: "GSE48350-group.csv" } }),
            true
        );
    });

    it("refuses an input type it does not know how to seed", function () {
        assert.strictEqual(shouldAutoloadExample({ ...ready, inputType: "meta" }), false);
        assert.strictEqual(shouldAutoloadExample({ ...ready, inputType: undefined }), false);
    });

    it("tolerates being called with nothing at all", function () {
        assert.strictEqual(shouldAutoloadExample(), false);
        assert.strictEqual(shouldAutoloadExample({}), false);
    });
});

describe("resolveVideoTutorial (homepage video section, default off)", function () {
    it("renders nothing when the settings block is absent — a deployment that predates the key", function () {
        assert.strictEqual(resolveVideoTutorial(undefined), null);
        assert.strictEqual(resolveVideoTutorial({}), null);
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: null }), null);
    });

    it("is OFF by default: the shipped settings say enabled:false", function () {
        assert.strictEqual(
            resolveVideoTutorial({ videoTutorial: { enabled: false, youtubeId: "LF7ryDqFVDc" } }),
            null
        );
    });

    it("requires enabled to be exactly true, so a stray truthy value cannot switch it on", function () {
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { enabled: "true", youtubeId: "abc" } }), null);
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { enabled: 1, youtubeId: "abc" } }), null);
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { youtubeId: "abc" } }), null);
    });

    it("renders nothing when enabled without a usable video id, rather than an empty player", function () {
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { enabled: true } }), null);
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { enabled: true, youtubeId: "" } }), null);
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { enabled: true, youtubeId: "   " } }), null);
        assert.strictEqual(resolveVideoTutorial({ videoTutorial: { enabled: true, youtubeId: 12345 } }), null);
    });

    it("turning it on is a settings edit: enabled:true plus an id gives the embed url", function () {
        assert.deepStrictEqual(
            resolveVideoTutorial({ videoTutorial: { enabled: true, youtubeId: "LF7ryDqFVDc" } }),
            { youtubeId: "LF7ryDqFVDc", embedUrl: "https://www.youtube.com/embed/LF7ryDqFVDc" }
        );
    });

    it("swapping in a NEW video is also a settings edit", function () {
        assert.strictEqual(
            resolveVideoTutorial({ videoTutorial: { enabled: true, youtubeId: " dQw4w9WgXcQ " } }).embedUrl,
            "https://www.youtube.com/embed/dQw4w9WgXcQ"
        );
    });
});

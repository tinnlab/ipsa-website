import assert from "assert";
import {resolveInitialAnalysisTab, sectionAnchorId} from "../imports/utils/vizNav";

describe("resolveInitialAnalysisTab (open the analysis the user came from)", function () {
    const regularAnalyses = [
        {id: "a1"}, {id: "a2"}, {id: "a3"}, {id: "a4"}, {id: "a5"},
    ];

    it("opens the matching analysis tab (analysis 3 of 5 -> tab '3')", function () {
        const {tabKey, analysisId} = resolveInitialAnalysisTab({regularAnalyses, analysisId: "a3"});
        assert.strictEqual(tabKey, "3");
        assert.strictEqual(analysisId, "a3");
    });

    it("opens the first tab when the analysisId matches the first analysis", function () {
        const {tabKey, analysisId} = resolveInitialAnalysisTab({regularAnalyses, analysisId: "a1"});
        assert.strictEqual(tabKey, "1");
        assert.strictEqual(analysisId, "a1");
    });

    it("opens the last tab for the last analysis", function () {
        const {tabKey} = resolveInitialAnalysisTab({regularAnalyses, analysisId: "a5"});
        assert.strictEqual(tabKey, "5");
    });

    it("falls back to the first analysis for an unknown id", function () {
        const {tabKey, analysisId} = resolveInitialAnalysisTab({regularAnalyses, analysisId: "nope"});
        assert.strictEqual(tabKey, "1");
        assert.strictEqual(analysisId, "a1");
    });

    it("falls back to the first analysis when no id is provided", function () {
        const {tabKey, analysisId} = resolveInitialAnalysisTab({regularAnalyses});
        assert.strictEqual(tabKey, "1");
        assert.strictEqual(analysisId, "a1");
    });

    it("returns a safe default when there are no analyses", function () {
        const {tabKey, analysisId} = resolveInitialAnalysisTab({regularAnalyses: [], analysisId: "a3"});
        assert.strictEqual(tabKey, "1");
        assert.strictEqual(analysisId, undefined);
    });

    it("does not throw on missing arguments", function () {
        const {tabKey} = resolveInitialAnalysisTab();
        assert.strictEqual(tabKey, "1");
    });
});

describe("sectionAnchorId (per-analysis Quick Navigation anchors)", function () {
    it("suffixes the base id with the analysis id", function () {
        assert.strictEqual(sectionAnchorId("summary", "a1"), "summary-a1");
        assert.strictEqual(sectionAnchorId("pathway-network", "abc123"), "pathway-network-abc123");
    });

    it("produces distinct ids for the same section across different analyses", function () {
        // This is the core of the bug fix: two analyses must not share a DOM id,
        // otherwise getElementById always resolves to the first one.
        const a = sectionAnchorId("forest", "a1");
        const b = sectionAnchorId("forest", "a2");
        assert.notStrictEqual(a, b);
    });

    it("returns the bare base id when no analysis id is given (e.g. meta sections)", function () {
        assert.strictEqual(sectionAnchorId("meta-builder"), "meta-builder");
        assert.strictEqual(sectionAnchorId("meta-builder", undefined), "meta-builder");
    });
});

// AI-interpretation sidebar selection → wizard pre-selection (pure).
import assert from "assert";
import {
    resolveTreeSelection,
    initialSelectedAnalysesFor,
    resolveDeepLinkSelection,
    analysisNameInStudy,
} from "../imports/utils/aiInterpretationSelection";

describe("ai-interpretation sidebar selection", function () {
    describe("resolveTreeSelection", function () {
        it("maps an analysis key to its session + analysis + name", function () {
            const sel = resolveTreeSelection("sess1|an1", { analysisName: "My analysis" });
            assert.deepStrictEqual(sel, {
                sessionId: "sess1",
                analysisId: "an1",
                displayName: "My analysis",
            });
        });

        it("maps a study key (no '|') to the study with analysisId = null", function () {
            const sel = resolveTreeSelection("sess1", { studyName: "My study" });
            assert.deepStrictEqual(sel, {
                sessionId: "sess1",
                analysisId: null,
                displayName: "My study",
            });
        });

        it("returns null for an empty/invalid key", function () {
            assert.strictEqual(resolveTreeSelection("", {}), null);
            assert.strictEqual(resolveTreeSelection(undefined, {}), null);
        });

        it("tolerates a missing node", function () {
            const study = resolveTreeSelection("sess1");
            assert.strictEqual(study.sessionId, "sess1");
            assert.strictEqual(study.analysisId, null);
        });

        it("pins the split for a key with extra '|' separators (takes first two segments)", function () {
            // Guards the destructure `const [sessionId, analysisId] = key.split('|')` against a
            // future refactor: any '|' means "analysis", first two segments win, extras ignored.
            const sel = resolveTreeSelection("sess1|an1|extra", { analysisName: "X" });
            assert.strictEqual(sel.sessionId, "sess1");
            assert.strictEqual(sel.analysisId, "an1");
        });
    });

    describe("initialSelectedAnalysesFor", function () {
        it("pre-selects the analysis when one was clicked", function () {
            assert.deepStrictEqual(
                initialSelectedAnalysesFor({ sessionId: "s", analysisId: "an1" }),
                ["an1"]
            );
        });

        it("pre-selects nothing when a study was clicked (analysisId null)", function () {
            assert.deepStrictEqual(
                initialSelectedAnalysesFor({ sessionId: "s", analysisId: null }),
                []
            );
        });

        it("is empty for missing input", function () {
            assert.deepStrictEqual(initialSelectedAnalysesFor(undefined), []);
        });
    });

    // End-to-end of the two-step contract: a click resolves to a selection, and that selection
    // drives the wizard's pre-selection. Study → open empty picker; analysis → pre-selected.
    describe("click → wizard pre-selection", function () {
        it("study click opens an empty picker", function () {
            const sel = resolveTreeSelection("sessA", { studyName: "Study A" });
            assert.deepStrictEqual(initialSelectedAnalysesFor(sel), []);
        });
        it("analysis click pre-selects that analysis", function () {
            const sel = resolveTreeSelection("sessA|anB", { analysisName: "Analysis B" });
            assert.deepStrictEqual(initialSelectedAnalysesFor(sel), ["anB"]);
        });
    });

    describe("analysisNameInStudy", function () {
        const study = {
            _id: "s",
            analyses: [{ id: "an1", name: "Tumor vs Normal" }],
            metaAnalyses: [{ id: "meta1", name: "Combined meta" }],
        };

        it("finds a regular analysis and a meta-analysis alike", function () {
            assert.strictEqual(analysisNameInStudy(study, "an1"), "Tumor vs Normal");
            assert.strictEqual(analysisNameInStudy(study, "meta1"), "Combined meta");
        });

        it("is null for an id that is not part of the study, or for missing input", function () {
            assert.strictEqual(analysisNameInStudy(study, "elsewhere"), null);
            assert.strictEqual(analysisNameInStudy(study, null), null);
            assert.strictEqual(analysisNameInStudy(null, "an1"), null);
            assert.strictEqual(analysisNameInStudy({ _id: "bare" }, "an1"), null);
        });
    });

    // Two producers link here: Visualization's "Generate Insight" with ?sessionId= alone, and
    // Step5_RunAnalysis's "Interpret" with ?sessionId=&analysisId=.
    describe("resolveDeepLinkSelection", function () {
        const studies = [
            {
                _id: "sessA",
                name: "Study A",
                analyses: [{ id: "an1", name: "Analysis One" }],
                metaAnalyses: [{ id: "meta1", name: "Combined meta" }],
            },
            { _id: "sessB", name: "Study B" },
        ];

        it("selects the linked study", function () {
            assert.deepStrictEqual(resolveDeepLinkSelection("?sessionId=sessB", studies), {
                sessionId: "sessB",
                analysisId: null,
                displayName: "Study B",
            });
        });

        it("resolves to the same shape a study click produces", function () {
            const byLink = resolveDeepLinkSelection("?sessionId=sessA", studies);
            const byClick = resolveTreeSelection("sessA", { studyName: "Study A" });
            assert.deepStrictEqual(byLink, byClick);
            // ...and therefore opens the picker with nothing pre-selected.
            assert.deepStrictEqual(initialSelectedAnalysesFor(byLink), []);
        });

        it("returns null when the param is absent", function () {
            assert.strictEqual(resolveDeepLinkSelection("", studies), null);
            assert.strictEqual(resolveDeepLinkSelection("?analysisId=an1", studies), null);
            assert.strictEqual(resolveDeepLinkSelection(undefined, studies), null);
        });

        it("returns null for a study that is not loaded, so a stale link lands on the overview", function () {
            assert.strictEqual(resolveDeepLinkSelection("?sessionId=gone", studies), null);
            assert.strictEqual(resolveDeepLinkSelection("?sessionId=sessA", []), null);
            assert.strictEqual(resolveDeepLinkSelection("?sessionId=sessA"), null);
        });

        // Step5_RunAnalysis's "Interpret" names the analysis the user just ran. That used to be
        // dropped, landing them on a study-level selection; now the link and the click agree.
        it("honours analysisId, resolving to the same shape an analysis click produces", function () {
            const byLink = resolveDeepLinkSelection("?sessionId=sessA&analysisId=an1", studies);
            const byClick = resolveTreeSelection("sessA|an1", { analysisName: "Analysis One" });
            assert.deepStrictEqual(byLink, byClick);
            // ...and therefore opens the wizard with that analysis pre-selected.
            assert.deepStrictEqual(initialSelectedAnalysesFor(byLink), ["an1"]);
        });

        it("honours a meta-analysis id too", function () {
            const sel = resolveDeepLinkSelection("?sessionId=sessA&analysisId=meta1", studies);
            assert.deepStrictEqual(sel, {
                sessionId: "sessA",
                analysisId: "meta1",
                displayName: "Combined meta",
            });
        });

        it("falls back to the study when analysisId does not belong to it", function () {
            // A convincing-looking view of nothing is worse than the study it really names.
            const sel = resolveDeepLinkSelection("?sessionId=sessA&analysisId=elsewhere", studies);
            assert.deepStrictEqual(sel, resolveTreeSelection("sessA", { studyName: "Study A" }));
        });

        it("falls back to the study when the study lists no analyses at all", function () {
            const sel = resolveDeepLinkSelection("?sessionId=sessB&analysisId=an1", studies);
            assert.strictEqual(sel.analysisId, null);
            assert.strictEqual(sel.displayName, "Study B");
        });

        it("ignores an empty analysisId param", function () {
            const sel = resolveDeepLinkSelection("?sessionId=sessA&analysisId=", studies);
            assert.strictEqual(sel.analysisId, null);
        });

        // Order matters: a bad sessionId is still the overview even with a valid-looking analysis.
        it("still returns null when the study is unknown, whatever analysisId says", function () {
            assert.strictEqual(resolveDeepLinkSelection("?sessionId=gone&analysisId=an1", studies), null);
        });
    });
});

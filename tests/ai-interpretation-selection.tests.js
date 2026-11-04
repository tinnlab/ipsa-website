// AI-interpretation sidebar selection → wizard pre-selection (pure).
import assert from "assert";
import {
    resolveTreeSelection,
    initialSelectedAnalysesFor,
    resolveDeepLinkSelection,
    analysisNameInStudy,
    parseAIInterpretationLink,
    buildAIInterpretationLink,
    selectionKeyFromSearch,
    resolveDeepLinkReport,
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

// Deep links that name a REPORT. Before this, a report was React state only: refreshing, or pasting
// the URL, dropped the user back to the list, and the "View" button on the Visualization page
// received a batchId and threw it away.
describe("ai-interpretation report links", function () {
    // Real BatchInfo row shape. queue.getUserBatches returns the document plus a prompts[] array;
    // ownership lives in userId, which is why an id absent from this list is an id the server would
    // refuse anyway.
    const BATCHES = [
        {
            _id: "bat1", userId: "u1", sessionId: "sessA", analysisId: "an1",
            analysisName: "Analysis One", insightName: "Draft v2", status: "completed",
            workflowType: "publication-ready", totalPrompts: 1, completedPrompts: 1,
            createdAt: new Date("2026-02-03T10:00:00Z"), prompts: [],
        },
        {
            _id: "bat2", userId: "u1", sessionId: "sessB", analysisId: "an9",
            analysisName: "Analysis Nine", insightName: "Legacy report", status: "completed",
            totalPrompts: 6, completedPrompts: 6,
            createdAt: new Date("2025-11-01T08:00:00Z"), prompts: [],
        },
    ];

    describe("parseAIInterpretationLink", function () {
        it("reads all three ids", function () {
            assert.deepStrictEqual(
                parseAIInterpretationLink("?sessionId=sessA&analysisId=an1&reportId=bat1"),
                { sessionId: "sessA", analysisId: "an1", reportId: "bat1" }
            );
        });

        // A blank id names nothing, so it must read as absent rather than as the empty string —
        // otherwise `?reportId=` would send the page looking for a report called "".
        it("treats an empty param as absent", function () {
            assert.deepStrictEqual(
                parseAIInterpretationLink("?sessionId=sessA&reportId="),
                { sessionId: "sessA", analysisId: null, reportId: null }
            );
        });

        it("returns nulls for an empty, absent or unrelated query", function () {
            const empty = { sessionId: null, analysisId: null, reportId: null };
            assert.deepStrictEqual(parseAIInterpretationLink(""), empty);
            assert.deepStrictEqual(parseAIInterpretationLink(undefined), empty);
            assert.deepStrictEqual(parseAIInterpretationLink("?foo=bar"), empty);
        });
    });

    describe("buildAIInterpretationLink", function () {
        // The two links that exist in the codebase today, rebuilt. If either of these ever stops
        // matching, adopting the builder silently changed a URL somebody already relies on.
        it("reproduces Visualization's existing link byte for byte", function () {
            assert.strictEqual(buildAIInterpretationLink({ sessionId: "sessA" }), "?sessionId=sessA");
        });

        it("reproduces Step5_RunAnalysis's existing link byte for byte", function () {
            assert.strictEqual(
                buildAIInterpretationLink({ sessionId: "sessA", analysisId: "an1" }),
                "?sessionId=sessA&analysisId=an1"
            );
        });

        it("puts reportId last", function () {
            assert.strictEqual(
                buildAIInterpretationLink({ sessionId: "sessA", analysisId: "an1", reportId: "bat1" }),
                "?sessionId=sessA&analysisId=an1&reportId=bat1"
            );
        });

        it("omits missing and empty ids rather than writing blanks", function () {
            assert.strictEqual(
                buildAIInterpretationLink({ sessionId: "sessA", analysisId: "", reportId: "bat1" }),
                "?sessionId=sessA&reportId=bat1"
            );
        });

        // '' and not '?': navigate({search: ''}) means the bare page, navigate({search: '?'}) leaves
        // a dangling question mark in the address bar.
        it("is empty when there is nothing to say", function () {
            assert.strictEqual(buildAIInterpretationLink(), "");
            assert.strictEqual(buildAIInterpretationLink({}), "");
            assert.strictEqual(buildAIInterpretationLink({ sessionId: null }), "");
        });

        it("round-trips through parseAIInterpretationLink", function () {
            const ids = { sessionId: "sessA", analysisId: "an1", reportId: "bat1" };
            assert.deepStrictEqual(parseAIInterpretationLink(buildAIInterpretationLink(ids)), ids);
        });
    });

    describe("selectionKeyFromSearch", function () {
        // The assertion the whole open/close design rests on: if opening a report changed this key,
        // the page would re-apply the deep-link selection and reset the sidebar under the user.
        it("is unchanged by adding, changing or removing reportId", function () {
            const base = selectionKeyFromSearch("?sessionId=sessA&analysisId=an1");
            assert.strictEqual(selectionKeyFromSearch("?sessionId=sessA&analysisId=an1&reportId=bat1"), base);
            assert.strictEqual(selectionKeyFromSearch("?sessionId=sessA&analysisId=an1&reportId=bat2"), base);
            assert.strictEqual(selectionKeyFromSearch("?sessionId=sessA&analysisId=an1&reportId="), base);
        });

        it("distinguishes two selections, and a selection from the overview", function () {
            const study = selectionKeyFromSearch("?sessionId=sessA");
            const analysis = selectionKeyFromSearch("?sessionId=sessA&analysisId=an1");
            const other = selectionKeyFromSearch("?sessionId=sessB");
            const overview = selectionKeyFromSearch("");
            assert.notStrictEqual(study, analysis);
            assert.notStrictEqual(study, other);
            assert.notStrictEqual(study, overview);
        });
    });

    describe("resolveDeepLinkReport", function () {
        it("is 'none' when the link names no report", function () {
            assert.deepStrictEqual(
                resolveDeepLinkReport("?sessionId=sessA", BATCHES, true),
                { status: "none", batchId: null, batch: null }
            );
        });

        // The load race. An empty list is not evidence of absence, so this must never be 'unknown'.
        it("is 'pending' while the batch list has not loaded, never 'unknown'", function () {
            assert.deepStrictEqual(
                resolveDeepLinkReport("?reportId=bat1", [], false),
                { status: "pending", batchId: "bat1", batch: null }
            );
            assert.strictEqual(resolveDeepLinkReport("?reportId=bat1", BATCHES, false).status, "pending");
        });

        it("is 'ok' and hands back the row when the loaded list holds it", function () {
            const result = resolveDeepLinkReport("?sessionId=sessA&reportId=bat1", BATCHES, true);
            assert.strictEqual(result.status, "ok");
            assert.strictEqual(result.batchId, "bat1");
            assert.strictEqual(result.batch, BATCHES[0]);
        });

        it("is 'unknown' for a deleted id once the list has loaded", function () {
            assert.deepStrictEqual(
                resolveDeepLinkReport("?reportId=goneForever", BATCHES, true),
                { status: "unknown", batchId: "goneForever", batch: null }
            );
        });

        // queue.getUserBatches is owner-scoped, so another account's report is simply not in the
        // list. That is what stops a guessed or forwarded id from becoming an access route.
        it("is 'unknown' for another account's id, because the list is owner-scoped", function () {
            assert.strictEqual(
                resolveDeepLinkReport("?reportId=someoneElsesBatch", BATCHES, true).status,
                "unknown"
            );
        });

        it("tolerates a null or undefined batch list", function () {
            assert.strictEqual(resolveDeepLinkReport("?reportId=bat1", null, true).status, "unknown");
            assert.strictEqual(resolveDeepLinkReport("?reportId=bat1", undefined, true).status, "unknown");
        });
    });

    // A reportId in the URL must be invisible to the selection logic, or adding it would change
    // where the two pre-existing deep links land. Asserted against resolveDeepLinkSelection itself
    // rather than by restating its expected output.
    describe("selection resolution is unaffected by reportId", function () {
        const studies = [
            {
                _id: "sessA",
                name: "Study A",
                analyses: [{ id: "an1", name: "Analysis One" }],
                metaAnalyses: [{ id: "meta1", name: "Combined meta" }],
            },
        ];

        it("resolves ?sessionId=&reportId= exactly as ?sessionId= does", function () {
            assert.deepStrictEqual(
                resolveDeepLinkSelection("?sessionId=sessA&reportId=bat1", studies),
                resolveDeepLinkSelection("?sessionId=sessA", studies)
            );
        });

        it("resolves ?sessionId=&analysisId=&reportId= exactly as ?sessionId=&analysisId= does", function () {
            assert.deepStrictEqual(
                resolveDeepLinkSelection("?sessionId=sessA&analysisId=an1&reportId=bat1", studies),
                resolveDeepLinkSelection("?sessionId=sessA&analysisId=an1", studies)
            );
        });
    });
});

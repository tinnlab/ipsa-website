// AI-interpretation reports view: which reports a sidebar selection shows, how they are grouped,
// and whether the study allows the actions on them (pure).
import assert from "assert";
import {
    batchesForSelection,
    groupBatchesByAnalysis,
    isReadOnlyStudy,
} from "../imports/utils/aiInterpretationReports";
import { resolveTreeSelection } from "../imports/utils/aiInterpretationSelection";

// A study with two regular analyses and one meta-analysis, and reports under all three.
const STUDY = {
    _id: "sessA",
    name: "Study A",
    analyses: [
        { id: "an1", name: "Tumor vs Normal" },
        { id: "an2", name: "Treated vs Control" },
    ],
    metaAnalyses: [{ id: "meta1", name: "Combined meta" }],
};

const BATCHES = [
    { _id: "b1", sessionId: "sessA", analysisId: "an1", insightName: "R1", createdAt: "2026-01-03" },
    { _id: "b2", sessionId: "sessA", analysisId: "an1", insightName: "R2", createdAt: "2026-01-05" },
    { _id: "b3", sessionId: "sessA", analysisId: "an2", insightName: "R3", createdAt: "2026-01-04" },
    { _id: "b4", sessionId: "sessA", analysisId: "meta1", insightName: "R4", createdAt: "2026-01-02" },
    { _id: "b5", sessionId: "sessB", analysisId: "an9", insightName: "Other study", createdAt: "2026-01-06" },
];

const ids = (list) => list.map((b) => b._id);

describe("ai-interpretation reports view", function () {
    describe("batchesForSelection", function () {
        it("a STUDY selection spans every analysis AND meta-analysis of that study", function () {
            const sel = { sessionId: "sessA", analysisId: null };
            // b4 is a meta-analysis report: the previous per-analysis memo could never reach it.
            assert.deepStrictEqual(ids(batchesForSelection(BATCHES, sel)), ["b2", "b3", "b1", "b4"]);
        });

        it("a STUDY selection excludes other studies' reports", function () {
            const got = batchesForSelection(BATCHES, { sessionId: "sessA", analysisId: null });
            assert.ok(!ids(got).includes("b5"));
        });

        it("an ANALYSIS selection is scoped to that analysis alone", function () {
            const sel = { sessionId: "sessA", analysisId: "an1" };
            assert.deepStrictEqual(ids(batchesForSelection(BATCHES, sel)), ["b2", "b1"]);
        });

        it("an ANALYSIS selection works for a meta-analysis too", function () {
            const sel = { sessionId: "sessA", analysisId: "meta1" };
            assert.deepStrictEqual(ids(batchesForSelection(BATCHES, sel)), ["b4"]);
        });

        it("pins the session as well as the analysis, so a stale id cannot leak across studies", function () {
            const stale = [{ _id: "x", sessionId: "sessB", analysisId: "an1", createdAt: "2026-01-01" }];
            const got = batchesForSelection([...BATCHES, ...stale], { sessionId: "sessA", analysisId: "an1" });
            assert.deepStrictEqual(ids(got), ["b2", "b1"]);
        });

        it("orders newest first", function () {
            const got = batchesForSelection(BATCHES, { sessionId: "sessA", analysisId: null });
            const dates = got.map((b) => b.createdAt);
            assert.deepStrictEqual(dates, [...dates].sort().reverse());
        });

        it("does not mutate or alias the input array", function () {
            const input = BATCHES.slice();
            const before = ids(input);
            const got = batchesForSelection(input, { sessionId: "sessA", analysisId: null });
            assert.deepStrictEqual(ids(input), before);
            assert.notStrictEqual(got, input);
        });

        it("is empty for no selection or a selection with no session", function () {
            assert.deepStrictEqual(batchesForSelection(BATCHES, null), []);
            assert.deepStrictEqual(batchesForSelection(BATCHES, undefined), []);
            assert.deepStrictEqual(batchesForSelection(BATCHES, { analysisId: "an1" }), []);
        });

        it("tolerates missing/ragged batch input", function () {
            assert.deepStrictEqual(batchesForSelection(undefined, { sessionId: "sessA" }), []);
            assert.deepStrictEqual(
                ids(batchesForSelection([null, undefined, ...BATCHES], { sessionId: "sessA", analysisId: "an2" })),
                ["b3"]
            );
        });

        // The sidebar click and the reports it produces are one contract: a study key shows the
        // whole study, an analysis key shows just that analysis.
        it("follows the sidebar click: study key -> whole study, analysis key -> one analysis", function () {
            const studyClick = resolveTreeSelection("sessA", { studyName: "Study A" });
            const analysisClick = resolveTreeSelection("sessA|an2", { analysisName: "Treated vs Control" });
            assert.strictEqual(batchesForSelection(BATCHES, studyClick).length, 4);
            assert.deepStrictEqual(ids(batchesForSelection(BATCHES, analysisClick)), ["b3"]);
        });
    });

    describe("groupBatchesByAnalysis", function () {
        it("groups a study's reports by analysis, naming each from the study document", function () {
            const scoped = batchesForSelection(BATCHES, { sessionId: "sessA", analysisId: null });
            const groups = groupBatchesByAnalysis(scoped, STUDY);
            assert.deepStrictEqual(
                groups.map((g) => [g.analysisId, g.analysisName, ids(g.batches)]),
                [
                    ["an1", "Tumor vs Normal", ["b2", "b1"]],
                    ["an2", "Treated vs Control", ["b3"]],
                    ["meta1", "Combined meta", ["b4"]],
                ]
            );
        });

        it("resolves meta-analysis names from metaAnalyses[], not just analyses[]", function () {
            const groups = groupBatchesByAnalysis([BATCHES[3]], STUDY);
            assert.strictEqual(groups[0].analysisName, "Combined meta");
        });

        it("prefers the study's live name over the name denormalized onto the batch", function () {
            const renamed = { ...STUDY, analyses: [{ id: "an1", name: "Renamed analysis" }] };
            const groups = groupBatchesByAnalysis(
                [{ _id: "b", analysisId: "an1", analysisName: "Old name" }],
                renamed
            );
            assert.strictEqual(groups[0].analysisName, "Renamed analysis");
        });

        it("falls back to the batch's own name for an analysis that no longer exists", function () {
            const groups = groupBatchesByAnalysis(
                [{ _id: "b", analysisId: "gone", analysisName: "Deleted analysis" }],
                STUDY
            );
            assert.strictEqual(groups[0].analysisName, "Deleted analysis");
        });

        it("falls back to 'Unknown Analysis' when nothing names it", function () {
            const groups = groupBatchesByAnalysis([{ _id: "b", analysisId: "gone" }], STUDY);
            assert.strictEqual(groups[0].analysisName, "Unknown Analysis");
            assert.strictEqual(groupBatchesByAnalysis([{ _id: "b", analysisId: "gone" }], null)[0].analysisName,
                "Unknown Analysis");
        });

        it("preserves the incoming (newest-first) order inside each group", function () {
            const scoped = batchesForSelection(BATCHES, { sessionId: "sessA", analysisId: "an1" });
            assert.deepStrictEqual(ids(groupBatchesByAnalysis(scoped, STUDY)[0].batches), ["b2", "b1"]);
        });

        it("yields a single group for an analysis selection", function () {
            const scoped = batchesForSelection(BATCHES, { sessionId: "sessA", analysisId: "an2" });
            assert.strictEqual(groupBatchesByAnalysis(scoped, STUDY).length, 1);
        });

        it("is empty for no batches", function () {
            assert.deepStrictEqual(groupBatchesByAnalysis([], STUDY), []);
            assert.deepStrictEqual(groupBatchesByAnalysis(undefined, STUDY), []);
        });
    });

    describe("isReadOnlyStudy", function () {
        const studies = [
            { _id: "own", name: "Mine" },
            { _id: "imported", name: "Shared with me", readOnly: true },
            { _id: "explicit", name: "Mine too", readOnly: false },
        ];

        it("is true only for a view-only imported study", function () {
            assert.strictEqual(isReadOnlyStudy(studies, "imported"), true);
            assert.strictEqual(isReadOnlyStudy(studies, "own"), false);
            assert.strictEqual(isReadOnlyStudy(studies, "explicit"), false);
        });

        it("defaults to false for a study that is not loaded or no study at all", function () {
            assert.strictEqual(isReadOnlyStudy(studies, "gone"), false);
            assert.strictEqual(isReadOnlyStudy([], "imported"), false);
            assert.strictEqual(isReadOnlyStudy(undefined, "imported"), false);
            assert.strictEqual(isReadOnlyStudy(studies, null), false);
        });

        it("requires the flag to be exactly true, not merely truthy", function () {
            assert.strictEqual(isReadOnlyStudy([{ _id: "s", readOnly: "yes" }], "s"), false);
            assert.strictEqual(isReadOnlyStudy([{ _id: "s", readOnly: 1 }], "s"), false);
        });
    });
});

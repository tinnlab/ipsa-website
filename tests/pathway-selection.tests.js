import assert from "assert";
import {
    comparePathways,
    selectPathways,
    selectConsensusPathwayIds,
    KEGG_MAP_TOP_N,
    DEFAULT_SORT,
    SELECTION_MODES,
    PATHWAY_COLUMNS,
    SIGNIFICANCE_FDR_THRESHOLD,
    filterPathwaysByThreshold,
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
            assert.ok(sig.every((p) => p.pValueFDR <= SIGNIFICANCE_FDR_THRESHOLD));
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

    describe("allSignificant boundary", function () {
        it("keeps a pathway at exactly SIGNIFICANCE_FDR_THRESHOLD (inclusive)", function () {
            const rows = [
                { id: "edge", pValue: 0.01, pValueFDR: SIGNIFICANCE_FDR_THRESHOLD, score: 1 },
                { id: "over", pValue: 0.02, pValueFDR: SIGNIFICANCE_FDR_THRESHOLD + 1e-9, score: 1 },
            ];
            const sig = selectPathways(rows, PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.ALL_SIGNIFICANT);
            assert.deepStrictEqual(ids(sig), ["edge"]);
        });
    });

    describe("filterPathwaysByThreshold", function () {
        it("keeps rows with FDR <= maxFdr AND |score| >= minAbsScore, inclusive at both boundaries", function () {
            const rows = [
                { id: "eqFdr", pValueFDR: 0.05, score: 9 },
                { id: "eqScore", pValueFDR: 0.0, score: 1.5 },
                { id: "eqScoreNeg", pValueFDR: 0.0, score: -1.5 },
                { id: "overFdr", pValueFDR: 0.0501, score: 9 },
                { id: "underScore", pValueFDR: 0.0, score: 1.49 },
            ];
            assert.deepStrictEqual(
                ids(filterPathwaysByThreshold(rows, { maxFdr: 0.05, minAbsScore: 1.5 })),
                ["eqFdr", "eqScore", "eqScoreNeg"]
            );
        });

        it("compares |score|, so a strongly negative score passes", function () {
            const out = filterPathwaysByThreshold(makeFixture(), { maxFdr: 1, minAbsScore: 2 });
            // b(-9) and c(+3) have |score| >= 2.
            assert.deepStrictEqual(ids(out), ["b", "c"]);
        });

        it("treats a non-finite FDR as 1 and a non-finite score as 0", function () {
            const rows = [
                { id: "noFdr", score: 9 },
                { id: "nanFdr", pValueFDR: NaN, score: 9 },
                { id: "noScore", pValueFDR: 0.001 },
                { id: "infScore", pValueFDR: 0.001, score: Infinity },
            ];
            assert.deepStrictEqual(ids(filterPathwaysByThreshold(rows, { maxFdr: 0.05, minAbsScore: 1 })), []);
            // Thresholds that keep everything keep them too.
            assert.deepStrictEqual(
                ids(filterPathwaysByThreshold(rows, { maxFdr: 1, minAbsScore: 0 })),
                ["noFdr", "nanFdr", "noScore", "infScore"]
            );
        });

        it("returns [] for empty/null input and does not mutate", function () {
            assert.deepStrictEqual(filterPathwaysByThreshold([], { maxFdr: 1, minAbsScore: 0 }), []);
            assert.deepStrictEqual(filterPathwaysByThreshold(null, { maxFdr: 1, minAbsScore: 0 }), []);
            const fx = makeFixture();
            const before = JSON.stringify(fx);
            filterPathwaysByThreshold(fx, { maxFdr: 0.01, minAbsScore: 1 });
            assert.strictEqual(JSON.stringify(fx), before);
        });
    });

    describe("selectPathways with thresholds", function () {
        it("filters BEFORE taking the top N (not top-then-filter)", function () {
            // pValue order: a(.001), d(.002), b(.010), c(.050). |score| >= 1 drops d(0.5),
            // so top-2 is a then b, not a then d.
            const top = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.TOP, 2,
                { maxFdr: 1, minAbsScore: 1 });
            assert.deepStrictEqual(ids(top), ["a", "b"]);
        });

        it("allSignificant is the intersection of the thresholds and FDR <= SIGNIFICANCE_FDR_THRESHOLD", function () {
            // Thresholds alone keep a, b, c (|score| >= 1); significance then drops c (FDR .200).
            const sig = selectPathways(makeFixture(), PATHWAY_COLUMNS.SCORE, "descend", SELECTION_MODES.ALL_SIGNIFICANT,
                undefined, { maxFdr: 1, minAbsScore: 1 });
            assert.deepStrictEqual(ids(sig), ["b", "a"]);
            // A stricter FDR threshold narrows further: FDR <= 0.01 keeps only b.
            const strict = selectPathways(makeFixture(), PATHWAY_COLUMNS.SCORE, "descend", SELECTION_MODES.ALL_SIGNIFICANT,
                undefined, { maxFdr: 0.01, minAbsScore: 1 });
            assert.deepStrictEqual(ids(strict), ["b"]);
        });

        it("ALL ignores the thresholds", function () {
            const all = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", SELECTION_MODES.ALL,
                undefined, { maxFdr: 0.001, minAbsScore: 99 });
            assert.deepStrictEqual(ids(all), ["a", "d", "b", "c"]);
        });

        it("the 5-argument call is unchanged by the optional 6th argument", function () {
            for (const mode of [SELECTION_MODES.TOP, SELECTION_MODES.ALL_SIGNIFICANT, SELECTION_MODES.ALL]) {
                const five = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", mode, 3);
                const six = selectPathways(makeFixture(), PATHWAY_COLUMNS.P_VALUE, "ascend", mode, 3, undefined);
                assert.deepStrictEqual(ids(six), ids(five));
            }
        });

        it("does not mutate the input", function () {
            const fx = makeFixture();
            const before = JSON.stringify(fx);
            selectPathways(fx, PATHWAY_COLUMNS.SCORE, "descend", SELECTION_MODES.TOP, 2, { maxFdr: 0.05, minAbsScore: 1 });
            assert.strictEqual(JSON.stringify(fx), before);
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

// ---------------------------------------------------------------------------------------------
// selectConsensusPathwayIds — the KEGG map's auto-selection.
//
// The bug this guards: the inline version ended with `setPathwayId([selectedPathways[0]])`, so an
// empty source stored [undefined] — an array of LENGTH ONE containing undefined. No length check
// catches that, so a study with hundreds of significant pathways rendered "no significant pathways
// found" off the back of one entry, and the render guard had grown an explicit
// `pathwayId.includes(undefined)` test to cope.
// ---------------------------------------------------------------------------------------------

const consensusOf = (rows) => [{key: "consensus", value: rows, updatedAt: new Date()}];

describe("selectConsensusPathwayIds (KEGG map auto-selection)", function () {
    describe("the empty source never poisons the selection", function () {
        it("yields [] — NOT [undefined] — when there is no consensus and no results", function () {
            const {pathwayIds} = selectConsensusPathwayIds(null, null);
            // deepStrictEqual is the discriminating assertion: [undefined] has length 1 and would
            // pass any `length === 0` check written against it.
            assert.deepStrictEqual(pathwayIds, []);
            assert.strictEqual(pathwayIds.length, 0);
            assert.ok(!pathwayIds.includes(undefined));
        });

        it("yields [] for an EMPTY ARRAY of results — the exact hole in the old guard", function () {
            // `results` was initialised to []. The old test was `results && typeof results ===
            // 'object'`, which an array passes, and Object.keys([]) is empty — so the first effect
            // run fell through to "no pathways" on data that had not arrived yet.
            for (const empty of [[], [1, 2, 3]]) {
                const {pathwayIds} = selectConsensusPathwayIds([], empty);
                assert.deepStrictEqual(pathwayIds, []);
            }
        });

        it("yields [] for a consensus row whose value is empty, with no results to fall back on", function () {
            assert.deepStrictEqual(selectConsensusPathwayIds(consensusOf([]), null).pathwayIds, []);
            assert.deepStrictEqual(selectConsensusPathwayIds(consensusOf(null), {}).pathwayIds, []);
        });

        it("drops rows that carry no pathway id rather than emitting undefined entries", function () {
            const {pathwayIds} = selectConsensusPathwayIds(
                consensusOf([
                    {pathway: "hsa00010", pValue: 0.01},
                    {pValue: 0.02},                       // no pathway key at all
                    {pathway: undefined, pValue: 0.03},
                    {pathway: null, pValue: 0.04},
                    {pathway: "", pValue: 0.05},
                    {pathway: "hsa00020", pValue: 0.06},
                ]),
                null
            );
            assert.deepStrictEqual(pathwayIds, ["hsa00010", "hsa00020"]);
            assert.ok(!pathwayIds.includes(undefined));
            assert.ok(!pathwayIds.includes(null));
        });
    });

    describe("source precedence", function () {
        it("prefers consensus when it has rows, and reports 'consensus'", function () {
            const {pathwayIds, methodUsed} = selectConsensusPathwayIds(
                consensusOf([{pathway: "fromConsensus", pValue: 0.5}]),
                {ora: [{pathway: "fromOra", pValue: 0.001}]}
            );
            assert.deepStrictEqual(pathwayIds, ["fromConsensus"]);
            assert.strictEqual(methodUsed, "consensus");
        });

        it("falls back to the first NON-EMPTY per-method result and reports that method", function () {
            const {pathwayIds, methodUsed} = selectConsensusPathwayIds(consensusOf([]), {
                ks: [],
                wilcox: null,
                fgsea: [{pathway: "fromFgsea", pValue: 0.01}],
                ora: [{pathway: "fromOra", pValue: 0.001}],
            });
            assert.deepStrictEqual(pathwayIds, ["fromFgsea"]);
            assert.strictEqual(methodUsed, "fgsea");
        });

        it("uses only the NEWEST consensus row (the call returns them sorted newest-first)", function () {
            const {pathwayIds} = selectConsensusPathwayIds(
                [
                    {value: [{pathway: "newest", pValue: 0.01}]},
                    {value: [{pathway: "older", pValue: 0.001}]},
                ],
                null
            );
            assert.deepStrictEqual(pathwayIds, ["newest"]);
        });
    });

    describe("late arrival — the ordering bug this was extracted for", function () {
        // The effect runs twice per mount: once before /api/resultData resolves, once after. The
        // consensus Meteor method calls this.unblock(), so those two invocations can return OUT OF
        // ORDER. Cancellation in the component stops the stale one writing; this asserts the other
        // half — that the early, data-less call is now a harmless [] rather than a poisoned value
        // that would survive as a length-1 array.
        const methodResults = {ora: [{pathway: "hsa04110", pValue: 0.001}]};

        it("the early (no-results) call and the later (with-results) call differ only in data", function () {
            const early = selectConsensusPathwayIds(consensusOf([]), null);
            const later = selectConsensusPathwayIds(consensusOf([]), methodResults);

            assert.deepStrictEqual(early.pathwayIds, []);
            assert.deepStrictEqual(later.pathwayIds, ["hsa04110"]);
            // Had the early call still produced [undefined], overwriting `later` with it would look
            // exactly like a real empty result to every downstream check.
            assert.notDeepStrictEqual(early.pathwayIds, [undefined]);
        });

        it("is pure: repeated calls on the same inputs give equal results", function () {
            const a = selectConsensusPathwayIds(consensusOf([]), methodResults);
            const b = selectConsensusPathwayIds(consensusOf([]), methodResults);
            assert.deepStrictEqual(a, b);
        });
    });

    describe("ranking", function () {
        it("orders by pValue ascending", function () {
            const {pathwayIds} = selectConsensusPathwayIds(
                consensusOf([
                    {pathway: "third", pValue: 0.05},
                    {pathway: "first", pValue: 0.001},
                    {pathway: "second", pValue: 0.01},
                ]),
                null
            );
            assert.deepStrictEqual(pathwayIds, ["first", "second", "third"]);
        });

        it("ranks rows with a missing pValue LAST instead of comparing them as NaN", function () {
            // `a.pValue - b.pValue` is NaN here, and a NaN comparator result silently corrupts the
            // sort — the reason the ranking is delegated to selectPathways.
            const {pathwayIds} = selectConsensusPathwayIds(
                consensusOf([
                    {pathway: "missing"},
                    {pathway: "good", pValue: 0.01},
                    {pathway: "alsoMissing", pValue: null},
                ]),
                null
            );
            assert.strictEqual(pathwayIds[0], "good");
            assert.strictEqual(pathwayIds.length, 3);
        });

        it(`caps the selection at ${KEGG_MAP_TOP_N}`, function () {
            const many = Array.from({length: KEGG_MAP_TOP_N + 50}, (_, i) => ({
                pathway: `p${i}`,
                pValue: i / 10000,
            }));
            const {pathwayIds} = selectConsensusPathwayIds(consensusOf(many), null);
            assert.strictEqual(pathwayIds.length, KEGG_MAP_TOP_N);
            assert.strictEqual(pathwayIds[0], "p0");
        });

        it("honours an explicit topN", function () {
            const rows = [
                {pathway: "a", pValue: 0.001},
                {pathway: "b", pValue: 0.002},
                {pathway: "c", pValue: 0.003},
            ];
            assert.deepStrictEqual(
                selectConsensusPathwayIds(consensusOf(rows), null, 2).pathwayIds,
                ["a", "b"]
            );
        });
    });

    describe("purity", function () {
        it("does NOT sort the consensus rows in place", function () {
            // The inline version did `pathwayResults.sort(...)`, mutating consensusResults[0].value
            // — fetched data other code holds a reference to.
            const rows = [
                {pathway: "third", pValue: 0.05},
                {pathway: "first", pValue: 0.001},
                {pathway: "second", pValue: 0.01},
            ];
            const consensus = consensusOf(rows);
            selectConsensusPathwayIds(consensus, null);
            assert.deepStrictEqual(rows.map((r) => r.pathway), ["third", "first", "second"]);
            assert.strictEqual(consensus[0].value, rows);
        });

        it("does NOT sort the per-method rows in place", function () {
            const ora = [
                {pathway: "z", pValue: 0.9},
                {pathway: "a", pValue: 0.1},
            ];
            const methodResults = {ora};
            selectConsensusPathwayIds(consensusOf([]), methodResults);
            assert.deepStrictEqual(ora.map((r) => r.pathway), ["z", "a"]);
            assert.deepStrictEqual(Object.keys(methodResults), ["ora"]);
        });
    });

    it("never throws on malformed input", function () {
        const junk = [null, undefined, 0, "", "str", 42, true, [], {}, NaN, [{}], [{value: 7}]];
        for (const c of junk) {
            for (const m of junk) {
                const out = selectConsensusPathwayIds(c, m);
                assert.ok(Array.isArray(out.pathwayIds));
                assert.ok(!out.pathwayIds.includes(undefined));
            }
        }
    });
});

// ---------------------------------------------------------------------------------------------
// The consensus row shape.
//
// A SECOND, entirely separate cause of "no significant pathways found", and a deterministic one:
// the two producers do not share a row shape.
//
//   consensus  (visualization.getConsensusAnalysisResult) -> {ID, pValue, pFDR, name}
//   per-method (/api/resultData)                          -> {pathway, pValue, pValueFDR, score}
//
// The inline version read `.pathway` from both, so every study WITH a consensus row mapped its
// whole ranked list to undefined. Verified against the review database: all six sampled consensus
// rows use ID, all four sampled per-method rows use pathway.
// ---------------------------------------------------------------------------------------------

describe("selectConsensusPathwayIds: consensus and per-method rows have different shapes", function () {
    const consensusRow = (ID, pValue) => ({ID, pValue, pFDR: pValue * 10, name: "n" + ID});
    const methodRow = (pathway, pValue) => ({pathway, pValue, pValueFDR: pValue * 10, score: 1, _row: pathway});

    it("reads the id from `ID` on consensus rows", function () {
        const {pathwayIds, methodUsed} = selectConsensusPathwayIds(
            consensusOf([consensusRow("path:hsa05016", 1e-30), consensusRow("path:hsa03010", 1e-3)]),
            null
        );
        // Before the fix this was [] (and, inline, [undefined]) — the deterministic false negative.
        assert.deepStrictEqual(pathwayIds, ["path:hsa05016", "path:hsa03010"]);
        assert.strictEqual(methodUsed, "consensus");
    });

    it("still reads the id from `pathway` on per-method rows", function () {
        const {pathwayIds, methodUsed} = selectConsensusPathwayIds(consensusOf([]), {
            fgsea: [methodRow("path:hsa03010", 1e-5)],
        });
        assert.deepStrictEqual(pathwayIds, ["path:hsa03010"]);
        assert.strictEqual(methodUsed, "fgsea");
    });

    it("prefers `pathway` when a row somehow carries both", function () {
        const {pathwayIds} = selectConsensusPathwayIds(
            consensusOf([{pathway: "fromPathway", ID: "fromID", pValue: 0.01}]),
            null
        );
        assert.deepStrictEqual(pathwayIds, ["fromPathway"]);
    });

    it("falls back to `ID` when `pathway` is present but unusable", function () {
        for (const empty of [undefined, null, ""]) {
            const {pathwayIds} = selectConsensusPathwayIds(
                consensusOf([{pathway: empty, ID: "fromID", pValue: 0.01}]),
                null
            );
            assert.deepStrictEqual(pathwayIds, ["fromID"]);
        }
    });

    it("still drops a row that carries neither spelling", function () {
        const {pathwayIds} = selectConsensusPathwayIds(
            consensusOf([{pValue: 0.01, name: "nameless"}, consensusRow("path:hsa04110", 0.02)]),
            null
        );
        assert.deepStrictEqual(pathwayIds, ["path:hsa04110"]);
        assert.ok(!pathwayIds.includes(undefined));
    });

    it("ranks consensus rows by pValue even though they carry pFDR, not pValueFDR", function () {
        const {pathwayIds} = selectConsensusPathwayIds(
            consensusOf([
                consensusRow("second", 0.01),
                consensusRow("first", 0.0001),
                consensusRow("third", 0.5),
            ]),
            null
        );
        assert.deepStrictEqual(pathwayIds, ["first", "second", "third"]);
    });
});

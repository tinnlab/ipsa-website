import assert from "assert";
import {
    filterGenes,
    selectTopGenes,
    selectAnalysisDEGenes,
    originalDEThresholds,
    applyLiveDEThresholdOverlay,
    stampSnapshotThreshold,
    DEFAULT_GENE_TOP_N,
} from "../imports/utils/geneSelection";
import { selectGenesForExport } from "../imports/utils/exportUtils";

// Fixture: pValue and |foldChange| orderings disagree so tests distinguish them.
//   id   pValue   pValueFDR   foldChange
//   a    0.001    0.20        +0.4   (FDR too high for a 0.05 filter)
//   b    0.010    0.010       -2.5
//   c    0.002    0.010       +1.2
//   d    0.050    0.040       +0.6
//   e    0.004    0.030       -3.0
const makeFixture = () => [
    { id: "a", name: "AAA", pValue: 0.001, pValueFDR: 0.20, foldChange: 0.4 },
    { id: "b", name: "BBB", pValue: 0.010, pValueFDR: 0.010, foldChange: -2.5 },
    { id: "c", name: "CCC", pValue: 0.002, pValueFDR: 0.010, foldChange: 1.2 },
    { id: "d", name: "DDD", pValue: 0.050, pValueFDR: 0.040, foldChange: 0.6 },
    { id: "e", name: "EEE", pValue: 0.004, pValueFDR: 0.030, foldChange: -3.0 },
];

const ids = (rows) => rows.map((r) => r.id);

describe("geneSelection", function () {
    describe("filterGenes", function () {
        it("keeps only genes with FDR < fdr AND |foldChange| > fc", function () {
            // fdr 0.05, fc 0.5: a out (FDR .20), b in, c in, d out (|FC| 0.6 ok but FDR .04<.05 -> in? |FC| .6>.5 in), e in
            const out = filterGenes(makeFixture(), { fdr: 0.05, fc: 0.5 });
            // a: FDR .20 -> out. b: FDR .01,|FC|2.5 -> in. c: FDR .01,|FC|1.2 -> in.
            // d: FDR .04,|FC|.6 -> in. e: FDR .03,|FC|3 -> in.
            // filterGenes preserves input order (no sort) — assert it directly.
            assert.deepStrictEqual(ids(out), ["b", "c", "d", "e"]);
        });

        it("uses strict inequalities at the boundary", function () {
            const rows = [
                { id: "eqFdr", pValueFDR: 0.05, foldChange: 9 }, // FDR == threshold -> excluded
                { id: "eqFc", pValueFDR: 0.0, foldChange: 1.0 }, // |FC| == threshold -> excluded
                { id: "in", pValueFDR: 0.049, foldChange: 1.01 },
            ];
            assert.deepStrictEqual(ids(filterGenes(rows, { fdr: 0.05, fc: 1.0 })), ["in"]);
        });

        it("treats a missing FDR as 1 (not significant)", function () {
            const rows = [{ id: "noFdr", foldChange: 9 }];
            assert.deepStrictEqual(filterGenes(rows, { fdr: 0.05, fc: 1 }), []);
        });

        it("returns [] for empty/null input and does not mutate", function () {
            assert.deepStrictEqual(filterGenes([], { fdr: 1, fc: 0 }), []);
            assert.deepStrictEqual(filterGenes(null, { fdr: 1, fc: 0 }), []);
            const fx = makeFixture();
            const before = ids(fx);
            filterGenes(fx, { fdr: 0.05, fc: 0.5 });
            assert.deepStrictEqual(ids(fx), before);
        });
    });

    describe("selectTopGenes", function () {
        it("returns at most topN genes", function () {
            const top = selectTopGenes(makeFixture(), { fdr: 1, fc: 0, topN: 2 });
            assert.strictEqual(top.length, 2);
        });

        it("returns only genes passing the thresholds", function () {
            const top = selectTopGenes(makeFixture(), { fdr: 0.05, fc: 0.5, topN: 10 });
            assert.ok(top.every((g) => (g.pValueFDR ?? 1) < 0.05 && Math.abs(g.foldChange) > 0.5));
            assert.ok(!ids(top).includes("a")); // a fails FDR
        });

        it("orders by pValue ascending", function () {
            // No filter: pValue order a(.001), c(.002), e(.004), b(.010), d(.050)
            const top = selectTopGenes(makeFixture(), { fdr: 1, fc: 0, topN: 3 });
            assert.deepStrictEqual(ids(top), ["a", "c", "e"]);
        });

        it("filters BEFORE taking the top N (not top-then-filter)", function () {
            // With fdr 0.05, fc 0.5, 'a' (lowest pValue) is filtered out, so top-2
            // are c(.002) then e(.004), NOT a.
            const top = selectTopGenes(makeFixture(), { fdr: 0.05, fc: 0.5, topN: 2 });
            assert.deepStrictEqual(ids(top), ["c", "e"]);
        });

        it("sorts genes with missing pValue last", function () {
            const rows = [
                { id: "miss", pValueFDR: 0.0, foldChange: 9 },
                { id: "good", pValue: 0.01, pValueFDR: 0.0, foldChange: 9 },
            ];
            const top = selectTopGenes(rows, { fdr: 1, fc: 0, topN: 2 });
            assert.deepStrictEqual(ids(top), ["good", "miss"]);
        });

        it("topN of 0/NaN/undefined returns [] without throwing", function () {
            const fx = makeFixture();
            assert.deepStrictEqual(selectTopGenes(fx, { fdr: 1, fc: 0, topN: 0 }), []);
            assert.deepStrictEqual(selectTopGenes(fx, { fdr: 1, fc: 0, topN: "abc" }), []);
            assert.deepStrictEqual(selectTopGenes(fx, { fdr: 1, fc: 0, topN: undefined }), []);
        });

        it("accepts a numeric string for topN (as the UI passes it)", function () {
            const top = selectTopGenes(makeFixture(), { fdr: 1, fc: 0, topN: "2" });
            assert.deepStrictEqual(ids(top), ["a", "c"]);
        });

        it("does not mutate the input array", function () {
            const fx = makeFixture();
            const before = ids(fx);
            selectTopGenes(fx, { fdr: 0.05, fc: 0.5, topN: 2 });
            assert.deepStrictEqual(ids(fx), before);
        });
    });

    describe("selectAnalysisDEGenes", function () {
        // Predicate: pValueFDR <= maxAdjustedPValue && |foldChange| >= minLogFoldChange
        // (inclusive boundaries, matching the volcano "Export DE genes" / server DEGenes),
        // sorted by pValueFDR ascending.
        it("selects only the analysis's DE genes at the given thresholds, sorted by FDR asc", function () {
            const de = selectAnalysisDEGenes(makeFixture(), { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 });
            // a excluded (FDR .20); b,c,d,e pass. FDR order: b(.010), c(.010), e(.030), d(.040).
            assert.deepStrictEqual(ids(de), ["b", "c", "e", "d"]);
        });

        it("uses INCLUSIVE boundaries (>= / <=), unlike the strict 'select top' filter", function () {
            const rows = [{ id: "edge", pValueFDR: 0.05, foldChange: 0.5 }];
            assert.deepStrictEqual(ids(selectAnalysisDEGenes(rows, { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 })), ["edge"]);
            // the strict tunable filter would drop it:
            assert.deepStrictEqual(filterGenes(rows, { fdr: 0.05, fc: 0.5 }), []);
        });

        it("falls back to 0.05 / 0.5 when thresholds are missing or non-numeric", function () {
            const byDefault = selectAnalysisDEGenes(makeFixture(), {});
            const explicit = selectAnalysisDEGenes(makeFixture(), { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 });
            assert.deepStrictEqual(ids(byDefault), ids(explicit));
            assert.deepStrictEqual(ids(selectAnalysisDEGenes(makeFixture(), { maxAdjustedPValue: "oops", minLogFoldChange: null })), ids(explicit));
        });

        it("accepts numeric-string thresholds (as configs may store them)", function () {
            const de = selectAnalysisDEGenes(makeFixture(), { maxAdjustedPValue: "0.05", minLogFoldChange: "0.5" });
            assert.deepStrictEqual(ids(de), ["b", "c", "e", "d"]);
        });

        it("keeps the wizard gene shape (foldChange) and leaves no FC alias behind", function () {
            const de = selectAnalysisDEGenes(makeFixture(), { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 });
            assert.ok(de.every(g => "foldChange" in g && !("FC" in g)));
        });

        it("does not mutate the input and returns a fresh array", function () {
            const fx = makeFixture();
            const before = ids(fx);
            const de = selectAnalysisDEGenes(fx, { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 });
            assert.notStrictEqual(de, fx);
            assert.deepStrictEqual(ids(fx), before);
        });

        it("returns [] for empty/null input", function () {
            assert.deepStrictEqual(selectAnalysisDEGenes([], { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 }), []);
            assert.deepStrictEqual(selectAnalysisDEGenes(null, {}), []);
        });

        it("excludes genes missing pValueFDR or foldChange (no rescue, unlike filterGenes)", function () {
            const rows = [
                { id: "noFDR", foldChange: 5 },        // undefined <= 0.05 -> false -> excluded
                { id: "noFC", pValueFDR: 0.001 },      // |undefined| >= 0.5 -> false -> excluded
                { id: "ok", pValueFDR: 0.001, foldChange: 5 },
            ];
            assert.deepStrictEqual(ids(selectAnalysisDEGenes(rows, { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 })), ["ok"]);
        });

        it("yields the SAME set as the volcano 'Export DE genes' for the same thresholds (end-to-end intent)", function () {
            const fx = makeFixture();
            const viaDE = ids(selectAnalysisDEGenes(fx, { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 }));
            const viaExport = ids(selectGenesForExport(
                fx.map(g => ({ ...g, FC: g.foldChange })),
                { mode: "de", maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 }
            ));
            assert.deepStrictEqual(viaDE, viaExport);
            assert.deepStrictEqual(viaDE, ["b", "c", "e", "d"]);
        });
    });

    describe("non-finite values and the select-all sentinel", function () {
        // The auto-select / "keep everything" path calls with {fdr: Infinity, fc: -Infinity}.
        // It must retain EVERY gene, including ones with 0 / missing / NaN / Infinity values.
        const SENTINEL = { fdr: Infinity, fc: -Infinity };

        it("keeps a gene with foldChange exactly 0 under the select-all sentinel", function () {
            assert.deepStrictEqual(ids(filterGenes([{ id: "z", pValueFDR: 0.5, foldChange: 0 }], SENTINEL)), ["z"]);
        });

        it("keeps a gene with missing foldChange/FDR under the select-all sentinel", function () {
            const rows = [{ id: "noFc", pValueFDR: 0.5 }, { id: "noFdr", foldChange: 2 }, { id: "bare" }];
            assert.deepStrictEqual(ids(filterGenes(rows, SENTINEL)).sort(), ["bare", "noFc", "noFdr"]);
        });

        it("keeps a gene with NaN foldChange under the select-all sentinel (regression)", function () {
            assert.deepStrictEqual(ids(filterGenes([{ id: "nan", pValueFDR: 0.01, foldChange: NaN }], SENTINEL)), ["nan"]);
        });

        it("keeps a gene with NaN / Infinity FDR under the select-all sentinel (regression)", function () {
            const rows = [{ id: "nanFdr", pValueFDR: NaN, foldChange: 2 }, { id: "infFdr", pValueFDR: Infinity, foldChange: 2 }];
            assert.deepStrictEqual(ids(filterGenes(rows, SENTINEL)).sort(), ["infFdr", "nanFdr"]);
        });

        it("selectTopGenes with the sentinel keeps NaN-foldChange genes (ordered by pValue)", function () {
            const rows = [
                { id: "a", pValue: 0.001, pValueFDR: 0.01, foldChange: NaN },
                { id: "b", pValue: 0.002, pValueFDR: 0.01, foldChange: 0 },
            ];
            assert.deepStrictEqual(ids(selectTopGenes(rows, { ...SENTINEL, topN: 99 })), ["a", "b"]);
        });

        it("a non-finite foldChange is still excluded by a real positive |Log2FC| filter", function () {
            assert.deepStrictEqual(filterGenes([{ id: "nan", pValueFDR: 0.0, foldChange: NaN }], { fdr: 0.05, fc: 1 }), []);
        });

        it("does not mutate the source order even when nothing is filtered out", function () {
            const src = [
                { id: "hi", pValue: 0.9, pValueFDR: 0.01, foldChange: 5 },
                { id: "lo", pValue: 0.1, pValueFDR: 0.01, foldChange: 5 },
            ];
            selectTopGenes(src, { ...SENTINEL, topN: 2 }); // would reorder if it sorted in place
            assert.deepStrictEqual(ids(src), ["hi", "lo"]);
        });
    });

    describe("originalDEThresholds (Use all DE Genes uses the ORIGINAL definition)", function () {
        it("prefers the original snapshot thresholds over the live/working ones", function () {
            const cfg = {
                originalMaxAdjustedPValue: 0.05,
                originalMinLogFoldChange: 0.5,
                maxAdjustedPValue: 0.001, // tuned in the volcano (working)
                minLogFoldChange: 2.0,
            };
            assert.deepStrictEqual(originalDEThresholds(cfg), {
                maxAdjustedPValue: 0.05,
                minLogFoldChange: 0.5,
            });
        });

        it("falls back to the live/working value when no original is present (meta/legacy)", function () {
            const cfg = { maxAdjustedPValue: 0.01, minLogFoldChange: 1.0 };
            assert.deepStrictEqual(originalDEThresholds(cfg), {
                maxAdjustedPValue: 0.01,
                minLogFoldChange: 1.0,
            });
        });

        it("tolerates a missing/empty config", function () {
            assert.deepStrictEqual(originalDEThresholds(), { maxAdjustedPValue: undefined, minLogFoldChange: undefined });
            assert.deepStrictEqual(originalDEThresholds(null), { maxAdjustedPValue: undefined, minLogFoldChange: undefined });
        });

        it("preserves a legitimate falsy original (minLogFoldChange 0), not falling through to working (locks ?? vs ||)", function () {
            const cfg = { originalMaxAdjustedPValue: 0.05, originalMinLogFoldChange: 0, maxAdjustedPValue: 0.05, minLogFoldChange: 2 };
            assert.deepStrictEqual(originalDEThresholds(cfg), { maxAdjustedPValue: 0.05, minLogFoldChange: 0 },
                "original 0 must be kept (|| would wrongly fall through to the working 2)");
        });

        it("characterization: with NO original snapshot, Use-all-DE-Genes uses the tuned working values (meta/legacy)", function () {
            // A config that only ever got the live/working values overlaid (no original*), e.g. a
            // meta-analysis or a legacy config. originalDEThresholds falls back to the working
            // values — documenting that recovery of a distinct "original" isn't possible here.
            const cfg = { analysisId: "m1", inputType: "expression", maxAdjustedPValue: 0.02, minLogFoldChange: 1.5 };
            applyLiveDEThresholdOverlay({ m1: cfg }, [
                { analysisId: "m1", inputType: "expression", key: "maxAdjustedPValue", value: 0.001 },
            ]);
            assert.deepStrictEqual(originalDEThresholds(cfg), { maxAdjustedPValue: 0.001, minLogFoldChange: 1.5 },
                "no original → falls back to the (now tuned) working values");
        });

        // The core regression: after the user tunes the volcano plot (which now only changes the
        // WORKING thresholds), "Use all DE Genes" must still recover the ORIGINAL DE set.
        it("recovers the original DE set even after the working thresholds are tightened", function () {
            const cfg = {
                originalMaxAdjustedPValue: 0.05,
                originalMinLogFoldChange: 0.5,
                // user tightened the volcano to a strict view that admits far fewer genes:
                maxAdjustedPValue: 0.011,
                minLogFoldChange: 2.0,
            };
            const original = selectAnalysisDEGenes(makeFixture(), originalDEThresholds(cfg));
            assert.deepStrictEqual(ids(original), ["b", "c", "e", "d"], "full original DE set");

            // Selecting with the tuned WORKING thresholds would have lost most of them...
            const workingView = selectAnalysisDEGenes(makeFixture(), {
                maxAdjustedPValue: cfg.maxAdjustedPValue,
                minLogFoldChange: cfg.minLogFoldChange,
            });
            assert.deepStrictEqual(ids(workingView), ["b"], "strict working view keeps only |FC|>=2 & FDR<=0.011");
            assert.ok(original.length > workingView.length, "original recovers more than the tuned view");
        });
    });

    describe("stampSnapshotThreshold (snapshot immutability write path)", function () {
        it("sets BOTH the original and the working default for a DE threshold key", function () {
            const cfg = { inputType: "expression" };
            stampSnapshotThreshold(cfg, "maxAdjustedPValue", 0.05);
            stampSnapshotThreshold(cfg, "minLogFoldChange", 0.5);
            assert.strictEqual(cfg.originalMaxAdjustedPValue, 0.05);
            assert.strictEqual(cfg.maxAdjustedPValue, 0.05);
            assert.strictEqual(cfg.originalMinLogFoldChange, 0.5);
            assert.strictEqual(cfg.minLogFoldChange, 0.5);
        });

        it("regression: the original survives a subsequent working-value overlay (volcano tuning)", function () {
            const cfg = { analysisId: "a1", inputType: "expression" };
            stampSnapshotThreshold(cfg, "maxAdjustedPValue", 0.05);
            stampSnapshotThreshold(cfg, "minLogFoldChange", 0.5);
            // user tunes the volcano → live overlay changes the WORKING values only
            applyLiveDEThresholdOverlay({ a1: cfg }, [
                { analysisId: "a1", inputType: "expression", key: "maxAdjustedPValue", value: 0.001 },
                { analysisId: "a1", inputType: "expression", key: "minLogFoldChange", value: 3 },
            ]);
            assert.deepStrictEqual(originalDEThresholds(cfg), { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 }, "original recoverable");
            assert.strictEqual(cfg.maxAdjustedPValue, 0.001, "working value reflects tuning");
        });

        it("is a no-op for non-DE keys and tolerates a missing config", function () {
            const cfg = { inputType: "expression" };
            stampSnapshotThreshold(cfg, "idType", "entrez");
            assert.ok(!("originalMaxAdjustedPValue" in cfg));
            assert.doesNotThrow(() => stampSnapshotThreshold(null, "maxAdjustedPValue", 0.05));
        });
    });

    describe("applyLiveDEThresholdOverlay (getConfigurations working-vs-original split)", function () {
        const cfgs = () => ({
            a1: { analysisId: "a1", inputType: "expression", maxAdjustedPValue: 0.05, minLogFoldChange: 0.5, originalMaxAdjustedPValue: 0.05, originalMinLogFoldChange: 0.5 },
            a2: { analysisId: "a2", inputType: "expression", maxAdjustedPValue: 0.05, minLogFoldChange: 0.5, originalMaxAdjustedPValue: 0.05, originalMinLogFoldChange: 0.5 },
        });

        it("overlays working values onto maxAdjustedPValue/minLogFoldChange, leaving original* untouched", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "expression", key: "maxAdjustedPValue", value: 0.01 },
                { analysisId: "a1", inputType: "expression", key: "minLogFoldChange", value: 2.0 },
            ]);
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.01, "working value applied");
            assert.strictEqual(all.a1.minLogFoldChange, 2.0);
            assert.strictEqual(all.a1.originalMaxAdjustedPValue, 0.05, "original preserved");
            assert.strictEqual(all.a1.originalMinLogFoldChange, 0.5);
            // untouched analysis keeps defaults
            assert.strictEqual(all.a2.maxAdjustedPValue, 0.05);
        });

        it("does NOT bleed a live row from a different inputType", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "ora", key: "maxAdjustedPValue", value: 0.999 },
            ]);
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.05, "mismatched inputType ignored → original default kept");
        });

        it("ignores non-threshold keys and tolerates empty/missing input", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [{ analysisId: "a1", inputType: "expression", key: "geneStats", value: 123 }]);
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.05);
            assert.doesNotThrow(() => applyLiveDEThresholdOverlay(all, undefined));
            assert.doesNotThrow(() => applyLiveDEThresholdOverlay({}, []));
        });

        it("does NOT apply a live row whose inputType is missing/blank (strict key contract)", function () {
            const all = cfgs(); // a1.inputType === 'expression'
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", key: "maxAdjustedPValue", value: 0.999 }, // no inputType
            ]);
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.05, "row without inputType does not match a config that has one");
        });

        it("ignores a live row for an analysisId that has no matching config (no throw, no cross-write)", function () {
            const all = cfgs();
            assert.doesNotThrow(() => applyLiveDEThresholdOverlay(all, [
                { analysisId: "ghost", inputType: "expression", key: "maxAdjustedPValue", value: 0.001 },
            ]));
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.05);
            assert.strictEqual(all.a2.maxAdjustedPValue, 0.05);
        });

        it("does not apply a live row when the config lacks inputType (undefined !== 'expression')", function () {
            const all = { a1: { analysisId: "a1", maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 } }; // no inputType
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "expression", key: "maxAdjustedPValue", value: 0.001 },
            ]);
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.05, "config without inputType is not matched by an inputType-keyed row");
        });

        it("overlays a working value of exactly 0 (guards against a truthiness regression)", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "expression", key: "minLogFoldChange", value: 0 },
            ]);
            assert.strictEqual(all.a1.minLogFoldChange, 0, "0 is a valid working threshold, not skipped");
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.05, "untouched key keeps its default");
        });

        it("overlays a numeric-string working value (as AnalysisConfig may store it)", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "expression", key: "maxAdjustedPValue", value: "0.01" },
            ]);
            assert.strictEqual(all.a1.maxAdjustedPValue, "0.01");
        });

        it("applies a partial overlay (only maxAdjustedPValue present) leaving the other at its default", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "expression", key: "maxAdjustedPValue", value: 0.01 },
            ]);
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.01);
            assert.strictEqual(all.a1.minLogFoldChange, 0.5, "absent key keeps the original default");
        });

        it("end-to-end: after overlay, Use-all-DE-Genes (original) differs from the tuned working view", function () {
            const all = cfgs();
            applyLiveDEThresholdOverlay(all, [
                { analysisId: "a1", inputType: "expression", key: "maxAdjustedPValue", value: 0.011 },
                { analysisId: "a1", inputType: "expression", key: "minLogFoldChange", value: 2.0 },
            ]);
            // originalDEThresholds still returns the immutable original definition
            assert.deepStrictEqual(originalDEThresholds(all.a1), { maxAdjustedPValue: 0.05, minLogFoldChange: 0.5 });
            // whereas the working (volcano) thresholds are the tuned values
            assert.strictEqual(all.a1.maxAdjustedPValue, 0.011);
            assert.strictEqual(all.a1.minLogFoldChange, 2.0);
        });
    });

    describe("constants", function () {
        it("DEFAULT_GENE_TOP_N is 5", function () {
            assert.strictEqual(DEFAULT_GENE_TOP_N, 5);
        });
    });
});

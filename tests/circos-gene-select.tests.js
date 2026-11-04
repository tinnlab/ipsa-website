// Circos gene target + highlight set + node/relation graph (pure).
//
// Regression context: the Circos build effect rendered EVERY DE gene of every displayed
// pathway, uncapped, and circos-d3 allocates a dense N x N chord matrix over them
// (imports/client/components/circos-d3/index.js:50-57) — quadratic and illegible at a few
// hundred genes. It also resolved every relation with
// `inputGenesArr.find(e => e.name === gene).id`, which throws the instant any gene is
// missing from the node list, i.e. the instant a cap exists — inside a try whose catch
// only console.errors, so the chart silently kept stale data.
import assert from "assert";
import {
    DEFAULT_CIRCOS_GENE_TOP_N,
    UNCAPPED,
    compareGenesByRank,
    normalizeGeneCap,
    mapPathwayGenesToSymbols,
    selectCircosGenes,
    buildCircosGraph,
    describeGeneSelection,
} from "../imports/utils/circosGeneSelect";

// --- Fixture -----------------------------------------------------------------------------
// DE genes in DELIBERATELY SCRAMBLED input order, so any test that passes only because the
// input happened to be sorted will fail. Note DEGenes carries pValueFDR and NOT raw pValue.
//
//   symbol  _id    pValueFDR  FC     expected rank  why
//   TP53    7157   0.001      +2.0   1              best FDR
//   MYC     4609   0.010      -3.0   2              FDR ties, largest |FC| wins (sign-blind)
//   EGFR    1956   0.010      +1.5   3              FDR and |FC| tie, symbol EGFR < KRAS
//   KRAS    3845   0.010      -1.5   4              FDR and |FC| tie, symbol KRAS > EGFR
//   FOS     2353   NaN        +1.0   5              non-finite FDR ranks last
//   NOPATH  9999   0.0001     +5.0   —              best FDR of all, but in NO pathway
//   TP53    7158   0.020      +1.1   —              duplicate SYMBOL, worse rank -> dropped
const RANKED = ["TP53", "MYC", "EGFR", "KRAS", "FOS"];

const makeGenes = () => [
    {_id: "1956", symbol: "EGFR", FC: 1.5, pValueFDR: 0.010},
    {_id: "2353", symbol: "FOS", FC: 1.0, pValueFDR: NaN},
    {_id: "9999", symbol: "NOPATH", FC: 5.0, pValueFDR: 0.0001},
    {_id: "7157", symbol: "TP53", FC: 2.0, pValueFDR: 0.001},
    {_id: "3845", symbol: "KRAS", FC: -1.5, pValueFDR: 0.010},
    {_id: "7158", symbol: "TP53", FC: 1.1, pValueFDR: 0.020},
    {_id: "4609", symbol: "MYC", FC: -3.0, pValueFDR: 0.010},
];

// Pathways in display order. P4 has no DE gene at all (pre-existing, not caused by a cap).
const makePathways = () => [
    {id: "P1", name: "Apoptosis", genes: ["TP53", "MYC"]},
    {id: "P2", name: "Signalling", genes: ["EGFR", "KRAS"]},
    {id: "P3", name: "Immediate early", genes: ["FOS"]},
    {id: "P4", name: "Empty", genes: []},
];

const symbols = (rows) => rows.map((r) => r.symbol);
const names = (nodes) => nodes.map((n) => n.name);
const geneNodes = (nodes) => nodes.filter((n) => n.type === "gene");
const pathwayNodes = (nodes) => nodes.filter((n) => n.type === "pathway");
const COLORS = ["#AAA", "#BBB", "#CCC"];

describe("circosGeneSelect", function () {
    describe("compareGenesByRank", function () {
        it("ranks by pValueFDR ascending, smallest first", function () {
            const sorted = makeGenes()
                .filter((g) => g.symbol !== "NOPATH" && g._id !== "7158")
                .sort(compareGenesByRank);
            assert.deepStrictEqual(symbols(sorted), RANKED);
        });

        it("sorts a non-finite or missing pValueFDR last", function () {
            for (const bad of [NaN, undefined, null, Number.POSITIVE_INFINITY]) {
                const rows = [
                    {symbol: "BAD", _id: "b", FC: 9, pValueFDR: bad},
                    {symbol: "GOOD", _id: "g", FC: 0.1, pValueFDR: 0.5},
                ];
                assert.deepStrictEqual(symbols(rows.sort(compareGenesByRank)), ["GOOD", "BAD"]);
            }
        });

        it("returns a real number, not NaN, when BOTH pValueFDR are missing", function () {
            // Infinity - Infinity is NaN; a NaN comparator result silently corrupts a sort.
            const a = {symbol: "A", _id: "1", FC: 1, pValueFDR: NaN};
            const b = {symbol: "B", _id: "2", FC: 1, pValueFDR: NaN};
            const out = compareGenesByRank(a, b);
            assert.ok(Number.isFinite(out), `expected a finite comparator result, got ${out}`);
            assert.ok(out < 0, "falls through to the symbol tie-break: A before B");
        });

        it("returns a real number when both |FC| are also missing", function () {
            const a = {symbol: "A", _id: "1", FC: NaN, pValueFDR: NaN};
            const b = {symbol: "B", _id: "2", FC: undefined, pValueFDR: NaN};
            const out = compareGenesByRank(a, b);
            assert.ok(Number.isFinite(out), `expected a finite result, got ${out}`);
            // Assert the ORDER too, not merely finiteness: `assert.ok(Number.isFinite(...))`
            // alone would also pass for a comparator that always returned 0.
            assert.ok(out < 0, "falls through to the symbol tie-break: A before B");
        });

        it("tie-breaks an equal FDR by larger absolute log2FC, sign-blind", function () {
            const a = {symbol: "A", _id: "1", FC: -3.0, pValueFDR: 0.01};
            const b = {symbol: "B", _id: "2", FC: 1.5, pValueFDR: 0.01};
            assert.ok(compareGenesByRank(a, b) < 0, "|-3.0| beats |1.5| despite the sign");
        });

        it("tie-breaks an equal FDR and equal |FC| by symbol, A->Z", function () {
            // The _id order is deliberately the OPPOSITE of the symbol order, so this fails
            // if the symbol key is dropped and the _id fallback decides instead.
            const a = {symbol: "AAA", _id: "9", FC: 1.5, pValueFDR: 0.01};
            const b = {symbol: "ZZZ", _id: "1", FC: -1.5, pValueFDR: 0.01};
            assert.ok(compareGenesByRank(a, b) < 0, "AAA before ZZZ despite _id 9 > 1");
            assert.ok(compareGenesByRank(b, a) > 0, "and the reverse, so it is antisymmetric");
        });

        it("tie-breaks identical symbols by _id, so the order is TOTAL", function () {
            const a = {symbol: "TP53", _id: "7157", FC: 2, pValueFDR: 0.01};
            const b = {symbol: "TP53", _id: "7158", FC: 2, pValueFDR: 0.01};
            assert.ok(compareGenesByRank(a, b) < 0);
            assert.strictEqual(compareGenesByRank(a, a), 0, "only fully-equal rows compare equal");
        });

        it("is order-independent: a shuffled input yields the identical ranking", function () {
            const base = makeGenes().sort(compareGenesByRank);
            const reversed = makeGenes().reverse().sort(compareGenesByRank);
            assert.deepStrictEqual(symbols(reversed), symbols(base));
        });

        it("does not throw on null / empty genes", function () {
            assert.doesNotThrow(() => compareGenesByRank(null, {}));
            assert.doesNotThrow(() => compareGenesByRank({}, undefined));
        });
    });

    describe("normalizeGeneCap", function () {
        it("accepts a numeric string as the UI passes it", function () {
            assert.strictEqual(normalizeGeneCap("40"), 40);
            assert.strictEqual(normalizeGeneCap(40), 40);
        });

        it("parseInts a trailing-garbage string", function () {
            assert.strictEqual(normalizeGeneCap("40abc"), 40);
        });

        it("floors a fractional target", function () {
            assert.strictEqual(normalizeGeneCap("7.9"), 7);
        });

        it("falls back to the default for unusable values rather than selecting nothing", function () {
            // Deliberately unlike selectTopSignificantGeneIds, which returns []: an empty
            // gene set here blanks the whole chart.
            for (const bad of [0, -5, "", "abc", null, undefined, NaN]) {
                assert.strictEqual(normalizeGeneCap(bad), DEFAULT_CIRCOS_GENE_TOP_N, `for ${String(bad)}`);
            }
        });

        it("returns UNCAPPED for Infinity and 'all'", function () {
            assert.strictEqual(normalizeGeneCap(Infinity), UNCAPPED);
            assert.strictEqual(normalizeGeneCap("all"), UNCAPPED);
        });

        it("DEFAULT_CIRCOS_GENE_TOP_N is 15", function () {
            assert.strictEqual(DEFAULT_CIRCOS_GENE_TOP_N, 15);
        });
    });

    describe("mapPathwayGenesToSymbols", function () {
        const raw = () => [
            {id: "P1", name: "Apoptosis", genes: ["7157", "4609", "0000"]}, // 0000 is not DE
            {id: "P4", name: "Empty", genes: ["0000"]},
        ];

        it("replaces gene ids with symbols and drops non-DE ids", function () {
            const out = mapPathwayGenesToSymbols(raw(), makeGenes());
            assert.deepStrictEqual(out[0].genes, ["TP53", "MYC"]);
        });

        it("yields an empty genes array for a pathway with no DE gene (pre-existing, not an error)", function () {
            const out = mapPathwayGenesToSymbols(raw(), makeGenes());
            assert.deepStrictEqual(out[1].genes, []);
        });

        it("preserves the other pathway fields", function () {
            const out = mapPathwayGenesToSymbols(raw(), makeGenes());
            assert.strictEqual(out[0].id, "P1");
            assert.strictEqual(out[0].name, "Apoptosis");
        });

        it("drops a DE row with a missing or empty symbol instead of emitting an undefined node name", function () {
            const de = [{_id: "1", symbol: undefined, FC: 1, pValueFDR: 0.01}, {_id: "2", symbol: "", FC: 1, pValueFDR: 0.01}];
            const out = mapPathwayGenesToSymbols([{id: "P", genes: ["1", "2"]}], de);
            assert.deepStrictEqual(out[0].genes, []);
        });

        it("does not mutate the inputs", function () {
            const pathways = raw();
            const de = makeGenes();
            const beforeP = JSON.stringify(pathways);
            const beforeD = JSON.stringify(de);
            mapPathwayGenesToSymbols(pathways, de);
            assert.strictEqual(JSON.stringify(pathways), beforeP);
            assert.strictEqual(JSON.stringify(de), beforeD);
        });

        it("tolerates null/undefined inputs and a pathway with no genes key", function () {
            assert.deepStrictEqual(mapPathwayGenesToSymbols(null, null), []);
            assert.deepStrictEqual(mapPathwayGenesToSymbols(undefined, makeGenes()), []);
            assert.deepStrictEqual(mapPathwayGenesToSymbols([{id: "P"}], makeGenes())[0].genes, []);
        });
    });

    describe("selectCircosGenes — the target", function () {
        it("caps to topN, keeping the best-ranked genes in rank order", function () {
            const {genes} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 5, guaranteeOnePerPathway: false,
            });
            assert.deepStrictEqual(symbols(genes), RANKED);
            const two = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 2, guaranteeOnePerPathway: false,
            });
            assert.deepStrictEqual(symbols(two.genes), ["TP53", "MYC"]);
        });

        it("never pads when topN exceeds the candidate count", function () {
            const {genes, stats} = selectCircosGenes(makePathways(), makeGenes(), {topN: 500});
            assert.strictEqual(genes.length, 5);
            assert.strictEqual(stats.selectedGeneCount, 5);
            assert.strictEqual(stats.droppedGeneCount, 0);
        });

        it("returns every candidate for UNCAPPED", function () {
            const {genes} = selectCircosGenes(makePathways(), makeGenes(), {topN: "all"});
            assert.deepStrictEqual(symbols(genes), RANKED);
        });

        it("attributes nothing to a guarantee under UNCAPPED, since everything ranks in", function () {
            // Guards the Infinity branch of the wouldRank slice: with no cap, no gene is
            // ever pinned or forced, so the caption must stay silent.
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: "all", highlightedSymbols: ["FOS"],
            });
            assert.strictEqual(stats.pinnedHighlightCount, 0);
            assert.strictEqual(stats.coverageGeneCount, 0);
            assert.strictEqual(stats.capRaised, false);
            assert.strictEqual(describeGeneSelection(stats), "Showing 5 of 5 genes.");
        });

        it("excludes a DE gene that is in no displayed pathway, even though it ranks best", function () {
            const {genes} = selectCircosGenes(makePathways(), makeGenes(), {topN: 500});
            assert.ok(!symbols(genes).includes("NOPATH"), "NOPATH has the best FDR but no pathway");
        });

        it("accepts a numeric string topN as the UI passes it", function () {
            const {genes} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: "2", guaranteeOnePerPathway: false,
            });
            assert.strictEqual(genes.length, 2);
        });

        it("reports consistent counts", function () {
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 2, guaranteeOnePerPathway: false,
            });
            assert.strictEqual(stats.totalCandidateGenes, 5);
            assert.strictEqual(stats.selectedGeneCount, 2);
            assert.strictEqual(stats.droppedGeneCount, 3);
        });

        it("does not mutate the inputs", function () {
            const pathways = makePathways();
            const de = makeGenes();
            const beforeP = JSON.stringify(pathways);
            const beforeD = JSON.stringify(de);
            selectCircosGenes(pathways, de, {topN: 2});
            assert.strictEqual(JSON.stringify(pathways), beforeP);
            assert.strictEqual(JSON.stringify(de), beforeD);
        });
    });

    describe("selectCircosGenes — highlights survive the target", function () {
        it("keeps a highlighted gene the target would otherwise discard", function () {
            // FOS ranks LAST. With topN 1 and no guarantee it could never survive on rank —
            // it takes the single slot instead of the top-ranked TP53. A highlight the cap
            // discards is a bug; a highlight that DISPLACES within the budget is correct.
            const {genes, stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 1, highlightedSymbols: ["FOS"], guaranteeOnePerPathway: false,
            });
            assert.deepStrictEqual(symbols(genes), ["FOS"]);
            assert.strictEqual(stats.pinnedHighlightCount, 1, "it would not have ranked");
            assert.strictEqual(stats.capRaised, false, "one highlight still FITS a target of 1");
        });

        it("matches highlights case-insensitively and trims whitespace", function () {
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 1, highlightedSymbols: ["  tp53 "], guaranteeOnePerPathway: false,
            });
            assert.deepStrictEqual(stats.highlightedKept, ["TP53"], "canonical casing is restored");
            assert.deepStrictEqual(stats.highlightedNotFound, []);
        });

        it("de-duplicates TP53 / tp53 into one kept gene", function () {
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 1, highlightedSymbols: ["TP53", "tp53"], guaranteeOnePerPathway: false,
            });
            assert.deepStrictEqual(stats.highlightedKept, ["TP53"]);
        });

        it("reports a highlight that is in no displayed pathway, with its original casing, and fabricates no node", function () {
            const {genes, stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 5, highlightedSymbols: ["NoPath", "GHOST"],
            });
            assert.deepStrictEqual(stats.highlightedNotFound, ["NoPath", "GHOST"]);
            assert.ok(!symbols(genes).includes("NoPath"));
            assert.ok(!symbols(genes).includes("GHOST"));
        });

        it("does NOT count a highlight that would have ranked anyway as pinned", function () {
            // TP53 is rank 1, so at topN 5 it needs no pinning.
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 5, highlightedSymbols: ["TP53"], guaranteeOnePerPathway: false,
            });
            assert.strictEqual(stats.pinnedHighlightCount, 0);
            assert.strictEqual(stats.capRaised, false);
        });

        it("raises the applied target so EVERY highlight survives", function () {
            const {genes, stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 1, highlightedSymbols: ["FOS", "KRAS", "EGFR"], guaranteeOnePerPathway: false,
            });
            for (const s of ["FOS", "KRAS", "EGFR"]) assert.ok(symbols(genes).includes(s), s);
            assert.strictEqual(stats.appliedCap, 3);
            assert.strictEqual(stats.capRaised, true);
        });

        it("treats an empty / null / undefined highlight set as no highlights", function () {
            for (const h of [[], null, undefined]) {
                const {stats} = selectCircosGenes(makePathways(), makeGenes(), {topN: 5, highlightedSymbols: h});
                assert.deepStrictEqual(stats.highlightedKept, []);
                assert.strictEqual(stats.capRaised, false);
            }
        });

        it("ignores null / empty-string entries in the highlight list", function () {
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 5, highlightedSymbols: [null, "", "   ", "TP53"],
            });
            assert.deepStrictEqual(stats.highlightedKept, ["TP53"]);
            assert.deepStrictEqual(stats.highlightedNotFound, []);
        });

        // Two DE rows whose symbols differ only by case are DIFFERENT genes. Folding them
        // together resolved a highlight to the wrong gene and silently discarded the other,
        // with no not-found report — the one failure mode this feature must not have.
        describe("symbols differing only by case are distinct genes", function () {
            const caseGenes = () => [
                {_id: "1", symbol: "TP53", FC: 2.0, pValueFDR: 0.001},
                {_id: "2", symbol: "Tp53", FC: 0.2, pValueFDR: 0.900},
                {_id: "3", symbol: "AAA", FC: 1.0, pValueFDR: 0.002},
                {_id: "4", symbol: "BBB", FC: 1.0, pValueFDR: 0.003},
            ];
            const casePaths = () => [{id: "P1", genes: ["TP53", "Tp53", "AAA", "BBB"]}];

            it("an exact-case highlight resolves to that exact gene, not the other spelling", function () {
                const {genes, stats} = selectCircosGenes(casePaths(), caseGenes(), {
                    topN: 1, highlightedSymbols: ["Tp53"], guaranteeOnePerPathway: false,
                });
                assert.deepStrictEqual(stats.highlightedKept, ["Tp53"]);
                assert.deepStrictEqual(genes.map((g) => g._id), ["2"], "the Tp53 row, not TP53");
            });

            it("highlighting both spellings keeps BOTH genes and drops neither silently", function () {
                const {genes, stats} = selectCircosGenes(casePaths(), caseGenes(), {
                    topN: 1, highlightedSymbols: ["TP53", "Tp53"], guaranteeOnePerPathway: false,
                });
                assert.deepStrictEqual(stats.highlightedKept, ["TP53", "Tp53"]);
                assert.deepStrictEqual(symbols(genes), ["TP53", "Tp53"]);
                assert.deepStrictEqual(stats.highlightedNotFound, []);
            });

            it("is independent of DE arrival order", function () {
                const forward = selectCircosGenes(casePaths(), caseGenes(), {
                    topN: 1, highlightedSymbols: ["Tp53"], guaranteeOnePerPathway: false,
                });
                const reversed = selectCircosGenes(casePaths(), caseGenes().reverse(), {
                    topN: 1, highlightedSymbols: ["Tp53"], guaranteeOnePerPathway: false,
                });
                assert.deepStrictEqual(forward.stats.highlightedKept, reversed.stats.highlightedKept);
            });

            it("still folds case when only ONE spelling exists (the convenience case)", function () {
                const {stats} = selectCircosGenes(makePathways(), makeGenes(), {
                    topN: 5, highlightedSymbols: ["tp53"],
                });
                assert.deepStrictEqual(stats.highlightedKept, ["TP53"]);
            });
        });
    });

    describe("selectCircosGenes — the per-pathway guarantee", function () {
        it("keeps each pathway's best-ranked gene when topN is smaller than the pathway count", function () {
            const {genes} = selectCircosGenes(makePathways(), makeGenes(), {topN: 1});
            // P1 -> TP53 (rank 1), P2 -> EGFR (rank 3, beats KRAS), P3 -> FOS. P4 has none.
            assert.deepStrictEqual(symbols(genes), ["TP53", "EGFR", "FOS"]);
        });

        it("does not spend a second slot on a pathway already covered by a highlight", function () {
            // The covering highlight must NOT be the pathway's best-ranked gene, or the
            // assertion passes with or without the "already covered" guard: P1 is
            // [TP53, MYC] and MYC is the weaker of the two, so a missing guard would
            // additionally pull in TP53.
            const {genes} = selectCircosGenes([{id: "P1", genes: ["TP53", "MYC"]}], makeGenes(), {
                topN: 1, highlightedSymbols: ["MYC"],
            });
            assert.deepStrictEqual(symbols(genes), ["MYC"],
                "the highlight already represents P1; the sweep must not add TP53 as well");
        });

        it("does not spend a second slot on a pathway sharing its best gene with an earlier one", function () {
            // B's best gene is TP53, but A has already contributed KRAS, which B also
            // contains — so B is covered and must cost nothing. Without the incremental
            // guard the sweep would add TP53 too. (A deliberately comes first and its ONLY
            // gene is the shared one, so the guard is the only thing keeping this at 1.)
            const shared = [
                {id: "A", genes: ["KRAS"]},
                {id: "B", genes: ["KRAS", "TP53"]},
            ];
            const {genes} = selectCircosGenes(shared, makeGenes(), {topN: 1});
            assert.deepStrictEqual(symbols(genes), ["KRAS"]);
            assert.ok(genes.length < shared.length, "overlapping pathways share a gene");
        });

        it("sweeps in pathway display order, so the earlier pathway pays for a shared gene", function () {
            // P2 lists KRAS before EGFR, but EGFR outranks KRAS, so EGFR is the one kept.
            const {genes} = selectCircosGenes(
                [{id: "P2", genes: ["KRAS", "EGFR"]}], makeGenes(), {topN: 1}
            );
            assert.deepStrictEqual(symbols(genes), ["EGFR"], "best-ranked, not first-listed");
        });

        it("reports a pathway with no DE gene at all and does not try to guarantee it", function () {
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {topN: 1});
            assert.deepStrictEqual(stats.emptyPathwayIds, ["P4"]);
        });

        it("leaves cap-starved pathways uncovered when the guarantee is off", function () {
            const {genes, stats} = selectCircosGenes(makePathways(), makeGenes(), {
                topN: 1, guaranteeOnePerPathway: false,
            });
            assert.deepStrictEqual(symbols(genes), ["TP53"]);
            assert.strictEqual(stats.coverageGeneCount, 0);
            // emptyPathwayIds is still reported with the guarantee off.
            assert.deepStrictEqual(stats.emptyPathwayIds, ["P4"]);
        });

        it("does NOT count a coverage gene that would have ranked anyway", function () {
            // At topN 5 every gene ranks in, so the sweep adds nothing extra.
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {topN: 5});
            assert.strictEqual(stats.coverageGeneCount, 0);
            assert.strictEqual(stats.capRaised, false);
        });

        it("counts only the coverage genes that rank below the target", function () {
            // topN 1 => wouldRank is {TP53}. The sweep adds EGFR and FOS on top.
            const {stats} = selectCircosGenes(makePathways(), makeGenes(), {topN: 1});
            assert.strictEqual(stats.coverageGeneCount, 2);
            assert.strictEqual(stats.appliedCap, 3);
        });
    });

    describe("selectCircosGenes — duplicate symbols", function () {
        it("keeps only the best-ranked row when two DE rows share a symbol", function () {
            const {genes, stats} = selectCircosGenes(makePathways(), makeGenes(), {topN: 500});
            const tp53 = genes.filter((g) => g.symbol === "TP53");
            assert.strictEqual(tp53.length, 1, "one node per symbol");
            assert.strictEqual(tp53[0]._id, "7157", "the better-ranked row wins");
            assert.deepStrictEqual(stats.duplicateSymbolsDropped, ["TP53"]);
        });

        it("keeps the better row regardless of input order", function () {
            const reversed = makeGenes().reverse();
            const {genes} = selectCircosGenes(makePathways(), reversed, {topN: 500});
            assert.strictEqual(genes.filter((g) => g.symbol === "TP53")[0]._id, "7157");
        });

        it("reports one dropped entry per extra row when three share a symbol", function () {
            const triple = [
                {_id: "a", symbol: "DUP", FC: 1.0, pValueFDR: 0.03},
                {_id: "b", symbol: "DUP", FC: 1.0, pValueFDR: 0.01},
                {_id: "c", symbol: "DUP", FC: 1.0, pValueFDR: 0.02},
            ];
            const {genes, stats} = selectCircosGenes([{id: "P", genes: ["DUP"]}], triple, {topN: 5});
            assert.strictEqual(genes.length, 1, "one node per symbol");
            assert.strictEqual(genes[0]._id, "b", "the best-ranked row wins");
            assert.deepStrictEqual(stats.duplicateSymbolsDropped, ["DUP", "DUP"]);
        });
    });

    describe("buildCircosGraph — node ids", function () {
        it("every node's id equals its own index (the matrix invariant circos-d3 depends on)", function () {
            for (const topN of [1, 2, 3, 500]) {
                const {nodes} = buildCircosGraph(makePathways(), makeGenes(), {topN, colors: COLORS});
                nodes.forEach((n, i) => assert.strictEqual(n.id, i, `topN ${topN}, index ${i}`));
            }
        });

        it("assigns pathways 0..P-1 in display order and genes after them in rank order", function () {
            const {nodes} = buildCircosGraph(makePathways(), makeGenes(), {topN: 500, colors: COLORS});
            assert.deepStrictEqual(names(pathwayNodes(nodes)), ["Apoptosis", "Signalling", "Immediate early", "Empty"]);
            assert.deepStrictEqual(names(geneNodes(nodes)), RANKED);
            assert.strictEqual(geneNodes(nodes)[0].id, 4, "genes start after the 4 pathways");
        });

        it("keeps a pathway's colour stable when the gene target changes", function () {
            const a = pathwayNodes(buildCircosGraph(makePathways(), makeGenes(), {topN: 1, colors: COLORS}).nodes);
            const b = pathwayNodes(buildCircosGraph(makePathways(), makeGenes(), {topN: 500, colors: COLORS}).nodes);
            assert.deepStrictEqual(a.map((n) => n.color), b.map((n) => n.color));
        });

        it("cycles the palette past its length", function () {
            const {nodes} = buildCircosGraph(makePathways(), makeGenes(), {topN: 1, colors: COLORS});
            const p = pathwayNodes(nodes);
            assert.strictEqual(p[3].color, COLORS[0], "4th pathway wraps to the 1st colour");
        });

        it("marks highlighted gene nodes and leaves the rest false", function () {
            const {nodes} = buildCircosGraph(makePathways(), makeGenes(), {
                topN: 500, highlightedSymbols: ["fos"], colors: COLORS,
            });
            for (const n of geneNodes(nodes)) {
                assert.strictEqual(n.highlighted, n.name === "FOS", n.name);
            }
        });

        it("never puts a color field on a gene node (the chord-gradient contract)", function () {
            // circos-d3:193/197 does `node.color || getGeneColor(node.logFC)`, so a colour on
            // a gene node would replace its fold-change colour in every chord touching it.
            const {nodes} = buildCircosGraph(makePathways(), makeGenes(), {
                topN: 500, highlightedSymbols: ["FOS", "TP53"], colors: COLORS,
            });
            for (const n of geneNodes(nodes)) {
                assert.ok(!("color" in n), `${n.name} must not carry a color`);
            }
        });

        it("preserves the legacy node field names the renderer reads", function () {
            const {nodes} = buildCircosGraph(makePathways(), makeGenes(), {topN: 500, colors: COLORS});
            const gene = geneNodes(nodes)[0];
            assert.deepStrictEqual(Object.keys(gene).sort(), ["gene_id", "highlighted", "id", "logFC", "name", "type"]);
            assert.strictEqual(gene.logFC, 2.0, "logFC carries FC through");
            assert.strictEqual(gene.gene_id, "7157");
            const pathway = pathwayNodes(nodes)[0];
            assert.strictEqual(pathway.path_id, "P1");
            assert.strictEqual(pathway.type, "pathway");
        });
    });

    describe("buildCircosGraph — relations", function () {
        it("emits one relation per surviving pathway-gene membership", function () {
            const {relations} = buildCircosGraph(makePathways(), makeGenes(), {topN: 500, colors: COLORS});
            // P1 -> TP53, MYC; P2 -> EGFR, KRAS; P3 -> FOS; P4 -> none.
            assert.strictEqual(relations.length, 5);
        });

        it("keeps every relation endpoint in range (the matrix[from][to] guard)", function () {
            for (const topN of [1, 2, 3, 500]) {
                const {nodes, relations} = buildCircosGraph(makePathways(), makeGenes(), {topN, colors: COLORS});
                for (const r of relations) {
                    assert.ok(r.from >= 0 && r.from < nodes.length, `from ${r.from} out of range`);
                    assert.ok(r.to >= 0 && r.to < nodes.length, `to ${r.to} out of range`);
                }
            }
        });

        it("points from a pathway node to a gene node, always", function () {
            const {nodes, relations} = buildCircosGraph(makePathways(), makeGenes(), {topN: 500, colors: COLORS});
            for (const r of relations) {
                assert.strictEqual(nodes[r.from].type, "pathway");
                assert.strictEqual(nodes[r.to].type, "gene");
            }
        });

        it("prunes relations for dropped genes instead of throwing (the .find(...).id regression)", function () {
            // The old code did inputGenesArr.find(e => e.name === gene).id, which threw a
            // TypeError the moment a gene was cap-dropped.
            let out;
            assert.doesNotThrow(() => {
                out = buildCircosGraph(makePathways(), makeGenes(), {
                    topN: 1, guaranteeOnePerPathway: false, colors: COLORS,
                });
            });
            assert.strictEqual(out.relations.length, 1, "only P1 -> TP53 survives");
            assert.deepStrictEqual(out.relations[0], {from: 0, to: 4});
        });

        it("collapses duplicate from/to pairs when two gene ids map to one symbol", function () {
            // A pathway listing TP53 twice (two Entrez ids, same symbol) must not emit two edges.
            const dup = [{id: "P", name: "Dup", genes: ["TP53", "TP53"]}];
            const {relations} = buildCircosGraph(dup, makeGenes(), {topN: 500, colors: COLORS});
            assert.strictEqual(relations.length, 1);
        });

        it("resolves `from` by pathway index, so duplicate or undefined pathway ids do not mis-route", function () {
            const odd = [
                {id: undefined, name: "One", genes: ["TP53"]},
                {id: undefined, name: "Two", genes: ["MYC"]},
            ];
            const {relations} = buildCircosGraph(odd, makeGenes(), {topN: 500, colors: COLORS});
            assert.deepStrictEqual(relations.map((r) => r.from), [0, 1]);
        });

        it("lists a pathway with zero surviving chords in orphanPathwayIds", function () {
            const {stats} = buildCircosGraph(makePathways(), makeGenes(), {topN: 500, colors: COLORS});
            assert.deepStrictEqual(stats.orphanPathwayIds, ["P4"]);
        });

        it("the guarantee means the target never orphans a pathway that has DE genes", function () {
            const {stats} = buildCircosGraph(makePathways(), makeGenes(), {topN: 1, colors: COLORS});
            // Only P4 (no DE genes at all, pre-existing) is orphaned — never P1/P2/P3.
            assert.deepStrictEqual(stats.orphanPathwayIds, ["P4"]);
        });
    });

    describe("buildCircosGraph — degenerate inputs", function () {
        it("returns empty nodes and relations for no pathways and no genes", function () {
            const {nodes, relations} = buildCircosGraph([], [], {topN: 5});
            assert.deepStrictEqual(nodes, []);
            assert.deepStrictEqual(relations, []);
        });

        it("returns pathway nodes and no relations when every pathway is empty", function () {
            const {nodes, relations} = buildCircosGraph(
                [{id: "P", name: "Empty", genes: []}], makeGenes(), {topN: 5, colors: COLORS}
            );
            assert.strictEqual(nodes.length, 1);
            assert.deepStrictEqual(relations, []);
        });

        it("returns only pathway nodes when there are no DE genes", function () {
            const {nodes, relations} = buildCircosGraph(makePathways(), [], {topN: 5, colors: COLORS});
            assert.strictEqual(geneNodes(nodes).length, 0);
            assert.strictEqual(pathwayNodes(nodes).length, 4);
            assert.deepStrictEqual(relations, []);
        });

        it("tolerates null / undefined arguments and options", function () {
            assert.doesNotThrow(() => buildCircosGraph(null, null));
            assert.doesNotThrow(() => buildCircosGraph(undefined, undefined, undefined));
            assert.deepStrictEqual(buildCircosGraph(null, null).nodes, []);
        });

        it("does not mutate its inputs", function () {
            const pathways = makePathways();
            const de = makeGenes();
            const beforeP = JSON.stringify(pathways);
            const beforeD = JSON.stringify(de);
            buildCircosGraph(pathways, de, {topN: 2, highlightedSymbols: ["FOS"], colors: COLORS});
            assert.strictEqual(JSON.stringify(pathways), beforeP);
            assert.strictEqual(JSON.stringify(de), beforeD);
        });

        it("is deterministic across shuffled inputs", function () {
            const a = buildCircosGraph(makePathways(), makeGenes(), {topN: 3, colors: COLORS});
            const b = buildCircosGraph(makePathways(), makeGenes().reverse(), {topN: 3, colors: COLORS});
            assert.deepStrictEqual(a.nodes, b.nodes);
            assert.deepStrictEqual(a.relations, b.relations);
        });
    });

    describe("describeGeneSelection — the target must not pretend to be a ceiling", function () {
        const captionFor = (opts) =>
            describeGeneSelection(buildCircosGraph(makePathways(), makeGenes(), {colors: COLORS, ...opts}).stats);

        it("states the plain count when nothing changed the selection", function () {
            assert.strictEqual(captionFor({topN: 5}), "Showing 5 of 5 genes.");
        });

        it("uses the singular for a single gene", function () {
            const text = describeGeneSelection(
                buildCircosGraph([{id: "P", genes: ["TP53"]}], makeGenes(), {topN: 5, colors: COLORS}).stats
            );
            assert.strictEqual(text, "Showing 1 of 1 gene.");
        });

        it("names BOTH numbers and the pathway reason when the guarantee binds", function () {
            const text = captionFor({topN: 1});
            assert.strictEqual(
                text,
                "Showing 3 of 5 genes — more than the target of 1, so that every displayed pathway that has a differentially expressed gene keeps at least one."
            );
        });

        it("qualifies the pathway claim, because a pathway with NO DE gene keeps none", function () {
            // The fixture's P4 is displayed and has no DE gene, so an unqualified "every
            // displayed pathway keeps at least one gene" would be contradicted by the very
            // picture beside the caption.
            const {stats} = buildCircosGraph(makePathways(), makeGenes(), {topN: 1, colors: COLORS});
            assert.deepStrictEqual(stats.orphanPathwayIds, ["P4"]);
            assert.ok(/that has a differentially expressed gene/.test(describeGeneSelection(stats)));
        });

        it("names the highlight reason when highlights alone raise the target", function () {
            const text = captionFor({topN: 1, highlightedSymbols: ["FOS", "KRAS"], guaranteeOnePerPathway: false});
            assert.strictEqual(
                text,
                "Showing 2 of 5 genes — more than the target of 1, so that 2 highlighted genes are kept."
            );
        });

        it("explains a SUBSTITUTION even when the count matches the target", function () {
            // The guarantee can change WHICH genes are shown without changing how many.
            // Reporting only the count overshoot would leave that silent. Here P2 and P3
            // each force in a gene, displacing better-ranked ones, while the total stays 3.
            const {stats} = buildCircosGraph(makePathways(), makeGenes(), {topN: 3, colors: COLORS});
            assert.strictEqual(stats.capRaised, false, "count matches the target");
            assert.ok(stats.coverageGeneCount > 0, "but the membership is not the top 3");
            assert.strictEqual(
                describeGeneSelection(stats),
                "Showing 3 of 5 genes — not simply the top 3 by significance, so that every displayed pathway that has a differentially expressed gene keeps at least one."
            );
        });

        it("says nothing extra when a highlight merely FITS the target", function () {
            // One highlight at a target of 1 displaces the top-ranked gene rather than
            // raising the count — but that displacement IS the user's own explicit choice,
            // so unlike the coverage case there is nothing to explain.
            assert.strictEqual(
                captionFor({topN: 1, highlightedSymbols: ["FOS"], guaranteeOnePerPathway: false}),
                "Showing 1 of 5 genes — not simply the top 1 by significance, so that 1 highlighted gene is kept."
            );
        });

        it("joins both reasons, in the singular, when both bind", function () {
            const text = captionFor({topN: 1, highlightedSymbols: ["KRAS"]});
            assert.ok(
                /1 highlighted gene is kept and every displayed pathway that has a differentially expressed gene keeps at least one/.test(text),
                text
            );
        });

        it("whenever the target is exceeded, the caption names the request, the count and a reason", function () {
            // The load-bearing contract: a user who asks for 1 and sees 3 must not have to reason.
            for (const opts of [
                {topN: 1},
                {topN: 1, highlightedSymbols: ["FOS", "KRAS"], guaranteeOnePerPathway: false},
                {topN: 1, highlightedSymbols: ["KRAS"]},
            ]) {
                const {stats} = buildCircosGraph(makePathways(), makeGenes(), {colors: COLORS, ...opts});
                assert.strictEqual(stats.capRaised, true, JSON.stringify(opts));
                const text = describeGeneSelection(stats);
                assert.ok(text.includes(`the target of ${stats.requestedCap}`), text);
                assert.ok(text.includes(`Showing ${stats.selectedGeneCount} of`), text);
                assert.ok(/so that /.test(text), `must give a reason: ${text}`);
            }
        });

        it("echoes the control's own word, 'target', rather than inventing a synonym", function () {
            assert.ok(/the target of 1/.test(captionFor({topN: 1})));
        });

        it("NAMES the stale highlights rather than only counting them", function () {
            // The picker is per-pane, so this fires exactly when the user switches method tab
            // or narrows the pathways — when they have several tags and cannot tell which
            // went stale.
            assert.ok(!/Not among the differentially expressed/.test(captionFor({topN: 5})));
            const one = captionFor({topN: 5, highlightedSymbols: ["GHOST"]});
            assert.ok(/Not among the differentially expressed genes of the displayed pathways: GHOST\./.test(one), one);
            const two = captionFor({topN: 5, highlightedSymbols: ["GHOST", "NoPath"]});
            assert.ok(/: GHOST, NoPath\./.test(two), two);
        });

        it("elides a long stale list rather than dumping it all", function () {
            const many = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
            const text = captionFor({topN: 5, highlightedSymbols: many});
            assert.ok(/: G1, G2, G3, G4, G5, …\./.test(text), text);
            assert.ok(!/G6/.test(text), text);
        });

        it("still reports stale highlights when there are no candidate genes at all", function () {
            // total === 0 must not swallow the one piece of information the user needs.
            const {stats} = buildCircosGraph([{id: "P", genes: []}], [], {
                topN: 5, highlightedSymbols: ["GHOST"], colors: COLORS,
            });
            assert.strictEqual(stats.totalCandidateGenes, 0);
            assert.strictEqual(
                describeGeneSelection(stats),
                "Not among the differentially expressed genes of the displayed pathways: GHOST."
            );
        });

        it("returns '' when there is genuinely nothing to describe", function () {
            assert.strictEqual(describeGeneSelection(null), "");
            assert.strictEqual(describeGeneSelection(undefined), "");
            assert.strictEqual(describeGeneSelection(buildCircosGraph([], []).stats), "");
        });
    });
});

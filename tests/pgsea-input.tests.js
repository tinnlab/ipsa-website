// Tests for the PGSEA input normalizer that restores `Gene / Fold-Change / P-value`
// (optional header, 2–3 columns) support removed by commit b202ac2, and the
// ranking-column selection (Fold-Change vs signed -log10(P-value)).
// Pure module — imports/utils/pgseaInput.js. Runs server-side.
import assert from "assert";
import {
    normalizePgseaInput,
    buildPgseaContent,
    resolvePgseaRankingBy,
    parsePgseaGeneStats,
    derivePgseaPersistPayload,
    buildPgseaVolcanoRows,
    RANKING_OPTIONS,
} from "../imports/utils/pgseaInput";

// Mirrors the OSD statDat_*.txt files (tab-separated, header row).
const STATDAT_3COL =
    "Gene\tFold-Change\tP-value\n" +
    "GNAI3\t3.02948784049984\t0.000934355528242344\n" +
    "CDC45\t-0.160419457420463\t0.691163097962077\n" +
    "H19\t0.0243564833727325\t0.94546077707872";

describe("normalizePgseaInput — 3-column Gene/Fold-Change/P-value (header)", function () {
    it("detects the header, both ranking options, and defaults to fold-change", function () {
        const r = normalizePgseaInput(STATDAT_3COL);
        assert.strictEqual(r.hadHeader, true);
        assert.strictEqual(r.delimiter, "\t");
        assert.deepStrictEqual(r.available, ["fc", "pval"]);
        assert.strictEqual(r.rankingBy, "fc");
        assert.strictEqual(r.rows.length, 3);
        assert.deepStrictEqual(r.rows[0], {
            gene: "GNAI3",
            fc: 3.02948784049984,
            pval: 0.000934355528242344,
            fcRaw: "3.02948784049984",
        });
    });

    it("returns the shape FileParser.parsePGSEAFiles/MassAnalysisModal depend on", function () {
        // FileParser.parsePGSEAFiles spreads this into analysis.data; the mass-analysis
        // submit path reads data.rows / data.available / data.content / data.rankingBy.
        const r = normalizePgseaInput(STATDAT_3COL);
        assert.deepStrictEqual(
            Object.keys(r).sort(),
            ["available", "content", "delimiter", "hadHeader", "rankingBy", "rows"].sort()
        );
    });

    it("rankingBy:'fc' emits Gene<TAB>FoldChange, byte-identical to a 2-column FoldChange file", function () {
        const r = normalizePgseaInput(STATDAT_3COL, { rankingBy: "fc" });
        const expected =
            "GNAI3\t3.02948784049984\n" +
            "CDC45\t-0.160419457420463\n" +
            "H19\t0.0243564833727325";
        assert.strictEqual(r.content, expected);
        // And feeding that 2-column file back through the parser yields the same content
        // (this is exactly what the current single-analysis PGSEA consumes).
        const back = normalizePgseaInput(expected);
        assert.strictEqual(back.content, expected);
    });

    it("rankingBy:'pval' emits Gene<TAB> sign(FC)*-log10(P), directional", function () {
        const r = normalizePgseaInput(STATDAT_3COL, { rankingBy: "pval" });
        assert.strictEqual(r.rankingBy, "pval");
        const lines = r.content.split("\n").map((l) => l.split("\t"));
        // GNAI3: fc>0 → positive; magnitude -log10(0.000934...) ≈ 3.029
        assert.strictEqual(lines[0][0], "GNAI3");
        const gnai3 = parseFloat(lines[0][1]);
        assert.ok(gnai3 > 0, `expected positive, got ${gnai3}`);
        assert.ok(Math.abs(gnai3 - 3.0295) < 0.01, `GNAI3 stat ${gnai3}`);
        // CDC45: fc<0 → negative
        assert.ok(parseFloat(lines[1][1]) < 0, "CDC45 should be negative");
    });
});

describe("normalizePgseaInput — back-compat & delimiters", function () {
    it("parses 2-column NO-header numeric input unchanged (legacy Gene\\tStatistic)", function () {
        const text = "GNAI3\t3.02\nCDC45\t-0.16\nH19\t0.02";
        const r = normalizePgseaInput(text);
        assert.strictEqual(r.hadHeader, false);
        assert.deepStrictEqual(r.available, ["fc"]);
        assert.strictEqual(r.content, text);
    });

    it("parses a 2-column file WITH a generic header (Gene\\tStatistic)", function () {
        const r = normalizePgseaInput("Gene\tStatistic\nGNAI3\t3.02\nCDC45\t-0.16");
        assert.strictEqual(r.hadHeader, true);
        assert.deepStrictEqual(r.available, ["fc"]);
        assert.strictEqual(r.content, "GNAI3\t3.02\nCDC45\t-0.16");
    });

    it("handles comma-delimited (.csv) input", function () {
        const r = normalizePgseaInput("Gene,Fold-Change,P-value\nGNAI3,3.02,0.001\nCDC45,-0.16,0.69");
        assert.strictEqual(r.delimiter, ",");
        assert.deepStrictEqual(r.available, ["fc", "pval"]);
        assert.strictEqual(r.content, "GNAI3\t3.02\nCDC45\t-0.16");
    });

    it("drops rows with a blank gene or non-numeric ranking value, and skips # comments", function () {
        const text =
            "# a comment\n" +
            "Gene\tFold-Change\n" +
            "GNAI3\t3.02\n" +
            "\t9.9\n" +          // blank gene → dropped
            "BADGENE\tNA\n" +     // non-numeric → dropped
            "CDC45\t-0.16";
        const r = normalizePgseaInput(text);
        assert.strictEqual(r.rows.length, 2);
        assert.strictEqual(r.content, "GNAI3\t3.02\nCDC45\t-0.16");
    });
});

describe("normalizePgseaInput — edge cases", function () {
    it("clamps P-value == 0 so -log10 stays finite", function () {
        const r = normalizePgseaInput("Gene\tFold-Change\tP-value\nUP\t2\t0\nDOWN\t-2\t0", { rankingBy: "pval" });
        const lines = r.content.split("\n").map((l) => l.split("\t"));
        const up = parseFloat(lines[0][1]);
        const down = parseFloat(lines[1][1]);
        assert.ok(Number.isFinite(up) && Number.isFinite(down), "must be finite");
        assert.ok(up > 0 && down < 0, "sign must follow fold-change");
        assert.ok(Math.abs(up - 300) < 1, `clamp floor ~300, got ${up}`); // -log10(1e-300)=300
    });

    it("falls back to fold-change when pval ranking is requested but unavailable", function () {
        const r = normalizePgseaInput("GNAI3\t3.02\nCDC45\t-0.16", { rankingBy: "pval" });
        assert.strictEqual(r.rankingBy, "fc");
        assert.strictEqual(r.content, "GNAI3\t3.02\nCDC45\t-0.16");
    });

    it("throws on an empty file and on a single-column file", function () {
        assert.throws(() => normalizePgseaInput("   \n\n"), /empty|no data/i);
        assert.throws(() => normalizePgseaInput("GNAI3\nCDC45"), /at least 2 columns/i);
    });
});

describe("buildPgseaContent", function () {
    const rows = [
        { gene: "A", fc: 2, pval: 0.01, fcRaw: "2" },
        { gene: "B", fc: -1, pval: 0.5, fcRaw: "-1" },
    ];
    it("fc mode preserves the raw fold-change token", function () {
        assert.strictEqual(buildPgseaContent(rows, "fc"), "A\t2\nB\t-1");
    });
    it("pval mode computes sign(fc)*-log10(p) and skips rows missing pval", function () {
        const out = buildPgseaContent(
            [...rows, { gene: "C", fc: 1, pval: null, fcRaw: "1" }],
            "pval"
        ).split("\n");
        assert.strictEqual(out.length, 2, "row C (no pval) is skipped");
        assert.ok(parseFloat(out[0].split("\t")[1]) > 0);
        assert.ok(parseFloat(out[1].split("\t")[1]) < 0);
    });
    it("pval mode clamps p>1 to a finite value and DROPS p<0, never NaN", function () {
        const out = buildPgseaContent(
            [
                { gene: "HI", fc: 2, pval: 5, fcRaw: "2" },      // p>1 (invalid) → clamp to 1 → stat 0
                { gene: "NEG", fc: -1, pval: -0.3, fcRaw: "-1" }, // p<0 (invalid) → dropped
                { gene: "OK", fc: 1, pval: 0.01, fcRaw: "1" },
            ],
            "pval"
        ).split("\n").map((l) => l.split("\t"));
        for (const [, v] of out) assert.ok(Number.isFinite(parseFloat(v)) && v !== "NaN", `non-finite: ${v}`);
        assert.strictEqual(parseFloat(out[0][1]), 0, "p>1 clamps to p=1 → -log10(1)=0");
        // A negative p-value is not a probability at all. Saturating it to the 1e-300 floor
        // made it |300| — the MOST significant gene in the file — so a corrupt or
        // mis-identified column promoted garbage to the top of the ranking. Dropping it is
        // consistent with how a missing p-value is handled.
        assert.deepStrictEqual(out.map((r) => r[0]), ["HI", "OK"], "p<0 must be dropped");
    });
});

describe("normalizePgseaInput — header robustness (audit H1/H2/M4)", function () {
    it("H1: treats a header whose value column is numeric-looking as a header, not a gene", function () {
        // "Symbol\t100" — value col looks numeric, but the gene-column name gives it away.
        const r = normalizePgseaInput("Symbol\t100\nGNAI3\t3\nCDC45\t-1");
        assert.strictEqual(r.hadHeader, true);
        assert.strictEqual(r.rows.length, 2, "the 'Symbol/100' header row must not become a gene");
        assert.ok(!r.rows.some((row) => row.gene === "Symbol"));
    });

    it("H2: a limma table (Gene, t, P.Value, adj.P.Val) ranks by the signed t-stat, not raw p", function () {
        const text =
            "Gene\tt\tP.Value\tadj.P.Val\n" +
            "UP\t5.1\t0.001\t0.01\n" +
            "DOWN\t-3.2\t0.01\t0.05";
        const r = normalizePgseaInput(text);
        assert.deepStrictEqual(r.available, ["fc", "pval"]);
        // fc mode uses the t-statistic column verbatim (signed), NOT the p-value.
        assert.strictEqual(r.content, "UP\t5.1\nDOWN\t-3.2");
        // pval mode is directional via the t sign.
        const pv = normalizePgseaInput(text, { rankingBy: "pval" }).content.split("\n").map((l) => l.split("\t"));
        assert.ok(parseFloat(pv[0][1]) > 0 && parseFloat(pv[1][1]) < 0);
    });

    it("M4: an expression column named log2CPM is NOT mistaken for fold-change", function () {
        // With a real Fold-Change column present, that one must win over log2CPM.
        const r = normalizePgseaInput("Gene\tlog2CPM\tFold-Change\tP-value\nA\t7.2\t2.0\t0.01\nB\t6.1\t-1.0\t0.2");
        assert.strictEqual(r.content, "A\t2.0\nB\t-1.0", "ranking column must be Fold-Change, not log2CPM");
    });
});

describe("normalizePgseaInput — headerless positional & quoting (audit M5/M3)", function () {
    it("M5: headerless 3-column uses positional Gene/FC/P-value order (no value-range guessing)", function () {
        // col1 all in [0,1] (small positive FCs), col2 a t-stat > 1: must NOT be swapped.
        const r = normalizePgseaInput("A\t0.5\t3.2\nB\t0.3\t5.1");
        assert.strictEqual(r.rows[0].fc, 0.5, "col1 is the fold-change");
        assert.strictEqual(r.rows[0].pval, 3.2, "col2 is the p-value column (positional)");
    });

    it("M3: honors RFC-4180 quoting so a quoted gene with an embedded comma survives", function () {
        const r = normalizePgseaInput('Gene,Fold-Change\n"GENE,X",3.0\nB,-1');
        assert.strictEqual(r.rows.length, 2);
        assert.strictEqual(r.rows[0].gene, "GENE,X");
        assert.strictEqual(r.rows[0].fc, 3.0);
    });
});

describe("normalizePgseaInput — 2-column inputs (Gene + one value)", function () {
    it("Gene + Fold-Change (header): ranks by fold-change, p-value option unavailable", function () {
        const r = normalizePgseaInput("Gene\tFold-Change\nA\t2\nB\t-1");
        assert.deepStrictEqual(r.available, ["fc"]);
        assert.strictEqual(r.rankingBy, "fc");
        assert.strictEqual(r.content, "A\t2\nB\t-1");
    });

    it("Gene + P-value only: ranks by -log10(p) magnitude (undirected, most-significant on top)", function () {
        const r = normalizePgseaInput("Gene\tP-value\nA\t0.01\nB\t0.5");
        assert.deepStrictEqual(r.available, ["pval"], "only p-value ranking is offered");
        assert.strictEqual(r.rankingBy, "pval");
        const lines = r.content.split("\n").map((l) => l.split("\t"));
        const a = parseFloat(lines[0][1]);
        const b = parseFloat(lines[1][1]);
        assert.ok(a > 0 && b > 0, "all statistics are positive (undirected magnitude)");
        assert.ok(Math.abs(a - 2) < 1e-9, "-log10(0.01) = 2");
        assert.ok(a > b, "the more significant gene (A) outranks the less significant (B)");
    });

    it("a P-value-only file never ranks by the raw p-value verbatim", function () {
        const r = normalizePgseaInput("Gene\tPValue\nA\t0.001");
        assert.notStrictEqual(r.content, "A\t0.001", "raw p must be transformed to -log10(p)");
        assert.strictEqual(r.content, "A\t3"); // -log10(0.001) = 3
    });
});

describe("resolvePgseaRankingBy", function () {
    it("returns the first truthy candidate (precedence order)", function () {
        assert.strictEqual(resolvePgseaRankingBy(["pval", "fc", "fc"], ["fc", "pval"]), "pval");
        assert.strictEqual(resolvePgseaRankingBy([undefined, "pval", "fc"], ["fc", "pval"]), "pval");
        assert.strictEqual(resolvePgseaRankingBy([undefined, undefined, "fc"], ["fc", "pval"]), "fc");
    });
    it("defaults to 'fc' when no candidate is set", function () {
        assert.strictEqual(resolvePgseaRankingBy([undefined, undefined], ["fc", "pval"]), "fc");
        assert.strictEqual(resolvePgseaRankingBy([], ["fc"]), "fc");
    });
    it("clamps to the first available mode when the requested one is unavailable", function () {
        assert.strictEqual(resolvePgseaRankingBy(["pval"], ["fc"]), "fc");
        assert.strictEqual(resolvePgseaRankingBy(["pval"], undefined), "fc");
        // p-value-only file: available is ['pval'], so even an 'fc' request clamps to 'pval'.
        assert.strictEqual(resolvePgseaRankingBy(["fc"], ["pval"]), "pval");
        assert.strictEqual(resolvePgseaRankingBy([undefined], ["pval"]), "pval");
    });
});

// =====================================================================================
// RANKING CORRECTNESS GATE
//
// These prove EMPIRICALLY, on a hand-computed fixture, that the ranking statistic FGSEA
// ends up running on is the one the user selected — through the full client collapse and
// the server-side parser that feeds fgsea::fgsea(stats = geneStat).
// =====================================================================================

// Hand-computed. Every expected statistic below is checkable by eye.
//   UP     fc  2.0  p 0.01   -> pval stat = +2      (sign +1, -log10(0.01) = 2)
//   DOWN   fc -1.5  p 0.001  -> pval stat = -3      (sign -1, -log10(0.001) = 3)
//   FLAT   fc  0.0  p 0.1    -> pval stat =  0      (sign 0 — token must be "0", not "-0")
//   ZEROP  fc  1.0  p 0      -> pval stat ≈ +300    (p clamped up to the 1e-300 floor)
//   TINYP  fc -1.0  p 1e-10  -> pval stat = -10
const RANK_FIXTURE_3COL =
    "Gene\tFold-Change\tP-value\n" +
    "UP\t2.0\t0.01\n" +
    "DOWN\t-1.5\t0.001\n" +
    "FLAT\t0.0\t0.1\n" +
    "ZEROP\t1.0\t0\n" +
    "TINYP\t-1.0\t1e-10";

const RANK_FIXTURE_GENES = ["UP", "DOWN", "FLAT", "ZEROP", "TINYP"];

// Mirrors server/api/methods/analysis.js `createPgseaParams` useGeneNames branch exactly
// (that branch is DB-free). Combined with parsePgseaGeneStats — which IS the code that
// method runs — this reproduces the payload handed to rCommand/fgsea.js.
const buildGeneNameParams = (canonicalText) => {
    const { inputGeneList, geneData } = parsePgseaGeneStats(canonicalText);
    return inputGeneList
        .map((gene) => ({ gene, geneStat: geneData[gene]?.rankStat || 0 }))
        .filter((item) => item.geneStat !== undefined && !isNaN(item.geneStat));
};

const statTokens = (content) => {
    const map = {};
    for (const line of content.split("\n")) {
        const [gene, stat] = line.split("\t");
        map[gene] = stat;
    }
    return map;
};

describe("RANKING GATE — 'fc' mode ranks on the Fold-Change column verbatim", function () {
    it("emits each row's fold-change token unchanged, sign included", function () {
        const content = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "fc" }).input;
        assert.strictEqual(
            content,
            "UP\t2.0\nDOWN\t-1.5\nFLAT\t0.0\nZEROP\t1.0\nTINYP\t-1.0",
            "fc mode must reproduce the Fold-Change column token-for-token"
        );
    });

    it("the server parser reads back exactly those fold-changes, per gene", function () {
        const content = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "fc" }).input;
        const { geneData } = parsePgseaGeneStats(content);
        assert.strictEqual(geneData.UP.rankStat, 2.0);
        assert.strictEqual(geneData.DOWN.rankStat, -1.5);
        assert.strictEqual(geneData.FLAT.rankStat, 0);
        assert.strictEqual(geneData.ZEROP.rankStat, 1.0);
        assert.strictEqual(geneData.TINYP.rankStat, -1.0);
    });
});

describe("RANKING GATE — 'pval' mode is sign(FC) * -log10(P) with the correct sign", function () {
    const content = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "pval" }).input;
    const tokens = statTokens(content);

    it("a positive fold-change yields a POSITIVE ranking value", function () {
        const up = parseFloat(tokens.UP);
        assert.ok(up > 0, `UP (fc +2.0) must rank positive, got ${up}`);
        assert.ok(Math.abs(up - 2) < 1e-9, `-log10(0.01) = 2, got ${up}`);
    });

    it("a negative fold-change yields a NEGATIVE ranking value", function () {
        const down = parseFloat(tokens.DOWN);
        assert.ok(down < 0, `DOWN (fc -1.5) must rank negative, got ${down}`);
        assert.ok(Math.abs(down + 3) < 1e-9, `-log10(0.001) = 3 → -3, got ${down}`);
    });

    it("fc == 0 yields the token \"0\" — never \"-0\"", function () {
        assert.strictEqual(tokens.FLAT, "0", `expected "0", got ${JSON.stringify(tokens.FLAT)}`);
    });

    it("p == 0 clamps to the floor instead of producing Infinity or NaN", function () {
        const zerop = parseFloat(tokens.ZEROP);
        assert.ok(Number.isFinite(zerop), `expected finite, got ${tokens.ZEROP}`);
        assert.ok(zerop > 299 && zerop < 301, `expected ≈ +300 (the 1e-300 floor), got ${zerop}`);
        assert.ok(zerop > 0, "fc is positive so the clamped value must stay positive");
    });

    it("a very small p-value keeps its sign and magnitude", function () {
        const tiny = parseFloat(tokens.TINYP);
        assert.ok(Math.abs(tiny + 10) < 1e-9, `sign(-1) * -log10(1e-10) = -10, got ${tiny}`);
    });

    it("no statistic is ever NaN or Infinity", function () {
        for (const [gene, tok] of Object.entries(tokens)) {
            const v = parseFloat(tok);
            assert.ok(Number.isFinite(v), `${gene} produced a non-finite statistic: ${tok}`);
        }
    });

    it("the most significant DOWN gene ranks below the least significant gene", function () {
        // Directionality sanity: FGSEA cares about the ordering, so a strongly-down gene
        // must sort under a flat one.
        assert.ok(parseFloat(tokens.DOWN) < parseFloat(tokens.FLAT));
        assert.ok(parseFloat(tokens.FLAT) < parseFloat(tokens.UP));
    });
});

describe("RANKING GATE — gene ↔ statistic pairing survives the 3→2 collapse", function () {
    it("keeps every gene, in file order, with no duplication or shift", function () {
        for (const mode of ["fc", "pval"]) {
            const content = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: mode }).input;
            const { inputGeneList } = parsePgseaGeneStats(content);
            assert.deepStrictEqual(inputGeneList, RANK_FIXTURE_GENES, `gene order changed in ${mode} mode`);
        }
    });

    it("gene names and statistics stay index-aligned for fgsea's names(geneStat) <- geneList", function () {
        // rCommand/fgsea.js assigns names POSITIONALLY, so a length or order mismatch would
        // silently mis-attribute every statistic to the wrong gene.
        const content = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "pval" }).input;
        const params = buildGeneNameParams(content);
        const genes = params.map((p) => p.gene);
        const stats = params.map((p) => p.geneStat);
        assert.strictEqual(genes.length, stats.length);
        assert.deepStrictEqual(genes, RANK_FIXTURE_GENES);
        assert.ok(stats[0] > 0, "UP");
        assert.ok(stats[1] < 0, "DOWN");
        assert.strictEqual(stats[2], 0, "FLAT");
        assert.ok(stats[4] < 0, "TINYP");
    });
});

describe("RANKING GATE — switching the selector changes what FGSEA actually ranks on", function () {
    it("produces materially different params lists for 'fc' and 'pval'", function () {
        const fcParams = buildGeneNameParams(
            derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "fc" }).input
        );
        const pvalParams = buildGeneNameParams(
            derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "pval" }).input
        );

        // Same gene set here because every row in this fixture has BOTH a fold-change and a
        // p-value. That is not universal — see the missing-p-value test below, where 'pval'
        // legitimately drops rows it cannot rank.
        assert.deepStrictEqual(fcParams.map((p) => p.gene), pvalParams.map((p) => p.gene),
            "with complete rows the gene set must not change with the ranking mode");
        assert.notDeepStrictEqual(fcParams.map((p) => p.geneStat), pvalParams.map((p) => p.geneStat),
            "the STATISTICS must change with the ranking mode");

        // Concretely: DOWN's fold-change is -1.5 but its signed -log10(p) is -3.
        assert.strictEqual(fcParams[1].geneStat, -1.5);
        assert.ok(Math.abs(pvalParams[1].geneStat + 3) < 1e-9);
    });

    it("documents that 'pval' drops rows with no p-value, so the gene universe can shrink", function () {
        // A gene with no p-value cannot be ranked by one. This is intended, but it means the
        // set of genes handed to FGSEA differs between modes for incomplete files — worth
        // pinning so the behaviour is a decision rather than a surprise.
        const withGaps = "Gene\tFold-Change\tP-value\nA\t2\t0.01\nB\t-1\tNA\nC\t3\t0.5";
        const fcGenes = buildGeneNameParams(
            derivePgseaPersistPayload(withGaps, { requestedRankingBy: "fc" }).input
        ).map((p) => p.gene);
        const pvalGenes = buildGeneNameParams(
            derivePgseaPersistPayload(withGaps, { requestedRankingBy: "pval" }).input
        ).map((p) => p.gene);
        assert.deepStrictEqual(fcGenes, ["A", "B", "C"]);
        assert.deepStrictEqual(pvalGenes, ["A", "C"], "B has no p-value and cannot be ranked by one");
    });

    it("round-trips: 'pval' then back to 'fc' restores the original ranking exactly", function () {
        const first = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "fc" }).input;
        const flipped = derivePgseaPersistPayload(RANK_FIXTURE_3COL, { requestedRankingBy: "pval" }).input;
        const back = derivePgseaPersistPayload(RANK_FIXTURE_3COL, {
            storedRankingBy: "pval",
            requestedRankingBy: "fc",
        }).input;
        assert.notStrictEqual(first, flipped);
        assert.strictEqual(back, first);
    });
});

describe("RANKING GATE — legacy 2-column files are unchanged", function () {
    const LEGACY = "GOLM1\t0.377827741\nPOLD4\t0.442827998\nZNF496\t-0.384958431";

    it("collapses to exactly the original text", function () {
        const payload = derivePgseaPersistPayload(LEGACY);
        assert.strictEqual(payload.input, LEGACY, "a legacy 2-column file must pass through untouched");
        assert.deepStrictEqual(payload.available, ["fc"]);
        assert.strictEqual(payload.rankingBy, "fc");
    });

    it("normalises only trailing newline / CRLF, never the values", function () {
        assert.strictEqual(derivePgseaPersistPayload(LEGACY + "\n").input, LEGACY);
        assert.strictEqual(derivePgseaPersistPayload(LEGACY.replace(/\n/g, "\r\n")).input, LEGACY);
    });

    it("yields an identical server params list before and after the change", function () {
        const before = buildGeneNameParams(LEGACY);
        const after = buildGeneNameParams(derivePgseaPersistPayload(LEGACY).input);
        assert.deepStrictEqual(after, before);
        assert.deepStrictEqual(before, [
            { gene: "GOLM1", geneStat: 0.377827741 },
            { gene: "POLD4", geneStat: 0.442827998 },
            { gene: "ZNF496", geneStat: -0.384958431 },
        ]);
    });

    it("cannot be ranked by p-value — the option is unavailable and requests clamp to 'fc'", function () {
        const payload = derivePgseaPersistPayload(LEGACY, { requestedRankingBy: "pval" });
        assert.deepStrictEqual(payload.available, ["fc"]);
        assert.strictEqual(payload.rankingBy, "fc", "a forced 'pval' must clamp, not empty the input");
        assert.strictEqual(payload.input, LEGACY);
        assert.ok(payload.input.length > 0, "the collapsed input must never come back empty");
    });

    it("keeps the first row when a gene symbol looks like a header word (regression)", function () {
        // HEADER_GENE_RE used to be unanchored, so "GENE1" — the string in the wizard's own
        // textarea placeholder — was treated as a header and its row silently dropped.
        const text = "GENE1\t2.5\nGENE2\t1.8\nGENE3\t-1.2";
        const r = normalizePgseaInput(text);
        assert.strictEqual(r.hadHeader, false, "GENE1 is a gene, not a header");
        assert.strictEqual(r.rows.length, 3);
        assert.strictEqual(r.rows[0].gene, "GENE1");
        assert.strictEqual(r.content, text);

        // Real headers are still detected, both by name and by non-numeric value columns.
        assert.strictEqual(normalizePgseaInput("Gene\tFold-Change\nA\t2").hadHeader, true);
        assert.strictEqual(normalizePgseaInput("GeneID\t1\nA\t2").hadHeader, true);
        assert.strictEqual(normalizePgseaInput("Feature\tFold-Change\nA\t2").hadHeader, true);
        assert.strictEqual(normalizePgseaInput("SYMBOL\tlogFC\nA\t2").hadHeader, true);
    });

    it("still recognises real-world annotation headers even when every value column is numeric", function () {
        // These matched the old unanchored regex; the anchored one must keep them, because in
        // this shape the non-numeric-value-column fallback cannot help.
        for (const header of [
            "Gene", "Genes", "Symbol", "Symbols", "GeneSymbol", "Gene Symbol", "Gene Symbols",
            "gene_symbol", "Gene.ID", "Gene ID", "GeneID", "gene_id", "Gene name", "geneName",
            "gene_name", "external_gene_name", "hgnc_symbol", "ensembl_gene_id", "probe_id",
            "ID", "Name",
        ]) {
            const r = normalizePgseaInput(`${header}\t1\nA\t2\nB\t3`);
            assert.strictEqual(r.hadHeader, true, `"${header}" should be detected as a header`);
        }
    });

    it("never mistakes a real gene symbol for a header", function () {
        // Tricky real HGNC/Ensembl-style symbols, incl. ones containing digits, dots and dashes.
        for (const gene of [
            "GENE1", "GENE2", "MIR1-1", "TP53", "HLA-A", "C9orf72", "GOLM1", "SNORA40",
            "AL133245.1", "RP11-34P13.7", "7SK", "NKX2-1", "H19", "MT-CO1",
        ]) {
            const r = normalizePgseaInput(`${gene}\t2.5\nOTHER\t1.0`);
            assert.strictEqual(r.hadHeader, false, `"${gene}" is a gene, not a header`);
            assert.strictEqual(r.rows.length, 2, `"${gene}" row must not be dropped`);
            assert.strictEqual(r.rows[0].gene, gene);
        }
    });
});

describe("RANKING GATE — the signed column wins when no Fold-Change header exists", function () {
    // A limma topTable without logFC: Gene / AveExpr / t / P.Value. AveExpr is an unsigned
    // magnitude (always > 0); t is the signed statistic. Picking AveExpr ranks on mean
    // expression and — worse — makes sign() always positive, so a down-regulated gene gets a
    // POSITIVE p-value ranking and every pathway NES sign flips.
    const NO_FC_HEADER =
        "Gene\tAveExpr\tt\tP.Value\n" +
        "UPGENE\t8.0\t5.5\t0.001\n" +
        "DOWNGENE\t7.0\t-4.0\t0.01";

    it("ranks on the signed statistic, not the unsigned magnitude column", function () {
        const r = normalizePgseaInput(NO_FC_HEADER);
        assert.strictEqual(r.content, "UPGENE\t5.5\nDOWNGENE\t-4.0",
            "expected the signed t column, not AveExpr");
    });

    it("keeps a down-regulated gene NEGATIVE in p-value mode", function () {
        const r = normalizePgseaInput(NO_FC_HEADER, { rankingBy: "pval" });
        const [up, down] = r.content.split("\n").map((l) => parseFloat(l.split("\t")[1]));
        assert.ok(up > 0, `UPGENE (t=+5.5) must be positive, got ${up}`);
        assert.ok(down < 0, `DOWNGENE (t=-4.0) must be NEGATIVE, got ${down}`);
    });

    it("still works for DESeq2's Gene/baseMean/stat/pvalue layout", function () {
        const r = normalizePgseaInput(
            "Gene\tbaseMean\tstat\tpvalue\nA\t500\t3.1\t0.01\nB\t420\t-2.7\t0.02",
            { rankingBy: "pval" }
        );
        const [a, b] = r.content.split("\n").map((l) => parseFloat(l.split("\t")[1]));
        assert.ok(a > 0 && b < 0, `expected +/-, got ${a}/${b}`);
    });

    it("falls back to the first numeric column when nothing is signed", function () {
        const r = normalizePgseaInput("Gene\tScore\tP.Value\nA\t2\t0.01\nB\t1\t0.02");
        assert.strictEqual(r.content, "A\t2\nB\t1");
    });

    it("finds the signed column even when the file is sorted so negatives come late", function () {
        // DE tables are normally delivered SORTED BY THE STATISTIC, so every negative t sits
        // at the bottom. Sampling only the first N rows makes the signed-column scan find
        // nothing and silently fall back to the unsigned magnitude — i.e. the original bug,
        // on exactly the file class this is meant to fix.
        const rows = [];
        for (let i = 0; i < 260; i++) {
            const t = i < 210 ? (5 - i / 100) : -(1 + i / 100); // positives first, negatives last
            rows.push(`G${i}\t8.00\t${t.toFixed(2)}\t0.01`);
        }
        const r = normalizePgseaInput(`Gene\tAveExpr\tt\tP.Value\n${rows.join('\n')}`);
        const firstStat = r.content.split('\n')[0].split('\t')[1];
        assert.notStrictEqual(firstStat, '8.00', 'must not rank on AveExpr (mean expression)');
        assert.strictEqual(firstStat, '5.00', 'expected the signed t column');

        const pv = normalizePgseaInput(`Gene\tAveExpr\tt\tP.Value\n${rows.join('\n')}`, { rankingBy: 'pval' });
        const last = parseFloat(pv.content.split('\n').pop().split('\t')[1]);
        assert.ok(last < 0, `the last gene has t<0 and must rank negative, got ${last}`);
    });

    it("does not let an all-positive stat-NAMED column steal from a genuinely signed one", function () {
        // `score` is stat-named but unsigned here; `t` carries the direction. Preferring the
        // name alone reintroduces the all-positive-sign bug: every gene ranks positive.
        const r = normalizePgseaInput(
            "Gene\tscore\tt\tP.Value\nUP\t0.9\t5.5\t0.001\nDOWN\t0.8\t-4.0\t0.01"
        );
        assert.strictEqual(r.content, "UP\t5.5\nDOWN\t-4.0", "expected t, not score");
        const pv = normalizePgseaInput(
            "Gene\tscore\tt\tP.Value\nUP\t0.9\t5.5\t0.001\nDOWN\t0.8\t-4.0\t0.01",
            { rankingBy: "pval" }
        );
        const down = parseFloat(pv.content.split("\n")[1].split("\t")[1]);
        assert.ok(down < 0, `DOWN must rank negative, got ${down}`);
    });

    it("still uses a stat-named column when nothing in the file is signed", function () {
        const r = normalizePgseaInput("Gene\tAveExpr\tscore\tP.Value\nA\t8\t0.9\t0.01\nB\t7\t0.8\t0.02");
        assert.strictEqual(r.content, "A\t0.9\nB\t0.8");
    });

    it("prefers a named statistic column over any other signed column", function () {
        // limma's `B` (log-odds of differential expression) goes negative, but a negative B
        // means "probably not DE", not "down-regulated". `t` is the directional statistic.
        const r = normalizePgseaInput(
            "Gene\tAveExpr\tt\tB\tP.Value\nA\t8\t5.5\t-1.2\t0.001\nB\t7\t-4.0\t-3.4\t0.01"
        );
        assert.strictEqual(r.content, "A\t5.5\nB\t-4.0", "expected the t column, not B");
    });
});

describe("RANKING GATE — real p-value columns whose name contains 'log'", function () {
    it("still ranks by p-value for a log-rank test column", function () {
        // `log_rank_pvalue` is a genuine probability (log-rank test — common in survival/TCGA
        // tables). Excluding every /log/ name made it the fold-change column instead, so FGSEA
        // ranked on the raw p-value ASCENDING: least-significant genes at the top, all
        // positive. That is worse than the bug the exclusion was added to fix.
        // (Note `logrank_p` with no "val"/"value" is not matched by HEADER_PVAL_RE at all —
        // a pre-existing gap in the name list, unrelated to this fix.)
        const text = "Gene\tlog_rank_pvalue\nA\t0.01\nB\t0.5\nC\t0.9";
        const r = normalizePgseaInput(text);
        assert.deepStrictEqual(r.available, ["pval"], "a [0,1] column is a real p-value");
        const stats = r.content.split("\n").map((l) => parseFloat(l.split("\t")[1]));
        assert.ok(stats[0] > stats[1] && stats[1] > stats[2],
            `most significant must rank highest, got ${stats}`);
    });

    it("keeps p-value ranking available when a logFC sits beside a log-named p column", function () {
        const r = normalizePgseaInput("Gene\tlogFC\tlog.P.Value\nA\t2\t0.01\nB\t-1\t0.5");
        assert.deepStrictEqual(r.available, ["fc", "pval"]);
        assert.strictEqual(r.content, "A\t2\nB\t-1");
    });

    it("still refuses to treat a -log10(p) magnitude column as a probability", function () {
        const r = normalizePgseaInput("Gene\tlogFC\tneg_log10_pval\nA\t2\t12.3\nB\t-1\t8.4");
        assert.deepStrictEqual(r.available, ["fc"], "values outside [0,1] are not p-values");
    });

    it("tolerates a sentinel in a SMALL p-value-only file (ranking would otherwise invert)", function () {
        // The 2-column shape is where a misread costs everything: with no other value column,
        // the rejected p-value column becomes the ranking statistic and FGSEA ranks on the raw
        // p ASCENDING — least-significant genes on top. A fraction-based threshold alone is too
        // brittle here, since one bad cell in three is 33%.
        const r = normalizePgseaInput("Gene\tpvalue\nA\t0.01\nB\t0.5\nC\t999");
        assert.deepStrictEqual(r.available, ["pval"], "one sentinel must not invert the ranking");
        const stats = r.content.split("\n").map((l) => parseFloat(l.split("\t")[1]));
        assert.ok(stats[0] > stats[1], "most significant gene must rank highest");
    });

    it("tolerates a stray out-of-range cell in a genuine p-value column", function () {
        // A `999` "not tested" sentinel or a `1.0000001` rounding artefact must not disqualify
        // the whole column — it would then become the ranking statistic, silently losing the
        // p-value mode the user picked.
        const rows = [];
        for (let i = 0; i < 40; i++) rows.push(`G${i}\t${(i % 2 ? 1 : -1) * 2}\t0.0${i % 9}1`);
        rows.push("SENTINEL\t1.5\t999");
        rows.push("ROUNDED\t-1.5\t1.0000001");
        const r = normalizePgseaInput(`Gene\tlogFC\tP.Value\n${rows.join("\n")}`);
        assert.deepStrictEqual(r.available, ["fc", "pval"],
            "a couple of bad cells must not cost the whole column");
    });

    it("rejects a -log10(padj) column even when most of its values are <= 1", function () {
        // The realistic carrier of this inversion is an ADJUSTED column: after FDR correction
        // a low-signal experiment parks most genes at padj ~ 1, so -log10(padj) ~ 0 for nearly
        // all of them and only the few real hits exceed 1. A plain fraction test therefore sees
        // 96% "in range" and admits it — and then the four genuinely significant genes clamp to
        // stat 0 (dead centre of the ranking) while the null genes get +/-1.699 at the extremes.
        const rows = [];
        for (let i = 0; i < 96; i++) rows.push(`N${i}\t${i % 2 ? 1 : -1}\t0.0${(i % 3) + 2}`);
        for (let i = 0; i < 4; i++) rows.push(`S${i}\t2\t${5 + i}.0`);
        const r = normalizePgseaInput(`Gene\tlogFC\tneg_log10_padj\n${rows.join("\n")}`);
        assert.deepStrictEqual(r.available, ["fc"],
            "a -log10 tail is many DISTINCT out-of-range values, not a sentinel");
    });

    it("rejects a short -log10 column with a single value <= 1", function () {
        const r = normalizePgseaInput("Gene\tlogFC\tneg_log10_pval\nA\t2\t12.3\nB\t-1\t0.5");
        assert.deepStrictEqual(r.available, ["fc"],
            "one outlier in two values is not a sentinel");
    });

    it("does not accept a mostly-out-of-range column as a probability", function () {
        const rows = [];
        for (let i = 0; i < 20; i++) rows.push(`G${i}\t2\t${5 + i}`); // all > 1
        rows.push("ONE\t2\t0.5");                                      // a single in-range value
        const r = normalizePgseaInput(`Gene\tlogFC\tP.Value\n${rows.join("\n")}`);
        assert.deepStrictEqual(r.available, ["fc"],
            "a column that is mostly > 1 is a magnitude, not a probability");
    });
});

describe("RANKING GATE — a -log10(p) column is not treated as a raw p-value", function () {
    it("does not offer p-value ranking off an already-transformed column", function () {
        // `neg_log10_pval` matched the p-value regex, so pval mode computed
        // sign(fc) * -log10(12.3) — negative-of-a-positive — and every statistic collapsed
        // toward a constant, silently producing a useless ranking.
        const text = "Gene\tlogFC\tneg_log10_pval\nA\t2\t12.3\nB\t-1\t8.4";
        const r = normalizePgseaInput(text);
        assert.deepStrictEqual(r.available, ["fc"],
            "a -log10(p) column must not be advertised as a p-value");
        assert.strictEqual(r.content, "A\t2\nB\t-1");
    });

    it("still recognises genuine p-value headers", function () {
        for (const h of [
            "P-value", "P.Value", "pvalue", "padj", "adj.P.Val", "FDR", "qvalue",
            // Trailing-`p` family and R's coefficient-table name — on a 2-column file these
            // would otherwise become the ranking statistic and invert the ranking.
            "logrank_p", "wald_p", "lrt_p", "chisq_p", "Pr(>|t|)",
        ]) {
            const r = normalizePgseaInput(`Gene\tlogFC\t${h}\nA\t2\t0.01\nB\t-1\t0.02`);
            assert.deepStrictEqual(r.available, ["fc", "pval"], `"${h}" should be a p-value column`);
        }
    });

    it("does not treat ordinary value columns as p-values just because they end in p", function () {
        for (const h of ["exp", "temp", "logFC", "AveExpr", "baseMean", "step"]) {
            const r = normalizePgseaInput(`Gene\t${h}\nA\t0.2\nB\t0.4`);
            assert.deepStrictEqual(r.available, ["fc"], `"${h}" must not be read as a p-value`);
        }
    });
});

describe("RANKING GATE — a missing value in row 0 is not a header", function () {
    it("does not classify a headerless first row as a header just because its stat is NA", function () {
        const r = normalizePgseaInput("GENE1\tNA\nGENE2\t1.8\nGENE3\t-1.2");
        assert.strictEqual(r.hadHeader, false, "NA is missing data, not a header label");
        // GENE1 is still dropped — but for the ordinary reason (no usable statistic), exactly
        // as it would be on row 50. The bug was that it was consumed as a HEADER, which also
        // changed column detection for the whole file.
        assert.deepStrictEqual(r.rows.map((x) => x.gene), ["GENE2", "GENE3"]);
    });

    it("keeps a headerless first row whose stat is valid but whose p-value is NA", function () {
        const r = normalizePgseaInput("GENE1\t2.5\tNA\nGENE2\t1.8\t0.01");
        assert.strictEqual(r.hadHeader, false);
        assert.strictEqual(r.rows[0].gene, "GENE1", "GENE1 has a usable fold-change");
    });

    it("keeps the p-value option when row 0 has an NA p-value", function () {
        const r = normalizePgseaInput("GENE1\t2.5\tNA\nGENE2\t1.8\t0.01\nGENE3\t-1.2\t0.5");
        assert.strictEqual(r.hadHeader, false);
        assert.deepStrictEqual(r.available, ["fc", "pval"],
            "the file has p-values; one missing cell must not disable the option");
    });

    it("still treats a genuine label row as a header", function () {
        assert.strictEqual(normalizePgseaInput("Feature\tFold-Change\nA\t2").hadHeader, true);
    });
});

describe("derivePgseaPersistPayload", function () {
    it("reports empty input rather than throwing", function () {
        const r = derivePgseaPersistPayload("   \n  ");
        assert.strictEqual(r.isEmpty, true);
        assert.strictEqual(r.input, "");
        assert.strictEqual(r.inputRaw, "");
        assert.strictEqual(r.error, null);
    });

    it("applies ranking precedence: requested beats stored beats the file default", function () {
        assert.strictEqual(
            derivePgseaPersistPayload(RANK_FIXTURE_3COL, { storedRankingBy: "pval" }).rankingBy, "pval");
        assert.strictEqual(
            derivePgseaPersistPayload(RANK_FIXTURE_3COL, { storedRankingBy: "pval", requestedRankingBy: "fc" }).rankingBy, "fc");
        assert.strictEqual(derivePgseaPersistPayload(RANK_FIXTURE_3COL).rankingBy, "fc");
    });

    it("rescues literal \\t tabs, and stores the FIXED text as inputRaw so it re-derives", function () {
        const broken = "GENE1\\t2.5\\nGENE2\\t1.8".replace(/\\n/g, "\n");
        const r = derivePgseaPersistPayload(broken);
        assert.strictEqual(r.error, null);
        assert.strictEqual(r.input, "GENE1\t2.5\nGENE2\t1.8");
        // inputRaw must be re-parseable — this is what the ranking radio re-derives from.
        assert.strictEqual(derivePgseaPersistPayload(r.inputRaw).input, r.input);
    });

    it("does NOT corrupt a valid CSV that merely contains a literal \\t", function () {
        // The old unconditional fixup fired here (a comma file has no real tabs), injected
        // tabs and made detectDelimiter pick tab, turning a valid file into garbage.
        const csv = "Gene,Fold-Change\nA\\tB,2\nC,-1";
        const r = derivePgseaPersistPayload(csv);
        assert.strictEqual(r.error, null);
        assert.strictEqual(r.input, "A\\tB\t2\nC\t-1", "the gene name keeps its literal backslash-t");
    });

    it("passes unparseable text through verbatim with an error, never throwing", function () {
        const junk = "onecolumnonly\nanotherline";
        const r = derivePgseaPersistPayload(junk);
        assert.ok(r.error, "expected an error message");
        assert.strictEqual(r.input, junk);
        assert.strictEqual(r.inputRaw, junk);
        assert.strictEqual(r.rankingBy, null);
        assert.deepStrictEqual(r.available, []);
    });

    it("exposes `available` so the UI can disable the p-value radio", function () {
        assert.deepStrictEqual(derivePgseaPersistPayload(RANK_FIXTURE_3COL).available, ["fc", "pval"]);
        assert.deepStrictEqual(derivePgseaPersistPayload("A\t1\nB\t2").available, ["fc"]);
        assert.deepStrictEqual(derivePgseaPersistPayload("Gene\tP-value\nA\t0.01").available, ["pval"]);
    });

    it("accepts a comma-separated 3-column table", function () {
        const r = derivePgseaPersistPayload("Gene,Fold-Change,P-value\nA,2,0.01\nB,-1,0.001");
        assert.deepStrictEqual(r.available, ["fc", "pval"]);
        assert.strictEqual(r.input, "A\t2\nB\t-1");
    });
});

describe("parsePgseaGeneStats — the server's canonical-input parser", function () {
    it("de-duplicates genes while preserving first-occurrence order", function () {
        const { inputGeneList } = parsePgseaGeneStats("A\t1\nB\t2\nA\t3");
        assert.deepStrictEqual(inputGeneList, ["A", "B"]);
    });

    it("keeps the LAST statistic for a duplicated gene (unchanged legacy behaviour)", function () {
        const { geneData } = parsePgseaGeneStats("A\t1\nA\t3");
        assert.strictEqual(geneData.A.rankStat, 3);
    });

    it("drops rows that are not exactly 2 tab-separated fields (unchanged legacy behaviour)", function () {
        const { geneData } = parsePgseaGeneStats("A\t1\nB\t2\t3\nC\t4");
        assert.deepStrictEqual(Object.keys(geneData).sort(), ["A", "C"]);
    });

    it("ignores blank lines, CRLF and surrounding whitespace", function () {
        const { inputGeneList, geneData } = parsePgseaGeneStats("\r\nA\t1\r\n\n B \t 2 \n");
        assert.deepStrictEqual(inputGeneList, ["A", "B"]);
        assert.strictEqual(geneData.B.rankStat, 2);
    });

    it("skips non-numeric statistics", function () {
        const { geneData } = parsePgseaGeneStats("A\tNA\nB\t2");
        assert.deepStrictEqual(Object.keys(geneData), ["B"]);
    });

    it("throws on missing input rather than silently returning an empty ranking", function () {
        // The original inline parser threw a TypeError here. Failing loudly matters: an empty
        // result would let FGSEA "succeed" on a ranking with no genes in it.
        assert.throws(() => parsePgseaGeneStats(undefined), /no input data/i);
        assert.throws(() => parsePgseaGeneStats(null), /no input data/i);
    });
});

describe("buildPgseaVolcanoRows — the pgsea.volcano.plot decision", function () {
    const THREE_COL =
        "Gene\tFold-Change\tP-value\nUP\t2.0\t0.01\nDOWN\t-1.5\t0.001\nNOP\t1.0\tNA";

    it("reads inputRaw, not the collapsed input", function () {
        // `input` is collapsed to one statistic and no longer carries p-values, so sourcing it
        // would make DE genes permanently unavailable.
        const r = buildPgseaVolcanoRows({ inputRaw: THREE_COL, input: "UP\t2.0\nDOWN\t-1.5" });
        assert.strictEqual(r.skipped, null);
        assert.deepStrictEqual(r.pcaData, [
            { id: "UP", pValue: 0.01, FC: 2.0 },
            { id: "DOWN", pValue: 0.001, FC: -1.5 },
        ], "rows missing a p-value are excluded");
    });

    it("falls back to input for analyses saved before inputRaw existed", function () {
        const r = buildPgseaVolcanoRows({ input: THREE_COL });
        assert.strictEqual(r.skipped, null);
        assert.strictEqual(r.pcaData.length, 2);
    });

    it("skips a 2-column file instead of producing rows", function () {
        const r = buildPgseaVolcanoRows({ input: "A\t1.5\nB\t-2.5" });
        assert.deepStrictEqual(r.pcaData, []);
        assert.match(r.skipped, /no p-value column/);
    });

    it("skips a p-value-only file rather than returning an empty result the caller would save", function () {
        // This is the regression that wiped previously computed DE genes: `available` is
        // ['pval'] so the p-value check passes, but every row lacks a fold-change.
        const r = buildPgseaVolcanoRows({ input: "Gene\tP-value\nA\t0.01\nB\t0.5" });
        assert.deepStrictEqual(r.pcaData, []);
        assert.match(r.skipped, /both a fold-change and a p-value/);
    });

    it("skips an unparseable file without throwing", function () {
        const r = buildPgseaVolcanoRows({ input: "onecolumnonly\nanotherline" });
        assert.deepStrictEqual(r.pcaData, []);
        assert.match(r.skipped, /unparseable/);
    });

    it("re-throws anything that is not the normalizer's own error", function () {
        // A fault that is not "this file is unusable" must surface rather than be reported as
        // "no p-values"; simulate with a value whose toString throws.
        const hostile = { toString() { throw new TypeError("boom"); } };
        assert.throws(() => buildPgseaVolcanoRows({ input: hostile }), /boom/);
    });
});

describe("RANKING_OPTIONS", function () {
    it("has the exact values and labels both selectors render", function () {
        assert.deepStrictEqual(RANKING_OPTIONS, [
            { value: "fc", label: "Fold Change" },
            { value: "pval", label: "Signed -log10(P-value)" },
        ]);
    });

    // NOTE: asserting that both selectors IMPORT this constant (rather than redefining it
    // locally) is a source-level check, and `meteor test` runs from a temp build bundle with
    // no access to the source tree — see tests/main.js. It lives in the standalone guard
    // instead: `npm run test:imports` (scripts/check-antd-imports.js).

    it("only offers values resolvePgseaRankingBy understands", function () {
        for (const opt of RANKING_OPTIONS) {
            assert.strictEqual(resolvePgseaRankingBy([opt.value], ["fc", "pval"]), opt.value);
        }
    });
});

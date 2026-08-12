import assert from "assert";
import buildPathwayMetaScript from "../server/include/rCommand/PathwayMetaAnalysis";
import buildDEMetaScript from "../server/include/rCommand/DEMetaAnalysis";
import {VALID_R_META_METHODS, rMetaMethodError} from "../imports/utils/rMetaMethods";
import {
    SE_METHOD,
    SE_METHOD_LABEL,
    NON_SE_METHOD_LABELS,
    FUNNEL_EMPTY_GENERIC,
    FUNNEL_EMPTY_REQUIRES_REML,
    FUNNEL_EMPTY_REML_NO_SE,
    buildFunnelPoints,
    hasFunnelData,
    funnelEmptyStateMessage,
} from "../imports/utils/funnelPlotMeta";

// Regression for the pathway-level meta-analysis crash:
//   "Can't select columns that don't exist. ✖ Column `seTE` doesn't exist."
// The R wrapper unconditionally did `select(ID, pValue, pFDR, score,
// normalizedScore, seTE)`, but `seTE` is only produced by the REML branch — every
// p-value combination method (stouffer/fisher/addCLT/geoMean/minP) crashed. The
// fix selects with `any_of()` so seTE is kept only when present.

// ---------------------------------------------------------------------------
// A. R-script generation regression (pure — no R needed)
// ---------------------------------------------------------------------------
describe("PathwayMetaAnalysis R script (seTE select regression)", function () {
    const script = buildPathwayMetaScript("/tmp/dummy.rds");

    it("uses any_of() for the final projection (tolerant of a missing seTE)", function () {
        assert.ok(/select\(\s*dplyr::any_of\(/.test(script), "expected select(dplyr::any_of(...))");
    });

    it("still lists seTE among the projected columns (REML keeps it)", function () {
        assert.ok(/any_of\(c\([^)]*"seTE"[^)]*\)\)/.test(script), "seTE should be in the any_of list");
    });

    it("no longer contains the bare unconditional select that crashed non-REML", function () {
        // The original crashing line: select(ID, pValue, pFDR, score, normalizedScore, seTE)
        assert.ok(!/select\(\s*ID\s*,/.test(script), "bare unquoted column select must be gone");
    });

    it("never selects seTE outside of any_of (catches both unquoted and quoted re-breaks)", function () {
        // Any select() that references seTE without going through dplyr::any_of would
        // crash for non-REML methods — exactly the original bug, in either spelling.
        assert.ok(
            !/select\((?!\s*dplyr::any_of)[^)]*seTE/.test(script),
            "seTE may only be projected via select(dplyr::any_of(...))"
        );
    });

    it("REML branch computes seTE, calls meta::metagen, and drops NA pooled estimates", function () {
        assert.ok(/dat\$seTE\s*<-/.test(script), "REML must derive a per-study seTE");
        assert.ok(/meta::metagen\(/.test(script), "REML must call meta::metagen");
        // Mirrors the gene-level branch: NA pooled estimates are dropped.
        assert.ok(/drop_na\(\s*p\.value\s*,\s*score\s*,\s*seTE\s*\)/.test(script), "REML must drop_na on p.value/score/seTE");
    });

    it("offers every documented method including the p-value methods and REML", function () {
        ["stouffer", "fisher", "addCLT", "geoMean", "minP", "REML"].forEach((m) => {
            assert.ok(script.includes(`"${m}"`), `method ${m} should be allowed`);
        });
    });

    it("wires each non-REML method to its p-value combine function", function () {
        // Not tautological: pins the switch() mapping, so a mis-wired method is caught.
        assert.ok(/fisher\s*=\s*\.runFisher/.test(script), "fisher -> .runFisher");
        assert.ok(/stouffer\s*=\s*\.runStouffer/.test(script), "stouffer -> .runStouffer");
        assert.ok(/minP\s*=\s*min/.test(script), "minP -> min");
        assert.ok(/addCLT\s*=\s*\.runAddCLT/.test(script), "addCLT -> .runAddCLT");
        assert.ok(/geoMean\s*=\s*\.runGeoMean/.test(script), "geoMean -> .runGeoMean");
    });
});

describe("DEMetaAnalysis R script (gene-level — must not regress into the seTE bug)", function () {
    const script = buildDEMetaScript("/tmp/dummy.rds");

    it("never selects a seTE column (gene-level uses logFCSE, present in both branches)", function () {
        // seTE.fixed appears only inside [, c(...)] indexing of metagen output — never
        // in a tidyselect select(); a select(... seTE ...) would be the bug.
        assert.ok(!/select\([^)]*\bseTE\b[^)]*\)/.test(script), "DE select must not reference seTE");
        assert.ok(/logFCSE/.test(script), "DE should select its own logFCSE");
    });
});

// ---------------------------------------------------------------------------
// B. Funnel-plot helper units (pure)
// ---------------------------------------------------------------------------
describe("buildFunnelPoints", function () {
    const remlResult = {
        databaseId: "db1",
        method: SE_METHOD,
        value: [
            {ID: "pwA", normalizedScore: 1.2, pValue: 0.01, pFDR: 0.02, seTE: 0.4},
            {ID: "pwB", normalizedScore: -0.8, pValue: 0.2, pFDR: 0.3, seTE: 0.5},
        ],
    };

    it("keeps one point per pathway that has a valid, positive, finite seTE", function () {
        const points = buildFunnelPoints([remlResult]);
        assert.strictEqual(points.length, 2);
        assert.deepStrictEqual(
            points.map((p) => p.pathwayId),
            ["pwA", "pwB"]
        );
        assert.strictEqual(points[0].se, 0.4);
        assert.strictEqual(points[0].score, 1.2);
        assert.strictEqual(points[0].pValueFDR, 0.02);
    });

    it("resolves display names via the supplied resolver (falls back to ID)", function () {
        const names = {pwA: "Apoptosis"};
        const points = buildFunnelPoints([remlResult], (id) => names[id] || id);
        assert.strictEqual(points[0].pathwayName, "Apoptosis");
        assert.strictEqual(points[1].pathwayName, "pwB"); // no name -> ID
    });

    it("drops points with missing / zero / negative / non-finite seTE", function () {
        const bad = {
            databaseId: "db1",
            method: SE_METHOD,
            value: [
                {ID: "noSE", normalizedScore: 1, pValue: 0.01, pFDR: 0.02}, // seTE undefined
                {ID: "zeroSE", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: 0},
                {ID: "negSE", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: -0.3},
                {ID: "nanSE", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: NaN},
                {ID: "infSE", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: Infinity},
                {ID: "ok", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: 0.3},
            ],
        };
        const points = buildFunnelPoints([bad]);
        assert.deepStrictEqual(points.map((p) => p.pathwayId), ["ok"]);
    });

    it("drops points with unusable p-values (0 or 1)", function () {
        const edge = {
            databaseId: "db1",
            value: [
                {ID: "p0", normalizedScore: 1, pValue: 0, pFDR: 0.02, seTE: 0.3},
                {ID: "p1", normalizedScore: 1, pValue: 1, pFDR: 0.02, seTE: 0.3},
                {ID: "ok", normalizedScore: 1, pValue: 0.05, pFDR: 0.02, seTE: 0.3},
            ],
        };
        assert.deepStrictEqual(buildFunnelPoints([edge]).map((p) => p.pathwayId), ["ok"]);
    });

    it("coerces a missing/null normalizedScore to score 0 (documents the || 0 contract)", function () {
        const result = {
            databaseId: "db1",
            method: SE_METHOD,
            value: [
                {ID: "noScore", pValue: 0.01, pFDR: 0.02, seTE: 0.3}, // normalizedScore undefined
                {ID: "nullScore", normalizedScore: null, pValue: 0.02, pFDR: 0.02, seTE: 0.3},
            ],
        };
        const points = buildFunnelPoints([result]);
        assert.deepStrictEqual(points.map((p) => p.pathwayId), ["noScore", "nullScore"]);
        assert.ok(points.every((p) => p.score === 0), "missing score coerces to 0");
    });

    it("yields zero points for a non-REML result (no seTE column at all)", function () {
        const stouffer = {
            databaseId: "db1",
            method: "stouffer",
            value: [
                {ID: "pwA", normalizedScore: 1.2, pValue: 0.01, pFDR: 0.02},
                {ID: "pwB", normalizedScore: -0.8, pValue: 0.2, pFDR: 0.3},
            ],
        };
        assert.strictEqual(buildFunnelPoints([stouffer]).length, 0);
    });

    it("does not throw on missing / malformed input", function () {
        assert.deepStrictEqual(buildFunnelPoints(undefined), []);
        assert.deepStrictEqual(buildFunnelPoints([]), []);
        assert.deepStrictEqual(buildFunnelPoints([{databaseId: "db1"}]), []); // no value
        assert.deepStrictEqual(buildFunnelPoints([null]), []);
    });
});

describe("hasFunnelData (drives hiding empty funnel tabs)", function () {
    it("is true when a REML result has at least one plottable point", function () {
        const reml = [{databaseId: "db1", method: SE_METHOD, value: [
            {ID: "pwA", normalizedScore: 1.2, pValue: 0.01, pFDR: 0.02, seTE: 0.4},
        ]}];
        assert.strictEqual(hasFunnelData(reml), true);
    });

    it("is false for non-REML results (no seTE) and for empty/missing input", function () {
        const stouffer = [{databaseId: "db1", method: "stouffer", value: [
            {ID: "pwA", normalizedScore: 1.2, pValue: 0.01, pFDR: 0.02},
        ]}];
        assert.strictEqual(hasFunnelData(stouffer), false);
        assert.strictEqual(hasFunnelData([]), false);
        assert.strictEqual(hasFunnelData(undefined), false);
    });
});

describe("funnelEmptyStateMessage", function () {
    it("returns the generic message when there are no results", function () {
        assert.strictEqual(funnelEmptyStateMessage([]), FUNNEL_EMPTY_GENERIC);
        assert.strictEqual(funnelEmptyStateMessage(undefined), FUNNEL_EMPTY_GENERIC);
    });

    it("returns the REML hint when the (recorded) method is not REML", function () {
        const stouffer = [{databaseId: "db1", method: "stouffer", value: []}];
        assert.strictEqual(funnelEmptyStateMessage(stouffer), FUNNEL_EMPTY_REQUIRES_REML);
    });

    it("returns the REML-no-SE message for a recorded REML run with no usable points (empty or NaN-SE rows)", function () {
        // Method is recorded -> the analysis ran; an empty funnel means REML yielded
        // no pathway with a usable SE (whether 0 rows or rows whose seTE is NaN).
        assert.strictEqual(
            funnelEmptyStateMessage([{databaseId: "db1", method: SE_METHOD, value: []}]),
            FUNNEL_EMPTY_REML_NO_SE
        );
        assert.strictEqual(
            funnelEmptyStateMessage([{
                databaseId: "db1",
                method: SE_METHOD,
                value: [{ID: "pwA", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: NaN}],
            }]),
            FUNNEL_EMPTY_REML_NO_SE
        );
    });

    it("spells out the SE method as the dropdown name plus its (REML) abbreviation", function () {
        assert.strictEqual(SE_METHOD_LABEL, "Restricted maximum likelihood (REML)");
        // still contains the exact dropdown wording users select ({label:'Restricted maximum likelihood'}).
        assert.ok(SE_METHOD_LABEL.includes("Restricted maximum likelihood"));
        assert.ok(FUNNEL_EMPTY_REQUIRES_REML.includes(SE_METHOD_LABEL));
        assert.ok(FUNNEL_EMPTY_REML_NO_SE.includes(SE_METHOD_LABEL));
    });

    it("explains 'standard error (SE)' in plain language for non-expert users", function () {
        assert.ok(FUNNEL_EMPTY_REQUIRES_REML.includes("standard error (SE)"));
        assert.ok(FUNNEL_EMPTY_REML_NO_SE.includes("standard error"));
    });

    it("names every non-REML method explicitly so users know which to avoid/pick", function () {
        NON_SE_METHOD_LABELS.forEach((label) => {
            assert.ok(FUNNEL_EMPTY_REQUIRES_REML.includes(label), `message should name ${label}`);
        });
        // No vague "etc." — the list is complete.
        assert.ok(!/etc\.?/i.test(FUNNEL_EMPTY_REQUIRES_REML), "message must not hide methods behind 'etc.'");
    });

    it("keeps the non-REML label list in sync with the method allow-list (5 non-REML + REML = 6)", function () {
        assert.strictEqual(NON_SE_METHOD_LABELS.length, VALID_R_META_METHODS.length - 1);
    });

    it("infers the REML hint for legacy results (no method) that carry no seTE", function () {
        const legacy = [{
            databaseId: "db1",
            value: [{ID: "pwA", normalizedScore: 1, pValue: 0.01, pFDR: 0.02}],
        }];
        assert.strictEqual(funnelEmptyStateMessage(legacy), FUNNEL_EMPTY_REQUIRES_REML);
    });

    it("stays generic for legacy results that DO carry a valid seTE", function () {
        const legacy = [{
            databaseId: "db1",
            value: [{ID: "pwA", normalizedScore: 1, pValue: 0.01, pFDR: 0.02, seTE: 0.4}],
        }];
        assert.strictEqual(funnelEmptyStateMessage(legacy), FUNNEL_EMPTY_GENERIC);
    });
});

// ---------------------------------------------------------------------------
// B2. Meta-analysis method allow-list validation (pure — security boundary)
// ---------------------------------------------------------------------------
describe("rMetaMethodError (method allow-list at the client-callable boundary)", function () {
    it("accepts every one of the six valid methods", function () {
        VALID_R_META_METHODS.forEach((m) => {
            assert.strictEqual(rMetaMethodError(m), null, `${m} should be valid`);
        });
    });

    it("rejects R/shell-injection strings via the character check", function () {
        [`REML");system("rm -rf /`, "stouffer; q()", "a'b", "x)y", "../etc", "a b"].forEach((m) => {
            assert.strictEqual(rMetaMethodError(m), "selectedMethod contains unexpected characters", m);
        });
    });

    it("rejects clean-but-unknown methods via the allow-list", function () {
        ["weightedZMean", "rra", "Stouffer", "reml", "fishers"].forEach((m) => {
            assert.strictEqual(rMetaMethodError(m), `Unknown meta-analysis method: ${m}`, m);
        });
    });

    it("rejects non-string input", function () {
        [undefined, null, 42, {}, ["REML"]].forEach((m) => {
            assert.strictEqual(rMetaMethodError(m), "selectedMethod contains unexpected characters");
        });
    });

    it("stays in sync with the R match.arg() allow-lists in both R command files", function () {
        const parse = (script) => {
            const m = script.match(/method\s*=\s*c\(([^)]*)\)/);
            return m ? (m[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, "")) : [];
        };
        const sorted = (a) => [...a].sort();
        const pathwayMethods = parse(buildPathwayMetaScript("/tmp/d.rds"));
        const deMethods = parse(buildDEMetaScript("/tmp/d.rds"));
        assert.deepStrictEqual(sorted(pathwayMethods), sorted(VALID_R_META_METHODS), "pathway R match.arg out of sync");
        assert.deepStrictEqual(sorted(deMethods), sorted(VALID_R_META_METHODS), "DE R match.arg out of sync");
    });
});

// ---------------------------------------------------------------------------
// C. R execution integration (guarded — runs only where Rscript is available)
// ---------------------------------------------------------------------------
describe("pathway meta-analysis R execution (integration)", function () {
    this.timeout(180000);

    let rEval, rCommand, path, Random, tempDir;
    let rAvailable = false;

    before(async function () {
        this.timeout(120000);
        try {
            rEval = (await import("../server/include/rEval")).default;
            rCommand = (await import("../server/include/rCommand")).default;
            path = (await import("path")).default;
            Random = (await import("meteor/random")).Random;
            tempDir = Meteor.settings && Meteor.settings.private && Meteor.settings.private.tempDir;
            if (!tempDir) return; // can't write the RDS without a temp dir
            await rEval("1 + 1"); // probe: throws if Rscript / conda env is unavailable
            rAvailable = true;
        } catch (e) {
            rAvailable = false; // do NOT this.skip() inside try — it would be swallowed
        }
    });

    const runMethod = async (method) => {
        const fileName = path.join(tempDir, `${Random.id()}_test_pathway_meta.rds`);
        const ids = ["pwA", "pwB", "pwC"];
        const mkDf = (scores, pvals) => `data.frame(
            ID = jsonlite::fromJSON('${JSON.stringify(ids)}'),
            p.value = jsonlite::fromJSON('${JSON.stringify(pvals)}'),
            normalizedScore = jsonlite::fromJSON('${JSON.stringify(scores)}'),
            sampleSize = jsonlite::fromJSON('${JSON.stringify([20, 20, 20])}')
        )`;
        await rEval(`
            saveRDS(list(
              PAResults = list(
                ${mkDf([1.2, -0.8, 0.3], [0.01, 0.2, 0.5])},
                ${mkDf([0.9, -1.1, 0.4], [0.02, 0.1, 0.6])}
              ),
              method = "${method}"
            ), file = "${fileName}")
            TRUE
        `);
        return rCommand.PathwayMetaAnalysis(fileName);
    };

    ["stouffer", "fisher", "REML"].forEach((method) => {
        it(`runs ${method} without the seTE error and returns the expected columns`, async function () {
            if (!rAvailable) this.skip();
            const result = await runMethod(method);
            assert.ok(Array.isArray(result) && result.length > 0, "expected non-empty result rows");
            const row = result[0];
            ["ID", "pValue", "pFDR", "score", "normalizedScore"].forEach((c) => {
                assert.ok(c in row, `result missing column ${c}`);
            });
            if (method === SE_METHOD) {
                assert.ok("seTE" in row, "REML result should include seTE");
                // Beyond mere column presence: every REML seTE must be a real,
                // finite, positive standard error (not an any_of-survivable NA).
                result.forEach((r) => {
                    assert.ok(
                        typeof r.seTE === "number" && isFinite(r.seTE) && r.seTE > 0,
                        `REML seTE must be finite positive, got ${r.seTE}`
                    );
                });
            } else {
                assert.ok(!("seTE" in row), `${method} result should not include seTE`);
            }
        });
    });
});

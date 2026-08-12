import assert from "assert";
import buildDEMetaScript from "../server/include/rCommand/DEMetaAnalysis";

// Regression for the gene-level meta-analysis crash:
//   Error in summarise(., weight = 1/(.data$logFCSE^2), ...):
//     `weight` must be size 1, not 2.
// The inverse-variance (non-REML) branch computed the per-study weight
// `1/(.data$logFCSE^2)` *inside* summarise(). In a group_by(ID) group a gene has one
// row per study, so `weight` is a length-N vector — but summarise() only allows size-1
// outputs, so modern dplyr rejects it and every non-REML method crashed.
//
// The fix moves the weight into a mutate() BEFORE group_by (where a per-row column is
// legal), leaving summarise() with only aggregating sum() expressions. The pooled math
// (Σ(logFC·w)/Σw and √(1/Σw)) and the output columns (ID, logFC, logFCSE) are unchanged.

// ---------------------------------------------------------------------------
// A. R-script generation regression (pure — no R needed)
// ---------------------------------------------------------------------------
describe("DEMetaAnalysis R script (weight must-be-size-1 regression)", function () {
    const script = buildDEMetaScript("/tmp/dummy.rds");

    it("computes the per-study weight in a mutate() (a per-row column is legal there)", function () {
        assert.ok(
            /mutate\(\s*weight\s*=\s*1\s*\/\s*\(\.data\$logFCSE\^2\)\s*\)/.test(script),
            "expected mutate(weight = 1 / (.data$logFCSE^2))"
        );
    });

    it("creates weight BEFORE the grouped summarise that aggregates it (per-row, with a group_by between)", function () {
        // Anchor to the inverse-variance summarise (the one that reads .data$weight);
        // a bare group_by search would wrongly hit the earlier pvalRes pipeline.
        const mutateIdx = script.search(/mutate\(\s*weight\s*=/);
        const summIdx = script.search(/summarise\(\s*logFC\s*=\s*sum\(\.data\$logFC\s*\*\s*\.data\$weight\)/);
        assert.ok(mutateIdx !== -1, "weight mutate must exist");
        assert.ok(summIdx !== -1, "the inverse-variance summarise must exist");
        assert.ok(mutateIdx < summIdx, "weight must be computed before the summarise that aggregates it");
        // A group_by sits between them, so weight is a per-row value within each gene group.
        assert.ok(
            /group_by\(\.data\$ID\)/.test(script.slice(mutateIdx, summIdx)),
            "group_by(.data$ID) must sit between the weight mutate and the summarise"
        );
    });

    it("no longer assigns weight as the first summarise() output (the exact size-1 crash)", function () {
        // The original crashing code opened the inverse-variance summarise() with
        // `weight = 1 / (.data$logFCSE^2)` — a length-N column summarise() rejects.
        // The other summarise() (pvalRes) opens with `left.p = ...`, so this is specific.
        assert.ok(
            !/summarise\(\s*weight\s*=/.test(script),
            "summarise() must not open by assigning `weight =` (must be size 1, not N)"
        );
    });

    it("keeps proper inverse-variance pooling (weighted mean + pooled SE via sum())", function () {
        assert.ok(
            /logFC\s*=\s*sum\(\.data\$logFC\s*\*\s*\.data\$weight\)\s*\/\s*sum\(\.data\$weight\)/.test(script),
            "pooled logFC must be sum(logFC*weight)/sum(weight)"
        );
        assert.ok(
            /logFCSE\s*=\s*sqrt\(1\s*\/\s*sum\(\.data\$weight\)\)/.test(script),
            "pooled logFCSE must be sqrt(1/sum(weight))"
        );
    });
});

// ---------------------------------------------------------------------------
// B. R execution integration (guarded — runs only where Rscript is available)
// ---------------------------------------------------------------------------
describe("gene-level meta-analysis R execution (integration)", function () {
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

    // Two studies, three shared genes. logFCSE chosen so weights are easy to verify.
    const ids = [1, 2, 3];
    // Study 1 SE = 0.10 -> weight 100; Study 2 SE = 0.12 -> weight ~69.444
    const study1 = {logFC: [0.5, -0.3, 0.8], logFCSE: [0.1, 0.1, 0.1], pValue: [0.01, 0.02, 0.03]};
    const study2 = {logFC: [0.6, -0.2, 0.7], logFCSE: [0.12, 0.12, 0.12], pValue: [0.02, 0.03, 0.04]};

    const runMethod = async (method) => {
        const fileName = path.join(tempDir, `${Random.id()}_test_gene_meta.rds`);
        const mkDf = (s) => `data.frame(
            ID = jsonlite::fromJSON('${JSON.stringify(ids)}'),
            p.value = jsonlite::fromJSON('${JSON.stringify(s.pValue)}'),
            logFC = jsonlite::fromJSON('${JSON.stringify(s.logFC)}'),
            logFCSE = jsonlite::fromJSON('${JSON.stringify(s.logFCSE)}'),
            sampleSize = jsonlite::fromJSON('${JSON.stringify([20, 20, 20])}')
        )`;
        await rEval(`
            saveRDS(list(
              DEResults = list(
                ${mkDf(study1)},
                ${mkDf(study2)}
              ),
              method = "${method}"
            ), file = "${fileName}")
            TRUE
        `);
        return rCommand.DEMetaAnalysis(fileName);
    };

    it("runs a non-REML method without the `weight must be size 1` error", async function () {
        if (!rAvailable) this.skip();
        const result = await runMethod("stouffer");
        assert.ok(Array.isArray(result) && result.length > 0, "expected non-empty result rows");
        ["ID", "pValue", "pFDR", "logFC", "logFCSE"].forEach((c) => {
            assert.ok(c in result[0], `result missing column ${c}`);
        });
    });

    it("produces the correct inverse-variance pooled logFC / logFCSE", async function () {
        if (!rAvailable) this.skip();
        const result = await runMethod("stouffer");
        // Hand-computed for gene 1: w1 = 1/0.10^2 = 100, w2 = 1/0.12^2 = 69.4444
        //   pooled logFC = (0.5*100 + 0.6*69.4444) / 169.4444 = 0.54098...
        //   pooled SE    = sqrt(1 / 169.4444)                  = 0.076822...
        const g1 = result.find((r) => Number(r.ID) === 1);
        assert.ok(g1, "gene 1 should be present in the pooled result");
        assert.ok(Math.abs(g1.logFC - 0.540984) < 1e-3, `pooled logFC ~0.541, got ${g1.logFC}`);
        assert.ok(Math.abs(g1.logFCSE - 0.076822) < 1e-3, `pooled logFCSE ~0.0768, got ${g1.logFCSE}`);
        // Pooled SE is smaller than either input SE (0.10, 0.12) — a sanity check that
        // this is a real inverse-variance combination, not a degenerate sum.
        assert.ok(g1.logFCSE < 0.1, "pooled SE must be smaller than the smallest study SE");
    });
});

import assert from "assert";
import { buildPgseaGeneStatRows } from "../imports/utils/pgseaInput";
import { SE_MAX } from "../imports/utils/pgseaLogFCSE";

// Gene-level meta-analysis over pgsea (ranked gene list with statistics) datasets, through the real
// R script. A pasted table has no standard error; DEMetaAnalysis.js pools logFC by inverse variance
// for every non-REML method and drop_na() discards any gene without a logFCSE. These prove that the
// SE derived from FC and p (imports/utils/pgseaLogFCSE.js) keeps every shared gene in the result —
// including a zero-fold-change gene, which gets SE_MAX (no weight) rather than being excluded.
// Guarded: runs only where Rscript is available, like meta-analysis-gene-level-rscript.tests.js.
describe("gene-level meta-analysis over pgsea datasets (R integration)", function () {
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
            if (!tempDir) return;
            await rEval("1 + 1");
            rAvailable = true;
        } catch (e) {
            rAvailable = false; // do NOT this.skip() inside try — it would be swallowed
        }
    });

    // Two uploads over the same four genes; gene 4 has a zero fold change in study 1.
    const study1 = buildPgseaGeneStatRows([
        { id: "1", FC: 1.5, pValue: 0.001 },
        { id: "2", FC: -0.8, pValue: 0.02 },
        { id: "3", FC: 0.2, pValue: 0.6 },
        { id: "4", FC: 0, pValue: 0.9 },
    ]).rows;
    const study2 = buildPgseaGeneStatRows([
        { id: "1", FC: 1.2, pValue: 0.004 },
        { id: "2", FC: -1.1, pValue: 0.01 },
        { id: "3", FC: -0.1, pValue: 0.8 },
        { id: "4", FC: 0.3, pValue: 0.4 },
    ]).rows;

    // Mirrors meta.analysis.DE.compute's data frame (server/api/methods/analysis.js), including its
    // use of pValueFDR as p.value and the pgsea default sample size of 20.
    const runMethod = async (method) => {
        const fileName = path.join(tempDir, `${Random.id()}_test_pgsea_gene_meta.rds`);
        const mkDf = (rows) => `data.frame(
            ID = jsonlite::fromJSON('${JSON.stringify(rows.map((r) => parseInt(r.id)))}'),
            p.value = jsonlite::fromJSON('${JSON.stringify(rows.map((r) => r.pValueFDR))}'),
            logFC = jsonlite::fromJSON('${JSON.stringify(rows.map((r) => r.FC))}'),
            logFCSE = jsonlite::fromJSON('${JSON.stringify(rows.map((r) => r.logFCSE))}'),
            sampleSize = jsonlite::fromJSON('${JSON.stringify(rows.map(() => 20))}')
        )`;
        await rEval(`
            saveRDS(list(
              DEResults = list(${mkDf(study1)}, ${mkDf(study2)}),
              method = "${method}"
            ), file = "${fileName}")
            TRUE
        `);
        return rCommand.DEMetaAnalysis(fileName);
    };

    it("keeps the zero-fold-change gene at SE_MAX instead of dropping it", function () {
        assert.strictEqual(study1.find((r) => r.id === "4").logFCSE, SE_MAX);
    });

    for (const method of ["stouffer", "fisher", "REML"]) {
        it(`${method}: every shared gene survives with a finite pooled logFC and logFCSE`, async function () {
            if (!rAvailable) this.skip();
            const result = await runMethod(method);
            assert.deepStrictEqual(result.map((r) => Number(r.ID)).sort(), [1, 2, 3, 4],
                "a gene missing here was dropped by drop_na() — its logFCSE did not survive");
            for (const r of result) {
                assert.ok(Number.isFinite(r.logFC) && Number.isFinite(r.logFCSE), JSON.stringify(r));
            }
        });
    }

    it("stouffer: the zero-FC study carries no weight in the pooled logFC", async function () {
        if (!rAvailable) this.skip();
        const result = await runMethod("stouffer");
        const g4 = result.find((r) => Number(r.ID) === 4);
        // weight(study 1) = 1/SE_MAX^2 = 1e-8, so the pool is study 2's FC (0.3) to ~1e-7.
        assert.ok(Math.abs(g4.logFC - 0.3) < 1e-4, `pooled logFC ${g4.logFC}`);
    });
});

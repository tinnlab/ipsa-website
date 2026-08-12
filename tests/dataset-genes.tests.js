// datasets[].genes mapping for the meta / mass-analysis interpretation payload (pure).
//
// Regression context: getDatasetGenes used to read the `volcanoPlotData` snapshot and map
// `gene`/`log2FoldChange`/`pvalue`/`padj`. No stored row has those fields, so all 23083 genes
// of a real analysis were sent as {geneSymbol: "<entrez id>", foldChange: 0, pValue: 1,
// pValueFDR: 1} — type-valid against the pipeline's GeneInput model, therefore never rejected,
// and unmatchable by the symbol-keyed reproducibility step.
import assert from "assert";
import { mapDatasetGenes } from "../imports/utils/datasetGenes";

// Real row shapes observed in the database (analysisConfigSnapshots).
const DE_GENES_WITH_PVALUES = {
    FC: -0.5132935923353372,
    pValueFDR: 1.649852206110073e-10,
    pValue: 8.19243858529379e-11,
    _id: "1",
    taxId: "9606",
    symbol: "A1BG",
    description: "alpha-1-B glycoprotein",
};

const DE_GENES_NO_PVALUES = {
    FC: 1.25,
    _id: "7157",
    taxId: "9606",
    symbol: "TP53",
    description: "tumor protein p53",
};

// getDEGenes returns THIS shape from its meta-analysis branch (metaGeneLevelValue →
// metaDE volcanoPlotData, with FC added by normalizeMetaFoldChange). No `symbol` field.
const META_DE_ROW = {
    ID: 55727,
    pValue: 7.8787e-13,
    pFDR: 1.6893e-8,
    logFC: 0.5153,
    logFCSE: 0.0922,
    FC: 0.5153,
};

// The snapshot the OLD implementation read, for the regression guard.
const VOLCANO_PLOT_ROW = {
    FC: 4.719305724307137,
    pValue: 1.002801756072673e-211,
    id: "991",
    avgExp: 3.834365739385066,
    pValueFDR: 2.314767293542552e-207,
    fitted: 0.5237306177244675,
    logFCSE: 0.102536282304508,
};

describe("dataset genes → interpretation payload", function () {
    describe("DEGenes-backed analyses (the happy path)", function () {
        it("maps symbol, log2 fold change and both p-values", function () {
            const {genes, total, symbolless} = mapDatasetGenes([DE_GENES_WITH_PVALUES]);

            assert.strictEqual(total, 1);
            assert.strictEqual(symbolless, 0);
            assert.deepStrictEqual(genes, [{
                geneSymbol: "A1BG",
                foldChange: -0.5132935923353372,
                pValue: 8.19243858529379e-11,
                pValueFDR: 1.649852206110073e-10,
            }]);
        });

        it("falls back to pValue/pValueFDR of 1 when the snapshot has no p-values", function () {
            // Matches the AI-interpretation table, which omits those columns for exactly the
            // analyses whose DEGenes rows carry no p-values.
            const {genes} = mapDatasetGenes([DE_GENES_NO_PVALUES]);

            assert.deepStrictEqual(genes, [{
                geneSymbol: "TP53",
                foldChange: 1.25,
                pValue: 1,
                pValueFDR: 1,
            }]);
        });

        it("never emits a fold change of 0 for a gene that has one", function () {
            const {genes} = mapDatasetGenes([DE_GENES_WITH_PVALUES, DE_GENES_NO_PVALUES]);
            assert.ok(genes.every(g => g.foldChange !== 0));
            assert.deepStrictEqual(genes.map(g => g.geneSymbol), ["A1BG", "TP53"]);
        });

        it("coerces numeric strings (R/JSON round-trips) rather than dropping them", function () {
            const {genes} = mapDatasetGenes([
                {symbol: "EGFR", FC: "2.5", pValue: "0.001", pValueFDR: "0.01"},
            ]);
            assert.deepStrictEqual(genes, [{
                geneSymbol: "EGFR",
                foldChange: 2.5,
                pValue: 0.001,
                pValueFDR: 0.01,
            }]);
        });

        it("does not mutate the input rows", function () {
            const row = {...DE_GENES_WITH_PVALUES};
            mapDatasetGenes([row]);
            assert.deepStrictEqual(row, DE_GENES_WITH_PVALUES);
        });
    });

    describe("symbol-less shapes are dropped loudly, never mapped onto an id", function () {
        it("returns no genes for the metaDE gene-level shape and reports every row", function () {
            // This is the branch getDEGenes takes when the analysisId is in
            // session.metaAnalyses. Falling back to the row's id here would re-create the
            // original bug through the fix, with nothing raised.
            const {genes, total, symbolless, sampleKeys} = mapDatasetGenes([META_DE_ROW, META_DE_ROW]);

            assert.deepStrictEqual(genes, []);
            assert.strictEqual(total, 2);
            assert.strictEqual(symbolless, 2, "every metaDE row must be counted as symbol-less");
            assert.ok(sampleKeys.includes("ID"), "row keys are reported so the log names the shape");
            assert.ok(!sampleKeys.includes("symbol"));
        });

        it("never returns a numeric Entrez id as a gene symbol", function () {
            // Guards the specific corruption: "991"/"55727" must never appear as a symbol,
            // whichever symbol-less shape arrives.
            const {genes} = mapDatasetGenes([VOLCANO_PLOT_ROW, META_DE_ROW]);

            assert.deepStrictEqual(genes, []);
            assert.ok(!genes.some(g => /^\d+$/.test(g.geneSymbol)));
        });

        it("keeps the good rows and counts only the bad ones in a mixed list", function () {
            const {genes, total, symbolless} = mapDatasetGenes([
                DE_GENES_WITH_PVALUES,
                META_DE_ROW,
                DE_GENES_NO_PVALUES,
            ]);

            assert.strictEqual(total, 3);
            assert.strictEqual(symbolless, 1);
            assert.deepStrictEqual(genes.map(g => g.geneSymbol), ["A1BG", "TP53"]);
        });

        it("treats an empty or whitespace-only symbol as symbol-less", function () {
            const {genes, symbolless} = mapDatasetGenes([
                {symbol: "", FC: 1, _id: "1"},
                {symbol: "   ", FC: 1, _id: "2"},
            ]);
            assert.deepStrictEqual(genes, []);
            assert.strictEqual(symbolless, 2);
        });
    });

    describe("absent data", function () {
        it("returns nothing for an analysis with no DE gene snapshot", function () {
            // pgsea / ora analyses have no DEGenes snapshot — [] is correct, not an error.
            [undefined, null, [], "not an array"].forEach((input) => {
                const {genes, total, symbolless} = mapDatasetGenes(input);
                assert.deepStrictEqual(genes, []);
                assert.strictEqual(total, 0);
                assert.strictEqual(symbolless, 0, "absent data must not be reported as a shape error");
            });
        });
    });
});

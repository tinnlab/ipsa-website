import assert from "assert";
import {
    formatNumberForExport,
    buildDEGenesCsv,
    selectGenesForExport,
    csvEscape,
    buildTableCsv,
    mergeSymbolsIntoRows,
} from "../imports/utils/exportUtils";

describe("DE genes export (Bug 4: full precision)", function () {
    describe("formatNumberForExport", function () {
        it("preserves tiny p-values instead of rounding to 0", function () {
            assert.strictEqual(formatNumberForExport(1e-9), "1e-9");
            assert.notStrictEqual(formatNumberForExport(0.0001), "0");
            assert.notStrictEqual(formatNumberForExport(0.0001), "0.00");
        });

        it("keeps full precision for normal magnitudes", function () {
            assert.strictEqual(formatNumberForExport(0.82), "0.82");
            assert.strictEqual(formatNumberForExport(1.6666666), "1.6666666");
            assert.strictEqual(formatNumberForExport(-1.5), "-1.5");
            assert.strictEqual(formatNumberForExport(0), "0");
        });

        it("renders missing / non-finite values as an empty cell", function () {
            assert.strictEqual(formatNumberForExport(null), "");
            assert.strictEqual(formatNumberForExport(undefined), "");
            assert.strictEqual(formatNumberForExport(NaN), "");
            assert.strictEqual(formatNumberForExport(Infinity), "");
        });
    });

    describe("buildDEGenesCsv", function () {
        it("emits Gene ID + Symbol + pValue.FDR / Log2FC for expression input and keeps precision", function () {
            const csv = buildDEGenesCsv({
                inputType: "expression",
                deGenesData: [
                    {id: "22827", symbol: "RTL8B", pValueFDR: 3.2e-12, FC: 0.82},
                    {id: "79365", symbol: "BHLHE41", pValueFDR: 0.00001, FC: 1.49},
                ],
            });
            const lines = csv.split("\n");
            assert.strictEqual(lines[0], "Gene ID,Symbol,pValue.FDR,Log2FC");
            assert.strictEqual(lines[1], "22827,RTL8B,3.2e-12,0.82");
            assert.strictEqual(lines[2], "79365,BHLHE41,0.00001,1.49");
            // Regression: no value should collapse to "0" / "0.00".
            assert.ok(!/,0(\.00)?,/.test(csv), `unexpected rounded zero in: ${csv}`);
        });

        it("emits Gene ID + Symbol + P-value / Fold-Change and gene.pValue for non-expression input", function () {
            const csv = buildDEGenesCsv({
                inputType: "ora",
                deGenesData: [{id: "1017", symbol: "CDK2", pValue: 5e-8, FC: 2.4}],
            });
            const lines = csv.split("\n");
            assert.strictEqual(lines[0], "Gene ID,Symbol,P-value,Fold-Change");
            assert.strictEqual(lines[1], "1017,CDK2,5e-8,2.4");
        });

        it("leaves the Symbol cell blank when the gene has no symbol", function () {
            const csv = buildDEGenesCsv({
                inputType: "expression",
                deGenesData: [{id: "99999", pValueFDR: 0.01, FC: 1.0}],
            });
            assert.strictEqual(csv.split("\n")[1], "99999,,0.01,1");
        });

        it("handles empty / missing data without throwing", function () {
            assert.strictEqual(buildDEGenesCsv({inputType: "expression"}), "Gene ID,Symbol,pValue.FDR,Log2FC");
            assert.strictEqual(
                buildDEGenesCsv({inputType: "expression", deGenesData: []}),
                "Gene ID,Symbol,pValue.FDR,Log2FC"
            );
        });
    });
});

describe("csvEscape", function () {
    it("passes plain values through unchanged", function () {
        assert.strictEqual(csvEscape("CDK2"), "CDK2");
        assert.strictEqual(csvEscape(1017), "1017");
    });

    it("quotes fields containing commas, quotes or newlines", function () {
        assert.strictEqual(csvEscape("cyclin, dependent"), '"cyclin, dependent"');
        assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
        assert.strictEqual(csvEscape("line1\nline2"), '"line1\nline2"');
    });

    it("renders null / undefined as an empty cell", function () {
        assert.strictEqual(csvEscape(null), "");
        assert.strictEqual(csvEscape(undefined), "");
    });
});

describe("buildTableCsv", function () {
    const columns = [
        {header: "Gene ID", field: "id"},
        {header: "Symbol", field: "symbol"},
        {header: "Log2FC", field: "FC", format: formatNumberForExport},
    ];

    it("maps fields to columns in order and applies the format fn", function () {
        const csv = buildTableCsv({
            rows: [{id: "1017", symbol: "CDK2", FC: 1e-9}],
            columns,
        });
        const lines = csv.split("\n");
        assert.strictEqual(lines[0], "Gene ID,Symbol,Log2FC");
        assert.strictEqual(lines[1], "1017,CDK2,1e-9");
    });

    it("escapes cell values that contain commas (e.g. descriptions)", function () {
        const csv = buildTableCsv({
            rows: [{id: "1", symbol: "A1BG", description: "alpha-1-B glycoprotein, extra"}],
            columns: [
                {header: "Gene ID", field: "id"},
                {header: "Symbol", field: "symbol"},
                {header: "Description", field: "description"},
            ],
        });
        assert.strictEqual(
            csv.split("\n")[1],
            '1,A1BG,"alpha-1-B glycoprotein, extra"'
        );
    });

    it("emits an empty cell for missing fields and handles empty rows", function () {
        assert.strictEqual(
            buildTableCsv({rows: [{id: "1"}], columns}),
            "Gene ID,Symbol,Log2FC\n1,,"
        );
        assert.strictEqual(buildTableCsv({rows: [], columns}), "Gene ID,Symbol,Log2FC");
    });
});

describe("mergeSymbolsIntoRows", function () {
    const geneInfoDocs = [
        {_id: "1017", symbol: "CDK2", description: "cyclin dependent kinase 2"},
        {_id: "1018", symbol: "CDK3", description: "cyclin dependent kinase 3"},
    ];

    it("fills the symbol (and description) for rows missing a symbol", function () {
        const rows = [{id: "1017"}, {id: "1018", description: "existing"}];
        const merged = mergeSymbolsIntoRows(rows, geneInfoDocs);
        assert.strictEqual(merged[0].symbol, "CDK2");
        assert.strictEqual(merged[0].description, "cyclin dependent kinase 2");
        // an existing description is not overwritten
        assert.strictEqual(merged[1].symbol, "CDK3");
        assert.strictEqual(merged[1].description, "existing");
    });

    it("leaves rows that already have a symbol untouched", function () {
        const rows = [{id: "1017", symbol: "KEEP"}];
        const merged = mergeSymbolsIntoRows(rows, geneInfoDocs);
        assert.strictEqual(merged[0].symbol, "KEEP");
    });

    it("respects custom idField / symbolField", function () {
        const rows = [{_id: "1017"}];
        const merged = mergeSymbolsIntoRows(rows, geneInfoDocs, {idField: "_id", symbolField: "name"});
        assert.strictEqual(merged[0].name, "CDK2");
    });

    it("returns rows unchanged when there is no matching gene info", function () {
        const rows = [{id: "unknown"}];
        const merged = mergeSymbolsIntoRows(rows, geneInfoDocs);
        assert.strictEqual(merged[0].symbol, undefined);
    });

    it("matches numeric row ids against string GeneInfo _id (meta-analysis case)", function () {
        // Meta-analysis rows arrive with a numeric id, while GeneInfo._id is a string.
        const rows = [{id: 1017}];
        const merged = mergeSymbolsIntoRows(rows, geneInfoDocs);
        assert.strictEqual(merged[0].symbol, "CDK2");
    });
});

describe("selectGenesForExport (flexible Volcano export: DE / Up / Down / All)", function () {
    // FC > 0 = upregulated, FC < 0 = downregulated. Significant requires
    // pValueFDR <= 0.05 AND |FC| >= 0.5 (the defaults used by the plot).
    const opts = {maxAdjustedPValue: 0.05, minLogFoldChange: 0.5};
    const genes = [
        {id: "UP_SIG", pValueFDR: 0.001, FC: 1.2},   // significant, up
        {id: "DOWN_SIG", pValueFDR: 0.01, FC: -0.9},  // significant, down
        {id: "UP_NS_P", pValueFDR: 0.5, FC: 2.0},     // not significant (p too high)
        {id: "DOWN_NS_FC", pValueFDR: 0.001, FC: -0.2}, // not significant (|FC| too small)
        {id: "EDGE", pValueFDR: 0.05, FC: 0.5},        // exactly on both thresholds -> significant, up
    ];

    it("'de' returns all significant genes (up ∪ down), sorted by pValueFDR ascending", function () {
        const result = selectGenesForExport(genes, {...opts, mode: "de"});
        assert.deepStrictEqual(result.map(g => g.id), ["UP_SIG", "DOWN_SIG", "EDGE"]);
    });

    it("'up' returns only significant upregulated genes", function () {
        const result = selectGenesForExport(genes, {...opts, mode: "up"});
        assert.deepStrictEqual(result.map(g => g.id), ["UP_SIG", "EDGE"]);
    });

    it("'down' returns only significant downregulated genes", function () {
        const result = selectGenesForExport(genes, {...opts, mode: "down"});
        assert.deepStrictEqual(result.map(g => g.id), ["DOWN_SIG"]);
    });

    it("'all' returns the full list (no filtering), still sorted by pValueFDR", function () {
        const result = selectGenesForExport(genes, {...opts, mode: "all"});
        assert.strictEqual(result.length, genes.length);
        // sorted ascending by pValueFDR
        const fdrs = result.map(g => g.pValueFDR);
        assert.deepStrictEqual(fdrs, [...fdrs].sort((a, b) => a - b));
    });

    it("defaults to 'de' when mode is omitted", function () {
        const result = selectGenesForExport(genes, opts);
        assert.deepStrictEqual(result.map(g => g.id), ["UP_SIG", "DOWN_SIG", "EDGE"]);
    });

    it("treats the threshold as inclusive (boundary equality is significant)", function () {
        // EDGE sits exactly at pValueFDR=0.05 and FC=0.5 and must be kept.
        const result = selectGenesForExport(genes, {...opts, mode: "up"});
        assert.ok(result.some(g => g.id === "EDGE"));
    });

    it("returns an empty array for empty / missing input", function () {
        assert.deepStrictEqual(selectGenesForExport([], {...opts, mode: "all"}), []);
        assert.deepStrictEqual(selectGenesForExport(undefined, {...opts, mode: "de"}), []);
    });

    it("works when thresholds arrive as strings (the real type from the antd Input fields)", function () {
        // config.maxAdjustedPValue / minLogFoldChange are stored as e.target.value
        // (strings). JS comparison/negation coerce them, so results must match the
        // numeric case exactly.
        const stringOpts = {maxAdjustedPValue: "0.05", minLogFoldChange: "0.5"};
        assert.deepStrictEqual(
            selectGenesForExport(genes, {...stringOpts, mode: "de"}).map(g => g.id),
            selectGenesForExport(genes, {...opts, mode: "de"}).map(g => g.id)
        );
        assert.deepStrictEqual(
            selectGenesForExport(genes, {...stringOpts, mode: "down"}).map(g => g.id),
            ["DOWN_SIG"]
        );
    });
});

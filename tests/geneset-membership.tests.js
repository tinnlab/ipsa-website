import assert from "assert";
import {
    buildDEGenesMap,
    buildSignificanceMap,
    buildGeneRows,
    filterGeneRows,
    joinGeneSymbols,
    buildPathwayGeneCsv,
    summarizeGeneRows,
} from "../imports/utils/geneSetMembership";

describe("geneSetMembership", function () {
    // A category's raw member gene ids (note the trailing duplicate of hsa:1).
    const memberIds = ["hsa:1", "hsa:2", "hsa:3", "hsa:4", "hsa:1"];

    // DE (significant) genes for the analysis, keyed by the SAME id as the member ids.
    const deGenes = [
        {_id: "hsa:1", symbol: "AAA", FC: 1.8, pValue: 0.001, pValueFDR: 0.01},
        {_id: "hsa:2", symbol: "BBB", FC: -2.0, pValue: 0.002, pValueFDR: 0.02},
    ];

    // Symbol lookup (visualization.getGeneInfo docs). hsa:2 is absent here (symbol should fall back
    // to the DE record), hsa:4 is absent everywhere (symbol should fall back to the raw id).
    const geneInfoDocs = [
        {_id: "hsa:1", symbol: "AAA", description: "gene a"},
        {_id: "hsa:3", symbol: "CCC"},
    ];

    const rowsOf = () => buildGeneRows(memberIds, geneInfoDocs, buildDEGenesMap(deGenes));

    describe("buildDEGenesMap", function () {
        it("keys DE genes by their id", function () {
            const map = buildDEGenesMap(deGenes);
            assert.strictEqual(map.size, 2);
            assert.strictEqual(map.get("hsa:1").symbol, "AAA");
        });
        it("ignores entries without an id and tolerates non-arrays", function () {
            const map = buildDEGenesMap([{symbol: "NOID"}, null, {_id: "hsa:9"}]);
            assert.strictEqual(map.size, 1);
            assert.ok(map.has("hsa:9"));
            assert.strictEqual(buildDEGenesMap(undefined).size, 0);
        });
    });

    describe("buildSignificanceMap", function () {
        it("for ORA, marks the mapped INPUT gene list as significant (no direction)", function () {
            const map = buildSignificanceMap({inputType: "ora", mappedInput: ["10", "20", "30"]});
            assert.strictEqual(map.size, 3);
            assert.deepStrictEqual(map.get("10"), {significant: true});
            // Feeding these to buildGeneRows: significant, but up/down false (no FC).
            const rows = buildGeneRows(["10", "40"], [], map);
            const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
            assert.deepStrictEqual(
                {sig: byId["10"].significant, up: byId["10"].up, down: byId["10"].down},
                {sig: true, up: false, down: false}
            );
            assert.strictEqual(byId["40"].significant, false); // not in the input list
        });
        it("stringifies ids and ignores null/undefined input entries", function () {
            const map = buildSignificanceMap({inputType: "ora", mappedInput: [10, null, undefined, 20]});
            assert.deepStrictEqual([...map.keys()], ["10", "20"]);
        });
        it("for non-ORA, delegates to buildDEGenesMap (keyed by _id, with FC)", function () {
            const map = buildSignificanceMap({inputType: "expression", deGenes});
            assert.strictEqual(map.size, 2);
            assert.strictEqual(map.get("hsa:1").FC, 1.8);
        });
        it("empty when neither list is provided", function () {
            assert.strictEqual(buildSignificanceMap({inputType: "ora"}).size, 0);
            assert.strictEqual(buildSignificanceMap({inputType: "expression"}).size, 0);
            assert.strictEqual(buildSignificanceMap().size, 0);
        });
    });

    describe("buildGeneRows", function () {
        it("de-duplicates member ids", function () {
            assert.strictEqual(rowsOf().length, 4); // hsa:1 appears twice, counted once
        });

        it("resolves symbols with GeneInfo → DE record → raw id fallback", function () {
            const byId = Object.fromEntries(rowsOf().map((r) => [r.id, r]));
            assert.strictEqual(byId["hsa:1"].symbol, "AAA"); // from GeneInfo
            assert.strictEqual(byId["hsa:2"].symbol, "BBB"); // GeneInfo missing → DE record
            assert.strictEqual(byId["hsa:3"].symbol, "CCC"); // from GeneInfo
            assert.strictEqual(byId["hsa:4"].symbol, "hsa:4"); // unresolved → raw id, never blank
        });

        it("flags significance and direction from the DE map + FC sign", function () {
            const byId = Object.fromEntries(rowsOf().map((r) => [r.id, r]));
            assert.deepStrictEqual(
                {sig: byId["hsa:1"].significant, up: byId["hsa:1"].up, down: byId["hsa:1"].down},
                {sig: true, up: true, down: false}
            );
            assert.deepStrictEqual(
                {sig: byId["hsa:2"].significant, up: byId["hsa:2"].up, down: byId["hsa:2"].down},
                {sig: true, up: false, down: true}
            );
            assert.deepStrictEqual(
                {sig: byId["hsa:3"].significant, up: byId["hsa:3"].up, down: byId["hsa:3"].down},
                {sig: false, up: false, down: false}
            );
        });

        it("treats a significant gene with FC exactly 0 as neither up nor down", function () {
            const rows = buildGeneRows(["hsa:z"], [], buildDEGenesMap([{_id: "hsa:z", symbol: "Z", FC: 0, pValueFDR: 0.01}]));
            assert.deepStrictEqual({up: rows[0].up, down: rows[0].down, sig: rows[0].significant}, {up: false, down: false, sig: true});
        });

        it("carries DE stats through, null for non-DE genes", function () {
            const byId = Object.fromEntries(rowsOf().map((r) => [r.id, r]));
            assert.strictEqual(byId["hsa:1"].FC, 1.8);
            assert.strictEqual(byId["hsa:1"].pValueFDR, 0.01);
            assert.strictEqual(byId["hsa:3"].FC, null);
            assert.strictEqual(byId["hsa:3"].pValueFDR, null);
        });
    });

    describe("filterGeneRows", function () {
        it("matches on symbol, case-insensitively", function () {
            const out = filterGeneRows(rowsOf(), "aa");
            assert.deepStrictEqual(out.map((r) => r.id), ["hsa:1"]);
        });
        it("also matches on the raw id", function () {
            const out = filterGeneRows(rowsOf(), "hsa:4");
            assert.deepStrictEqual(out.map((r) => r.symbol), ["hsa:4"]);
        });
        it("returns all rows for a blank query", function () {
            assert.strictEqual(filterGeneRows(rowsOf(), "  ").length, 4);
            assert.strictEqual(filterGeneRows(rowsOf(), "").length, 4);
        });
    });

    describe("joinGeneSymbols", function () {
        it("joins the right subset per mode", function () {
            const rows = rowsOf();
            assert.strictEqual(joinGeneSymbols(rows, "all"), "AAA;BBB;CCC;hsa:4");
            assert.strictEqual(joinGeneSymbols(rows, "de"), "AAA;BBB");
            assert.strictEqual(joinGeneSymbols(rows, "up"), "AAA");
            assert.strictEqual(joinGeneSymbols(rows, "down"), "BBB");
        });
        it("defaults unknown modes to all and tolerates empties", function () {
            assert.strictEqual(joinGeneSymbols(rowsOf(), "wat"), "AAA;BBB;CCC;hsa:4");
            assert.strictEqual(joinGeneSymbols([], "de"), "");
        });
    });

    describe("buildPathwayGeneCsv", function () {
        it("emits the fixed header with x-marked Significant/Up/Down columns", function () {
            const lines = buildPathwayGeneCsv(rowsOf()).split("\n");
            assert.strictEqual(lines[0], "Symbol,Gene ID,Log2FC,pValue,pValue.FDR,Significant,Up,Down");
            // hsa:1 is a significant up gene with full stats.
            assert.strictEqual(lines[1], "AAA,hsa:1,1.8,0.001,0.01,x,x,");
            // hsa:2 is a significant down gene.
            assert.strictEqual(lines[2], "BBB,hsa:2,-2,0.002,0.02,x,,x");
            // hsa:3 is a non-DE member: numeric + marker cells are blank, not NaN/"false".
            assert.strictEqual(lines[3], "CCC,hsa:3,,,,,,");
        });
        it("RFC-4180 escapes a symbol containing a comma", function () {
            const rows = buildGeneRows(["hsa:1"], [{_id: "hsa:1", symbol: "X,Y"}], new Map());
            assert.strictEqual(buildPathwayGeneCsv(rows).split("\n")[1], '"X,Y",hsa:1,,,,,,');
        });
        it("returns just the header for an empty list", function () {
            assert.strictEqual(buildPathwayGeneCsv([]).split("\n").length, 1);
        });
    });

    describe("summarizeGeneRows", function () {
        it("counts total / significant / up / down", function () {
            assert.deepStrictEqual(summarizeGeneRows(rowsOf()), {total: 4, significant: 2, up: 1, down: 1});
        });
    });
});

import assert from "assert";
import { buildPathwayResultCsv } from "../imports/utils/pathwayResultCsv";

describe("buildPathwayResultCsv", function () {
    const analyses = [
        { key: "OSD-A_ora", label: "OSD-A" },
        { key: "meta-1_meta", label: "Meta-1" },
    ];
    const pathways = [
        {
            id: "hsa00010", name: "Glycolysis",
            values: {
                "OSD-A_ora": { pValue: 0.001, pValueFDR: 0.01, score: 1.5 },
                "meta-1_meta": { pValue: 0.0001, pValueFDR: 0.002, score: -2.3 },
            },
        },
        {
            id: "hsa00020", name: "TCA cycle",
            values: { "OSD-A_ora": { pValue: 0.2, pValueFDR: 0.3, score: 0.4 } }, // missing meta column
        },
    ];

    it("emits a header of Pathway ID, Name, then p-value/FDR/Score per analysis in order", function () {
        const csv = buildPathwayResultCsv(pathways, analyses);
        const header = csv.split("\n")[0];
        assert.strictEqual(
            header,
            "Pathway ID,Name,OSD-A p-value,OSD-A FDR,OSD-A Score,Meta-1 p-value,Meta-1 FDR,Meta-1 Score"
        );
    });

    it("writes one row per pathway with faithful numeric values", function () {
        const rows = buildPathwayResultCsv(pathways, analyses).split("\n");
        assert.strictEqual(rows.length, 3); // header + 2 pathways
        assert.strictEqual(rows[1], "hsa00010,Glycolysis,0.001,0.01,1.5,0.0001,0.002,-2.3");
    });

    it("leaves cells blank where an analysis has no data for a pathway", function () {
        const rows = buildPathwayResultCsv(pathways, analyses).split("\n");
        // hsa00020 has no meta-1 column -> its three meta cells are empty
        assert.strictEqual(rows[2], "hsa00020,TCA cycle,0.2,0.3,0.4,,,");
    });

    it("RFC-4180 escapes commas and quotes in names", function () {
        const csv = buildPathwayResultCsv(
            [{ id: "p1", name: 'Metabolism, "core"', values: {} }],
            []
        );
        // "p1" needs no escaping; only the name (comma + quotes) is quoted/escaped.
        assert.strictEqual(csv.split("\n")[1], 'p1,"Metabolism, ""core"""');
    });

    it("treats non-finite / missing numbers as blank, not NaN", function () {
        const csv = buildPathwayResultCsv(
            [{ id: "p1", name: "P1", values: { a: { pValue: null, pValueFDR: undefined, score: NaN } } }],
            [{ key: "a", label: "A" }]
        );
        assert.strictEqual(csv.split("\n")[1], "p1,P1,,,");
    });

    it("returns just the header for an empty pathway list", function () {
        const csv = buildPathwayResultCsv([], analyses);
        assert.strictEqual(csv.split("\n").length, 1);
    });

    it("skips null/undefined entries instead of emitting blank rows", function () {
        const csv = buildPathwayResultCsv(
            [null, { id: "p1", name: "P1", values: {} }, undefined],
            []
        );
        assert.strictEqual(csv.split("\n").length, 2); // header + the one real pathway
    });
});

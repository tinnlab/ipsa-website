// Unit tests for the consensus R-input field mapping (Bug 2A).
// Pure helper — verifies the genuine per-method FDR (not the raw p-value) flows
// into the `pFDR` column RRA ranks by, and that scores are preserved.
import assert from "assert";
import { buildConsensusMethodColumns } from "../server/api/methods/consensusInput";

describe("consensus input mapping (Bug 2A)", function () {
    const pathways = [
        { pathway: "hsa04010", pValue: 1e-6, pValueFDR: 3e-5, score: 2.1, name: "MAPK signaling" },
        { pathway: "hsa04014", pValue: 0.002, pValueFDR: 0.03, score: -1.4, name: "Ras signaling" },
        { pathway: "hsa04020", pValue: 0.5, pValueFDR: 0.8, score: 0, name: "Calcium signaling" },
    ];

    it("feeds the RAW p-value into pValue and the GENUINE FDR into pFDR (separately)", function () {
        const cols = buildConsensusMethodColumns(pathways);
        assert.deepStrictEqual(cols.pValue, [1e-6, 0.002, 0.5]);
        assert.deepStrictEqual(cols.pFDR, [3e-5, 0.03, 0.8]);
        // Regression: pFDR must NOT be a copy of the raw p-value.
        assert.notDeepStrictEqual(cols.pFDR, cols.pValue);
    });

    it("preserves real scores, including a legitimate 0 (not collapsed away)", function () {
        const cols = buildConsensusMethodColumns(pathways);
        assert.deepStrictEqual(cols.score, [2.1, -1.4, 0]);
    });

    it("defaults only absent scores to 0 (distinguishes absent from 0)", function () {
        const cols = buildConsensusMethodColumns([
            { pathway: "p1", pValue: 0.01, pValueFDR: 0.1, name: "n1" }, // score undefined
            { pathway: "p2", pValue: 0.01, pValueFDR: 0.1, score: 0, name: "n2" },
        ]);
        assert.deepStrictEqual(cols.score, [0, 0]);
    });

    it("defaults non-finite pValue/pFDR (undefined, null, NaN) to 1 so they never reach R as NA/NaN; preserves a finite 0", function () {
        const cols = buildConsensusMethodColumns([
            { pathway: "p1", name: "n1" },                              // pValue + pFDR undefined
            { pathway: "p2", pValue: 0, pValueFDR: 0, name: "n2" },     // legitimate 0 preserved
            { pathway: "p3", pValue: NaN, pValueFDR: null, name: "n3" }, // NaN / null coerced to 1
        ]);
        assert.deepStrictEqual(cols.pValue, [1, 0, 1]);
        assert.deepStrictEqual(cols.pFDR, [1, 0, 1]);
    });

    it("keeps ids and names aligned with the rows", function () {
        const cols = buildConsensusMethodColumns(pathways);
        assert.deepStrictEqual(cols.id, ["hsa04010", "hsa04014", "hsa04020"]);
        assert.deepStrictEqual(cols.name, ["MAPK signaling", "Ras signaling", "Calcium signaling"]);
    });

    it("handles empty input without throwing", function () {
        assert.deepStrictEqual(buildConsensusMethodColumns([]), {
            id: [], pValue: [], pFDR: [], score: [], name: [],
        });
        assert.deepStrictEqual(buildConsensusMethodColumns().id, []);
    });
});

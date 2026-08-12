import assert from "assert";
import { getVolcanoOptions } from "../imports/utils/volcanoPlotOptions";

describe("getVolcanoOptions (volcano plot ECharts builder)", function () {
    const thresholds = { maxAdjustedPValue: 0.05, minLogFoldChange: 1.0 };
    const data = [
        { name: "UP", FC: 2.0, pValue: 0.01 },    // significant up-regulated
        { name: "DOWN", FC: -1.5, pValue: 0.02 }, // significant down-regulated
        { name: "NS_P", FC: 3.0, pValue: 0.5 },   // fails p-value -> non-significant
        { name: "NS_FC", FC: 0.2, pValue: 0.001 } // fails fold-change -> non-significant
    ];

    it("returns an empty object when there is no data", function () {
        assert.deepStrictEqual(getVolcanoOptions(null, thresholds), {});
        assert.deepStrictEqual(getVolcanoOptions(undefined, thresholds), {});
    });

    it("builds a scatterGL series with correct axis labels", function () {
        const options = getVolcanoOptions(data, thresholds);
        assert.strictEqual(options.xAxis.name, "Log2FC");
        assert.strictEqual(options.yAxis.name, "-log10(pValue.FDR)");
        assert.strictEqual(options.series.length, 1);
        assert.strictEqual(options.series[0].type, "scatterGL");
    });

    it("handles an empty data array (series with no points)", function () {
        const options = getVolcanoOptions([], thresholds);
        assert.ok(Array.isArray(options.series[0].data));
        assert.strictEqual(options.series[0].data.length, 0);
    });

    it("classifies up / down / non-significant genes by threshold", function () {
        const points = getVolcanoOptions(data, thresholds).series[0].data;
        // value tuple: [FC, -log10(p), tooltip, category, categoryIndex]
        const categories = points.map(p => p.value[3]);
        assert.deepStrictEqual(categories, [
            "Up-regulated",
            "Down-regulated",
            "Non-significant",
            "Non-significant"
        ]);
        const indices = points.map(p => p.value[4]);
        assert.deepStrictEqual(indices, [0, 1, 2, 2]);
    });

    it("plots the x value as the fold change and y as -log10(FDR)", function () {
        const points = getVolcanoOptions(data, thresholds).series[0].data;
        assert.strictEqual(points[0].value[0], 2.0);          // FC on x
        assert.ok(Math.abs(points[0].value[1] - 2) < 1e-9);   // -log10(0.01) === 2
    });

    it("clamps extremely small p-values to avoid Infinity on the y axis", function () {
        const points = getVolcanoOptions([{ name: "TINY", FC: 5, pValue: 1e-30 }], thresholds).series[0].data;
        // -log10(1e-16) === 16 (the clamp), not -log10(1e-30) === 30
        assert.ok(Math.abs(points[0].value[1] - 16) < 1e-9);
    });
});

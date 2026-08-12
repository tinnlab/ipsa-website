import assert from "assert";
import {getGeneVolcanoOptions, displayNameOf} from "../imports/utils/geneVolcanoOptions";

const thresholds = {maxAdjustedPValue: 0.05, minLogFoldChange: 1.0};

const data = [
    {id: "7157", name: "TP53", FC: 2.0, pValue: 0.001},   // up
    {id: "4609", name: "MYC", FC: -1.8, pValue: 0.01},    // down
    {id: "999", name: "NSP", FC: 3.0, pValue: 0.5},       // non-sig
];

describe("displayNameOf", function () {
    it("returns the symbol in symbol mode (falling back to id)", function () {
        assert.strictEqual(displayNameOf({id: "7157", name: "TP53"}, "symbol"), "TP53");
        assert.strictEqual(displayNameOf({id: "7157", name: null}, "symbol"), "7157");
    });
    it("returns the raw id in id mode", function () {
        assert.strictEqual(displayNameOf({id: "7157", name: "TP53"}, "id"), "7157");
        assert.strictEqual(displayNameOf({id: 7157, name: "TP53"}, "id"), "7157");
    });
});

describe("getGeneVolcanoOptions", function () {
    it("returns {} when there is no data", function () {
        assert.deepStrictEqual(getGeneVolcanoOptions(null, thresholds), {});
        assert.deepStrictEqual(getGeneVolcanoOptions(undefined, thresholds), {});
    });

    it("always emits the same component set (2 series + visualMap) for merge safety", function () {
        const none = getGeneVolcanoOptions(data, thresholds, [], []);
        const some = getGeneVolcanoOptions(data, thresholds, ["7157"], []);
        for (const o of [none, some]) {
            assert.strictEqual(o.series.length, 2);
            assert.strictEqual(o.series[0].type, "scatterGL");
            assert.strictEqual(o.series[1].type, "scatter");
            assert.ok(o.visualMap, "visualMap present in both modes");
        }
    });

    describe("no focus (original behaviour)", function () {
        const opt = getGeneVolcanoOptions(data, thresholds, [], []);

        it("renders the full gene list on the base scatterGL series, overlay empty", function () {
            assert.strictEqual(opt.series[0].data.length, data.length);
            assert.strictEqual(opt.series[1].data.length, 0);
        });

        it("keeps the base cloud off the axis layer (zlevel 1, not 0)", function () {
            assert.strictEqual(opt.series[0].zlevel, 1);
        });

        it("preserves the base scatterGL config (faithful to the original plot)", function () {
            const s = opt.series[0];
            assert.strictEqual(s.symbolSize, 12);
            assert.strictEqual(s.silent, true);
            assert.strictEqual(s.animation, false);
            assert.strictEqual(s.sampling, "average");
            assert.strictEqual(s.showSymbol, false);
            assert.strictEqual(s.large, false);
            assert.strictEqual(s.postEffect.enable, false);
        });

        it("shows the piecewise visualMap legend, scoped to the base series", function () {
            assert.strictEqual(opt.visualMap.type, "piecewise");
            assert.strictEqual(opt.visualMap.show, true);
            assert.strictEqual(opt.visualMap.seriesIndex, 0);
            assert.deepStrictEqual(opt.visualMap.pieces.map(p => p.color), ["#FF0000", "#1312FF", "#AAAAAA"]);
        });

        it("classifies points by category index in dimension 4", function () {
            assert.deepStrictEqual(opt.series[0].data.map(p => p.value[4]), [0, 1, 2]);
        });

        it("builds the exact value tuple and tooltip string for a known gene (symbol default)", function () {
            const v = opt.series[0].data[0].value; // TP53
            assert.strictEqual(v[0], 2.0);
            assert.ok(Math.abs(v[1] - 3) < 1e-9);   // -log10(0.001) === 3
            // p-value rendered in scientific notation, not rounded to 0.00
            assert.strictEqual(v[2], "Gene name: TP53<br>pValue.FDR: 1.00E-3<br>Log2FC: 2.00");
            assert.strictEqual(v[3], "Up-regulated");
            assert.strictEqual(v[4], 0);
        });

        it("renders tiny p-values in scientific notation instead of 0.00", function () {
            const v = getGeneVolcanoOptions([{id: "x", name: "X", FC: 1, pValue: 3.2e-40}], thresholds, [], []).series[0].data[0].value;
            assert.ok(v[2].includes("pValue.FDR: 3.20E-40"), v[2]);
        });

        it("carries the shared axes / tooltip / dataZoom / grid", function () {
            assert.strictEqual(opt.xAxis.name, "Log2FC");
            assert.strictEqual(opt.yAxis.name, "-log10(pValue.FDR)");
            assert.ok(opt.tooltip && typeof opt.tooltip.formatter === "function");
            assert.ok(Array.isArray(opt.dataZoom) && opt.dataZoom.length === 2);
            assert.ok(opt.grid);
        });

        it("treats an undefined focus the same as empty", function () {
            const undef = getGeneVolcanoOptions(data, thresholds);
            assert.strictEqual(undef.series[1].data.length, 0);
            assert.strictEqual(undef.visualMap.show, true);
        });

        it("clamps tiny p-values to avoid Infinity on the y axis", function () {
            const pts = getGeneVolcanoOptions([{id: "t", name: "T", FC: 5, pValue: 1e-30}], thresholds, [], []).series[0].data;
            assert.ok(Math.abs(pts[0].value[1] - 16) < 1e-9);
        });
    });

    describe("with focus (isolate mode)", function () {
        const opt = getGeneVolcanoOptions(data, thresholds, ["7157", "999"], []);

        it("dims the base layer via opacity and greys it through the visualMap", function () {
            assert.ok(opt.series[0].itemStyle.opacity < 1);
            assert.strictEqual(opt.series[0].symbolSize, 8);
            assert.strictEqual(opt.visualMap.show, false);
            assert.deepStrictEqual(opt.visualMap.pieces.map(p => p.color), ["#DDDDDD", "#DDDDDD", "#DDDDDD"]);
            assert.strictEqual(opt.visualMap.seriesIndex, 0);
        });

        it("draws the overlay above the WebGL layer (higher zlevel)", function () {
            assert.ok(opt.series[1].zlevel > opt.series[0].zlevel);
        });

        it("overlays exactly the focused genes (highlight markers)", function () {
            const names = opt.series[1].data.map(d => d.name).sort();
            assert.deepStrictEqual(names, ["NSP", "TP53"]);
        });

        it("colours up red, down blue, and a focused non-sig gene a visible dark grey", function () {
            const o1 = getGeneVolcanoOptions(data, thresholds, ["7157", "4609", "999"], []);
            const byName = Object.fromEntries(o1.series[1].data.map(d => [d.name, d.itemStyle.color]));
            assert.strictEqual(byName["TP53"], "#FF0000");
            assert.strictEqual(byName["MYC"], "#1312FF");
            assert.strictEqual(byName["NSP"], "#555555");
        });

        it("styles overlay markers with a white ring and larger symbol", function () {
            const d0 = opt.series[1].data[0];
            assert.strictEqual(d0.itemStyle.borderColor, "#FFFFFF");
            assert.strictEqual(d0.itemStyle.borderWidth, 1.5);
            assert.strictEqual(opt.series[1].symbolSize, 14);
        });

        it("silently drops a focused id that is not present in the data", function () {
            const o = getGeneVolcanoOptions(data, thresholds, ["7157", "doesNotExist"], []);
            assert.strictEqual(o.series[1].data.length, 1);
            assert.strictEqual(o.series[1].data[0].name, "TP53");
        });

        it("accepts Sets of ids as well as arrays", function () {
            const viaSet = getGeneVolcanoOptions(data, thresholds, new Set(["7157"]), new Set(["7157"]));
            assert.strictEqual(viaSet.series[1].data.length, 1);
            assert.strictEqual(viaSet.series[1].data[0].name, "TP53");
        });
    });

    describe("labels are an independent subset of focus", function () {
        it("labels only the genes in the label set, highlights all focused", function () {
            // focus 3, label 1
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157", "4609", "999"], ["7157"]);
            assert.strictEqual(opt.series[1].data.length, 3); // all focused highlighted
            const labeled = opt.series[1].data.filter(d => d.label.show);
            assert.strictEqual(labeled.length, 1);
            assert.strictEqual(labeled[0].name, "TP53");
        });

        it("suppresses the leader line for unlabeled focused points", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157", "4609"], ["7157"]);
            const unlabeled = opt.series[1].data.find(d => !d.label.show);
            assert.strictEqual(unlabeled.name, "MYC");
            assert.strictEqual(unlabeled.labelLine.show, false);
        });

        it("does not label a gene that is in the label set but not focused", function () {
            // "4609" is labeled but NOT focused -> it isn't in the overlay at all
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157"], ["7157", "4609"]);
            assert.strictEqual(opt.series[1].data.length, 1);
            assert.strictEqual(opt.series[1].data[0].name, "TP53");
            assert.strictEqual(opt.series[1].data[0].label.show, true);
        });
    });

    describe("hide non-focused genes + rescale", function () {
        it("empties the base cloud when isolating with hideNonFocused, keeping the series", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157"], [], "symbol", true);
            assert.strictEqual(opt.series.length, 2, "series set unchanged for merge safety");
            assert.strictEqual(opt.series[0].type, "scatterGL");
            assert.strictEqual(opt.series[0].data.length, 0, "base cloud emptied");
            // focus overlay still carries the focused gene, so the axes rescale to it
            assert.strictEqual(opt.series[1].data.length, 1);
            assert.strictEqual(opt.series[1].data[0].name, "TP53");
        });

        it("ignores hideNonFocused when nothing is focused (full cloud stays)", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, [], [], "symbol", true);
            assert.strictEqual(opt.series[0].data.length, data.length);
        });

        it("keeps the full cloud when hideNonFocused is off while isolating", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157"], [], "symbol", false);
            assert.strictEqual(opt.series[0].data.length, data.length);
        });
    });

    describe("labeled genes get a highlighted border", function () {
        it("gives labeled dots a dark thicker outline and leaves others white", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157", "4609"], ["7157"]);
            const byName = Object.fromEntries(opt.series[1].data.map(d => [d.name, d.itemStyle]));
            assert.strictEqual(byName["TP53"].borderColor, "#111111");
            assert.strictEqual(byName["TP53"].borderWidth, 2.5);
            assert.strictEqual(byName["MYC"].borderColor, "#FFFFFF");
            assert.strictEqual(byName["MYC"].borderWidth, 1.5);
        });
    });

    describe("display mode", function () {
        it("renders symbols by default, and the tooltip reads 'Gene name:'", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157"], ["7157"], "symbol");
            assert.strictEqual(opt.series[1].data[0].name, "TP53");
            assert.ok(opt.series[1].data[0].value[2].startsWith("Gene name: TP53"));
        });

        it("renders raw ids in id mode, and the tooltip reads 'Gene ID:'", function () {
            const opt = getGeneVolcanoOptions(data, thresholds, ["7157"], ["7157"], "id");
            assert.strictEqual(opt.series[1].data[0].name, "7157");
            assert.ok(opt.series[1].data[0].value[2].startsWith("Gene ID: 7157"));
            // base tooltip too
            assert.ok(opt.series[0].data[0].value[2].startsWith("Gene ID: 7157"));
        });
    });
});

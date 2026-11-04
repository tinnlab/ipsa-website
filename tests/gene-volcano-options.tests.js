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

    it("always emits the same component set (2 series + visualMap + graphic) for merge safety", function () {
        const none = getGeneVolcanoOptions(data, thresholds, [], []);
        const some = getGeneVolcanoOptions(data, thresholds, ["7157"], []);
        for (const o of [none, some]) {
            assert.strictEqual(o.series.length, 2);
            assert.strictEqual(o.series[0].type, "scatterGL");
            assert.strictEqual(o.series[1].type, "scatter");
            assert.ok(o.visualMap, "visualMap present in both modes");
            // The overflow note is emitted even with nothing to report: dropping it in
            // one branch would let merge setOption leave a stale note on screen.
            assert.strictEqual(o.graphic.elements.length, 1);
            assert.strictEqual(o.graphic.elements[0].id, "geneVolcanoLabelOverflowNote");
            assert.strictEqual(o.graphic.elements[0].style.text, "");
            assert.strictEqual(typeof o.series[1].labelLayout, "function");
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

        it("keeps the cloud's category colours and its legend by default", function () {
            // Focusing genes must not cost the reader the up/down reading of the whole
            // experiment: the focused genes are already set apart by border, size and
            // label, so the grey wash is redundant emphasis.
            assert.strictEqual(opt.series[0].itemStyle.opacity, 1);
            assert.strictEqual(opt.series[0].symbolSize, 12);
            assert.strictEqual(opt.visualMap.show, true);
            assert.deepStrictEqual(
                opt.visualMap.pieces.map(p => p.color), ["#FF0000", "#1312FF", "#AAAAAA"],
            );
            assert.strictEqual(opt.visualMap.seriesIndex, 0);
        });

        it("draws the overlay above the WebGL layer (higher zlevel)", function () {
            assert.ok(opt.series[1].zlevel > opt.series[0].zlevel);
        });

        it("overlays exactly the focused genes (highlight markers)", function () {
            const names = opt.series[1].data.map(d => d.name).sort();
            assert.deepStrictEqual(names, ["NSP", "TP53"]);
        });

        it("colours the overlay by category, matching the cloud underneath it", function () {
            const o1 = getGeneVolcanoOptions(data, thresholds, ["7157", "4609", "999"], []);
            const byName = Object.fromEntries(o1.series[1].data.map(d => [d.name, d.itemStyle.color]));
            assert.strictEqual(byName["TP53"], "#FF0000");
            assert.strictEqual(byName["MYC"], "#1312FF");
            // Against a full-colour cloud a darker grey would read as a fourth category.
            assert.strictEqual(byName["NSP"], "#AAAAAA");
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

    describe("dim non-focused genes (opt-in)", function () {
        const dimmed = getGeneVolcanoOptions(data, thresholds, ["7157", "999"], [], "symbol", false, true);

        it("greys the cloud and hides the legend when switched on", function () {
            assert.ok(dimmed.series[0].itemStyle.opacity < 1);
            assert.strictEqual(dimmed.series[0].symbolSize, 8);
            assert.strictEqual(dimmed.visualMap.show, false);
            assert.deepStrictEqual(
                dimmed.visualMap.pieces.map(p => p.color), ["#DDDDDD", "#DDDDDD", "#DDDDDD"],
            );
        });

        it("darkens a focused non-significant gene so it reads against the grey", function () {
            const o = getGeneVolcanoOptions(data, thresholds, ["999"], [], "symbol", false, true);
            assert.strictEqual(o.series[1].data[0].itemStyle.color, "#555555");
        });

        it("keeps the full gene list on the cloud — dimming is not hiding", function () {
            assert.strictEqual(dimmed.series[0].data.length, data.length);
        });

        it("does nothing when no gene is focused, however the flag is set", function () {
            // There is no "non-focused" cloud to play down when nothing is focused, so
            // the flag alone must never grey the default view.
            const noFocus = getGeneVolcanoOptions(data, thresholds, [], [], "symbol", false, true);
            assert.strictEqual(noFocus.series[0].itemStyle.opacity, 1);
            assert.strictEqual(noFocus.series[0].symbolSize, 12);
            assert.strictEqual(noFocus.visualMap.show, true);
        });

        it("still emits the same component set, dimmed or not (merge safety)", function () {
            const plain = getGeneVolcanoOptions(data, thresholds, ["7157"], []);
            for (const o of [plain, dimmed]) {
                assert.strictEqual(o.series.length, 2);
                assert.ok(o.visualMap);
                assert.strictEqual(o.graphic.elements.length, 1);
            }
            // The visualMap is swapped in place, never dropped — otherwise ECharts'
            // merge setOption would leave the grey pieces recolouring a live cloud.
            // Same shape, different contents, and toggling back restores the colours.
            assert.strictEqual(plain.visualMap.pieces.length, dimmed.visualMap.pieces.length);
            assert.notDeepStrictEqual(
                plain.visualMap.pieces.map(p => p.color), dimmed.visualMap.pieces.map(p => p.color),
            );
            const back = getGeneVolcanoOptions(data, thresholds, ["7157", "999"], [], "symbol", false, false);
            assert.deepStrictEqual(back.visualMap.pieces, plain.visualMap.pieces);
        });

        it("goes inert once the cloud is hidden, whichever box was ticked first", function () {
            // Dimming a cloud that is not drawn would still hide the legend and darken
            // focused non-significant dots, and the picker disables the dim box while
            // hiding is on — so the user could not tick their way back out of it.
            const hideOnly = getGeneVolcanoOptions(data, thresholds, ["7157", "999"], [], "symbol", true, false);
            const hideAndDim = getGeneVolcanoOptions(data, thresholds, ["7157", "999"], [], "symbol", true, true);

            assert.strictEqual(hideAndDim.visualMap.show, true, "the legend must survive");
            assert.deepStrictEqual(
                hideAndDim.visualMap.pieces.map(p => p.color), ["#FF0000", "#1312FF", "#AAAAAA"],
            );
            const nonSig = hideAndDim.series[1].data.find(d => d.name === "NSP");
            assert.strictEqual(nonSig.itemStyle.color, "#AAAAAA");
            // Order of ticking must not change the result. Compared field by field
            // rather than deep-equal: the option carries fresh closures (labelLayout,
            // formatters) whose identity differs on every build.
            const mode = (o) => ({
                pieces: o.visualMap.pieces,
                legend: o.visualMap.show,
                opacity: o.series[0].itemStyle.opacity,
                symbolSize: o.series[0].symbolSize,
                cloudPoints: o.series[0].data.length,
                overlayColours: o.series[1].data.map(d => d.itemStyle.color),
            });
            assert.deepStrictEqual(mode(hideAndDim), mode(hideOnly));
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

    describe("staircase label placement", function () {
        // The user's reported case: 25 genes stranded on the 1e-16 clamp line, sharing
        // one y and differing only in fold change. The FC span is the real one measured
        // in the shipped data (analysis NYu3EApEc28QnxwAj: 276 genes at pValueFDR === 0,
        // log2FC from -2.38 to 2.28). This is what plain `moveOverlap:'shiftY'` smeared.
        const COUNT = 25;
        const clamped = Array.from({length: COUNT}, (_, i) => ({
            id: `g${i}`,
            name: `GENE${i}`,
            FC: -2.38 + (4.66 * i) / (COUNT - 1),
            pValue: 0,
        }));
        const ids = clamped.map((g) => g.id);
        const opt = getGeneVolcanoOptions(clamped, thresholds, ids, ids);
        // ECharts hands the callback the label's own dot rect in canvas pixels.
        const layoutAt = (dataIndex, rect = {x: 100, y: 50, width: 14, height: 14}) =>
            opt.series[1].labelLayout({dataIndex, rect, labelRect: {width: 40, height: 14}});

        it("positions labels through a labelLayout callback, not a static option", function () {
            assert.strictEqual(typeof opt.series[1].labelLayout, "function");
        });

        it("draws no two clamp-line names on top of each other", function () {
            // The property that actually matters, checked end to end: place each dot
            // where an 800px-wide chart would put it, ask the callback where its name
            // goes, and assert no two of the resulting text boxes intersect. Labels
            // MAY share a row — that is the packing working — but only when they are
            // far enough apart horizontally.
            const GRID_LEFT = 50;
            const PLOT_W = 700;      // 800 canvas - grid.left - grid.right
            const FONT = 12;
            const CHAR_RATIO = 0.68;
            const fcs = clamped.map((g) => g.FC);
            const lo = Math.min(...fcs);
            const hi = Math.max(...fcs);
            const pxOf = (fc) => GRID_LEFT + ((fc - lo) / (hi - lo)) * PLOT_W;

            const boxes = clamped.map((gene, i) => {
                const cx = pxOf(gene.FC);
                const out = layoutAt(i, {x: cx - 7, y: 300, width: 14, height: 14});
                const half = (gene.name.length * FONT * CHAR_RATIO) / 2;
                return {name: gene.name, left: out.x - half, right: out.x + half, y: out.y};
            });

            for (let i = 0; i < boxes.length; i += 1) {
                for (let j = i + 1; j < boxes.length; j += 1) {
                    const a = boxes[i];
                    const b = boxes[j];
                    const sameRow = Math.abs(a.y - b.y) < FONT;
                    const overlapX = a.left < b.right && b.left < a.right;
                    assert.ok(
                        !(sameRow && overlapX),
                        `${a.name} and ${b.name} overprint: rows ${a.y}/${b.y}, `
                        + `spans ${a.left.toFixed(0)}-${a.right.toFixed(0)} and ${b.left.toFixed(0)}-${b.right.toFixed(0)}`,
                    );
                }
            }
        });

        it("ladders into several rows, because 25 names cannot fit on one", function () {
            const rows = new Set(clamped.map((_, i) => layoutAt(i).y));
            assert.ok(rows.size > 1, "expected a staircase, got a single row");
            // ...but still packs, rather than giving each name a step of its own.
            assert.ok(rows.size < COUNT, `expected fewer rows than labels, got ${rows.size}`);
        });

        it("anchors the label horizontally on its own dot", function () {
            const out = layoutAt(0);
            assert.strictEqual(out.x, 107); // rect.x + width/2
            assert.strictEqual(out.align, "center");
            assert.strictEqual(out.verticalAlign, "middle");
        });

        it("stacks mostly downward from the clamp line, which has little headroom", function () {
            const below = clamped.filter((_, i) => layoutAt(i).y > 57).length;
            assert.ok(below > clamped.length / 2, `only ${below} of ${clamped.length} went below the dot`);
        });

        it("does NOT ask ECharts to shift labels as well", function () {
            // shiftY sorts every label by y and cascades each below the previous, blind
            // to the horizontal separation the staircase relies on. Left on, it turns a
            // 9-row staircase into a 25-step cascade that runs off the bottom.
            assert.strictEqual(layoutAt(0).moveOverlap, undefined);
            assert.strictEqual(layoutAt(0).hideOverlap, undefined);
        });

        it("leaves a point with no slot entirely alone", function () {
            // dataIndex past the end of the label set — e.g. a focused-but-unlabelled dot.
            assert.deepStrictEqual(
                opt.series[1].labelLayout({dataIndex: 999, rect: {x: 0, y: 0, width: 1, height: 1}}),
                {},
            );
        });

        it("gives label text a white halo so it stays readable over the point cloud", function () {
            assert.strictEqual(opt.series[1].label.textBorderColor, "#FFFFFF");
            assert.strictEqual(opt.series[1].label.textBorderWidth, 3);
        });
    });

    describe("too many labels to draw", function () {
        // 60 genes at one x AND one y: nothing can share a row, so the staircase is
        // forced past the cap. Reachable in the UI via the picker's "Paste list".
        const piled = Array.from({length: 60}, (_, i) => ({
            id: `p${i}`, name: `GENE${i}`, FC: 2.0, pValue: 0,
        }));
        const ids = piled.map((g) => g.id);
        const opt = getGeneVolcanoOptions(piled, thresholds, ids, ids);
        const drawn = opt.series[1].data.filter((d) => d.label.show);

        it("draws only what can be read", function () {
            assert.ok(drawn.length < piled.length, "expected some labels to be dropped");
            assert.ok(drawn.length > 0, "expected some labels to survive");
        });

        it("reports the shortfall in the figure itself, so an export is honest", function () {
            const hidden = piled.length - drawn.length;
            assert.strictEqual(
                opt.graphic.elements[0].style.text,
                `${hidden} more labels not shown`,
            );
        });

        it("keeps the dark outline on dots whose name was dropped", function () {
            // The user picked them; the dot must still read as one of their picks.
            const dropped = opt.series[1].data.filter((d) => !d.label.show);
            assert.ok(dropped.length > 0);
            dropped.forEach((d) => assert.strictEqual(d.itemStyle.borderColor, "#111111"));
        });

        it("suppresses the leader line for a dropped label", function () {
            opt.series[1].data.filter((d) => !d.label.show)
                .forEach((d) => assert.strictEqual(d.labelLine.show, false));
        });

        it("says 'label' rather than 'labels' when exactly one is dropped", function () {
            // Grow a pile of coincident genes one at a time until the chart is exactly
            // one label short of holding them all, whatever the geometry works out to.
            let justOne = null;
            for (let n = 2; n < 200 && justOne === null; n += 1) {
                const pile = Array.from({length: n}, (_, i) => ({
                    id: `o${i}`, name: `GENE${i}`, FC: 2.0, pValue: 0,
                }));
                const pileIds = pile.map((g) => g.id);
                const built = getGeneVolcanoOptions(pile, thresholds, pileIds, pileIds);
                const drawnHere = built.series[1].data.filter((d) => d.label.show).length;
                if (n - drawnHere === 1) justOne = built;
            }
            assert.ok(justOne, "expected some pile size to drop exactly one label");
            assert.strictEqual(justOne.graphic.elements[0].style.text, "1 more label not shown");
        });
    });
});

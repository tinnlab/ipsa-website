import assert from "assert";
import {
    assignLabelSlots,
    estimateLabelWidthPx,
    renderedAxisExtent,
    slotOffsetPx,
    LABEL_GAP,
    LABEL_ROW_HEIGHT,
    LAYOUT_DEFAULTS,
} from "../imports/utils/volcanoLabelLayout";

// The plot's own geometry: -log10(FDR) clamps at 16, log2FC runs roughly +/-5.
const EXTENT = {xMin: -5, xMax: 5, yMin: 0, yMax: 16};

const PLOT_W = LAYOUT_DEFAULTS.nominalPlotWidth - LAYOUT_DEFAULTS.horizontalPadding;
const PLOT_H = LAYOUT_DEFAULTS.nominalPlotHeight - LAYOUT_DEFAULTS.verticalPadding;

// N genes stranded on the clamp line, spread evenly across the x axis — the user's
// reported case, where every point shares one y and differs only in fold change.
const clampLine = (n, name = (i) => `GENE${i}`) =>
    Array.from({length: n}, (_, i) => ({
        index: i,
        x: -2.4 + (4.8 * i) / Math.max(1, n - 1),
        y: 16,
        text: name(i),
    }));

// Reproduce the nominal-pixel boxes the module places, so a test can assert the real
// property — that no two drawn names occupy the same space — instead of trusting the
// internal slot numbers.
const boxesFor = (points, result, extent = EXTENT) => {
    const ax = renderedAxisExtent(extent.xMin, extent.xMax);
    const ay = renderedAxisExtent(extent.yMin, extent.yMax);
    return points
        .filter((p) => result.slotByIndex[p.index])
        .map((p) => {
            const cx = ((p.x - ax.min) / (ax.max - ax.min)) * PLOT_W;
            const cy = ((ay.max - p.y) / (ay.max - ay.min)) * PLOT_H;
            const half = estimateLabelWidthPx(p.text, LAYOUT_DEFAULTS.fontSize, LAYOUT_DEFAULTS.charWidthRatio) / 2;
            const dy = slotOffsetPx(result.slotByIndex[p.index]);
            return {
                text: p.text,
                x0: cx - half, x1: cx + half,
                // The GLYPH box, not the reserved row: "overprint" is about the drawn
                // text. Two labels in adjacent rows abut exactly at the row pitch, so
                // measuring rows would flag a touch as a collision on floating-point
                // noise alone, while the ink is a comfortable 5px apart.
                y0: cy + dy - LAYOUT_DEFAULTS.fontSize / 2, y1: cy + dy + LAYOUT_DEFAULTS.fontSize / 2,
            };
        });
};

const assertNoOverlap = (boxes) => {
    for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
            assert.ok(!hit, `${a.text} and ${b.text} overprint`);
        }
    }
};

describe("volcanoLabelLayout", function () {
    describe("degenerate input", function () {
        it("returns nothing for an empty list", function () {
            assert.deepStrictEqual(assignLabelSlots([], EXTENT), {slotByIndex: {}, hiddenIndices: []});
        });

        it("returns nothing when called with no arguments at all", function () {
            assert.deepStrictEqual(assignLabelSlots(), {slotByIndex: {}, hiddenIndices: []});
        });

        it("tolerates a non-array", function () {
            assert.deepStrictEqual(assignLabelSlots("nope"), {slotByIndex: {}, hiddenIndices: []});
        });

        it("skips points with a non-finite coordinate instead of placing them", function () {
            const {slotByIndex, hiddenIndices} = assignLabelSlots([
                {index: 0, x: NaN, y: 16, text: "BAD"},
                {index: 1, x: 1, y: Infinity, text: "ALSOBAD"},
                {index: 2, x: 1, y: 12, text: "GOOD"},
            ], EXTENT);
            // Unplaceable is not the same as "no room left" — nothing to report.
            assert.deepStrictEqual(hiddenIndices, []);
            assert.deepStrictEqual(Object.keys(slotByIndex), ["2"]);
        });
    });

    describe("the degenerate case: many labels on one y", function () {
        const points = clampLine(25);
        const result = assignLabelSlots(points, EXTENT);

        it("places every label", function () {
            assert.strictEqual(Object.keys(result.slotByIndex).length, 25);
            assert.deepStrictEqual(result.hiddenIndices, []);
        });

        it("draws no two names on top of each other", function () {
            assertNoOverlap(boxesFor(points, result));
        });

        it("packs several labels per row rather than one step each", function () {
            const rows = new Set(Object.values(result.slotByIndex).map((s) => s.dy));
            assert.ok(rows.size < 25, `expected fewer rows than labels, got ${rows.size}`);
        });

        it("stacks mostly downward, because the clamp line is near the top", function () {
            // Direction is a preference resolved against the real chart edges, not an
            // absolute rule: the axis nices up to 18 while the clamp line is at 16, so a
            // couple of labels legitimately use that sliver of headroom. The bulk must
            // still go down, and the staircase must only ever reach downward.
            const dys = Object.values(result.slotByIndex).map((s) => s.dy);
            const down = dys.filter((d) => d > 0).length;
            assert.ok(down > dys.length / 2, `only ${down} of ${dys.length} went down`);
            assert.ok(Math.max(...dys) > Math.abs(Math.min(...dys)), "expected the reach to be downward");
        });

        it("keeps every label inside the plotting area", function () {
            boxesFor(points, result).forEach((b) => {
                assert.ok(b.y0 >= 0 && b.y1 <= PLOT_H, `${b.text} at ${b.y0}..${b.y1} escapes 0..${PLOT_H}`);
            });
        });
    });

    describe("stack direction follows where the label sits", function () {
        it("stacks mostly upward for a pile near the bottom of the range", function () {
            const {slotByIndex} = assignLabelSlots(
                clampLine(6).map((p) => ({...p, y: 1})),
                EXTENT,
            );
            const dys = Object.values(slotByIndex).map((s) => s.dy);
            const up = dys.filter((d) => d < 0).length;
            assert.ok(up > dys.length / 2, `only ${up} of ${dys.length} went up`);
            assert.ok(Math.abs(Math.min(...dys)) > Math.max(...dys), "expected the reach to be upward");
        });

        it("splits both ways in the middle, halving how far the staircase reaches", function () {
            // Same x for every point, so nothing can share a row and the split shows.
            const stacked = Array.from({length: 6}, (_, i) => ({index: i, x: 0, y: 8, text: `GENE${i}`}));
            const {slotByIndex} = assignLabelSlots(stacked, EXTENT);
            const dys = Object.values(slotByIndex).map((s) => s.dy);
            assert.ok(dys.some((d) => d > 0) && dys.some((d) => d < 0), "expected both directions");
            // 6 labels sharing one x need 6 rows; split evenly they reach ~3 rows each
            // way rather than 6 in one direction.
            const reach = Math.max(...dys.map(Math.abs));
            assert.ok(reach < LABEL_GAP + 4 * LABEL_ROW_HEIGHT, `reached ${reach}`);
        });
    });

    describe("a single isolated label", function () {
        // AKR1D1 in the user's screenshot: no neighbours, renders fine today.
        const result = assignLabelSlots([{index: 7, x: 1.5, y: 13, text: "AKR1D1"}], EXTENT);

        it("is placed, nothing hidden", function () {
            assert.deepStrictEqual(result.hiddenIndices, []);
        });

        it("sits in the nearest row that clears its own dot", function () {
            // Labels snap to a shared row grid, so the offset is the closest grid row at
            // least LABEL_GAP away — not LABEL_GAP exactly.
            const dy = Math.abs(result.slotByIndex[7].dy);
            assert.ok(dy >= LABEL_GAP && dy < LABEL_GAP + LABEL_ROW_HEIGHT, `dy was ${dy}`);
        });
    });

    describe("well-separated labels are left alone", function () {
        it("gives every label its nearest row when they share neither x nor y", function () {
            const {slotByIndex} = assignLabelSlots([
                {index: 0, x: -4, y: 14, text: "AAA"},
                {index: 1, x: 0, y: 9, text: "BBB"},
                {index: 2, x: 4, y: 4, text: "CCC"},
            ], EXTENT);
            Object.values(slotByIndex).forEach((s) => {
                const dy = Math.abs(s.dy);
                assert.ok(dy >= LABEL_GAP && dy < LABEL_GAP + LABEL_ROW_HEIGHT, `dy was ${dy}`);
            });
        });
    });

    describe("piles at different heights do not collide", function () {
        // The defect a per-cluster version had: one pile's staircase grew straight into
        // the pile just below it, because rows restarted at 0 for each pile.
        // Deliberately well under capacity (18 labels, ~26 rows) so this exercises the
        // collision rule rather than doubling as a capacity test.
        const points = [
            ...Array.from({length: 6}, (_, i) => ({index: i, x: 0, y: 16, text: `TOP${i}`})),
            ...Array.from({length: 6}, (_, i) => ({index: 6 + i, x: 0, y: 15.3, text: `NEXT${i}`})),
            ...Array.from({length: 6}, (_, i) => ({index: 12 + i, x: 0, y: 14.6, text: `THIRD${i}`})),
        ];
        const result = assignLabelSlots(points, EXTENT);

        it("draws no two names on top of each other across the piles", function () {
            assertNoOverlap(boxesFor(points, result));
        });

        it("still places all of them", function () {
            assert.deepStrictEqual(result.hiddenIndices, []);
        });
    });

    describe("the layout survives a chart of a different height", function () {
        // The defect this guards, which a nominal-height-only check cannot see: a slot
        // is a FIXED pixel offset, but the dot's own height on the canvas SCALES with
        // the plot. Labels whose dots sit at different y therefore drift relative to
        // each other, and a pair that clears at one height can collide at another. The
        // live chart is 700px tall while the export default is 600, so this is the
        // primary on-screen view, not an exotic case.
        const mixedHeights = [
            ...Array.from({length: 10}, (_, i) => ({index: i, x: -2 + i * 0.4, y: 16, text: `TOP${i}`})),
            ...Array.from({length: 10}, (_, i) => ({index: 10 + i, x: -2 + i * 0.4, y: 14.3, text: `MID${i}`})),
            ...Array.from({length: 10}, (_, i) => ({index: 20 + i, x: -2 + i * 0.4, y: 12.6, text: `LOW${i}`})),
        ];
        const result = assignLabelSlots(mixedHeights, EXTENT);

        // Re-project at an arbitrary plot height, keeping the slot offsets fixed exactly
        // as the rendered chart does.
        const boxesAtHeight = (plotHeightPx) => {
            const ay = renderedAxisExtent(EXTENT.yMin, EXTENT.yMax);
            const ax = renderedAxisExtent(EXTENT.xMin, EXTENT.xMax);
            return mixedHeights
                .filter((p) => result.slotByIndex[p.index])
                .map((p) => {
                    const cx = ((p.x - ax.min) / (ax.max - ax.min)) * PLOT_W;
                    const cy = ((ay.max - p.y) / (ay.max - ay.min)) * plotHeightPx;
                    const half = estimateLabelWidthPx(
                        p.text, LAYOUT_DEFAULTS.fontSize, LAYOUT_DEFAULTS.charWidthRatio,
                    ) / 2;
                    const dy = slotOffsetPx(result.slotByIndex[p.index]);
                    return {
                        text: p.text,
                        x0: cx - half, x1: cx + half,
                        // The GLYPH box, not the reserved row: "overprint" is about the drawn
                // text. Two labels in adjacent rows abut exactly at the row pitch, so
                // measuring rows would flag a touch as a collision on floating-point
                // noise alone, while the ink is a comfortable 5px apart.
                y0: cy + dy - LAYOUT_DEFAULTS.fontSize / 2, y1: cy + dy + LAYOUT_DEFAULTS.fontSize / 2,
                    };
                });
        };

        it("places them all at the nominal height", function () {
            assert.deepStrictEqual(result.hiddenIndices, []);
            assertNoOverlap(boxesAtHeight(PLOT_H));
        });

        it("still does not overprint on the taller live chart", function () {
            // VolcanoChartGene renders at 700px, i.e. a 550px plotting area.
            assertNoOverlap(boxesAtHeight(550));
        });

        it("still does not overprint anywhere across the supported height range", function () {
            for (let h = PLOT_H; h <= PLOT_H * 3; h += 25) assertNoOverlap(boxesAtHeight(h));
        });
    });

    describe("name length changes the placement (displayMode)", function () {
        // 'symbol' draws e.g. AKR1D1; 'id' draws a long Ensembl accession. Same points,
        // same geometry — only the text differs.
        const points = clampLine(12);
        const ids = points.map((p) => ({...p, text: `ENSG00000${100000 + p.index}`}));
        const symbolResult = assignLabelSlots(points, EXTENT);
        const idResult = assignLabelSlots(ids, EXTENT);

        it("keeps both readable", function () {
            assertNoOverlap(boxesFor(points, symbolResult));
            assertNoOverlap(boxesFor(ids, idResult));
        });

        it("reaches at least as far for long ids as for short symbols", function () {
            const reach = (pts, r) => Math.max(...pts.map((p) => Math.abs(slotOffsetPx(r.slotByIndex[p.index]))));
            assert.ok(reach(ids, idResult) >= reach(points, symbolResult));
        });

        it("still places every label in both modes", function () {
            assert.strictEqual(Object.keys(symbolResult.slotByIndex).length, 12);
            assert.strictEqual(Object.keys(idResult.slotByIndex).length, 12);
        });
    });

    describe("nominalPlotWidth", function () {
        // The safe-direction argument the design rests on: a narrower assumed width
        // must never pack MORE tightly. If this inverts, an export narrower than the
        // calibration would overlap.
        it("never reaches less far as the assumed width shrinks", function () {
            const points = clampLine(20);
            let previous = 0;
            [2000, 1600, 1200, 800, 500, 300].forEach((nominalPlotWidth) => {
                const {slotByIndex} = assignLabelSlots(points, {...EXTENT, nominalPlotWidth});
                const reach = Math.max(...Object.values(slotByIndex).map((s) => Math.abs(s.dy)));
                assert.ok(reach >= previous, `width ${nominalPlotWidth} reached ${reach}, less than ${previous}`);
                previous = reach;
            });
        });

        it("uses a shallower staircase on a wide plot than a narrow one", function () {
            const points = clampLine(20);
            const deepest = (w) => {
                const {slotByIndex} = assignLabelSlots(points, {...EXTENT, nominalPlotWidth: w});
                return Math.max(...Object.values(slotByIndex).map((s) => Math.abs(s.dy)));
            };
            assert.ok(deepest(2000) < deepest(300));
        });
    });

    describe("renderedAxisExtent", function () {
        // The placement converts label pixels into data units, so it has to use the
        // range the AXIS is drawn over, not the range of the data. Both expansions were
        // checked against a real render of analysis NYu3EApEc28QnxwAj.
        it("reproduces the axis echarts actually draws for the real data", function () {
            assert.deepStrictEqual(renderedAxisExtent(-3.6748, 2.6157), {min: -4, max: 3});
            assert.deepStrictEqual(renderedAxisExtent(0.0000434, 16), {min: 0, max: 18});
        });

        it("pins a wholly-positive range down to zero, and a negative one up to it", function () {
            // Neither volcano axis sets `scale`, so echarts forces the range through 0.
            assert.strictEqual(renderedAxisExtent(1.5, 3.0).min, 0);
            assert.strictEqual(renderedAxisExtent(-3.0, -1.5).max, 0);
        });

        it("is never narrower than the data it is given", function () {
            [[-3.6748, 2.6157], [1.5, 3], [-3, -1.5], [0, 16], [-0.2, 0.2]].forEach(([lo, hi]) => {
                const out = renderedAxisExtent(lo, hi);
                assert.ok(out.min <= lo && out.max >= hi, `[${lo},${hi}] -> [${out.min},${out.max}]`);
            });
        });

        it("is idempotent, so an already-niced extent passes through", function () {
            const once = renderedAxisExtent(-3.6748, 2.6157);
            assert.deepStrictEqual(renderedAxisExtent(once.min, once.max), once);
        });

        it("does not throw on a degenerate or non-finite range", function () {
            assert.deepStrictEqual(renderedAxisExtent(5, 5), {min: 0, max: 5});
            assert.deepStrictEqual(renderedAxisExtent(0, 0), {min: 0, max: 0});
            assert.deepStrictEqual(renderedAxisExtent(NaN, 1), {min: NaN, max: 1});
        });

        it("is applied inside assignLabelSlots, so a caller cannot forget it", function () {
            // -2.4..2.4 nices to -3..3, so passing either must give the same answer.
            const points = clampLine(20);
            const raw = assignLabelSlots(points, {xMin: -2.4, xMax: 2.4, yMin: 0, yMax: 16});
            const nice = assignLabelSlots(points, {xMin: -3, xMax: 3, yMin: 0, yMax: 18});
            assert.deepStrictEqual(raw.slotByIndex, nice.slotByIndex);
        });
    });

    describe("running out of room", function () {
        // "Paste list" in the picker adds every matched gene with no limit, so a
        // several-hundred-label set is reachable. All at one x AND one y here, so
        // nothing can share a row and the staircase is forced to the chart edge.
        const many = Array.from({length: 120}, (_, i) => ({index: i, x: 0, y: 16, text: `GENE${i}`}));
        const result = assignLabelSlots(many, EXTENT);

        it("draws only what fits, and reports the rest", function () {
            assert.ok(result.hiddenIndices.length > 0, "expected some labels to be dropped");
            assert.ok(Object.keys(result.slotByIndex).length > 0, "expected some to survive");
            assert.strictEqual(
                Object.keys(result.slotByIndex).length + result.hiddenIndices.length, 120,
            );
        });

        it("keeps every drawn label on the chart", function () {
            boxesFor(many, result).forEach((b) => {
                assert.ok(b.y0 >= 0 && b.y1 <= PLOT_H, `${b.text} escapes the plotting area`);
            });
        });

        it("hides nothing when the set fits", function () {
            assert.deepStrictEqual(assignLabelSlots(clampLine(10), EXTENT).hiddenIndices, []);
        });

        it("keeps the most significant genes, dropping the least", function () {
            // Same x, so priority is decided by y (higher = smaller p).
            const ranked = Array.from({length: 40}, (_, i) => ({
                index: i, x: 0, y: 16 - i * 0.001, text: `GENE${i}`,
            }));
            const {slotByIndex, hiddenIndices} = assignLabelSlots(ranked, EXTENT);
            const keptMax = Math.max(...Object.keys(slotByIndex).map(Number));
            const hiddenMin = Math.min(...hiddenIndices);
            assert.ok(hiddenIndices.length > 0, "expected the chart to fill up");
            assert.ok(keptMax < hiddenMin, "a less significant gene was kept over a more significant one");
        });

        it("breaks a tie in significance toward the larger absolute fold change", function () {
            const tied = Array.from({length: 40}, (_, i) => ({
                index: i, x: i === 0 ? -4.9 : 0.01 * i, y: 16, text: `GENE${i}`,
            }));
            const {hiddenIndices} = assignLabelSlots(tied, {...EXTENT, nominalPlotWidth: 300});
            assert.ok(!hiddenIndices.includes(0), "the largest |log2FC| must survive");
        });

        it("reports hidden indices in ascending order", function () {
            const sorted = [...result.hiddenIndices].sort((a, b) => a - b);
            assert.deepStrictEqual(result.hiddenIndices, sorted);
        });
    });

    describe("determinism", function () {
        it("gives the same answer for the same input", function () {
            const points = clampLine(30);
            assert.deepStrictEqual(assignLabelSlots(points, EXTENT), assignLabelSlots(points, EXTENT));
        });

        it("does not depend on the order the labels arrive in", function () {
            const points = clampLine(20);
            const reversed = [...points].reverse();
            assert.deepStrictEqual(
                assignLabelSlots(points, EXTENT).slotByIndex,
                assignLabelSlots(reversed, EXTENT).slotByIndex,
            );
        });

        it("does not mutate the input", function () {
            const points = clampLine(5);
            const before = JSON.parse(JSON.stringify(points));
            assignLabelSlots(points, EXTENT);
            assert.deepStrictEqual(points, before);
        });
    });

    describe("estimateLabelWidthPx", function () {
        it("scales with character count and font size", function () {
            assert.ok(estimateLabelWidthPx("ABCDEF", 12, 0.68) > estimateLabelWidthPx("ABC", 12, 0.68));
            assert.ok(estimateLabelWidthPx("ABC", 24, 0.68) > estimateLabelWidthPx("ABC", 12, 0.68));
        });

        it("treats a missing name as empty rather than throwing", function () {
            assert.strictEqual(estimateLabelWidthPx(undefined, 12, 0.68), 0);
            assert.strictEqual(estimateLabelWidthPx(null, 12, 0.68), 0);
        });
    });
});

// Staircase label placement for the gene volcano plot.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported by the server-side Mocha runner, exactly like
// volcanoGeneSelect.js and geneVolcanoOptions.js.
//
// THE PROBLEM. -log10(FDR) is clamped at 1e-16 (geneVolcanoOptions.js), and R hands
// us hard zeros: in the shipped data one 21,989-gene analysis has 276 genes with
// pValueFDR === 0 and NONE strictly between 0 and 1e-16. Every one of those genes is
// drawn at exactly y = 16. They differ only in x. Labelling them with ECharts'
// `moveOverlap: 'shiftY'` degenerates, because vertical shifting is the one axis on
// which the points are identical. So this module gives each label its own slot in a
// staircase that fans away from the crowded line, and the caller draws a leader line
// back to each dot.
//
// WHY THE LAYOUT IS COMPUTED FROM DATA AND NOT FROM PIXELS. The export path
// (EchartsWrapper.renderSVG) does not capture the live canvas: it reads getOption()
// and re-renders into a BRAND-NEW offscreen chart at the user's chosen size (800x600
// by default, versus roughly full-width x 700 on screen). A layout that closes over
// the live chart width is therefore wrong in the exported figure — the mistake the
// pathway volcano (VolcanoChart.jsx) currently makes. Here the slots are computed
// once from the DATA, and the caller's labelLayout callback turns a slot into a pure
// PIXEL OFFSET from that label's own dot. The same closure travels into the offscreen
// chart via getOption(), so screen and export get an identical staircase at any size.
//
// HOW. Every label is projected into a NOMINAL pixel space (a hypothetical plot of
// `nominalPlotWidth` x `nominalPlotHeight`) and assigned a row on a GLOBAL grid of
// text-height bands, taking the nearest free row that still clears its own dot. The
// placement is global rather than per-pile, which is what an earlier version got wrong
// — one pile's staircase grew straight into the pile below it. A shared row grid also
// lets labels whose dots sit at different heights share a row instead of each carving
// out its own band, which is most of the usable capacity on a busy plot.
//
// TWO CALIBRATIONS, AND WHY THEY DIFFER.
//
// Width: the nominal width is deliberately the SMALL end of plausible geometry,
// because the error is one-sided. Two labels' horizontal gap grows with the real plot
// width, so assuming a plot NARROWER than reality only spreads labels further than
// they needed; assuming a wider one lets them touch.
//
// Height: NOT one-sided, and this is subtle. The slot is a fixed pixel offset from the
// dot, but the dot's own height on the canvas SCALES with the plot. Two labels whose
// dots sit at different y therefore drift relative to each other as the chart grows or
// shrinks, and a pair that clears at one height can collide at another — the live chart
// is 700px tall while the export default is 600. (A pile that shares one y, such as the
// 1e-16 clamp line, is immune: its dots scale together.) So a candidate slot must clear
// every placed label across the whole plausible height range, not at one height. The
// vertical gap is linear in plot height, so testing the two ends of the range — plus
// the sign, to catch a pair that swaps order in between — settles the whole interval.

// Tallest plausible plot as a multiple of the nominal one. The nominal plot is the
// 800x600 export default; the live chart is 700px tall (a factor of ~1.2), and this
// leaves headroom for a deliberately large export on top of that.
const MAX_HEIGHT_SCALE = 3;

// Vertical distance between two staircase rows, in pixels. Comfortably clears a 12px
// label plus its halo, and doubles as the height of a label's collision box.
export const LABEL_ROW_HEIGHT = 17;
// Pixel gap between a dot and the nearest slot of its staircase, leaving room for the
// leader line to read as a connector rather than a collision.
export const LABEL_GAP = 14;

export const LAYOUT_DEFAULTS = {
    // Narrow end of plausible render widths, NOT the typical width — see above. This
    // is the narrowest geometry the layout is verified at, and it is effectively the
    // promise: labels are legible at this width and anything wider.
    //
    // Measured on the real 25-label case, against 800 (the export form's default):
    //   500 -> clean at 500/800/1600/screen; 36 of 100 spread labels drawn
    //   800 -> 98 overlapping pairs at a 500px export; 52 of 100 drawn
    // The extra capacity is not worth it. When a user labels 100 genes the plot is
    // simply full either way — both settings hide most of them and say so — whereas the
    // calibration is the difference between a clean and a broken narrow export. At the
    // 800 default this also buys much more comfortable spacing (46-64px between
    // row-mates rather than 11-17px).
    nominalPlotWidth: 500,
    nominalPlotHeight: 600,
    // Margins the grid reserves for the axes, mirroring geneVolcanoOptions' `grid`, so
    // the projection is onto the plotting area rather than the whole canvas.
    horizontalPadding: 100,
    verticalPadding: 150,
    fontSize: 12,
    // Average glyph width as a fraction of font size. Gene symbols are upper-case,
    // which run wider than mixed-case prose, so this leans high on purpose — over-
    // estimating a name's width costs a slot, under-estimating causes an overlap.
    charWidthRatio: 0.68,
    // Minimum clear space between two labels sharing a row, in pixels.
    labelPaddingPx: 12,
};

// Estimated rendered width of a label, in pixels. ECharts measures text exactly at
// layout time, but that measurement is per-label and unavailable when deciding which
// labels may sit side by side, so the placement works from character count instead.
export const estimateLabelWidthPx = (text, fontSize, charWidthRatio) =>
    String(text == null ? '' : text).length * fontSize * charWidthRatio;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// ECharts' default splitNumber for a value axis.
const SPLIT_NUMBER = 5;

// numberUtil.nice(val, true) from echarts (util/number.js) — the rounding that picks
// an axis tick interval.
const niceStep = (raw) => {
    const exponent = Math.floor(Math.log10(raw));
    const exp10 = 10 ** exponent;
    const f = raw / exp10;
    let nf;
    if (f < 1.5) nf = 1;
    else if (f < 2.5) nf = 2;
    else if (f < 4) nf = 3;
    else if (f < 7) nf = 5;
    else nf = 10;
    return nf * exp10;
};

/**
 * The extent ECharts will actually RENDER a `type:'value'` axis over, which is wider
 * than the data extent — the difference matters because the placement converts a
 * label's pixel width into data units, and using too narrow a range under-estimates
 * how much of the axis a name covers, which is the one error direction that overlaps.
 *
 * Two expansions, both reproduced from the echarts source, and both verified against a
 * real render (data x -3.675..2.616 -> axis [-4, 3]; y 0..16 -> axis [0, 18]):
 *   1. Neither volcano axis sets `scale`, so `getNeedCrossZero()` is true and
 *      scaleRawExtentInfo pins a wholly-positive range down to 0 (or a wholly-negative
 *      one up to 0).
 *   2. Interval.calcNiceExtent then rounds each end outward to a whole tick interval.
 */
export const renderedAxisExtent = (min, max) => {
    if (!isFiniteNumber(min) || !isFiniteNumber(max)) return { min, max };
    const lo = min > 0 ? 0 : min;
    const hi = max < 0 ? 0 : max;
    const span = hi - lo;
    if (!(span > 0)) return { min: lo, max: hi };
    const interval = niceStep(span / SPLIT_NUMBER);
    if (!(interval > 0)) return { min: lo, max: hi };
    return { min: Math.floor(lo / interval) * interval, max: Math.ceil(hi / interval) * interval };
};

// Most significant first: higher y is a smaller p-value; ties (the whole point of this
// module — the clamp line is one enormous tie) break toward the larger |log2FC|, which
// is the more interesting gene on a volcano. The last two keys only make the order
// total, so the output is deterministic.
const byPriority = (a, b) => {
    if (b.y !== a.y) return b.y - a.y;
    const ax = Math.abs(a.x);
    const bx = Math.abs(b.x);
    if (bx !== ax) return bx - ax;
    const byText = String(a.text).localeCompare(String(b.text));
    return byText !== 0 ? byText : a.index - b.index;
};

/**
 * Would these two labels ever collide, at any plot height in the supported range?
 *
 * Horizontal separation does not depend on plot height (both labels are centred on
 * their own dot and their widths are fixed), and it only ever grows with a wider plot,
 * so it is settled at the nominal width alone: no horizontal overlap means no collision
 * whatever else happens.
 *
 * Vertical separation does depend on plot height, because each dot's position scales
 * while its label's offset does not. The gap is linear in that scale, so it is enough
 * to test both ends of the range — with one extra guard: if the gap changes SIGN, the
 * two labels swap places somewhere in between and therefore pass through zero.
 */
const collides = (a, b) => {
    if (!(a.x0 < b.x1 && b.x0 < a.x1)) return false;
    const gapAt = (scale) => (a.cy * scale + a.dy) - (b.cy * scale + b.dy);
    const near = gapAt(1);
    const far = gapAt(MAX_HEIGHT_SCALE);
    if (near === 0 || far === 0) return true;
    if ((near > 0) !== (far > 0)) return true;
    return Math.min(Math.abs(near), Math.abs(far)) < LABEL_ROW_HEIGHT;
};

/**
 * Place every label in a staircase slot.
 *
 * @param {Array<{index:number, x:number, y:number, text:string}>} labels
 *   One entry per label to draw. `index` is the caller's key (for the gene volcano,
 *   the overlay series dataIndex); `x`/`y` are DATA coordinates (log2FC and
 *   -log10(FDR)); `text` is the name that will be rendered.
 * @param {object} [options]
 * @param {number} [options.xMin] @param {number} [options.xMax]
 * @param {number} [options.yMin] @param {number} [options.yMax]
 *   The FULL plotted data ranges, not just the labelled subset — the axes are scaled
 *   to all genes, so a label's share of the plot width depends on the whole range.
 *   Passed as DATA extents; the axis nicing above is applied here so a caller cannot
 *   forget it. Default to the labelled points' own extent when omitted.
 * @param {number} [options.nominalPlotWidth] see LAYOUT_DEFAULTS
 * @param {number} [options.nominalPlotHeight] see LAYOUT_DEFAULTS
 * @returns {{slotByIndex: Object<number,{dy:number}>, hiddenIndices:number[]}}
 *   `dy` is the label's pixel offset from its dot's centre, negative upward.
 *   `hiddenIndices` are labels with nowhere left on the chart to go; the caller should
 *   not draw them, and should say how many it dropped.
 */
export const assignLabelSlots = (labels, options = {}) => {
    const empty = { slotByIndex: {}, hiddenIndices: [] };
    if (!Array.isArray(labels) || labels.length === 0) return empty;

    const opts = { ...LAYOUT_DEFAULTS, ...options };

    // A point with a non-finite coordinate cannot be positioned at all. It is not
    // "hidden because the chart is full" — it was never placeable — so it is silently
    // left slotless rather than counted in the note.
    const points = labels.filter((l) => l && isFiniteNumber(l.x) && isFiniteNumber(l.y));
    if (points.length === 0) return empty;

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const { min: xMin, max: xMax } = renderedAxisExtent(
        isFiniteNumber(opts.xMin) ? opts.xMin : Math.min(...xs),
        isFiniteNumber(opts.xMax) ? opts.xMax : Math.max(...xs),
    );
    const { min: yMin, max: yMax } = renderedAxisExtent(
        isFiniteNumber(opts.yMin) ? opts.yMin : Math.min(...ys),
        isFiniteNumber(opts.yMax) ? opts.yMax : Math.max(...ys),
    );
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;

    // Plotting area, not canvas: the grid reserves margins for the axes.
    const plotWidth = Math.max(1, opts.nominalPlotWidth - opts.horizontalPadding);
    const plotHeight = Math.max(1, opts.nominalPlotHeight - opts.verticalPadding);

    // Project a dot into nominal pixels. A degenerate range means every dot lands in
    // the middle, which is right: nothing can then be told apart horizontally, so each
    // label ends up on its own row.
    const toPx = (x) => (xRange > 0 ? ((x - xMin) / xRange) * plotWidth : plotWidth / 2);
    const toPy = (y) => (yRange > 0 ? ((yMax - y) / yRange) * plotHeight : plotHeight / 2);

    // A global grid of text-height rows spanning the plotting area. Rows are shared by
    // every label, so two whose dots sit at different heights can occupy the same row
    // instead of each reserving its own band. Being inside the grid is also what bounds
    // the staircase: a label with no free row simply has nowhere to go on this chart,
    // which is the cap. The grid is laid out at the nominal (smallest) height, so a
    // taller chart only ever has more room than was budgeted.
    const rowCount = Math.max(1, Math.floor(plotHeight / LABEL_ROW_HEIGHT));
    const rowCentres = Array.from(
        { length: rowCount },
        (unused, k) => (k + 0.5) * LABEL_ROW_HEIGHT,
    );

    const placed = [];
    const slotByIndex = {};
    const hiddenIndices = [];

    // Most significant first, so the genes that matter get the rows nearest their dot
    // and the ones pushed further away (or dropped) are the least interesting.
    [...points].sort(byPriority).forEach((p) => {
        const cx = toPx(p.x);
        const cy = toPy(p.y);
        const half = estimateLabelWidthPx(p.text, opts.fontSize, opts.charWidthRatio) / 2
            + opts.labelPaddingPx / 2;

        // Nearest row first, so a label sits as close to its own dot as it can and the
        // leader line stays short. Rows closer than LABEL_GAP would collide with the dot
        // itself. The tie-break sends a label toward the side with more room, so a pile
        // at the top of the plot — the 1e-16 clamp line — grows downward.
        const preferDown = cy < plotHeight / 2;
        const candidates = rowCentres
            .map((centre) => ({ centre, dy: centre - cy }))
            .filter((c) => Math.abs(c.dy) >= LABEL_GAP)
            .sort((c, d) => (
                Math.abs(c.dy) - Math.abs(d.dy)
                || (preferDown ? d.dy - c.dy : c.dy - d.dy)
            ));

        const box = candidates.find((c) => {
            const candidate = { x0: cx - half, x1: cx + half, cy, dy: c.dy };
            return !placed.some((q) => collides(candidate, q));
        });

        if (box) {
            placed.push({ x0: cx - half, x1: cx + half, cy, dy: box.dy });
            slotByIndex[p.index] = { dy: box.dy };
        } else {
            hiddenIndices.push(p.index);
        }
    });

    hiddenIndices.sort((a, b) => a - b);
    return { slotByIndex, hiddenIndices };
};

/**
 * Pixel offset from a dot's centre to its label, for a slot from `assignLabelSlots`.
 * Pure pixels and no absolute geometry, which is what makes the layout identical on
 * screen and in an export rendered at a different size.
 */
export const slotOffsetPx = (slot) => slot.dy;

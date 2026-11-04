// ECharts option builder for the main gene-level DE volcano plot
// (VolcanoChartGene). Extracted into a pure, side-effect-free module — like
// volcanoPlotOptions.js — so it can be unit-tested directly without pulling in
// React / echarts / Meteor.
//
// The gene volcano renders the FULL gene list (~15k–25k points) on a WebGL
// `scatterGL` series for speed. WebGL points cannot carry ECharts labels, so to
// label a user-chosen subset we overlay those genes as an ordinary `scatter`
// series on the SAME cartesian axes (regular scatter supports labels, collision
// avoidance, and leader lines — the pattern already used by the pathway
// VolcanoChart.jsx).
//
// Two INDEPENDENT gene sets drive the view:
//   - focus  -> which genes to highlight. Non-empty focus => "isolate" mode: the
//     focused genes render bright on an overlay above the cloud.
//   - label  -> which of the focused genes get their NAME drawn (a subset the user
//     picks explicitly). Kept separate so "focus the top 100, label only 3" works
//     without the plot drowning in labels.
// `displayMode` ('symbol' | 'id') controls how gene names are rendered everywhere.
//
// The base cloud KEEPS its up/down/non-significant colours while genes are focused.
// It used to grey out, but the focused genes are already set apart by a dark 2.5px
// border, a larger symbol and a labelled leader line, so the grey wash bought emphasis
// that was already there while costing the reader the up/down reading of the whole
// experiment. `dimNonFocused` restores it for anyone who wants it, and
// `hideNonFocused` remains the stronger option: drop the cloud entirely and rescale.
//
// IMPORTANT — merge safety: the consumer renders with `<ReactEcharts option=.../>`
// which uses ECharts' default *merge* setOption. So this builder ALWAYS emits the
// same component set (two series + one visualMap + one graphic) and only toggles
// their content. That way switching modes updates components in place instead of
// leaving a stale visualMap (which would recolour the dimmed cloud), a stray overlay
// series, or a stale "N more labels not shown" note behind. Do not drop a component
// in one branch and not the other.
//
// LABEL PLACEMENT: names are positioned by a `labelLayout` CALLBACK driven by slots
// that volcanoLabelLayout.js precomputes from the data. See that module's header for
// why the layout must not depend on the live chart width — in short, the export path
// re-renders this very option into a differently-sized offscreen chart.

import { classifyGene } from './volcanoGeneSelect';
import { assignLabelSlots, slotOffsetPx } from './volcanoLabelLayout';

const CATEGORY = {
    up: { label: 'Up-regulated', index: 0, color: '#FF0000' },
    down: { label: 'Down-regulated', index: 1, color: '#1312FF' },
    nonsig: { label: 'Non-significant', index: 2, color: '#AAAAAA' },
};

// Faint grey the non-focused cloud dims to when dimming is switched on.
const DIM_COLOR = '#DDDDDD';
// Overlay colour for a focused gene that is itself non-significant, used ONLY while
// the cloud is dimmed: a darker grey so it stays visible against a background that is
// near DIM_COLOR. With the cloud in full colour the same grey would read as a fourth
// category, so the overlay uses the real non-significant colour there and lets the
// dark border and larger symbol carry the emphasis instead.
const OVERLAY_NONSIG_DIMMED_COLOR = '#555555';
// Dark, high-contrast outline for the genes the user chose to label, so their dots
// stand out from the plain white-bordered focused dots.
const LABEL_BORDER_COLOR = '#111111';

// How a gene id/symbol is rendered given the chosen display mode.
export const displayNameOf = (gene, displayMode) =>
    displayMode === 'id' ? String(gene.id) : (gene.name ?? String(gene.id));

// -log10(p) with the same 1e-16 clamp the plot has always used to avoid Infinity.
const negLog10 = (p) => (p >= 1e-16 ? -Math.log10(p) : -Math.log10(1e-16));

// Scientific notation (e.g. 1.23E-45) so tiny p-values don't all collapse to 0.00.
const formatP = (p) =>
    (typeof p === 'number' && Number.isFinite(p) ? p.toExponential(2).toUpperCase() : p);

// Tooltip line for a gene. The identifier label follows the display mode: a gene
// symbol reads "Gene name: …", a raw id/ensembl reads "Gene ID: …".
const tooltipHtml = (gene, displayMode) => {
    const idLabel = displayMode === 'id' ? 'Gene ID' : 'Gene name';
    return `${idLabel}: ${displayNameOf(gene, displayMode)}<br>pValue.FDR: ${formatP(gene.pValue)}<br>Log2FC: ${gene.FC?.toFixed(2)}`;
};

// Build the 5-tuple `value` used by both series (index 3/4 drive category colour).
const toValueTuple = (gene, cls, displayMode) => [
    gene.FC,
    negLog10(gene.pValue),
    tooltipHtml(gene, displayMode),
    CATEGORY[cls].label,
    CATEGORY[cls].index,
];

const commonTooltip = {
    trigger: 'item',
    formatter: (params) =>
        `<div style=";font-size: 18px; margin-bottom: 7px">` +
        '<div style="font-size: 14px;">' + params.data.value[2] + '</div>' +
        '</div>',
    backgroundColor: 'rgba(255,255,255,0.85)',
};

const commonAxes = {
    xAxis: {
        type: 'value',
        name: 'Log2FC',
        nameTextStyle: { fontSize: 12, fontWeight: 'bold' },
        nameLocation: 'middle',
        nameGap: 30,
    },
    yAxis: {
        type: 'value',
        name: '-log10(pValue.FDR)',
        nameTextStyle: { fontSize: 12, fontWeight: 'bold' },
    },
    dataZoom: [
        { type: 'inside', xAxisIndex: [0], throttle: 0, filterMode: 'empty', orient: 'vertical' },
        { type: 'inside', yAxisIndex: [0], throttle: 0, filterMode: 'empty', orient: 'vertical' },
    ],
    grid: { left: 50, right: 50, bottom: 100, top: 50 },
};

// The base scatterGL series (all genes). Colour is driven by the visualMap
// (dimension 4): full category colours normally, flat grey while dimming. Dimming
// also drops the opacity and shrinks the dots.
const buildBaseGLSeries = (volcanoPlotData, deSettings, isolate, displayMode, hideNonFocused, dim) => ({
    type: 'scatterGL',
    // zlevel 1 (NOT 0): the cartesian axes/grid live on zlevel 0. echarts-gl
    // registers its WebGL layer as a NON-builtin zrender layer, and zrender only
    // paints builtin layers — so a GL series at zlevel 0 hijacks the axis layer and
    // the axes never draw. Keeping the cloud one level above the axes (and below the
    // overlay at zlevel 2) restores the axes and preserves point-over-axis stacking.
    zlevel: 1,
    // When isolating with "hide non-focused" on, empty the base cloud entirely (but
    // keep the series present — merge-safety contract). With no base points, the
    // `type:'value'` axes auto-range over only the focus overlay, re-fitting the plot
    // to the focused genes. Untoggling restores the full cloud and original scaling.
    data: (isolate && hideNonFocused)
        ? []
        : volcanoPlotData.map((gene) => ({ value: toValueTuple(gene, classifyGene(gene, deSettings), displayMode) })),
    // Set opacity explicitly in BOTH modes: `itemStyle` is deep-merged by ECharts,
    // so an empty object would leave a stale 0.45 behind when clearing a selection.
    itemStyle: { opacity: dim ? 0.45 : 1 },
    symbolSize: dim ? 8 : 12,
    z: 12,
    large: false,
    silent: true,
    animation: false,
    sampling: 'average',
    postEffect: { enable: false },
    showSymbol: false,
});

// The bright overlay of the FOCUSED genes (regular scatter). Rendered on a higher
// zlevel so it composites ABOVE the WebGL layer (echarts-gl paints scatterGL into
// its own canvas keyed by zlevel; `z` alone does not cross that boundary). Only the
// genes in `labelSet` (a user-picked subset of the focus) show a name label; the
// rest are highlighted markers without a label. Empty `data` when nothing focused.
const buildFocusOverlaySeries = (focusGenes, labelSet, deSettings, displayMode, slotByIndex, hiddenSet, dim) => ({
    name: 'Focused genes',
    type: 'scatter',
    zlevel: 2,
    z: 20,
    // No entry animation: a large focus set ("all up") would otherwise re-animate
    // every point on each rebuild (a displayMode flip, adding one label, etc.).
    animation: false,
    data: focusGenes.map((gene, i) => {
        const cls = classifyGene(gene, deSettings);
        // The user ASKED for this name...
        const wantsLabel = labelSet.has(gene.id);
        // ...but a huge label set runs out of room on the chart, so only what fits is
        // drawn. A dropped name still keeps its dark outline: the dot stays visibly one
        // of the user's picks, and the graphic note reports how many are missing.
        const showLabel = wantsLabel && !hiddenSet.has(i);
        return {
            name: displayNameOf(gene, displayMode),
            value: toValueTuple(gene, cls, displayMode),
            itemStyle: {
                color: (cls === 'nonsig' && dim) ? OVERLAY_NONSIG_DIMMED_COLOR : CATEGORY[cls].color,
                // Labeled genes get a dark, thicker outline so their dot is easy to
                // spot; the rest keep the plain thin white border.
                borderColor: wantsLabel ? LABEL_BORDER_COLOR : '#FFFFFF',
                borderWidth: wantsLabel ? 2.5 : 1.5,
            },
            // Highlight every focused point; draw the label (and its leader line)
            // only for the genes the user explicitly chose to label.
            label: { show: showLabel },
            labelLine: { show: showLabel },
        };
    }),
    symbolSize: 14,
    // No emphasis.focus here: on a large focus set (e.g. an "all up" preset with
    // thousands of points) `focus:'self'` restyles every element on hover, which
    // is a needless jank source for a highlight layer.
    //
    // Place each name in its staircase slot, offset from ITS OWN dot in pure pixels.
    // Nothing here reads absolute canvas geometry, so the offscreen export chart —
    // which re-runs this very closure at a different size — lays the labels out
    // identically to the screen. Returning x/y also makes ECharts redraw the leader
    // line to follow the moved label (LabelManager: needsUpdateLabelLine).
    //
    // Deliberately NO `moveOverlap`. ECharts' shiftY pass (labelLayoutHelper.js,
    // shiftLayout) sorts every label by y and greedily pushes each one below the
    // previous, which is blind to the fact that two labels on the same staircase row
    // are already separated HORIZONTALLY. Left on, it flattens a compact 9-row
    // staircase into a 25-step cascade that runs off the bottom of the chart —
    // measured, not theorised. volcanoLabelLayout has already resolved the overlap.
    labelLayout: (params) => {
        const slot = slotByIndex[params.dataIndex];
        if (!slot) return {};
        const { rect } = params;
        return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2 + slotOffsetPx(slot),
            align: 'center',
            verticalAlign: 'middle',
        };
    },
    labelLine: { show: true, length2: 4, lineStyle: { color: '#666' } },
    label: {
        show: true,
        formatter: (p) => p.data.name,
        position: 'right',
        minMargin: 4,
        color: '#000',
        fontSize: 12,
        // A staircase row can land on top of the point cloud (the clamp-line cluster
        // is at the very top of the plot, so it can only stack downward, into the
        // data). A white halo keeps the name readable over arbitrary points without a
        // filled box occluding them, and renders the same in the SVG export.
        textBorderColor: '#FFFFFF',
        textBorderWidth: 3,
    },
});

// The "N more labels not shown" note. It has to live INSIDE the chart to survive
// EchartsWrapper.renderSVG, which re-renders from getOption() rather than capturing
// the DOM — a caption in React would be absent from every exported figure.
//
// Always emitted, with empty text when nothing was dropped, and always under the same
// id: a conditionally omitted graphic would be left on screen by merge setOption after
// the user trims their label set. See the merge-safety note at the top of this file.
const buildOverflowNote = (hiddenCount) => ({
    elements: [
        {
            type: 'text',
            id: 'geneVolcanoLabelOverflowNote',
            // Bottom-LEFT: EchartsWrapper's hover toolbox defaults to bottom-right at
            // zIndex 1000, and would cover the note exactly while the user is reading
            // the plot. zlevel 2 keeps it above the WebGL cloud's own canvas layer
            // (the base series is zlevel 1), which `z` alone does not cross.
            left: 12,
            bottom: 12,
            zlevel: 2,
            silent: true,
            style: {
                text: hiddenCount > 0
                    ? `${hiddenCount} more label${hiddenCount === 1 ? '' : 's'} not shown`
                    : '',
                fill: '#666',
                fontSize: 12,
            },
        },
    ],
});

// The piecewise visualMap. Always present (merge safety) and always scoped to the
// base series (index 0) so it never recolours the overlay. While DIMMING — not merely
// while a focus set is active — every category maps to the dim grey and the legend
// hides.
const buildVisualMap = (dim) => ({
    type: 'piecewise',
    // The legend is only meaningless while the cloud is flat grey. With the categories
    // drawn in colour it is the key to the whole plot, so it stays up even when a focus
    // set is active.
    show: !dim,
    dimension: 4,
    seriesIndex: 0,
    pieces: dim
        ? [
            { value: 0, color: DIM_COLOR },
            { value: 1, color: DIM_COLOR },
            { value: 2, color: DIM_COLOR },
        ]
        : [
            { value: 0, label: 'Up-regulated', color: '#FF0000' },
            { value: 1, label: 'Down-regulated', color: '#1312FF' },
            { value: 2, label: 'Non-significant', color: '#AAAAAA' },
        ],
    orient: 'horizontal',
    left: 'center',
    top: 0,
    itemSymbol: 'circle',
    itemWidth: 12,
    formatter: (value) => {
        switch (value) {
            case 0: return 'Up-regulated';
            case 1: return 'Down-regulated';
            case 2: return 'Non-significant';
            default: return 'Unknown';
        }
    },
});

const toSet = (ids) => (ids instanceof Set ? ids : new Set(ids || []));

// Extent of the PLOTTED data on both axes. The label placement needs it because the
// axes are scaled to every gene, so how much of the plot width a name covers depends
// on the full range, not on the labelled subset's own spread.
//
// A gene with a non-finite FC contributes no x, matching the plot, which cannot draw
// it either. Note the y guard is belt-and-braces rather than live: `negLog10` returns
// the 16 clamp for anything that fails `p >= 1e-16`, undefined and NaN included, so a
// gene with a missing p-value is already plotted ON the clamp line. That is
// pre-existing behaviour of the plot, not something the labelling introduces.
const plottedExtent = (volcanoPlotData) => {
    let xMin = Infinity; let xMax = -Infinity;
    let yMin = Infinity; let yMax = -Infinity;
    volcanoPlotData.forEach((gene) => {
        const x = gene.FC;
        const y = negLog10(gene.pValue);
        if (typeof x === 'number' && Number.isFinite(x)) {
            if (x < xMin) xMin = x;
            if (x > xMax) xMax = x;
        }
        if (Number.isFinite(y)) {
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
    });
    return Number.isFinite(xMin) && Number.isFinite(yMin)
        ? { xMin, xMax, yMin, yMax }
        : {};
};

/**
 * Build the ECharts option for the gene volcano.
 *
 * @param {Array<{FC:number, pValue:number, id:*, name:string}>} volcanoPlotData
 * @param {{maxAdjustedPValue:number, minLogFoldChange:number}} deSettings
 * @param {Array|Set} [focusGeneIds] ids to isolate & highlight; empty/absent -> normal plot
 * @param {Array|Set} [labelGeneIds] ids (a subset of focus) whose names are drawn
 * @param {'symbol'|'id'} [displayMode='symbol'] how gene names render
 * @param {boolean} [hideNonFocused=false] when isolating, hide the base cloud and
 *   rescale the axes to the focused genes only
 * @param {boolean} [dimNonFocused=false] when isolating, grey out the base cloud.
 *   OFF by default: the focused genes are already set apart by a dark 2.5px border, a
 *   larger symbol and a labelled leader line, so greying the cloud buys emphasis that
 *   is already there and costs the up/down reading of the whole experiment.
 * @returns {object} ECharts option ({} when no data)
 */
export const getGeneVolcanoOptions = (volcanoPlotData, deSettings = {}, focusGeneIds, labelGeneIds, displayMode = 'symbol', hideNonFocused = false, dimNonFocused = false) => {
    if (!volcanoPlotData) return {};

    const focusSet = toSet(focusGeneIds);
    const labelSet = toSet(labelGeneIds);
    const isolate = focusSet.size > 0;
    // Dimming is a property of a VISIBLE non-focused cloud. With nothing focused there
    // is no such cloud, and with `hideNonFocused` it has already been removed — in both
    // cases the flag must be inert, or it would go on suppressing the legend and
    // darkening focused non-significant dots to read against a background that is no
    // longer there. Without the `!hideNonFocused` term the same hide+dim state renders
    // differently depending on which box the user ticked first, and the picker disables
    // the dim box once hiding is on, so they could not tick their way back out.
    const dim = isolate && dimNonFocused && !hideNonFocused;

    const focusGenes = isolate
        ? volcanoPlotData.filter((gene) => focusSet.has(gene.id))
        : [];

    // Lay the chosen names out into staircase rows. `index` is the position within the
    // overlay series' data array, which is exactly the `dataIndex` the labelLayout
    // callback is handed back.
    const labelPoints = focusGenes.reduce((acc, gene, i) => {
        if (labelSet.has(gene.id)) {
            acc.push({
                index: i,
                x: gene.FC,
                y: negLog10(gene.pValue),
                text: displayNameOf(gene, displayMode),
            });
        }
        return acc;
    }, []);
    // Which genes the axes actually range over: "hide non-focused" empties the base
    // cloud, and `type:'value'` axes then re-fit to the overlay alone. Measuring the
    // extent against the full gene list there would badly mis-scale the packing.
    // Skipped entirely when nothing is labelled — it is a pass over every gene.
    const { slotByIndex, hiddenIndices } = assignLabelSlots(
        labelPoints,
        labelPoints.length > 0
            ? plottedExtent((isolate && hideNonFocused) ? focusGenes : volcanoPlotData)
            : {},
    );
    const hiddenSet = new Set(hiddenIndices);

    return {
        ...commonAxes,
        tooltip: commonTooltip,
        series: [
            buildBaseGLSeries(volcanoPlotData, deSettings, isolate, displayMode, hideNonFocused, dim),
            buildFocusOverlaySeries(focusGenes, labelSet, deSettings, displayMode, slotByIndex, hiddenSet, dim),
        ],
        visualMap: buildVisualMap(dim),
        graphic: buildOverflowNote(hiddenIndices.length),
    };
};

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
//   - focus  -> which genes to isolate & highlight. Non-empty focus => "isolate"
//     mode: the base cloud dims to faint grey and the focused genes render bright.
//   - label  -> which of the focused genes get their NAME drawn (a subset the user
//     picks explicitly). Kept separate so "focus the top 100, label only 3" works
//     without the plot drowning in labels.
// `displayMode` ('symbol' | 'id') controls how gene names are rendered everywhere.
//
// IMPORTANT — merge safety: the consumer renders with `<ReactEcharts option=.../>`
// which uses ECharts' default *merge* setOption. So this builder ALWAYS emits the
// same component set (two series + one visualMap) and only toggles their content.
// That way switching modes updates components in place instead of leaving a stale
// visualMap (which would recolour the dimmed cloud) or a stray overlay series
// behind. Do not drop a component in one branch and not the other.

import { classifyGene } from './volcanoGeneSelect';

const CATEGORY = {
    up: { label: 'Up-regulated', index: 0, color: '#FF0000' },
    down: { label: 'Down-regulated', index: 1, color: '#1312FF' },
    nonsig: { label: 'Non-significant', index: 2, color: '#AAAAAA' },
};

// Faint grey the non-focused cloud dims to in isolate mode.
const DIM_COLOR = '#DDDDDD';
// Overlay colour for a focused gene that is itself non-significant — a darker grey
// so it stays visible against the dimmed background (which is near DIM_COLOR).
const OVERLAY_NONSIG_COLOR = '#555555';
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
// (dimension 4) in both modes: full category colours when not isolating, flat
// grey when isolating. In isolate mode it also dims via opacity and shrinks.
const buildBaseGLSeries = (volcanoPlotData, deSettings, isolate, displayMode, hideNonFocused) => ({
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
    itemStyle: { opacity: isolate ? 0.45 : 1 },
    symbolSize: isolate ? 8 : 12,
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
const buildFocusOverlaySeries = (focusGenes, labelSet, deSettings, displayMode) => ({
    name: 'Focused genes',
    type: 'scatter',
    zlevel: 2,
    z: 20,
    // No entry animation: a large focus set ("all up") would otherwise re-animate
    // every point on each rebuild (a displayMode flip, adding one label, etc.).
    animation: false,
    data: focusGenes.map((gene) => {
        const cls = classifyGene(gene, deSettings);
        const showLabel = labelSet.has(gene.id);
        return {
            name: displayNameOf(gene, displayMode),
            value: toValueTuple(gene, cls, displayMode),
            itemStyle: {
                color: cls === 'nonsig' ? OVERLAY_NONSIG_COLOR : CATEGORY[cls].color,
                // Labeled genes get a dark, thicker outline so their dot is easy to
                // spot; the rest keep the plain thin white border.
                borderColor: showLabel ? LABEL_BORDER_COLOR : '#FFFFFF',
                borderWidth: showLabel ? 2.5 : 1.5,
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
    labelLayout: { moveOverlap: 'shiftY' },
    labelLine: { show: true, length2: 5, lineStyle: { color: '#666' } },
    label: {
        show: true,
        formatter: (p) => p.data.name,
        position: 'right',
        minMargin: 4,
        color: '#000',
        fontSize: 12,
    },
});

// The piecewise visualMap. Always present (merge safety) and always scoped to the
// base series (index 0) so it never recolours the overlay. In isolate mode every
// category maps to the dim grey and the legend is hidden.
const buildVisualMap = (isolate) => ({
    type: 'piecewise',
    show: !isolate,
    dimension: 4,
    seriesIndex: 0,
    pieces: isolate
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
 * @returns {object} ECharts option ({} when no data)
 */
export const getGeneVolcanoOptions = (volcanoPlotData, deSettings = {}, focusGeneIds, labelGeneIds, displayMode = 'symbol', hideNonFocused = false) => {
    if (!volcanoPlotData) return {};

    const focusSet = toSet(focusGeneIds);
    const labelSet = toSet(labelGeneIds);
    const isolate = focusSet.size > 0;

    const focusGenes = isolate
        ? volcanoPlotData.filter((gene) => focusSet.has(gene.id))
        : [];

    return {
        ...commonAxes,
        tooltip: commonTooltip,
        series: [
            buildBaseGLSeries(volcanoPlotData, deSettings, isolate, displayMode, hideNonFocused),
            buildFocusOverlaySeries(focusGenes, labelSet, deSettings, displayMode),
        ],
        visualMap: buildVisualMap(isolate),
    };
};

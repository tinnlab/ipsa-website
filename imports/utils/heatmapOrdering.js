// Pure, dependency-free helpers for ordering + remapping the Pathway Heat Map.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported on both client and server — including the server-side Mocha runner.
//
import { metadataValueKey, parseLeadingNumber } from './metadataValues';
//
// The Pathway Heat Map (HeatmapChart.jsx) draws pathways as rows and datasets/analyses as
// columns, with a meta-analysis column and overlaid effect-magnitude circles (ECharts
// markPoint). "Show Dataset Metadata" prepends metadata field rows and can sort columns by a
// metadata value.
//
// This module is the SINGLE SOURCE OF TRUTH for the display order of columns and rows. The
// axis labels, the metadata cells, the pathway cells, and the markpoint circles ALL derive
// their coordinates from the one `columnOrder` / `rowOrder` produced here, so they can never
// diverge (which is what caused: circles landing on metadata rows, the meta column jumping
// sides after sorting, and colors desyncing from row labels after a metadata toggle).
//
// Conventions:
//  - `order` arrays are display -> original: order[displayIdx] = originalIdx.
//  - `posMap` arrays are original -> display: posMap[originalIdx] = displayIdx (or -1 if absent).
//  - The meta-analysis column is ALWAYS placed last (rightmost), in every mode.

// Non-field-value delimiter for metadata color keys — cannot appear in a field name or value,
// so `field`/`value` pairs can never collide the way a printable separator (e.g. ':') could.
const COLOR_KEY_SEP = '\u0000';

// First finite number in a string, or null. Shared with the color/range paths via metadataValues
// so sorting and gradient coloring can never disagree on a value's numeric interpretation. A
// leading '-' counts as a sign only when the number begins the (trimmed) string, so ranges
// ("16-17") stay positive while a genuine negative ("-2.5") keeps its sign.
const firstNumber = parseLeadingNumber;

/**
 * Extract a sortable value from a raw metadata value for a given field. Numeric fields yield a
 * number (so they sort numerically); categorical fields keep their string (alphabetical sort).
 * Mirrors the historical inline logic in HeatmapChart's column-sort block.
 */
export const defaultParseSortValue = (field, rawValue) => {
    if (field === 'Return') {
        if (rawValue === '0') return 0;
        if (String(rawValue).includes('hr')) {
            const n = firstNumber(rawValue);
            return n === null ? 0 : n;
        }
        if (String(rawValue).includes('days')) {
            const n = firstNumber(rawValue);
            return n === null ? 0 : n * 24; // normalize days -> hours
        }
        return rawValue; // unknown Return format: fall back to string ordering
    }
    if (['Radio Sensitivity', 'mGy Exposure', 'μg Exposure (Days)'].includes(field)) {
        const n = firstNumber(rawValue);
        return n === null ? 0 : n;
    }
    return rawValue; // categorical: keep the raw string for alphabetical sorting
};

// Resolve the metadataConfig key for a column. `metadataConfig` is keyed by the analysis DISPLAY
// name, which is free user text and may contain '_' (e.g. "Tumor_vs_Normal"). Splitting the display
// `method` label on '_' therefore truncates the name and misses (or, on a shared prefix, cross-
// assigns) the metadata. When the caller supplies `metadataKeys` (origIdx -> exact display name,
// derived from the raw `${analysisId}_${method}` keys where the split IS safe), use it. Otherwise
// fall back to the legacy split so existing callers/tests keep working.
const metadataKeyFor = (method, origIdx, metadataKeys) => {
    if (metadataKeys && metadataKeys[origIdx] != null) return metadataKeys[origIdx];
    return method.includes('_') ? method.split('_')[0] : method;
};

// True iff `order` is a permutation of 0..count-1 (each index exactly once).
const isPermutationOf = (order, count) => {
    if (!Array.isArray(order) || order.length !== count) return false;
    const seen = new Array(count).fill(false);
    for (const idx of order) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= count || seen[idx]) return false;
        seen[idx] = true;
    }
    return true;
};

// Total, transitive ordering over metadata sort values. Numbers always sort before strings so a
// column that mixes types (e.g. a "Return" field with an unrecognized value) still orders
// deterministically instead of relying on the input permutation.
const compareSortValues = (a, b, dir) => {
    // Only FINITE numbers take the numeric branch; a NaN is treated as a string so it can never
    // make the comparator return NaN (which would give Array.sort an undefined order).
    const aNum = typeof a === 'number' && Number.isFinite(a);
    const bNum = typeof b === 'number' && Number.isFinite(b);
    if (aNum !== bNum) return aNum ? -1 : 1;
    if (aNum) return dir === 'asc' ? a - b : b - a;
    const strA = String(a).toLowerCase();
    const strB = String(b).toLowerCase();
    return dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
};

/**
 * Generic display order (display -> original index) for a list of `count` items: use the given
 * clustering/permutation `order` when it is a valid permutation of 0..count-1, otherwise fall
 * back to identity. The identity fallback is what prevents a stale/length-mismatched order from
 * misplacing items during the multi-effect settle after a filter/sort change. Reused by both the
 * pathway heatmap (rows) and the gene heatmap.
 *
 * @returns {number[]} original indices in display order.
 */
export const buildDisplayOrder = (count, order) => {
    if (isPermutationOf(order, count)) return order.slice();
    return Array.from({ length: count }, (_, i) => i);
};

/**
 * Build the canonical COLUMN order (display -> original analysis index).
 * Applies, in sequence: (1) clustering order, (2) metadata-value sort, (3) meta-analysis last.
 * The meta column is appended last in EVERY mode so it stays rightmost and never jumps.
 *
 * `isMetaColumn` is called as `isMetaColumn(method, originalIndex)`. The index lets a caller detect
 * meta-ness from a side-channel (e.g. the raw analysis key) when the displayed `method` label has
 * been stripped of the info needed to recognize it — value-only predicates keep working since they
 * simply ignore the second argument.
 *
 * @returns {number[]} original analysis indices in display order.
 */
export const buildColumnOrder = ({
    analysisMethods,
    analysisOrder,
    showMetadata,
    sortByMetadata,
    metadataSortOrder = 'asc',
    metadataConfig = {},
    metadataKeys,
    isMetaColumn,
    parseSortValue = defaultParseSortValue,
}) => {
    const n = Array.isArray(analysisMethods) ? analysisMethods.length : 0;
    const isMeta = typeof isMetaColumn === 'function' ? isMetaColumn : () => false;

    // Step 1 — clustering. Use the clustering permutation only when it is a valid permutation
    // of the current columns; otherwise fall back to identity (guards against stale orders).
    let order = isPermutationOf(analysisOrder, n)
        ? analysisOrder.filter((i) => analysisMethods[i] !== undefined)
        : analysisMethods.map((_, i) => i).filter((i) => analysisMethods[i] !== undefined);

    // Step 2 — metadata-value sort (only when metadata is shown AND a field is selected).
    if (showMetadata && sortByMetadata) {
        const decorated = order.map((origIdx) => {
            const method = analysisMethods[origIdx];
            const metadata = metadataConfig[metadataKeyFor(method, origIdx, metadataKeys)];
            const rawValue = metadata ? metadata[sortByMetadata] : undefined;
            const missing = rawValue === undefined || rawValue === null || String(rawValue).trim() === '';
            return { origIdx, missing, value: parseSortValue(sortByMetadata, rawValue) };
        });
        // Datasets missing the sort field always go to the END, regardless of sort direction, so a
        // blank never floats to the top in ascending order.
        decorated.sort((a, b) => {
            if (a.missing !== b.missing) return a.missing ? 1 : -1;
            if (a.missing) return 0;
            return compareSortValues(a.value, b.value, metadataSortOrder);
        });
        order = decorated.map((d) => d.origIdx);
    }

    // Step 3 — meta-analysis columns always last (rightmost), preserving relative order within
    // each group. (yAxis has inverse:true, but that is a ROW concern; columns are never inverted.)
    const regulars = order.filter((i) => !isMeta(analysisMethods[i], i));
    const metas = order.filter((i) => isMeta(analysisMethods[i], i));
    return [...regulars, ...metas];
};

/**
 * Build the canonical ROW order (display -> original pathway index). Thin wrapper over
 * buildDisplayOrder so the pathway heatmap and the gene heatmap share the same guard.
 *
 * @returns {number[]} original pathway indices in display order.
 */
export const buildRowOrder = ({ pathwayCount, pathwayOrder }) => buildDisplayOrder(pathwayCount, pathwayOrder);

/**
 * Invert a display-order array into an original -> display lookup.
 * @returns {number[]} posMap where posMap[originalIdx] = displayIdx, and -1 for absent indices.
 */
export const buildPositionMap = (order) => {
    if (!Array.isArray(order) || order.length === 0) return [];
    // Size the lookup to the largest original index present. Computed with a loop (NOT
    // `Math.max(...order)`, which throws RangeError when spread over a large order array).
    let maxIdx = -1;
    for (const idx of order) {
        if (Number.isInteger(idx) && idx > maxIdx) maxIdx = idx;
    }
    const posMap = new Array(maxIdx + 1).fill(-1);
    order.forEach((origIdx, displayIdx) => {
        if (Number.isInteger(origIdx) && origIdx >= 0) posMap[origIdx] = displayIdx;
    });
    return posMap;
};

const lookup = (posMap, idx) => {
    const v = posMap[idx];
    return v === undefined ? -1 : v;
};

// Rows occupied by the metadata band above the pathway rows (0 when metadata is hidden). Coerces
// a missing/NaN count to 0 so a bad caller can never turn a row index into NaN.
const rowOffset = (metadataRowCount, showMetadata) =>
    showMetadata ? (Number(metadataRowCount) || 0) : 0;

/**
 * Remap one pathway plot point [analysisIdx, pathwayIdx, value, pValueFDR, score] into display
 * coordinates. Returns null when either coordinate has no display position, so an unplaceable
 * cell is dropped rather than silently landing at a wrong (e.g. -1 + offset) location.
 */
export const remapPlotPoint = (point, colPosMap, rowPosMap, metadataRowCount, showMetadata) => {
    const [analysisIdx, pathwayIdx, value, pValueFDR, score] = point;
    const newCol = lookup(colPosMap, analysisIdx);
    const newRow = lookup(rowPosMap, pathwayIdx);
    if (newCol < 0 || newRow < 0) return null;
    return [newCol, newRow + rowOffset(metadataRowCount, showMetadata), value, pValueFDR, score];
};

/**
 * Remap one markpoint (effect-magnitude circle) {xAxis, yAxis, ...} into display coordinates.
 * Returns null when either coordinate has no display position — this is what stops circles from
 * being drawn over metadata rows when their pathway cell can't be placed.
 */
export const remapMarkPoint = (mp, colPosMap, rowPosMap, metadataRowCount, showMetadata) => {
    const newCol = lookup(colPosMap, mp.xAxis);
    const newRow = lookup(rowPosMap, mp.yAxis);
    if (newCol < 0 || newRow < 0) return null;
    return { ...mp, xAxis: newCol, yAxis: newRow + rowOffset(metadataRowCount, showMetadata) };
};

/**
 * Remap one effect-magnitude circle {xAxis, yAxis, symbolSize, itemStyle, pValueFDR, score} into a
 * SCATTER-series datum whose `value` is [displayCol, displayRow]. Unlike the markpoint variant, the
 * result rides on the same category grid as the pathway cells, so it lands exactly on its cell
 * (respecting yAxis inverse + the metadata-row offset) and is reliably hoverable — which is what
 * makes non-significant cells inspectable. Returns null when either coordinate has no display
 * position, so an unplaceable circle is dropped rather than landing in the metadata band. The
 * FDR/score payload rides along so the tooltip can show it even on non-significant cells.
 */
export const remapScatterPoint = (pt, colPosMap, rowPosMap, metadataRowCount, showMetadata) => {
    const newCol = lookup(colPosMap, pt.xAxis);
    const newRow = lookup(rowPosMap, pt.yAxis);
    if (newCol < 0 || newRow < 0) return null;
    return {
        value: [newCol, newRow + rowOffset(metadataRowCount, showMetadata)],
        symbolSize: pt.symbolSize,
        itemStyle: pt.itemStyle,
        pValueFDR: pt.pValueFDR,
        score: pt.score,
    };
};

/**
 * Build metadata-cell plot data driven by the SAME columnOrder as the pathway cells, so metadata
 * and pathway columns can never disagree. Each cell is
 * [displayCol, fieldIdx, color, rawValue, fieldName] — the resolved color is baked in per cell so
 * the metadata band can render as a `custom` series WITHOUT its own visualMap. (That matters: a
 * second visualMap alongside the pathway one collapses the pathway gradient on the canvas renderer
 * when metadata is shown.) `colorMap` (colorKey -> color) is returned for any callers that want the
 * distinct field/value colors.
 */
export const buildMetadataPlotData = ({
    columnOrder,
    analysisMethods,
    metadataFields,
    metadataConfig = {},
    metadataKeys,
    getMetadataColor,
}) => {
    const data = [];
    const colorMap = {};
    const colorFor = typeof getMetadataColor === 'function' ? getMetadataColor : () => '#EEEEEE';

    columnOrder.forEach((origIdx, displayCol) => {
        const method = analysisMethods[origIdx];
        const metadata = metadataConfig[metadataKeyFor(method, origIdx, metadataKeys)];
        if (!metadata) return;
        metadataFields.forEach((field, fieldIdx) => {
            // `?? ''` (not `|| ''`) so a legitimate 0 / false survives instead of reading as missing.
            const value = metadata[field] ?? '';
            // Normalize the value in the cache key so casing variants ("female"/"Female") share one
            // color entry. The displayed `value` pushed below stays original.
            const colorKey = `${field}${COLOR_KEY_SEP}${metadataValueKey(value)}`;
            if (!colorMap[colorKey]) {
                colorMap[colorKey] = colorFor(field, value);
            }
            data.push([displayCol, fieldIdx, colorMap[colorKey], value, field]);
        });
    });

    return { data, colorMap };
};

/**
 * Assemble the ordered axis labels. Metadata fields precede the (row-ordered) pathway names on
 * the y-axis when metadata is shown, matching the +metadataRowCount offset used for cells.
 */
export const buildAxisLabels = ({
    columnOrder,
    analysisMethods,
    rowOrder,
    pathwayNames,
    metadataFields,
    showMetadata,
}) => {
    const xLabels = columnOrder.map((i) => analysisMethods[i]);
    const orderedPathwayNames = rowOrder.map((i) => pathwayNames[i]);
    const yLabels = showMetadata ? [...metadataFields, ...orderedPathwayNames] : orderedPathwayNames;
    return { xLabels, yLabels, orderedPathwayNames };
};

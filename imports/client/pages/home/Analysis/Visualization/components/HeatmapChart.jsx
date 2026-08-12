import React, {useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback} from "react";
import ReactEcharts from "echarts-for-react";
import EchartsWrapper from './EchartsWrapper';
import GeneLoading from "../../../../../components/GeneLoading";
import {agnes} from 'ml-hclust';
import {Checkbox, Select, Space, Typography, Divider, Radio, InputNumber, Button, Input, Dropdown, Menu, Spin, Alert} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";
import {
    buildColumnOrder,
    buildRowOrder,
    buildPositionMap,
    remapPlotPoint,
    remapMarkPoint,
    remapScatterPoint,
    buildMetadataPlotData,
    buildAxisLabels,
} from "../../../../../../utils/heatmapOrdering";
import { metadataValueKey, dedupeMetadataValues, parseLeadingNumber, canonicalizeMetadataConfig, classifyMetadataValues } from "../../../../../../utils/metadataValues";
import { selectPathways, SELECTION_MODES, PATHWAY_COLUMNS } from "../../../../../../utils/pathwaySelection";
import { buildPathwayResultCsv } from "../../../../../../utils/pathwayResultCsv";
import PathwaySelectionTable from "./PathwaySelectionTable";
import _ from "lodash";

const {Text} = Typography;
const {Option} = Select;

// How the effect-magnitude circles are drawn on the Pathway Heat Map:
//   'scatter'   — a real series sharing the cells' category grid: dots land exactly on their cell
//                 (never on metadata rows) and every cell — significant or not — is hoverable.
//   'markPoint' — legacy overlay layer; placement drifts onto metadata rows and hover is unreliable.
// This is the single switch to revert the scatter change; nothing else needs to change.
const EFFECT_MAGNITUDE_MODE = 'scatter';

// DEPRECATED: Hardcoded metadata config - now replaced by dynamic analysesMetadata prop
// This is kept as a reference for backward compatibility but is no longer used
/*
const METADATA_CONFIG = {
    'OSD-352': {
        'Radio Sensitivity': '5',
        'mGy Exposure': '8.97',
        'μg Exposure (Days)': '39-41',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'BALB/c',
        'Age': '12 w weeks',
        'Mission/Identifier': 'RR-3',
        'Tissue': 'Whole Brain (B)'
    },
    'OSD-326': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '5.082-5.808',
        'μg Exposure (Days)': '21-24',
        'Return': '0',
        'Sex': 'M',
        'Strain': 'C57BL/6J',
        'Age': '9 w weeks',
        'Mission/Identifier': 'RR-4',
        'Tissue': 'Muscle (Q)'
    },
    'OSD-103': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '7.752',
        'μg Exposure (Days)': '37',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'C57BL/6J',
        'Age': '16 w weeks',
        'Mission/Identifier': 'RR-1',
        'Tissue': 'Muscle (Q)'
    },
    'OSD-101': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '7.752',
        'μg Exposure (Days)': '37',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'C57BL/6J',
        'Age': '16 w weeks',
        'Mission/Identifier': 'RR-1',
        'Tissue': 'Muscle (G)'
    },
    'OSD-105': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '7.752',
        'μg Exposure (Days)': '38',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'C57BL/6J',
        'Age': '16 w weeks',
        'Mission/Identifier': 'RR-1',
        'Tissue': 'Muscle (TA)'
    },
    'OSD-99': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '7.752',
        'μg Exposure (Days)': '37',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'C57BL/6J',
        'Age': '16 w weeks',
        'Mission/Identifier': 'RR-1',
        'Tissue': 'Muscle (EDL)'
    },
    'OSD-104': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '7.752',
        'μg Exposure (Days)': '37',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'C57BL/6J',
        'Age': '16 w weeks',
        'Mission/Identifier': 'RR-1',
        'Tissue': 'Muscle (S)'
    },
    'OSD-401-Q': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '16.286',
        'μg Exposure (Days)': '63',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'BALB/c',
        'Age': '30 w weeks',
        'Mission/Identifier': 'RR-5',
        'Tissue': 'Muscle (Q)'
    },
    'OSD-401-G': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '16.286',
        'μg Exposure (Days)': '63',
        'Return': '0',
        'Sex': 'F',
        'Strain': 'BALB/c',
        'Age': '30 w weeks',
        'Mission/Identifier': 'RR-5',
        'Tissue': 'Muscle (G)'
    },
    'OSD-21': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '2.58',
        'μg Exposure (Days)': '11.83',
        'Return': '3.5 hr',
        'Sex': 'F',
        'Strain': 'C57BL6N',
        'Age': '9.3 w weeks',
        'Mission/Identifier': 'STS-108',
        'Tissue': 'Muscle (G)'
    },
    'OSD-576': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '13.135',
        'μg Exposure (Days)': '37',
        'Return': '1 days',
        'Sex': 'M',
        'Strain': 'C57BL6N',
        'Age': '16-17 w weeks',
        'Mission/Identifier': 'RR-23',
        'Tissue': 'Muscle (TA)'
    },
    'OSD-111-EDL': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '30.07',
        'μg Exposure (Days)': '29.85',
        'Return': '1 days',
        'Sex': 'M',
        'Strain': 'C57BL6N',
        'Age': '19-20 w weeks',
        'Mission/Identifier': 'BION-M1',
        'Tissue': 'Muscle (EDL)'
    },
    'OSD-111-S': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '30.07',
        'μg Exposure (Days)': '29.85',
        'Return': '1 days',
        'Sex': 'M',
        'Strain': 'C57BL6N',
        'Age': '19-20 w weeks',
        'Mission/Identifier': 'BION-M1',
        'Tissue': 'Muscle (S)'
    },
    'OSD-135-B': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '30.07',
        'μg Exposure (Days)': '29.85',
        'Return': '1 days',
        'Sex': 'M',
        'Strain': 'C57BL6N',
        'Age': '19-20 w weeks',
        'Mission/Identifier': 'BION-M1',
        'Tissue': 'Muscle (B)'
    },
    'OSD-135-T': {
        'Radio Sensitivity': '4',
        'mGy Exposure': '30.07',
        'μg Exposure (Days)': '29.85',
        'Return': '1 days',
        'Sex': 'M',
        'Strain': 'C57BL6N',
        'Age': '19-20 w weeks',
        'Mission/Identifier': 'BION-M1',
        'Tissue': 'Muscle (T)'
    }
};
*/

// DEPRECATED: Hardcoded metadata fields - now dynamically discovered from metadata
// This is kept as a reference but is replaced by dynamic field discovery in the component
/*
const METADATA_FIELDS = [
    'Radio Sensitivity',
    'mGy Exposure',
    'μg Exposure (Days)',
    'Return',
    'Sex',
    'Strain',
    'Age',
    'Mission/Identifier',
    'Tissue'
];
*/

// Color palettes for categorical metadata
const METADATA_COLORS = {
    'Radio Sensitivity': {'4': '#4A90E2', '5': '#E24A4A'},
    'Sex': {'M': '#5DADE2', 'F': '#EC7063'},
    'Strain': {
        'C57BL/6J': '#52C41A',
        'C57BL6N': '#1890FF'
    },
    'Return': {
        '0': '#D9D9D9',
        '3.5 hr': '#FFD666',
        '1 days': '#FFA940'
    },
    'Mission/Identifier': {
        'RR-1': '#52C41A',
        'RR-4': '#FA8C16',
        'STS-108': '#1890FF',
        'RR-23': '#9B59B6',
        'BION-M1': '#E74C3C'
    },
    'Tissue': '#FFFFFF' // White background (no color) for Tissue - just display text
};

// Default gradient colors for continuous fields
const DEFAULT_GRADIENT_COLORS = {
    'mGy Exposure': {start: '#FFF3E0', end: '#FB8C00'},
    'μg Exposure (Days)': {start: '#FFF9C4', end: '#FDD835'},
    'Age': {start: '#F3E5F5', end: '#8E24AA'}
};

// Helper function to generate gradient steps from start/end colors
const generateGradient = (startColor, endColor, steps = 5) => {
    // Parse hex colors to RGB
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    };

    const rgbToHex = (r, g, b) => {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };

    const start = hexToRgb(startColor);
    const end = hexToRgb(endColor);

    if (!start || !end) return [startColor, endColor];

    const gradient = [];
    for (let i = 0; i < steps; i++) {
        const ratio = i / (steps - 1);
        const r = Math.round(start.r + ratio * (end.r - start.r));
        const g = Math.round(start.g + ratio * (end.g - start.g));
        const b = Math.round(start.b + ratio * (end.b - start.b));
        gradient.push(rgbToHex(r, g, b));
    }

    return gradient;
};

// Color palette for auto-assigning categorical fields
const AUTO_CATEGORICAL_COLORS = [
    ['#52C41A', '#1890FF', '#FA8C16', '#9B59B6', '#E74C3C'],
    ['#5DADE2', '#EC7063', '#48C9B0', '#F4D03F', '#AF7AC5'],
    ['#85C1E2', '#F1948A', '#73C6B6', '#F7DC6F', '#BB8FCE'],
    ['#AED6F1', '#F5B7B1', '#A2D9CE', '#FAE5CD', '#D7BDE2'],
    ['#3498DB', '#E67E22', '#16A085', '#F39C12', '#8E44AD']
];

// Helper function to dynamically detect field type from actual metadata values
// Stable, order-independent hash of a string into [0, mod). Used to pick a categorical palette per
// field NAME so a field's colors are deterministic and never reshuffle when other fields are added
// or when the legend/cells/config compute colors in a different order.
const hashStringToIndex = (str, mod) => {
    let h = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return mod > 0 ? Math.abs(h) % mod : 0;
};

// The "no color" swatch: white background for cells that should show text only (text fields) or
// that have no position on a gradient (missing/blank/non-numeric value in a numeric field). Kept as
// an explicit constant so this behavior does NOT depend on the color config of the 'Tissue' field.
const NO_COLOR = '#FFFFFF';

const detectFieldType = (fieldName, metadataConfig) => {
    // Special case: fields that should display as text
    if (fieldName === 'Tissue' || fieldName === 'Dataset' || fieldName === 'datasetId') {
        return 'text';
    }

    // Check if already defined in hardcoded configs
    if (DEFAULT_GRADIENT_COLORS[fieldName]) return 'gradient';
    if (METADATA_COLORS[fieldName] && typeof METADATA_COLORS[fieldName] === 'object') return 'categorical';

    // Dynamic detection from the values. classifyMetadataValues is the single, unit-tested rule:
    // mostly-numeric with enough distinct values -> gradient; a few-value numeric (e.g. 0/1 flag) or
    // 2..10 distinct values -> categorical; otherwise text.
    const values = [];
    Object.values(metadataConfig).forEach(metadata => {
        const value = metadata[fieldName];
        if (value !== undefined && value !== null && value !== '') {
            values.push(String(value));
        }
    });

    return classifyMetadataValues(values);
};

// Helper function to calculate numeric ranges for gradient fields (now supports dynamic fields)
const calculateGradientRanges = (metadataConfig, allFields) => {
    const ranges = {};

    // Check all fields, not just hardcoded ones
    allFields.forEach(fieldName => {
        const values = [];
        Object.values(metadataConfig).forEach(metadata => {
            // Sign-aware, shared extractor (handles "16 w weeks", "-2.5", keeps a real 0).
            const n = parseLeadingNumber(metadata[fieldName]);
            if (n !== null) values.push(n);
        });

        if (values.length > 0) {
            ranges[fieldName] = {
                min: Math.min(...values),
                max: Math.max(...values)
            };
        }
    });

    return ranges;
};

export default ({analysisResultsByDb, selectedAnalysisMethods, analysisNames, configs, dbId, analysesMetadata = {}}) => {
    let [plotData, setPlotData] = useState([])
    let [markPointScoreData, setMarkPointScoreData] = useState([])
    let [pathwayNames, setPathwayNames] = useState([])
    let [analysisMethods, setAnalysisMethods] = useState([])
    // Raw `${analysisId}_${methodName}` keys, index-aligned with `analysisMethods` (which holds the
    // DISPLAY labels). The display label drops the method suffix when a single non-meta method is
    // used, so meta-column detection must fall back to these raw keys — see isMetaColumn below.
    let [analysisMethodKeys, setAnalysisMethodKeys] = useState([])
    const [initialDataLoaded, setInitialDataLoaded] = useState(false);
    const chartRef = useRef(null);
    const chartHostRef = useRef(null);

    // Build metadata config from passed analysesMetadata (replaces hardcoded METADATA_CONFIG).
    // Canonicalize field NAMES so case/whitespace variants across datasets ("Sex"/"sex") collapse to
    // a single field — otherwise the same concept renders as two half-blank metadata rows.
    const metadataConfig = useMemo(() => {
        console.log('[HeatmapChart] Building metadata config from', Object.keys(analysesMetadata).length, 'analyses');
        return canonicalizeMetadataConfig(analysesMetadata);
    }, [analysesMetadata]);

    // Dynamically discover all unique metadata fields (replaces hardcoded METADATA_FIELDS)
    const METADATA_FIELDS = useMemo(() => {
        const fieldsSet = new Set();

        Object.values(metadataConfig).forEach(metadata => {
            Object.keys(metadata).forEach(field => fieldsSet.add(field));
        });

        // Prioritize common fields first, then alphabetical
        const commonFields = [
            'datasetId', 'organism', 'tissue', 'disease', 'treatment', 'condition',
            'age', 'sex', 'strain', 'platform', 'cellType', 'genotype'
        ];

        const allFields = Array.from(fieldsSet);
        const orderedFields = [
            ...commonFields.filter(f => allFields.includes(f)),
            ...allFields.filter(f => !commonFields.includes(f)).sort()
        ];

        console.log('[HeatmapChart] Discovered', orderedFields.length, 'metadata fields:', orderedFields);
        return orderedFields;
    }, [metadataConfig]);

    // Get global settings
    const { globalSettings } = useGlobalSettings();

    // Filtering state - simplified approach using reference analysis
    const [enableSignificantFilter, setEnableSignificantFilter] = useState(true)
    const [referenceAnalysis, setReferenceAnalysis] = useState(null) // Auto-detected on first render
    const [significanceMetric, setSignificanceMetric] = useState('fdr') // 'pvalue', 'fdr', or 'score'
    const [threshold, setThreshold] = useState(globalSettings.pValueFDR)
    const [topN, setTopN] = useState(20)
    const [excludedAnalyses, setExcludedAnalyses] = useState([]) // Track analyses with no significant pathways
    const [sortBy, setSortBy] = useState('fdr') // 'pvalue', 'fdr', or 'score'
    const [sortOrder, setSortOrder] = useState('asc') // 'asc' or 'desc'
    const [filteredPathwaysCount, setFilteredPathwaysCount] = useState(0)
    const [customThresholdInput, setCustomThresholdInput] = useState('')
    const [customTopNInput, setCustomTopNInput] = useState('')
    // Pathway selection table: `allPathways` is EVERY pathway in the DB (reference-analysis metrics
    // + dataByAnalysis) for the picker; `selectedPathwayIds` is the checked set that drives exactly
    // which pathways the heatmap renders. It is seeded from "Top N by reference" and then freely
    // edited via the table. `pathwaySeedSig` tracks the filter inputs so we only re-seed (reset the
    // checks to the new Top-N) when a filter control changes, never on a manual check/uncheck.
    const [allPathways, setAllPathways] = useState([])
    const [selectedPathwayIds, setSelectedPathwayIds] = useState(null)
    const pathwaySeedSig = useRef(null)

    // Clustering state
    const [enableClustering, setEnableClustering] = useState(false)
    const [clusteringMethod, setClusteringMethod] = useState('ward')
    const [distanceMetric, setDistanceMetric] = useState('euclidean')
    const [clusterColumns, setClusterColumns] = useState(false)
    const [pathwayOrder, setPathwayOrder] = useState([])
    const [analysisOrder, setAnalysisOrder] = useState([])
    const [rawPathwayScores, setRawPathwayScores] = useState([])

    // Metadata display state
    const [showMetadata, setShowMetadata] = useState(false)
    const [sortByMetadata, setSortByMetadata] = useState(null) // Selected metadata field to sort by
    const [metadataSortOrder, setMetadataSortOrder] = useState('asc') // 'asc' or 'desc'
    // Which metadata rows to display. null = show all (the default); otherwise a list of the
    // fields the user chose to keep visible.
    const [visibleMetadataFields, setVisibleMetadataFields] = useState(null)

    // The metadata fields actually rendered as rows: all of them by default, or the user's chosen
    // subset (kept in METADATA_FIELDS order, and intersected with the currently-discovered fields
    // so a stale selection can never reference a field that no longer exists). Declared AFTER
    // visibleMetadataFields so it never reads that state inside the temporal dead zone.
    const shownMetadataFields = useMemo(() => {
        if (!visibleMetadataFields) return METADATA_FIELDS;
        return METADATA_FIELDS.filter(field => visibleMetadataFields.includes(field));
    }, [METADATA_FIELDS, visibleMetadataFields]);

    // Color customization state. Persistence is SCOPED to this heatmap's gene-set DB so a color
    // chosen on one heatmap doesn't bleed into another (the keys used to be global constants).
    const colorStorageKey = `heatmap_custom_colors:${dbId}`;
    const gradientStorageKey = `heatmap_custom_gradients:${dbId}`;
    // Guarded load: a corrupt/legacy blob (interrupted write, old schema, tampering) must return {}
    // rather than throw inside render and take down the whole heatmap.
    const loadStoredMap = (key) => {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(key));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const [isEditingColors, setIsEditingColors] = useState(false)
    const [customColors, setCustomColors] = useState(() => loadStoredMap(colorStorageKey))
    const [customGradients, setCustomGradients] = useState(() => loadStoredMap(gradientStorageKey))
    // Auto-generated categorical colors for every field, precomputed PURELY (no setState during
    // render). Keyed by field name; each field's palette is chosen by a stable hash of its name and
    // its value->color map is keyed by the normalized value. Deriving this in a memo (instead of the
    // old lazy setState-in-render) makes colors deterministic and avoids extra render passes.
    const autoGeneratedColors = useMemo(() => {
        const result = {};
        METADATA_FIELDS.forEach(fieldName => {
            const rawValues = [];
            Object.values(metadataConfig).forEach(metadata => {
                const value = metadata[fieldName];
                if (value !== undefined && value !== null && value !== '') {
                    rawValues.push(value);
                }
            });
            const values = dedupeMetadataValues(rawValues).sort();
            if (values.length === 0) return;
            const palette = AUTO_CATEGORICAL_COLORS[hashStringToIndex(fieldName, AUTO_CATEGORICAL_COLORS.length)];
            const colors = {};
            values.forEach((value, index) => {
                colors[metadataValueKey(value)] = palette[index % palette.length];
            });
            result[fieldName] = colors;
        });
        return result;
    }, [metadataConfig, METADATA_FIELDS]);

    // Reload persisted CUSTOM colors when the heatmap's DB changes. The component is NOT remounted on
    // a dbId change, so without this it would keep showing the previous DB's colors. Skip the first
    // run — the useState initializers above already loaded the initial DB. (Auto colors need no reset
    // here: they derive purely from metadataConfig via the memo above.)
    const didInitColorStorage = useRef(false);
    useEffect(() => {
        if (!didInitColorStorage.current) { didInitColorStorage.current = true; return; }
        setCustomColors(loadStoredMap(colorStorageKey));
        setCustomGradients(loadStoredMap(gradientStorageKey));
    }, [dbId]);

    // Save custom colors to session storage (per-DB key; NOT keyed on dbId so switching DBs never
    // writes the old DB's colors under the new DB's key — the reload effect above handles switches).
    useEffect(() => {
        sessionStorage.setItem(colorStorageKey, JSON.stringify(customColors));
    }, [customColors]);

    useEffect(() => {
        sessionStorage.setItem(gradientStorageKey, JSON.stringify(customGradients));
    }, [customGradients]);

    // Pure reader: custom override -> hardcoded palette -> precomputed auto colors -> {} (empty for
    // gradient/text fields, which don't use a categorical map). No side effects.
    const getOrCreateColors = useCallback((fieldName) => {
        if (customColors[fieldName]) return customColors[fieldName];
        if (METADATA_COLORS[fieldName]) return METADATA_COLORS[fieldName];
        return autoGeneratedColors[fieldName] || {};
    }, [customColors, autoGeneratedColors]);

    // Helper to get or create gradient for numeric fields
    const getOrCreateGradient = useCallback((fieldName) => {
        // Check custom gradients first
        if (customGradients[fieldName]) return customGradients[fieldName];

        // Check hardcoded gradients
        if (DEFAULT_GRADIENT_COLORS[fieldName]) return DEFAULT_GRADIENT_COLORS[fieldName];

        // Return default gradient for new fields
        return {start: '#E3F2FD', end: '#1976D2'}; // Blue gradient
    }, [customGradients]);

    // Wrapper functions for backward compatibility
    const getCurrentColors = (fieldName) => getOrCreateColors(fieldName);
    const getCurrentGradient = (fieldName) => getOrCreateGradient(fieldName);

    const resetToDefaults = () => {
        setCustomColors({});
        setCustomGradients({});
        // Auto colors need no clearing: they derive purely from metadataConfig (the memo), so
        // clearing the custom overrides above already restores the auto defaults.
        sessionStorage.removeItem(colorStorageKey);
        sessionStorage.removeItem(gradientStorageKey);
    };

    // Helper function to generate SVG content for legend
    const generateLegendSVG = (bgColor = '#FAFAFA', singleColumn = false) => {
        // SVG dimensions and layout configuration
        const padding = 20;
        const swatchSize = 16;
        const gradientSwatchWidth = 20;
        const gradientSwatchHeight = 16;

        // Calculate gradient ranges
        const gradientRanges = calculateGradientRanges(metadataConfig, METADATA_FIELDS);

        // Get filtered fields using dynamic detection (only the metadata rows currently shown)
        const filteredFields = shownMetadataFields.filter(fieldName => detectFieldType(fieldName, metadataConfig) !== 'text');

        let svgWidth, svgHeight, columnWidth, columnGap, rowHeight;

        if (singleColumn) {
            // Single column layout for PNG export
            svgWidth = 400;
            rowHeight = 70; // Height per field
            svgHeight = padding + 40 + (filteredFields.length * rowHeight) + padding;
            columnWidth = svgWidth - padding * 2;
            columnGap = 0;
        } else {
            // Original 3-column layout
            svgWidth = 1200;
            svgHeight = 800;
            columnGap = 30;
            columnWidth = (svgWidth - padding * 2 - columnGap * 2) / 3;
            rowHeight = 60;
        }

        let yOffset = padding + 40; // Start below title
        let xOffset = padding;
        let columnIndex = 0;

        // Start SVG
        let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
    <!-- Background -->
    <rect width="${svgWidth}" height="${svgHeight}" fill="${bgColor}"/>

    <!-- Title -->
    <text x="${svgWidth / 2}" y="30" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#333">
        Metadata Color Legend
    </text>
`;

        // Loop through each metadata field (exclude text-only fields)
        filteredFields.forEach((fieldName, index) => {
            const fieldType = detectFieldType(fieldName, metadataConfig);

            // Field title
            svgContent += `
    <text x="${xOffset}" y="${yOffset}" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#333">
        ${fieldName}
    </text>`;

            let itemYOffset = yOffset + 15;

            if (fieldType === 'gradient') {
                const gradient = getCurrentGradient(fieldName);
                const gradientColors = generateGradient(gradient.start, gradient.end, 5);
                const range = gradientRanges[fieldName];

                // Draw gradient swatches
                gradientColors.forEach((color, i) => {
                    svgContent += `
    <rect x="${xOffset + i * gradientSwatchWidth}" y="${itemYOffset}" width="${gradientSwatchWidth}" height="${gradientSwatchHeight}" fill="${color}" stroke="#ddd" stroke-width="1"/>`;
                });

                // Display "Low → High" label
                svgContent += `
    <text x="${xOffset + gradientColors.length * gradientSwatchWidth + 6}" y="${itemYOffset + 12}" font-family="Arial, sans-serif" font-size="11" fill="#666">
        Low → High
    </text>`;

                // Add numeric value labels below each gradient block
                if (range) {
                    gradientColors.forEach((color, i) => {
                        const value = range.min + (i / (gradientColors.length - 1)) * (range.max - range.min);
                        const labelX = xOffset + i * gradientSwatchWidth + gradientSwatchWidth / 2;
                        svgContent += `
    <text x="${labelX}" y="${itemYOffset + gradientSwatchHeight + 12}" font-family="Arial, sans-serif" font-size="9" fill="#666" text-anchor="middle">
        ${value.toFixed(1)}
    </text>`;
                    });
                }
            } else if (fieldType === 'categorical') {
                const colors = getCurrentColors(fieldName);
                let itemXOffset = xOffset;
                const colorEntries = Object.entries(colors);
                const itemsPerRow = singleColumn && colorEntries.length > 3 ? 3 : colorEntries.length;

                colorEntries.forEach(([value, color], i) => {
                    // Calculate text width (approximate: 6 pixels per character for 11px font)
                    const textWidth = value.length * 6;
                    const itemWidth = swatchSize + 4 + textWidth + 8; // swatch + gap + text + spacing

                    svgContent += `
    <rect x="${itemXOffset}" y="${itemYOffset}" width="${swatchSize}" height="${swatchSize}" fill="${color}" stroke="#ddd" stroke-width="1"/>
    <text x="${itemXOffset + swatchSize + 4}" y="${itemYOffset + 12}" font-family="Arial, sans-serif" font-size="11" fill="#333">
        ${value}
    </text>`;
                    itemXOffset += itemWidth;

                    // Wrap to next line: for single column with >3 items, wrap every 3 items
                    // Otherwise wrap if next item would overflow
                    const shouldWrap = singleColumn && colorEntries.length > 3
                        ? (i + 1) % itemsPerRow === 0 && i < colorEntries.length - 1
                        : itemXOffset + 80 > xOffset + columnWidth;

                    if (shouldWrap) {
                        itemXOffset = xOffset;
                        itemYOffset += 25;
                    }
                });
            }

            // Move to next position
            if (singleColumn) {
                // Single column: always move down
                yOffset += rowHeight;
            } else {
                // 3-column layout: move to next column
                columnIndex++;
                if (columnIndex >= 3) {
                    columnIndex = 0;
                    xOffset = padding;
                    yOffset += rowHeight;
                } else {
                    xOffset += columnWidth + columnGap;
                }
            }
        });

        svgContent += `
</svg>`;

        return svgContent;
    };

    const exportLegendAsSVG = () => {
        const svgContent = generateLegendSVG('#FAFAFA');

        // Create blob and download
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'metadata-legend.svg';
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportLegendAsPNG = () => {
        // Use single column layout for PNG export
        const svgContent = generateLegendSVG('#FFFFFF', true); // White background, single column
        const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
            // Create canvas with 4x resolution
            const scale = 4;
            const canvas = document.createElement('canvas');

            // Calculate dynamic dimensions based on number of fields (only the rows currently shown)
            const filteredFields = shownMetadataFields.filter(fieldName => detectFieldType(fieldName, metadataConfig) !== 'text');
            const padding = 20;
            const rowHeight = 70;
            const svgWidth = 400;
            const svgHeight = padding + 40 + (filteredFields.length * rowHeight) + padding;

            canvas.width = svgWidth * scale;
            canvas.height = svgHeight * scale;

            const ctx = canvas.getContext('2d');

            // Fill with white background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Scale and draw the image
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0);

            // Export as PNG
            canvas.toBlob((blob) => {
                const pngUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = pngUrl;
                link.download = 'metadata-legend.png';
                link.click();

                URL.revokeObjectURL(pngUrl);
                URL.revokeObjectURL(url);
            }, 'image/png');
        };

        img.src = url;
    };

    // Sync with global settings when they change
    useEffect(() => {
        // Only sync for FDR (p-value uses same threshold values)
        if (significanceMetric === 'fdr') {
            setThreshold(globalSettings.pValueFDR);
        }
    }, [globalSettings, significanceMetric]);

    // Debounced handlers for custom input fields
    const debouncedSetThreshold = useCallback(
        _.debounce((value) => setThreshold(value), 500),
        []
    );

    const debouncedSetTopN = useCallback(
        _.debounce((value) => setTopN(value), 500),
        []
    );

    const options = useMemo(() => {
        // Predicate: is this analysis column a meta-analysis? Detect from the RAW analysis key
        // (index-aligned via analysisMethodKeys), because the DISPLAY label passed as `method` drops
        // the method suffix when only one non-meta method is present — so '_meta' can't be seen in it
        // and the meta column would sort into the middle after a metadata sort. Falls back to the
        // display-label heuristic if the raw key is unavailable (e.g. a transient render mismatch).
        const isMetaColumn = (method, index) => {
            const rawKey = analysisMethodKeys[index];
            if (rawKey) {
                const analysisId = rawKey.split('_')[0];
                const methodName = rawKey.split('_')[1];
                if (analysisNames[analysisId]?.input === 'meta' || methodName === 'meta') return true;
            }
            if (!method) return false;
            const displayId = method.includes('_') ? method.split('_')[0] : method;
            return analysisNames[displayId]?.input === 'meta' || method.includes('_meta');
        };

        // Single canonical column + row order — the ONE source of truth that axis labels,
        // metadata cells, pathway cells, and markpoints all derive from. This eliminates the
        // desync that made circles land on metadata rows (bug 1), the meta column jump sides
        // after sorting (bug 2), and colors drift from row labels after toggling metadata (bug 3).
        // See imports/utils/heatmapOrdering.js. Meta stays rightmost in every mode.
        // Correct metadataConfig key per column: the analysis DISPLAY name. Derived from the raw
        // `${analysisId}_${method}` keys (splitting on '_' is safe there — analysisId has no '_'),
        // NOT from the display label, which may itself contain '_' (e.g. "Tumor_vs_Normal") and
        // would truncate the name — dropping or cross-assigning that column's metadata.
        const metadataKeys = analysisMethodKeys.map(rawKey => {
            const analysisId = String(rawKey).split('_')[0];
            return analysisNames[analysisId]?.name;
        });

        // Sort numeric (gradient) metadata fields numerically, everything else as strings. Without a
        // type hint a numeric field sorts lexically ("10" < "2"). detectFieldType is the same
        // classifier the legend/coloring use, so column sort stays consistent with them.
        const parseSortValueForField = (field, rawValue) => {
            if (detectFieldType(field, metadataConfig) === 'gradient') {
                const n = parseLeadingNumber(rawValue);
                return n === null ? '' : n;
            }
            return rawValue ?? '';
        };

        const columnOrder = buildColumnOrder({
            analysisMethods,
            analysisOrder,
            showMetadata,
            sortByMetadata,
            metadataSortOrder,
            metadataConfig,
            metadataKeys,
            isMetaColumn,
            parseSortValue: parseSortValueForField,
        });
        const rowOrder = buildRowOrder({ pathwayCount: pathwayNames.length, pathwayOrder });
        const colPosMap = buildPositionMap(columnOrder);
        const rowPosMap = buildPositionMap(rowOrder);
        const metadataRowCount = showMetadata ? shownMetadataFields.length : 0;

        const { xLabels: orderedXAxisLabels, yLabels: orderedYAxisLabels } = buildAxisLabels({
            columnOrder,
            analysisMethods,
            rowOrder,
            pathwayNames,
            metadataFields: shownMetadataFields,
            showMetadata,
        });

        // Numeric (gradient) metadata fields — detected dynamically so the CELL coloring stays
        // consistent with the legend and the color-config panel (both classify via detectFieldType).
        // A hardcoded name list previously meant any other continuous field rendered with the
        // categorical palette instead of a gradient.
        const numericFields = shownMetadataFields.filter(
            field => detectFieldType(field, metadataConfig) === 'gradient'
        );

        // Color gradients for each numeric field (use custom colors if available)
        const numericColorGradients = {};
        numericFields.forEach(field => {
            const gradient = getCurrentGradient(field);
            if (gradient) {
                numericColorGradients[field] = generateGradient(gradient.start, gradient.end, 5);
            }
        });

        // Calculate min/max for numeric fields across all datasets
        const numericRanges = {};
        if (showMetadata) {
            numericFields.forEach(field => {
                const values = Object.values(metadataConfig)
                    .map(m => parseLeadingNumber(m[field]))
                    .filter(v => v !== null);

                if (values.length > 0) {
                    numericRanges[field] = {
                        min: Math.min(...values),
                        max: Math.max(...values)
                    };
                }
            });
        }

        // Helper function to get color for metadata value
        const getMetadataColor = (fieldName, value) => {
            // Text fields (Tissue, Dataset/datasetId, or low-signal free text) render as plain text
            // with no colored background — matching the legend and config panel, which both exclude
            // detectFieldType === 'text'. Previously only the literal 'Tissue' was handled here, so
            // other text fields still got an auto-generated categorical background in the cells.
            if (detectFieldType(fieldName, metadataConfig) === 'text') {
                return NO_COLOR;
            }

            // Numeric (gradient) fields FIRST. getCurrentColors below auto-generates a categorical
            // palette for ANY field, so checking it first would shadow every gradient field with
            // categorical colors. Gradient endpoints come from getCurrentGradient (honors custom
            // gradients) via numericColorGradients.
            if (numericFields.includes(fieldName) && numericRanges[fieldName]) {
                const numValue = parseLeadingNumber(value);
                if (numValue !== null) {
                    const range = numericRanges[fieldName];
                    const gradient = numericColorGradients[fieldName];

                    if (range.max === range.min) {
                        return gradient[2]; // Middle color if all values are the same
                    }

                    // Map value to gradient index
                    const normalized = (numValue - range.min) / (range.max - range.min);
                    const index = Math.floor(normalized * (gradient.length - 1));
                    return gradient[Math.max(0, Math.min(index, gradient.length - 1))];
                }
                // A gradient-field cell with no parseable numeric value (missing/blank/"N/A") has no
                // position on the ramp, so render it white/no-color rather than falling through to a
                // categorical palette color that lies outside the gradient.
                return NO_COLOR;
            }

            // Categorical fields - use custom or default colors
            const colors = getCurrentColors(fieldName);
            if (colors) {
                if (typeof colors === 'string') {
                    return colors;
                }
                // Try exact key first (hardcoded/custom maps keyed by original casing), then the
                // normalized key (auto-generated maps are keyed case-insensitively) so
                // "female"/"Female" resolve to the same color.
                if (colors[value]) {
                    return colors[value];
                }
                if (colors[metadataValueKey(value)]) {
                    return colors[metadataValueKey(value)];
                }
            }

            // Default fallback color
            return '#B3E5FC';
        };

        // Build metadata plot data from the SAME canonical columnOrder as the pathway cells,
        // so metadata columns can never disagree with pathway columns.
        let metadataPlotData = [];
        if (showMetadata) {
            const built = buildMetadataPlotData({
                columnOrder,
                analysisMethods,
                metadataFields: shownMetadataFields,
                metadataConfig,
                metadataKeys,
                getMetadataColor,
            });
            metadataPlotData = built.data; // each cell: [displayCol, fieldIdx, color, rawValue, field]
        }

        // Remap pathway cells through the shared position maps. Points whose column or row has no
        // display position are dropped (returns null) rather than mislocated to a wrong cell.
        const orderedPlotData = plotData
            .map(point => remapPlotPoint(point, colPosMap, rowPosMap, metadataRowCount, showMetadata))
            .filter(Boolean);

        // Remap the effect-magnitude circles through the SAME maps, so a circle always sits on its
        // own pathway cell and never on a metadata row (dropped when it can't be placed). Only the
        // representation selected by EFFECT_MAGNITUDE_MODE is built — the other stays [] so we never
        // remap the (potentially large) circle set twice per render.
        const useScatter = EFFECT_MAGNITUDE_MODE === 'scatter';
        const orderedScatterData = useScatter
            ? markPointScoreData
                .map(point => remapScatterPoint(point, colPosMap, rowPosMap, metadataRowCount, showMetadata))
                .filter(Boolean)
            : [];
        const orderedMarkPointData = useScatter
            ? []
            : markPointScoreData
                .map(point => remapMarkPoint(point, colPosMap, rowPosMap, metadataRowCount, showMetadata))
                .filter(Boolean);
        // Effect-magnitude circles as a scatter series on the shared category grid. Each datum
        // carries its own symbolSize/itemStyle; z:3 keeps dots above the cell rects. Appended to the
        // series array only in scatter mode. Name is Title Case to match the sibling series
        // ('Metadata', 'Pathways', 'Heat Map').
        const effectMagnitudeSeries = {
            name: 'Effect Magnitude',
            type: 'scatter',
            data: orderedScatterData,
            symbol: 'circle',
            z: 3,
            emphasis: { scale: false },
        };
        // Legacy overlay attached to the pathway series only in markPoint mode.
        const legacyMarkPoint = useScatter ? undefined : { data: orderedMarkPointData };

        // Calculate dynamic significance threshold for color scale
        // The heatmap background shows -log10(pValueFDR)
        let significanceThresholdForColor = 1.3; // Default: -log10(0.05)
        if (enableSignificantFilter && threshold > 0) {
            // Convert p-value threshold to -log10 scale
            significanceThresholdForColor = -Math.log10(threshold);
        }

        return {
            tooltip: {
                position: 'top',
                trigger: 'item',
                formatter: function(params) {
                    // Effect-magnitude circles (scatter series) are hoverable even where the cell has
                    // no background (non-significant), so surface the same info here. Its `data` is an
                    // object with `value: [x, y]` plus the FDR/score payload.
                    if (params.seriesName === 'Effect Magnitude') {
                        const d = params.data || {};
                        const [x, y] = d.value || [];
                        const analysisName = orderedXAxisLabels[x];
                        const pathwayName = orderedYAxisLabels[y];
                        if (d.pValueFDR === null || d.pValueFDR === undefined || d.score === null || d.score === undefined) {
                            return `<strong>${pathwayName}</strong><br/>${analysisName}<br/>No data`;
                        }
                        return `<strong>${pathwayName}</strong><br/>${analysisName}<br/>FDR: ${d.pValueFDR.toExponential(2)}<br/>Score: ${d.score.toFixed(2)}`;
                    }
                    // Legacy markPoint dots (only when EFFECT_MAGNITUDE_MODE === 'markPoint').
                    if (params.componentType === 'markPoint') {
                        const d = params.data || {};
                        const analysisName = orderedXAxisLabels[d.xAxis];
                        const pathwayName = orderedYAxisLabels[d.yAxis];
                        if (d.pValueFDR === null || d.pValueFDR === undefined || d.score === null || d.score === undefined) {
                            return `<strong>${pathwayName}</strong><br/>${analysisName}<br/>No data`;
                        }
                        return `<strong>${pathwayName}</strong><br/>${analysisName}<br/>FDR: ${d.pValueFDR.toExponential(2)}<br/>Score: ${d.score.toFixed(2)}`;
                    }
                    // Metadata band cells (custom series): data is [col, fieldIdx, color, value, field].
                    if (params.seriesName === 'Metadata' && Array.isArray(params.data)) {
                        const fieldName = params.data[4];
                        const value = params.data[3];
                        const analysisName = orderedXAxisLabels[params.data[0]]; // x-axis is datasets
                        return `<strong>${fieldName}</strong><br/>${analysisName}<br/>Value: ${value}`;
                    }
                    // Pathway cells (both modes): data is [col, row, value, pValueFDR, score].
                    if (params.componentType === 'series' && Array.isArray(params.data)) {
                        const pathwayName = orderedYAxisLabels[params.data[1]];
                        const analysisName = orderedXAxisLabels[params.data[0]];
                        const pValueFDR = params.data[3];
                        const score = params.data[4];
                        if (pValueFDR === null || score === null) {
                            return `<strong>${pathwayName}</strong><br/>${analysisName}<br/>No data`;
                        }
                        return `<strong>${pathwayName}</strong><br/>${analysisName}<br/>FDR: ${pValueFDR.toExponential(2)}<br/>Score: ${score.toFixed(2)}`;
                    }
                    // For axis labels, just show the value (full pathway name)
                    return params.value || params.name;
                }
            },
            grid: {
                containLabel: false,
                left: showMetadata ? 220 : 200,
                top: showMetadata ? 150 : 120,
                bottom: showMetadata ? 120 : 200,
                right: showMetadata ? 20 : 20
            },
            graphic: showMetadata ? [
                // When metadata shown, place legend at bottom-right
                // Enrichment Score Legend background box
                {
                    type: 'rect',
                    right: 20,
                    bottom: 10,
                    shape: {
                        width: 200,
                        height: 90
                    },
                    style: {
                        fill: '#fff',
                        stroke: '#ccc',
                        lineWidth: 1
                    }
                },
                // Enrichment Score Title
                {
                    type: 'text',
                    right: 100,
                    bottom: 85,
                    style: {
                        text: 'Enrichment Score',
                        font: 'bold 13px sans-serif',
                        fill: '#333'
                    }
                },
                // Orange circle example
                {
                    type: 'circle',
                    right: 195,
                    bottom: 62,
                    shape: {
                        r: 6
                    },
                    style: {
                        fill: '#FFB84D',
                        stroke: '#fff',
                        lineWidth: 1
                    }
                },
                // Orange circle label
                {
                    type: 'text',
                    left: '81%',
                    bottom: 62,
                    style: {
                        text: 'Upregulated (Positive)',
                        font: '12px sans-serif',
                        fill: '#333',
                        textVerticalAlign: 'middle',
                        textAlign: 'left'
                    }
                },
                // Blue circle example
                {
                    type: 'circle',
                    right: 195,
                    bottom: 42,
                    shape: {
                        r: 6
                    },
                    style: {
                        fill: '#7AB3CF',
                        stroke: '#fff',
                        lineWidth: 1
                    }
                },
                // Blue circle label
                {
                    type: 'text',
                    left: '81%',
                    bottom: 42,
                    style: {
                        text: 'Downregulated (Negative)',
                        font: '12px sans-serif',
                        fill: '#333',
                        textVerticalAlign: 'middle',
                        textAlign: 'left'
                    }
                },
                // Size explanation
                {
                    type: 'text',
                    right: 80,
                    bottom: 23,
                    style: {
                        text: 'Size = |Enrichment Score|',
                        font: 'italic 11px sans-serif',
                        fill: '#666'
                    }
                },
                // Background significance label — above the top-left gradient legend (both modes).
                {
                    type: 'text',
                    left: 20,
                    top: 20,
                    style: {
                        text: 'Background: Statistical Significance (-log10 FDR)',
                        font: '12px sans-serif',
                        fill: '#333'
                    }
                }
            ] : [
                // Normal mode - legend at top-right
                // Legend background box
                {
                    type: 'rect',
                    right: 20,
                    top: 20,
                    shape: {
                        width: 200,
                        height: 90
                    },
                    style: {
                        fill: '#fff',
                        stroke: '#ccc',
                        lineWidth: 1
                    }
                },
                // Title
                {
                    type: 'text',
                    right: 100,
                    top: 35,
                    style: {
                        text: 'Enrichment Score',
                        font: 'bold 13px sans-serif',
                        fill: '#333'
                    }
                },
                // Orange circle example
                {
                    type: 'circle',
                    right: 195,
                    top: 58,
                    shape: {
                        r: 6
                    },
                    style: {
                        fill: '#FFB84D',
                        stroke: '#fff',
                        lineWidth: 1
                    }
                },
                // Orange circle label
                {
                    type: 'text',
                    left: '81%',
                    top: 58,
                    style: {
                        text: 'Upregulated (Positive)',
                        font: '12px sans-serif',
                        fill: '#333',
                        textVerticalAlign: 'middle',
                        textAlign: 'left'
                    }
                },
                // Blue circle example
                {
                    type: 'circle',
                    right: 195,
                    top: 78,
                    shape: {
                        r: 6
                    },
                    style: {
                        fill: '#7AB3CF',
                        stroke: '#fff',
                        lineWidth: 1
                    }
                },
                // Blue circle label
                {
                    type: 'text',
                    left: '81%',
                    top: 78,
                    style: {
                        text: 'Downregulated (Negative)',
                        font: '12px sans-serif',
                        fill: '#333',
                        textVerticalAlign: 'middle',
                        textAlign: 'left'
                    }
                },
                // Size explanation
                {
                    type: 'text',
                    right: 80,
                    top: 97,
                    style: {
                        text: 'Size = |Enrichment Score|',
                        font: 'italic 11px sans-serif',
                        fill: '#666'
                    }
                },
                // Background significance label
                {
                    type: 'text',
                    left: 20,
                    top: 20,
                    style: {
                        text: 'Background: Statistical Significance (-log10 FDR)',
                        font: '12px sans-serif',
                        fill: '#333'
                    }
                }
            ],
            xAxis: {
                type: 'category',
                data: orderedXAxisLabels,
                position: showMetadata ? 'top' : 'bottom',
                splitArea: {
                    show: false  // Disable alternating background
                },
                axisLabel: {
                    rotate: -90,
                    margin: 10,
                    align: 'left',
                    verticalAlign: 'middle',
                    width: undefined,
                    overflow: 'truncate',
                    ellipsis: '...',
                    interval: 0
                },
                axisPointer: {
                    show: true,
                    type: 'shadow',
                    label: {
                        show: true,
                        formatter: function(params) {
                            return params.value; // Show full name
                        }
                    }
                },
                triggerEvent: true
            },
            yAxis: {
                type: 'category',
                data: orderedYAxisLabels,
                inverse: true, // Always inverted to show from top to bottom
                splitArea: {
                    show: false  // Disable alternating background
                },
                axisLabel: {
                    width: showMetadata ? 200 : 180,
                    overflow: 'truncate',
                    ellipsis: '...',
                    interval: 0
                },
                axisPointer: {
                    show: true,
                    type: 'shadow',
                    label: {
                        show: true,
                        formatter: function(params) {
                            return params.value; // Show full name
                        }
                    }
                },
                triggerEvent: true
            },
            dataZoom: showMetadata ? [
                // When metadata shown: support both horizontal (datasets) and vertical (pathways + metadata) zoom
                // Horizontal zoom (datasets on x-axis)
                {
                    type: 'slider',
                    xAxisIndex: 0,
                    height: 10,
                    bottom: 15,
                    start: 0,
                    end: 100,
                    handleSize: 40,
                    showDetail: false
                },
                {
                    type: 'inside',
                    id: 'insideX',
                    xAxisIndex: 0,
                    start: 0,
                    end: 100,
                    zoomOnMouseWheel: false,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: true
                },
                // Vertical zoom (pathways + metadata on y-axis)
                {
                    type: 'slider',
                    yAxisIndex: 0,
                    width: 10,
                    right: 10,
                    start: 0,
                    end: 100,
                    handleSize: 40,
                    showDetail: false
                },
                {
                    type: 'inside',
                    id: 'insideY',
                    yAxisIndex: 0,
                    start: 0,
                    end: 100,
                    zoomOnMouseWheel: false,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: true
                }
            ] : [
                // Normal mode: zoom on y-axis (pathways are rows)
                {
                    type: 'slider',
                    yAxisIndex: 0,
                    width: 10,
                    right: 10,
                    start: 0,
                    end: 100,
                    handleSize: 40,
                    showDetail: false
                },
                {
                    type: 'inside',
                    id: 'insideY',
                    yAxisIndex: 0,
                    start: 0,
                    end: 100,
                    zoomOnMouseWheel: false,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: true
                }
            ],
            // ONE continuous visualMap in BOTH modes. The metadata band is a `custom` series with its
            // colors baked in (no visualMap), so metadata mode no longer adds a second visualMap —
            // a second visualMap collapsed the pathway gradient to a single color on the canvas
            // renderer when metadata was shown (values + min/max were identical between modes; only
            // the extra visualMap differed). In metadata mode the pathway heatmap is seriesIndex 1.
            visualMap: showMetadata ? {
                show: true,
                type: 'continuous',
                min: significanceThresholdForColor,
                max: 10,
                dimension: 2,
                seriesIndex: 1,
                orient: 'horizontal',
                left: 20,
                top: 42, // top-left in BOTH modes (below the description) — one consistent legend
                text: ['High', 'Low'],
                textStyle: {
                    fontSize: 12
                },
                inRange: {
                    color: ['#FFF7E6', '#FFE58F', '#FFD666', '#FFA940', '#FF7A45', '#FA541C', '#F5222D']
                },
                outOfRange: {
                    color: 'rgba(255, 255, 255, 0)'
                }
            } : {
                show: true,
                type: 'continuous',
                min: significanceThresholdForColor,
                max: 10,
                dimension: 2,
                seriesIndex: 0,
                orient: 'horizontal',
                left: 20,
                top: 42, // sit below the "Background: Statistical Significance" label (at top:20)
                text: ['High', 'Low'],
                textStyle: {
                    fontSize: 12
                },
                inRange: {
                    color: ['#FFF7E6', '#FFE58F', '#FFD666', '#FFA940', '#FF7A45', '#FA541C', '#F5222D']
                },
                outOfRange: {
                    color: 'rgba(255, 255, 255, 0)'
                }
            },
            // Series order is load-bearing: the visualMaps above target series by index
            // (metadata mode: 0=Metadata, 1=Pathways; normal mode: 0=Heat Map). The scatter
            // 'Effect Magnitude' series is always appended LAST so it never collides with a
            // visualMap seriesIndex. Keep new series before the scatter spread.
            series: showMetadata ? [
                // Metadata band — seriesIndex 0. A `custom` series (NOT heatmap) so its colors are
                // baked in per cell (data[2]) and it needs no visualMap of its own. Each datum is
                // [displayCol, fieldIdx, color, rawValue, fieldName]; renderItem draws the cell rect
                // (and the Tissue value as text, matching the old label formatter).
                {
                    name: 'Metadata',
                    type: 'custom',
                    data: metadataPlotData,
                    encode: { x: 0, y: 1 },
                    renderItem: function(params, api) {
                        // NOTE: renderItem's `params` has NO `.data`; read the datum dims via api.value(i).
                        // Each datum is [displayCol, fieldIdx, color, rawValue, fieldName].
                        const color = api.value(2);
                        const rawValue = api.value(3);
                        const fieldName = api.value(4);
                        const p = api.coord([api.value(0), api.value(1)]);
                        const size = api.size([1, 1]);
                        const w = size[0], h = size[1];
                        const children = [{
                            type: 'rect',
                            shape: { x: p[0] - w / 2, y: p[1] - h / 2, width: w, height: h },
                            style: { fill: color || '#EEEEEE', stroke: '#fff', lineWidth: 1 }
                        }];
                        // Only the Tissue field shows its value as text (wrapped like the old label).
                        if (fieldName === 'Tissue' && rawValue) {
                            const text = String(rawValue).includes(' (') ? String(rawValue).replace(' (', '\n(') : String(rawValue);
                            children.push({
                                type: 'text',
                                style: {
                                    text, x: p[0], y: p[1],
                                    textAlign: 'center', textVerticalAlign: 'middle',
                                    fontSize: 10, fill: '#333', overflow: 'break', width: w
                                }
                            });
                        }
                        return { type: 'group', children };
                    }
                },
                // Pathway series (with visualMap) — seriesIndex 1
                {
                    name: 'Pathways',
                    type: 'heatmap',
                    data: orderedPlotData,
                    label: {
                        show: false
                    },
                    emphasis: {
                        itemStyle: {
                            shadowBlur: 10,
                            shadowColor: 'rgba(0, 0, 0, 0.5)'
                        }
                    },
                    itemStyle: {
                        borderWidth: 1,
                        borderColor: 'white',
                        borderType: 'solid'
                    },
                    markPoint: legacyMarkPoint
                },
                ...(useScatter ? [effectMagnitudeSeries] : []) // seriesIndex 2 (scatter, last)
            ] : [
                {
                    name: 'Heat Map', // seriesIndex 0
                    type: 'heatmap',
                    data: orderedPlotData,
                    label: {
                        show: false
                    },
                    emphasis: {
                        itemStyle: {
                            shadowBlur: 10,
                            shadowColor: 'rgba(0, 0, 0, 0.5)'
                        }
                    },
                    itemStyle: {
                        borderWidth: 1,
                        borderColor: 'white',
                        borderType: 'solid'
                    },
                    markPoint: legacyMarkPoint
                },
                ...(useScatter ? [effectMagnitudeSeries] : []) // seriesIndex 1 (scatter, last)
            ]
        }
        // EFFECT_MAGNITUDE_MODE is a module constant (not reactive), so it is intentionally not a dep.
    }, [plotData, markPointScoreData, analysisMethods, analysisMethodKeys, pathwayNames, pathwayOrder, analysisOrder, enableSignificantFilter, significanceMetric, threshold, showMetadata, sortByMetadata, metadataSortOrder, analysisNames, customColors, customGradients, autoGeneratedColors, metadataConfig, shownMetadataFields])

    // Regression hook for the metadata-toggle gradient collapse (see the key prop below): publish the
    // number of DISTINCT colors ECharts computed for the pathway cells onto a data-pathway-fills
    // attribute on the chart host. Reading the model layer (getItemVisual) reflects the significant-
    // cell gradient itself, immune to the overlaid scatter dots, the metadata band, and canvas
    // anti-aliasing that make raw pixel-counting unreliable. A healthy gradient yields many distinct
    // fills; a collapse yields 1.
    //
    // INVALIDATE the value synchronously (before paint) on every re-render so the e2e poll can never
    // read a stale pre-remount value — the toggle remounts the chart, and the fresh value is only
    // known ~300ms later (below). useLayoutEffect runs before the browser paints, so the attribute is
    // already gone by the time the test observes the toggled DOM.
    useLayoutEffect(() => {
        const host = chartHostRef.current;
        if (host) delete host.dataset.pathwayFills;
    }, [options, showMetadata]);

    // Republish after the (re)mounted chart has painted. Best-effort — must never break the chart.
    useEffect(() => {
        const host = chartHostRef.current;
        if (!host) return;
        const t = setTimeout(() => {
            try {
                const chart = chartRef.current && chartRef.current.getEchartsInstance
                    ? chartRef.current.getEchartsInstance() : null;
                if (!chart) return;
                const model = chart.getModel();
                const pw = model.getSeriesByName('Pathways')[0] || model.getSeriesByName('Heat Map')[0];
                if (!pw) return;
                const data = pw.getData();
                const fills = new Set();
                for (let i = 0, n = data.count(); i < n; i++) {
                    const style = data.getItemVisual(i, 'style');
                    const raw = (style && style.fill) || data.getItemVisual(i, 'color');
                    // Normalize whitespace: in-range gradient colors are 'rgba(r,g,b,1)' (no spaces),
                    // but the visualMap's out-of-range (non-significant) fill is the config string
                    // 'rgba(255, 255, 255, 0)' WITH spaces, passed through verbatim. Strip spaces so
                    // transparent cells are excluded and equal colors don't split into two buckets.
                    const color = raw == null ? '' : String(raw).replace(/\s+/g, '');
                    if (color && color !== 'rgba(255,255,255,0)' && color !== 'rgba(0,0,0,0)' && color !== 'transparent') {
                        fills.add(color);
                    }
                }
                host.dataset.pathwayFills = String(fills.size);
            } catch (e) { /* best-effort regression hook; must not break the chart */ }
        }, 300);
        return () => clearTimeout(t);
    }, [options, showMetadata]);

    useEffect(() => {
        console.log('[HeatmapChart useEffect] Starting data processing - analysisResultsByDb.length:', analysisResultsByDb.length, 'selectedAnalysisMethods:', selectedAnalysisMethods);
        let resultObject = {}
        if (analysisResultsByDb.length === 0) {
            console.log('[HeatmapChart useEffect] Early return - no analysisResultsByDb');
            return;
        }

        // Remove top 30 limit - include ALL pathways
        resultObject = analysisResultsByDb.reduce((acc, curr) => {
            const key = `${curr.analysisId}_${curr.key}`
            acc[key] = curr.value // No .slice(0, 30)
            return acc
        }, {})
        console.log('[HeatmapChart useEffect] resultObject keys:', Object.keys(resultObject).length);

        let selectedAnalysisMethodsSet = new Set(selectedAnalysisMethods)
        let filteredResultObject = Object.keys(resultObject).reduce((acc, curr) => {
            if (selectedAnalysisMethodsSet.has(curr)) {
                acc[curr] = resultObject[curr]
            }
            return acc
        }, {})
        console.log('[HeatmapChart useEffect] filteredResultObject keys:', Object.keys(filteredResultObject).length, 'selectedAnalysisMethods:', Array.from(selectedAnalysisMethodsSet));

        if (Object.keys(filteredResultObject).length === 0) {
            console.log('[HeatmapChart useEffect] Early return - no filteredResultObject');
            return;
        }

        // Raw `${analysisId}_${methodName}` keys, kept index-aligned with the display labels below
        // so meta-column detection can consult them (the display label loses the method suffix).
        const rawAnalysisKeys = Object.keys(filteredResultObject)
        analysisMethods = rawAnalysisKeys

        // Detect if only one unique method is used across all analyses (excluding meta)
        const uniqueMethods = new Set(
            analysisMethods
                .map(key => key.split('_')[1])
                .filter(method => method !== 'meta')
        )
        const singleMethodOnly = uniqueMethods.size === 1

        // Replace with analysis name (and method name only if multiple non-meta methods)
        analysisMethods = analysisMethods.map((e, i) => {
            const analysisId = e.split('_')[0]
            const methodName = e.split('_')[1]
            const displayName = analysisNames[analysisId]?.name

            // If only one non-meta method across all analyses, omit the method suffix
            if (singleMethodOnly) {
                return displayName
            } else {
                return displayName + '_' + methodName
            }
        })

        // Get gene set info for pathway names
        let firstAnalysisId = Object.keys(filteredResultObject)[0].split('_')[0]
        console.log('[HeatmapChart useEffect] firstAnalysisId:', firstAnalysisId, 'dbId:', dbId);
        let firstConfig = configs.find(e => e.analysisId === firstAnalysisId)
        console.log('[HeatmapChart useEffect] firstConfig found:', !!firstConfig, 'has geneSets:', !!firstConfig?.geneSets);
        let geneSet = []

        // Safety check for custom gene sets or missing geneSets
        if (firstConfig && firstConfig.geneSets && Array.isArray(firstConfig.geneSets)) {
            console.log('[HeatmapChart useEffect] firstConfig.geneSets length:', firstConfig.geneSets.length);
            let matchingGeneSetDb = firstConfig.geneSets.find(e => e.id === dbId)
            console.log('[HeatmapChart useEffect] matchingGeneSetDb found:', !!matchingGeneSetDb, 'has geneSets:', !!matchingGeneSetDb?.geneSets);
            if (matchingGeneSetDb && matchingGeneSetDb.geneSets) {
                geneSet = matchingGeneSetDb.geneSets
                console.log('[HeatmapChart useEffect] geneSet length:', geneSet.length);
            }
        } else {
            console.log('[HeatmapChart useEffect] WARNING: Could not find geneSets in config');
        }

        let genSetObj = geneSet.reduce((acc, curr) => {
            acc[curr.id] = curr
            return acc
        }, {})
        console.log('[HeatmapChart useEffect] genSetObj keys:', Object.keys(genSetObj).length);

        // Auto-detect reference analysis on first render (prefer meta-analysis)
        if (referenceAnalysis === null) {
            console.log('[HeatmapChart useEffect] referenceAnalysis is null, detecting...');
            const metaAnalysisKey = Object.keys(filteredResultObject).find(key => {
                const analysisId = key.split('_')[0]
                return analysisNames[analysisId]?.input === 'meta'
            })
            const defaultRef = metaAnalysisKey || Object.keys(filteredResultObject)[0]
            console.log('[HeatmapChart useEffect] Setting referenceAnalysis to:', defaultRef);
            setReferenceAnalysis(defaultRef)
            return // Wait for next render with referenceAnalysis set
        }
        console.log('[HeatmapChart useEffect] referenceAnalysis:', referenceAnalysis);

        // Build complete pathway map from ALL analyses
        const allPathwayData = {} // key: pathwayId, value: { id, name, dataByAnalysis: Map }

        console.log('[HeatmapChart useEffect] Building pathway map from filteredResultObject');
        Object.keys(filteredResultObject).forEach((analysisKey) => {
            const pathways = filteredResultObject[analysisKey];
            console.log('[HeatmapChart useEffect] analysisKey:', analysisKey, 'pathways count:', pathways?.length, 'first pathway:', pathways?.[0]);

            if (!pathways || pathways.length === 0) {
                console.log('[HeatmapChart useEffect] WARNING: No pathways for', analysisKey);
                return;
            }

            pathways.forEach(pathway => {
                if (!allPathwayData[pathway.pathway]) {
                    // Try to get name from: 1) genSetObj (custom), 2) pathway.name (database), 3) pathway ID
                    const pathwayName = genSetObj[pathway.pathway]?.name || pathway.name || pathway.pathway;
                    allPathwayData[pathway.pathway] = {
                        id: pathway.pathway,
                        name: pathwayName,
                        dataByAnalysis: new Map(),
                        pValue: null,
                        pValueFDR: null,
                        score: null
                    }
                }
                allPathwayData[pathway.pathway].dataByAnalysis.set(analysisKey, {
                    pValue: pathway.pValue,
                    pValueFDR: pathway.pValueFDR,
                    score: pathway.score
                })
            })
        })
        console.log('[HeatmapChart useEffect] allPathwayData keys:', Object.keys(allPathwayData).length);

        // Get pathways from reference analysis and apply filtering
        const numAnalyses = Object.keys(filteredResultObject).length
        let pathwayList = []

        console.log('[HeatmapChart useEffect] enableSignificantFilter:', enableSignificantFilter, 'threshold:', threshold, 'significanceMetric:', significanceMetric, 'topN:', topN);

        // --- Significance detection: drives the "excluded analyses" note AND the default Top-N seed.
        const significantPathwaysSet = new Set();
        const analysesWithoutSignificantPathways = [];
        Object.keys(filteredResultObject).forEach(analysisKey => {
            const pathways = filteredResultObject[analysisKey];
            let hasSignificant = false;
            pathways.forEach(p => {
                const isSig = threshold === 0
                    || (significanceMetric === 'pvalue' ? p.pValue < threshold : p.pValueFDR < threshold);
                if (isSig) { hasSignificant = true; significantPathwaysSet.add(p.pathway); }
            });
            if (!hasSignificant) analysesWithoutSignificantPathways.push(analysisKey);
        });
        setExcludedAnalyses(analysesWithoutSignificantPathways);

        // --- Reference-analysis metrics for EVERY pathway (ranking + the selection table columns).
        const analysisKeysAll = Object.keys(filteredResultObject);
        const refAugment = (pathway) => {
            let refData = pathway.dataByAnalysis.get(referenceAnalysis);
            if (!refData) {
                for (const k of analysisKeysAll) { refData = pathway.dataByAnalysis.get(k); if (refData) break; }
            }
            return {
                ...pathway,
                pValue: refData?.pValue ?? 1,
                pValueFDR: refData?.pValueFDR ?? 1,
                score: refData?.score ?? 0,
            };
        };
        // Map the heatmap's sort controls onto the shared pathway ranker (same order the table shows).
        const sortColumnKey = sortBy === 'pvalue' ? PATHWAY_COLUMNS.P_VALUE
            : sortBy === 'score' ? PATHWAY_COLUMNS.SCORE
            : PATHWAY_COLUMNS.P_VALUE_FDR;
        const sortOrderAnt = sortOrder === 'desc' ? 'descend' : 'ascend';
        const rankedAll = selectPathways(
            Object.values(allPathwayData).map(refAugment),
            sortColumnKey, sortOrderAnt, SELECTION_MODES.ALL
        );
        setAllPathways(rankedAll);

        // Default checked set: Top-N of the significant pathways (or ALL when the filter is off).
        const defaultIds = enableSignificantFilter
            ? rankedAll.filter(p => significantPathwaysSet.has(p.id)).slice(0, topN).map(p => p.id)
            : rankedAll.map(p => p.id);

        // Re-seed the selection ONLY when a filter input changed; a manual check/uncheck keeps it.
        const seedSig = JSON.stringify([
            dbId, selectedAnalysisMethods, enableSignificantFilter, referenceAnalysis,
            significanceMetric, threshold, topN, sortBy, sortOrder, rankedAll.length,
        ]);
        let effectiveSelectedIds;
        if (pathwaySeedSig.current !== seedSig || selectedPathwayIds === null) {
            pathwaySeedSig.current = seedSig;
            effectiveSelectedIds = new Set(defaultIds);
            setSelectedPathwayIds(effectiveSelectedIds);
        } else {
            effectiveSelectedIds = selectedPathwayIds;
        }

        // The heatmap renders EXACTLY the checked pathways, in ranked order.
        pathwayList = rankedAll.filter(p => effectiveSelectedIds.has(p.id));

        setFilteredPathwaysCount(pathwayList.length)

        console.log('[HeatmapChart useEffect] pathwayList final length:', pathwayList.length);
        if (pathwayList.length === 0) {
            console.log('[HeatmapChart useEffect] WARNING: pathwayList is empty, cannot build plot data');
        }

        // Build plot data and score matrix from filtered pathways
        plotData = []
        markPointScoreData = []
        const numPathways = pathwayList.length
        const scoreMatrix = Array(numPathways).fill(null).map(() => Array(numAnalyses).fill(0))
        console.log('[HeatmapChart useEffect] Building plot data for', numPathways, 'pathways and', numAnalyses, 'analyses');

        pathwayList.forEach((pathway, pathwayIdx) => {
            Object.keys(filteredResultObject).forEach((analysisKey, analysisIdx) => {
                const data = pathway.dataByAnalysis.get(analysisKey)

                if (data) {
                    // Pathway exists in this analysis
                    let logPValueFDR = data.pValueFDR >= 1e-16 ? -Math.log10(data.pValueFDR) : -Math.log10(1e-16);

                    // Check if pathway is significant based on current threshold and metric
                    let isSignificant;
                    if (threshold === 0) {
                        isSignificant = true;
                    } else if (significanceMetric === 'pvalue') {
                        isSignificant = data.pValue < threshold;
                    } else { // 'fdr'
                        isSignificant = data.pValueFDR < threshold;
                    }

                    plotData.push([
                        analysisIdx,
                        pathwayIdx,
                        isSignificant ? logPValueFDR : '-',  // Use '-' for non-significant to hide color
                        data.pValueFDR,  // Store actual FDR
                        data.score       // Store enrichment score
                    ])

                    // Calculate scaled circle size with cap to prevent overflow (max cell height ~10px when zoomed)
                    const maxSize = 14; // Maximum circle diameter in pixels (increased for better visibility)
                    const scaleFactor = 5.5; // Sensitivity for smaller scores
                    const scoreAbs = Math.abs(data.score);

                    let symbolSize;
                    if (scoreAbs <= 2) {
                        // Linear scaling for small scores (0-2)
                        symbolSize = scoreAbs * scaleFactor;
                    } else {
                        // Logarithmic scaling for larger scores (>2)
                        symbolSize = 10.5 + Math.log(scoreAbs) * 3.5;
                    }
                    // Apply maximum cap
                    symbolSize = Math.min(symbolSize, maxSize);

                    markPointScoreData.push({
                        xAxis: analysisIdx,
                        yAxis: pathwayIdx,
                        name: pathway.id,
                        value: scoreAbs,
                        // Carry FDR + signed score so hovering the dot shows full info even for
                        // non-significant cells (whose '-' background isn't a hoverable rect).
                        pValueFDR: data.pValueFDR,
                        score: data.score,
                        symbolSize: symbolSize,
                        symbol: 'circle',
                        itemStyle: {
                            color: data.score > 0 ? '#FFB84D' : '#7AB3CF',
                            borderWidth: 1,
                            borderColor: 'white'
                        }
                    })
                    scoreMatrix[pathwayIdx][analysisIdx] = data.score
                } else {
                    // Pathway doesn't exist in this analysis - show as 0
                    plotData.push([
                        analysisIdx,
                        pathwayIdx,
                        0,
                        null,  // No FDR
                        null   // No score
                    ])
                    scoreMatrix[pathwayIdx][analysisIdx] = 0
                }
            })
        })

        pathwayNames = pathwayList.map(p => p.name)

        // Initialize default orders
        setPathwayOrder(Array.from({length: numPathways}, (_, i) => i))
        setAnalysisOrder(Array.from({length: numAnalyses}, (_, i) => i))
        console.log('[HeatmapChart useEffect] Setting plotData - length:', plotData.length, 'pathwayNames:', pathwayNames.length, 'analysisMethods:', analysisMethods.length);
        setRawPathwayScores(scoreMatrix)
        setAnalysisMethods(analysisMethods)
        setAnalysisMethodKeys(rawAnalysisKeys)
        setPathwayNames(pathwayNames)
        setPlotData(plotData)
        setMarkPointScoreData(markPointScoreData)
        if (plotData.length > 0) {
            console.log('[HeatmapChart useEffect] Data loaded successfully, setting initialDataLoaded=true');
            setInitialDataLoaded(true);
        } else {
            console.log('[HeatmapChart useEffect] WARNING: plotData is empty after processing');
        }

    }, [analysisResultsByDb, selectedAnalysisMethods, enableSignificantFilter, referenceAnalysis, significanceMetric, threshold, topN, sortBy, sortOrder, analysisNames, selectedPathwayIds, dbId])

    // Perform hierarchical clustering on pathways (and optionally analyses)
    useEffect(() => {
        if (!enableClustering || rawPathwayScores.length === 0) {
            // Reset to default order
            const numPathways = rawPathwayScores.length
            const numAnalyses = rawPathwayScores[0]?.length || 0
            setPathwayOrder(Array.from({length: numPathways}, (_, i) => i))
            setAnalysisOrder(Array.from({length: numAnalyses}, (_, i) => i))
            return
        }

        try {
            // Helper function to perform clustering
            const performClustering = (vectors, metric, method) => {
                const numItems = vectors.length
                if (numItems === 0) return []

                // Compute distance matrix
                const distanceMatrix = []
                for (let i = 0; i < numItems; i++) {
                    const row = []
                    for (let j = 0; j < numItems; j++) {
                        if (i === j) {
                            row.push(0)
                        } else {
                            let dist
                            if (metric === 'euclidean') {
                                dist = Math.sqrt(
                                    vectors[i].reduce((sum, val, k) => {
                                        return sum + Math.pow(val - vectors[j][k], 2)
                                    }, 0)
                                )
                            } else if (metric === 'manhattan') {
                                dist = vectors[i].reduce((sum, val, k) => {
                                    return sum + Math.abs(val - vectors[j][k])
                                }, 0)
                            }
                            row.push(dist)
                        }
                    }
                    distanceMatrix.push(row)
                }

                // Perform hierarchical clustering
                const tree = agnes(distanceMatrix, {
                    method: method,
                    isDistanceMatrix: true
                })

                // Extract leaf order
                const order = []
                const traverse = (node) => {
                    if (node.isLeaf) {
                        order.push(node.index)
                    } else {
                        if (node.children) {
                            node.children.forEach(child => traverse(child))
                        }
                    }
                }
                traverse(tree)
                return order
            }

            // Cluster pathways (rows)
            const pathwayVectors = rawPathwayScores // Each row is a pathway's scores across analyses
            const newPathwayOrder = performClustering(pathwayVectors, distanceMetric, clusteringMethod)
            setPathwayOrder(newPathwayOrder)

            // Optionally cluster analyses (columns)
            if (clusterColumns) {
                // Transpose: each analysis becomes a vector of pathway scores
                const numAnalyses = rawPathwayScores[0]?.length || 0
                const numPathways = rawPathwayScores.length
                const analysisVectors = []
                for (let i = 0; i < numAnalyses; i++) {
                    const vector = []
                    for (let j = 0; j < numPathways; j++) {
                        vector.push(rawPathwayScores[j][i])
                    }
                    analysisVectors.push(vector)
                }
                const newAnalysisOrder = performClustering(analysisVectors, distanceMetric, clusteringMethod)
                setAnalysisOrder(newAnalysisOrder)
            } else {
                // Reset analysis order to default
                const numAnalyses = rawPathwayScores[0]?.length || 0
                setAnalysisOrder(Array.from({length: numAnalyses}, (_, i) => i))
            }

            console.log(`Clustering complete: ${pathwayVectors.length} pathways ordered`)

        } catch (error) {
            console.error('Clustering error:', error)
            const numPathways = rawPathwayScores.length
            const numAnalyses = rawPathwayScores[0]?.length || 0
            setPathwayOrder(Array.from({length: numPathways}, (_, i) => i))
            setAnalysisOrder(Array.from({length: numAnalyses}, (_, i) => i))
        }
    }, [enableClustering, clusteringMethod, distanceMetric, clusterColumns, rawPathwayScores])

    console.log('[HeatmapChart] initialDataLoaded:', initialDataLoaded, 'plotData.length:', plotData.length, 'analysisResultsByDb.length:', analysisResultsByDb?.length);
    // Only show full-page loading if we have no input data and no output data
    // If we have input data but no output data, it means we're processing - show local spinner instead
    if (!initialDataLoaded && plotData.length === 0 && (!analysisResultsByDb || analysisResultsByDb.length === 0)) {
        console.log('[HeatmapChart] Showing GeneLoading - no input data');
        return <GeneLoading />
    }

    // --- Pathway result-table CSV export -------------------------------------------------------
    // Analysis columns in display order, labelled with the same names shown on the heatmap axis.
    const exportAnalyses = analysisMethodKeys.map((key, i) => ({ key, label: analysisMethods[i] || key }));
    // Flatten a pathway's dataByAnalysis Map into the plain { [key]: {pValue,pValueFDR,score} } shape
    // the pure CSV builder expects.
    const toCsvRow = (p) => {
        const values = {};
        if (p.dataByAnalysis && typeof p.dataByAnalysis.forEach === 'function') {
            p.dataByAnalysis.forEach((d, k) => { values[k] = d; });
        }
        return { id: p.id, name: p.name, values };
    };
    const downloadCsv = (filename, csv) => {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    // Keep the database id filesystem-safe (ids like "GO:0008150" contain characters some OSes
    // reject in a download filename).
    const safeDbName = String(dbId || 'pathways').replace(/[^\w.-]+/g, '_').slice(0, 100) || 'pathways';
    const handleExportAll = () => {
        downloadCsv(`${safeDbName}_result_all.csv`,
            buildPathwayResultCsv(allPathways.map(toCsvRow), exportAnalyses));
    };
    const handleExportSelected = () => {
        const sel = allPathways.filter(p => selectedPathwayIds && selectedPathwayIds.has(p.id));
        downloadCsv(`${safeDbName}_result_selected.csv`,
            buildPathwayResultCsv(sel.map(toCsvRow), exportAnalyses));
    };

    // Show local spinner while processing data
    if (plotData.length === 0 && analysisResultsByDb && analysisResultsByDb.length > 0) {
        console.log('[HeatmapChart] Processing data - showing local spinner');
        return (
            <div style={{padding: '50px', textAlign: 'center'}}>
                <Spin tip="Processing pathway data..." size="large" />
            </div>
        );
    }

    return (
        <div>
            <h5>
                Pathway Heat Map
            </h5>

            {/* Filtering Controls */}
            <div style={{marginBottom: 16}}>
                <Space direction="vertical" size="small" style={{width: '100%'}}>
                    <Space align="center" wrap style={{lineHeight: '32px'}}>
                        <Checkbox
                            checked={enableSignificantFilter}
                            onChange={(e) => setEnableSignificantFilter(e.target.checked)}
                        >
                            Show top
                        </Checkbox>
                        {enableSignificantFilter && (
                            <>
                                <Select
                                    value={topN}
                                    onChange={setTopN}
                                    style={{width: 80}}
                                    size="small"
                                    dropdownRender={(menu) => (
                                        <>
                                            {menu}
                                            <Divider style={{margin: '8px 0'}} />
                                            <Space style={{padding: '0 8px 4px'}}>
                                                <InputNumber
                                                    placeholder="Custom"
                                                    value={customTopNInput}
                                                    onChange={(val) => {
                                                        if (val !== null && val > 0 && val <= 1000) {
                                                            setCustomTopNInput(val)
                                                            debouncedSetTopN(val)
                                                        }
                                                    }}
                                                    min={1}
                                                    max={1000}
                                                    step={10}
                                                    size="small"
                                                    style={{width: 80}}
                                                />
                                            </Space>
                                        </>
                                    )}
                                >
                                    <Option value={10}>10</Option>
                                    <Option value={20}>20</Option>
                                    <Option value={30}>30</Option>
                                    <Option value={50}>50</Option>
                                    <Option value={100}>100</Option>
                                </Select>
                                <Text>pathways from</Text>
                                <Select
                                    value={referenceAnalysis}
                                    onChange={setReferenceAnalysis}
                                    style={{width: 180}}
                                    size="small"
                                >
                                    {selectedAnalysisMethods.map(methodKey => {
                                        const analysisId = methodKey.split('_')[0]
                                        const methodName = methodKey.split('_')[1]
                                        const displayName = analysisNames[analysisId]?.name
                                        const isMeta = analysisNames[analysisId]?.input === 'meta'
                                        const label = displayName + (methodName !== 'meta' && !isMeta ? `_${methodName}` : '')
                                        return (
                                            <Option key={methodKey} value={methodKey}>
                                                {label}
                                            </Option>
                                        )
                                    })}
                                </Select>
                                <Text>by</Text>
                                <Select
                                    value={significanceMetric}
                                    onChange={(val) => {
                                        setSignificanceMetric(val)
                                        setThreshold(0.05) // Default threshold for p-value/FDR
                                    }}
                                    style={{width: 100}}
                                    size="small"
                                >
                                    <Option value="pvalue">p-value</Option>
                                    <Option value="fdr">FDR</Option>
                                </Select>
                                <Text>&lt;</Text>
                                <Select
                                    value={threshold}
                                    onChange={setThreshold}
                                    style={{width: 90}}
                                    size="small"
                                    dropdownRender={(menu) => (
                                        <>
                                            {menu}
                                            <Divider style={{margin: '8px 0'}} />
                                            <Space style={{padding: '0 8px 4px'}}>
                                                <InputNumber
                                                    placeholder="Custom"
                                                    value={customThresholdInput}
                                                    onChange={(val) => {
                                                        if (val !== null && val >= 0 && val <= 1) {
                                                            setCustomThresholdInput(val)
                                                            debouncedSetThreshold(val)
                                                        }
                                                    }}
                                                    min={0}
                                                    max={1}
                                                    step={0.01}
                                                    size="small"
                                                    style={{width: 80}}
                                                />
                                            </Space>
                                        </>
                                    )}
                                >
                                    <Option value={0.001}>0.001</Option>
                                    <Option value={0.01}>0.01</Option>
                                    <Option value={0.05}>0.05</Option>
                                    <Option value={0.1}>0.1</Option>
                                </Select>
                                <Text>sorted by</Text>
                                <Select
                                    value={sortBy}
                                    onChange={(val) => {
                                        setSortBy(val)
                                        // Auto-adjust sort order based on metric
                                        if (val === 'score') {
                                            setSortOrder('desc') // High to low for scores
                                        } else {
                                            setSortOrder('asc') // Most significant first for p-values
                                        }
                                    }}
                                    style={{width: 100}}
                                    size="small"
                                >
                                    <Option value="pvalue">p-value</Option>
                                    <Option value="fdr">FDR</Option>
                                    <Option value="score">Score</Option>
                                </Select>
                                <Radio.Group
                                    value={sortOrder}
                                    onChange={(e) => setSortOrder(e.target.value)}
                                    size="small"
                                >
                                    <Radio.Button value="asc">
                                        {sortBy === 'score' ? '↑' : '↓'}
                                    </Radio.Button>
                                    <Radio.Button value="desc">
                                        {sortBy === 'score' ? '↓' : '↑'}
                                    </Radio.Button>
                                </Radio.Group>
                            </>
                        )}
                    </Space>
                    {enableSignificantFilter && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            Showing {filteredPathwaysCount} pathways
                        </Text>
                    )}
                </Space>
            </div>

            {/* Pathway selection table: seeded from "Show top N by reference" above; check/uncheck to
                choose exactly which pathways the heatmap shows, and export the result table. Always
                visible so it's discoverable without a toggle. */}
            <div style={{marginBottom: 16}}>
                <PathwaySelectionTable
                    pathways={allPathways}
                    selectedIds={selectedPathwayIds}
                    onSelectionChange={(keys) => setSelectedPathwayIds(new Set(keys))}
                    onExportAll={handleExportAll}
                    onExportSelected={handleExportSelected}
                />
            </div>

            <Divider style={{margin: '12px 0'}} />

            {/* Metadata Display Control */}
            <div style={{marginBottom: 16}}>
                <Space direction="vertical" size="small" style={{width: '100%'}}>
                    <Space align="center" wrap>
                        <Checkbox
                            checked={showMetadata}
                            onChange={(e) => {
                                const checked = e.target.checked;
                                setShowMetadata(checked);
                                // Clear the metadata-sort selection when hiding metadata so a stale
                                // sort field can't linger and desync a later re-sort (bug 3).
                                if (!checked) {
                                    setSortByMetadata(null);
                                    setMetadataSortOrder('asc');
                                }
                            }}
                        >
                            Show Dataset Metadata
                        </Checkbox>
                        <Text type="secondary" style={{fontSize: '12px'}}>
                            (Displays metadata rows such as Sex, Strain, Age, etc. with pathways as rows and datasets as columns)
                        </Text>
                    </Space>
                    {showMetadata && (
                        <Space direction="vertical" size={6} style={{paddingLeft: 24, width: '100%'}}>
                            <Space align="center" wrap>
                                <Text style={{fontSize: '12px'}}>Show metadata rows:</Text>
                                <Select
                                    mode="multiple"
                                    value={shownMetadataFields}
                                    // Empty or full selection both mean "show all" (null), so the
                                    // control can't be left in a confusing zero-rows state.
                                    onChange={(vals) => setVisibleMetadataFields(
                                        (vals.length === 0 || vals.length >= METADATA_FIELDS.length) ? null : vals
                                    )}
                                    style={{minWidth: 240, maxWidth: 520}}
                                    size="small"
                                    placeholder="All metadata fields"
                                    maxTagCount="responsive"
                                    allowClear
                                    options={METADATA_FIELDS.map(field => ({label: field, value: field}))}
                                />
                                <Text type="secondary" style={{fontSize: '12px'}}>
                                    {visibleMetadataFields
                                        ? `${shownMetadataFields.length} of ${METADATA_FIELDS.length}`
                                        : 'All shown'}
                                </Text>
                            </Space>
                            <Space align="center" wrap>
                                <Text style={{fontSize: '12px'}}>Sort columns by:</Text>
                                <Select
                                    value={sortByMetadata}
                                    onChange={setSortByMetadata}
                                    style={{width: 180}}
                                    size="small"
                                    placeholder="None (default order)"
                                    allowClear
                                >
                                    {METADATA_FIELDS.map(field => (
                                        <Option key={field} value={field}>
                                            {field}
                                        </Option>
                                    ))}
                                </Select>
                                {sortByMetadata && (
                                    <Radio.Group
                                        value={metadataSortOrder}
                                        onChange={(e) => setMetadataSortOrder(e.target.value)}
                                        size="small"
                                    >
                                        <Radio.Button value="asc">Ascending</Radio.Button>
                                        <Radio.Button value="desc">Descending</Radio.Button>
                                    </Radio.Group>
                                )}
                            </Space>
                        </Space>
                    )}
                </Space>
            </div>

            <Divider style={{margin: '12px 0'}} />

            {/* Clustering Controls */}
            <div style={{marginBottom: 16}}>
                <Space align="center" wrap>
                    <Checkbox
                        checked={enableClustering}
                        onChange={(e) => setEnableClustering(e.target.checked)}
                    >
                        Enable Hierarchical Clustering
                    </Checkbox>
                    {enableClustering && (
                        <>
                            <Text type="secondary">|</Text>
                            <Text>Method:</Text>
                            <Select
                                value={clusteringMethod}
                                onChange={setClusteringMethod}
                                style={{width: 120}}
                                size="small"
                            >
                                <Option value="ward">Ward</Option>
                                <Option value="complete">Complete</Option>
                                <Option value="average">Average</Option>
                                <Option value="single">Single</Option>
                            </Select>
                            <Text type="secondary">|</Text>
                            <Text>Distance:</Text>
                            <Select
                                value={distanceMetric}
                                onChange={setDistanceMetric}
                                style={{width: 120}}
                                size="small"
                            >
                                <Option value="euclidean">Euclidean</Option>
                                <Option value="manhattan">Manhattan</Option>
                            </Select>
                            <Text type="secondary">|</Text>
                            <Checkbox
                                checked={clusterColumns}
                                onChange={(e) => setClusterColumns(e.target.checked)}
                            >
                                Cluster columns (analyses)
                            </Checkbox>
                        </>
                    )}
                </Space>
            </div>

            {/* Metadata Legend - Show above the chart */}
            {showMetadata && (
                <div style={{marginTop: 16, marginBottom: 16, padding: 16, background: '#FAFAFA', borderRadius: 4}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
                        <h6 style={{margin: 0, fontWeight: 'bold'}}>Metadata Color Legend</h6>
                        <Space>
                            <Button
                                size="small"
                                onClick={() => setIsEditingColors(!isEditingColors)}
                                type={isEditingColors ? 'primary' : 'default'}
                            >
                                {isEditingColors ? 'Done Editing' : 'Edit Colors'}
                            </Button>
                            <Button size="small" onClick={resetToDefaults}>Reset to Defaults</Button>
                            <Dropdown
                                menu={{
                                    items: [
                                        {
                                            key: 'png',
                                            label: 'Export as PNG (4x)'
                                        },
                                        {
                                            key: 'svg',
                                            label: 'Export as SVG'
                                        }
                                    ],
                                    onClick: ({ key }) => {
                                        if (key === 'png') {
                                            exportLegendAsPNG();
                                        } else if (key === 'svg') {
                                            exportLegendAsSVG();
                                        }
                                    }
                                }}
                                placement="bottomRight"
                            >
                                <Button size="small" icon={<DownloadOutlined />}>
                                    Export
                                </Button>
                            </Dropdown>
                        </Space>
                    </div>
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16}}>
                        {shownMetadataFields.filter(fieldName => detectFieldType(fieldName, metadataConfig) !== 'text').map(fieldName => {
                            const fieldType = detectFieldType(fieldName, metadataConfig);

                            if (fieldType === 'gradient') {
                                const gradient = getCurrentGradient(fieldName);
                                const gradientColors = generateGradient(gradient.start, gradient.end, 5);
                                const gradientRanges = calculateGradientRanges(metadataConfig, METADATA_FIELDS);
                                const range = gradientRanges[fieldName];

                                return (
                                    <div key={fieldName}>
                                        <Text strong style={{fontSize: 12}}>{fieldName}</Text>
                                        <div style={{marginTop: 4}}>
                                            <div style={{display: 'flex', alignItems: 'center'}}>
                                                {gradientColors.map((color, i) => (
                                                    <div key={i} style={{width: 20, height: 16, backgroundColor: color, border: '1px solid #ddd'}}></div>
                                                ))}
                                                <Text style={{fontSize: 11, marginLeft: 6}}>Low → High</Text>
                                            </div>
                                            {range && (
                                                <div style={{display: 'flex', marginTop: 4}}>
                                                    {gradientColors.map((color, i) => {
                                                        const value = range.min + (i / (gradientColors.length - 1)) * (range.max - range.min);
                                                        return (
                                                            <div key={i} style={{width: 20, textAlign: 'center'}}>
                                                                <Text style={{fontSize: 9}}>{value.toFixed(1)}</Text>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {isEditingColors && (
                                                <div style={{marginTop: 8, display: 'flex', gap: 8, alignItems: 'center'}}>
                                                    <Input
                                                        type="color"
                                                        value={gradient.start}
                                                        onChange={(e) => setCustomGradients({
                                                            ...customGradients,
                                                            [fieldName]: {...gradient, start: e.target.value}
                                                        })}
                                                        style={{width: 50}}
                                                        size="small"
                                                    />
                                                    <Text style={{fontSize: 11}}>to</Text>
                                                    <Input
                                                        type="color"
                                                        value={gradient.end}
                                                        onChange={(e) => setCustomGradients({
                                                            ...customGradients,
                                                            [fieldName]: {...gradient, end: e.target.value}
                                                        })}
                                                        style={{width: 50}}
                                                        size="small"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            }

                            if (fieldType === 'categorical') {
                                const colors = getCurrentColors(fieldName);

                                return (
                                    <div key={fieldName}>
                                        <Text strong style={{fontSize: 12}}>{fieldName}</Text>
                                        <div style={{marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                            {Object.entries(colors).map(([value, color]) => (
                                                <div key={value} style={{display: 'inline-flex', alignItems: 'center'}}>
                                                    {isEditingColors ? (
                                                        <Input
                                                            type="color"
                                                            value={color}
                                                            onChange={(e) => setCustomColors({
                                                                ...customColors,
                                                                [fieldName]: {
                                                                    ...colors,
                                                                    // Store under the normalized key so the override matches
                                                                    // getMetadataColor's normalized lookup and can't accumulate
                                                                    // both "Female" and "female" entries.
                                                                    [metadataValueKey(value)]: e.target.value
                                                                }
                                                            })}
                                                            style={{width: 30, height: 20, padding: 0, marginRight: 4}}
                                                            size="small"
                                                        />
                                                    ) : (
                                                        <div style={{width: 16, height: 16, backgroundColor: color, marginRight: 4, border: '1px solid #ddd'}}></div>
                                                    )}
                                                    <Text style={{fontSize: 11}}>{value}</Text>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            }

                            return null;
                        })}
                    </div>
                </div>
            )}

            <div ref={chartHostRef} data-testid="pathway-heatmap-host">
            <EchartsWrapper>
                <ReactEcharts
                    // Remount the chart when the metadata band is toggled. Toggling changes the
                    // series count (a custom metadata band is inserted at index 0) and the continuous
                    // visualMap's seriesIndex (0 -> 1). echarts-for-react updates in merge mode by
                    // default, and on the canvas renderer that structural merge leaves the visualMap's
                    // per-item color pipeline bound to stale state, collapsing the significant-cell
                    // gradient to one color. A fresh instance (like ForestChart's key) renders the
                    // gradient correctly. Keyed only on showMetadata so data-only sorts still merge.
                    key={showMetadata ? 'heatmap-meta' : 'heatmap-nometa'}
                    ref={chartRef}
                    option={options}
                    style={{height: "1000px"}}
                    onEvents={{
                        mouseover: (params) => {
                            // Show full name in tooltip when hovering over truncated axis labels
                            const isPathwayAxis = showMetadata
                                ? (params.componentType === 'xAxis' && params.targetType === 'axisLabel')
                                : (params.componentType === 'yAxis' && params.targetType === 'axisLabel');

                            if (isPathwayAxis) {
                                const chart = chartRef.current?.getEchartsInstance();
                                if (chart) {
                                    chart.dispatchAction({
                                        type: 'showTip',
                                        // In metadata mode the pathway heatmap is series 1 (the
                                        // metadata band is series 0); in normal mode it is series 0.
                                        // Mirror the visualMap's seriesIndex so the tip targets the
                                        // pathway cells, not the metadata band.
                                        seriesIndex: showMetadata ? 1 : 0,
                                        name: params.value
                                    });
                                }
                            }
                        }
                    }}
                ></ReactEcharts>
            </EchartsWrapper>
            </div>
        </div>
    )

}


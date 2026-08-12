// Pure, dependency-free helpers for CSV export.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported on both client and server — including the server-side Mocha runner.

/**
 * Format a numeric value for CSV export WITHOUT losing precision.
 *
 * The DE-genes export previously ran every value through `.toFixed(2)`, which
 * collapsed any p-value below 0.005 to "0.00". Here we emit the full
 * double-precision representation instead; JavaScript's `Number#toString`
 * automatically switches to exponential notation for very small/large
 * magnitudes (e.g. `1e-9`), so tiny p-values are preserved rather than rounded
 * to zero. Missing values become an empty cell.
 */
export const formatNumberForExport = (value) => {
    if (value === null || value === undefined) return '';
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '';
    return num.toString();
};

/**
 * Select which genes to export from the full volcano-plot gene list.
 *
 * `mode` controls the subset (the Export dropdown on the Gene Volcano Plot):
 *   - 'de'   : significant in either direction (the original "Export DE genes").
 *   - 'up'   : significant AND upregulated   (FC >=  minLogFoldChange).
 *   - 'down' : significant AND downregulated (FC <= -minLogFoldChange).
 *   - 'all'  : the full, unfiltered gene list.
 *
 * Significance uses the same predicate the plot and server-side DEGenes build use:
 * `pValueFDR <= maxAdjustedPValue && |FC| >= minLogFoldChange`. Result is sorted by
 * `pValueFDR` ascending (matching the previous export behaviour). Pure: no I/O.
 */
export const selectGenesForExport = (genes, {mode = 'de', maxAdjustedPValue, minLogFoldChange} = {}) => {
    const list = Array.isArray(genes) ? genes : [];

    const isSignificant = (gene) =>
        gene.pValueFDR <= maxAdjustedPValue && Math.abs(gene.FC) >= minLogFoldChange;

    const matches = (gene) => {
        switch (mode) {
            case 'all':
                return true;
            case 'up':
                return isSignificant(gene) && gene.FC >= minLogFoldChange;
            case 'down':
                return isSignificant(gene) && gene.FC <= -minLogFoldChange;
            case 'de':
            default:
                return isSignificant(gene);
        }
    };

    return list
        .filter(matches)
        .sort((a, b) => a.pValueFDR - b.pValueFDR);
};

/**
 * Escape a single value for inclusion in a CSV cell (RFC-4180 style).
 *
 * Gene symbols and — especially — descriptions frequently contain commas,
 * double-quotes or newlines. Emitting them raw shifts every following column,
 * so any field containing one of those characters is wrapped in double-quotes
 * with inner quotes doubled. null/undefined become an empty cell. Pure.
 */
export const csvEscape = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

/**
 * Build a CSV body (header + rows) from arbitrary row objects and a column spec.
 *
 * `columns` is an array of `{header, field, format?}`:
 *   - `header` : the column title emitted in the header row.
 *   - `field`  : the property read off each row object.
 *   - `format` : optional (value) => string transform (e.g. formatNumberForExport);
 *                defaults to the raw value.
 * Every cell is run through `csvEscape`. Pure: no Blob/DOM. Backs every table export.
 */
export const buildTableCsv = ({rows, columns}) => {
    const cols = Array.isArray(columns) ? columns : [];
    const headerRow = cols.map(col => csvEscape(col.header)).join(',');

    const body = (rows ?? []).map(row =>
        cols.map(col => {
            const raw = row?.[col.field];
            const cell = col.format ? col.format(raw) : raw;
            return csvEscape(cell);
        }).join(',')
    );

    return [headerRow, ...body].join('\n');
};

/**
 * Fill missing gene symbols on `rows` from `visualization.getGeneInfo` docs.
 *
 * `geneInfoDocs` are `{_id, symbol, description}` records. For each row whose
 * `symbolField` is empty, the matching doc (by `idField` === `_id`) supplies the
 * symbol, and — when the row has no `description` — the description too. Rows that
 * already carry a symbol are left untouched. Pure (no I/O) so it is unit-testable;
 * the Meteor lookup lives in `AnalysisUtils.ensureGeneSymbols`.
 */
export const mergeSymbolsIntoRows = (rows, geneInfoDocs, {idField = 'id', symbolField = 'symbol'} = {}) => {
    const list = Array.isArray(rows) ? rows : [];
    const infoById = new Map();
    (geneInfoDocs ?? []).forEach(doc => {
        if (doc && doc._id !== undefined && doc._id !== null) {
            infoById.set(String(doc._id), doc);
        }
    });

    const hasValue = (v) => v !== null && v !== undefined && v !== '';

    return list.map(row => {
        if (hasValue(row?.[symbolField])) return row;
        const info = infoById.get(String(row?.[idField]));
        if (!info) return row;
        const merged = {...row, [symbolField]: info.symbol ?? row?.[symbolField]};
        if (!hasValue(merged.description) && hasValue(info.description)) {
            merged.description = info.description;
        }
        return merged;
    });
};

/**
 * Build the DE-genes CSV body (header + rows) as a string. Pure: no Blob/DOM.
 *
 * Emits both a `Gene ID` column and a separate `Symbol` column so the raw
 * identifier is preserved alongside the human-readable symbol.
 */
export const buildDEGenesCsv = ({deGenesData, inputType}) => {
    const columns = inputType !== 'expression'
        ? [
            {header: 'Gene ID', field: 'id'},
            {header: 'Symbol', field: 'symbol'},
            {header: 'P-value', field: 'pValue', format: formatNumberForExport},
            {header: 'Fold-Change', field: 'FC', format: formatNumberForExport},
        ]
        : [
            {header: 'Gene ID', field: 'id'},
            {header: 'Symbol', field: 'symbol'},
            {header: 'pValue.FDR', field: 'pValueFDR', format: formatNumberForExport},
            {header: 'Log2FC', field: 'FC', format: formatNumberForExport},
        ];

    return buildTableCsv({rows: deGenesData ?? [], columns});
};

// Pure, dependency-free helpers for the "genes in a GO/pathway category" viewer + export.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and can be
// imported on both client and server — including the server-side Mocha runner. All Meteor/DOM work
// (fetching gene sets, DE genes, Blob download) stays in the client; this module only turns already
// fetched data into rows / filtered lists / CSV text, so the classification and formatting are
// unit-testable without a browser.

import {buildTableCsv, formatNumberForExport} from './exportUtils';

/**
 * Index an analysis's DE-gene list (from `visualization.getDEGenes`) by gene id.
 *
 * Each DE gene is `{ _id, symbol, FC (log2), pValue, pValueFDR, description }`. The returned Map is
 * keyed by the gene id (`_id`) — a bare NCBI Entrez id (e.g. "1234"), the SAME identifier stored in
 * a GeneSet's `genes` array and in `GeneInfo._id` — so a category's member id can be looked up
 * directly to tell whether it is one of the user's DE (significant) genes and in which direction.
 * Pure.
 */
export const buildDEGenesMap = (deGenes) => {
    const map = new Map();
    (Array.isArray(deGenes) ? deGenes : []).forEach((gene) => {
        if (gene && gene._id !== undefined && gene._id !== null) {
            map.set(String(gene._id), gene);
        }
    });
    return map;
};

/**
 * Build the "significant gene" map used to mark/color a category's members, given the analysis type.
 *
 * The meaning of "significant" depends on how the analysis was run:
 *   - `ora` (the user pasted a plain gene LIST — no fold-changes): the mapped INPUT gene set IS the
 *     significant set. Values carry no FC, so up/down are not applicable.
 *   - everything else (`expression`, `pgsea`): the analysis's DE gene set from `getDEGenes`, whose
 *     records carry FC (log2) for up/down direction.
 *
 * Returns a Map keyed by bare Entrez id. Pure — the Meteor fetch that supplies `deGenes` /
 * `mappedInput` lives in the client `geneSetGenesData` layer.
 */
export const buildSignificanceMap = ({inputType, deGenes, mappedInput} = {}) => {
    if (inputType === 'ora') {
        const map = new Map();
        (Array.isArray(mappedInput) ? mappedInput : []).forEach((id) => {
            if (id !== undefined && id !== null) map.set(String(id), {significant: true});
        });
        return map;
    }
    return buildDEGenesMap(deGenes);
};

/**
 * Turn a category's raw member gene ids into display/export rows.
 *
 * - `symbol` falls back to the raw id when the id is not resolvable (data-driven, never blank).
 * - `significant` = the gene is in `deGenesMap` (i.e. it is one of the analysis's DE genes; the DE
 *   set is already thresholded server-side).
 * - `up` / `down` = significant AND the log2 fold-change sign (FC > 0 / FC < 0). A significant gene
 *   with FC exactly 0 (degenerate) counts as neither up nor down.
 *
 * `geneInfoDocs` are `{_id, symbol, description}` records from `visualization.getGeneInfo`. Pure.
 */
export const buildGeneRows = (memberIds, geneInfoDocs, deGenesMap) => {
    const ids = Array.isArray(memberIds) ? memberIds : [];
    const deMap = deGenesMap instanceof Map ? deGenesMap : new Map();

    const infoById = new Map();
    (Array.isArray(geneInfoDocs) ? geneInfoDocs : []).forEach((doc) => {
        if (doc && doc._id !== undefined && doc._id !== null) {
            infoById.set(String(doc._id), doc);
        }
    });

    const seen = new Set();
    const rows = [];
    ids.forEach((rawId) => {
        const id = String(rawId);
        if (seen.has(id)) return; // a member gene id appears at most once
        seen.add(id);

        const info = infoById.get(id);
        const de = deMap.get(id);
        const significant = !!de;
        const FC = de && de.FC !== undefined && de.FC !== null ? de.FC : null;

        rows.push({
            id,
            symbol: (info && info.symbol) || (de && de.symbol) || id,
            description: (info && info.description) || (de && de.description) || '',
            FC,
            pValue: de && de.pValue !== undefined ? de.pValue : null,
            pValueFDR: de && de.pValueFDR !== undefined ? de.pValueFDR : null,
            significant,
            up: significant && FC !== null && FC > 0,
            down: significant && FC !== null && FC < 0,
        });
    });
    return rows;
};

// Which rows a given export/highlight "mode" selects.
const MODE_PREDICATES = {
    all: () => true,
    de: (r) => r.significant,
    up: (r) => r.up,
    down: (r) => r.down,
};

/**
 * Case-insensitive substring filter over gene rows, matching either the symbol or the raw id.
 * Mirrors the Name-column filter used in the result tables (`AnalysisResult.jsx:430-433`); no regex
 * (invalid user input can't throw). Empty/blank query returns the rows unchanged. Pure.
 */
export const filterGeneRows = (rows, query) => {
    const list = Array.isArray(rows) ? rows : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(
        (r) =>
            String(r.symbol || '').toLowerCase().includes(q) ||
            String(r.id || '').toLowerCase().includes(q)
    );
};

/**
 * Join the symbols of the rows matching `mode` (`all` | `de` | `up` | `down`) into a single
 * `;`-separated string — used to build the per-category `Genes` / `DE Genes` / `Up-regulated` /
 * `Down-regulated` columns appended to the whole-table CSV export. Pure.
 */
export const joinGeneSymbols = (rows, mode = 'all') => {
    const list = Array.isArray(rows) ? rows : [];
    const predicate = MODE_PREDICATES[mode] || MODE_PREDICATES.all;
    return list
        .filter(predicate)
        .map((r) => r.symbol)
        .join(';');
};

// 'x' tick for a boolean marker column; blank when false.
const mark = (v) => (v ? 'x' : '');

/**
 * Build the per-category gene CSV (one row per member gene of the whole list) with the x-marked
 * Significant / Up / Down columns. Reuses `buildTableCsv` (RFC-4180 escaping) and
 * `formatNumberForExport` (no precision loss) from exportUtils. Pure: no Blob/DOM. `categoryName`
 * is accepted for symmetry but not embedded (a single-category file); the caller names the file.
 */
export const buildPathwayGeneCsv = (rows /* , {categoryName} = {} */) => {
    const columns = [
        {header: 'Symbol', field: 'symbol'},
        {header: 'Gene ID', field: 'id'},
        {header: 'Log2FC', field: 'FC', format: formatNumberForExport},
        {header: 'pValue', field: 'pValue', format: formatNumberForExport},
        {header: 'pValue.FDR', field: 'pValueFDR', format: formatNumberForExport},
        {header: 'Significant', field: 'significant', format: mark},
        {header: 'Up', field: 'up', format: mark},
        {header: 'Down', field: 'down', format: mark},
    ];
    return buildTableCsv({rows: Array.isArray(rows) ? rows : [], columns});
};

/**
 * Summary counts for the drawer header ("N genes · S significant · U up · D down"). Pure.
 */
export const summarizeGeneRows = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    return {
        total: list.length,
        significant: list.filter((r) => r.significant).length,
        up: list.filter((r) => r.up).length,
        down: list.filter((r) => r.down).length,
    };
};

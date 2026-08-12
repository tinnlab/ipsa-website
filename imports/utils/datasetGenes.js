// Pure, dependency-free mapping of an analysis's DE-gene rows into the gene shape the
// external interpretation pipeline expects.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and
// importable on both client and server — including the server-side Mocha runner.
//
// Background: the meta-analysis payload's `datasets[].genes` used to be built by reading the
// `volcanoPlotData` snapshot and mapping `gene.gene` / `gene.log2FoldChange` / `gene.pvalue` /
// `gene.padj`. No stored `volcanoPlotData` row has ever carried those field names — the rows
// carry `id`/`FC`/`pValue`/`pValueFDR` — so every gene degraded to a numeric Entrez id as its
// "symbol" with foldChange 0 and pValue/pValueFDR 1. That type-checks against the pipeline's
// GeneInput model, so nothing rejected it; downstream, the reproducibility step keys datasets
// by gene symbol, so numeric ids matched nothing and every meta gene was reported as
// meta-unique.
//
// The genes now come from the `DEGenes` snapshot — the same source `/api/deGenes` serves to
// the DE-genes table in the AI-interpretation view — which already carries resolved symbols.

// Coerce to a finite number, tolerating numeric strings. Returns undefined for anything else
// (including '' — Number('') is 0, which must not become a fold change of 0).
const toFinite = (v) => {
    if (typeof v === 'string') {
        const s = v.trim();
        if (s === '') return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
    }
    return Number.isFinite(v) ? v : undefined;
};

// A gene symbol, or null when the row has none. Deliberately does NOT fall back to the row's
// numeric id: sending an Entrez id where a symbol is expected is silent corruption, and
// silence is exactly how the original defect survived.
const readSymbol = (row) => {
    const symbol = row?.symbol;
    if (typeof symbol === 'string') {
        const s = symbol.trim();
        return s === '' ? null : s;
    }
    // A numeric-looking `symbol` is still a symbol the upstream mapper chose to store.
    if (Number.isFinite(symbol)) return String(symbol);
    return null;
};

/**
 * Map DE-gene rows to the pipeline's gene shape.
 *
 * Handles the `DEGenes` snapshot shapes, all of which carry `symbol` plus `FC` and — for some
 * analyses — `pValue`/`pValueFDR`. Analyses whose snapshot has no p-values fall back to 1,
 * matching the AI-interpretation table, which omits those columns for exactly those analyses.
 *
 * Rows with no `symbol` are DROPPED and counted, never mapped onto their id. This is the
 * metaDE gene-level shape (`{ID, logFC, pValue, pFDR}`), which `getDEGenes` returns from its
 * meta-analysis branch — a branch an individual mass-analysis dataset should never take, but
 * one that must fail loudly rather than quietly re-create the original bug.
 *
 * Never mutates the input.
 *
 * @param {Array<object>} rows DE-gene rows ({symbol, FC, pValue, pValueFDR, ...})
 * @returns {{genes: Array<object>, total: number, symbolless: number, sampleKeys: Array<string>}}
 */
export function mapDatasetGenes(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const sampleKeys = Object.keys(list[0] || {});

    const genes = [];
    let symbolless = 0;

    list.forEach((row) => {
        const geneSymbol = readSymbol(row);
        if (!geneSymbol) {
            symbolless += 1;
            return;
        }
        genes.push({
            geneSymbol,
            // `FC` is log2 for the expression/pgsea analyses this path serves, matching the
            // table's Log2FC column.
            foldChange: toFinite(row.FC) ?? 0,
            pValue: toFinite(row.pValue) ?? 1,
            pValueFDR: toFinite(row.pValueFDR) ?? 1,
        });
    });

    return {genes, total: list.length, symbolless, sampleKeys};
}

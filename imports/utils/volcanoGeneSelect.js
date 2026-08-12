// Pure, dependency-free helpers for the gene volcano plot's "focus / isolate"
// feature: parsing a pasted gene list, matching typed/pasted tokens to genes, and
// computing the quick-preset selections.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported by the server-side Mocha runner, exactly like geneSelection.js
// and exportUtils.js.
//
// A "volcano gene" is the plot's row shape used by VolcanoChartGene:
//   { id, name, FC, pValue }
//     - id     : bare gene id (Entrez) — what is shown/exported
//     - name   : display symbol (falls back to id when unmapped)
//     - FC     : log2 fold change
//     - pValue : the significance p-value already chosen upstream
//                (FDR for expression inputs, raw p otherwise) — matches
//                VolcanoChartGene's `volcanoPlotData` memo.
//
// NOTE on the significance predicate: `classifyGene` intentionally mirrors the
// EXACT up/down/non-significant test the volcano plot colours points with
// (`pValue <= p && FC >= fc` / `<= -fc`, inclusive). We do NOT reuse
// geneSelection.js's filterGenes/selectTopGenes here because those operate on a
// different field shape (`foldChange`/`pValueFDR`) and use strict inequalities,
// so their "significant" set would diverge from what the user sees coloured on
// the plot. Keeping one predicate guarantees presets match the plot exactly.

/**
 * Classify a volcano gene against the DE thresholds, using the same inclusive
 * predicate the plot colours with.
 * @returns {'up'|'down'|'nonsig'}
 */
export function classifyGene(gene, { maxAdjustedPValue, minLogFoldChange } = {}) {
    if (!gene) return 'nonsig';
    const p = Number(maxAdjustedPValue);
    const fc = Number(minLogFoldChange);
    const gp = gene.pValue;
    const gfc = gene.FC;
    if (!Number.isFinite(gp) || !Number.isFinite(gfc)) return 'nonsig';
    if (gp <= p && gfc >= fc) return 'up';
    if (gp <= p && gfc <= -fc) return 'down';
    return 'nonsig';
}

/**
 * Split a free-text gene list (typed or pasted) into distinct tokens. Accepts any
 * mix of commas, semicolons, and whitespace (spaces, tabs, newlines) as separators.
 * Trims each token, drops empties, and de-duplicates case-insensitively while
 * preserving the first-seen original casing.
 * @param {string} text
 * @returns {string[]}
 */
export function parseGeneQuery(text) {
    if (!text || typeof text !== 'string') return [];
    const seen = new Set();
    const out = [];
    for (const raw of text.split(/[\s,;]+/)) {
        const tok = raw.trim();
        if (!tok) continue;
        const key = tok.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tok);
    }
    return out;
}

/**
 * Match a list of tokens against the gene list by id OR display symbol
 * (case-insensitive). Returns the matched gene ids (de-duplicated, in first-seen
 * order) and the tokens that matched nothing, so the UI can report e.g.
 * "3 of 50 genes not found".
 *
 * When a token could match both an id and a (different gene's) symbol, the id
 * mapping wins: ALL ids are indexed before any symbol, so a token that is some
 * gene's id resolves to that gene even if it is another gene's symbol.
 *
 * @param {string[]} tokens
 * @param {Array<{id:*, name?:string}>} volcanoPlotData
 * @returns {{matchedIds: Array, unmatched: string[]}}
 */
export function matchGenesToSelection(tokens, volcanoPlotData) {
    const rows = volcanoPlotData || [];
    const byKey = new Map(); // lowercase id|symbol -> gene id
    // Pass 1: all ids (so ids take precedence over any colliding symbol).
    for (const g of rows) {
        if (!g || g.id == null) continue;
        const idKey = String(g.id).toLowerCase();
        if (!byKey.has(idKey)) byKey.set(idKey, g.id);
    }
    // Pass 2: symbols, without overwriting an id key.
    for (const g of rows) {
        if (!g || g.id == null || g.name == null) continue;
        const nameKey = String(g.name).toLowerCase();
        if (!byKey.has(nameKey)) byKey.set(nameKey, g.id);
    }

    const matchedIds = [];
    const matchedSeen = new Set();
    const unmatched = [];
    for (const tok of tokens || []) {
        const id = byKey.get(String(tok).toLowerCase());
        if (id == null) {
            unmatched.push(tok);
            continue;
        }
        if (!matchedSeen.has(id)) {
            matchedSeen.add(id);
            matchedIds.push(id);
        }
    }
    return { matchedIds, unmatched };
}

// Keep only genes matching a direction ('up' | 'down' | 'both') under the thresholds.
function filterByDirection(volcanoPlotData, deSettings, direction) {
    return (volcanoPlotData || []).filter((g) => {
        const cls = classifyGene(g, deSettings);
        if (direction === 'up') return cls === 'up';
        if (direction === 'down') return cls === 'down';
        return cls === 'up' || cls === 'down';
    });
}

/**
 * All significant gene ids in the given direction ('up' | 'down' | 'both').
 * @returns {Array} gene ids
 */
export function selectSignificantGeneIds(volcanoPlotData, deSettings, direction = 'both') {
    return filterByDirection(volcanoPlotData, deSettings, direction).map((g) => g.id);
}

// Non-finite p-values rank last so they never occupy the "top" slots.
const rankP = (v) => (Number.isFinite(v) ? v : Number.POSITIVE_INFINITY);

/**
 * The top `topN` significant gene ids (by smallest p-value first) in the given
 * direction. Never mutates the input.
 * @returns {Array} at most `topN` gene ids, most-significant first
 */
export function selectTopSignificantGeneIds(volcanoPlotData, deSettings, topN, direction = 'both') {
    const sig = filterByDirection(volcanoPlotData, deSettings, direction);
    const sorted = [...sig].sort((a, b) => rankP(a.pValue) - rankP(b.pValue));
    const n = Number.parseInt(topN, 10);
    return sorted.slice(0, Number.isFinite(n) && n > 0 ? n : 0).map((g) => g.id);
}

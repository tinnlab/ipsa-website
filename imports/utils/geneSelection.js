// Pure, dependency-free helpers for filtering and selecting DE genes.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and can be imported on both client and server — including the server-side Mocha runner.
//
// Single source of truth for the AI-interpretation "DE Genes" selection controls
// in AnalysisWizard.jsx:
//   - "Select top N genes with FDR < X and |Log2FC| > Y"  -> selectTopGenes()
//   - "Use all DE Genes" (the analysis's significant DE gene set) -> selectAnalysisDEGenes()
//
// A gene object looks like {id, name, foldChange, pValue, pValueFDR, ...}.

import { selectGenesForExport } from './exportUtils';

export const DEFAULT_GENE_TOP_N = 5;

// Missing / non-finite p-values rank "worst" (last) so they never occupy the top.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY);

/**
 * Genes passing the DE thresholds: FDR strictly below `fdr` AND |Log2FC| strictly
 * above `fc`. Non-finite values (missing/NaN/±Infinity) are normalized so the
 * thresholds behave sensibly and, crucially, so the "select all" sentinel
 * (`fdr: Infinity, fc: -Infinity`) genuinely keeps EVERY gene:
 *   - a non-finite FDR is treated as 1 (not significant) — excluded by a real
 *     FDR filter, but `1 < Infinity` keeps it under the select-all sentinel.
 *   - a non-finite |Log2FC| is treated as magnitude 0 — excluded by a real
 *     positive FC filter, but `0 > -Infinity` keeps it under the sentinel.
 * Never mutates the input.
 */
export function filterGenes(genes, { fdr, fc } = {}) {
    return (genes || []).filter((g) => {
        const gFdr = Number.isFinite(g?.pValueFDR) ? g.pValueFDR : 1;
        const gAbsFc = Number.isFinite(g?.foldChange) ? Math.abs(g.foldChange) : 0;
        return gFdr < fdr && gAbsFc > fc;
    });
}

/**
 * Top `topN` genes that pass the FDR/|Log2FC| thresholds, ranked by pValue
 * ascending (smallest p-value first; missing p-values sort last). Never mutates
 * the input.
 *
 * @param {Array<object>} genes
 * @param {{fdr:number, fc:number, topN:number|string}} opts
 * @returns {Array<object>} at most `topN` genes, in ranked order
 */
export function selectTopGenes(genes, { fdr, fc, topN } = {}) {
    const filtered = filterGenes(genes, { fdr, fc });
    const sorted = filtered.sort((a, b) => num(a.pValue) - num(b.pValue));
    const count = Number.parseInt(topN, 10);
    return sorted.slice(0, Number.isFinite(count) && count > 0 ? count : 0);
}

/**
 * The thresholds "Use all DE Genes" must apply: the analysis's ORIGINAL DE definition (captured
 * when the analysis was created), so the button always yields the "DE genes from the beginning"
 * regardless of how the user later tunes the volcano plot. getConfigurations surfaces the
 * original snapshot values as `originalMaxAdjustedPValue`/`originalMinLogFoldChange` and the live
 * (working, volcano-tuned) values as `maxAdjustedPValue`/`minLogFoldChange`. Falls back to the
 * working value for meta-analyses / legacy configs that carry no original snapshot threshold.
 *
 * @param {object} config a wizard config object
 * @returns {{maxAdjustedPValue: *, minLogFoldChange: *}}
 */
export function originalDEThresholds(config = {}) {
    const cfg = config || {};
    return {
        maxAdjustedPValue: cfg.originalMaxAdjustedPValue ?? cfg.maxAdjustedPValue,
        minLogFoldChange: cfg.originalMinLogFoldChange ?? cfg.minLogFoldChange,
    };
}

/**
 * Stamp a DE-threshold value read from the AnalysisConfigSnapshot onto a config: it sets BOTH the
 * immutable original (`originalMaxAdjustedPValue`/`originalMinLogFoldChange`, used by "Use all DE
 * Genes") AND the working default (`maxAdjustedPValue`/`minLogFoldChange`, later overlaid with the
 * live value). Keeping these two writes in one place guarantees the original is always captured
 * alongside the default, so the volcano-tuning regression (working overwriting the original)
 * cannot reappear. No-op for non-DE keys. Mutates and returns `config`.
 */
export function stampSnapshotThreshold(config, key, value) {
    if (!config) return config;
    if (key === 'maxAdjustedPValue') {
        config.originalMaxAdjustedPValue = value;
        config.maxAdjustedPValue = value;
    } else if (key === 'minLogFoldChange') {
        config.originalMinLogFoldChange = value;
        config.minLogFoldChange = value;
    }
    return config;
}

/**
 * Overlay the WORKING DE thresholds (from live AnalysisConfig rows) onto each config's
 * `maxAdjustedPValue`/`minLogFoldChange`, so the volcano plot reflects the user's persisted
 * tuning while the snapshot-derived `originalMaxAdjustedPValue`/`originalMinLogFoldChange` stay
 * the immutable original DE definition. Matches rows on the (analysisId, inputType) pair — the
 * same key every other AnalysisConfig access uses — so a stray row from a different inputType
 * never bleeds across. A (analysisId, inputType) with no live row keeps the config's default
 * (the original). Mutates and returns `allConfigs`. Pure w.r.t. the row list; extracted from
 * getConfigurations so it is unit-testable without a live Mongo.
 *
 * @param {Object<string,object>} allConfigs config objects keyed by analysisId (each has inputType)
 * @param {Array<{analysisId:string, inputType?:string, key:string, value:*}>} liveRows
 * @returns {Object<string,object>} allConfigs (mutated)
 */
export function applyLiveDEThresholdOverlay(allConfigs, liveRows) {
    const byKey = {};
    for (const r of liveRows || []) {
        if (!r || (r.key !== 'maxAdjustedPValue' && r.key !== 'minLogFoldChange')) continue;
        const k = `${r.analysisId}|${r.inputType}`;
        (byKey[k] = byKey[k] || {})[r.key] = r.value;
    }
    for (const id in (allConfigs || {})) {
        const cfg = allConfigs[id];
        if (!cfg) continue;
        const live = byKey[`${id}|${cfg.inputType}`];
        if (!live) continue;
        if (live.maxAdjustedPValue !== undefined) cfg.maxAdjustedPValue = live.maxAdjustedPValue;
        if (live.minLogFoldChange !== undefined) cfg.minLogFoldChange = live.minLogFoldChange;
    }
    return allConfigs;
}

/**
 * The analysis's DE gene set — the genes the user filtered before running pathway
 * analysis. This is what the "Use all DE Genes" button selects. It reuses the exact
 * predicate the volcano plot's "Export DE genes" uses (`selectGenesForExport` mode
 * 'de': `pValueFDR <= maxAdjustedPValue && |FC| >= minLogFoldChange`), so the AI
 * selection matches the volcano export and the server-side DEGenes build.
 *
 * The wizard's gene objects use `foldChange` (log2) where `selectGenesForExport`
 * expects `FC`, so we map that field. Thresholds default to the analysis defaults
 * (0.05 / 0.5) when a config doesn't carry them (e.g. meta-analyses). Never mutates
 * the input.
 *
 * @param {Array<object>} genes wizard gene objects ({id, name, foldChange, pValueFDR, ...})
 * @param {{maxAdjustedPValue?: number|string, minLogFoldChange?: number|string}} thresholds
 * @returns {Array<object>} the DE genes, in the wizard's gene shape
 */
export function selectAnalysisDEGenes(genes, { maxAdjustedPValue, minLogFoldChange } = {}) {
    const fdr = Number(maxAdjustedPValue);
    const fc = Number(minLogFoldChange);
    const withFC = (genes || []).map((g) => ({ ...g, FC: g.foldChange }));
    return selectGenesForExport(withFC, {
        mode: 'de',
        maxAdjustedPValue: Number.isFinite(fdr) ? fdr : 0.05,
        minLogFoldChange: Number.isFinite(fc) ? fc : 0.5,
    }).map(({ FC, ...rest }) => rest); // drop the temporary FC alias; keep the wizard shape
}

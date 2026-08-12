// Pure, dependency-free helpers for fold-change units.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral
// and importable on both client and server — including the server-side Mocha runner.
//
// Background: the differential-expression `FC` field is inconsistent by analysis type:
//   - expression/limma analyses store a LOG2 value in `FC` (limma's `logFC` is just
//     renamed to `FC`),
//   - meta-analyses store a LINEAR value in `FC` (`2^logFC`) alongside the log2 value
//     in `logFC`.
// Almost every consumer (volcano plot axes/thresholds, DE-gene export, gene counts,
// AI summary, the AI-interpretation DE Genes table) assumes `FC` is log2, so meta rows
// are misread. This helper makes a meta gene list carry a LOG2 value in `FC`, matching
// what the gene heatmap already does manually (`FC: e.logFC`).

/**
 * Return a copy of a META-analysis gene list with `FC` set to the log2 fold change.
 *
 * Meta rows carry the exact log2 value in `logFC`, so we prefer that. If `logFC` is
 * absent we recover it from the linear `FC` (`2^logFC` ⇒ `log2(FC)`), guarding against
 * non-positive `FC` (linear FC is always > 0, so this only trips on bad data). Rows
 * that offer neither a finite `logFC` nor a positive `FC` are passed through untouched.
 *
 * IMPORTANT: only apply this to META genes. Expression `FC` is already log2, and PGSEA
 * `FC` is a user-provided statistic of unknown unit — neither should be run through here.
 *
 * Never mutates the input.
 *
 * @param {Array<object>} genes meta gene objects ({FC, logFC, pValueFDR, ...})
 * @returns {Array<object>}
 */
export function normalizeMetaFoldChange(genes) {
    // Coerce numeric strings (defensive — R/JSON yields numbers, but a stringified
    // logFC must still win over the linear FC rather than silently falling through).
    const toFinite = (v) => {
        if (typeof v === 'string') {
            const s = v.trim();
            if (s === '') return undefined; // Number('') === 0 — don't let a blank become FC:0
            const n = Number(s);
            return Number.isFinite(n) ? n : undefined;
        }
        return Number.isFinite(v) ? v : undefined;
    };
    return (genes || []).map((g) => {
        const logFC = toFinite(g?.logFC);
        if (logFC !== undefined) return { ...g, FC: logFC };
        const fc = toFinite(g?.FC);
        if (fc !== undefined && fc > 0) return { ...g, FC: Math.log2(fc) };
        return g;
    });
}

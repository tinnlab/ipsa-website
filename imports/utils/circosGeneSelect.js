// Pure, dependency-free helpers that build the Circos plot's node + relation graph:
// mapping pathway gene ids to symbols, ranking and CAPPING the gene set, honouring a
// user "highlight" set, and emitting positionally-correct node ids.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and
// can be imported by the server-side Mocha runner, exactly like geneSelection.js,
// volcanoGeneSelect.js and plotDisplayState.js.
//
// WHY THIS EXISTS: circos-d3 allocates a dense N x N chord matrix over every node (see the
// `matrix` build in its drawChart), so an uncapped gene set is quadratic in memory AND
// illegible on an 800px circle. Before this module the Circos tab rendered EVERY
// differentially expressed gene of every displayed pathway.
//
// NOTE the target is not an absolute bound: the guarantees below can raise it, and the
// pathway-count control has no upper limit of its own, so N is bounded by the pathway count
// rather than by the gene target. That is a large improvement on "every gene", not a hard cap.
//
// A "DE gene" here is the CircosChartTable row shape (built by updateNewDEGenes in
// Visualization/index.jsx from /api/fcPValueData joined to visualization.getGeneInfo):
//   { _id, symbol, FC, pValueFDR, taxId, description }
//     - _id       : Entrez id string — the key pathway.genes is expressed in
//     - symbol    : display name; ALSO the only join key left after the id->symbol mapping
//     - FC        : log2 fold change
//     - pValueFDR : the ONLY p-value on this shape. The raw pValue exists upstream in
//                   fcPValueData but updateNewDEGenes does not copy it, so ranking on
//                   `pValue` would see undefined for every gene and degenerate into
//                   arrival order. Rank on pValueFDR.
//
// NOTE on non-reuse: volcanoGeneSelect.js works on { id, name, FC, pValue } with inclusive
// inequalities, geneSelection.js on { foldChange, pValueFDR } with strict ones (and it is
// not dependency-free — it imports ./exportUtils). Neither shape matches, and neither owns
// a graph builder. For the same reason volcanoGeneSelect.js:18-24 gives for not reusing
// geneSelection.js, this is a third module rather than a shape-sniffing one.
//
// RENDERER CONTRACT: a gene node MUST NOT carry a `color` field. circos-d3's chord
// gradient stops read `node.color || getGeneColor(node.logFC)` (index.js:193/197) — an
// untagged fallback — so a colour on a gene node would REPLACE its fold-change colour in
// every chord touching it, which is the opposite of what highlighting should do.
// Highlights are marked with the boolean `highlighted`; the renderer branches on
// `type`/`highlighted` and emphasises via arc outline, label weight and a gentle dim.

/** Default gene target. Chosen so the label ring (radius ~305px, 10px font => ~170 labels
 *  before they physically collide) stays comfortably legible alongside the pathway arcs. */
export const DEFAULT_CIRCOS_GENE_TOP_N = 15;

/** Sentinel accepted by normalizeGeneCap meaning "no cap" (the pre-cap behaviour). */
export const UNCAPPED = Number.POSITIVE_INFINITY;

// Missing / non-finite FDR ranks worst (last) so it never occupies a capped slot.
const rankP = (v) => (Number.isFinite(v) ? v : Number.POSITIVE_INFINITY);
// Missing / non-finite |FC| ranks worst under a DESCENDING magnitude tie-break.
const rankFC = (v) => (Number.isFinite(v) ? Math.abs(v) : Number.NEGATIVE_INFINITY);
// Codepoint compare. Deliberately NOT localeCompare: unlike a user-facing display sort this
// is an internal determinism device and must be bit-identical in the browser and in the
// server-side test runner, regardless of the runtime's ICU data.
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Total ascending order over DE genes: smallest pValueFDR first (non-finite last),
 * tie-broken by largest |log2FC|, then symbol A->Z, then _id.
 *
 * The tie-break is load-bearing, not decoration: BH-adjusted p-values tie heavily (a whole
 * plateau of genes can share one float), so the tie-break decides the plot far more often
 * than intuition suggests. The trailing symbol/_id keys make the order TOTAL, so the
 * selection never depends on Array#sort stability nor on the arrival order of DEGenes,
 * which comes from an unordered Meteor.callAsync('visualization.getGeneInfo').
 *
 * Written with comparisons rather than subtraction on purpose: `rankP(a) - rankP(b)` is
 * NaN when both p-values are non-finite, and a NaN comparator result silently corrupts the
 * sort. (volcanoGeneSelect.js:141 has that latent form; it is benign only because V8
 * coerces NaN to 0. Do not copy it.)
 *
 * @param {{pValueFDR?:number, FC?:number, symbol?:string, _id?:*}} a
 * @param {{pValueFDR?:number, FC?:number, symbol?:string, _id?:*}} b
 * @returns {number} negative if a ranks first, positive if b does, 0 only if fully equal
 */
export function compareGenesByRank(a, b) {
    const pa = rankP(a && a.pValueFDR);
    const pb = rankP(b && b.pValueFDR);
    if (pa !== pb) return pa < pb ? -1 : 1;

    const fa = rankFC(a && a.FC);
    const fb = rankFC(b && b.FC);
    if (fa !== fb) return fa > fb ? -1 : 1; // larger |log2FC| first

    const ds = cmpStr(String((a && a.symbol) ?? ''), String((b && b.symbol) ?? ''));
    if (ds !== 0) return ds;

    return cmpStr(String((a && a._id) ?? ''), String((b && b._id) ?? ''));
}

/**
 * Normalize the gene target coming from the UI.
 *
 *   40 | "40"        -> 40
 *   "40abc"          -> 40   (Number.parseInt, matching selectTopGenes' tolerance)
 *   "7.9"            -> 7
 *   0 | -5 | "" | "abc" | null | undefined | NaN -> DEFAULT_CIRCOS_GENE_TOP_N
 *   Infinity | "all" -> UNCAPPED
 *
 * Note the deliberate divergence from selectTopSignificantGeneIds, which returns [] for an
 * unusable topN: there an empty preset is harmless, here an empty gene set blanks the whole
 * chart. An unusable value means "the caller gave no usable target", so we fall back to the
 * default rather than rendering nothing.
 *
 * @param {number|string|undefined|null} topN
 * @returns {number} a positive integer, or UNCAPPED
 */
export function normalizeGeneCap(topN) {
    if (topN === UNCAPPED || topN === 'all') return UNCAPPED;
    const n = Number.parseInt(topN, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CIRCOS_GENE_TOP_N;
}

/**
 * Replace each pathway's Entrez gene id list with the SYMBOLS of the DE genes it contains,
 * dropping ids that are not differentially expressed. Lifted out of CircosChartTable's
 * build effect, which wrapped it in an `await Promise.all(... async ...)` with no await
 * inside. Never mutates the input.
 *
 * An empty `genes` array in the output is normal and pre-existing: a displayed pathway may
 * contain no DE gene at all.
 *
 * @param {Array<{id:*, name?:string, genes?:Array<*>}>} rawPathways as returned by geneSet.getInfo
 * @param {Array<{_id:*, symbol?:string}>} deGenes
 * @returns {Array<object>} the same pathway objects with `genes` as symbol strings
 */
export function mapPathwayGenesToSymbols(rawPathways, deGenes) {
    const byId = new Map();
    for (const g of deGenes || []) {
        if (g && g._id !== undefined && g._id !== null) byId.set(g._id, g);
    }
    return (rawPathways || []).map((p) => ({
        ...p,
        genes: ((p && p.genes) || [])
            .filter((geneId) => byId.has(geneId))
            .map((geneId) => byId.get(geneId).symbol)
            // A GeneInfo row with no symbol would otherwise become a node named `undefined`
            // that no relation could ever match.
            .filter((s) => s !== undefined && s !== null && s !== ''),
    }));
}

// Normalize a highlight token for matching: string, trimmed, lower-cased.
const highlightKeyOf = (raw) => String(raw).trim().toLowerCase();

/**
 * Choose which DE genes get a node, honouring the target, the highlight set, and the
 * per-pathway coverage guarantee. Never mutates the inputs.
 *
 * Order of operations:
 *   1. Candidates := DE genes whose symbol appears in at least one displayed pathway.
 *   2. De-duplicate candidates by SYMBOL, keeping the best-ranked row. After the id->symbol
 *      mapping the symbol is the only join key left, so a second row sharing a symbol can
 *      never receive a chord — today it renders as a duplicate label on a zero-width arc.
 *   3. Guarantee set := every PRESENT highlighted symbol, then (when
 *      guaranteeOnePerPathway) the best-ranked gene of each pathway not already covered,
 *      swept in pathway display order so overlapping pathways share rather than each
 *      paying for one.
 *   4. appliedCap := max(normalizeGeneCap(topN), guarantee.size). Guarantees always win: a
 *      highlight the cap discards is a bug, and a cap that orphans a pathway arc defeats
 *      the plot's purpose. The overshoot is reported, never silent.
 *   5. Fill the remaining slots from global rank order.
 *
 * @param {Array<{id:*, genes:string[]}>} pathways symbol-mapped pathways, in display order
 * @param {Array<{_id:*, symbol:string, FC:number, pValueFDR:number}>} deGenes
 * @param {Object}  [options]
 * @param {number|string} [options.topN] gene target; see normalizeGeneCap
 * @param {Iterable<string>} [options.highlightedSymbols] matched case-insensitively
 * @param {boolean} [options.guaranteeOnePerPathway=true]
 * @returns {{genes: Array<object>, stats: Object}} genes in RANK ORDER (best first)
 */
export function selectCircosGenes(pathways, deGenes, options = {}) {
    const {topN, highlightedSymbols, guaranteeOnePerPathway = true} = options || {};
    const paths = Array.isArray(pathways) ? pathways : [];
    const rows = Array.isArray(deGenes) ? deGenes : [];

    // 1. candidates
    const inAnyPathway = new Set();
    for (const p of paths) for (const s of (p && p.genes) || []) inAnyPathway.add(s);
    const candidates = rows.filter(
        (g) => g && g.symbol !== undefined && g.symbol !== null && inAnyPathway.has(g.symbol)
    );

    // 2. de-duplicate by symbol, best rank wins
    const bestBySymbol = new Map();
    const duplicateSymbolsDropped = [];
    for (const g of candidates) {
        const prev = bestBySymbol.get(g.symbol);
        if (prev === undefined) {
            bestBySymbol.set(g.symbol, g);
            continue;
        }
        duplicateSymbolsDropped.push(g.symbol);
        if (compareGenesByRank(g, prev) < 0) bestBySymbol.set(g.symbol, g);
    }
    const ranked = [...bestBySymbol.values()].sort(compareGenesByRank);
    const rankIndex = new Map(ranked.map((g, i) => [g.symbol, i]));

    const requestedCap = normalizeGeneCap(topN);
    // Which symbols plain ranking alone would have selected — the baseline against which
    // "pinned" and "coverage" are attributed, so the caption can name a cause.
    const wouldRank = new Set(
        (Number.isFinite(requestedCap) ? ranked.slice(0, requestedCap) : ranked).map((g) => g.symbol)
    );

    // 3a. highlights. Matching is case-insensitive for convenience (users paste `tp53`), but an
    // EXACT match always wins: two DE rows whose symbols differ only by case (TP53 / Tp53) are
    // distinct genes, and folding them together would resolve a highlight to the WRONG gene and
    // silently drop the other — with no not-found report. A highlight the selection discards is
    // the one bug this feature must not have.
    const canonicalByKey = new Map();
    for (const symbol of bestBySymbol.keys()) {
        const key = highlightKeyOf(symbol);
        if (!canonicalByKey.has(key)) canonicalByKey.set(key, symbol);
    }
    const keep = new Set();
    const highlightedKept = [];
    const highlightedNotFound = [];
    const seenToken = new Set();
    for (const raw of highlightedSymbols || []) {
        if (raw === undefined || raw === null) continue;
        const token = String(raw).trim();
        if (token === '') continue;
        if (seenToken.has(token)) continue;
        seenToken.add(token);
        const canonical = bestBySymbol.has(token) ? token : canonicalByKey.get(highlightKeyOf(token));
        if (canonical === undefined) {
            highlightedNotFound.push(token);
            continue;
        }
        // Two spellings of the same gene collapse to one node, but two genuinely different
        // genes never do.
        if (keep.has(canonical)) continue;
        highlightedKept.push(canonical);
        keep.add(canonical);
    }
    const pinnedHighlightCount = highlightedKept.filter((s) => !wouldRank.has(s)).length;

    // 3b. per-pathway coverage sweep, display order, incremental
    const emptyPathwayIds = [];
    const coverageAdded = [];
    for (const p of paths) {
        const genes = ((p && p.genes) || []).filter((s) => rankIndex.has(s));
        if (genes.length === 0) {
            emptyPathwayIds.push(p && p.id);
            continue;
        }
        if (!guaranteeOnePerPathway) continue;
        if (genes.some((s) => keep.has(s))) continue; // already covered
        let best = genes[0];
        for (const s of genes) if (rankIndex.get(s) < rankIndex.get(best)) best = s;
        keep.add(best);
        coverageAdded.push(best);
    }
    const coverageGeneCount = coverageAdded.filter((s) => !wouldRank.has(s)).length;

    // 4. cap — guarantees always win
    const appliedCap = Math.max(requestedCap, keep.size);

    // 5. fill the remainder from global rank order
    for (const g of ranked) {
        if (keep.size >= appliedCap) break;
        keep.add(g.symbol);
    }

    const genes = ranked.filter((g) => keep.has(g.symbol));

    return {
        genes,
        stats: {
            requestedCap,
            appliedCap,
            capRaised: appliedCap > requestedCap,
            totalCandidateGenes: ranked.length,
            selectedGeneCount: genes.length,
            droppedGeneCount: ranked.length - genes.length,
            pinnedHighlightCount,
            coverageGeneCount,
            highlightedKept,
            highlightedNotFound,
            duplicateSymbolsDropped,
            emptyPathwayIds,
            // NOTE: no `orphanPathwayIds` here — only buildCircosGraph knows which pathways
            // ended up with no chord. Returning a placeholder [] would be a permanent lie to
            // anyone calling this function directly.
        },
    };
}

/**
 * Build the complete Circos input: nodes (`pathwayGenes`) and relations (`flows`).
 *
 * Node ids are POSITIONAL — circos-d3 indexes its N x N matrix with them directly, so an id
 * that is not the node's own array position, or a relation endpoint pointing at a dropped
 * gene, throws or silently mis-draws. Ids are therefore assigned only AFTER the selection is
 * final: pathways occupy 0..P-1 in the order they were passed in, and genes P..P+G-1 in rank
 * order. Pathways are never dropped, so `colors[index]` is stable as the gene target changes
 * — dropping one would recolour every pathway after it.
 *
 * Relations are pruned to surviving genes, so a dropped gene is simply skipped. This
 * replaces `inputGenesArr.find(e => e.name === gene).id`, which threw a TypeError the
 * moment any gene was missing from the node list — inside a try whose catch only logged,
 * so the chart silently kept stale data. `from` is resolved by pathway index rather than
 * `inputPathwaysArr.find(e => e.path_id === pathway.id).id`, deleting that failure mode too.
 *
 * Gene nodes carry `highlighted: boolean` and MUST NOT carry `color` — see the renderer
 * contract in the module header.
 *
 * @param {Array<{id:*, name?:string, genes:string[]}>} pathways symbol-mapped, display order
 * @param {Array<object>} deGenes
 * @param {Object} [options] as selectCircosGenes, plus:
 * @param {string[]} [options.colors] pathway arc palette, cycled by index
 * @returns {{nodes: Array<object>, relations: Array<{from:number,to:number}>, stats: Object}}
 */
export function buildCircosGraph(pathways, deGenes, options = {}) {
    const opts = options || {};
    const paths = Array.isArray(pathways) ? pathways : [];
    const palette = Array.isArray(opts.colors) && opts.colors.length ? opts.colors : ['#FFA500'];
    const {genes, stats} = selectCircosGenes(paths, deGenes, opts);
    const highlighted = new Set(stats.highlightedKept);

    const pathwayNodes = paths.map((p, index) => ({
        id: index,
        name: p && p.name,
        color: palette[index % palette.length],
        type: 'pathway',
        path_id: p && p.id,
    }));

    const geneNodes = genes.map((g, i) => ({
        id: i + pathwayNodes.length,
        name: g.symbol,
        logFC: g.FC,
        type: 'gene',
        gene_id: g._id,
        highlighted: highlighted.has(g.symbol),
    }));

    const idBySymbol = new Map(geneNodes.map((n) => [n.name, n.id]));
    const relations = [];
    const seenEdge = new Set();
    const connected = new Set();
    paths.forEach((p, from) => {
        for (const symbol of (p && p.genes) || []) {
            const to = idBySymbol.get(symbol);
            if (to === undefined) continue; // dropped by the cap
            const key = `${from}|${to}`;
            if (seenEdge.has(key)) continue; // two ids collapsing to one symbol
            seenEdge.add(key);
            relations.push({from, to});
            connected.add(from);
        }
    });

    return {
        nodes: [...pathwayNodes, ...geneNodes],
        relations,
        stats: {
            ...stats,
            pathwayCount: pathwayNodes.length,
            orphanPathwayIds: pathwayNodes.filter((n) => !connected.has(n.id)).map((n) => n.path_id),
        },
    };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The user-facing caption for the gene selection.
 *
 * The gene target is a TARGET, not a hard ceiling: the per-pathway guarantee and the
 * highlight pinning can both raise it. A user who asks for 5 and sees 12 must understand
 * why on sight, so whenever the target is exceeded this names BOTH numbers and the reason
 * rather than leaving the discrepancy to be inferred.
 *
 * Copy lives here, not in the component, so the wording is unit-testable — the same reason
 * PLOT_STATE_MESSAGES lives in plotDisplayState.js.
 *
 * @param {Object} stats the `stats` from buildCircosGraph/selectCircosGenes
 * @returns {string} '' when there is nothing to say
 */
export function describeGeneSelection(stats) {
    if (!stats) return '';
    const shown = stats.selectedGeneCount || 0;
    const total = stats.totalCandidateGenes || 0;
    const notFound = stats.highlightedNotFound || [];
    const parts = [];

    if (total > 0) {
        let text = `Showing ${shown} of ${plural(total, 'gene')}`;

        const reasons = [];
        if (stats.pinnedHighlightCount > 0) {
            const n = stats.pinnedHighlightCount;
            reasons.push(`${plural(n, 'highlighted gene')} ${n === 1 ? 'is' : 'are'} kept`);
        }
        if (stats.coverageGeneCount > 0) {
            // Qualified deliberately: the guarantee can only cover a pathway that HAS a
            // differentially expressed gene. A displayed pathway with none keeps zero and
            // renders as a chord-less arc (stats.orphanPathwayIds) — claiming otherwise
            // would be contradicted by the very picture beside this sentence.
            reasons.push('every displayed pathway that has a differentially expressed gene keeps at least one');
        }
        if (reasons.length > 0) {
            // Two distinct situations, both of which owe the user an explanation:
            //   - the count exceeded the target (capRaised), or
            //   - the count matched the target but the MEMBERSHIP is not simply the top N,
            //     because a guarantee displaced a better-ranked gene. Reporting only the
            //     first would leave that silent substitution unexplained.
            text += stats.capRaised
                ? ` — more than the target of ${stats.requestedCap}, so that ${reasons.join(' and ')}`
                : ` — not simply the top ${stats.requestedCap} by significance, so that ${reasons.join(' and ')}`;
        }
        parts.push(`${text}.`);
    }

    if (notFound.length > 0) {
        // Name them: the picker is per-pane, so this fires exactly when the user switches
        // method tab or narrows the pathway set, i.e. when they have several tags selected
        // and no way to tell which one went stale.
        // Worded to cover BOTH ways a highlight goes stale: the gene left the displayed
        // pathway set, or it stopped passing the DE thresholds. `highlightedNotFound` is
        // computed against the post-DE-filter candidates, so "not in the displayed pathways"
        // alone would be the wrong reason in the second case.
        const named = notFound.slice(0, 5).join(', ');
        parts.push(`Not among the differentially expressed genes of the displayed pathways: ${named}${notFound.length > 5 ? ', …' : ''}.`);
    }

    return parts.join(' ');
}

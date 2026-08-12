// Pure, dependency-free mapping of an analysis's pathway result rows into the pathway shape the
// external interpretation pipeline expects.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and
// importable on both client and server — including the server-side Mocha runner. Mirrors
// imports/utils/datasetGenes.js, which does the same job for `datasets[].genes`.
//
// Background: the meta-analysis payload's `datasets[].pathways` was built straight from
// `AnalysisResult` rows with `name = row.name || row.pathway || row.ID` and `genes = row.genes || []`.
// Those fallbacks were written against the CONSENSUS row shape (`{ID, name, genes, ...}`). The rows
// a per-method run actually stores are what ora.js / fgsea.js persist — four columns,
// `{pathway, pValue, pValueFDR, score}` — with no `name` and no `genes`. So for every standard
// database the "name" was the raw database id (`path:hsa00010`) and the gene list was always empty:
// comparative reports printed ids instead of pathway names, and there was no dataset-level
// pathway/gene overlap for the pipeline to reason about.
//
// Names and genes now come from the `GeneSet` documents for the analysis's own (database, organism)
// pair, with member Entrez ids resolved through `GeneInfo` — the SAME join the "genes in a
// pathway" viewer performs (imports/client/utils/geneSetGenesData.js `loadPathwayGeneRows`), so the
// payload cannot drift from what the user sees in the result tables.

// The FDR threshold the caller filters on. Declared here because `selectSignificantPathwayIds`
// has to agree with it exactly — see the note on that function.
const SIGNIFICANCE_FDR = 0.05;

// How many example ids each diagnostic counter carries into its log line. The counts are exact;
// the id lists are a sample, so a database-wide failure logs one readable line rather than
// thousands of ids.
const MAX_SAMPLE_IDS = 10;

/**
 * The row's pathway id. Verbatim from the original call site — `pathway` (ora/fgsea and custom
 * gene sets), `ID` (consensus/meta), `name` last.
 *
 * This value becomes `pathways[].pathwayId`, which `meta_step07_reproducibility.py` keys
 * cross-dataset matching on and which the meta level sends as `pathway.originalId`. It must not be
 * renamed, prefixed, normalised or case-folded — that would silently break the one thing that
 * currently works.
 */
export const readPathwayId = (row) => row?.pathway || row?.ID || row?.name;

/**
 * The row's FDR. Verbatim from the original call site, `||`-coercions included: a genuine 0 becomes
 * 1 (and is then filtered out). Preserved deliberately — changing it would change which pathways
 * ship, which is not what this fix is for.
 */
export const readPathwayFDR = (row) => row?.pValueFDR || row?.pFDR || 1;

/**
 * The distinct pathway ids of the rows that will survive the caller's `pValueFDR < 0.05` filter.
 *
 * The Mongo layer narrows its `GeneSet` query to exactly these — ~49 documents instead of ~359 for a
 * typical KEGG run, and no symbol resolution at all for rows that are discarded two lines later.
 * That is only safe because this function reads the id and the FDR through the SAME
 * `readPathwayId` / `readPathwayFDR` that `mapDatasetPathways` emits with, so the set of ids we
 * resolve can never drift from the set the filter keeps. `tests/dataset-pathways.tests.js` asserts
 * that equality directly.
 */
export const selectSignificantPathwayIds = (rows) => {
    const ids = new Set();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (readPathwayFDR(row) >= SIGNIFICANCE_FDR) return;
        const id = readPathwayId(row);
        if (id) ids.add(String(id));
    });
    return Array.from(ids);
};

/**
 * Index `GeneSet` documents (`{id, name, genes}`, already scoped to one database + organism) by
 * pathway id. `genes` is a list of bare NCBI Entrez ids for every gene-set builder in this codebase
 * (KEGG, GO, Reactome, MitoCarta) — never symbols. Pure.
 */
export const indexGeneSets = (geneSetDocs) => {
    const index = new Map();
    (Array.isArray(geneSetDocs) ? geneSetDocs : []).forEach((doc) => {
        if (!doc || doc.id === undefined || doc.id === null) return;
        index.set(String(doc.id), {
            name: typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name.trim() : null,
            geneIds: Array.isArray(doc.genes) ? doc.genes : [],
        });
    });
    return index;
};

/**
 * Index `GeneInfo` documents (`{_id: <Entrez>, symbol}`) as Entrez id -> symbol. Blank symbols are
 * omitted rather than stored, so a lookup miss and a blank symbol are the same case downstream.
 * Pure.
 */
export const indexGeneSymbols = (geneInfoDocs) => {
    const index = new Map();
    (Array.isArray(geneInfoDocs) ? geneInfoDocs : []).forEach((doc) => {
        if (!doc || doc._id === undefined || doc._id === null) return;
        const symbol = doc.symbol;
        if (typeof symbol === 'string') {
            const s = symbol.trim();
            if (s !== '') index.set(String(doc._id), s);
            return;
        }
        // A numeric-looking `symbol` is still a symbol the upstream mapper chose to store — the
        // same allowance datasetGenes.js `readSymbol` makes.
        if (Number.isFinite(symbol)) index.set(String(doc._id), String(symbol));
    });
    return index;
};

// A pathway name, or null when the source has none. Never falls back to the pathway id — the
// caller decides what to do about an unresolved name, and has to count it when it does.
const readName = (value) => {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return s === '' ? null : s;
};

/**
 * Map one database's pathway result rows to the pipeline's pathway shape.
 *
 * Handles all three stored row shapes:
 *   - per-method (ora/fgsea):  {pathway, pValue, pValueFDR, score}      — no name, no genes
 *   - consensus/meta:          {ID, name, genes, ..., normalizedScore}  — carries its own name/genes
 *   - custom gene sets:        {pathway, pValue, score}                 — resolved via `customPathways`
 *
 * ONE ROW OUT PER ROW IN, in input order. Nothing is filtered here: the caller's
 * `pValueFDR < 0.05` filter stays the only filter, so no row can vanish from cross-dataset
 * matching. Never mutates the input.
 *
 * Unresolved names keep the pathway id as the name — the row may not disappear, and the pipeline's
 * PathwayInput model requires the field — but are COUNTED so the substitution is visible instead of
 * silent. Only significant rows are counted: the rest are discarded by the caller and are not
 * resolved in the first place, so counting them would be thousands of false alarms per run.
 *
 * Unresolved gene symbols are DROPPED and counted, never emitted as their Entrez id. This is
 * datasetGenes.js `readSymbol`'s principle: the consumer keys on symbols, so an id there matches
 * nothing while looking perfectly valid — exactly how the original defect survived. (It is also a
 * deliberate divergence from `geneSetMembership.js` `buildGeneRows`, which DOES fall back to the id
 * — correct there, because that row renders next to a "Gene ID" column.)
 *
 * @param {object} args
 * @param {Array<object>} args.rows          `AnalysisResult.value` for ONE database, unfiltered
 * @param {string} args.source               resolved database display name
 * @param {Map} [args.geneSetIndex]          `indexGeneSets` output for this database + organism
 * @param {Map} [args.symbolIndex]           `indexGeneSymbols` output (an analysis-wide superset is fine)
 * @param {object} [args.customPathways]     custom gene set map, pathwayId -> {name, genes}; only for custom sets
 * @param {Set<string>} [args.resolvableIds] ids that were looked up (i.e. the significant ones)
 * @returns {{pathways: Array<object>, total: number, unnamed: number, unnamedIds: Array<string>,
 *            symbolless: number, symbollessIds: Array<string>, emptyMembership: number,
 *            emptyMembershipIds: Array<string>, sampleKeys: Array<string>}}
 *          `unnamed` / `emptyMembership` count ROWS; `symbolless` counts dropped gene ENTRIES
 *          (one unresolvable id appearing in five pathways counts five), while `symbollessIds`
 *          samples the distinct ids behind them.
 */
export function mapDatasetPathways({
    rows,
    source,
    geneSetIndex,
    symbolIndex,
    customPathways,
    resolvableIds,
} = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const sampleKeys = Object.keys(list[0] || {});

    const gsIndex = geneSetIndex instanceof Map ? geneSetIndex : new Map();
    const symIndex = symbolIndex instanceof Map ? symbolIndex : new Map();
    const customMap = customPathways || null;
    // No set supplied => treat every row as one we tried to resolve, so a standalone call still
    // reports its failures rather than swallowing them.
    const resolvable = resolvableIds instanceof Set ? resolvableIds : null;

    const pathways = [];
    const unnamedIds = [];
    const symbollessIds = new Set();
    const emptyMembershipIds = [];
    let unnamed = 0;
    let symbolless = 0;
    let emptyMembership = 0;

    list.forEach((row) => {
        const pathwayId = readPathwayId(row);
        const key = pathwayId === undefined || pathwayId === null ? null : String(pathwayId);
        const wasResolved = resolvable === null ? true : (key !== null && resolvable.has(key));

        const custom = customMap && key !== null ? customMap[key] : null;
        const geneSet = key !== null ? gsIndex.get(key) : undefined;

        // --- name -------------------------------------------------------------------------
        // The row's own name wins: that is the consensus shape the original fallbacks were
        // written for, and it is what the analysis actually computed against.
        let pathwayName = readName(row?.name);
        if (!pathwayName && custom) pathwayName = readName(custom.name);
        if (!pathwayName && geneSet) pathwayName = geneSet.name;

        if (!pathwayName) {
            // Unavoidable substitution — but a counted one. The row may not be dropped (it is a
            // cross-dataset matching key) and the pipeline's PathwayInput requires a string here,
            // so the id stands in for the name. A row carrying no id at all keeps the original
            // 'Unknown Pathway' placeholder rather than emitting null, which would fail the
            // pipeline's validation and reject the whole submission.
            pathwayName = key === null ? 'Unknown Pathway' : key;
            if (wasResolved) {
                unnamed += 1;
                if (unnamedIds.length < MAX_SAMPLE_IDS) unnamedIds.push(key === null ? '<no id>' : key);
            }
        }

        // --- genes ------------------------------------------------------------------------
        let geneSymbols = [];
        if (Array.isArray(row?.genes) && row.genes.length > 0) {
            // Consensus shape: already symbols.
            geneSymbols = row.genes.filter(Boolean);
        } else if (custom) {
            // Custom gene sets store the user's raw GMT symbols. Passing them through the
            // Entrez-keyed symbol index would resolve none of them and drop the lot.
            geneSymbols = (Array.isArray(custom.genes) ? custom.genes : []).filter(Boolean);
        } else if (geneSet) {
            if (geneSet.geneIds.length === 0) {
                // A gene set that genuinely has no members. Counted apart from `symbolless` so the
                // diagnostic does not blame GeneInfo for a gene-set-build problem.
                if (wasResolved) {
                    emptyMembership += 1;
                    if (emptyMembershipIds.length < MAX_SAMPLE_IDS && key !== null) {
                        emptyMembershipIds.push(key);
                    }
                }
            } else {
                const seen = new Set();
                geneSet.geneIds.forEach((geneId) => {
                    const id = String(geneId);
                    const symbol = symIndex.get(id);
                    if (!symbol) {
                        symbolless += 1;
                        symbollessIds.add(id);
                        return;
                    }
                    if (seen.has(symbol)) return;
                    seen.add(symbol);
                    geneSymbols.push(symbol);
                });
            }
        }

        pathways.push({
            name: pathwayName,
            source,
            pathwayId: key || pathwayName,
            pValue: row?.pValue || 1,
            pValueFDR: readPathwayFDR(row),
            // In this pipeline `score` is the fgsea NES (fgsea.js renames NES -> score),
            // so forward it as NES explicitly. Previously it arrived only as `ES`, and the
            // interpretation service mis-calibrated sub-1 magnitudes on the ES scale.
            // `NES` prefers normalizedScore (meta) and falls back to score (=NES elsewhere).
            ES: row?.score || 0,
            NES: row?.normalizedScore || row?.score || 0,
            genes: geneSymbols,
        });
    });

    return {
        pathways,
        total: list.length,
        unnamed,
        unnamedIds,
        symbolless,
        symbollessIds: Array.from(symbollessIds).slice(0, MAX_SAMPLE_IDS),
        emptyMembership,
        emptyMembershipIds,
        sampleKeys,
    };
}

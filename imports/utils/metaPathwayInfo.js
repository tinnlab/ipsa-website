// Pure resolution of a pathway-level META-analysis result row into the shape the AI-interpretation
// wizard's pathway table (and, through it, the interpretation pipeline) consumes.
//
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and importable
// on both client and server — including the server-side Mocha runner. Mirrors
// imports/utils/datasetPathways.js, which does the same job for the SINGLE-analysis path.
//
// Background: the wizard's meta branch resolved every pathway's name and genes with
// `geneSet.getByIds`, i.e. `GeneSet.find({id: {$in: ids}})`. A CUSTOM gene set is never in
// `GeneSet` — its only writers are the admin importer and harmoni. An uploaded gene set is a
// `SessionConfig` row (`analysis.js` `session.add.custom.geneSets`) plus a verbatim
// `AnalysisConfigSnapshot` copy taken at `analysis.start`. So every row of a custom database missed
// the lookup, and the caller's `if (pathwayInfo)` guard discarded it without a counter or a warning.
//
// The observed report was "149 pathways uploaded, 145 rendered". That was a coincidence: the upload
// was MitoPathways and a built-in MitoCarta import happened to exist whose pathway ids are its
// pathway NAMES, so 145 of the 149 names collided with it. Four did not — including
// `Tetrahydobiopterin synthesis`, which the source GMT misspells. Upload a bespoke signature list
// instead and the intersection is empty: the table renders zero rows, still with no error.

// How many example ids the unresolved diagnostic carries. The count is exact; the id list is a
// sample, so a database-wide failure logs one readable line rather than thousands of ids.
const MAX_SAMPLE_IDS = 10;

/**
 * A non-empty trimmed string, or null. Mirrors `readName` in datasetPathways.js.
 */
const readName = (value) => {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return s === '' ? null : s;
};

/**
 * A usable map/lookup key: a non-empty string. Ids arriving from Mongo are strings, but a row can
 * carry `undefined` (and `String(undefined)` is the very much matchable `"undefined"`), so the
 * conversion has to reject rather than coerce.
 */
const readKey = (value) => {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
};

/**
 * Index the custom gene sets of one study by their database id.
 *
 * `values` are the `SessionConfig.value` / `AnalysisConfigSnapshot.value` objects written by
 * `session.add.custom.geneSets`:
 *
 *     {id, name, isCustom: true, taxId, geneSets: [{id, name, genes, mappedGenes}, ...]}
 *
 * `value.id` doubles as the gene set's `SessionConfig._id` AND as the `databaseId` on its
 * `AnalysisResult` rows — the same identity `aiWorkflow.js` tests with `snapshot.value.id === dbId`.
 *
 * GENES COME FROM `genes`, NOT `mappedGenes`. `genes` is what the user uploaded in the GMT: bare
 * symbols. `mappedGenes` is the Entrez form minted at upload time purely for the R runners
 * (`analysis.js` uses it only there). The consumer of this map keys on symbols, so `mappedGenes`
 * would be ids that match nothing while looking perfectly valid — and routing them through the
 * wizard's Entrez->symbol map resolves none of them today anyway (that map is always empty, issue
 * #172). datasetPathways.js makes the same choice, with the same reasoning, for the single path.
 *
 * @param {Array<object>} values
 * @returns {Map<string, {name: string|null, pathways: Map<string, {name: string|null, genes: Array<string>}>}>}
 */
export const indexCustomGeneSets = (values) => {
    const index = new Map();
    (Array.isArray(values) ? values : []).forEach((value) => {
        if (!value || typeof value !== 'object') return;
        const databaseId = readKey(value.id);
        if (databaseId === null) return;

        // Two rows for one gene set is the norm, not an anomaly: the live SessionConfig row and its
        // AnalysisConfigSnapshot copy carry the same `value.id`. Merge rather than overwrite so the
        // caller need not care which arrived first, and so a snapshot that predates a rename cannot
        // blank out a pathway the live row still names.
        const existing = index.get(databaseId);
        const pathways = existing ? existing.pathways : new Map();

        (Array.isArray(value.geneSets) ? value.geneSets : []).forEach((geneSet) => {
            if (!geneSet || typeof geneSet !== 'object') return;
            const pathwayId = readKey(geneSet.id);
            if (pathwayId === null) return;
            pathways.set(pathwayId, {
                name: readName(geneSet.name),
                genes: (Array.isArray(geneSet.genes) ? geneSet.genes : []).filter(Boolean),
            });
        });

        index.set(databaseId, {
            // The first non-empty name wins. Callers pass the live SessionConfig rows first, so a
            // rename is reflected instead of being overwritten by the frozen snapshot copy.
            name: (existing && existing.name) || readName(value.name),
            pathways,
        });
    });
    return index;
};

/**
 * The display name for a meta result's database.
 *
 * A custom gene set is not in the `Database` collection, so `database.getAll` — and therefore the
 * wizard's `dbIdToNameMapping` — has no entry for it and the caller fell through to the raw
 * `Random.id()`. That id is what the table's Database column showed, what the row ids were built
 * from, and what the interpretation pipeline received as `source`. Prefer the gene set's own name,
 * exactly as `aiWorkflow.js` does server-side; a built-in database is unaffected.
 */
export const resolveDatabaseName = (databaseId, builtInNameMap, customGeneSet) => {
    const custom = customGeneSet && readName(customGeneSet.name);
    if (custom) return custom;
    const builtIn = builtInNameMap && readName(builtInNameMap[databaseId]);
    if (builtIn) return builtIn;
    return databaseId;
};

/**
 * Map one database's meta result rows to the wizard's pathway shape.
 *
 * ONE ROW OUT PER ROW IN, in input order. This is the invariant the original code broke: it pushed
 * a row only `if (pathwayInfo)`, so an unresolvable pathway vanished from the table, from the user's
 * selection, and from the `meta.pathways` array sent to the interpretation pipeline — with no
 * counter and no warning. The row is a real result: its p-value and FDR are correct, and its
 * `originalId` is the key `meta_step07_reproducibility.py` matches datasets on.
 *
 * An unresolved name falls back to the pathway id and is COUNTED, so the substitution is visible
 * instead of silent. That is `mapDatasetPathways`'s documented behaviour for the single-analysis
 * path; the two now agree.
 *
 * @param {object} args
 * @param {Array<object>} args.rows          `AnalysisResult.value` for ONE database (meta shape:
 *                                           `{ID, pValue, pFDR, score, normalizedScore}`)
 * @param {string} args.databaseName         resolved display name (see `resolveDatabaseName`)
 * @param {Map} [args.customPathways]        `indexCustomGeneSets(...).get(dbId).pathways`, when this
 *                                           database IS a custom gene set; otherwise omitted
 * @param {Map} [args.builtInPathways]       pathwayId -> {name, genes} from `geneSet.getByIds`,
 *                                           when this database is a built-in one
 * @returns {{pathways: Array<object>, unresolved: number, unresolvedIds: Array<string>}}
 */
export function buildMetaPathwayRows({rows, databaseName, customPathways, builtInPathways} = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const custom = customPathways instanceof Map ? customPathways : null;
    const builtIn = builtInPathways instanceof Map ? builtInPathways : null;

    const pathways = [];
    const unresolvedIds = [];
    let unresolved = 0;

    list.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const key = readKey(row.ID);

        // A custom database resolves ONLY from its own gene set. It must not fall back to the
        // built-in index: that is precisely the accidental name-matching that made this bug look
        // like "4 missing" instead of "the wrong collection", and it can attach another database's
        // (or another species') gene list to a pathway that merely shares a name.
        const info = key === null
            ? null
            : (custom ? custom.get(key) : (builtIn ? builtIn.get(key) : null)) || null;

        const name = (info && readName(info.name)) || null;
        if (!name) {
            unresolved += 1;
            if (unresolvedIds.length < MAX_SAMPLE_IDS) {
                unresolvedIds.push(key === null ? '<no id>' : key);
            }
        }

        pathways.push({
            id: `${databaseName}:${key === null ? '' : key}`,
            originalId: row.ID,
            // The id stands in for an unresolved name. A row with no id at all keeps a placeholder
            // rather than emitting null, which the pipeline's PathwayInput model would reject.
            name: name || (key === null ? 'Unknown Pathway' : key),
            pValue: row.pValue,
            pValueFDR: row.pFDR,
            // `score` is the enrichment score (NES here); carry normalizedScore through when
            // present (meta) so the interpretation service labels it as NES.
            score: row.score,
            normalizedScore: row.normalizedScore,
            database: databaseName,
            genes: (info && Array.isArray(info.genes)) ? info.genes : [],
        });
    });

    return {pathways, unresolved, unresolvedIds};
}

/**
 * Which meta-analysis (if any) a stored report belongs to. A report's `analysisId` is the
 * meta-analysis id for a meta report; getConfigurations lists only the session's ordinary
 * analyses, so look the id up in the session's metaAnalyses instead.
 *
 * @param {string} analysisId           BatchInfo.analysisId
 * @param {Array<{id: string}>} analyses  sessionConfigs.analyses (ordinary analyses)
 * @param {Array<object>} metaAnalyses  the session's metaAnalyses entries
 * @returns {object|null} the meta entry, or null for an ordinary (single-analysis) report
 */
export function findReportMetaAnalysis(analysisId, analyses, metaAnalyses) {
    if (!analysisId) return null;
    if ((analyses || []).some(a => a && a.id === analysisId)) return null;
    return (metaAnalyses || []).find(m => m && m.id === analysisId) || null;
}

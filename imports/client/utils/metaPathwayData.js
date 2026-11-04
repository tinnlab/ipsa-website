// Loads a pathway-level meta-analysis's results as the per-database tables the AI interpretation
// views show: `[{database, pathways}]`.
//
// One loader for two readers. The interpretation wizard builds the pathway selection from these rows,
// and that selection is stored on the report (BatchInfo.selectedPathways). The report's "Consensus
// Results" modal then re-reads the meta results and marks which rows were selected by matching
// `id`/`database`. Both sides have to produce identical database names and row ids for that match to
// work, so both call this function rather than each keeping a copy.
//
// The body was moved out of AnalysisWizard.jsx's meta branch unchanged.

import {Meteor} from 'meteor/meteor';
import {
    indexCustomGeneSets,
    resolveDatabaseName,
    buildMetaPathwayRows,
} from '/imports/utils/metaPathwayInfo';

/**
 * The study's custom gene sets, indexed by database id. A failure is non-fatal (most studies have
 * none) and yields an empty index, so the built-in databases still resolve.
 */
export const fetchCustomGeneSetIndex = ({sessionId, analysisId}) =>
    Meteor.callAsync('session.get.custom.geneSets', {sessionId, analysisId})
        .then(indexCustomGeneSets)
        .catch(error => {
            console.warn('Could not load custom gene sets for this study:', error);
            return new Map();
        });

/**
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.analysisId                the meta-analysis id
 * @param {Object<string,string>} args.dbIdToNameMapping  built-in database id -> name
 * @param {Map<string,string>} [args.geneIdToSymbolMap]   gene id -> symbol, for each pathway's genes
 * @param {function(string): Promise<Map>} [args.loadCustomGeneSets]  analysisId -> custom gene set
 *        index; defaults to fetchCustomGeneSetIndex. The wizard passes its own, which fetches once
 *        per run.
 * @param {function(): void} [args.onLoadingPathways]  called when the result rows are in and the
 *        pathway names are being resolved (the wizard updates its loading message)
 * @returns {Promise<Array<{database: string, pathways: Array<object>}>|null>} null when the meta
 *          analysis has no pathway-level results
 */
export async function loadMetaPathwayTables({
    sessionId,
    analysisId,
    dbIdToNameMapping,
    geneIdToSymbolMap = new Map(),
    loadCustomGeneSets = (id) => fetchCustomGeneSetIndex({sessionId, analysisId: id}),
    onLoadingPathways = () => {},
}) {
    // Fetch pathway results for this meta-analysis
    const metaResults = await Meteor.callAsync('visualization.getMetaAnalysisResults', {
        sessionId: sessionId,
        analysisId: analysisId
    });

    const pathwayResults = metaResults.pathwayLevel;

    if (!pathwayResults || pathwayResults.length === 0) return null;

    // A pathway-level meta-analysis can be run over a CUSTOM gene set, whose
    // "database id" is its SessionConfig._id. Those pathways are not in the
    // GeneSet collection at all (only the admin importers write it), so the
    // geneSet.getByIds lookup below can never resolve them. Fetch the study's
    // custom gene sets and resolve from those instead — the same custom-vs-
    // built-in split getDatasetPathways makes server-side for the single path.
    onLoadingPathways();
    const customGeneSetIndex = await loadCustomGeneSets(analysisId);

    // Only BUILT-IN databases go to geneSet.getByIds. Narrowing the id list to
    // them keeps custom pathway ids out of that unscoped public query, and
    // skips the round trip entirely for a meta run purely on a custom set.
    //
    // "Built-in" is decided by presence in dbIdToNameMapping (i.e. in the
    // Database collection), not merely by absence from the custom index. If the
    // custom fetch above failed, absence-from-custom would send a custom gene
    // set's pathway ids to GeneSet anyway — and a name collision there would
    // attach another database's gene list, which is the very confusion this
    // change exists to end. A database in neither map resolves to nothing and
    // is reported below, rather than being resolved from the wrong source.
    const isBuiltInDatabase = (dbResult) => (
        Boolean(dbIdToNameMapping[dbResult.databaseId]) &&
        !customGeneSetIndex.has(dbResult.databaseId)
    );

    const builtInPathwayIds = new Set();
    pathwayResults.forEach(dbResult => {
        if (!isBuiltInDatabase(dbResult)) return;
        if (dbResult.value && Array.isArray(dbResult.value)) {
            dbResult.value.forEach(pathway => {
                builtInPathwayIds.add(pathway.ID);
            });
        }
    });

    const pathwayInfoMap = new Map();
    if (builtInPathwayIds.size > 0) {
        const geneSets = await Meteor.callAsync('geneSet.getByIds', {
            ids: Array.from(builtInPathwayIds)
        });

        geneSets.forEach(gs => {
            // Convert gene IDs to symbols
            const geneSymbols = (gs.genes || [])
                .map(geneId => geneIdToSymbolMap.get(String(geneId)) || null)
                .filter(Boolean);

            pathwayInfoMap.set(gs.id, {
                name: gs.name,
                genes: geneSymbols  // Store gene symbols, not IDs
            });
        });
    }

    // Format results for the UI
    return pathwayResults.map(dbResult => {
        const customGeneSet = customGeneSetIndex.get(dbResult.databaseId);
        // A custom gene set is not in the Database collection, so
        // dbIdToNameMapping has no entry and the label fell through to the raw
        // Random.id(). Prefer the gene set's own name.
        const databaseName = resolveDatabaseName(
            dbResult.databaseId, dbIdToNameMapping, customGeneSet
        );

        // Each database resolves from exactly one source, never both. A custom
        // gene set must not fall back to the built-in index (a shared name
        // would attach another database's genes), and a database in neither
        // map resolves from nothing and is reported rather than guessed at.
        const {pathways, unresolved, unresolvedIds} = buildMetaPathwayRows({
            rows: dbResult.value,
            databaseName,
            customPathways: customGeneSet ? customGeneSet.pathways : null,
            builtInPathways: isBuiltInDatabase(dbResult) ? pathwayInfoMap : null
        });

        // Previously an unresolvable row was dropped with no counter and no
        // warning, which is what let a total lookup failure read as a shorter
        // but plausible table. The row now survives with its id as the name;
        // say so, so the substitution is visible.
        if (unresolved > 0) {
            console.warn(
                `Meta-analysis ${analysisId}: ${unresolved} of ${pathways.length} ` +
                `pathways in "${databaseName}" could not be resolved to a name ` +
                `(showing the pathway id instead). Examples: ${unresolvedIds.join(', ')}`
            );
        }

        return {
            database: databaseName,
            pathways: pathways
        };
    });
}

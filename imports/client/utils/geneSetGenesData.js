// Client-side orchestration for the "genes in a GO/pathway category" viewer + export.
//
// This is the thin Meteor-calling layer around the pure transforms in
// `/imports/utils/geneSetMembership`. It resolves, per analysis, the organism + the "significant"
// gene set (both cached, since they are constant for an analysis) and fetches a category's member
// genes with their symbols. Pure data-shaping lives in geneSetMembership so it stays unit-testable;
// only the I/O lives here.
//
// Gene ids throughout are bare NCBI Entrez ids (e.g. "1234") — the SAME namespace used by
// GeneSet.genes, GeneInfo._id, and the DE-gene / mapped-input id lists — so lookups line up.

import {Meteor} from 'meteor/meteor';
import {buildSignificanceMap, buildGeneRows} from '/imports/utils/geneSetMembership';

// Optional per-category gene columns the user can append to the whole-table CSV export. `value` is
// the `joinGeneSymbols` mode; `GENE_EXPORT_HEADER` maps it to the CSV column title. Shared by both
// result tables (Session AnalysisResult + Visualization SelectableResult).
export const GENE_EXPORT_OPTIONS = [
    {label: 'Genes (all members)', value: 'all'},
    {label: 'DE Genes (significant)', value: 'de'},
    {label: 'Up-regulated', value: 'up'},
    {label: 'Down-regulated', value: 'down'},
];
export const GENE_EXPORT_HEADER = {all: 'Genes', de: 'DE Genes', up: 'Up-regulated', down: 'Down-regulated'};

// Per-session config (from visualization.getConfigurations) and per-analysis significance map.
const configCache = new Map(); // sessionId -> allConfigs object
const sigMapCache = new Map(); // sessionId::analysisId -> Map
const cacheKey = (sessionId, analysisId) => `${sessionId}::${analysisId}`;

// The analysis config (organism, inputType, mapped-input gene list, ...) is not shipped to the
// result table; resolve it from visualization.getConfigurations (which returns {analyses, allConfigs}
// with organismId derived from the stored taxId). Cached per session. Returns null for ids not in
// the config set (e.g. meta-analyses), and does NOT cache failures so a transient error can retry.
export const getAnalysisConfig = async ({sessionId, analysisId}) => {
    // `visualization.getConfigurations` does check(sessionId, String); guard so a missing sessionId
    // degrades to the organism-less fallback (member list still shows) instead of a "Match failed".
    if (!sessionId || !analysisId) return null;
    let allConfigs = configCache.get(sessionId);
    if (!allConfigs) {
        const res = await Meteor.callAsync('visualization.getConfigurations', {sessionId});
        allConfigs = (res && res.allConfigs) || {};
        configCache.set(sessionId, allConfigs);
    }
    return allConfigs[analysisId] || null;
};

// The set of "significant" genes for the analysis, indexed by gene id, used to mark/color members:
//   - ORA (pasted gene list): the mapped input gene set IS the significant set (no direction).
//   - expression / PGSEA:     the analysis's DE gene set (with FC for up/down direction).
// Cached per analysis. When the analysis config can't be resolved (meta-analysis / unknown id) we
// return an empty map rather than mislabel — the member gene LIST still renders.
export const getAnalysisSignificanceMap = async ({sessionId, analysisId}) => {
    const key = cacheKey(sessionId, analysisId);
    if (sigMapCache.has(key)) return sigMapCache.get(key);

    const config = await getAnalysisConfig({sessionId, analysisId});
    let map;
    if (!config) {
        map = new Map();
    } else if (config.inputType === 'ora') {
        map = buildSignificanceMap({inputType: 'ora', mappedInput: config.genesMappedInput});
    } else {
        const deGenes = await Meteor.callAsync('visualization.getDEGenes', {sessionId, analysisId});
        map = buildSignificanceMap({inputType: config.inputType, deGenes});
    }
    sigMapCache.set(key, map);
    return map;
};

/**
 * Fetch member-gene rows for one or more pathways of a database.
 *
 * Returns `{ byPathway: Map(pathwayId -> rows[]), significanceMap }`, where each row is the
 * `buildGeneRows` shape (`{id, symbol, description, FC, pValue, pValueFDR, significant, up, down}`).
 * One `geneSet.getInfo` (all pathways) + one `visualization.getGeneInfo` (all member ids) — so the
 * whole-table export is a small constant number of round trips, not one per row.
 */
export const loadPathwayGeneRows = async ({sessionId, analysisId, databaseId, pathwayIds}) => {
    const ids = Array.from(new Set((pathwayIds || []).filter(Boolean)));
    if (ids.length === 0) return {byPathway: new Map(), significanceMap: new Map()};

    const [config, significanceMap] = await Promise.all([
        getAnalysisConfig({sessionId, analysisId}),
        getAnalysisSignificanceMap({sessionId, analysisId}),
    ]);
    const organismId = config && config.organismId;

    // `geneSet.getInfo` scopes by (database, organism) — the correct, unambiguous lookup. Only if
    // the organism couldn't be resolved (e.g. meta-analysis) do we fall back to id-only lookup
    // filtered by database, which for multi-organism databases may not disambiguate organism.
    let docs;
    if (organismId) {
        docs = await Meteor.callAsync('geneSet.getInfo', {
            pathwayIds: ids,
            genSetId: databaseId,
            organismId,
        });
    } else {
        const all = await Meteor.callAsync('geneSet.getByIds', {ids});
        docs = (all || []).filter((d) => d.database === databaseId);
    }

    // Resolve every member gene's symbol across all requested pathways in one call.
    const allGeneIds = Array.from(
        new Set((docs || []).flatMap((d) => (Array.isArray(d.genes) ? d.genes : [])))
    );
    const geneInfoDocs = allGeneIds.length
        ? await Meteor.callAsync('visualization.getGeneInfo', allGeneIds)
        : [];

    const byPathway = new Map();
    (docs || []).forEach((doc) => {
        byPathway.set(doc.id, buildGeneRows(doc.genes, geneInfoDocs, significanceMap));
    });
    return {byPathway, significanceMap};
};

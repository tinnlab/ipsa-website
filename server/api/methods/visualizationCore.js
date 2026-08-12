import {Meteor} from 'meteor/meteor'
import {normalizeMetaFoldChange} from '/imports/utils/foldChange'
import {applyLiveDEThresholdOverlay, stampSnapshotThreshold} from '/imports/utils/geneSelection'

// Auth-free data access behind the visualization.* methods.
//
// Why this module exists: the visualization.* Meteor methods are also invoked server-to-server —
// from consensus.js, from the /api/* REST handlers, from the mass-analysis worker in analysis.js,
// and recursively from one another. A server-side Meteor.callAsync runs with a fresh, empty
// invocation context, so `this.userId` is null there. Putting an ownership check inside the method
// bodies would therefore break every internal caller.
//
// So the data logic lives here as plain functions with no `this` and no authorization, and
// visualization.js keeps thin Meteor methods that assert ownership and delegate. Internal callers
// import these functions directly, which also removes a layer of method dispatch.
//
// SECURITY: nothing in this file checks who is asking. Every client-reachable entry point must
// perform its own ownership check before calling in.

export const getAnalysesForSession = async (sessionId) => {
    // Previously written as findOneAsync(...)?.then(e => e.analyses) || [], which threw a
    // TypeError for a missing session instead of yielding [] (the ?. tested the Promise, never
    // the document). Resolve first, then read.
    const session = await DBCollections.Session.findOneAsync({_id: sessionId});
    return session?.analyses || [];
};

export const getMetaAnalysesForSession = async (sessionId) => {
    const session = await DBCollections.Session.findOneAsync({_id: sessionId});
    return session?.metaAnalyses || [];
};

export const getResultsForAnalysis = async (analysisId) =>
    DBCollections.AnalysisResult.find({
        analysisId: analysisId,
        inputType: {$ne: 'consensus'}
    }).fetchAsync();

export const getResultsForSession = async (sessionId) => {
    const analyses = await getAnalysesForSession(sessionId);
    const analysisIds = analyses.map(e => e.id);
    return DBCollections.AnalysisResult.find({
        analysisId: {$in: analysisIds},
        // inputType: {$ne: 'consensus'}
    }).fetchAsync();
};

export const getResultsByDatabase = async ({analysisId, databaseIds}) =>
    DBCollections.AnalysisResult.find({
        analysisId: analysisId,
        databaseId: {$in: databaseIds}
    }).fetchAsync();

export const getResultsByMethod = async ({analysisId, databaseId, method}) =>
    DBCollections.AnalysisResult.find({analysisId, databaseId, key: method}).fetchAsync();

export const getResultById = async (resultId) =>
    DBCollections.AnalysisResult.find({_id: resultId}).fetchAsync();

// Snapshot rows for every analysis in a session, as {analysisId: [rows]}. The shared preamble of
// the five config-shaping readers below.
const snapshotsBySession = async (analyses, projection) => {
    const pipeline = [{$match: {analysisId: {$in: analyses.map(a => a.id)}}}];
    if (projection) pipeline.push(projection);
    const configSnapshots = await DBCollections.AnalysisConfigSnapshot.rawCollection()
        .aggregate(pipeline).toArray();

    return configSnapshots.reduce((acc, snapshot) => {
        if (!acc[snapshot.analysisId]) {
            acc[snapshot.analysisId] = [];
        }
        acc[snapshot.analysisId].push(snapshot);
        return acc;
    }, {});
};

const configsByAnalysisId = (analyses) => analyses.reduce((acc, curr) => {
    acc[curr.id] = curr;
    return acc;
}, {});

export const getConfigurationsForSession = async (sessionId) => {
    const analyses = await getAnalysesForSession(sessionId);
    // geneStats carries the full gene-set membership lists; the projection replaces them with a
    // count so this response stays a summary rather than shipping the whole gene universe.
    const snapshotsByAnalysisId = await snapshotsBySession(analyses, {
        $project: {
            _id: 1,
            inputType: 1,
            key: 1,
            analysisId: 1,
            value: {
                $cond: {
                    if: {$eq: ["$key", "geneStats"]},
                    then: {
                        $map: {
                            input: "$value",
                            as: "item",
                            in: {
                                $mergeObjects: [
                                    "$$item",
                                    {
                                        geneSetsCount: {$size: "$$item.geneSets"},
                                        geneSets: "$$REMOVE"
                                    }
                                ]
                            }
                        }
                    },
                    else: "$value"
                }
            }
        }
    });
    const allConfigs = configsByAnalysisId(analyses);

    let organismCache = {};
    for (let analysisId in snapshotsByAnalysisId) {
        let configList = snapshotsByAnalysisId[analysisId];
        let config = allConfigs[analysisId];
        config.analysisId = analysisId;
        for (let item of configList) {
            switch (item.key) {
                case "idType":
                    config.idType = item.value;
                    break;
                case "background":
                    config.backgroundCount = item.value.trim().split(/\s+/).length;
                    break;
                case "input":
                    if (item.inputType === "ora") {
                        config.inputCount = item.value.trim().split(/\s+/).length;
                        config.inputType = "ora"
                    } else if (item.inputType === "pgsea") {
                        config.inputCount = item.value.trim().split(/\n+/).length;
                        config.inputData = item.value;
                        config.inputType = "pgsea"
                    } else {
                        config.inputType = "expression"
                    }
                    break;
                // Bare filename only (never file contents) — rendered as "Selected expression /
                // group file" on the Visualization page, and now only ever sent to the owner.
                case "expressionFile":
                    if (item.inputType === "expression") {
                        config.expressionFile = item.value;
                    }
                    break;
                case "groupFile":
                    if (item.inputType === "expression") {
                        config.groupFile = item.value;
                    }
                    break;
                case "selectedControlSamples":
                    if (item.inputType === "expression") {
                        config.selectedControlSamplesCount = item.value.length;
                    }
                    break;
                case "selectedConditionSamples":
                    if (item.inputType === "expression") {
                        config.selectedConditionSamplesCount = item.value.length;
                    }
                    break;
                case "taxId":
                    if (!organismCache[item.value]) {
                        organismCache[item.value] = await Meteor.callAsync('organism.getOrganismById', {id: item.value});
                    }
                    let organism = organismCache[item.value];
                    config.organismName = organism[0].name;
                    config.organismId = organism[0]._id;
                    break;
                case "geneStats":
                    config.geneSets = item.value
                    break;
                case "methodSettings":
                    config.methods = item.value;
                    break;
                case "genesMappedInput":
                    config.genesMappedInput = item.value;
                    break;
                case "genesMappedBackground":
                    config.genesMappedBackground = item.value;
                    break;
                case "maxAdjustedPValue":
                case "minLogFoldChange":
                    // Snapshot = the IMMUTABLE original DE definition (thresholds at analysis
                    // creation). stampSnapshotThreshold sets both config.original* (used by
                    // "Use all DE Genes", so the original DE set is always recoverable) and the
                    // working default (overlaid with the live value below).
                    stampSnapshotThreshold(config, item.key, item.value);
                    break;
                case "selectedDatasets":
                    config.selectedDatasets = item.value;
                    break;
                case "volcanoPlotData":
                    // Presence of non-empty volcanoPlotData means the analysis has
                    // been run and has gene-level DE results (fold-change + p-value),
                    // which is what gene-level meta-analysis consumes. Surface a
                    // lightweight flag so the client can disable not-run analyses
                    // without shipping/relying on the heavy data array.
                    config.hasGeneResults = Array.isArray(item.value) && item.value.length > 0;
                    break;
                default:
                    break;
            }
        }
    }

    // Overlay the WORKING DE thresholds (live AnalysisConfig) onto config.maxAdjustedPValue /
    // minLogFoldChange. These are what the volcano plot shows and persist as the user tunes;
    // config.originalMaxAdjustedPValue / originalMinLogFoldChange (from the snapshot above)
    // stay the immutable original for "Use all DE Genes". Keyed on the (analysisId, inputType)
    // pair — the same key every other AnalysisConfig access uses — via the shared overlay helper.
    const liveDeSettings = await DBCollections.AnalysisConfig.rawCollection().aggregate([
        {
            $match: {
                analysisId: {$in: analyses.map(a => a.id)},
                key: {$in: ['maxAdjustedPValue', 'minLogFoldChange']}
            }
        },
        {$project: {_id: 1, analysisId: 1, inputType: 1, key: 1, value: 1}}
    ]).toArray();
    applyLiveDEThresholdOverlay(allConfigs, liveDeSettings);

    return {analyses, allConfigs};
};

// Shared by getFcPValueData / getDEGenes: a meta-analysis stores its gene-level data as a single
// AnalysisConfigSnapshot row rather than in the per-analysis snapshot fan-out.
const metaGeneLevelValue = async (analysisId) => {
    const metaResult = await DBCollections.AnalysisConfigSnapshot.findOneAsync({
        analysisId,
        key: 'volcanoPlotData',
        inputType: 'metaDE'
    });

    if (!metaResult || !metaResult.value) {
        return [];
    }

    // Meta-analyses store a LINEAR `FC` (2^logFC); every consumer of this data (volcano plot,
    // DE-gene export, counts) assumes `FC` is log2. Normalize here so meta matches expression.
    return normalizeMetaFoldChange(metaResult.value);
};

// Collect one snapshot key across a session's analyses and return it for the requested analysis.
const snapshotValueForAnalysis = async ({sessionId, analysisId, snapshotKey, shape}) => {
    const analyses = await getAnalysesForSession(sessionId);
    const snapshotsByAnalysisId = await snapshotsBySession(analyses);
    const allConfigs = configsByAnalysisId(analyses);

    for (let id in snapshotsByAnalysisId) {
        const configList = snapshotsByAnalysisId[id];
        const config = allConfigs[id];
        for (let item of configList) {
            if (item.key === snapshotKey) {
                config[snapshotKey] = shape ? shape(item.value) : item.value;
            }
        }
    }

    return allConfigs[analysisId]?.[snapshotKey];
};

export const getFcPValueData = async ({sessionId, analysisId}) => {
    const metaAnalyses = await getMetaAnalysesForSession(sessionId);
    if (metaAnalyses.some(meta => meta.id === analysisId)) {
        return metaGeneLevelValue(analysisId);
    }
    return snapshotValueForAnalysis({sessionId, analysisId, snapshotKey: 'volcanoPlotData'});
};

export const getDEGenes = async ({sessionId, analysisId}) => {
    const metaAnalyses = await getMetaAnalysesForSession(sessionId);
    if (metaAnalyses.some(meta => meta.id === analysisId)) {
        // volcanoPlotData carries the DE genes for a meta-analysis.
        return metaGeneLevelValue(analysisId);
    }
    return snapshotValueForAnalysis({sessionId, analysisId, snapshotKey: 'DEGenes'});
};

// geneStats rows get a geneSetsCount stamped onto each entry before being returned as geneSets.
const stampGeneSetsCount = (value) => {
    value.forEach(v => {
        v.geneSetsCount = v.geneSets.length;
    });
    return value;
};

export const getAllGeneSetAnalysis = async ({sessionId, analysisId}) => {
    const analyses = await getAnalysesForSession(sessionId);
    const snapshotsByAnalysisId = await snapshotsBySession(analyses);
    const allConfigs = configsByAnalysisId(analyses);

    for (let id in snapshotsByAnalysisId) {
        const config = allConfigs[id];
        for (let item of snapshotsByAnalysisId[id]) {
            if (item.key === "geneStats") {
                config.geneSets = stampGeneSetsCount(item.value);
            }
        }
    }
    return allConfigs[analysisId]?.geneSets;
};

export const getGeneSetAnalysis = async ({sessionId, analysisId, geneSetId}) => {
    // Preserves the original behaviour: the per-geneSetId filter was computed and discarded, so
    // the first gene set is what is returned. Left as-is deliberately — changing it here would be
    // a behavioural change riding along in a security pass.
    const geneSets = await getAllGeneSetAnalysis({sessionId, analysisId});
    return geneSets?.[0];
};

export const getDEMetaResults = async (sessionId) => {
    const metaAnalyses = await getMetaAnalysesForSession(sessionId);
    const analysisIds = metaAnalyses.map(e => e.id);
    const docs = await DBCollections.AnalysisConfigSnapshot.find({
        analysisId: {$in: analysisIds},
        key: 'volcanoPlotData',
        inputType: 'metaDE'
    }).fetchAsync()
    // Meta stores a LINEAR `FC` (2^logFC); normalize each snapshot's genes to log2
    // so any reader of `.value[].FC` gets log2, consistent with getDEGenes/getFcPValueData.
    return docs.map(doc => ({...doc, value: normalizeMetaFoldChange(doc.value)}))
};

export const getPathwayMetaResults = async (sessionId) => {
    const metaAnalyses = await getMetaAnalysesForSession(sessionId);
    const analysisIds = metaAnalyses.map(e => e.id);
    return DBCollections.AnalysisResult.find({
        analysisId: {$in: analysisIds},
        inputType: 'meta'
    }).fetchAsync()
};

export const getMetaAnalysisResults = async (analysisId) => {
    const geneResults = await DBCollections.AnalysisConfigSnapshot.find({
        analysisId,
        key: 'volcanoPlotData',
        inputType: 'metaDE'
    }).fetchAsync()

    const pathwayResults = await DBCollections.AnalysisResult.find({
        analysisId,
        inputType: 'meta'
    }).fetchAsync()

    return {
        // Normalize the meta gene-level `FC` (stored linear as 2^logFC) to log2, so
        // any reader gets log2 — consistent with getDEGenes/getFcPValueData/getDEMetaResults.
        geneLevel: geneResults.length > 0
            ? {...geneResults[0], value: normalizeMetaFoldChange(geneResults[0].value)}
            : null,
        pathwayLevel: pathwayResults
    }
};

export const getConsensusAnalysisResult = async ({analysisId, databaseId}) =>
    DBCollections.AnalysisResult.find({
        analysisId,
        databaseId,
        key: 'consensus'
    }, {
        sort: {updatedAt: -1}  // Sort by updatedAt in descending order (newest first)
    }).fetchAsync();

// Status write for a meta-analysis entry. Lives here because meta.analysis.compute in analysis.js
// drives it six times over the course of a run, server-to-server and therefore without a userId.
export const updateMetaAnalysisStatus = async ({sessionId, analysisId, level, status}) => {
    try {
        const updateField = level
            ? `metaAnalyses.$.${level}Level.status`
            : 'metaAnalyses.$.status';

        const result = await DBCollections.Session.updateAsync(
            {
                _id: sessionId,
                'metaAnalyses': {$elemMatch: {id: analysisId}}
            },
            {
                $set: {
                    [updateField]: status,
                    'metaAnalyses.$.updatedAt': new Date()
                }
            }
        );

        if (result.modifiedCount === 0) {
            const session = await DBCollections.Session.findOneAsync({_id: sessionId});
            if (!session) {
                throw new Meteor.Error('not-found', 'Session not found');
            }
            throw new Meteor.Error('not-found', 'Meta analysis not found in the session');
        }

        return {success: true};
    } catch (error) {
        console.error('Error in visualization.updateMetaAnalysis:', error);
        throw new Meteor.Error('internal-error', 'Failed to update meta analysis', error);
    }
};

// Backing read for /api/mappedGeneIds and the analysis.getMappedGeneIds method.
//
// NOTE: the REST caller has always passed {sessionId, analysisId} while this query keys on
// {analysisId, inputType}, so inputType arrives undefined and the row never matches — the endpoint
// has been returning [] in practice. That pre-existing bug is preserved deliberately: correcting it
// here would change what the volcano gene charts render, which does not belong in a security pass.
export const getMappedGeneIds = async ({analysisId, inputType}) => {
    const data = await DBCollections.AnalysisConfig.findOneAsync({
        analysisId, inputType, key: 'mappedGeneIds'
    });
    return data?.value || [];
};

export const getProcessedAnalyses = async ({analysisId, inputType, databaseIds}) =>
    DBCollections.AnalysisResult.find(
        {analysisId, inputType, databaseId: {$in: databaseIds}},
        {fields: {_id: 1, analysisId: 1, inputType: 1, key: 1, databaseId: 1}}
    ).fetchAsync();

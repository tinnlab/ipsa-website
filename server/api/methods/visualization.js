import {Meteor} from 'meteor/meteor'
import {check, Match} from 'meteor/check'
import {
    assertAnalysisIdIsNew,
    assertOwnsAnalysis,
    assertOwnsSession,
    assertOwnsSessionAnalysis,
    assertWritableSession,
    assertWritableSessionAnalysis,
} from '../../helper/ownership'
import {
    getAllGeneSetAnalysis,
    getAnalysesForSession,
    getConfigurationsForSession,
    getConsensusAnalysisResult,
    getDEGenes,
    getDEMetaResults,
    getFcPValueData,
    getGeneSetAnalysis,
    getMetaAnalysesForSession,
    getMetaAnalysisResults,
    getPathwayMetaResults,
    getProcessedAnalyses,
    getResultById,
    getResultsByDatabase,
    getResultsByMethod,
    getResultsForAnalysis,
    getResultsForSession,
    updateMetaAnalysisStatus,
} from './visualizationCore'

// Every study-scoped method here now asserts that the caller owns the study before returning any
// data. Previously none of them did, which is what made a copied /analysis/visualization/:sessionId
// URL hand over another user's results, configs and snapshots in full.
//
// The data logic itself lives in visualizationCore.js with no authorization, because these same
// operations are invoked server-to-server (consensus.js, the /api/* handlers, the mass-analysis
// worker) where there is no method invocation and therefore no this.userId. Internal callers use
// the core functions directly; only the client-reachable methods below carry an ownership check.
//
// getPathwayGraph / getDatabases / getGeneInfo are deliberately left unguarded: they serve shared
// reference data (pathway topology, database list, gene annotations) that belongs to no study, and
// getGeneInfo in particular is called server-to-server from analysis.js.

Meteor.methods({
    async 'visualization.getAnalyses'({sessionId}) {
        this.unblock()
        await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return getAnalysesForSession(sessionId)
    },
    async 'visualization.getMetaAnalyses'({sessionId}) {
        this.unblock()
        await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return getMetaAnalysesForSession(sessionId)
    },
    async 'visualization.getResults'({sessionId, analysisId}) {
        this.unblock()
        // sessionId is accepted for call-site compatibility but the query keys on analysisId, so
        // that is what has to be authorized.
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        return getResultsForAnalysis(analysisId)
    },
    async 'visualization.getResultsBySession'({sessionId}) {
        this.unblock()
        await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return getResultsForSession(sessionId)
    },
    async 'visualization.results.getResultsByDatabase'({sessionId, analysisId, databaseIds}) {
        this.unblock()
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        // databaseIds lands in a {$in: ...} selector; keep it a plain array of strings for parity
        // with the REST surface. Not a cross-user risk (analysisId is already authorized), but it
        // stops a caller shaping the query with operators.
        check(databaseIds, [String])
        return getResultsByDatabase({analysisId, databaseIds})
    },
    async 'visualization.results.getResultsByMethod'({analysisId, databaseId, method}) {
        this.unblock()
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        return getResultsByMethod({analysisId, databaseId, method})
    },
    async 'visualization.results.getResults'(resultId) {
        this.unblock()
        check(resultId, String)
        // Two hops: this method is keyed on an AnalysisResult._id, which carries no owner. Resolve
        // it to its analysisId first, then to the owning study.
        const result = await DBCollections.AnalysisResult.findOneAsync(
            {_id: resultId},
            {fields: {analysisId: 1}}
        )
        if (!result) return []
        await assertOwnsAnalysis({analysisId: result.analysisId, requesterUserId: this.userId})
        return getResultById(resultId)
    },
    async 'visualization.getConfigurations'({sessionId}) {
        check(sessionId, String);
        this.unblock();
        await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return getConfigurationsForSession(sessionId)
    },
    async 'visualization.getFcPValueData'({sessionId, analysisId}) {
        this.unblock();
        await assertOwnsSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        return getFcPValueData({sessionId, analysisId})
    },
    async 'visualization.getDEGenes'({sessionId, analysisId}) {
        this.unblock();
        await assertOwnsSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        return getDEGenes({sessionId, analysisId})
    },
    async 'visualization.getGeneSetAnalysis'({sessionId, analysisId, geneSetId}) {
        this.unblock();
        await assertOwnsSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        return getGeneSetAnalysis({sessionId, analysisId, geneSetId})
    },
    async 'visualization.getAllGeneSetAnalysis'({sessionId, analysisId}) {
        this.unblock();
        await assertOwnsSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        return getAllGeneSetAnalysis({sessionId, analysisId})
    },
    async "visualization.getPathwayGraph"({databaseId, organismId}) {
        this.unblock()
        let allPathways = await DBCollections.GeneSet.find({
            database: databaseId,
            organism: organismId
        }).fetchAsync()

        let geneIndex = new Map()
        for (let pathway of allPathways) {
            pathway.genes.forEach(gene => {
                let genePathways = geneIndex.get(gene) || new Set()
                geneIndex.set(gene, genePathways.add(pathway.id))
            })
        }

        let pathwayEdges = new Map()
        for (let [gene, pathways] of geneIndex.entries()) {
            let pathwayIds = Array.from(pathways).sort()
            for (let i = 0; i < pathwayIds.length; i++) {
                for (let j = i + 1; j < pathwayIds.length; j++) {
                    let key = `${pathwayIds[i]}---${pathwayIds[j]}`
                    let count = pathwayEdges.get(key) || 0
                    pathwayEdges.set(key, count + 1)
                }
            }
        }

        return Array.from(pathwayEdges.entries()).map(([key, value]) => {
            let keys = key.split("---")
            return {
                data: {
                    id: key,
                    source: keys[0],
                    target: keys[1],
                    weight: value
                }
            }
        })
    },
    // get all databases
    async 'visualization.getDatabases'() {
        this.unblock()
        return await DBCollections.Database.find().fetchAsync()
    },
    async 'visualization.getGeneInfo'(geneIds) {
        // Deduplicate geneIds to avoid unnecessary processing
        const uniqueGeneIds = [...new Set(geneIds)];

        // Query the database for all matching gene IDs in a single operation
        const results = await DBCollections.GeneInfo.find({_id: {$in: uniqueGeneIds}}).fetchAsync();

        return results;
    },
    async 'visualization.addMetaAnalysis'({sessionId, analysis}) {
        // Ownership is enforced here rather than deferred with the other mutations, because the
        // READ guards consume what this method writes: assertWritableSessionAnalysis authorizes an
        // analysisId by testing membership of collectAnalysisIds(session), which includes
        // metaAnalyses[].id. Left open, a caller could push a VICTIM's analysisId into their own
        // study and then pass their own sessionId with that analysisId to /api/treeData,
        // /api/deGenes, /api/fcPValueData and friends — every one of which would authorize.
        // Writable, not merely owned: a view-only study must not accept a $push into
        // metaAnalyses[] either — it is a write, and it grows the array the guards read.
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        // Constrain the pushed shape too: this array is authorization input, so it must not be an
        // arbitrary client object. id must be a string for the membership test to be meaningful.
        check(analysis, Match.ObjectIncluding({id: String}))
        // Owning the target session is NOT sufficient by itself — the attacker owns the study they
        // are pushing into. The id must also be proven not to belong to any other study, or the
        // membership test above can be satisfied with a victim's analysisId.
        await assertAnalysisIdIsNew({analysisId: analysis.id})
        return DBCollections.Session.updateAsync({_id: sessionId}, {
            $push: {metaAnalyses: analysis}
        })
    },
    async 'visualization.updateMetaAnalysis'({sessionId, analysisId, level, status}) {
        // level can be 'gene' or 'pathway' to update specific status
        // If level not provided, updates old-style status for backward compatibility
        //
        // The ownership check also closes an existence oracle: the distinct 'Session not found' vs
        // 'Meta analysis not found in the session' errors below used to be readable by a caller
        // with no rights to the study at all.
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        return updateMetaAnalysisStatus({sessionId, analysisId, level, status})
    },
    async 'visualization.getDEMetaResults'({sessionId}) {
        this.unblock()
        await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return getDEMetaResults(sessionId)
    },
    async 'visualization.getPathwayMetaResults'({sessionId}) {
        this.unblock()
        await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return getPathwayMetaResults(sessionId)
    },
    async 'visualization.getMetaAnalysisResults'({sessionId, analysisId}) {
        // Get both gene-level and pathway-level results for a specific meta-analysis
        this.unblock()
        await assertOwnsSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        return getMetaAnalysisResults(analysisId)
    },
    async 'visualization.getConsensusAnalysisResult'({analysisId, databaseId}) {
        this.unblock()
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        return getConsensusAnalysisResult({analysisId, databaseId})
    },
    async 'visualization.removeMetaAnalysis'({sessionId, analysisId}) {
        // Pulled forward from the mutation pass: this method is destructive and was completely
        // unauthenticated — the three removeAsync calls below key on a bare analysisId, so any
        // caller could delete any user's meta-analysis results.
        await assertWritableSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        // Remove meta-analysis from session
        await DBCollections.Session.updateAsync({_id: sessionId}, {
            $pull: {metaAnalyses: {id: analysisId}}
        })

        // Remove both gene-level and pathway-level results
        // Gene-level results
        await DBCollections.AnalysisConfigSnapshot.removeAsync({
            analysisId,
            key: 'volcanoPlotData',
            inputType: 'metaDE'
        })
        await DBCollections.AnalysisConfig.removeAsync({
            analysisId,
            key: 'volcanoPlotData',
            inputType: 'metaDE'
        })

        // Pathway-level results
        await DBCollections.AnalysisResult.removeAsync({
            analysisId,
            inputType: 'meta'
        })

        return true
    },
    async 'llm.addJob'({templateName, textValue, datasets, selectedMethods, type, sessionId}) {
        // Queued jobs are stamped with a sessionId, so the caller must own that study.
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        const user = await Meteor.userAsync()

        // Get the current user's ID
        const userId = user._id;
        DBCollections.LlmQueue.insertAsync({
            userId,
            templateName,
            datasets,
            selectedMethods,
            type,
            textValue,
            createdAt: new Date(),
            status: 'pending',
            sessionId
        });
    },
    async 'visualization.getProcessedAnalyses'({analysisId, inputType, databaseIds}) {
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        check(databaseIds, [String])
        return getProcessedAnalyses({analysisId, inputType, databaseIds})
    }
})

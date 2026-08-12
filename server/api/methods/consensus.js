import {Meteor} from "meteor/meteor"
import conf from "circos/src/layout/conf";
import {resolveConsensusOptions} from "/imports/methods/consensusConfig";
import {getConfigurationsForSession} from "./visualizationCore";
import {assertWritableSessionAnalysis} from "../../helper/ownership";

Meteor.methods({
    // run consensus analysis for all databases. For each database, run consensus analysis for all methods
    async 'consensus.processAnalysis'({analysisId, sessionId, inputType}) {
        // This is client-callable (the run wizard triggers it) AND runs server-to-server from the
        // mass-analysis worker, which has no user context. Meteor sets `connection` to null for a
        // server-initiated call and a client cannot forge that, so gate on it: client callers must
        // own the study, the worker proceeds. Without this a caller could drive consensus over
        // someone else's analysis and overwrite its stored results.
        if (this.connection) {
            // Writable, not merely owned: this writes AnalysisResult 'consensus' rows and
            // AnalysisLog entries, so it is the implicit write a view-only study has to refuse.
            // The import's own recompute is server-initiated (connection null) and so is unaffected.
            await assertWritableSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId})
        }
        try {
            // Direct core call, not Meteor.callAsync: consensus runs from the background
            // mass-analysis worker with no user context, so the ownership-checked
            // visualization.getConfigurations method would reject it. The caller has already
            // established which study this belongs to.
            let {analyses, allConfigs} = await getConfigurationsForSession(sessionId)
            let analysesObj = analyses.reduce((acc, curr) => {
                acc[curr.id] = curr;
                return acc;
            }, {});

            await Meteor.callAsync('analysis.log', {
                analysisId,
                inputType,
                message: 'Performing consensus analysis',
                progress: 95,
            })

            const configsRes = Object.values(allConfigs);
            const resConfigs = configsRes.filter(config => config.analysisId);

            const results = await fetchAnalysisResults(analysisId, analysesObj, resConfigs);
            if (!results || Object.keys(results).length === 0) {
                // Most common silent failure: analysis.results.aggregate returned
                // nothing (e.g. fetchAnalysisResults threw and returned null, or
                // no per-method results matched the configured gene sets).
                console.log(`[consensus ${analysisId}] No aggregated per-method results returned; skipping consensus.`);
                return;
            }

            const thisConfig = configsRes.filter(config => config.analysisId === analysisId)[0];
            const selectedMethods = thisConfig?.methods?.consensus?.methods ?? [];
            // Honor the user's chosen consensus algorithm + RRA ranking (these
            // were previously ignored — consensus always ran RRA/pFDR).
            const {method: consensusMethod, rankBy: consensusRankBy} = resolveConsensusOptions(thisConfig?.methods?.consensus);

            const databases = Object.keys(results);
            const methods = selectedMethods.length > 1 ? selectedMethods.map(m => m.toUpperCase()) : Array.from(new Set(
                Object.values(results).flatMap(db =>
                    db.methods[0] ? Object.keys(db.methods[0]) : []
                )
            )).map(m => m.toUpperCase());

            console.log(`[consensus ${analysisId}] databases=[${databases.join(', ')}] methods=[${methods.join(', ')}] selectedMethods=[${selectedMethods.join(', ')}]`);

            if (methods.length < 2) {
                console.log(`[consensus ${analysisId}] Not enough methods for consensus analysis (have ${methods.length}); skipping.`);
                return;
            }

            const dbMapping = await getDatabaseMapping();
            const pathwayMethodsData = await buildPathwayMethodsData(results, databases, methods);

            // For each database, run the consensus analysis
            let ran = 0;
            for (const db of databases) {
                const databaseId = dbMapping[db];
                if (databaseId) {
                    await runConsensusAnalysis(
                        analysisId,
                        databaseId,
                        methods,
                        pathwayMethodsData,
                        inputType,
                        consensusMethod,
                        consensusRankBy
                    );
                    ran++;
                } else {
                    // Result key didn't map to a known database id — this silently
                    // skipped every database before, producing no consensus output.
                    console.log(`[consensus ${analysisId}] No database id for results key "${db}" (known keys: ${Object.keys(dbMapping).join(', ')}); skipping it.`);
                }
            }
            console.log(`[consensus ${analysisId}] Ran consensus for ${ran}/${databases.length} database(s).`);
        } catch (error) {
            console.error(`[consensus ${analysisId}] consensus.processAnalysis failed:`, error);
            throw error;
        } finally {
            // Consensus is a post-completion step: analysis.start already marked the
            // run Done/100, then the 95% "Performing consensus analysis" log (which
            // defaults isRunning:true) reopened it. Always restore the completed
            // state so the UI can never get stuck at 95% — on success, early return,
            // or error.
            await Meteor.callAsync('analysis.log', {
                analysisId,
                inputType,
                message: 'Done',
                isRunning: false,
                progress: 100,
            })
        }
    }
})

// Database mapping functio
const getDatabaseMapping = async () => {
    try {
        const dbList = await Meteor.callAsync('database.getAll');
        return dbList.reduce((acc, db) => {
            const dbKey = db.namespace ? `${db.name}-${db.namespace}` : db.name;
            acc[dbKey] = db._id;
            return acc;
        }, {});
    } catch (error) {
        console.error('Error getting database mapping:', error);
        throw error;
    }
};

// Build pathway methods data function
const buildPathwayMethodsData = async (results, databases, initialMethods) => {
    try {
        const dbMapping = await getDatabaseMapping();
        const pathwayMethodsData = databases.reduce((acc, dbName) => {
            const dbId = dbMapping[dbName];
            if (dbId) {
                acc[dbId] = initialMethods.reduce((methodsAcc, method) => {
                    methodsAcc[method.toLowerCase()] = [];
                    return methodsAcc;
                }, {});
            }
            return acc;
        }, {});

        databases.forEach(dbName => {
            const dbId = dbMapping[dbName];
            if (dbId && results[dbName] && results[dbName].methods[0]) {
                const dbResults = results[dbName].methods[0];

                initialMethods.forEach(method => {
                    const methodResults = dbResults[method.toLowerCase()] || [];
                    pathwayMethodsData[dbId][method.toLowerCase()] = methodResults.map(pathway => ({
                        pathway: pathway.pathway,
                        pValue: pathway.pValue,
                        // Keep the genuine per-method FDR (was previously
                        // overwritten with the raw p-value, discarding the FDR
                        // that RRA is supposed to rank by).
                        pValueFDR: pathway.pValueFDR,
                        score: pathway.score,
                        _row: pathway.pathway,
                        name: pathway.name
                    }));
                });
            }
        });

        return pathwayMethodsData;
    } catch (error) {
        console.error('Error building pathway methods data:', error);
        throw error;
    }
};

// Fetch analysis results function
const fetchAnalysisResults = async (analysisId, analyses, configs) => {
    const analysis = analyses[analysisId];
    const config = configs.find(c => c.analysisId === analysisId);

    // Guard the inputs explicitly so a missing analysis/config is reported as
    // such instead of throwing a cryptic "cannot read property of undefined"
    // that then gets swallowed into a silent null.
    if (!analysis) {
        console.error(`[consensus ${analysisId}] No analysis found in session for this id; cannot aggregate results.`);
        return null;
    }
    if (!config) {
        console.error(`[consensus ${analysisId}] No config with analysisId found; cannot aggregate results.`);
        return null;
    }

    const geneSets = config.geneSets ?? [];
    if (geneSets.length === 0) {
        console.error(`[consensus ${analysisId}] config.geneSets is empty; analysis.results.aggregate would match no databases.`);
    }

    try {
        const response = await Meteor.callAsync("analysis.results.aggregate", {
            analysisId: analysisId,
            // For case if the input type is changed but the analysis is not re-run
            inputType: analysis.input === config.inputType ? analysis.input : config.inputType,
            geneSets
        });

        return response;
    } catch (error) {
        console.error(`[consensus ${analysisId}] analysis.results.aggregate failed:`, error);
        return null;
    }
};

// Core function for running consensus analysis
// selectedMethod/selectedRankBy are always supplied by the caller (resolved via
// resolveConsensusOptions, the single source of defaults). The compute method
// re-sanitizes them at its trust boundary.
const runConsensusAnalysis = async (analysisId, databaseId, methods, pathwayMethodsData, inputType, selectedMethod, selectedRankBy) => {
    // Call the consensus analysis pathway compute method
    await Meteor.callAsync('consensus.analysis.pathway.compute', {
        selectedPathwayResData: pathwayMethodsData,
        selectedMethod,
        selectedRankBy,
        enrichmentMethods: methods,
        analysisId: analysisId,
        databaseId: databaseId,
        name: "Analysis",
        inputType
    });
};
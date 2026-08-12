import { Meteor } from "meteor/meteor";
import { Mongo } from "meteor/mongo";
import { Random } from "meteor/random";
import {QueueProcessor} from "./QueueProcessor";

const timeout = 1000 * 60 * 60 * 24 * 7;
const MeteorDB = new MongoInternals.RemoteCollectionDriver(process.env.MONGO_URL + `?connectTimeoutMS=${timeout}&socketTimeoutMS=${timeout}&minPoolSize=1&maxPoolSize=20`);
const IDMappingDB = new MongoInternals.RemoteCollectionDriver(process.env.IDMAPPING_URL + `?connectTimeoutMS=${timeout}&socketTimeoutMS=${timeout}&minPoolSize=1&maxPoolSize=20`);

Meteor.startup(async () => {
    global.DBCollections = {
        // Existing collections
        Organism: new Mongo.Collection('organisms', { _driver: MeteorDB }),
        Database: new Mongo.Collection('database', { _driver: MeteorDB }),
        GeneSet: new Mongo.Collection('geneSets', { _driver: MeteorDB }),
        GeneSetAggregation: new Mongo.Collection('geneSetAggregations', { _driver: MeteorDB }),
        GeneInfo: new Mongo.Collection('geneInfo', { _driver: IDMappingDB }),
        GeneInfoTmp: new Mongo.Collection('geneInfoTmp', { _driver: IDMappingDB }),
        IDMappingTmp: new Mongo.Collection('idMappingTmp', { _driver: IDMappingDB }),
        IDMappingLogs: new Mongo.Collection("idMappingLogs", { _driver: MeteorDB }),
        IDMapping: new Mongo.Collection("idMapping", { _driver: IDMappingDB }),
        IDType: new Mongo.Collection('idTypes', { _driver: IDMappingDB }),
        AnnotationDB: new Mongo.Collection('annotationDB', { _driver: MeteorDB }),
        EntrezIDMapping: new Mongo.Collection('entrezIDMapping', { _driver: IDMappingDB }),
        EntrezIDMappingTmp: new Mongo.Collection('entrezIDMappingTmp', { _driver: IDMappingDB }),
        EntrezIDMappingLogs: new Mongo.Collection('entrezIDMappingLogs', { _driver: MeteorDB }),
        AnalysisConfig: new Mongo.Collection('analysisConfigs', { _driver: MeteorDB }),
        AnalysisLog: new Mongo.Collection('analysisLogs', { _driver: MeteorDB }),
        Session: new Mongo.Collection('sessions', { _driver: MeteorDB }),
        SessionConfig: new Mongo.Collection('sessionConfigs', { _driver: MeteorDB }),
        AnalysisConfigSnapshot: new Mongo.Collection('analysisConfigSnapshots', { _driver: MeteorDB }),
        AnalysisResult: new Mongo.Collection('analysisResults', { _driver: MeteorDB }),
        LlmQueue: new Mongo.Collection('llmQueue', { _driver: MeteorDB }),

        // Session recovery collections
        EmailRecoveryToken: new Mongo.Collection('emailRecoveryTokens', { _driver: MeteorDB }),
        SessionRecoveryLog: new Mongo.Collection('sessionRecoveryLogs', { _driver: MeteorDB }),

        // Existing queue-related collections
        PromptQueue: new Mongo.Collection('promptQueue', { _driver: MeteorDB }),
        BatchInfo: new Mongo.Collection('batchInfo', { _driver: MeteorDB }),
        UserSubmissionStats: new Mongo.Collection('userSubmissionStats', { _driver: MeteorDB }),
        ProcessingStats: new Mongo.Collection('processingStats', { _driver: MeteorDB }),
        AnalysisProgress: new Mongo.Collection('analysisProgress', { _driver: MeteorDB }),

        // New Mass Analysis collections
        MassAnalysisQueue: new Mongo.Collection('massAnalysisQueue', { _driver: MeteorDB }),
        MassAnalysisQueueItem: new Mongo.Collection('massAnalysisQueueItems', { _driver: MeteorDB }),

        // Workflow collections
        WorkflowExecutions: new Mongo.Collection('workflow_executions', { _driver: MeteorDB }),
        WorkflowSteps: new Mongo.Collection('workflow_steps', { _driver: MeteorDB }),

        // Study sharing. StudyShare holds REFERENCES ONLY — owner, source session, mode, the
        // selected analysisIds and an expiry. No analysis data is duplicated at share time; the
        // clone reads through these ids when the recipient imports.
        StudyShare: new Mongo.Collection('studyShares', { _driver: MeteorDB }),
        // Progress for an in-flight import, so the recipient's modal can show a percentage.
        ShareImportProgress: new Mongo.Collection('shareImportProgress', { _driver: MeteorDB })
    }

    // Existing indexes
    await DBCollections.Organism.createIndexAsync({ taxId: 1, code: 1 }, { unique: true })
    await DBCollections.Organism.createIndexAsync({ isEnabled: 1 })
    await DBCollections.Database.createIndexAsync({ name: 1, namespace: 1 }, { unique: true })
    await DBCollections.GeneSet.createIndexAsync({ database: 1, organism: 1, id: 1 }, { unique: true })
    await DBCollections.IDType.createIndexAsync({ name: 1, source: 1 }, { unique: true })
    await DBCollections.IDMappingLogs.createIndexAsync({ time: -1 });
    await DBCollections.EntrezIDMapping.createIndexAsync({ from: 1 });
    await DBCollections.EntrezIDMapping.createIndexAsync({ to: 1 });
    await DBCollections.EntrezIDMapping.createIndexAsync({ to: 1, type: 1, taxId: 1 });
    await DBCollections.EntrezIDMapping.createIndexAsync({ type: 1 });
    await DBCollections.EntrezIDMapping.createIndexAsync({ from: 1, type: 1, source: 1 });
    await DBCollections.EntrezIDMappingLogs.createIndexAsync({ time: -1 });
    await DBCollections.AnnotationDB.createIndexAsync({ name: 1, source: 1 });
    await DBCollections.Session.createIndexAsync({ userId: 1 });
    await DBCollections.AnalysisConfig.createIndexAsync({ analysisId: 1, inputType: 1, key: 1 })
    await DBCollections.AnalysisConfig.createIndexAsync({ analysisId: 1, key: 1 })
    await DBCollections.SessionConfig.createIndexAsync({ sessionId: 1, key: 1 })
    await DBCollections.AnalysisLog.createIndexAsync({ analysisId: 1, time: -1 })
    await DBCollections.AnalysisConfigSnapshot.createIndexAsync({ analysisId: 1, inputType: 1, key: 1 })
    await DBCollections.AnalysisConfigSnapshot.createIndexAsync({ analysisId: 1, key: 1 })
    await DBCollections.AnalysisResult.createIndexAsync({ analysisId: 1, inputType: 1, key: 1 })
    await DBCollections.LlmQueue.createIndexAsync({ userId: 1, createdAt: 1})

    // Existing queue indexes
    await DBCollections.PromptQueue.createIndexAsync({ status: 1 });
    await DBCollections.PromptQueue.createIndexAsync({ batchId: 1 });
    await DBCollections.PromptQueue.createIndexAsync({ userId: 1 });
    await DBCollections.PromptQueue.createIndexAsync({ createdAt: 1 });
    await DBCollections.PromptQueue.createIndexAsync({ processStartTime: 1 });
    await DBCollections.PromptQueue.createIndexAsync({ priority: -1 });
    await DBCollections.PromptQueue.createIndexAsync({ 'result.references': 1 });

    await DBCollections.BatchInfo.createIndexAsync({ userId: 1 });
    await DBCollections.BatchInfo.createIndexAsync({ status: 1 });
    await DBCollections.BatchInfo.createIndexAsync({ createdAt: 1 });
    await DBCollections.BatchInfo.createIndexAsync({ analysisId: 1 });
    await DBCollections.BatchInfo.createIndexAsync({ completedAt: 1 });

    await DBCollections.UserSubmissionStats.createIndexAsync({ userId: 1 });
    await DBCollections.ProcessingStats.createIndexAsync({ timestamp: -1 });

    // New Mass Analysis indexes with group support
    await DBCollections.MassAnalysisQueue.createIndexAsync({ sessionId: 1 });
    await DBCollections.MassAnalysisQueue.createIndexAsync({ status: 1 });
    await DBCollections.MassAnalysisQueue.createIndexAsync({ createdAt: -1 });
    await DBCollections.MassAnalysisQueue.createIndexAsync({ completedAt: -1 });

    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ massAnalysisId: 1 });
    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ analysisId: 1 });
    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ status: 1 });
    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ priority: -1, createdAt: 1 });
    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ massAnalysisId: 1, status: 1 });
    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ groupId: 1 }); // New index for group queries
    await DBCollections.MassAnalysisQueueItem.createIndexAsync({ massAnalysisId: 1, groupId: 1 }); // Compound index for group filtering

    // Reverse lookup analysisId -> owning study. Every ownership check on an analysisId-keyed
    // publication, method or REST endpoint runs this selector (see imports/utils/ownership.js),
    // so without these two indexes each authorization does a full scan of `sessions`.
    await DBCollections.Session.createIndexAsync({ 'analyses.id': 1 });
    await DBCollections.Session.createIndexAsync({ 'metaAnalyses.id': 1 });

    // Add index for Session analyses with mass analysis fields
    await DBCollections.Session.createIndexAsync({ 'analyses.isMassAnalysis': 1 });
    await DBCollections.Session.createIndexAsync({ 'analyses.massAnalysisId': 1 });
    await DBCollections.Session.createIndexAsync({ 'analyses.groupId': 1 });

    // Study sharing indexes
    // share.list queries by sourceSessionId alone (authority over a link follows the STUDY, not
    // whoever minted it), so that needs to be a leading field in its own right.
    await DBCollections.StudyShare.createIndexAsync({ sourceSessionId: 1 });
    await DBCollections.StudyShare.createIndexAsync({ ownerUserId: 1 });
    await DBCollections.StudyShare.createIndexAsync({ expiresAt: 1 });
    await DBCollections.ShareImportProgress.createIndexAsync({ userId: 1, createdAt: -1 });

    // Session recovery indexes
    await DBCollections.EmailRecoveryToken.createIndexAsync({ token: 1 }, { unique: true });
    await DBCollections.EmailRecoveryToken.createIndexAsync({ expiresAt: 1 });
    await DBCollections.EmailRecoveryToken.createIndexAsync({ email: 1 });
    await DBCollections.SessionRecoveryLog.createIndexAsync({ sessionId: 1 });
    await DBCollections.SessionRecoveryLog.createIndexAsync({ attemptBy: 1 });

    // Workflow indexes
    await DBCollections.WorkflowExecutions.createIndexAsync({ userId: 1, createdAt: -1 });
    await DBCollections.WorkflowExecutions.createIndexAsync({ workflowId: 1 });
    await DBCollections.WorkflowSteps.createIndexAsync({ workflowId: 1, stepNumber: 1 });
    await DBCollections.WorkflowSteps.createIndexAsync({ userId: 1 });

    // Insert KEGG and GO database
    let dbs = [
        { name: "KEGG", version: '' },
        { name: "GO", namespace: "biological_process", version: '' },
        { name: "GO", namespace: "cellular_component", version: '' },
        { name: "GO", namespace: "molecular_function", version: '' },
        { name: "Reactome", version: '' },
        { name: "MitoCarta", version: '' }
    ]

    for (let db of dbs) {
        let query = { name: db.name };
        if (db.namespace) query.namespace = db.namespace;

        let existing = await DBCollections.Database.rawCollection().findOne(query);
        if (!existing) {
            try {
                await DBCollections.Database.rawCollection().insertOne({
                    ...db,
                    _id: Random.id()
                });
                console.log(`Inserted: ${db.name} ${db.namespace || ''}`);
            } catch (e) {
                console.error(`Error inserting ${db.name} ${db.namespace || ''}: ${e.message}`);
            }
        } else {
            console.log(`Already exists: ${db.name} ${db.namespace || ''}`);
        }
    }
    //
    // let geneSetAggData = await DBCollections.GeneSet.rawCollection().aggregate([
    //     {
    //         $group: {
    //             _id: {
    //                 database: "$database", organism: "$organism"
    //             },
    //             count: {
    //                 $sum: 1
    //             }
    //         }
    //     }
    // ], { allowDiskUse: true }).toArray()
    //
    // try {
    //     await DBCollections.GeneSetAggregation.rawCollection().drop()
    // } catch (e) {
    //     //Do nothing
    // }
    //
    // // try {
    // //     await DBCollections.GeneSetAggregation.insertAsync(
    // //         geneSetAggData.map(e => ({
    // //             _id: Random.id(),
    // //             database: e._id.database,
    // //             organism: e._id.organism,
    // //             count: e.count
    // //         }))
    // //     )
    // // } catch (e) { }
    //
    // for (const e of geneSetAggData) {
    //     try {
    //         await DBCollections.GeneSetAggregation.insertAsync({
    //             _id: Random.id(),
    //             database: e._id.database,
    //             organism: e._id.organism,
    //             count: e.count
    //         });
    //     } catch (error) {
    //         console.error(`Error inserting document: ${error.message}`);
    //     }
    // }
    //
    // await DBCollections.GeneSetAggregation.createIndexAsync({ database: 1, organism: 1 }, { unique: true })
    QueueProcessor.start();
});
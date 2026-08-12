import { Mongo } from "meteor/mongo";

//Initialize Collections
global.DBCollections = {
    Organism: new Mongo.Collection('organisms'),
    Database: new Mongo.Collection('database'),
    GeneSet: new Mongo.Collection('geneSets'),
    GeneSetAggregation: new Mongo.Collection('geneSetAggregations'),
    GeneInfo: new Mongo.Collection('geneInfo'),
    IDType: new Mongo.Collection('idTypes'),
    EntrezIDMapping: new Mongo.Collection('entrezIDMapping'),
    AnnotationDB: new Mongo.Collection('annotationDB'),
    Session: new Mongo.Collection('sessions'),
    AnalysisConfig: new Mongo.Collection('analysisConfigs'),
    IDMappingLogs: new Mongo.Collection("idMappingLogs"),
    SessionConfig: new Mongo.Collection('sessionConfigs'),
    AnalysisLog: new Mongo.Collection('analysisLogs'),
    AnalysisResult: new Mongo.Collection('analysisResults'),
    AnalysisConfigSnapshot: new Mongo.Collection('analysisConfigSnapshots'),
    LlmQueue: new Mongo.Collection('llmQueue'),
    AnalysisProgress: new Mongo.Collection('analysisProgress'),
    MassAnalysisQueue: new Mongo.Collection('massAnalysisQueue'),
    MassAnalysisQueueItem: new Mongo.Collection('massAnalysisQueueItems'),
    StudyShare: new Mongo.Collection('studyShares'),
    ShareImportProgress: new Mongo.Collection('shareImportProgress')
}
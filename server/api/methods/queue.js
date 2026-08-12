// server/methods.js
import {Meteor} from 'meteor/meteor';
import {QueueProcessor} from '../../startup/QueueProcessor';
import {check} from 'meteor/check';
import Permission from '../helper/Permission';
import {validateInsightName} from '/imports/utils/insightName';
import axios from 'axios';
import {assertWritableSession, isReadOnlySession, READ_ONLY_MESSAGE} from '../../helper/ownership';

// A BatchInfo row records the study it was generated for. Renaming or deleting a report is a change
// to that study, so a view-only import must refuse it even though the recipient legitimately owns
// the row — ownership alone is not the test once a study can be read-only.
const assertBatchStudyWritable = async (batch) => {
    if (!batch || !batch.sessionId) return;
    const session = await DBCollections.Session.findOneAsync(
        {_id: batch.sessionId},
        {fields: {readOnly: 1}}
    );
    if (isReadOnlySession(session)) {
        throw new Meteor.Error('read-only-study', READ_ONLY_MESSAGE);
    }
};

Meteor.methods({
    'queue.getBatchStatus': async function (batchId) {
        // batchId was untyped and unowned: {$ne: null} returned every prompt document on the
        // platform, including result.answer — the generated interpretation — for every user.
        check(batchId, String);
        // The findOneAsync calls here were also missing their await, so `batch` was a Promise and
        // spread to {} in the response.
        const batch = await DBCollections.BatchInfo.findOneAsync(batchId);
        if (!batch) {
            throw new Meteor.Error('not-found', 'Batch not found');
        }
        if (!this.userId || this.userId !== batch.userId) {
            throw new Meteor.Error('not-authorized');
        }

        const prompts = await DBCollections.PromptQueue.find({batchId}).fetchAsync();
        const stats = await DBCollections.ProcessingStats.findOneAsync({}, {sort: {timestamp: -1}});

        const remainingPrompts = prompts.filter(p => p.status !== 'completed').length;
        const estimatedTimeMs = remainingPrompts * (stats?.averageTime || 120000) / 2;

        return {
            batch: {
                ...batch,
                estimatedCompletion: new Date(Date.now() + estimatedTimeMs)
            },
            prompts: prompts.map(p => ({
                ...p,
                estimatedCompletion: p.status === 'pending' ?
                    new Date(Date.now() + estimatedTimeMs) : null
            }))
        };
    },


    'queue.getUserBatches': async function (userId) {
        if (!this.userId || this.userId !== userId) {
            throw new Meteor.Error('not-authorized');
        }

        try {
            // Use rawCollection to ensure we get the MongoDB cursor directly
            const batches = await DBCollections.BatchInfo.rawCollection()
                .find({userId})
                .toArray();


            // Now map over the array to add prompts
            return await Promise.all(batches.map(async batch => {
                try {
                    const prompts = await DBCollections.PromptQueue.find({
                        batchId: batch._id
                    }).fetch();
                    return {
                        ...batch,
                        prompts: prompts || []
                    };
                } catch (error) {
                    console.error(`Error fetching prompts for batch ${batch._id}:`, error);
                    return {
                        ...batch,
                        prompts: []
                    };
                }
            }));
        } catch (error) {
            console.error('Error in getUserBatches:', error);
            throw new Meteor.Error('fetch-error', 'Failed to fetch user batches');
        }
    },

    'queue.getUserBatchesBySession': async function ({userId, sessionId}) {
        if (!this.userId || this.userId !== userId) {
            throw new Meteor.Error('not-authorized');
        }

        if (!sessionId) {
            throw new Meteor.Error('invalid-params', 'Session ID is required');
        }

        try {
            // Use rawCollection to ensure we get the MongoDB cursor directly
            const batches = await DBCollections.BatchInfo.rawCollection()
                .find({userId, sessionId})
                .toArray();

            console.log('batches', batches);


            // Now map over the array to add prompts
            return await Promise.all(batches.map(async batch => {
                try {
                    const prompts = await DBCollections.PromptQueue.find({
                        batchId: batch._id
                    }).fetch();
                    return {
                        ...batch,
                        prompts: prompts || []
                    };
                } catch (error) {
                    console.error(`Error fetching prompts for batch ${batch._id}:`, error);
                    return {
                        ...batch,
                        prompts: []
                    };
                }
            }));
        } catch (error) {
            console.error('Error in getUserBatches:', error);
            throw new Meteor.Error('fetch-error', 'Failed to fetch user batches');
        }
    },

    'queue.getBatchesBySession': async function ({userId, sessionId}) {
        if (!this.userId || this.userId !== userId) {
            throw new Meteor.Error('not-authorized');
        }

        if (!sessionId) {
            throw new Meteor.Error('invalid-params', 'Session ID is reqgetBatchesBySessionuired');
        }

        try {
            // Use rawCollection to ensure we get the MongoDB cursor directly.
            // userId is part of the selector, not just the guard above: the guard only proved the
            // caller is who they claim, while sessionId was a free parameter — pairing your own
            // userId with someone else's sessionId returned their batches and AI reports.
            const batches = await DBCollections.BatchInfo.rawCollection()
                .find({sessionId, userId: this.userId})
                .toArray();

            // Now map over the array to add prompts
            return await Promise.all(batches.map(async batch => {
                try {
                    const prompts = await DBCollections.PromptQueue.find({
                        batchId: batch._id
                    }).fetch();
                    return {
                        ...batch,
                        prompts: prompts || []
                    };
                } catch (error) {
                    console.error(`Error fetching prompts for batch ${batch._id}:`, error);
                    return {
                        ...batch,
                        prompts: []
                    };
                }
            }));
        } catch (error) {
            console.error('Error in getBatchesBySession:', error);
            throw new Meteor.Error('fetch-error', 'Failed to fetch user batches');
        }
    },

    'queue.getQueueStats': async function (batchId) {
        check(batchId, String);
        const batch = await DBCollections.BatchInfo.findOneAsync(batchId);
        if (!batch) {
            throw new Meteor.Error('not-found', 'Batch not found');
        }
        // Position/ETA is derived from the batch's createdAt, so it leaked timing information about
        // another user's batch. It also threw on a missing batch (batch.createdAt on undefined).
        if (!this.userId || this.userId !== batch.userId) {
            throw new Meteor.Error('not-authorized');
        }
        const pendingPrompts = await DBCollections.PromptQueue.find({
            status: 'pending',
            createdAt: {$lte: batch.createdAt}
        }).countAsync();

        const estimatedWaitTime = Math.ceil(pendingPrompts / 2) * QueueProcessor.instance.averageProcessingTime;

        return {
            estimatedStart: new Date(Date.now() + estimatedWaitTime),
            estimatedCompletion: new Date(Date.now() + estimatedWaitTime + QueueProcessor.instance.averageProcessingTime)
        };
    },

    'queue.removePrompt': async function (promptId) {
        const prompt = await DBCollections.PromptQueue.findOneAsync(promptId);
        if (!prompt) {
            throw new Meteor.Error('not-found', 'Prompt not found');
        }

        if (!this.userId || this.userId !== prompt.userId) {
            throw new Meteor.Error('not-authorized');
        }

        if (prompt.status !== 'pending') {
            throw new Meteor.Error('invalid-status', 'Can only remove pending prompts');
        }

        await DBCollections.PromptQueue.removeAsync(promptId);

        // Update batch status
        const remainingPrompts = await DBCollections.PromptQueue.find({
            batchId: prompt.batchId
        }).countAsync();

        if (remainingPrompts === 0) {
            await DBCollections.BatchInfo.removeAsync(prompt.batchId);
        } else {
            const completedPrompts = await DBCollections.PromptQueue.find({
                batchId: prompt.batchId,
                status: 'completed'
            }).countAsync();

            await DBCollections.BatchInfo.updateAsync({_id: prompt.batchId}, {
                $set: {
                    completedPrompts,
                    totalPrompts: remainingPrompts
                }
            });
        }
    },

    'queue.getUserStats': function (userId) {
        if (!this.userId || this.userId !== userId) {
            throw new Meteor.Error('not-authorized');
        }

        return DBCollections.UserSubmissionStats.findOneAsync({userId}) || {
            userId,
            submissions: [],
            totalPrompts: 0
        };
    },

    // These three control the SHARED LLM queue for the whole platform, so a login is not a
    // sufficient gate — any visitor gets one automatically. Operator-only.
    'queue.pauseProcessing': async function () {
        await Permission.isAdmin(this.userId);
        QueueProcessor.instance.pause();
    },

    'queue.resumeProcessing': async function () {
        await Permission.isAdmin(this.userId);
        QueueProcessor.instance.resume();
    },

    'queue.resetFailedPrompts': async function () {
        await Permission.isAdmin(this.userId);
        QueueProcessor.instance.resetFailedPrompts();
    },

    'queue.getProcessingStats': function () {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized');
        }

        return {
            currentLoad: QueueProcessor.instance.processingPrompts.size,
            averageProcessingTime: QueueProcessor.instance.averageProcessingTime,
            isPaused: QueueProcessor.instance.isPaused,
            recentStats: DBCollections.ProcessingStats.find(
                {},
                {
                    sort: {timestamp: -1},
                    limit: 100
                }
            ).fetch()
        };
    },

    'queue.removeBatch': async function(batchId) {
        const batch = await DBCollections.BatchInfo.findOneAsync(batchId);
        if (!batch) {
            throw new Meteor.Error('not-found', 'Batch not found');
        }

        if (!this.userId || this.userId !== batch.userId) {
            throw new Meteor.Error('not-authorized');
        }
        // Reports belong to a study, so a view-only imported study must reject this too. Owning the
        // batch is not sufficient — the recipient does own it, they just may not change it.
        await assertBatchStudyWritable(batch);

        // Remove both the prompt records AND the batch document itself. Previously
        // only the PromptQueue rows were removed, which orphaned the BatchInfo doc
        // (it lingered with 0 prompts, so the dashboard hid its delete button).
        await DBCollections.PromptQueue.removeAsync({batchId});
        await DBCollections.BatchInfo.removeAsync({_id: batchId});
    },

    'queue.updateBatchName': async function(batchId, insightName) {
        const batch = await DBCollections.BatchInfo.findOneAsync(batchId);
        if (!batch) {
            throw new Meteor.Error('not-found', 'Batch not found');
        }

        if (!this.userId || this.userId !== batch.userId) {
            throw new Meteor.Error('not-authorized');
        }
        // Reports belong to a study, so a view-only imported study must reject this too. Owning the
        // batch is not sufficient — the recipient does own it, they just may not change it.
        await assertBatchStudyWritable(batch);

        const validation = validateInsightName(insightName);
        if (!validation.ok) {
            throw new Meteor.Error('invalid-name', validation.error);
        }

        await DBCollections.BatchInfo.updateAsync({_id: batchId}, {$set: {insightName: validation.value}});
        return validation.value;
    },

    'queue.getBatchInfo': async function(batchId) {
        const batch = await DBCollections.BatchInfo.findOneAsync(batchId);
        if (!batch) {
            throw new Meteor.Error('not-found', 'Batch not found');
        }

        // Restored: this was the only commented-out check in this file, while the eleven others are
        // live. Without it the method handed back another user's BatchInfo — sessionId, analysisId,
        // analysisName, insightName, selectedGenes/Methods/Pathways and the interpretation context.
        if (!this.userId || this.userId !== batch.userId) {
            throw new Meteor.Error('not-authorized');
        }

        return batch;
    },

    'queue.createWorkflowBatch': async function(workflowData) {
        if (!this.userId || this.userId !== workflowData.userId) {
            throw new Meteor.Error('not-authorized');
        }
        // Generating an insight writes a report into the study, so a view-only import refuses it.
        await assertWritableSession({sessionId: workflowData.sessionId, requesterUserId: this.userId});

        try {
            // Fetch workflow result
            const workflowResult = await Meteor.callAsync('aiWorkflow.getFinalReport', workflowData.workflowId);

            // Create batch record
            const batchId = await DBCollections.BatchInfo.insertAsync({
                userId: workflowData.userId,
                sessionId: workflowData.sessionId,
                analysisId: workflowData.analysisId,
                analysisName: workflowData.analysisName,
                insightName: workflowData.insightName,
                status: 'completed',
                totalPrompts: 1,
                completedPrompts: 1,
                createdAt: new Date(workflowResult.createdAt),
                estimatedCompletionTime: new Date(workflowResult.createdAt),
                penalty: 0,
                selectedGenes: workflowData.selectedGenes,
                selectedMethods: workflowData.selectedMethods,
                selectedPathways: workflowData.selectedPathways,
                // The wizard has always sent this and this insert has always dropped it, so a
                // stored report could not say WHY it carries no genes — the user opted out, or the
                // analysis had none. Batches written before this stay undefined; nothing reads the
                // field yet, so they behave exactly as they did.
                selectedSections: workflowData.selectedSections || null,
                // Persist the biological context the user entered (organism, tissue,
                // disease, etc.) so it can be reviewed later on the finished report.
                interpretationContext: workflowData.interpretationContext || null,
                workflowType: workflowData.workflowType,
                workflowId: workflowData.workflowId
            });

            // Create a single "prompt" record for the workflow report
            await DBCollections.PromptQueue.insertAsync({
                batchId,
                userId: workflowData.userId,
                sessionId: workflowData.sessionId,
                analysisName: workflowData.analysisName,
                templateId: 'publication-ready',
                templateTitle: 'Publication-Ready Report with Fact-Checking',
                prompt: 'Workflow-generated report',
                status: 'completed',
                createdAt: new Date(workflowResult.createdAt),
                completedAt: new Date(workflowResult.createdAt),
                penalty: 0,
                batchIndex: 0,
                totalInBatch: 1,
                result: {
                    answer: workflowResult.report,
                    metadata: workflowResult.metadata
                },
                workflowMetadata: {
                    workflowId: workflowData.workflowId,
                    duration: workflowResult.duration
                }
            });

            return batchId;
        } catch (error) {
            console.error('Error creating workflow batch:', error);
            throw new Meteor.Error('workflow-batch-error', error.message);
        }
    }
});
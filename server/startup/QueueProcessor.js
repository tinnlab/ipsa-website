import axios from 'axios';
import {Meteor} from "meteor/meteor";
import { getDefaultLLM } from '../llm/config.js';

export class QueueProcessor {
    static instance = null;
    static submissions = new Map();
    static baseSubmissionIntervalThreshold = 1200000; // 20 minutes base threshold
    static submissionIntervalThreshold = 1200000;
    static penaltyMultiplier = 0.5;
    static penaltyFactors = {
        1: 1.0,    // First submission in window: normal penalty (0.5)
        2: 0.25,   // Second submission: quarter penalty
        3: 0.125,  // Third submission: eighth penalty
        4: 0.0625  // Fourth or more: very low penalty
    };
    static maxSubmissionsInWindow = 4;

    constructor() {
        this.isProcessing = false;
        this.isPaused = false;
        this.processingPrompts = new Set();
        this.averageProcessingTime = 120000;
        this.maxParallelPrompts = 2;
        this.globalQueue = [];
    }

    async addSubmission(timestamp, promptCount) {
        const user = await Meteor.userAsync();
        const userId = user._id;

        if (!QueueProcessor.submissions.has(userId)) {
            QueueProcessor.submissions.set(userId, []);
        }

        // Check submission count in threshold window
        const userSubmissions = QueueProcessor.submissions.get(userId);
        const submissionsInWindow = userSubmissions.filter(sub =>
            timestamp - sub.timestamp < QueueProcessor.submissionIntervalThreshold
        );

        if (submissionsInWindow.length >= QueueProcessor.maxSubmissionsInWindow) {
            throw new Meteor.Error(
                'submission-limit-exceeded',
                `You can only submit ${QueueProcessor.maxSubmissionsInWindow} times within ${QueueProcessor.submissionIntervalThreshold / 60000} minutes.`
            );
        }

        const penalty = QueueProcessor.calculatePenalty(userId, timestamp);

        userSubmissions.push({
            timestamp,
            promptCount,
            penalty
        });

        const timeWindow = 10 * 60 * 10000;
        QueueProcessor.submissions.set(
            userId,
            userSubmissions.filter(sub => timestamp - sub.timestamp <= timeWindow)
        );

        await this.updateGlobalQueue();

        return penalty;
    }

    static calculatePenalty(userId, timestamp) {
        if (!userId) {
            return 1.0;
        }

        const userSubmissions = this.submissions.get(userId);
        if (!userSubmissions || userSubmissions.length === 0) {
            return 1.0;
        }

        // Count submissions within threshold window
        const submissionsInWindow = userSubmissions.filter(sub =>
            timestamp - sub.timestamp < this.submissionIntervalThreshold
        );

        const submissionCount = submissionsInWindow.length + 1; // Include current submission
        const lastSubmission = userSubmissions[userSubmissions.length - 1];
        const timeSinceLastSubmission = timestamp - lastSubmission.timestamp;

        if (timeSinceLastSubmission < this.submissionIntervalThreshold) {
            // Get penalty factor based on submission count, default to lowest if count exceeds our factors
            const penaltyFactor = this.penaltyFactors[Math.min(submissionCount, Object.keys(this.penaltyFactors).length)];
            return this.penaltyMultiplier * penaltyFactor;
        }

        return 1.0;
    }

    static start() {
        if (!this.instance) {
            this.instance = new QueueProcessor();
        }
        this.instance.startProcessing();
        return this.instance;
    }

    static getInstance() {
        if (!this.instance) {
            this.instance = new QueueProcessor();
        }
        return this.instance;
    }

    async updateGlobalQueue() {
        try {
            const pendingPrompts = await DBCollections.PromptQueue.find({
                status: 'pending',
                _id: {$nin: Array.from(this.processingPrompts)}
            }).fetch();

            const userGroups = new Map();
            for (const prompt of pendingPrompts) {
                if (!userGroups.has(prompt.userId)) {
                    userGroups.set(prompt.userId, []);
                }
                userGroups.get(prompt.userId).push(prompt);
            }

            // Sort each user's prompts by penalty and time
            for (const prompts of userGroups.values()) {
                prompts.sort((a, b) => {
                    if (a.penalty !== b.penalty) {
                        return b.penalty - a.penalty;  // Higher penalty first
                    }
                    return a.createdAt - b.createdAt;  // Then by timestamp
                });
            }

            // Sort users by their first prompt time
            const sortedUsers = Array.from(userGroups.entries())
                .sort((a, b) => {
                    const [_, aPrompts] = a;
                    const [__, bPrompts] = b;
                    return aPrompts[0].createdAt - bPrompts[0].createdAt;
                })
                .map(([userId]) => userId);

            // First, interleave prompts between users
            let interleavedQueue = [];
            let position = 0;
            let hasMore = true;

            while (hasMore) {
                hasMore = false;
                for (const userId of sortedUsers) {
                    const userPrompts = userGroups.get(userId);
                    if (position < userPrompts.length) {
                        interleavedQueue.push(userPrompts[position]);
                        hasMore = true;
                    }
                }
                position++;
            }

            // Then, do a final sort based on penalty and threshold
            const currentTime = Date.now();
            this.globalQueue = interleavedQueue.sort((a, b) => {
                const getThresholdForPenalty = (penalty) => {
                    return QueueProcessor.baseSubmissionIntervalThreshold * (1 / penalty);
                };

                const aThreshold = getThresholdForPenalty(a.penalty);
                const bThreshold = getThresholdForPenalty(b.penalty);

                const aWaitedLongEnough = a.penalty < 1 && (currentTime - a.createdAt) >= aThreshold;
                const bWaitedLongEnough = b.penalty < 1 && (currentTime - b.createdAt) >= bThreshold;

                // If either prompt has waited their threshold time, maintain their interleaved order
                if (aWaitedLongEnough || bWaitedLongEnough) {
                    return 0;
                }

                // If both have same low penalty, sort by creation time
                if ((a.penalty < 1 && b.penalty < 1) && (a.penalty === b.penalty)) {
                    return a.createdAt - b.createdAt;
                }

                // Otherwise, sort by penalty
                if (a.penalty !== b.penalty) {
                    return b.penalty - a.penalty;
                }

                return 0;
            });

            console.log('Global queue updated:', this.globalQueue.map(p => ({
                id: p._id,
                userId: p.userId,
                penalty: p.penalty,
                createdAt: p.createdAt,
                waitTime: currentTime - p.createdAt,
                requiredWaitTime: QueueProcessor.baseSubmissionIntervalThreshold * (1 / p.penalty)
            })));
        } catch (error) {
            console.error('Error updating global queue:', error);
        }
    }

    async getAvailableSlots() {
        try {
            const dbProcessing = await DBCollections.PromptQueue.find({
                status: 'processing'
            }).countAsync();

            const localProcessing = this.processingPrompts.size;
            const currentlyProcessing = Math.max(dbProcessing, localProcessing);
            const availableSlots = Math.max(0, this.maxParallelPrompts - currentlyProcessing);

            return availableSlots;
        } catch (error) {
            console.error('Error getting available slots:', error);
            return 0;
        }
    }

    async getNextPrompts(count) {
        try {
            if (this.globalQueue.length === 0) {
                return [];
            }

            const prompts = [];
            let index = 0;

            while (prompts.length < count && index < this.globalQueue.length) {
                const prompt = this.globalQueue[index];

                const promptStatus = await DBCollections.PromptQueue.findOneAsync({
                    _id: prompt._id,
                    status: 'pending'
                });

                if (promptStatus && !this.processingPrompts.has(prompt._id)) {
                    prompts.push(prompt);
                }

                index++;
            }

            this.globalQueue = this.globalQueue.filter(p =>
                !prompts.some(selected => selected._id === p._id)
            );

            return prompts;
        } catch (error) {
            console.error('Error getting next prompts:', error);
            return [];
        }
    }

    async startProcessing() {
        if (this.isProcessing || this.isPaused) return;
        this.isProcessing = true;
        console.log('Queue processor started');

        await this.cleanupStuckPrompts();
        await this.updateGlobalQueue();

        while (this.isProcessing && !this.isPaused) {
            try {
                const availableSlots = await this.getAvailableSlots();

                if (availableSlots > 0) {
                    const promptsToProcess = await this.getNextPrompts(availableSlots);
                    if (promptsToProcess.length === 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }

                    const processPromises = promptsToProcess.map(prompt =>
                        this.processPrompt(prompt)
                    );
                    await Promise.all(processPromises);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error('Queue processing error:', error);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async cleanupStuckPrompts() {
        try {
            const stuckPrompts = await DBCollections.PromptQueue.find({
                status: 'processing',
                processStartTime: {
                    $lt: new Date(Date.now() - 30 * 60 * 1000)
                }
            }).fetch();

            for (const prompt of stuckPrompts) {
                await DBCollections.PromptQueue.updateAsync(prompt._id, {
                    $set: {
                        status: 'pending',
                        processStartTime: null,
                        error: 'Reset due to stuck in processing state',
                        retries: (prompt.retries || 0) + 1
                    }
                });
                console.log(`Reset stuck prompt: ${prompt._id}`);
            }
        } catch (error) {
            console.error('Error cleaning up stuck prompts:', error);
        }
    }

    async processPrompt(prompt) {
        if (this.processingPrompts.has(prompt._id)) {
            console.warn(`Prompt ${prompt._id} is already being processed`);
            return;
        }

        this.processingPrompts.add(prompt._id);
        const startTime = new Date();

        try {
            const updated = await DBCollections.PromptQueue.updateAsync(
                {
                    _id: prompt._id,
                    status: 'pending'
                },
                {
                    $set: {
                        status: 'processing',
                        processStartTime: startTime
                    }
                }
            );

            if (!updated) {
                console.warn(`Prompt ${prompt._id} was already picked up by another processor`);
                this.processingPrompts.delete(prompt._id);
                return;
            }

            // Use new unified LLM interface
            const llm = getDefaultLLM();
            const response = await llm.chat(prompt.prompt, {
                max_tokens: 10000,
                temperature: 0.1
            });

            const endTime = new Date();
            const processingTime = endTime - startTime;

            // Extract cleaned content from response
            const processedResult = response.content;

            await this.updateProcessingStats(processingTime);
            await DBCollections.PromptQueue.updateAsync(prompt._id, {
                $set: {
                    status: 'completed',
                    processEndTime: endTime,
                    result: {
                        answer: processedResult
                    },
                    processingTime
                }
            });

            await this.updateBatchProgress(prompt.batchId);
        } catch (error) {
            console.error('Error processing prompt:', error);
            const retries = (prompt.retries || 0) + 1;

            await DBCollections.PromptQueue.updateAsync(prompt._id, {
                $set: {
                    status: retries < 3 ? 'pending' : 'error',
                    error: error.message,
                    retries,
                    processStartTime: retries < 3 ? null : startTime
                }
            });
        } finally {
            this.processingPrompts.delete(prompt._id);
        }
    }

    async updateProcessingStats(processingTime) {
        const newAverage = (this.averageProcessingTime * 0.9) + (processingTime * 0.1);
        this.averageProcessingTime = newAverage;
        await DBCollections.ProcessingStats.insertAsync({
            timestamp: new Date(),
            processingTime,
            averageTime: newAverage
        });
    }

    async updateBatchProgress(batchId) {
        if (!batchId) return;

        const totalPrompts = await DBCollections.PromptQueue.find({batchId}).countAsync();
        const completedPrompts = await DBCollections.PromptQueue.find({
            batchId,
            status: 'completed'
        }).countAsync();

        const isComplete = totalPrompts === completedPrompts;
        await DBCollections.BatchInfo.updateAsync({_id: batchId}, {
            $set: {
                completedPrompts,
                status: isComplete ? 'completed' : 'processing',
                completedAt: isComplete ? new Date() : null
            }
        });
    }

    async getEstimatedProcessingTime() {
        return this.averageProcessingTime;
    }

    async getQueueStats(batchId) {
        const pendingAhead = await DBCollections.PromptQueue.find({
            status: 'pending',
            createdAt: {$lt: (await DBCollections.BatchInfo.findOneAsync(batchId)).createdAt}
        }).countAsync();

        const now = Date.now();
        const estimatedStart = new Date(now + (pendingAhead * this.averageProcessingTime));
        const batchInfo = await DBCollections.BatchInfo.findOneAsync(batchId);
        const estimatedCompletion = new Date(estimatedStart.getTime() +
            (batchInfo.totalPrompts * this.averageProcessingTime));

        return {
            estimatedStart,
            estimatedCompletion,
            pendingAhead
        };
    }

    async getProcessingStatus() {
        const dbProcessing = await DBCollections.PromptQueue.find({
            status: 'processing'
        }).countAsync();

        return {
            setSize: this.processingPrompts.size,
            dbProcessing,
            isOverLimit: dbProcessing > this.maxParallelPrompts,
            processingIds: Array.from(this.processingPrompts),
            queueLength: this.globalQueue.length,
            allSubmissions: Array.from(QueueProcessor.submissions.entries()).map(([userId, subs]) => ({
                userId,
                count: subs.length,
                latestPenalty: subs.length > 0 ? subs[subs.length - 1].penalty : 1.0
            }))
        };
    }

    pause() {
        this.isPaused = true;
        console.log('Queue processor paused');
    }

    resume() {
        this.isPaused = false;
        this.startProcessing();
        console.log('Queue processor resumed');
    }
}
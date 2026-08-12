import { Meteor } from 'meteor/meteor';

Meteor.publish('userBatches', function(userId) {
    if (!this.userId || this.userId !== userId) {
        return this.ready();
    }

    return [
        DBCollections.BatchInfo.find({ userId }),
        DBCollections.PromptQueue.find({ userId }),
        DBCollections.UserSubmissionStats.find({ userId }),
        DBCollections.ProcessingStats.find({}, {
            sort: { timestamp: -1 },
            limit: 100
        })
    ];
});

// 'batchDetails' and 'analysisInsights' were removed here. Both had zero subscribers, and both
// were already broken: they called the SYNC DBCollections.BatchInfo.findOne, which the Meteor 3
// server driver no longer provides, so they threw and failed closed. Their ids were also untyped
// and used as full selectors on both sides of the ownership check, so fixing the sync call alone
// would have turned two dead publications into two live cross-user leaks.

Meteor.publish('queueStatus', function() {
    if (!this.userId) {
        return this.ready();
    }

    return [
        DBCollections.ProcessingStats.find({}, {
            sort: { timestamp: -1 },
            limit: 100
        }),
        // Constrained to the subscriber: this published every user's rows, and the userId field
        // made it a directory of account ids for anyone who subscribed.
        DBCollections.PromptQueue.find({
            userId: this.userId,
            status: { $in: ['processing', 'error'] }
        }, {
            fields: {
                status: 1,
                userId: 1,
                processStartTime: 1,
                error: 1
            }
        })
    ];
});

Meteor.publish('batchProgress', function(batchIds) {
    if (!this.userId) {
        return this.ready();
    }

    return [
        DBCollections.BatchInfo.find({
            _id: { $in: batchIds },
            userId: this.userId
        }),
        DBCollections.PromptQueue.find({
            batchId: { $in: batchIds },
            userId: this.userId
        }, {
            fields: {
                status: 1,
                batchId: 1,
                processStartTime: 1,
                processEndTime: 1,
                error: 1,
                estimatedCompletion: 1
            }
        })
    ];
});

Meteor.publish('userSubmissionStats', function() {
    if (!this.userId) {
        return this.ready();
    }

    return DBCollections.UserSubmissionStats.find({
        userId: this.userId
    });
});
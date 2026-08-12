import { Meteor } from 'meteor/meteor';

// Both publications used to take the userId to publish as a CLIENT-SUPPLIED argument and never
// compared it to this.userId — the same flaw that was fixed in session.all. Any visitor could
// subscribe with someone else's userId and receive that account's LLM queue, including
// `result`: the AI-generated interpretation of their analyses.
//
// The argument is still accepted so existing subscribe call sites need no change, but it is
// ignored in favour of this.userId.
Meteor.publish({
    'llm.tasks'({ idUser } = {}) {
        if (!this.userId) return this.ready();
        return DBCollections.LlmQueue.find({ userId: this.userId });
    },
    'llmQueue.userInsights'({ idUser, sessionId } = {}) {
        if (!this.userId) return this.ready();
        return DBCollections.LlmQueue.find(
            {
                userId: this.userId,
                $or: [
                    { type: { $exists: false } },
                    { status: 'completed', sessionId }
                ]
            },
            {
                fields: {
                    datasets: 1,
                    createdAt: 1,
                    result: 1,
                    templateName: 1,
                    type: 1,
                    status: 1
                },
                sort: { createdAt: -1 },
                limit: 50
            }
        );
    }
});

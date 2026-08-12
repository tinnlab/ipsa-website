export class SubmissionTracker {
    constructor() {
        // Track all submissions within the time window
        this.submissions = [];

        // Time window for tracking submissions (10 minutes)
        this.timeWindow = 10 * 60 * 10000;

        // Threshold for considering submissions as "rapid" (10 minutes)
        this.submissionIntervalThreshold = 600000;

        // Penalty multiplier for rapid submissions (reduces priority by half)
        this.penaltyMultiplier = 0.5;
    }

    /**
     * Calculate penalty factor for a new submission
     * @param {number} timestamp - Timestamp of the new submission
     * @returns {number} - Penalty factor (1.0 = no penalty, 0.5 = reduced priority)
     */
    calculatePenalty(timestamp) {
        // Remove old submissions outside the time window
        this.cleanOldSubmissions(timestamp);

        // If this is the first submission, return no penalty
        if (this.submissions.length === 0) {
            return 1.0;
        }

        // Get the most recent submission
        const lastSubmission = this.submissions[this.submissions.length - 1];

        // Calculate time since last submission
        const timeSinceLastSubmission = timestamp - lastSubmission.timestamp;

        // If submission is within the rapid submission threshold (3 minutes),
        // apply penalty multiplier
        if (timeSinceLastSubmission < this.submissionIntervalThreshold) {
            return this.penaltyMultiplier;
        }

        // No penalty for normal submission timing
        return 1.0;
    }

    /**
     * Record a new submission and return calculated penalty
     * @param {number} timestamp - Timestamp of the submission
     * @param {number} promptCount - Number of prompts in this submission
     * @returns {number} - Calculated penalty for this submission
     */
    addSubmissionWithPenalty(timestamp, promptCount) {
        const penalty = this.calculatePenalty(timestamp);

        this.submissions.push({
            timestamp: timestamp,
            promptCount: promptCount,
            penalty: penalty
        });

        // Clean up old submissions after adding new one
        this.cleanOldSubmissions(timestamp);

        return penalty;
    }

    /**
     * Record a new submission
     * @param {number} timestamp - Timestamp of the submission
     * @param {number} promptCount - Number of prompts in this submission
     */
    addSubmission(timestamp, promptCount) {
        return this.addSubmissionWithPenalty(timestamp, promptCount);
    }

    /**
     * Remove submissions that are outside the time window
     * @param {number} currentTime - Current timestamp
     */
    cleanOldSubmissions(currentTime) {
        this.submissions = this.submissions.filter(submission =>
            currentTime - submission.timestamp <= this.timeWindow
        );
    }

    /**
     * Get the number of submissions within the time window
     * @returns {number} - Count of tracked submissions
     */
    getSubmissionCount() {
        return this.submissions.length;
    }

    /**
     * Get total number of prompts submitted within the time window
     * @returns {number} - Total prompt count
     */
    getTotalPromptCount() {
        return this.submissions.reduce((total, submission) =>
            total + submission.promptCount, 0
        );
    }

    /**
     * Get the timestamp and penalty of the most recent submission
     * @returns {{timestamp: number|null, penalty: number|null}} - Last submission info
     */
    getLastSubmissionInfo() {
        if (this.submissions.length === 0) {
            return { timestamp: null, penalty: null };
        }
        const lastSubmission = this.submissions[this.submissions.length - 1];
        return {
            timestamp: lastSubmission.timestamp,
            penalty: lastSubmission.penalty
        };
    }

    /**
     * Check if user has made any submissions within the penalty threshold
     * @param {number} currentTime - Current timestamp
     * @returns {boolean} - True if there are recent submissions within penalty threshold
     */
    hasRecentSubmissions(currentTime) {
        const lastSubmissionTime = this.getLastSubmissionInfo().timestamp;
        if (!lastSubmissionTime) {
            return false;
        }
        return (currentTime - lastSubmissionTime) < this.submissionIntervalThreshold;
    }

    /**
     * Get all current submissions for debugging or monitoring
     * @returns {Array} - Array of submission objects
     */
    getSubmissions() {
        return [...this.submissions];
    }

    /**
     * Reset the tracker by clearing all submissions
     */
    reset() {
        this.submissions = [];
    }
}
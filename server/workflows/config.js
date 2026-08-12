// Workflow Configuration
import { Meteor } from 'meteor/meteor';

export const WorkflowConfig = {
  llm: {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    temperature: 0,
    maxTokens: 8192, // Default max tokens for all workflow steps (GPT-OSS-120B supports up to 8192)
    reasoningEffort: 'medium', // Reasoning effort: low, medium, or high
    timeout: 120000 // 120 seconds
  },

  workflow: {
    stepsToRun: [1, 2, 3, 4, 5, 5.5, 6, 7, 8], // Streamlined workflow with Novel Findings step
    // Steps run sequentially 1-8, with 5.5 (Novel Findings) between 5 and 6.
    // Fact-checked steps: 1, 2, 3, 4, 5.5, 6, 7.
    parallelSteps: [], // Steps that can run in parallel (future optimization)
    saveIntermediateResults: true
  },

  factChecking: {
    enabled: Meteor.settings?.private?.factCheckingEnabled ?? true, // Read from settings.json, default to true
    apiUrl: 'http://host.docker.internal:6000/api/fact-check',
    timeout: 300000, // 300 seconds (5 minutes) - increased for multiple fact-checking calls
    maxClaims: 50, // Max claims to extract from text
    maxReferencesPerClaim: 2, // Max references per claim
    minConfidence: 0.7, // Minimum confidence threshold
    useDirectVerification: true, // Enable direct verification
    useDecomposition: false, // Enable claim decomposition
    minSjr: 1.3, // Minimum SJR (SCImago Journal Rank) for journals
    maxWorkers: 10, // Number of parallel workers for fact-checking
    citationWorkers: 20, // Number of citation workers

    // Steps enabled for fact-checking
    enabledSteps: [1, 2, 3, 4, 5.5, 6, 7], // Summary, GroupThemes, GeneAnalysis, Mechanisms, NovelFindings, Hypotheses, Therapeutic

    // Retry settings for failed fact-checking calls
    maxRetries: 2,
    retryDelay: 5000 // 5 seconds between retries
  },

  pathwayAnalysis: {
    significanceThreshold: 0.05, // FDR threshold for pathway inclusion in overlap calculations
    minSharedGenes: 3 // Minimum shared DE genes required for pathway overlap
  }
};

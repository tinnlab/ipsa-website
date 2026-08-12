// Pure (no Meteor/React/DB) decision helper for whether the consensus step
// should run after an analysis completes.
//
// Kept dependency-free so the gate — the source of the "consensus column shows
// all p=1 / score=0" bug — can be unit-tested directly (see
// tests/consensus-trigger.tests.js).
//
// Background: consensus runs after `analysis.start` resolves, triggered by the
// caller — the wizard (Step5_RunAnalysis) client-side and the mass-analysis
// queue worker (processQueueItem) server-side. The previous inline gate (in the
// now-dead AnalysisResult.startAnalysis) fired on the default/empty
// `methodSettings` (`{}`), counted the `consensus` entry itself toward the
// "more than one method" check, and never verified the user actually enabled
// consensus — so consensus was never computed and the UI fell back to
// p=1 / score=0.
//
// `methodSettings` here is the AnalysisConfig `methodSettings` value map:
//   { ora: {enabled, ...}, ks: {...}, ..., consensus: {enabled, methods: [...]} }
//
// Consensus runs iff ALL hold:
//   - it is not an ORA-only analysis (inputType !== 'ora'),
//   - the user ENABLED consensus (methodSettings.consensus.enabled === true),
//   - MORE THAN ONE non-consensus method is enabled.
export const shouldRunConsensus = (methodSettings = {}, inputType) => {
    if (inputType === 'ora') return false;
    if (!methodSettings || !methodSettings.consensus || !methodSettings.consensus.enabled) {
        return false;
    }
    const enabledMethods = Object.keys(methodSettings)
        .filter(key => key !== 'consensus' && methodSettings[key] && methodSettings[key].enabled);
    return enabledMethods.length > 1;
};

// Same decision, but taking the raw AnalysisConfig `methodSettings` document
// (`{ analysisId, inputType, key:'methodSettings', value:<method map>, ... }`)
// as stored in Mongo. The method map lives under `value`. Used by BOTH consensus
// trigger sites — the wizard (Step5_RunAnalysis) and the mass-analysis queue
// worker (processQueueItem) — so the `.value` extraction is encoded (and tested)
// in exactly one place.
export const shouldRunConsensusForConfigDoc = (methodSettingsConfigDoc, inputType) =>
    shouldRunConsensus(methodSettingsConfigDoc?.value ?? {}, inputType);

export default shouldRunConsensus;

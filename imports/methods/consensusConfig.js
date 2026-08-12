// Pure (no Meteor/R) resolver for the consensus block's algorithm + ranking
// choices, applying the same defaults the server uses. Kept dependency-free so
// the wiring can be unit-tested directly — this is the seam that fixes the bug
// where `consensus_method` was silently ignored and consensus ALWAYS ran RRA.
//
// It is also the single trust boundary that sanitizes these two values before
// they are interpolated into the R script (see analysis.js
// 'consensus.analysis.pathway.compute'): any value outside the whitelist falls
// back to the safe default, so an injection string can never reach R.
//
// Whitelists match the two choices the UI offers (settings.js consensus block).
// The R function (server/include/rCommand/ConsensusAnalysis.js) technically
// accepts more rank.by values ("p.value", "both", "score"), but the feature only
// exposes these two, so we keep the contract narrow on purpose.
//
// NOTE on the method default: the R template's own match.arg default is
// "weightedZMean", but the resolver/UI default is "RRA" — the legacy CPA live
// behavior. method is always passed explicitly, so the difference is inert.
export const VALID_CONSENSUS_METHODS = ["RRA", "weightedZMean"];
export const VALID_CONSENSUS_RANK_BY = ["pFDR", "normalizedScore"];

// consensusBlock is `config.methods.consensus` as stored from the UI settings.
// Unknown/missing values fall back to the previous live behavior (RRA / pFDR).
export const resolveConsensusOptions = (consensusBlock = {}) => {
    const rawMethod = consensusBlock?.consensus_method;
    const rawRankBy = consensusBlock?.rankBy;
    return {
        method: VALID_CONSENSUS_METHODS.includes(rawMethod) ? rawMethod : "RRA",
        rankBy: VALID_CONSENSUS_RANK_BY.includes(rawRankBy) ? rawRankBy : "pFDR",
    };
};

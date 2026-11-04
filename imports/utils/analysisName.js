// The name an analysis is created with.
//
// `session.create` used to hardcode `name: 'Analysis'` for the analysis it embeds in a new study,
// so a study called "Demo - Expression Data Analysis" contained an analysis called "Analysis".
// The method now takes an optional `analysisName` and resolves it here.
//
// COERCE, NEVER THROW — deliberately unlike validateStudyName/validateInsightName, which return
// {ok, value|error}. Those back a rename control with a form to report an error in. This one backs
// an optional argument on a creation method: an absent or unusable name is not a failure, it means
// "use the default", and there is no UI to report anything to. It follows the shape `inputType`
// already has in the same method — whitelist, fall back, never reject — so adding the argument
// cannot change the behaviour of a caller that does not pass it.

export const DEFAULT_ANALYSIS_NAME = 'Analysis';

// Matches MAX_STUDY_NAME_LENGTH; an analysis name is displayed in the same places a study name is.
export const MAX_ANALYSIS_NAME_LENGTH = 200;

/**
 * Resolve the name to store on a newly created analysis.
 *
 * Over-long names are TRUNCATED rather than rejected, for the same reason the function does not
 * throw: the caller has no way to recover, and a truncated demo name is better than no study.
 *
 * @param {*} name - the proposed analysis name; anything at all.
 * @param {{fallback?: string}} [options]
 * @returns {string} a non-empty, trimmed name no longer than MAX_ANALYSIS_NAME_LENGTH.
 */
export function resolveAnalysisName(name, { fallback = DEFAULT_ANALYSIS_NAME } = {}) {
    if (typeof name !== 'string') return fallback;
    const trimmed = name.trim();
    if (trimmed.length === 0) return fallback;
    // Length is measured AFTER trimming, so trailing whitespace cannot push a legal name over.
    return trimmed.length > MAX_ANALYSIS_NAME_LENGTH
        ? trimmed.slice(0, MAX_ANALYSIS_NAME_LENGTH)
        : trimmed;
}

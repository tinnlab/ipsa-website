const rStringify = (o) => JSON.stringify(o).replace(/\\/g, "\\\\")

// Resolve a stochastic method's RNG seed for interpolation into generated R.
// Falls back to 1 when the config predates the randomSeed parameter (older
// AnalysisConfig snapshots), so the template can never render `seed = undefined`
// (invalid R that would crash the run). Uses ?? (not ||) so a valid seed of 0
// is preserved.
const resolveMethodSeed = (methodConfig) => methodConfig?.randomSeed ?? 1

export {rStringify, resolveMethodSeed}

export default {
    rStringify,
    resolveMethodSeed
}

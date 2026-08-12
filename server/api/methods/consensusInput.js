// Pure (no Meteor/R) helper that maps one enrichment method's per-pathway
// results into the column arrays fed to the consensus R script (RCPA RRA).
//
// Kept dependency-free so the field mapping — the source of the "consensus
// always returns FDR=1 / score=0" bug — can be unit-tested directly.
//
// Key correctness points this encodes (see Bug 2A):
//  - `pValue` carries the RAW per-method p-value,
//  - `pFDR`   carries the GENUINE per-method FDR (RRA ranks by this),
//    they are NOT the same field, and the FDR is no longer discarded.
//  - `score` preserves a legitimate 0 vs an absent value via `?? 0`.
//  - `pValue`/`pFDR` default any NON-FINITE value (undefined, null, NaN) to 1
//    (the "not significant / absent pathway" convention used across the method
//    runners), so a missing/garbage FDR can never reach R as NA/NaN and produce
//    a NaN weightedZMean consensus. A legitimate finite 0 is preserved.
const finiteOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);
export const buildConsensusMethodColumns = (pathways = []) => ({
    id: pathways.map(p => p.pathway),
    pValue: pathways.map(p => finiteOr(p.pValue, 1)),
    pFDR: pathways.map(p => finiteOr(p.pValueFDR, 1)),
    score: pathways.map(p => p.score ?? 0),
    name: pathways.map(p => p.name),
});

// Pure, dependency-free helper for AnalysisUtils.updateAnalysis's debounced
// accumulator. Lives under imports/utils so it is architecture-neutral and
// unit-testable (server-side Mocha runner included).

/**
 * Merge a newly-requested analysis update into the pending (debounced) entry.
 *
 * The pending entry is shaped `{ inputType, data: {...fields} }`. When several
 * updateAnalysis() calls land in the same debounce window we must accumulate
 * their FIELDS — i.e. spread the previous entry's inner `.data`, NOT the whole
 * wrapper. Spreading the wrapper (the old bug) nested the prior fields under a
 * `data` key and leaked an `inputType` key, so e.g. a prior `{expressionFile}`
 * followed by `{groupFile}` produced `{inputType, data:{expressionFile}, groupFile}`
 * and the top-level `expressionFile` was lost.
 *
 * @param {{data?: Object}|undefined} prevEntry - the existing pending entry (or undefined)
 * @param {Object} newData - the new fields to merge in
 * @returns {Object} the merged flat field object
 */
export const mergePendingUpdateData = (prevEntry, newData) => ({
    ...(prevEntry?.data || {}),
    ...newData,
});

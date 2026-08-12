// Pure, dependency-free helper for parsing the expression "group" file.
// Lives under imports/utils so it is architecture-neutral and unit-testable
// (server-side Mocha runner included).

import _ from 'lodash';

/**
 * Parse the rows of a group/metadata CSV into the `groupData` config shape used
 * by the Step 2 sample-selection UI. Each row is `[sampleName, annotation, ...]`.
 * Rows with an empty first column are skipped (trailing blank lines). The result
 * is `{ data: { sample: annotation }, annotations: [unique annotation values],
 * warnings: { duplicateSamples, conflictingLabels } }`.
 *
 * Extracted from server/api/methods/analysis.js (analysis.update, expression/groupFile
 * branch) so the gating logic for the group table + Preview DE button is testable.
 *
 * `data` is keyed by sample name, so a sample listed more than once collapses to a
 * single entry (last occurrence wins). That silent collapse is what makes a
 * name-collided group file (e.g. an expression matrix de-duplicated with `_1`
 * suffixes whose group file never got the suffix) drop samples and even relabel
 * them. We keep `data`/`annotations` byte-for-byte backward compatible and surface
 * what was collapsed via the additive `warnings` field so callers can alert the user:
 *   - duplicateSamples:  sample names that appeared in more than one row
 *   - conflictingLabels: duplicated samples whose rows disagreed on the annotation,
 *                        with the distinct labels seen and which one `kept` (last wins)
 */
export const parseGroupData = (rows) => {
    // sample name -> ordered list of labels seen across rows (for dup/conflict detection)
    const seen = new Map();

    const data = (rows ?? []).reduce((acc, row) => {
        if (row && row[0] !== '' && row[0] != null) {
            acc[row[0]] = row[1];
            if (!seen.has(row[0])) seen.set(row[0], []);
            seen.get(row[0]).push(row[1]);
        }
        return acc;
    }, {});

    const duplicateSamples = [];
    const conflictingLabels = [];
    seen.forEach((labels, sample) => {
        if (labels.length > 1) {
            duplicateSamples.push(sample);
            const distinct = _.uniq(labels);
            if (distinct.length > 1) {
                conflictingLabels.push({ sample, labels: distinct, kept: data[sample] });
            }
        }
    });

    return {
        data,
        annotations: _.uniq(Object.values(data).flat()),
        warnings: { duplicateSamples, conflictingLabels },
    };
};

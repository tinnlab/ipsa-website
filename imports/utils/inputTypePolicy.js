// Input-type policy shared by the client and the server: which analyses may start a Biological
// Interpretation, and whether a ranked-gene-list (pgsea) upload must carry statistics.
//
// Both switches live in `Meteor.settings.private` (config/settings.json), which is baked into the
// production image, so changing one needs an image rebuild, not just a container restart:
//
//   interpretationBlockedInputTypes  (default ["ora"])
//       Input types whose analyses cannot start an interpretation. A plain gene list has no
//       gene-level statistics, so the hypothesis step has nothing to ground its claims in and
//       returns zero hypotheses. Set to [] to re-enable once that step supports pathway-only runs.
//
//   pgseaRequireStatsColumns  (default true)
//       A NEW pgsea upload must have Gene / log2 Fold-Change / P-value columns. Set to false to
//       accept a single ranking metric again. Stored analyses are never re-validated either way.
//
// The client cannot read Meteor.settings.private, so it learns these through the
// `inputTypePolicy.get` method. A missing key falls back to the defaults below, so a deployment
// that predates the flags behaves like the shipped default.

export const DEFAULT_INTERPRETATION_BLOCKED_INPUT_TYPES = ['ora'];
export const DEFAULT_PGSEA_REQUIRE_STATS_COLUMNS = true;

// Input types that never carry gene-level statistics, by construction. The "no gene-level
// results" refusal does not apply to them: whether they may be interpreted at all is decided by
// interpretationBlockedInputTypes alone, so emptying that list really does re-enable them for a
// pathway-only run. Otherwise the second check would keep ora refused and the flag would revert
// nothing.
export const PATHWAY_ONLY_INPUT_TYPES = ['ora'];
const isPathwayOnly = (inputType) => PATHWAY_ONLY_INPUT_TYPES.includes(inputType);

export const INTERPRETATION_BLOCKED_REASON =
    'This input type has no gene-level statistics, so hypothesis generation cannot be grounded.';

// Deliberately does NOT blame the input type: an analysis that simply has not been run yet has no
// gene-level results either.
export const INTERPRETATION_NO_GENE_RESULTS_REASON =
    'This analysis has no gene-level differential-expression results yet, so hypotheses cannot be ' +
    'grounded. Run the analysis (with fold-change and p-value data) first.';

// The same two reasons for a meta-analysis, which is refused only when NO dataset can ground it.
export const META_INTERPRETATION_BLOCKED_REASON =
    'Every dataset in this meta-analysis is of an input type with no gene-level statistics, so ' +
    'hypothesis generation cannot be grounded.';
export const META_INTERPRETATION_NO_GENE_RESULTS_REASON =
    'No dataset in this meta-analysis has gene-level differential-expression results, so hypotheses ' +
    'cannot be grounded. Run the datasets (with fold-change and p-value data) first.';

/**
 * Resolve the policy from a settings object (Meteor.settings.private on the server).
 * @param {object} [privateSettings]
 * @returns {{interpretationBlockedInputTypes: string[], pgseaRequireStatsColumns: boolean}}
 */
export const resolveInputTypePolicy = (privateSettings = {}) => {
    const blocked = privateSettings?.interpretationBlockedInputTypes;
    const requireStats = privateSettings?.pgseaRequireStatsColumns;
    return {
        interpretationBlockedInputTypes: Array.isArray(blocked)
            ? blocked.filter((t) => typeof t === 'string')
            : DEFAULT_INTERPRETATION_BLOCKED_INPUT_TYPES,
        pgseaRequireStatsColumns: typeof requireStats === 'boolean'
            ? requireStats
            : DEFAULT_PGSEA_REQUIRE_STATS_COLUMNS,
    };
};

/** True when an analysis of this input type may not start an interpretation. */
export const isInputTypeBlocked = (inputType, blocked = DEFAULT_INTERPRETATION_BLOCKED_INPUT_TYPES) =>
    Boolean(inputType) && (blocked || []).includes(inputType);

/**
 * Why ONE analysis cannot be interpreted, or null when it can. Two independent reasons, in order:
 *   1. its input type is blocked (no gene-level statistics by construction);
 *   2. it has no gene-level DE results — `hasGeneResults`, i.e. a non-empty volcanoPlotData
 *      snapshot (server/api/methods/visualizationCore.js). Catches a stored single-metric pgsea
 *      analysis, a mass expression analysis (no DE step yet), or one that simply has not run.
 *      Not applied to PATHWAY_ONLY_INPUT_TYPES (see there).
 *
 * @param {{inputType?: string, hasGeneResults?: boolean}} analysis
 * @param {string[]} [blocked]
 * @returns {string|null}
 */
export const interpretationUnavailableReason = ({inputType, hasGeneResults} = {}, blocked = DEFAULT_INTERPRETATION_BLOCKED_INPUT_TYPES) => {
    if (isInputTypeBlocked(inputType, blocked)) return INTERPRETATION_BLOCKED_REASON;
    if (!hasGeneResults && !isPathwayOnly(inputType)) return INTERPRETATION_NO_GENE_RESULTS_REASON;
    return null;
};

/**
 * The server-side verdict for one interpretation request (aiWorkflow.startPublicationReady).
 *
 * Single analysis: refused for either reason of {@link interpretationUnavailableReason}.
 * Meta-analysis: refused only when EVERY dataset is of a blocked type, or when NO dataset has
 * gene-level results (unless every dataset is pathway-only and unblocked, i.e. the flag was
 * reverted). A MIXED meta is allowed through, and its blocked or gene-less datasets
 * still reach the payload without genes — a known, documented gap.
 *
 * @param {Array<{inputType?: string, hasGeneResults?: boolean}>} datasets
 * @param {{isMeta: boolean, blocked?: string[]}} opts
 * @returns {{code: string, reason: string}|null}
 */
export const interpretationRefusal = (datasets, {isMeta, blocked = DEFAULT_INTERPRETATION_BLOCKED_INPUT_TYPES}) => {
    const list = datasets || [];
    if (list.length === 0) return null;
    if (isMeta) {
        if (isInterpretationBlocked(list.map((d) => d.inputType), blocked)) {
            return {code: 'interpretation-unavailable-input-type', reason: META_INTERPRETATION_BLOCKED_REASON};
        }
        const expectGenes = list.some((d) => !isPathwayOnly(d.inputType));
        if (expectGenes && !list.some((d) => d.hasGeneResults)) {
            return {code: 'interpretation-unavailable-no-gene-results', reason: META_INTERPRETATION_NO_GENE_RESULTS_REASON};
        }
        return null;
    }
    for (const d of list) {
        const reason = interpretationUnavailableReason(d, blocked);
        if (reason === INTERPRETATION_BLOCKED_REASON) return {code: 'interpretation-unavailable-input-type', reason};
        if (reason) return {code: 'interpretation-unavailable-no-gene-results', reason};
    }
    return null;
};

/**
 * True when an interpretation over these datasets' input types must be refused: a single analysis
 * of a blocked type, or a meta-analysis whose every dataset is of a blocked type. A MIXED meta
 * (some datasets blocked, some not) is allowed; its blocked datasets still reach the payload
 * gene-less.
 *
 * @param {Array<string|null|undefined>} inputTypes - one entry per dataset
 * @param {string[]} [blocked]
 */
export const isInterpretationBlocked = (inputTypes, blocked = DEFAULT_INTERPRETATION_BLOCKED_INPUT_TYPES) => {
    const known = (inputTypes || []).filter(Boolean);
    return known.length > 0 && known.every((t) => isInputTypeBlocked(t, blocked));
};

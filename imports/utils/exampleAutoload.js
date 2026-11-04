// Should Step 2 load its example data by itself?
//
// The homepage's three demo boxes navigate to a new analysis with `?example=<input type>` and expect
// that type's example data to be waiting. The decision is extracted here, away from the component,
// because every way this can go wrong is a way it silently overwrites somebody's data — and a pure
// predicate is the only part of that which a unit test can reach. Same habit as plotDisplayState.js,
// vizNav.js and shareLink.js.
//
// The caller supplies three things it alone can see:
//   shouldLoadExample - the wizard's latch AND the type match AND the study being writable. The
//                       latch lives in AnalysisWizard, not here and not in Step 2, because Step 2
//                       unmounts every time the user walks to another step.
//   isLoading/data    - the one-shot `analysis.getData` fetch. `data` is the only readiness-carrying
//                       view of the stored input: the minimongo trackers cannot distinguish "no
//                       input" from "the subscription has not arrived yet", and acting on that
//                       ambiguity is what would paste the demo over a real analysis.

const TEXT_INPUT_TYPES = ['ora', 'pgsea'];

/**
 * @param {object} args
 * @param {boolean} args.shouldLoadExample - the caller's latch + type match + writability.
 * @param {string} args.inputType - 'ora' | 'pgsea' | 'expression'.
 * @param {boolean} args.isLoading - the analysis.getData fetch is still in flight.
 * @param {object} args.data - what analysis.getData returned.
 * @returns {boolean}
 */
export function shouldAutoloadExample({ shouldLoadExample, inputType, isLoading, data } = {}) {
    if (shouldLoadExample !== true) return false;
    // Never decide before the fetch has answered: `data` is null until then, which looks exactly
    // like an empty analysis.
    if (isLoading) return false;
    if (!data || typeof data !== 'object') return false;

    if (TEXT_INPUT_TYPES.includes(inputType)) {
        // Whitespace-only counts as empty: the textarea writes through on every keystroke, so a
        // user mid-edit can legitimately be sitting on "   ".
        return typeof data.input !== 'string' || data.input.trim().length === 0;
    }

    if (inputType === 'expression') {
        // Only the expression file is consulted. handleUseSampleData records expressionFile and
        // groupFile in ONE analysis.update, so they cannot be half-written; checking both would
        // just be two names for the same fact.
        return typeof data.expressionFile !== 'string' || data.expressionFile.trim().length === 0;
    }

    // An input type this function does not know about is not one it can load an example for.
    return false;
}

/**
 * Validate and normalize an AI-interpretation report (insight) title.
 *
 * Pure function (no Meteor / DB) so the rename method can stay thin and this can
 * be unit-tested directly.
 *
 * @param {*} name - the proposed insight name.
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export const MAX_INSIGHT_NAME_LENGTH = 200;

export function validateInsightName(name) {
    if (typeof name !== 'string') {
        return { ok: false, error: 'Report name must be text.' };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return { ok: false, error: 'Report name cannot be empty.' };
    }
    if (trimmed.length > MAX_INSIGHT_NAME_LENGTH) {
        return { ok: false, error: `Report name must be ${MAX_INSIGHT_NAME_LENGTH} characters or fewer.` };
    }
    return { ok: true, value: trimmed };
}

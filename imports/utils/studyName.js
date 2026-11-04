import { isSessionExpired } from './retention';

export const MAX_STUDY_NAME_LENGTH = 200;

/**
 * Validate and normalize a study (Session) name.
 *
 * Pure function (no Meteor / DB) so the rename method can stay thin and this can
 * be unit-tested directly — same shape as validateInsightName in ./insightName.js.
 *
 * @param {*} name - the proposed study name.
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateStudyName(name) {
    if (typeof name !== 'string') {
        return { ok: false, error: 'Study name must be text.' };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return { ok: false, error: 'Study name cannot be empty.' };
    }
    if (trimmed.length > MAX_STUDY_NAME_LENGTH) {
        return { ok: false, error: `Study name must be ${MAX_STUDY_NAME_LENGTH} characters or fewer.` };
    }
    return { ok: true, value: trimmed };
}

/**
 * Should the study page offer its rename control?
 *
 * Renaming is a write, so it is offered only where a write can succeed: never on a view-only
 * import (the server rejects it) and never on an expired study (the Recent Studies list already
 * withholds Edit/Share on the same signal). Extracted as a pure predicate — the repo's habit for
 * display rules (see plotDisplayState, shareLink, vizNav) — so the rule is testable on its own.
 *
 * A DISPLAY rule, not enforcement. The server's authority is assertWritableSession, which covers
 * ownership and readOnly; like every sibling session mutation it does not consult expiredAt, so
 * the expiry half of this predicate exists only to stop offering a control that has no purpose.
 *
 * @param {object} session - the Session document.
 * @param {number} nowMs - the instant to judge expiry against.
 * @returns {boolean}
 */
export function canRenameStudy(session, nowMs) {
    if (!session) return false;
    if (session.readOnly === true) return false;
    return !isSessionExpired({ expiredAt: session.expiredAt, nowMs });
}

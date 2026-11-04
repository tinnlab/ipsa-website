import { Meteor } from "meteor/meteor";
import { assertWritableSession, SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE } from "./ownership";
import { validateStudyName } from "/imports/utils/studyName";

// Rename a study. Extracted from the Meteor method with an injectable `collections`, following
// removeStudy / extendStudy in server/startup/cron-job.js, so the guard + validation + write can be
// unit-tested with fakes instead of only through a live method invocation.
//
// assertWritableSession, not assertOwnsSession: renaming is a write, so a study imported as
// view-only must reject it even though the recipient owns the row — the same rule the sibling
// session mutations (addAnalysis / updateAnalysis / updateGlobalSettings) already apply.
//
// Deliberately narrow: it sets `name` and nothing else, so it can never become a general-purpose
// Session updater reachable from a client.
export const renameStudy = async ({
    sessionId,
    requesterUserId,
    name,
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
} = {}) => {
    const C = collections;
    if (!C) throw new Meteor.Error("collections-unavailable", "Database collections are unavailable.");

    // Authorize before looking at the name, as queue.updateBatchName does: a caller who may not
    // touch this study is told that, rather than handed a verdict on their input. The method
    // deliberately does NOT check() the name first, so this ordering holds end to end.
    await assertWritableSession({ sessionId, requesterUserId, collections: C });

    const validation = validateStudyName(name);
    if (!validation.ok) {
        throw new Meteor.Error("invalid-name", validation.error);
    }

    // The guard read the study a moment ago; if it has since been deleted (the expiry sweep runs
    // on a timer) the update matches nothing, and reporting success would leave the UI showing a
    // rename that never happened.
    const updated = await C.Session.updateAsync({ _id: sessionId }, { $set: { name: validation.value } });
    if (!updated) {
        throw new Meteor.Error(SESSION_NOT_FOUND, STUDY_NOT_FOUND_MESSAGE);
    }
    return validation.value;
};

export default renameStudy;

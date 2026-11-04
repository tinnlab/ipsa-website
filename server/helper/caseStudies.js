import { Meteor } from "meteor/meteor";
import { isValidId, collectAnalysisIds } from "/imports/utils/ownership";
import { resolveShareSelection } from "/imports/utils/shareSelection";
import { isReadOnlySession } from "/server/helper/ownership";

// The public case studies: studies the deployment offers to every visitor from the homepage, as
// permanent `full`-mode share links.
//
// WHY THE MAPPING LIVES IN SETTINGS. The session ids are DEPLOYMENT DATA — they exist only on the
// instance that holds those studies — so hardcoding them would ship a dead pointer to every other
// deployment (which is exactly what the old homepage "View Example" link did). Settings keep the
// code deployment-agnostic: an instance with no `caseStudies` block simply has no case studies, and
// the homepage hides the control rather than offering a link that goes nowhere.
//
// WHAT THIS IS NOT. A StudyShare stores REFERENCES ONLY (see server/api/methods/share.js) — the
// clone reads through sourceSessionId + analysisIds at import time. A case-study share is therefore
// NOT a snapshot; it behaves like one only because the case studies do not change. Edit or delete
// analyses in a case study and every future import changes with it. That is why the seed re-derives
// its selection on every boot instead of freezing it once.
//
// Shape, under Meteor.settings.private:
//   "caseStudies": [{"shareId": "<17-char id>", "sessionId": "<session id>", "label": "..."}]

const LOG = "[case-study]";

// Validated read of the settings block. Returns [] for anything unusable rather than throwing: a
// malformed settings entry must not stop the server from booting, and the homepage degrades to
// showing no control at all.
//
// `warn` is off by default because share.caseStudies calls this on EVERY homepage visit — warning
// there would emit a line per bad entry per visitor. The boot-time seeder passes warn: true, so a
// malformed block is reported once, loudly, where an operator will actually see it.
export const caseStudyEntries = (raw = Meteor.settings?.private?.caseStudies, {warn = false} = {}) => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const entries = [];
    for (const entry of raw) {
        if (!entry || !isValidId(entry.shareId) || !isValidId(entry.sessionId)) {
            if (warn) console.warn(`${LOG} ignoring malformed caseStudies entry:`, JSON.stringify(entry));
            continue;
        }
        // A duplicated shareId would have the two entries fight over one row on every boot, each
        // overwriting the other's sourceSessionId — the link would point at whichever won last.
        if (seen.has(entry.shareId)) {
            if (warn) console.warn(`${LOG} ignoring duplicate shareId ${entry.shareId}`);
            continue;
        }
        seen.add(entry.shareId);
        entries.push({
            shareId: entry.shareId,
            sessionId: entry.sessionId,
            label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null,
        });
    }
    return entries;
};

// Make one study permanent: flag it AND clear its expiry.
//
// Either alone is insufficient. Clearing expiredAt on its own is SILENT state — nothing in the doc
// records that it was deliberate, and backfillLegacyExpiry (which runs on every boot over every
// session) would read the missing field as a legacy short expiry and re-stamp it. The flag alone
// would leave a real expiredAt in place, so every guard would have to remember to check it. Both,
// written together, mean the sweep, the backfill and Extend all agree.
//
// Only writes when the doc is not already in that shape, so a restart is a genuine no-op.
const ensurePermanent = async (Sessions, session) => {
    const alreadyFlagged = session.permanent === true;
    const alreadyClear = session.expiredAt === undefined || session.expiredAt === null;
    if (alreadyFlagged && alreadyClear) return false;
    await Sessions.updateAsync(
        { _id: session._id },
        { $set: { permanent: true }, $unset: { expiredAt: "" } }
    );
    return true;
};

// Order-sensitive id comparison. resolveShareSelection emits ids in the study's own array order, so
// the sequence is deterministic for an unchanged study — a differing order therefore means the
// study's analyses array actually changed, which is worth reporting as a refresh.
const sameIds = (a, b) =>
    Array.isArray(a) && a.length === b.length && a.every((id, i) => id === b[i]);

// Did the upsert below actually change anything? Purely so the boot log can distinguish "refreshed"
// from "already up to date". The write itself is unconditional either way — comparing after the
// fact is cheaper and far less fragile than trying to build a conditional update.
const shareNeedsUpdate = (existing, session, allIds) =>
    existing.ownerUserId !== session.userId
    || existing.sourceSessionId !== session._id
    || existing.mode !== "full"
    || existing.neverExpires !== true
    || existing.revokedAt != null
    || existing.expiresAt != null
    || !sameIds(existing.analysisIds, allIds);

/**
 * Seed the configured case studies. Idempotent and safe to run on every container start.
 *
 * Per entry it marks the source study permanent and upserts a StudyShare under the GIVEN _id with
 * mode 'full' and neverExpires. Any entry it cannot satisfy is logged and SKIPPED — a half-formed
 * share row would present to visitors as a link that exists but does not work, which is strictly
 * worse than no link at all.
 *
 * Deps are injectable for testing, following removeStudy / extendStudy / cloneStudy.
 */
export const seedCaseStudies = async ({
    entries = caseStudyEntries(undefined, {warn: true}),
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
    now = new Date(),
} = {}) => {
    const result = { seeded: 0, updated: 0, unchanged: 0, skipped: 0 };
    if (!entries.length) return result;
    if (!collections || !collections.Session || !collections.StudyShare) {
        console.error(`${LOG} collections unavailable; skipping case-study seed`);
        result.skipped = entries.length;
        return result;
    }
    const { Session: Sessions, StudyShare } = collections;

    for (const entry of entries) {
        const { shareId, sessionId, label } = entry;
        try {
            const session = await Sessions.findOneAsync({ _id: sessionId });

            // A share pointing at nothing is a link that resolves and then fails. share.import and
            // share.preview both refuse when the source session is gone, so writing the row anyway
            // would only manufacture a broken link.
            if (!session) {
                console.warn(`${LOG} session ${sessionId} not found; skipping share ${shareId}`);
                result.skipped += 1;
                continue;
            }

            // 'full' on a read-only source is a combination share.create explicitly rejects (a
            // results-only import has no uploaded inputs, so a full onward share promises what it
            // cannot deliver). This seeder bypasses share.create, so it has to refuse the same
            // combination itself rather than create a state the rest of the app believes impossible.
            if (isReadOnlySession(session)) {
                console.warn(
                    `${LOG} session ${sessionId} is view-only, which cannot be shared as 'full'; skipping share ${shareId}`
                );
                result.skipped += 1;
                continue;
            }

            // resolveShareSelection, not a hand-rolled id list: it is the owner-facing rule that
            // brings a meta-analysis along with every analysis it was computed from (PR #174).
            // Rolling our own here would silently drop the meta-analyses from the case studies.
            const { allIds } = resolveShareSelection(session, collectAnalysisIds(session));
            if (allIds.length === 0) {
                console.warn(`${LOG} session ${sessionId} has no shareable analyses; skipping share ${shareId}`);
                result.skipped += 1;
                continue;
            }

            const madePermanent = await ensurePermanent(Sessions, session);
            const existing = await StudyShare.findOneAsync({ _id: shareId });

            await StudyShare.upsertAsync(
                { _id: shareId },
                {
                    // Everything derived from the study is re-asserted on EVERY boot so the seed
                    // SELF-HEALS. ownerUserId especially: share.import refuses when
                    // sourceSession.userId !== share.ownerUserId, so a workspace recovery on a case
                    // study would otherwise kill its link silently until someone noticed. Re-deriving
                    // analysisIds likewise keeps a newly added analysis in the example.
                    //
                    // expiresAt is pinned to null so a permanent share never carries a stale bounded
                    // date from an earlier life; neverExpires is what shareStatus actually reads.
                    //
                    // NOTE revokedAt: null is re-asserted too, so REVOKING A CASE-STUDY SHARE ONLY
                    // HOLDS UNTIL THE NEXT RESTART. To retire a case study, remove it from settings.
                    $set: {
                        ownerUserId: session.userId,
                        sourceSessionId: session._id,
                        mode: "full",
                        analysisIds: allIds,
                        neverExpires: true,
                        expiresAt: null,
                        revokedAt: null,
                        caseStudyLabel: label || session.name || shareId,
                    },
                    // History, not derived state: a restart must not rewrite when the link was
                    // created nor reset how many times it has been imported.
                    $setOnInsert: { createdAt: now, importCount: 0 },
                }
            );

            if (!existing) {
                result.seeded += 1;
                console.log(`${LOG} created share ${shareId} for study ${sessionId} (${allIds.length} analyses)`);
            } else if (madePermanent || shareNeedsUpdate(existing, session, allIds)) {
                result.updated += 1;
                console.log(`${LOG} refreshed share ${shareId} for study ${sessionId} (${allIds.length} analyses)`);
            } else {
                result.unchanged += 1;
                console.log(`${LOG} share ${shareId} already up to date for study ${sessionId}`);
            }
        } catch (error) {
            result.skipped += 1;
            console.error(`${LOG} failed to seed share ${shareId} for study ${sessionId}:`, error);
        }
    }

    return result;
};

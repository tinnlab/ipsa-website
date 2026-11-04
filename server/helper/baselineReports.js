import { Meteor } from "meteor/meteor";
import { isValidId, collectAnalysisIds } from "/imports/utils/ownership";
import { analysisNameInStudy } from "/imports/utils/aiInterpretationSelection";
import { caseStudyEntries } from "/server/helper/caseStudies";

// The baseline reports: reports written OUTSIDE the app, shipped as markdown in private/ and seeded
// onto a case study so they sit beside the reports IPSA generated for it.
//
// WHY A SEEDER AND NOT A DATABASE EDIT. Same reason as caseStudies.js: the rows are deployment data,
// and the only way to keep "what the deployment holds" reviewable is to derive it from the source
// tree on boot. Nobody writes these by hand.
//
// WHY THIS REACHES VISITORS AT ALL. A report is a BatchInfo row plus its PromptQueue rows, and
// cloneStudy.js:273-295 copies both when someone imports a study — rewriting _id, userId, sessionId
// and analysisId onto the recipient. So seeding on the SOURCE study is enough, PROVIDED the batch's
// analysisId is inside the share's selection (analysisIdIsCloneable, cloneStudy.js:152). The
// case-study share is 'full' with its ids re-derived from the study, so any analysis of that study
// qualifies — which is exactly what the membership check below enforces.
//
// TWO CONSEQUENCES, neither fixable here: the fixed ids exist only on the SOURCE rows (every clone
// gets a fresh Random.id()), and a visitor who imported the case study BEFORE these shipped does not
// get them retroactively — only new imports do.
//
// Shape, under Meteor.settings.private:
//   "baselineReports": [{
//     "reportId":   "baseline-report-1",       // the BatchInfo._id, verbatim
//     "shareId":    "<a private.caseStudies shareId>",
//     "analysisId": "<an analysis of that case study>",
//     "title":      "Baseline Report 1",       // what the reports list shows
//     "file":       "baseline-reports/baseline-report-1.md",   // under private/
//     "createdAt":  "2026-08-01T14:04:33.000Z"
//   }]

const LOG = "[baseline-report]";

// The prompt row carries the text; the batch row is the report. One prompt per report, so the
// viewer shows a single panel rather than the six-template accordion a generated report uses.
const TEMPLATE_ID = "baseline-report";
const PROMPT_TEXT = "Baseline report supplied by the project owner; not generated in-app.";

const promptIdFor = (reportId) => `${reportId}-prompt`;

// A settings-supplied asset path must not climb out of private/. Assets.getTextAsync would happily
// follow "../", and caseStudies.js validates every field it reads, so this one does too.
const isSafeAssetPath = (value) =>
    isValidId(value)
    && !value.startsWith("/")
    && !value.split("/").includes("..");

// Validated read of the settings block. Returns [] for anything unusable rather than throwing: a
// malformed entry must not stop the server from booting, exactly as for the case studies.
export const baselineReportEntries = (
    raw = Meteor.settings?.private?.baselineReports,
    { warn = false } = {}
) => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const entries = [];
    for (const entry of raw) {
        const bad = (why) => {
            if (warn) console.warn(`${LOG} ignoring ${why} baselineReports entry:`, JSON.stringify(entry));
        };
        if (!entry || !isValidId(entry.reportId) || !isValidId(entry.shareId) || !isValidId(entry.analysisId)) {
            bad("malformed");
            continue;
        }
        const title = typeof entry.title === "string" ? entry.title.trim() : "";
        if (!title) {
            bad("untitled");
            continue;
        }
        if (!isSafeAssetPath(entry.file)) {
            bad("unsafe-file");
            continue;
        }
        // Stored as a string in settings so the three literals are visible and adjustable there;
        // parsed once here so a typo is caught at boot rather than written as an Invalid Date.
        const createdAt = new Date(entry.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
            bad("undated");
            continue;
        }
        // Two entries on one reportId would fight over the same row on every boot.
        if (seen.has(entry.reportId)) {
            if (warn) console.warn(`${LOG} ignoring duplicate reportId ${entry.reportId}`);
            continue;
        }
        seen.add(entry.reportId);
        entries.push({
            reportId: entry.reportId,
            shareId: entry.shareId,
            analysisId: entry.analysisId,
            title,
            file: entry.file,
            createdAt,
        });
    }
    return entries;
};

// The three fields that say WHERE a report lives. They are the only thing re-asserted once a row
// exists — see the comment on seedBaselineReports.
const pointerFields = (session, analysisId) => ({
    userId: session.userId,
    sessionId: session._id,
    analysisId,
});

const pointerDrifted = (row, pointer) =>
    row.userId !== pointer.userId
    || row.sessionId !== pointer.sessionId
    || row.analysisId !== pointer.analysisId;

/**
 * Seed the configured baseline reports. Idempotent and safe to run on every container start.
 *
 * ALREADY SEEDED MEANS SKIP. Once the BatchInfo row exists, its title, body and createdAt are left
 * alone — a correction to the markdown ships under a NEW reportId, not by overwriting. That is the
 * owner's instruction, and it is what makes a RENAME in the UI stick. A DELETE does NOT stick:
 * queue.removeBatch drops the BatchInfo row outright, so the findOneAsync below sees nothing on
 * the next boot and the report is re-created under its fixed _id. Retiring a baseline report
 * means removing its settings entry AND deleting the row -- this seeder never deletes.
 *
 * THE ONE EXCEPTION is where the row POINTS. userId, sessionId and analysisId are re-derived from
 * the study on every boot, because a stale pointer does not degrade gracefully: every read in
 * queue.js filters on userId (getBatchStatus:35, getBatchInfo:340, getUserBatches:67), so a
 * workspace recovery that changes Session.userId would make these reports invisible to their owner
 * and clone them under an id nobody holds. Re-pointing sessionId/analysisId covers the same hazard
 * when a case study is moved to a different study. Content is written once; location self-heals.
 *
 * Any entry it cannot satisfy is logged and SKIPPED rather than half-written.
 *
 * Deps are injectable for testing, following caseStudies.js / cloneStudy.js.
 */
export const seedBaselineReports = async ({
    entries = baselineReportEntries(undefined, { warn: true }),
    caseStudies = caseStudyEntries(undefined, { warn: false }),
    collections = (typeof DBCollections !== "undefined" ? DBCollections : undefined),
    readAsset = (file) => Assets.getTextAsync(file),
} = {}) => {
    const result = { seeded: 0, repointed: 0, unchanged: 0, skipped: 0 };
    if (!entries.length) return result;
    if (!collections || !collections.Session || !collections.BatchInfo || !collections.PromptQueue) {
        console.error(`${LOG} collections unavailable; skipping baseline-report seed`);
        result.skipped = entries.length;
        return result;
    }
    const { Session: Sessions, BatchInfo, PromptQueue } = collections;

    for (const entry of entries) {
        const { reportId, shareId, analysisId, title, file, createdAt } = entry;
        try {
            // The study comes from the caseStudies block rather than being repeated here, so
            // repointing a case study carries its baseline reports with it instead of stranding
            // them. Read from SETTINGS, not from the StudyShare row: this file sorts before
            // seed-case-studies.js, so on a first boot that row does not exist yet.
            const caseStudy = caseStudies.find((item) => item.shareId === shareId);
            if (!caseStudy) {
                console.warn(`${LOG} no caseStudies entry with shareId ${shareId}; skipping report ${reportId}`);
                result.skipped += 1;
                continue;
            }

            const sessionId = caseStudy.sessionId;
            const session = await Sessions.findOneAsync({ _id: sessionId });
            if (!session) {
                console.warn(`${LOG} study ${sessionId} not found; skipping report ${reportId}`);
                result.skipped += 1;
                continue;
            }

            // Covers analyses[] AND metaAnalyses[]. This is also what guarantees the clone will
            // take the row: the case-study share's selection is derived from the same namespace, so
            // an analysisId outside it would be dropped by analysisIdIsCloneable and the report
            // would reach nobody.
            if (!collectAnalysisIds(session).includes(analysisId)) {
                console.warn(
                    `${LOG} analysis ${analysisId} is not part of study ${sessionId}; skipping report ${reportId}`
                );
                result.skipped += 1;
                continue;
            }

            const pointer = pointerFields(session, analysisId);
            const existing = await BatchInfo.findOneAsync({ _id: reportId });

            if (existing) {
                if (!pointerDrifted(existing, pointer)) {
                    result.unchanged += 1;
                    console.log(`${LOG} report ${reportId} already seeded, skipping`);
                    continue;
                }
                await BatchInfo.updateAsync({ _id: reportId }, { $set: pointer });
                await PromptQueue.updateAsync(
                    { _id: promptIdFor(reportId) },
                    { $set: { userId: pointer.userId, sessionId: pointer.sessionId } }
                );
                result.repointed += 1;
                console.log(`${LOG} re-pointed report ${reportId} at study ${sessionId} (owner ${pointer.userId})`);
                continue;
            }

            // Assets.getTextAsync THROWS for a missing file ("Unknown asset: <path>") rather
            // than returning nothing, so this is caught here instead of falling through to the
            // per-entry catch below: a settings entry naming a file that was not shipped is an
            // operator-fixable config mistake, and it should read as one line in the log rather
            // than as a stack trace.
            let markdown;
            try {
                markdown = await readAsset(file);
            } catch (readError) {
                console.warn(
                    `${LOG} cannot read asset ${file} (${readError.message}); skipping report ${reportId}`
                );
                result.skipped += 1;
                continue;
            }
            if (typeof markdown !== "string" || !markdown.trim()) {
                console.warn(`${LOG} asset ${file} is empty; skipping report ${reportId}`);
                result.skipped += 1;
                continue;
            }

            // The study document is authoritative for the name; it is denormalised onto both rows
            // because that is the fallback the reports list and the report header read.
            const analysisName = analysisNameInStudy(session, analysisId) || "";

            // PROMPT ROW FIRST. If the batch write then fails, nothing is listed at all — whereas a
            // batch with no prompts IS listed by the AIInterpretation overview and opens to "No
            // completed templates available". Both writes are upserts keyed on their fixed _id, so a
            // half-finished boot converges on the next one instead of throwing a duplicate-key error
            // that would skip this report forever.
            await PromptQueue.upsertAsync(
                { _id: promptIdFor(reportId) },
                {
                    $set: {
                        batchId: reportId,
                        userId: pointer.userId,
                        sessionId: pointer.sessionId,
                        analysisName,
                        templateId: TEMPLATE_ID,
                        templateTitle: title,
                        prompt: PROMPT_TEXT,
                        status: "completed",
                        createdAt,
                        completedAt: createdAt,
                        penalty: 0,
                        batchIndex: 0,
                        totalInBatch: 1,
                        // InsightViewer keeps prompts with status 'completed' AND a truthy result,
                        // and renders result.answer (InsightComponents.jsx:139, :279-281).
                        result: { answer: markdown },
                    },
                }
            );

            await BatchInfo.upsertAsync(
                { _id: reportId },
                {
                    $set: {
                        ...pointer,
                        analysisName,
                        // The reports list renders insightName, NOT analysisName
                        // (insightListModel.js:44). This is where the title goes.
                        insightName: title,
                        status: "completed",
                        totalPrompts: 1,
                        completedPrompts: 1,
                        createdAt,
                        completedAt: createdAt,
                        estimatedCompletionTime: createdAt,
                        penalty: 0,
                        // EMPTY ARRAYS, NOT OMITTED. InsightComponents.jsx:797 does
                        // batch.selectedPathways.filter(...) with no optional chaining, from an IIFE
                        // in the JSX (:1019) that runs on every render — so a missing field throws
                        // during render and white-screens the report for everyone who opens it.
                        // :609 and :738 are the same hazard. [] is also honest: no selection was
                        // made for these reports.
                        selectedGenes: [],
                        selectedMethods: [],
                        selectedPathways: [],
                        // workflowType is deliberately absent: 'publication-ready' switches on the
                        // quality-score/validation panel (:1074), which needs metadata these
                        // reports have none of.
                    },
                }
            );

            result.seeded += 1;
            console.log(
                `${LOG} created report ${reportId} "${title}" on analysis ${analysisId} of study ${sessionId}`
            );
        } catch (error) {
            result.skipped += 1;
            console.error(`${LOG} failed to seed report ${reportId}:`, error);
        }
    }

    return result;
};

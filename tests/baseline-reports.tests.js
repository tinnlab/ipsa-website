// Tests for the owner-supplied baseline reports seeded on boot
// (server/helper/baselineReports.js).
//
// The seeder writes BatchInfo + PromptQueue rows directly, bypassing the wizard, so it can produce
// shapes the wizard never would. These tests pin the ones that would each fail silently or loudly
// in production: content written ONCE (the owner asked for skip-if-present), the pointer fields
// re-derived so a moved study does not orphan the reports, selected* arrays present so the viewer
// does not throw mid-render, the title in insightName because that is the field the list reads,
// and a partial write that recovers instead of wedging.
// Server-only; pure + injected fakes, no database.
import assert from "assert";
import {
    baselineReportEntries,
    seedBaselineReports,
} from "../server/helper/baselineReports";
import { insightItemModel } from "../imports/utils/insightListModel";
import { collectAnalysisIds } from "../imports/utils/ownership";

const MARKDOWN = "# Baseline Report 1\n\n| Gene | log2FC |\n| --- | --- |\n| TP53 | 1.24 |\n";
const STAMP_1 = "2026-08-01T14:04:33.000Z";
const STAMP_2 = "2026-08-01T14:04:32.000Z";
const STAMP_3 = "2026-08-01T14:04:31.000Z";

// Minimal in-memory collection: the seeder only does findOneAsync / updateAsync / upsertAsync keyed
// on _id, so equality on _id is the whole query surface needed. Same shape as
// tests/case-study-shares.tests.js, deliberately — one fake to learn, not two.
const makeColl = (docs = []) => {
    const store = docs.map((d) => ({ ...d }));
    const find = (sel) => store.find((d) => d._id === sel._id);
    return {
        _store: store,
        async findOneAsync(sel = {}) {
            const d = find(sel);
            return d ? { ...d } : undefined;
        },
        async updateAsync(sel = {}, modifier = {}) {
            const d = find(sel);
            if (!d) return 0;
            if (modifier.$set) Object.assign(d, modifier.$set);
            return 1;
        },
        async upsertAsync(sel = {}, modifier = {}) {
            const existing = find(sel);
            if (existing) {
                if (modifier.$set) Object.assign(existing, modifier.$set);
                return { numberAffected: 1 };
            }
            store.push({ _id: sel._id, ...(modifier.$setOnInsert || {}), ...(modifier.$set || {}) });
            return { numberAffected: 1, insertedId: sel._id };
        },
    };
};

// A study shaped like a case study: two analyses plus a meta-analysis, so the membership check can
// be shown to accept a meta-analysis target as well as an ordinary one.
const makeStudy = (overrides = {}) => ({
    _id: "sessCase1",
    userId: "ownerA",
    name: "TCGA-LIHC case study",
    analyses: [
        { id: "an1", name: "TCGA-LIHC 10k-stats" },
        { id: "an2", name: "TCGA-LIHC all genes" },
    ],
    metaAnalyses: [{ id: "meta1", name: "Meta of both" }],
    ...overrides,
});

const CASE_STUDIES = [
    { shareId: "zdMMTNsYxgEuPanvN", sessionId: "sessCase1", label: "Case Study 1" },
];

const entry = (overrides = {}) => ({
    reportId: "baseline-report-1",
    shareId: "zdMMTNsYxgEuPanvN",
    analysisId: "an1",
    title: "Baseline Report 1",
    file: "baseline-reports/baseline-report-1.md",
    createdAt: STAMP_1,
    ...overrides,
});

const threeEntries = () => [
    entry(),
    entry({ reportId: "baseline-report-2", title: "Baseline Report 2", createdAt: STAMP_2,
            file: "baseline-reports/baseline-report-2.md" }),
    entry({ reportId: "baseline-report-3", title: "Baseline Report 3", createdAt: STAMP_3,
            file: "baseline-reports/baseline-report-3.md" }),
];

// Files the asset reader can see, keyed the way Assets.getTextAsync is called.
const makeAssets = (files) => {
    const reads = [];
    const read = async (file) => {
        reads.push(file);
        if (!(file in files)) throw new Error(`Unknown asset: ${file}`);
        return files[file];
    };
    read._reads = reads;
    return read;
};

const ALL_FILES = {
    "baseline-reports/baseline-report-1.md": MARKDOWN,
    "baseline-reports/baseline-report-2.md": `${MARKDOWN}\nsecond\n`,
    "baseline-reports/baseline-report-3.md": `${MARKDOWN}\nthird\n`,
};

const run = ({ entries, caseStudies = CASE_STUDIES, Session, BatchInfo, PromptQueue, files = ALL_FILES }) =>
    seedBaselineReports({
        entries: baselineReportEntries(entries),
        caseStudies,
        collections: { Session, BatchInfo, PromptQueue },
        readAsset: makeAssets(files),
    });

const fresh = (study = makeStudy()) => ({
    Session: makeColl([study]),
    BatchInfo: makeColl([]),
    PromptQueue: makeColl([]),
});

describe("baselineReportEntries (reading the settings block)", function () {
    // NOT baselineReportEntries(undefined): `raw` defaults to the real settings block, so undefined
    // TRIGGERS that default rather than standing in for "no setting". Same trap the case-study
    // test documents.
    it("returns [] when the setting is absent or not an array", function () {
        assert.deepStrictEqual(baselineReportEntries(null), []);
        assert.deepStrictEqual(baselineReportEntries("nope"), []);
        assert.deepStrictEqual(baselineReportEntries({}), []);
        assert.deepStrictEqual(baselineReportEntries([]), []);
    });

    it("drops entries missing any id, and an object where a string belongs", function () {
        const result = baselineReportEntries([
            entry(),
            entry({ reportId: "" }),
            entry({ shareId: undefined }),
            entry({ analysisId: null }),
            // An object here would reach a Mongo selector as an operator.
            entry({ reportId: { $ne: null } }),
            null,
        ]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reportId, "baseline-report-1");
    });

    it("drops an entry with a blank title, since the title IS the report's name", function () {
        assert.deepStrictEqual(baselineReportEntries([entry({ title: "   " })]), []);
        assert.deepStrictEqual(baselineReportEntries([entry({ title: 42 })]), []);
        assert.strictEqual(baselineReportEntries([entry({ title: "  Padded  " })])[0].title, "Padded");
    });

    // Assets.getTextAsync happily follows "../" out of private/, and the path comes from settings.
    it("refuses an asset path that could climb out of private/", function () {
        assert.deepStrictEqual(baselineReportEntries([entry({ file: "../../etc/passwd" })]), []);
        assert.deepStrictEqual(baselineReportEntries([entry({ file: "/etc/passwd" })]), []);
        assert.deepStrictEqual(baselineReportEntries([entry({ file: "a/../../b.md" })]), []);
        assert.strictEqual(
            baselineReportEntries([entry({ file: "baseline-reports/x.md" })])[0].file,
            "baseline-reports/x.md"
        );
    });

    // A typo'd date would otherwise be written as an Invalid Date and sort unpredictably forever.
    it("drops an entry whose createdAt does not parse, and parses a good one to a Date", function () {
        assert.deepStrictEqual(baselineReportEntries([entry({ createdAt: "not a date" })]), []);
        assert.deepStrictEqual(baselineReportEntries([entry({ createdAt: undefined })]), []);
        const parsed = baselineReportEntries([entry()])[0].createdAt;
        assert.ok(parsed instanceof Date);
        assert.strictEqual(parsed.toISOString(), STAMP_1);
    });

    it("drops a duplicate reportId, keeping the first", function () {
        const result = baselineReportEntries([
            entry({ title: "First" }),
            entry({ title: "Second" }),
        ]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].title, "First");
    });

    // The no-argument path — the one production uses — read against the settings file the test run
    // was given. Asserts SHAPE, not contents, so it keeps passing when the deployment's reports
    // change, while still failing if the shipped block is malformed enough to be silently dropped.
    it("parses this deployment's own settings block into well-formed entries", function () {
        const configured = baselineReportEntries();
        assert.ok(Array.isArray(configured), "always an array, even with no setting");
        for (const item of configured) {
            assert.ok(item.reportId.length > 0);
            assert.ok(item.shareId.length > 0);
            assert.ok(item.analysisId.length > 0);
            assert.ok(item.title.length > 0);
            assert.ok(item.file.length > 0);
            assert.ok(item.createdAt instanceof Date && !Number.isNaN(item.createdAt.getTime()));
        }
        const ids = configured.map((item) => item.reportId);
        assert.strictEqual(new Set(ids).size, ids.length, "no duplicate reportId survived");
    });
});

describe("seedBaselineReports", function () {
    it("creates a batch and its prompt row for each configured report", async function () {
        const c = fresh();
        const result = await run({ entries: threeEntries(), ...c });

        assert.deepStrictEqual(result, { seeded: 3, repointed: 0, unchanged: 0, skipped: 0 });
        assert.strictEqual(c.BatchInfo._store.length, 3);
        assert.strictEqual(c.PromptQueue._store.length, 3);

        const batch = c.BatchInfo._store[0];
        assert.strictEqual(batch._id, "baseline-report-1", "uses the fixed report id verbatim");
        assert.strictEqual(batch.userId, "ownerA", "owner comes from the study");
        assert.strictEqual(batch.sessionId, "sessCase1");
        assert.strictEqual(batch.analysisId, "an1");
        assert.strictEqual(batch.analysisName, "TCGA-LIHC 10k-stats", "resolved from the study");
        assert.strictEqual(batch.status, "completed");
        assert.strictEqual(batch.totalPrompts, 1);
        assert.strictEqual(batch.completedPrompts, 1);

        const prompt = c.PromptQueue._store[0];
        assert.strictEqual(prompt._id, "baseline-report-1-prompt");
        assert.strictEqual(prompt.batchId, "baseline-report-1");
        assert.strictEqual(prompt.userId, "ownerA");
        assert.strictEqual(prompt.sessionId, "sessCase1");
    });

    // insightName is what the reports list renders (insightListModel.js:44). Asserting through the
    // real model rather than the raw field means the test and the list cannot drift apart.
    it("puts the title where the reports list actually reads it", async function () {
        const c = fresh();
        await run({ entries: threeEntries(), ...c });

        const titles = c.BatchInfo._store.map((b) => insightItemModel(b).title);
        assert.deepStrictEqual(titles, ["Baseline Report 1", "Baseline Report 2", "Baseline Report 3"]);
        for (const b of c.BatchInfo._store) {
            assert.notStrictEqual(insightItemModel(b).title, "Untitled report");
            assert.strictEqual(insightItemModel(b).statusKey, "completed");
        }
    });

    // InsightViewer keeps prompts with status 'completed' AND a truthy result, then renders
    // result.answer. A bare string, or a missing status, makes the report open to an empty panel.
    it("writes the prompt row in the shape the viewer keeps and renders", async function () {
        const c = fresh();
        await run({ entries: [entry()], ...c });

        const prompt = c.PromptQueue._store[0];
        assert.strictEqual(prompt.status, "completed");
        assert.ok(prompt.result, "truthy result, or the viewer filters the row out");
        assert.strictEqual(typeof prompt.result, "object", "an object, never a bare string");
        assert.strictEqual(prompt.result.answer, MARKDOWN);
        assert.strictEqual(prompt.templateTitle, "Baseline Report 1", "labels the collapse panel");
        assert.strictEqual(prompt.templateId, "baseline-report");
        assert.notStrictEqual(prompt.templateId, "publication-ready");
    });

    // InsightComponents.jsx:797 does batch.selectedPathways.filter(...) with NO optional chaining,
    // from an IIFE in the JSX that runs on every render — so omitting these fields throws during
    // render and white-screens the report for everyone who opens it. :609 and :738 are the same.
    it("writes selectedGenes/Methods/Pathways as empty arrays, never undefined", async function () {
        const c = fresh();
        await run({ entries: threeEntries(), ...c });

        for (const batch of c.BatchInfo._store) {
            for (const field of ["selectedGenes", "selectedMethods", "selectedPathways"]) {
                assert.ok(field in batch, `${field} is present`);
                assert.ok(Array.isArray(batch[field]), `${field} is an array, not undefined`);
                assert.strictEqual(batch[field].length, 0);
            }
        }
    });

    // 'publication-ready' switches on the quality-score panel, which needs metadata these reports
    // have none of.
    it("does not claim the publication-ready workflow", async function () {
        const c = fresh();
        await run({ entries: [entry()], ...c });
        assert.strictEqual(c.BatchInfo._store[0].workflowType, undefined);
    });

    it("writes each configured timestamp verbatim, newest first so 1, 2, 3 read top-down", async function () {
        const c = fresh();
        await run({ entries: threeEntries(), ...c });

        const stamps = c.BatchInfo._store.map((b) => b.createdAt.toISOString());
        assert.deepStrictEqual(stamps, [STAMP_1, STAMP_2, STAMP_3]);
        // Both lists sort createdAt DESCENDING, so report 1 must be the latest of the three.
        assert.ok(stamps[0] > stamps[1] && stamps[1] > stamps[2], "strictly descending");
        for (const batch of c.BatchInfo._store) {
            assert.deepStrictEqual(batch.completedAt, batch.createdAt);
            assert.deepStrictEqual(batch.estimatedCompletionTime, batch.createdAt);
        }
        assert.deepStrictEqual(
            c.PromptQueue._store.map((p) => p.createdAt.toISOString()),
            [STAMP_1, STAMP_2, STAMP_3]
        );
    });

    // The idempotency the owner asked for: already added => the script does not run.
    it("writes nothing at all on a second run", async function () {
        const c = fresh();
        const first = await run({ entries: threeEntries(), ...c });
        assert.strictEqual(first.seeded, 3);

        const before = JSON.stringify([c.BatchInfo._store, c.PromptQueue._store]);
        const second = await run({ entries: threeEntries(), ...c });

        assert.deepStrictEqual(second, { seeded: 0, repointed: 0, unchanged: 3, skipped: 0 });
        assert.strictEqual(c.BatchInfo._store.length, 3, "no duplicate rows");
        assert.strictEqual(c.PromptQueue._store.length, 3);
        assert.strictEqual(
            JSON.stringify([c.BatchInfo._store, c.PromptQueue._store]), before,
            "both rows byte-for-byte unchanged"
        );
    });

    // The cost of skip-if-present, pinned so it cannot be quietly turned back into re-assert: a
    // corrected markdown file does NOT reach a deployment that has already booted. Shipping a
    // correction means a new reportId.
    it("does not pick up an edited markdown file or an edited title once seeded", async function () {
        const c = fresh();
        await run({ entries: [entry()], ...c });

        const result = await run({
            entries: [entry({ title: "Renamed By Settings" })],
            files: { "baseline-reports/baseline-report-1.md": "# Corrected\n" },
            ...c,
        });

        assert.strictEqual(result.unchanged, 1);
        assert.strictEqual(c.BatchInfo._store[0].insightName, "Baseline Report 1");
        assert.strictEqual(c.PromptQueue._store[0].result.answer, MARKDOWN);
    });

    it("does not re-read the asset once the report exists", async function () {
        const c = fresh();
        await run({ entries: [entry()], ...c });

        const reader = makeAssets(ALL_FILES);
        await seedBaselineReports({
            entries: baselineReportEntries([entry()]),
            caseStudies: CASE_STUDIES,
            collections: c,
            readAsset: reader,
        });
        assert.deepStrictEqual(reader._reads, [], "skip means skip, including the file read");
    });

    // Every read in queue.js filters on userId, so a study that changes hands would otherwise leave
    // these reports invisible to their owner and cloned under an id nobody holds.
    it("re-points userId when the study changes hands, without touching the content", async function () {
        const c = fresh();
        await run({ entries: [entry()], ...c });
        assert.strictEqual(c.BatchInfo._store[0].userId, "ownerA");

        c.Session._store[0].userId = "recoveredOwnerB";
        const result = await run({ entries: [entry()], ...c });

        assert.deepStrictEqual(result, { seeded: 0, repointed: 1, unchanged: 0, skipped: 0 });
        assert.strictEqual(c.BatchInfo._store[0].userId, "recoveredOwnerB");
        assert.strictEqual(c.PromptQueue._store[0].userId, "recoveredOwnerB", "the prompt row follows");
        assert.strictEqual(c.BatchInfo._store[0].insightName, "Baseline Report 1", "content untouched");
        assert.strictEqual(c.PromptQueue._store[0].result.answer, MARKDOWN, "content untouched");
        assert.strictEqual(c.BatchInfo._store[0].createdAt.toISOString(), STAMP_1, "content untouched");
    });

    // Repointing a case study (as PR #189 did for case study 2) must carry its baseline reports
    // with it rather than stranding them on the old study.
    it("follows the caseStudies entry when it is repointed at another study", async function () {
        const c = fresh();
        await run({ entries: [entry()], ...c });

        const moved = makeStudy({ _id: "sessMoved", userId: "ownerC" });
        c.Session._store.push(moved);
        const result = await run({
            entries: [entry()],
            caseStudies: [{ shareId: "zdMMTNsYxgEuPanvN", sessionId: "sessMoved", label: "Case Study 1" }],
            ...c,
        });

        assert.strictEqual(result.repointed, 1);
        assert.strictEqual(c.BatchInfo._store[0].sessionId, "sessMoved");
        assert.strictEqual(c.BatchInfo._store[0].userId, "ownerC");
        assert.strictEqual(c.PromptQueue._store[0].sessionId, "sessMoved");
        assert.strictEqual(c.BatchInfo._store[0].insightName, "Baseline Report 1", "content untouched");
    });

    it("skips an entry whose shareId names no case study", async function () {
        const c = fresh();
        const result = await run({
            entries: [entry({ shareId: "notACaseStudy" }), ...threeEntries().slice(1)],
            ...c,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.seeded, 2, "the siblings are unaffected");
        assert.deepStrictEqual(
            c.BatchInfo._store.map((b) => b._id),
            ["baseline-report-2", "baseline-report-3"]
        );
    });

    it("skips when the case study's session is gone, writing no half-formed row", async function () {
        const c = { Session: makeColl([]), BatchInfo: makeColl([]), PromptQueue: makeColl([]) };
        const result = await run({ entries: threeEntries(), ...c });

        assert.strictEqual(result.skipped, 3);
        assert.strictEqual(c.BatchInfo._store.length, 0);
        assert.strictEqual(c.PromptQueue._store.length, 0, "not even a stray prompt row");
    });

    // Belt and braces for the clone: the case-study share's selection is derived from the same id
    // namespace, so an analysisId outside it would be dropped by analysisIdIsCloneable and the
    // report would reach nobody who imports the study.
    it("skips an analysis that is not part of the named study", async function () {
        const c = fresh();
        const result = await run({
            entries: [entry({ analysisId: "belongsElsewhere" }), ...threeEntries().slice(1)],
            ...c,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.seeded, 2);
        assert.ok(!c.BatchInfo._store.some((b) => b._id === "baseline-report-1"));
    });

    it("accepts a meta-analysis target and still names it", async function () {
        const c = fresh();
        const study = c.Session._store[0];
        assert.ok(collectAnalysisIds(study).includes("meta1"), "the fixture really has one");

        await run({ entries: [entry({ analysisId: "meta1" })], ...c });

        assert.strictEqual(c.BatchInfo._store[0].analysisId, "meta1");
        assert.strictEqual(c.BatchInfo._store[0].analysisName, "Meta of both");
    });

    it("skips an unreadable asset and leaves the other reports alone", async function () {
        const c = fresh();
        const files = { ...ALL_FILES };
        delete files["baseline-reports/baseline-report-1.md"];

        const result = await run({ entries: threeEntries(), files, ...c });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.seeded, 2);
        assert.strictEqual(c.BatchInfo._store.length, 2);
        assert.strictEqual(c.PromptQueue._store.length, 2, "no orphan prompt row for the bad entry");
    });

    // Assets.getTextAsync throws for a file that was never shipped, rather than returning nothing.
    it("skips a missing asset without letting the read error escape as a failure", async function () {
        const c = fresh();
        const result = await run({
            entries: [entry()],
            files: {},            // every read throws "Unknown asset: ..."
            ...c,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.seeded, 0);
        assert.strictEqual(c.BatchInfo._store.length, 0);
        assert.strictEqual(c.PromptQueue._store.length, 0, "not even a stray prompt row");
    });

    it("skips an asset that reads as empty rather than creating a blank report", async function () {
        const c = fresh();
        const result = await run({
            entries: [entry()],
            files: { "baseline-reports/baseline-report-1.md": "   \n\n" },
            ...c,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(c.BatchInfo._store.length, 0);
    });

    // Prompt row first: if the batch write fails, nothing is listed. A batch with no prompts IS
    // listed by the AIInterpretation overview and opens to "No completed templates available".
    it("leaves no batch row when the batch write fails", async function () {
        const c = fresh();
        c.BatchInfo.upsertAsync = async () => {
            throw new Error("mongo went away");
        };

        const result = await run({ entries: [entry()], ...c });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.seeded, 0);
        assert.strictEqual(c.BatchInfo._store.length, 0, "nothing is listed");
    });

    // ...and the debris that failure leaves behind must not wedge the entry. With insertAsync the
    // fixed prompt _id would collide on the next boot, the per-entry catch would swallow it, and
    // this report would be skipped on every boot forever. Upsert converges instead.
    it("recovers from a half-written report instead of skipping it forever", async function () {
        const c = fresh();
        // Exactly what a crash between the two writes leaves: a prompt row, no batch.
        c.PromptQueue._store.push({
            _id: "baseline-report-1-prompt",
            batchId: "baseline-report-1",
            userId: "stale",
            status: "completed",
            result: { answer: "half-written" },
        });

        const result = await run({ entries: [entry()], ...c });

        assert.strictEqual(result.seeded, 1, "created, not skipped");
        assert.strictEqual(result.skipped, 0, "and no duplicate-key error");
        assert.strictEqual(c.PromptQueue._store.length, 1, "the orphan was overwritten, not doubled");
        assert.strictEqual(c.PromptQueue._store[0].result.answer, MARKDOWN);
        assert.strictEqual(c.PromptQueue._store[0].userId, "ownerA");
        assert.strictEqual(c.BatchInfo._store.length, 1);
    });

    it("does nothing at all when no baseline reports are configured", async function () {
        const c = fresh();
        const result = await seedBaselineReports({
            // `null`, not `undefined` — undefined falls through to the real settings file.
            entries: baselineReportEntries(null),
            caseStudies: CASE_STUDIES,
            collections: c,
            readAsset: makeAssets(ALL_FILES),
        });

        assert.deepStrictEqual(result, { seeded: 0, repointed: 0, unchanged: 0, skipped: 0 });
        assert.strictEqual(c.BatchInfo._store.length, 0);
    });

    it("reports every entry as skipped when the collections are unavailable", async function () {
        const result = await seedBaselineReports({
            entries: baselineReportEntries(threeEntries()),
            caseStudies: CASE_STUDIES,
            collections: undefined,
            readAsset: makeAssets(ALL_FILES),
        });
        assert.deepStrictEqual(result, { seeded: 0, repointed: 0, unchanged: 0, skipped: 3 });
    });
});

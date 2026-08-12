// Tests for the 90-day data-retention cleanup.
//   Unit: pure staleness helpers (server/helper/retention.js).
//   Integration: the fs/DB runner (server/startup/cron-job.js) against real temp dirs with an
//   injected in-memory Sessions collection — deletes only files, keeps "DB" rows. Server-only.
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
    RETENTION_DEFAULT_DAYS,
    SESSION_EXPIRY_DAYS,
    TMP_SCRATCH_MAX_AGE_MS,
    daysToMs,
    newestMtimeMs,
    isSessionStale,
    selectStaleSessions,
    isSessionExpired,
    selectExpiredSessions,
    collectSessionAnalysisIds,
    extendedExpiry,
    backfilledExpiry,
    clampRetentionDays,
    formatDaysLeft,
    isScratchStale,
    isReapableScratchName,
} from "../server/helper/retention";
import {
    purgeStaleSessionUploads,
    reapTempScratch,
    deleteStudyCompletely,
    deleteExpiredStudies,
    anyRunningAnalysis,
    fetchRunningAnalysisIds,
    removeStudy,
    extendStudy,
    backfillLegacyExpiry,
    isPathInside,
} from "../server/startup/cron-job";

const DAY = 24 * 60 * 60 * 1000;

describe("data retention — pure helpers (retention.js)", function () {
    it("daysToMs converts days to milliseconds", function () {
        assert.strictEqual(daysToMs(1), DAY);
        assert.strictEqual(daysToMs(90), 90 * DAY);
        assert.strictEqual(RETENTION_DEFAULT_DAYS, 90);
    });

    describe("newestMtimeMs", function () {
        it("returns the max of valid numbers", function () {
            assert.strictEqual(newestMtimeMs([10, 99, 42]), 99);
        });
        it("ignores non-finite / non-number entries", function () {
            assert.strictEqual(newestMtimeMs([10, NaN, Infinity, "x", null, 50]), 50);
        });
        it("returns null when there is nothing valid", function () {
            assert.strictEqual(newestMtimeMs([]), null);
            assert.strictEqual(newestMtimeMs(undefined), null);
            assert.strictEqual(newestMtimeMs([NaN, null]), null);
        });
    });

    describe("isSessionStale", function () {
        const nowMs = 1_000_000_000_000;
        const retentionMs = daysToMs(90);
        it("is stale when newest activity is older than the window", function () {
            assert.strictEqual(
                isSessionStale({ newestMtimeMs: nowMs - 91 * DAY, nowMs, retentionMs }),
                true
            );
        });
        it("is NOT stale at/under the window", function () {
            assert.strictEqual(
                isSessionStale({ newestMtimeMs: nowMs - 89 * DAY, nowMs, retentionMs }),
                false
            );
            assert.strictEqual(
                isSessionStale({ newestMtimeMs: nowMs, nowMs, retentionMs }),
                false
            );
        });
        it("treats unknown mtime (null/non-finite) as NOT stale — never purge on missing data", function () {
            assert.strictEqual(isSessionStale({ newestMtimeMs: null, nowMs, retentionMs }), false);
            assert.strictEqual(isSessionStale({ newestMtimeMs: NaN, nowMs, retentionMs }), false);
            assert.strictEqual(isSessionStale({ newestMtimeMs: undefined, nowMs, retentionMs }), false);
        });
    });

    describe("selectStaleSessions", function () {
        const nowMs = 1_000_000_000_000;
        const retentionMs = daysToMs(90);
        it("returns only the entries past the window", function () {
            const sessions = [
                { _id: "old", newestMtimeMs: nowMs - 200 * DAY },
                { _id: "fresh", newestMtimeMs: nowMs - 1 * DAY },
                { _id: "empty", newestMtimeMs: null },
            ];
            const stale = selectStaleSessions(sessions, nowMs, retentionMs);
            assert.deepStrictEqual(stale.map((s) => s._id), ["old"]);
        });
        it("honors a smaller retention window (dataRetentionDays)", function () {
            const sessions = [{ _id: "two-days", newestMtimeMs: nowMs - 2 * DAY }];
            assert.strictEqual(selectStaleSessions(sessions, nowMs, daysToMs(1)).length, 1);
            assert.strictEqual(selectStaleSessions(sessions, nowMs, daysToMs(7)).length, 0);
        });
    });

    describe("study expiry helpers", function () {
        const nowMs = 1_000_000_000_000;

        it("SESSION_EXPIRY_DAYS is 90 and aligned with the file-retention window", function () {
            assert.strictEqual(SESSION_EXPIRY_DAYS, 90);
            assert.strictEqual(SESSION_EXPIRY_DAYS, RETENTION_DEFAULT_DAYS);
        });

        it("isSessionExpired is true strictly in the past, false at/after now", function () {
            assert.strictEqual(isSessionExpired({ expiredAt: new Date(nowMs - 1), nowMs }), true);
            assert.strictEqual(isSessionExpired({ expiredAt: new Date(nowMs), nowMs }), false); // exactly now: not yet
            assert.strictEqual(isSessionExpired({ expiredAt: new Date(nowMs + DAY), nowMs }), false);
        });

        it("isSessionExpired accepts Date or ISO string, and treats missing/unparseable as NOT expired", function () {
            assert.strictEqual(isSessionExpired({ expiredAt: new Date(nowMs - DAY).toISOString(), nowMs }), true);
            assert.strictEqual(isSessionExpired({ expiredAt: null, nowMs }), false);
            assert.strictEqual(isSessionExpired({ expiredAt: undefined, nowMs }), false);
            assert.strictEqual(isSessionExpired({ expiredAt: "not-a-date", nowMs }), false);
        });

        it("selectExpiredSessions returns only past-expiry sessions", function () {
            const sessions = [
                { _id: "old", expiredAt: new Date(nowMs - DAY) },
                { _id: "future", expiredAt: new Date(nowMs + DAY) },
                { _id: "nodate" },
            ];
            assert.deepStrictEqual(selectExpiredSessions(sessions, nowMs).map((s) => s._id), ["old"]);
        });

        it("collectSessionAnalysisIds merges regular + meta analyses, dedups, ignores missing ids", function () {
            const session = {
                analyses: [{ id: "a1" }, { id: "a2" }, {}, { id: "a1" }],
                metaAnalyses: [{ id: "meta1" }, { id: "a2" }],
            };
            assert.deepStrictEqual(collectSessionAnalysisIds(session).sort(), ["a1", "a2", "meta1"]);
            assert.deepStrictEqual(collectSessionAnalysisIds(undefined), []);
            assert.deepStrictEqual(collectSessionAnalysisIds({}), []);
        });

        it("extendedExpiry adds one window to the CURRENT expiredAt (extensions accumulate)", function () {
            const cur = new Date(nowMs);
            const ext = extendedExpiry(cur, nowMs);
            assert.strictEqual(ext.getTime(), nowMs + daysToMs(SESSION_EXPIRY_DAYS));
            // future expiry: still adds to the existing value, not to now
            const future = new Date(nowMs + 10 * DAY);
            assert.strictEqual(extendedExpiry(future, nowMs).getTime(), nowMs + 10 * DAY + daysToMs(SESSION_EXPIRY_DAYS));
            // no current expiry -> from now
            assert.strictEqual(extendedExpiry(null, nowMs).getTime(), nowMs + daysToMs(SESSION_EXPIRY_DAYS));
        });

        it("extendedExpiry honors a custom window (operator-configurable dataRetentionDays)", function () {
            assert.strictEqual(extendedExpiry(new Date(nowMs), nowMs, 30).getTime(), nowMs + daysToMs(30));
        });

        it("backfilledExpiry honors a custom window", function () {
            const created = new Date(nowMs);
            assert.strictEqual(backfilledExpiry(created, new Date(nowMs + DAY), 30, nowMs).getTime(), nowMs + daysToMs(30));
            // already beyond the custom window -> no change
            assert.strictEqual(backfilledExpiry(created, new Date(nowMs + 40 * DAY), 30, nowMs), null);
        });

        it("backfilledExpiry grants a GRACE window from deploy for legacy short expiries (incl. >window-old), else null", function () {
            const created = new Date(nowMs);
            const grace = nowMs + daysToMs(SESSION_EXPIRY_DAYS);
            // legacy 14-day expiry -> grace window from deploy (nowMs + window)
            const fixed = backfilledExpiry(created, new Date(nowMs + 14 * DAY), SESSION_EXPIRY_DAYS, nowMs);
            assert.ok(fixed instanceof Date);
            assert.strictEqual(fixed.getTime(), grace);
            // the risky case: a study created >window ago is NOT left in the past — it gets the
            // same future grace date (so the first sweep won't delete it).
            const old = backfilledExpiry(new Date(nowMs - 200 * DAY), new Date(nowMs - 200 * DAY + 14 * DAY), SESSION_EXPIRY_DAYS, nowMs);
            assert.strictEqual(old.getTime(), grace);
            // already at/beyond a full window from creation (e.g. new / already extended) -> no change
            assert.strictEqual(backfilledExpiry(created, new Date(nowMs + 200 * DAY), SESSION_EXPIRY_DAYS, nowMs), null);
            assert.strictEqual(backfilledExpiry(created, new Date(grace), SESSION_EXPIRY_DAYS, nowMs), null);
            // idempotent: feeding the corrected value back yields null
            assert.strictEqual(backfilledExpiry(created, fixed, SESSION_EXPIRY_DAYS, nowMs), null);
            // unusable createdAt -> leave untouched
            assert.strictEqual(backfilledExpiry(undefined, new Date(nowMs + 14 * DAY), SESSION_EXPIRY_DAYS, nowMs), null);
        });

        it("clampRetentionDays rejects degenerate windows (0/neg/NaN/strings) that would delete everything", function () {
            // Safe positive values pass through (incl. numeric strings as settings may store them).
            assert.strictEqual(clampRetentionDays(30, 90), 30);
            assert.strictEqual(clampRetentionDays("30", 90), 30);
            assert.strictEqual(clampRetentionDays(1, 90), 1);
            // Degenerate/unsafe values fall back to the default — never an immediately-expired window.
            assert.strictEqual(clampRetentionDays(0, 90), 90);
            assert.strictEqual(clampRetentionDays(-5, 90), 90);
            assert.strictEqual(clampRetentionDays(0.5, 90), 90); // < 1 day
            assert.strictEqual(clampRetentionDays(NaN, 90), 90);
            assert.strictEqual(clampRetentionDays("", 90), 90);
            assert.strictEqual(clampRetentionDays("abc", 90), 90);
            assert.strictEqual(clampRetentionDays(null, 90), 90);
            assert.strictEqual(clampRetentionDays(undefined, 90), 90);
        });

        it("formatDaysLeft shows days alone, dropping to hours then minutes inside the last day", function () {
            const H = 60 * 60 * 1000;
            const MIN = 60 * 1000;
            // The common case: a 90-day window reads as a day count, with no hours/minutes noise.
            assert.strictEqual(formatDaysLeft(90 * DAY), "90 days");
            assert.strictEqual(formatDaysLeft(45 * DAY), "45 days");
            // TOTAL days, keeping the earlier regression covered: moment.duration().days() returns
            // only the sub-month component, so 45 days rendered as "14 days" and wrapped as it grew.
            assert.strictEqual(formatDaysLeft(120 * DAY), "120 days");
            assert.strictEqual(formatDaysLeft(30 * DAY), "30 days");
            assert.strictEqual(formatDaysLeft(60 * DAY), "60 days");
            // Hours/minutes are suppressed while whole days remain.
            assert.strictEqual(formatDaysLeft(2 * DAY + 3 * H + 5 * MIN), "2 days");
            // Singular.
            assert.strictEqual(formatDaysLeft(DAY), "1 day");
            assert.strictEqual(formatDaysLeft(H), "1 hour");
            assert.strictEqual(formatDaysLeft(MIN), "1 minute");
            // The last-day cascade.
            assert.strictEqual(formatDaysLeft(DAY - MIN), "23 hours");
            assert.strictEqual(formatDaysLeft(23 * H + 59 * MIN), "23 hours");
            assert.strictEqual(formatDaysLeft(59 * MIN), "59 minutes");
            assert.strictEqual(formatDaysLeft(0), "0 minutes");
            // Negative / non-finite clamp to 0; the column renders an expired study blank anyway.
            assert.strictEqual(formatDaysLeft(-5 * DAY), "0 minutes");
            assert.strictEqual(formatDaysLeft(NaN), "0 minutes");
        });

        it("isPathInside is true only for a descendant path, false for traversal/escape", function () {
            assert.strictEqual(isPathInside("/data/up", "/data/up/u1/s1"), true);
            assert.strictEqual(isPathInside("/data/up", "/data/up/../evil"), false);
            assert.strictEqual(isPathInside("/data/up", "/data/up"), false); // same dir, not inside
            assert.strictEqual(isPathInside("/data/up", "/etc/passwd"), false);
        });
    });

    describe("isScratchStale", function () {
        const nowMs = 1_000_000_000_000;
        it("is true past the max age, false within it", function () {
            assert.strictEqual(isScratchStale(nowMs - 2 * DAY, nowMs), true);
            assert.strictEqual(isScratchStale(nowMs - 1000, nowMs), false);
            assert.strictEqual(TMP_SCRATCH_MAX_AGE_MS, DAY);
        });
        it("is false for unknown mtime", function () {
            assert.strictEqual(isScratchStale(null, nowMs), false);
            assert.strictEqual(isScratchStale(undefined, nowMs), false);
        });
    });

    describe("isReapableScratchName", function () {
        it("matches rEval's 17-char Random.id() .R / .json scratch", function () {
            assert.strictEqual(isReapableScratchName("ziMz2nZ7nuYduPRm6.R"), true);
            assert.strictEqual(isReapableScratchName("izaJXzre5FgCcRABy.json"), true);
        });
        it("does NOT match long-lived reference caches or .rds handoffs in tempDir", function () {
            // Named caches that must survive (geneInfo/idMapping/geneSet downloads).
            assert.strictEqual(isReapableScratchName("gene_info.gz"), false);
            assert.strictEqual(isReapableScratchName("idmapping.dat.gz"), false);
            assert.strictEqual(isReapableScratchName("NCBI2Reactome_All_Levels.txt"), false);
            assert.strictEqual(isReapableScratchName("go.obo"), false);
            assert.strictEqual(isReapableScratchName("GoGeneSets.json"), false); // not 17 chars
            // Cross-call RDS handoffs (per-method + meta/consensus) must survive.
            assert.strictEqual(isReapableScratchName("ziMz2nZ7nuYduPRm6_fgsea_expression.rds"), false);
            assert.strictEqual(isReapableScratchName("someAnalysisId_meta_analysis.rds"), false);
        });
        it("is false for empty/odd names", function () {
            assert.strictEqual(isReapableScratchName(""), false);
            assert.strictEqual(isReapableScratchName(undefined), false);
            assert.strictEqual(isReapableScratchName("short.R"), false); // wrong length
        });
    });
});

// In-memory stand-in for DBCollections.Session: only the methods the runner uses, so we can
// assert that NO row is ever removed (the runner has no remove call) — only a marker is set.
const makeFakeSessions = (docs) => {
    const store = docs.map((d) => ({ analyses: [], ...d }));
    return {
        find() {
            return { fetchAsync: async () => store.map((d) => ({ ...d })) };
        },
        async updateAsync(selector, modifier) {
            const doc = store.find((d) => d._id === selector._id);
            if (doc && modifier && modifier.$set) Object.assign(doc, modifier.$set);
        },
        _store: store,
    };
};

describe("data retention — runner (cron-job.js, fs + injected DB)", function () {
    let root;

    beforeEach(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-retention-"));
    });
    afterEach(function () {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    const writeFile = (p, contents, ageMs) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, contents);
        if (ageMs) {
            const t = (Date.now() - ageMs) / 1000; // seconds for utimes
            fs.utimesSync(p, t, t);
        }
    };

    it("purges only stale session dirs, keeps fresh ones, and removes no DB rows", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const staleDir = path.join(tempUploadDir, "u1", "sessStale");
        const freshDir = path.join(tempUploadDir, "u1", "sessFresh");
        writeFile(path.join(staleDir, "expr.csv"), "Gene,S1\nG1,1\n", 120 * DAY); // 120 days old
        writeFile(path.join(freshDir, "expr.csv"), "Gene,S1\nG1,1\n", 1 * DAY);   // 1 day old

        const Sessions = makeFakeSessions([
            { _id: "sessStale", userId: "u1", analyses: [{ id: "aStale" }] },
            { _id: "sessFresh", userId: "u1", analyses: [{ id: "aFresh" }] },
        ]);

        const result = await purgeStaleSessionUploads({
            nowMs: Date.now(),
            tempUploadDir,
            retentionMs: daysToMs(90),
            Sessions,
            runningAnalysisIds: new Set(), // nothing running
        });

        assert.strictEqual(result.purged, 1, "exactly one stale dir purged");
        assert.strictEqual(fs.existsSync(staleDir), false, "stale dir deleted");
        assert.strictEqual(fs.existsSync(freshDir), true, "fresh dir kept");

        // Both Session docs still exist (none removed); only the stale one is marked.
        assert.strictEqual(Sessions._store.length, 2);
        const stale = Sessions._store.find((s) => s._id === "sessStale");
        const fresh = Sessions._store.find((s) => s._id === "sessFresh");
        assert.ok(stale.dataPurgedAt instanceof Date, "stale session marked dataPurgedAt");
        assert.strictEqual(fresh.dataPurgedAt, undefined, "fresh session not marked");
    });

    it("does not purge a session whose upload dir is empty/missing", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        // No dir on disk for this session at all.
        const Sessions = makeFakeSessions([{ _id: "ghost", userId: "u1" }]);
        const result = await purgeStaleSessionUploads({
            nowMs: Date.now(),
            tempUploadDir,
            retentionMs: daysToMs(90),
            Sessions,
            runningAnalysisIds: new Set(),
        });
        assert.strictEqual(result.purged, 0);
        assert.strictEqual(Sessions._store[0].dataPurgedAt, undefined);
    });

    it("does NOT purge a stale session that has a running analysis", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const staleDir = path.join(tempUploadDir, "u1", "sessBusy");
        writeFile(path.join(staleDir, "expr.csv"), "Gene,S1\nG1,1\n", 120 * DAY);

        const Sessions = makeFakeSessions([
            { _id: "sessBusy", userId: "u1", analyses: [{ id: "aBusy" }] },
        ]);

        const result = await purgeStaleSessionUploads({
            nowMs: Date.now(),
            tempUploadDir,
            retentionMs: daysToMs(90),
            Sessions,
            runningAnalysisIds: new Set(["aBusy"]), // its analysis is mid-run
        });

        assert.strictEqual(result.purged, 0);
        assert.strictEqual(result.skippedActive, 1);
        assert.strictEqual(fs.existsSync(staleDir), true, "active session's data kept");
        assert.strictEqual(Sessions._store[0].dataPurgedAt, undefined);
    });

    it("removes the now-empty per-user parent dir after purging the user's last session", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const userDir = path.join(tempUploadDir, "uLast");
        const staleDir = path.join(userDir, "sessOnly");
        writeFile(path.join(staleDir, "expr.csv"), "Gene,S1\nG1,1\n", 120 * DAY);

        const Sessions = makeFakeSessions([{ _id: "sessOnly", userId: "uLast", analyses: [{ id: "a1" }] }]);
        const result = await purgeStaleSessionUploads({
            nowMs: Date.now(),
            tempUploadDir,
            retentionMs: daysToMs(90),
            Sessions,
            runningAnalysisIds: new Set(),
        });

        assert.strictEqual(result.purged, 1);
        assert.strictEqual(fs.existsSync(staleDir), false, "session dir deleted");
        assert.strictEqual(fs.existsSync(userDir), false, "empty per-user parent dir removed");
        // tempUploadDir itself is never removed.
        assert.strictEqual(fs.existsSync(tempUploadDir), true);
    });

    it("keeps the per-user parent dir when the user still has another session", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const userDir = path.join(tempUploadDir, "uShared");
        const staleDir = path.join(userDir, "sessStale");
        const freshDir = path.join(userDir, "sessFresh");
        writeFile(path.join(staleDir, "expr.csv"), "Gene,S1\nG1,1\n", 120 * DAY);
        writeFile(path.join(freshDir, "expr.csv"), "Gene,S1\nG1,1\n", 1 * DAY);

        const Sessions = makeFakeSessions([
            { _id: "sessStale", userId: "uShared", analyses: [{ id: "a1" }] },
            { _id: "sessFresh", userId: "uShared", analyses: [{ id: "a2" }] },
        ]);
        await purgeStaleSessionUploads({
            nowMs: Date.now(),
            tempUploadDir,
            retentionMs: daysToMs(90),
            Sessions,
            runningAnalysisIds: new Set(),
        });

        assert.strictEqual(fs.existsSync(staleDir), false);
        assert.strictEqual(fs.existsSync(userDir), true, "parent kept (other session present)");
        assert.strictEqual(fs.existsSync(freshDir), true);
    });

    // Generic in-memory Mongo-ish collection supporting the tiny query subset the cascade uses:
    // equality on _id/sessionId and `{$in: [...]}` on analysisId. Enough to assert removals.
    const makeColl = (docs = [], opts = {}) => {
        const store = docs.map((d) => ({ ...d }));
        const matches = (d, sel) => {
            for (const [k, v] of Object.entries(sel || {})) {
                if (k === "$or") {
                    if (!v.some((sub) => matches(d, sub))) return false;
                    continue;
                }
                if (v && typeof v === "object" && Array.isArray(v.$in)) {
                    if (!v.$in.includes(d[k])) return false;
                } else if (v && typeof v === "object" && v.$lt !== undefined) {
                    const dv = d[k] instanceof Date ? d[k].getTime() : new Date(d[k]).getTime();
                    const lv = v.$lt instanceof Date ? v.$lt.getTime() : new Date(v.$lt).getTime();
                    if (!(Number.isFinite(dv) && dv < lv)) return false;
                } else if (d[k] !== v) return false;
            }
            return true;
        };
        // Honor Mongo field projections so a test genuinely exercises the query's field list
        // (e.g. dropping metaAnalyses from a projection must break the meta-cascade test).
        const project = (d, fields) => {
            if (!fields) return { ...d };
            const out = {};
            if (d._id !== undefined) out._id = d._id;
            for (const k of Object.keys(fields)) if (fields[k] && d[k] !== undefined) out[k] = d[k];
            return out;
        };
        return {
            _store: store,
            find(sel = {}, opts = {}) {
                return { fetchAsync: async () => store.filter((d) => matches(d, sel)).map((d) => project(d, opts.fields)) };
            },
            async findOneAsync(sel = {}, opts = {}) {
                const d = store.find((x) => matches(x, sel));
                return d ? project(d, opts.fields) : undefined;
            },
            async removeAsync(sel = {}) {
                if (opts.throwOnRemove) throw new Error("simulated remove failure");
                for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], sel)) store.splice(i, 1);
            },
            async updateAsync(sel = {}, modifier = {}) {
                let n = 0;
                for (const d of store) {
                    if (matches(d, sel)) { if (modifier.$set) Object.assign(d, modifier.$set); n += 1; }
                }
                return n;
            },
        };
    };

    it("deleteStudyCompletely removes the study's upload dir, all owned rows, and its Session doc — leaving other studies untouched", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const targetDir = path.join(tempUploadDir, "u1", "sessTarget");
        const otherDir = path.join(tempUploadDir, "u1", "sessOther");
        writeFile(path.join(targetDir, "expr.csv"), "Gene,S1\nG1,1\n");
        writeFile(path.join(otherDir, "expr.csv"), "Gene,S1\nG1,1\n");

        // Target study owns two regular analyses + one meta-analysis.
        const collections = {
            Session: makeColl([
                { _id: "sessTarget", userId: "u1" },
                { _id: "sessOther", userId: "u1" },
            ]),
            AnalysisConfig: makeColl([{ analysisId: "a1" }, { analysisId: "a2" }, { analysisId: "aOther" }]),
            AnalysisConfigSnapshot: makeColl([{ analysisId: "a1" }, { analysisId: "meta1" }, { analysisId: "aOther" }]),
            AnalysisResult: makeColl([{ analysisId: "a2" }, { analysisId: "aOther" }]),
            AnalysisLog: makeColl([{ analysisId: "a1" }]),
            MassAnalysisQueueItem: makeColl([{ analysisId: "a1" }]),
            BatchInfo: makeColl([{ analysisId: "meta1" }, { analysisId: "aOther" }]), // AI report on the meta-analysis
            SessionConfig: makeColl([{ sessionId: "sessTarget" }, { sessionId: "sessOther" }]),
            MassAnalysisQueue: makeColl([{ sessionId: "sessTarget" }]),
            PromptQueue: makeColl([{ sessionId: "sessTarget" }, { sessionId: "sessOther" }]), // report payloads
            LlmQueue: makeColl([{ sessionId: "sessTarget" }]),
            // WorkflowExecutions are cascaded by sessionId (analysisId is optional on them); the
            // second target row has NO analysisId, proving the cascade doesn't rely on it.
            // WorkflowSteps key only on workflowId, gathered from this study's executions.
            WorkflowExecutions: makeColl([
                { sessionId: "sessTarget", analysisId: "a1", workflowId: "wf1" },
                { sessionId: "sessTarget", workflowId: "wfNoAnalysis" }, // no analysisId
                { sessionId: "sessOther", analysisId: "aOther", workflowId: "wfOther" },
            ]),
            WorkflowSteps: makeColl([{ workflowId: "wf1" }, { workflowId: "wfNoAnalysis" }, { workflowId: "wfOther" }]),
            // SessionRecoveryLog rows use both a singular sessionId and a sessionIds[] array shape;
            // neither is cascaded (audit trail) — the whole store must survive.
            SessionRecoveryLog: makeColl([{ sessionId: "sessTarget" }, { sessionIds: ["sessTarget", "other"] }]),
        };

        const session = {
            _id: "sessTarget",
            userId: "u1",
            analyses: [{ id: "a1" }, { id: "a2" }],
            metaAnalyses: [{ id: "meta1" }],
        };

        const result = await deleteStudyCompletely({ session, tempUploadDir, collections });

        assert.strictEqual(result.removed, true);
        assert.strictEqual(result.analysisIds, 3, "a1 + a2 + meta1");

        // Files: target dir gone, other study's dir kept.
        assert.strictEqual(fs.existsSync(targetDir), false, "target upload dir deleted");
        assert.strictEqual(fs.existsSync(otherDir), true, "other study's upload dir kept");

        // Every owned per-analysis row gone; the other study's rows survive.
        assert.deepStrictEqual(collections.AnalysisConfig._store.map((d) => d.analysisId), ["aOther"]);
        assert.deepStrictEqual(collections.AnalysisConfigSnapshot._store.map((d) => d.analysisId), ["aOther"]);
        assert.deepStrictEqual(collections.AnalysisResult._store.map((d) => d.analysisId), ["aOther"]);
        assert.strictEqual(collections.AnalysisLog._store.length, 0);
        assert.strictEqual(collections.MassAnalysisQueueItem._store.length, 0);
        assert.deepStrictEqual(collections.BatchInfo._store.map((d) => d.analysisId), ["aOther"], "meta-analysis report removed, other kept");

        // Per-session rows gone for target, kept for other.
        assert.deepStrictEqual(collections.SessionConfig._store.map((d) => d.sessionId), ["sessOther"]);
        assert.strictEqual(collections.MassAnalysisQueue._store.length, 0);
        assert.deepStrictEqual(collections.PromptQueue._store.map((d) => d.sessionId), ["sessOther"], "report payloads removed with the study, other kept");
        assert.strictEqual(collections.LlmQueue._store.length, 0);
        // SessionRecoveryLog is an audit trail, intentionally NOT cascaded — the whole store (both
        // the singular-sessionId and the sessionIds[]-array shapes) must survive untouched.
        assert.strictEqual(collections.SessionRecoveryLog._store.length, 2);

        // Workflow rows: BOTH target executions (incl. the one with no analysisId) removed by
        // sessionId, and their steps removed via the gathered workflowIds; the other study survives.
        assert.deepStrictEqual(collections.WorkflowExecutions._store.map((d) => d.sessionId), ["sessOther"]);
        assert.deepStrictEqual(collections.WorkflowSteps._store.map((d) => d.workflowId), ["wfOther"]);

        // Session doc: target removed, other kept.
        assert.deepStrictEqual(collections.Session._store.map((d) => d._id), ["sessOther"]);
    });

    it("deleteStudyCompletely handles a study with NO analyses — dir + per-session rows + doc removed, per-analysis loop skipped", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const dir = path.join(tempUploadDir, "u1", "sessEmpty");
        writeFile(path.join(dir, "expr.csv"), "Gene,S1\nG1,1\n");

        const collections = {
            Session: makeColl([{ _id: "sessEmpty", userId: "u1" }]),
            AnalysisConfig: makeColl([{ analysisId: "aOther" }]), // belongs to another study — must survive
            SessionConfig: makeColl([{ sessionId: "sessEmpty" }, { sessionId: "sessOther" }]),
        };
        const session = { _id: "sessEmpty", userId: "u1" }; // no analyses / metaAnalyses

        const result = await deleteStudyCompletely({ session, tempUploadDir, collections });

        assert.strictEqual(result.removed, true);
        assert.strictEqual(result.analysisIds, 0);
        assert.strictEqual(fs.existsSync(dir), false, "empty study's dir still removed");
        assert.deepStrictEqual(collections.AnalysisConfig._store.map((d) => d.analysisId), ["aOther"], "per-analysis loop skipped, other study's rows untouched");
        assert.deepStrictEqual(collections.SessionConfig._store.map((d) => d.sessionId), ["sessOther"]);
        assert.strictEqual(collections.Session._store.length, 0);
    });

    it("deleteStudyCompletely refuses to remove an upload dir that escapes tempUploadDir (crafted userId)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const outside = path.join(root, "outside-secret");
        writeFile(path.join(outside, "keep.txt"), "important");

        // A malicious/legacy userId with '../' segments would resolve outside tempUploadDir.
        const session = { _id: "sessEvil", userId: "../outside-secret", analyses: [] };
        let rmCalledWith = null;
        const collections = { Session: makeColl([{ _id: "sessEvil", userId: "../outside-secret" }]) };

        const result = await deleteStudyCompletely({
            session,
            tempUploadDir,
            collections,
            rm: async (d) => { rmCalledWith = d; },
        });

        assert.strictEqual(result.removed, true, "cascade still completes (DB rows/doc)");
        assert.strictEqual(rmCalledWith, null, "rm was refused for the escaping path");
        assert.strictEqual(fs.existsSync(path.join(outside, "keep.txt")), true, "outside file untouched");
        assert.strictEqual(collections.Session._store.length, 0, "Session doc still removed");
    });

    it("deleteStudyCompletely refuses (deletes nothing) when an analysis is running (final guard)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const dir = path.join(tempUploadDir, "u1", "sessBusy");
        writeFile(path.join(dir, "expr.csv"), "Gene,S1\nG1,1\n");

        const collections = {
            Session: makeColl([{ _id: "sessBusy", userId: "u1" }]),
            AnalysisConfig: makeColl([{ analysisId: "aBusy" }]),
            AnalysisLog: makeColl([{ analysisId: "aBusy", isRunning: true }]),
        };
        const session = { _id: "sessBusy", userId: "u1", analyses: [{ id: "aBusy" }] };

        const result = await deleteStudyCompletely({ session, tempUploadDir, collections });

        assert.strictEqual(result.removed, false);
        assert.strictEqual(result.skippedActive, true);
        assert.strictEqual(fs.existsSync(dir), true, "files untouched while running");
        assert.strictEqual(collections.AnalysisConfig._store.length, 1, "rows untouched");
        assert.strictEqual(collections.Session._store.length, 1, "Session doc untouched");
    });

    it("deleteStudyCompletely's running guard covers META-analyses (metaAnalyses ids are checked too)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const dir = path.join(tempUploadDir, "u1", "sessMetaBusy");
        writeFile(path.join(dir, "expr.csv"), "Gene,S1\nG1,1\n");

        const collections = {
            Session: makeColl([{ _id: "sessMetaBusy", userId: "u1" }]),
            AnalysisConfig: makeColl([{ analysisId: "meta1" }]),
            AnalysisLog: makeColl([{ analysisId: "meta1", isRunning: true }]), // the META is running
        };
        // Only a meta-analysis, and it is running.
        const session = { _id: "sessMetaBusy", userId: "u1", analyses: [], metaAnalyses: [{ id: "meta1" }] };

        const result = await deleteStudyCompletely({ session, tempUploadDir, collections });

        assert.strictEqual(result.removed, false);
        assert.strictEqual(result.skippedActive, true);
        assert.strictEqual(fs.existsSync(dir), true, "files untouched while the meta-analysis runs");
        assert.strictEqual(collections.Session._store.length, 1, "Session doc untouched");
    });

    it("deleteStudyCompletely is best-effort: one throwing collection does not abort the rest of the cascade", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const dir = path.join(tempUploadDir, "u1", "sessTarget");
        writeFile(path.join(dir, "expr.csv"), "Gene,S1\nG1,1\n");

        const collections = {
            Session: makeColl([{ _id: "sessTarget", userId: "u1" }]),
            AnalysisConfig: makeColl([{ analysisId: "a1" }], { throwOnRemove: true }), // throws
            AnalysisResult: makeColl([{ analysisId: "a1" }]),                          // must still be cleared
            SessionConfig: makeColl([{ sessionId: "sessTarget" }]),                    // must still be cleared
        };
        const session = { _id: "sessTarget", userId: "u1", analyses: [{ id: "a1" }] };

        const result = await deleteStudyCompletely({ session, tempUploadDir, collections });

        assert.strictEqual(result.removed, true, "cascade completes despite the throw");
        assert.strictEqual(fs.existsSync(dir), false, "files still removed");
        assert.strictEqual(collections.AnalysisResult._store.length, 0, "later per-analysis collection still cleared");
        assert.strictEqual(collections.SessionConfig._store.length, 0, "per-session collection still cleared");
        assert.strictEqual(collections.Session._store.length, 0, "Session doc still removed");
    });

    it("deleteStudyCompletely returns {removed:false} for a malformed session (no _id) and touches nothing", async function () {
        const collections = { Session: makeColl([]), AnalysisConfig: makeColl([{ analysisId: "aOther" }]) };
        const result = await deleteStudyCompletely({ session: { userId: "u1" }, tempUploadDir: path.join(root, "tmp-upload"), collections });
        assert.strictEqual(result.removed, false);
        assert.strictEqual(collections.AnalysisConfig._store.length, 1, "unrelated rows untouched");
    });

    it("purgeStaleSessionUploads skips malformed session docs (missing userId or _id)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const goodDir = path.join(tempUploadDir, "u1", "sessGood");
        writeFile(path.join(goodDir, "expr.csv"), "Gene,S1\nG1,1\n", 120 * DAY);

        const Sessions = makeFakeSessions([
            { _id: "sessGood", userId: "u1", analyses: [{ id: "aGood" }] },
            { _id: "noUser" },              // missing userId
            { userId: "u2" },               // missing _id
        ]);
        const result = await purgeStaleSessionUploads({
            nowMs: Date.now(), tempUploadDir, retentionMs: daysToMs(90), Sessions, runningAnalysisIds: new Set(),
        });
        assert.strictEqual(result.purged, 1, "only the well-formed stale session is purged");
        assert.strictEqual(fs.existsSync(goodDir), false);
    });

    it("deleteExpiredStudies deletes only past-expiry studies (files + rows + doc) and keeps fresh ones", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const expiredDir = path.join(tempUploadDir, "u1", "sessExpired");
        const freshDir = path.join(tempUploadDir, "u1", "sessFresh");
        writeFile(path.join(expiredDir, "expr.csv"), "Gene,S1\nG1,1\n");
        writeFile(path.join(freshDir, "expr.csv"), "Gene,S1\nG1,1\n");

        const now = Date.now();
        const Session = makeColl([
            { _id: "sessExpired", userId: "u1", analyses: [{ id: "aExp" }], expiredAt: new Date(now - DAY) },
            { _id: "sessFresh", userId: "u1", analyses: [{ id: "aFresh" }], expiredAt: new Date(now + 30 * DAY) },
        ]);
        const collections = {
            Session,
            AnalysisConfig: makeColl([{ analysisId: "aExp" }, { analysisId: "aFresh" }]),
            AnalysisConfigSnapshot: makeColl([]),
            AnalysisResult: makeColl([]),
            AnalysisLog: makeColl([]),
            AnalysisProgress: makeColl([]),
            MassAnalysisQueueItem: makeColl([]),
            BatchInfo: makeColl([]),
            SessionConfig: makeColl([]),
            MassAnalysisQueue: makeColl([]),
            SessionRecoveryLog: makeColl([]),
        };

        const result = await deleteExpiredStudies({
            nowMs: now,
            tempUploadDir,
            Sessions: Session,
            collections,
            runningAnalysisIds: new Set(),
        });

        assert.strictEqual(result.deleted, 1);
        assert.strictEqual(fs.existsSync(expiredDir), false, "expired study's files deleted");
        assert.strictEqual(fs.existsSync(freshDir), true, "fresh study's files kept");
        assert.deepStrictEqual(Session._store.map((d) => d._id), ["sessFresh"], "only expired study doc removed");
        assert.deepStrictEqual(collections.AnalysisConfig._store.map((d) => d.analysisId), ["aFresh"]);

        // Idempotent: a second identical sweep is a no-op (the expired study is already gone).
        const second = await deleteExpiredStudies({
            nowMs: now, tempUploadDir, Sessions: Session, collections, runningAnalysisIds: new Set(),
        });
        assert.strictEqual(second.deleted, 0, "second sweep deletes nothing");
        assert.deepStrictEqual(Session._store.map((d) => d._id), ["sessFresh"]);
    });

    it("deleteExpiredStudies deletes DB rows + doc for an expired study whose upload dir never existed", async function () {
        const tempUploadDir = path.join(root, "tmp-upload"); // no dir created for this study on disk
        const now = Date.now();
        const Session = makeColl([
            { _id: "sessNoDir", userId: "u1", analyses: [{ id: "aND" }], expiredAt: new Date(now - DAY) },
        ]);
        const collections = { Session, AnalysisConfig: makeColl([{ analysisId: "aND" }]), SessionConfig: makeColl([{ sessionId: "sessNoDir" }]) };

        const result = await deleteExpiredStudies({
            nowMs: now, tempUploadDir, Sessions: Session, collections, runningAnalysisIds: new Set(),
        });

        assert.strictEqual(result.deleted, 1, "missing dir is a no-op rm; DB cascade still runs");
        assert.strictEqual(collections.AnalysisConfig._store.length, 0);
        assert.strictEqual(collections.SessionConfig._store.length, 0);
        assert.strictEqual(collections.Session._store.length, 0);
    });

    it("deleteExpiredStudies keeps the containment guard through the sweep (crafted userId can't escape tempUploadDir)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const outside = path.join(root, "outside-secret");
        writeFile(path.join(outside, "keep.txt"), "important");

        const now = Date.now();
        const Session = makeColl([
            { _id: "sessEvilSweep", userId: "../outside-secret", analyses: [], expiredAt: new Date(now - DAY) },
        ]);
        // No injected rm: the real fsp.rm would run if the guard were broken, deleting the outside
        // dir — so the assertion below genuinely exercises isPathInside through the sweep path.
        const result = await deleteExpiredStudies({
            nowMs: now, tempUploadDir, Sessions: Session, collections: { Session }, runningAnalysisIds: new Set(),
        });

        assert.strictEqual(fs.existsSync(path.join(outside, "keep.txt")), true, "outside file untouched by the sweep");
        assert.deepStrictEqual(Session._store.map((d) => d._id), [], "Session doc still removed (DB cascade proceeds)");
        assert.strictEqual(result.deleted, 1);
    });

    it("deleteExpiredStudies skips a study Extended between the scan and the delete (expiry TOCTOU)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const dir = path.join(tempUploadDir, "u1", "sessExt");
        writeFile(path.join(dir, "expr.csv"), "Gene,S1\nG1,1\n");

        const now = Date.now();
        // Bespoke fake: the scan sees it expired, but the pre-delete re-read shows a future expiry
        // (as if the user hit Extend in the race window). removeAsync must never be called.
        const Session = {
            _store: [{ _id: "sessExt" }],
            find: () => ({ fetchAsync: async () => [{ _id: "sessExt", userId: "u1", analyses: [{ id: "a" }], expiredAt: new Date(now - DAY) }] }),
            findOneAsync: async () => ({ _id: "sessExt", expiredAt: new Date(now + 100 * DAY) }), // extended!
            removeAsync: async () => { throw new Error("must not delete an extended study"); },
        };

        const result = await deleteExpiredStudies({
            nowMs: now, tempUploadDir, Sessions: Session, collections: { Session }, runningAnalysisIds: new Set(),
        });

        assert.strictEqual(result.deleted, 0);
        assert.strictEqual(result.skipped, 1, "counted as an extended/no-op skip, not a delete");
        assert.strictEqual(fs.existsSync(dir), true, "extended study's files kept");
    });

    it("anyRunningAnalysis reflects AnalysisLog.isRunning for the study's analyses", async function () {
        const AnalysisLog = makeColl([
            { analysisId: "aRun", isRunning: true },
            { analysisId: "aIdle", isRunning: false },
        ]);
        assert.strictEqual(await anyRunningAnalysis(AnalysisLog, ["aRun"]), true);
        assert.strictEqual(await anyRunningAnalysis(AnalysisLog, ["aIdle"]), false);
        assert.strictEqual(await anyRunningAnalysis(AnalysisLog, ["aIdle", "aRun"]), true);
        assert.strictEqual(await anyRunningAnalysis(AnalysisLog, []), false);
        assert.strictEqual(await anyRunningAnalysis(undefined, ["aRun"]), false);
    });

    it("fetchRunningAnalysisIds returns a Set of only the running analysisIds", async function () {
        const AnalysisLog = makeColl([
            { analysisId: "aBusy", isRunning: true },
            { analysisId: "aIdle", isRunning: false },
            { analysisId: "aBusy2", isRunning: true },
        ]);
        const set = await fetchRunningAnalysisIds(AnalysisLog);
        assert.ok(set instanceof Set);
        assert.deepStrictEqual([...set].sort(), ["aBusy", "aBusy2"]);
        // No AnalysisLog → empty set (no crash on the default production dependency being absent).
        assert.strictEqual((await fetchRunningAnalysisIds(undefined)).size, 0);
    });

    it("deleteExpiredStudies re-checks AnalysisLog before deleting (TOCTOU: analysis started after the scan)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const dir = path.join(tempUploadDir, "u1", "sessRace");
        writeFile(path.join(dir, "expr.csv"), "Gene,S1\nG1,1\n");

        const now = Date.now();
        const Session = makeColl([
            { _id: "sessRace", userId: "u1", analyses: [{ id: "aRace" }], expiredAt: new Date(now - DAY) },
        ]);
        // The scan-time snapshot says nothing is running, but AnalysisLog now shows aRace running.
        // AnalysisLog lives in `collections`; deleteStudyCompletely's atomic re-check reads
        // C.AnalysisLog, so no separate top-level AnalysisLog arg is needed here.
        const AnalysisLog = makeColl([{ analysisId: "aRace", isRunning: true }]);
        const collections = { Session, AnalysisLog };

        const result = await deleteExpiredStudies({
            nowMs: now,
            tempUploadDir,
            Sessions: Session,
            collections,
            runningAnalysisIds: new Set(), // stale snapshot: empty
        });

        assert.strictEqual(result.deleted, 0);
        assert.strictEqual(result.skippedActive, 1);
        assert.strictEqual(fs.existsSync(dir), true, "raced study's files kept");
        assert.deepStrictEqual(Session._store.map((d) => d._id), ["sessRace"]);
    });

    it("deleteExpiredStudies skips an expired study that has a running analysis", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        const busyDir = path.join(tempUploadDir, "u1", "sessBusy");
        writeFile(path.join(busyDir, "expr.csv"), "Gene,S1\nG1,1\n");

        const now = Date.now();
        const Session = makeColl([
            { _id: "sessBusy", userId: "u1", analyses: [{ id: "aBusy" }], expiredAt: new Date(now - DAY) },
        ]);
        const collections = { Session };

        const result = await deleteExpiredStudies({
            nowMs: now,
            tempUploadDir,
            Sessions: Session,
            collections,
            runningAnalysisIds: new Set(["aBusy"]),
        });

        assert.strictEqual(result.deleted, 0);
        assert.strictEqual(result.skippedActive, 1);
        assert.strictEqual(fs.existsSync(busyDir), true, "running study's files kept");
        assert.deepStrictEqual(Session._store.map((d) => d._id), ["sessBusy"], "running study doc kept");
    });

    it("deleteExpiredStudies removes a meta-analysis's rows (metaAnalyses ids surfaced end-to-end)", async function () {
        const tempUploadDir = path.join(root, "tmp-upload");
        writeFile(path.join(tempUploadDir, "u1", "sessMeta", "expr.csv"), "Gene,S1\nG1,1\n");

        const now = Date.now();
        const Session = makeColl([
            { _id: "sessMeta", userId: "u1", analyses: [{ id: "aReg" }], metaAnalyses: [{ id: "meta1" }], expiredAt: new Date(now - DAY) },
        ]);
        const collections = {
            Session,
            AnalysisConfigSnapshot: makeColl([{ analysisId: "meta1" }, { analysisId: "aReg" }, { analysisId: "aOther" }]),
        };

        const result = await deleteExpiredStudies({
            nowMs: now, tempUploadDir, Sessions: Session, collections, runningAnalysisIds: new Set(),
        });

        assert.strictEqual(result.deleted, 1);
        // Both the regular AND the meta-analysis rows are gone; the unrelated one survives — this
        // only holds if the metaAnalyses ids are collected (regression guard for the projection).
        assert.deepStrictEqual(collections.AnalysisConfigSnapshot._store.map((d) => d.analysisId), ["aOther"]);
    });

    describe("removeStudy (session.remove control flow)", function () {
        it("returns {removed:false} for a missing study and never calls the cascade", async function () {
            let called = false;
            const collections = { Session: makeColl([]), AnalysisLog: makeColl([]) };
            const result = await removeStudy({
                sessionId: "nope", requesterUserId: "u1", collections,
                deleteFn: async () => { called = true; return { removed: true }; },
            });
            assert.deepStrictEqual(result, { removed: false });
            assert.strictEqual(called, false);
        });

        it("throws not-authorized when the requester does not own the study; cascade not called", async function () {
            let called = false;
            const collections = { Session: makeColl([{ _id: "s1", userId: "owner", analyses: [] }]), AnalysisLog: makeColl([]) };
            await assert.rejects(
                () => removeStudy({ sessionId: "s1", requesterUserId: "intruder", collections, deleteFn: async () => { called = true; } }),
                (e) => e.error === "not-authorized"
            );
            assert.strictEqual(called, false);
        });

        it("throws analysis-running when an owned study has a running analysis; cascade not called", async function () {
            let called = false;
            const collections = {
                Session: makeColl([{ _id: "s1", userId: "u1", analyses: [{ id: "aRun" }] }]),
                AnalysisLog: makeColl([{ analysisId: "aRun", isRunning: true }]),
            };
            await assert.rejects(
                () => removeStudy({ sessionId: "s1", requesterUserId: "u1", collections, deleteFn: async () => { called = true; } }),
                (e) => e.error === "analysis-running"
            );
            assert.strictEqual(called, false);
        });

        it("cascades when the owner removes an idle study", async function () {
            let passed = null;
            const collections = {
                Session: makeColl([{ _id: "s1", userId: "u1", analyses: [{ id: "aIdle" }] }]),
                AnalysisLog: makeColl([{ analysisId: "aIdle", isRunning: false }]),
            };
            const result = await removeStudy({
                sessionId: "s1", requesterUserId: "u1", collections,
                deleteFn: async (args) => { passed = args; return { removed: true, analysisIds: 1 }; },
            });
            assert.deepStrictEqual(result, { removed: true, analysisIds: 1 });
            assert.strictEqual(passed.session._id, "s1", "cascade received the resolved session");
        });

        it("throws analysis-running (not a false success) when the cascade's final guard refuses", async function () {
            const collections = {
                Session: makeColl([{ _id: "s1", userId: "u1", analyses: [{ id: "aRace" }] }]),
                AnalysisLog: makeColl([{ analysisId: "aRace", isRunning: false }]), // idle at the early check
            };
            await assert.rejects(
                () => removeStudy({
                    sessionId: "s1", requesterUserId: "u1", collections,
                    // simulate the race: the deep guard in the real cascade refused
                    deleteFn: async () => ({ removed: false, skippedActive: true }),
                }),
                (e) => e.error === "analysis-running"
            );
        });

        it("composes with the real cascade: owner-remove of an idle study returns {removed:true} and clears rows", async function () {
            const collections = {
                Session: makeColl([{ _id: "s1", userId: "u1", analyses: [{ id: "a1" }] }]),
                AnalysisLog: makeColl([{ analysisId: "a1", isRunning: false }]),
                AnalysisConfig: makeColl([{ analysisId: "a1" }, { analysisId: "aOther" }]),
                SessionConfig: makeColl([{ sessionId: "s1" }]),
            };
            // No deleteFn → the REAL deleteStudyCompletely runs (its derived upload dir doesn't
            // exist, so the fs rm is a harmless no-op) — exercises the full remove→cascade path.
            const result = await removeStudy({ sessionId: "s1", requesterUserId: "u1", collections });
            assert.strictEqual(result.removed, true);
            assert.deepStrictEqual(collections.AnalysisConfig._store.map((d) => d.analysisId), ["aOther"]);
            assert.strictEqual(collections.SessionConfig._store.length, 0);
            assert.strictEqual(collections.Session._store.length, 0);
        });
    });

    describe("extendStudy (session.extendExpiration control flow)", function () {
        it("throws session-not-found (reason 'Study not found.') when the study is missing", async function () {
            const collections = { Session: makeColl([]) };
            await assert.rejects(
                () => extendStudy({ sessionId: "nope", requesterUserId: "u1", collections }),
                (e) => e.error === "session-not-found" && e.reason === "Study not found"
            );
        });

        it("extends from now when the study has no current expiredAt", async function () {
            const nowMs = 5_000_000_000_000;
            const collections = { Session: makeColl([{ _id: "s1", userId: "u1" }]) }; // no expiredAt
            // inject a deterministic extendFn to avoid depending on real Date.now
            const result = await extendStudy({
                sessionId: "s1", requesterUserId: "u1", collections,
                extendFn: (cur) => extendedExpiry(cur, nowMs),
            });
            assert.strictEqual(result.getTime(), nowMs + daysToMs(SESSION_EXPIRY_DAYS));
            assert.strictEqual(collections.Session._store[0].expiredAt.getTime(), nowMs + daysToMs(SESSION_EXPIRY_DAYS));
        });

        it("throws not-authorized when the requester does not own the study", async function () {
            const collections = { Session: makeColl([{ _id: "s1", userId: "owner", expiredAt: new Date(1000) }]) };
            await assert.rejects(
                () => extendStudy({ sessionId: "s1", requesterUserId: "intruder", collections }),
                (e) => e.error === "not-authorized"
            );
            // unchanged
            assert.strictEqual(collections.Session._store[0].expiredAt.getTime(), 1000);
        });

        it("extends the owner's study by one window, computed server-side from the current expiredAt", async function () {
            const base = 2_000_000_000_000;
            const collections = { Session: makeColl([{ _id: "s1", userId: "u1", expiredAt: new Date(base) }]) };
            const result = await extendStudy({ sessionId: "s1", requesterUserId: "u1", collections });
            const expected = base + daysToMs(SESSION_EXPIRY_DAYS);
            assert.strictEqual(result.getTime(), expected, "returns the new expiry");
            assert.strictEqual(collections.Session._store[0].expiredAt.getTime(), expected, "persisted");
        });
    });

    it("backfillLegacyExpiry grants legacy studies a grace window from deploy (incl. >window-old) and is idempotent", async function () {
        const now = 3_000_000_000_000;
        const grace = now + daysToMs(SESSION_EXPIRY_DAYS);
        const Sessions = makeColl([
            { _id: "legacyRecent", createdAt: new Date(now - 30 * DAY), expiredAt: new Date(now - 30 * DAY + 14 * DAY) }, // legacy 14d, ~16d expired
            { _id: "legacyOld", createdAt: new Date(now - 200 * DAY), expiredAt: new Date(now - 200 * DAY + 14 * DAY) },  // >window old — the risky case
            { _id: "fresh", createdAt: new Date(now), expiredAt: new Date(now + daysToMs(SESSION_EXPIRY_DAYS)) },
            { _id: "extended", createdAt: new Date(now - 10 * DAY), expiredAt: new Date(now + 300 * DAY) },
        ]);

        const first = await backfillLegacyExpiry({ Sessions, nowMs: now });
        assert.strictEqual(first.updated, 2, "both legacy studies re-stamped; fresh + extended untouched");
        // Both legacy studies get a full grace window from deploy — crucially the >200-day-old one
        // is NOT left in the past (it would otherwise be hard-deleted on the first sweep).
        assert.strictEqual(new Date(Sessions._store.find((s) => s._id === "legacyRecent").expiredAt).getTime(), grace);
        assert.strictEqual(new Date(Sessions._store.find((s) => s._id === "legacyOld").expiredAt).getTime(), grace);
        // Both re-stamped studies are now in the FUTURE → not selected by the expiry sweep.
        assert.ok(!isSessionExpired({ expiredAt: Sessions._store.find((s) => s._id === "legacyOld").expiredAt, nowMs: now }));

        // Idempotent: a second pass changes nothing.
        const second = await backfillLegacyExpiry({ Sessions, nowMs: now });
        assert.strictEqual(second.updated, 0);
    });

    it("reapTempScratch deletes old rEval scratch but keeps recent scratch AND reference caches", async function () {
        const tempDir = path.join(root, "tmp");
        const oldScratch = "ziMz2nZ7nuYduPRm6.R";      // 17-char id + .R, old → reap
        const oldScratchJson = "izaJXzre5FgCcRABy.json"; // 17-char id + .json, old → reap
        const recentScratch = "QEhHhaKQABLbRemhg.R";    // matches pattern but recent → keep
        const cacheGz = "gene_info.gz";                  // named cache, old → KEEP
        const cacheRds = "ziMz2nZ7nuYduPRm6_fgsea_expression.rds"; // handoff, old → KEEP
        writeFile(path.join(tempDir, oldScratch), "1", 3 * DAY);
        writeFile(path.join(tempDir, oldScratchJson), "1", 3 * DAY);
        writeFile(path.join(tempDir, recentScratch), "1", 60 * 1000);
        writeFile(path.join(tempDir, cacheGz), "1", 30 * DAY);
        writeFile(path.join(tempDir, cacheRds), "1", 30 * DAY);

        const result = await reapTempScratch({ nowMs: Date.now(), tempDir });

        assert.strictEqual(result.reaped, 2);
        assert.strictEqual(fs.existsSync(path.join(tempDir, oldScratch)), false);
        assert.strictEqual(fs.existsSync(path.join(tempDir, oldScratchJson)), false);
        assert.strictEqual(fs.existsSync(path.join(tempDir, recentScratch)), true, "recent scratch kept");
        assert.strictEqual(fs.existsSync(path.join(tempDir, cacheGz)), true, "reference cache kept");
        assert.strictEqual(fs.existsSync(path.join(tempDir, cacheRds)), true, "rds handoff kept");
    });
});

// Pure, dependency-free, ISOMORPHIC retention helpers (no Meteor / no fs), importable from BOTH
// client and server so the study-expiry window and expiry logic have a single source of truth.
// The fs/DB side effects that use these live in server/startup/cron-job.js; server/helper/retention.js
// re-exports this module so existing server imports keep working.

export const RETENTION_DEFAULT_DAYS = 90;

// DEFAULT study-expiry window (days): a study lives this long from creation and each "Extend"
// adds another window. The study-expiry window and the file-retention window are deliberately the
// SAME number so files and the study they belong to expire together. Operators can override the
// window via Meteor.settings.private.dataRetentionDays — the SERVER reads that value via
// sessionExpiryDays() (server/helper/retention.js) and threads it into extendedExpiry/
// backfilledExpiry/creation, so this constant is only the fallback / client display default.
export const SESSION_EXPIRY_DAYS = RETENTION_DEFAULT_DAYS;

// Transient R scratch under tempDir (.data/tmp) — Rcmd wrappers, leftover .rds/.json — older
// than this are reaped. Comfortably longer than any single R run (rEval caps at ~20 min) so a
// file in active use is never deleted.
export const TMP_SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

export const daysToMs = (days) => days * 24 * 60 * 60 * 1000;

// Remaining-time span (ms) for the "Expires In" column, as a single unit. The DAY count is the only
// thing that matters over a 90-day window — the earlier "D days H hours M minutes" form put two
// units of noise on every row — so this shows days and only cascades to hours, then minutes, once
// the study is inside its last day. Days are TOTAL days, NOT moment.duration(ms).days(), which
// returns only the sub-month component (45 days would render as "14 days", wrapping as the real
// span grows past a month). Mirrors the cascade in imports/utils/shareLink.js, but takes a plain ms
// span rather than a share doc, so retention stays free of share-status concerns. Negative /
// non-finite spans clamp to "0 minutes" — the caller renders an already-expired study as blank, so
// unlike the shareLink version there is nothing to round up to. Pure + isomorphic, so unit-testable.
export const formatDaysLeft = (msRemaining) => {
    const ms = Number(msRemaining);
    const totalMinutes = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60000) : 0;
    const days = Math.floor(totalMinutes / (60 * 24));
    if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
};

// Sanitize an operator-supplied retention-window value into a safe positive day count. Coerces
// with Number() and REJECTS anything not finite and >= 1 day (0, negative, NaN, "", non-numeric
// strings) — a degenerate window would make every study immediately expired and hard-deleted by
// the sweep. Returns `fallback` for any unsafe input. Pure; the server-side reader wraps this.
export const clampRetentionDays = (raw, fallback = SESSION_EXPIRY_DAYS) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
};

// Epoch-ms of a Date | ISO string | number, or NaN when unparseable/absent.
const toMs = (v) => {
    if (v === null || v === undefined) return NaN;
    return v instanceof Date ? v.getTime() : new Date(v).getTime();
};

// Newest mtime (epoch ms) among a list of numbers; null when there is nothing valid. Kept as a
// generic helper (still used by the running-analysis TOCTOU re-check in the expiry sweep).
export const newestMtimeMs = (mtimes) => {
    const valid = (mtimes || []).filter((m) => typeof m === "number" && isFinite(m));
    if (!valid.length) return null;
    return Math.max(...valid);
};

// A session's upload dir is stale when its most-recently-touched file is older than the
// retention window. Unknown mtime (null/non-finite, e.g. empty or missing dir) is NOT stale —
// there is nothing to reclaim and we must not purge on missing data.
export const isSessionStale = ({ newestMtimeMs: m, nowMs, retentionMs }) => {
    if (typeof m !== "number" || !isFinite(m)) return false;
    return nowMs - m > retentionMs;
};

// From [{ ..., newestMtimeMs }] return only the entries to purge.
export const selectStaleSessions = (sessions, nowMs, retentionMs) =>
    (sessions || []).filter((s) =>
        isSessionStale({ newestMtimeMs: s && s.newestMtimeMs, nowMs, retentionMs })
    );

// A scratch file is reapable when older than maxAgeMs.
export const isScratchStale = (mtimeMs, nowMs, maxAgeMs = TMP_SCRATCH_MAX_AGE_MS) =>
    typeof mtimeMs === "number" && isFinite(mtimeMs) && nowMs - mtimeMs > maxAgeMs;

// tempDir (.data/tmp) is shared: besides rEval's transient scratch it ALSO holds long-lived
// reference caches (gene_info.gz, idmapping.dat.gz, NCBI2Reactome*.txt, go.obo,
// GoGeneSets.json, gene2go.gz) and deterministically-named cross-call handoffs (*.rds for
// meta/consensus). Reaping by mtime alone would delete those. So only reap files whose names
// match rEval's scratch shape: a 17-char Meteor Random.id() plus `.R` or `.json`
// (server/include/rEval.js writes `${Random.id()}.R` / `${Random.id()}.json`; the Rcmd wrapper
// `.R` is the file that otherwise leaks since rEval never unlinks it). `.rds` and any named
// cache are deliberately NOT matched.
export const isReapableScratchName = (name) => /^[A-Za-z0-9]{17}\.(R|json)$/.test(name || "");

// ---------------------------------------------------------------------------
// Study (Session) expiry — the single driver for deleting a study and its files.
// ---------------------------------------------------------------------------

// A study is expired when it carries a valid `expiredAt` timestamp in the past. A missing or
// unparseable `expiredAt` is NEVER treated as expired: legacy/malformed docs must not be
// silently destroyed by the sweep — nothing to reclaim without a trustworthy date.
export const isSessionExpired = ({ expiredAt, nowMs }) => {
    const t = toMs(expiredAt);
    return Number.isFinite(t) && t < nowMs;
};

// From a list of session docs, return only those past their expiry.
export const selectExpiredSessions = (sessions, nowMs) =>
    (sessions || []).filter((s) => isSessionExpired({ expiredAt: s && s.expiredAt, nowMs }));

// Every analysis id owned by a session: regular analyses PLUS meta-analyses. Used to fan the
// cascade delete across all per-analysis collections (configs, snapshots, results, logs, ...).
// De-duplicated; ignores entries without an id. Never throws on malformed input.
export const collectSessionAnalysisIds = (session) => {
    if (!session) return [];
    const ids = [];
    if (Array.isArray(session.analyses)) {
        for (const a of session.analyses) if (a && a.id) ids.push(a.id);
    }
    if (Array.isArray(session.metaAnalyses)) {
        for (const m of session.metaAnalyses) if (m && m.id) ids.push(m.id);
    }
    return Array.from(new Set(ids));
};

// The new expiry after one "Extend": SESSION_EXPIRY_DAYS added to the study's CURRENT expiredAt
// (so extensions accumulate). Falls back to `now` when there is no current expiry. Computed with
// raw ms so client and server agree exactly. Single source of truth for both the Extend button
// and the server-side session.extendExpiration method.
export const extendedExpiry = (currentExpiredAt, nowMs = Date.now(), days = SESSION_EXPIRY_DAYS) => {
    // Base on max(currentExpiredAt, now): a future expiry accumulates (extensions stack), but an
    // already-past expiry extends from NOW so extending a just-expired study always yields a
    // future date (lets a user rescue a study before the nightly sweep deletes it).
    const finite = toMs(currentExpiredAt);
    const base = Number.isFinite(finite) ? Math.max(finite, nowMs) : nowMs;
    return new Date(base + daysToMs(days));
};

// One-time backfill for legacy studies created under the old 14-day window. A study that still
// carries a short expiry (stored expiredAt earlier than a full window from creation) is granted a
// GRACE window from `nowMs` (deploy time), so the first expiry sweep after deploy never deletes a
// pre-existing study — even one created long ago; normal expiry resumes after the grace period.
// Returns the corrected expiredAt (Date), or null when no change is needed (already at/beyond a
// full window from creation — e.g. a new or already-extended study) or when createdAt is unusable.
// Idempotent: once re-stamped to a future grace date, a later run sees cur >= createdWindow-or-
// future and yields null.
export const backfilledExpiry = (createdAt, expiredAt, days = SESSION_EXPIRY_DAYS, nowMs = Date.now()) => {
    const base = toMs(createdAt);
    if (!Number.isFinite(base)) return null; // no trustworthy creation time — leave untouched
    const createdWindow = base + daysToMs(days);
    const cur = toMs(expiredAt);
    if (Number.isFinite(cur) && cur >= createdWindow) return null; // already at/beyond a full window
    // Legacy short expiry → grace window from deploy (max guards a hypothetical future createdAt).
    return new Date(Math.max(createdWindow, nowMs + daysToMs(days)));
};

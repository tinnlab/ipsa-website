// Tests for the permanent case-study shares seeded on boot (server/helper/caseStudies.js).
//
// The seeder bypasses share.create, so it can write states share.create would refuse. These tests
// pin the four things that would each silently produce a link that exists but does not work:
// ownerUserId derived from the session, analysisIds resolved through resolveShareSelection, a
// missing session skipped rather than half-written, and 'full' refused on a read-only source.
// Server-only; pure + injected fakes, no database.
import assert from "assert";
import { caseStudyEntries, seedCaseStudies } from "../server/helper/caseStudies";
import { resolveShareSelection } from "../imports/utils/shareSelection";
import { collectAnalysisIds } from "../imports/utils/ownership";
import {
    DAY_MS,
    MAX_EXPIRY_DAYS,
    MIN_EXPIRY_DAYS,
    SHARE_STATUS,
    expiryFromDays,
    isShareUsable,
    isValidExpiryDays,
    shareStatus,
} from "../imports/utils/shareLink";

const NOW = new Date("2026-03-01T00:00:00Z");

// Minimal in-memory collection: the seeder only ever does findOneAsync / updateAsync / upsertAsync
// keyed on _id, so equality on _id is the whole query surface needed.
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
            // Genuinely delete the key — these tests turn on a field being ABSENT, and assigning
            // undefined would leave `"expiredAt" in doc` true.
            if (modifier.$unset) for (const k of Object.keys(modifier.$unset)) delete d[k];
            return 1;
        },
        async upsertAsync(sel = {}, modifier = {}) {
            const existing = find(sel);
            if (existing) {
                if (modifier.$set) Object.assign(existing, modifier.$set);
                return { numberAffected: 1 };
            }
            const doc = { _id: sel._id, ...(modifier.$setOnInsert || {}), ...(modifier.$set || {}) };
            store.push(doc);
            return { numberAffected: 1, insertedId: sel._id };
        },
    };
};

// A study with two analyses and a meta-analysis computed from both — the shape that makes
// resolveShareSelection's meta auto-inclusion observable.
const makeStudy = (overrides = {}) => ({
    _id: "sessCase1",
    userId: "ownerA",
    name: "Colorectal cancer case study",
    analyses: [
        { id: "a1", name: "GSE1" },
        { id: "a2", name: "GSE2" },
    ],
    metaAnalyses: [
        { id: "m1", name: "Meta of both", geneLevel: { selectedAnalyses: ["a1", "a2"] } },
    ],
    ...overrides,
});

const entry = (overrides = {}) => ({
    shareId: "zdMMTNsYxgEuPanvN",
    sessionId: "sessCase1",
    label: "Colorectal cancer",
    ...overrides,
});

describe("caseStudyEntries (reading the settings block)", function () {
    // NOT caseStudyEntries(undefined): `raw` has a default of Meteor.settings.private.caseStudies,
    // and passing undefined TRIGGERS that default rather than standing in for "no setting". This
    // assertion used to include it and passed only because config/settings.json happened to hold an
    // empty array — the unit test was silently reading the deployment's config. `null` expresses
    // absence without colliding with the default; the real no-argument path is covered below.
    it("returns [] when the setting is absent or not an array", function () {
        assert.deepStrictEqual(caseStudyEntries(null), []);
        assert.deepStrictEqual(caseStudyEntries("nope"), []);
        assert.deepStrictEqual(caseStudyEntries({}), []);
        assert.deepStrictEqual(caseStudyEntries([]), []);
    });

    it("drops entries without a usable shareId or sessionId", function () {
        const result = caseStudyEntries([
            { shareId: "good", sessionId: "sess", label: "Keep" },
            { shareId: "", sessionId: "sess" },
            { shareId: "x" },
            { sessionId: "y" },
            null,
            // An object where a string is expected would reach a Mongo selector as an operator.
            { shareId: { $ne: null }, sessionId: "sess" },
        ]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].shareId, "good");
    });

    // Two entries on one shareId would fight over the same row on every boot, each overwriting the
    // other's sourceSessionId — the link would point at whichever wrote last.
    it("drops a duplicate shareId, keeping the first", function () {
        const result = caseStudyEntries([
            { shareId: "dup", sessionId: "sessA", label: "First" },
            { shareId: "dup", sessionId: "sessB", label: "Second" },
        ]);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].sessionId, "sessA");
    });

    // The no-argument path — the one production actually uses — read against the real settings file
    // the test run was given. Deliberately asserts SHAPE, not contents: it must keep passing when
    // the deployment's case studies change, while still failing loudly if the shipped block is
    // malformed enough that the seeder would silently drop an entry it was meant to create.
    it("parses this deployment's own settings block into well-formed entries", function () {
        const configured = caseStudyEntries();
        assert.ok(Array.isArray(configured), "always an array, even with no setting");
        for (const item of configured) {
            assert.strictEqual(typeof item.shareId, "string");
            assert.ok(item.shareId.length > 0, "every entry has a usable shareId");
            assert.strictEqual(typeof item.sessionId, "string");
            assert.ok(item.sessionId.length > 0, "every entry has a usable sessionId");
            assert.ok(item.label === null || typeof item.label === "string");
        }
        const shareIds = configured.map((item) => item.shareId);
        assert.strictEqual(new Set(shareIds).size, shareIds.length, "no duplicate shareId survived");
    });

    it("normalises a missing or blank label to null so the seeder can fall back to the study name", function () {
        assert.strictEqual(caseStudyEntries([{ shareId: "s", sessionId: "x" }])[0].label, null);
        assert.strictEqual(caseStudyEntries([{ shareId: "s", sessionId: "x", label: "   " }])[0].label, null);
        assert.strictEqual(caseStudyEntries([{ shareId: "s", sessionId: "x", label: " Hi " }])[0].label, "Hi");
    });
});

describe("seedCaseStudies", function () {
    it("makes the study permanent and upserts a full, never-expiring share", async function () {
        const Session = makeColl([makeStudy({ expiredAt: new Date("2026-06-01T00:00:00Z") })]);
        const StudyShare = makeColl([]);

        const result = await seedCaseStudies({
            entries: caseStudyEntries([entry()]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(result.seeded, 1);
        assert.strictEqual(result.skipped, 0);

        const study = Session._store[0];
        assert.strictEqual(study.permanent, true, "flagged permanent");
        assert.ok(!("expiredAt" in study), "expiredAt cleared, not merely set to null");

        const share = StudyShare._store[0];
        assert.strictEqual(share._id, "zdMMTNsYxgEuPanvN", "uses the fixed share id verbatim");
        assert.strictEqual(share.mode, "full");
        assert.strictEqual(share.neverExpires, true);
        assert.strictEqual(share.revokedAt, null);
        assert.strictEqual(share.expiresAt, null);
        assert.strictEqual(share.sourceSessionId, "sessCase1");
        assert.strictEqual(share.importCount, 0);
        assert.deepStrictEqual(share.createdAt, NOW);
        assert.strictEqual(share.caseStudyLabel, "Colorectal cancer");
    });

    // Hardcoding an owner would break both links the moment a case study changed hands, because
    // share.import refuses when sourceSession.userId !== share.ownerUserId.
    it("derives ownerUserId from the session, never from configuration", async function () {
        const Session = makeColl([makeStudy({ userId: "someoneElse" })]);
        const StudyShare = makeColl([]);

        await seedCaseStudies({
            entries: caseStudyEntries([entry()]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(StudyShare._store[0].ownerUserId, "someoneElse");
    });

    // resolveShareSelection is what PR #174 added so a meta-analysis travels with the analyses it
    // was computed from. Hand-rolling the id list here would silently drop it.
    it("stores resolveShareSelection's allIds, so meta-analyses are included", async function () {
        const study = makeStudy();
        const Session = makeColl([study]);
        const StudyShare = makeColl([]);

        await seedCaseStudies({
            entries: caseStudyEntries([entry()]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        const expected = resolveShareSelection(study, collectAnalysisIds(study)).allIds;
        assert.deepStrictEqual(StudyShare._store[0].analysisIds, expected);
        assert.ok(expected.includes("m1"), "the meta-analysis really is in there");
        assert.deepStrictEqual(expected, ["a1", "a2", "m1"]);
    });

    it("is idempotent across two runs, preserving createdAt and importCount", async function () {
        const Session = makeColl([makeStudy({ expiredAt: new Date("2026-06-01T00:00:00Z") })]);
        const StudyShare = makeColl([]);
        const entries = caseStudyEntries([entry()]);

        const first = await seedCaseStudies({ entries, collections: { Session, StudyShare }, now: NOW });
        assert.strictEqual(first.seeded, 1);

        // Simulate real use between restarts: the link has been imported a few times.
        StudyShare._store[0].importCount = 7;
        const afterFirst = { ...StudyShare._store[0] };

        const later = new Date("2026-09-09T00:00:00Z");
        const second = await seedCaseStudies({ entries, collections: { Session, StudyShare }, now: later });

        assert.strictEqual(second.seeded, 0, "nothing created the second time");
        assert.strictEqual(second.unchanged, 1, "reported as already up to date");
        assert.strictEqual(StudyShare._store.length, 1, "no duplicate row");

        const share = StudyShare._store[0];
        assert.deepStrictEqual(share.createdAt, NOW, "createdAt is history, not rewritten on restart");
        assert.strictEqual(share.importCount, 7, "the import counter is not reset");
        assert.deepStrictEqual(share, afterFirst, "the row is byte-for-byte unchanged");
    });

    // A workspace recovery transfers Session.userId without touching the share row, which would
    // otherwise leave share.import refusing forever. Re-deriving on every boot self-heals it.
    it("self-heals ownerUserId after the study changes hands", async function () {
        const Session = makeColl([makeStudy()]);
        const StudyShare = makeColl([]);
        const entries = caseStudyEntries([entry()]);

        await seedCaseStudies({ entries, collections: { Session, StudyShare }, now: NOW });
        assert.strictEqual(StudyShare._store[0].ownerUserId, "ownerA");

        Session._store[0].userId = "recoveredOwnerB";
        const second = await seedCaseStudies({ entries, collections: { Session, StudyShare }, now: NOW });

        assert.strictEqual(StudyShare._store[0].ownerUserId, "recoveredOwnerB");
        assert.strictEqual(second.updated, 1, "reported as refreshed rather than unchanged");
    });

    it("re-derives analysisIds so an analysis added later joins the example", async function () {
        const Session = makeColl([makeStudy()]);
        const StudyShare = makeColl([]);
        const entries = caseStudyEntries([entry()]);

        await seedCaseStudies({ entries, collections: { Session, StudyShare }, now: NOW });
        Session._store[0].analyses.push({ id: "a3", name: "GSE3" });

        await seedCaseStudies({ entries, collections: { Session, StudyShare }, now: NOW });

        assert.ok(StudyShare._store[0].analysisIds.includes("a3"));
    });

    // A share row pointing at nothing is a link that resolves and then fails. Better no row at all.
    it("skips a missing session without writing a share row", async function () {
        const Session = makeColl([]);
        const StudyShare = makeColl([]);

        const result = await seedCaseStudies({
            entries: caseStudyEntries([entry({ sessionId: "doesNotExist" })]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.seeded, 0);
        assert.strictEqual(StudyShare._store.length, 0, "no half-formed row");
    });

    // share.create rejects 'full' on a read-only source: a results-only import has no uploaded
    // inputs, so a full share promises what it cannot deliver. The seeder bypasses share.create, so
    // it must refuse the same combination rather than mint a state the app believes impossible.
    it("skips a read-only (view-only) source rather than promising a full share", async function () {
        const Session = makeColl([makeStudy({ readOnly: true })]);
        const StudyShare = makeColl([]);

        const result = await seedCaseStudies({
            entries: caseStudyEntries([entry()]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(StudyShare._store.length, 0);
    });

    it("skips a study with no shareable analyses", async function () {
        const Session = makeColl([makeStudy({ analyses: [], metaAnalyses: [] })]);
        const StudyShare = makeColl([]);

        const result = await seedCaseStudies({
            entries: caseStudyEntries([entry()]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(StudyShare._store.length, 0);
    });

    // One bad entry must not cost the good one its link.
    it("seeds the good entries even when a sibling entry is unusable", async function () {
        const Session = makeColl([
            makeStudy(),
            makeStudy({ _id: "sessCase2", name: "Second", userId: "ownerA" }),
        ]);
        const StudyShare = makeColl([]);

        const result = await seedCaseStudies({
            entries: caseStudyEntries([
                entry({ shareId: "missingOne", sessionId: "gone" }),
                entry({ shareId: "FjWunev8iSmLBYg8G", sessionId: "sessCase2", label: "Second" }),
            ]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(result.seeded, 1);
        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(StudyShare._store.length, 1);
        assert.strictEqual(StudyShare._store[0]._id, "FjWunev8iSmLBYg8G");
    });

    it("falls back to the study's own name when the settings entry has no label", async function () {
        const Session = makeColl([makeStudy()]);
        const StudyShare = makeColl([]);

        await seedCaseStudies({
            entries: caseStudyEntries([{ shareId: "noLabel", sessionId: "sessCase1" }]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.strictEqual(StudyShare._store[0].caseStudyLabel, "Colorectal cancer case study");
    });

    it("does nothing at all when no case studies are configured", async function () {
        const Session = makeColl([makeStudy()]);
        const StudyShare = makeColl([]);

        const result = await seedCaseStudies({
            // `null`, not `undefined` — see the note on the first caseStudyEntries test: undefined
            // would fall through to the real settings file instead of meaning "nothing configured".
            entries: caseStudyEntries(null),
            collections: { Session, StudyShare },
            now: NOW,
        });

        assert.deepStrictEqual(result, { seeded: 0, updated: 0, unchanged: 0, skipped: 0 });
        assert.strictEqual(StudyShare._store.length, 0);
        assert.ok(!("permanent" in Session._store[0]), "an unrelated study is not touched");
    });
});

// The permanence flag is for seeded case studies ONLY. A user-facing link must still be bounded, or
// "never expires" becomes expressible through the ordinary share modal.
describe("share.create cannot mint a never-expiring link", function () {
    it("still bounds every expiry to 1..90 days", function () {
        assert.strictEqual(isValidExpiryDays(MIN_EXPIRY_DAYS), true);
        assert.strictEqual(isValidExpiryDays(MAX_EXPIRY_DAYS), true);
        assert.strictEqual(isValidExpiryDays(MAX_EXPIRY_DAYS + 1), false);
        assert.strictEqual(isValidExpiryDays(0), false);
        assert.strictEqual(isValidExpiryDays(Infinity), false);
        assert.strictEqual(isValidExpiryDays(null), false);
    });

    // share.create inserts a fixed document literal with no neverExpires key, so a link it minted
    // carries only a bounded expiresAt. Reconstruct that exact shape and prove it still dies — the
    // property that would break if someone ever threaded a caller-supplied flag into the insert.
    it("a share of the shape share.create writes still expires", function () {
        const created = {
            _id: "abc",
            ownerUserId: "u1",
            sourceSessionId: "s1",
            mode: "full",
            analysisIds: ["a1"],
            createdAt: new Date(NOW.getTime()),
            expiresAt: expiryFromDays(MAX_EXPIRY_DAYS, NOW.getTime()),
            revokedAt: null,
            importCount: 0,
        };

        assert.strictEqual(shareStatus(created, NOW.getTime()), SHARE_STATUS.ACTIVE);
        // One millisecond past the longest expiry share.create can grant.
        const afterMax = NOW.getTime() + MAX_EXPIRY_DAYS * DAY_MS + 1;
        assert.strictEqual(shareStatus(created, afterMax), SHARE_STATUS.EXPIRED);
        assert.strictEqual(isShareUsable(created, afterMax), false);
    });

    // The seeded shape, by contrast, is the only one that survives — and the only difference is the
    // flag the seeder sets.
    it("only the seeder's extra flag makes a link permanent", async function () {
        const Session = makeColl([makeStudy()]);
        const StudyShare = makeColl([]);
        await seedCaseStudies({
            entries: caseStudyEntries([entry()]),
            collections: { Session, StudyShare },
            now: NOW,
        });

        const seeded = StudyShare._store[0];
        const centuryLater = NOW.getTime() + 100 * 365 * DAY_MS;
        assert.strictEqual(shareStatus(seeded, centuryLater), SHARE_STATUS.ACTIVE);
        assert.strictEqual(shareStatus({ ...seeded, neverExpires: undefined }, centuryLater), SHARE_STATUS.EXPIRED);
    });
});

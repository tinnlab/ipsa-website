import assert from "assert";
import {
    SHARE_STATUS,
    shareStatus,
    isShareUsable,
    isValidExpiryDays,
    expiryFromDays,
    formatExpiresIn,
    fullImportLostInputs,
    shareUrl,
    DAY_MS,
    MIN_EXPIRY_DAYS,
    MAX_EXPIRY_DAYS,
} from "../imports/utils/shareLink";
import {
    PRIOR_IMPORT_FIELDS,
    PRIOR_IMPORT_LIMIT,
    findPriorImports,
    priorImportRows,
} from "../server/helper/priorImports";

const NOW = new Date("2026-01-15T12:00:00Z").getTime();
const active = {expiresAt: new Date(NOW + 3 * DAY_MS)};
const YEAR_MS = 365 * DAY_MS;

describe("shareStatus", function () {
    it("is Active while the expiry is in the future", function () {
        assert.strictEqual(shareStatus(active, NOW), SHARE_STATUS.ACTIVE);
    });

    it("is Expired once the expiry has passed", function () {
        assert.strictEqual(shareStatus({expiresAt: new Date(NOW - 1)}, NOW), SHARE_STATUS.EXPIRED);
    });

    it("is Expired exactly at the boundary (expiry is not inclusive)", function () {
        assert.strictEqual(shareStatus({expiresAt: new Date(NOW)}, NOW), SHARE_STATUS.EXPIRED);
    });

    // Revocation is the owner's kill switch, so it must win over any expiry value — including one
    // in the future, and including a later "extend".
    it("is Revoked regardless of expiry once revoked", function () {
        assert.strictEqual(
            shareStatus({expiresAt: new Date(NOW + 10 * DAY_MS), revokedAt: new Date(NOW)}, NOW),
            SHARE_STATUS.REVOKED
        );
    });

    // Fail closed: a malformed or absent expiry must not read as "never expires".
    it("treats a missing or unparseable expiry as Expired, not eternal", function () {
        assert.strictEqual(shareStatus({}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(shareStatus({expiresAt: null}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(shareStatus({expiresAt: "nonsense"}, NOW), SHARE_STATUS.EXPIRED);
    });

    it("treats a missing share as Revoked", function () {
        assert.strictEqual(shareStatus(null, NOW), SHARE_STATUS.REVOKED);
        assert.strictEqual(shareStatus(undefined, NOW), SHARE_STATUS.REVOKED);
    });
});

// The seeded case studies are the ONLY shares that carry this flag; share.create cannot set it.
describe("shareStatus — neverExpires (permanent case-study links)", function () {
    it("is Active with no expiresAt at all", function () {
        assert.strictEqual(shareStatus({neverExpires: true}, NOW), SHARE_STATUS.ACTIVE);
        assert.strictEqual(shareStatus({neverExpires: true, expiresAt: null}, NOW), SHARE_STATUS.ACTIVE);
    });

    it("stays Active indefinitely", function () {
        const share = {neverExpires: true};
        assert.strictEqual(shareStatus(share, NOW + 100 * YEAR_MS), SHARE_STATUS.ACTIVE);
    });

    it("is Active even when a stale expiry has long passed", function () {
        assert.strictEqual(
            shareStatus({neverExpires: true, expiresAt: new Date(NOW - 10 * YEAR_MS)}, NOW),
            SHARE_STATUS.ACTIVE
        );
    });

    // Revocation is the kill switch and has to beat permanence too, or a case study could never be
    // taken down.
    it("is Revoked once revoked, permanence notwithstanding", function () {
        assert.strictEqual(
            shareStatus({neverExpires: true, revokedAt: new Date(NOW)}, NOW),
            SHARE_STATUS.REVOKED
        );
        assert.strictEqual(isShareUsable({neverExpires: true, revokedAt: new Date(NOW)}, NOW), false);
    });

    // Strict === true: a truthy value in a hand-edited document must not confer immortality, and a
    // falsey one must fall straight back through to the fail-closed rule.
    it("honours only a literal true", function () {
        assert.strictEqual(shareStatus({neverExpires: "yes"}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(shareStatus({neverExpires: 1}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(shareStatus({neverExpires: false}, NOW), SHARE_STATUS.EXPIRED);
    });

    // The flag must not disturb ordinary bounded links in either direction.
    it("leaves a normal share's bounded expiry untouched", function () {
        assert.strictEqual(shareStatus({...active, neverExpires: false}, NOW), SHARE_STATUS.ACTIVE);
        assert.strictEqual(
            shareStatus({expiresAt: new Date(NOW - 1), neverExpires: false}, NOW),
            SHARE_STATUS.EXPIRED
        );
    });

    it("is usable by the gate the import path uses", function () {
        assert.strictEqual(isShareUsable({neverExpires: true}, NOW + 100 * YEAR_MS), true);
    });
});

describe("isShareUsable (the gate the import path uses)", function () {
    it("accepts only an active share", function () {
        assert.strictEqual(isShareUsable(active, NOW), true);
        assert.strictEqual(isShareUsable({expiresAt: new Date(NOW - 1)}, NOW), false);
        assert.strictEqual(isShareUsable({...active, revokedAt: new Date(NOW)}, NOW), false);
        assert.strictEqual(isShareUsable(null, NOW), false);
        assert.strictEqual(isShareUsable({}, NOW), false);
    });
});

describe("isValidExpiryDays", function () {
    it("accepts whole days within the allowed range", function () {
        assert.strictEqual(isValidExpiryDays(MIN_EXPIRY_DAYS), true);
        assert.strictEqual(isValidExpiryDays(7), true);
        assert.strictEqual(isValidExpiryDays(MAX_EXPIRY_DAYS), true);
    });

    it("rejects out-of-range, fractional and non-numeric values", function () {
        assert.strictEqual(isValidExpiryDays(0), false);
        assert.strictEqual(isValidExpiryDays(-1), false);
        assert.strictEqual(isValidExpiryDays(MAX_EXPIRY_DAYS + 1), false);
        assert.strictEqual(isValidExpiryDays(1.5), false);
        assert.strictEqual(isValidExpiryDays("7"), false);
        assert.strictEqual(isValidExpiryDays(null), false);
        assert.strictEqual(isValidExpiryDays(undefined), false);
        assert.strictEqual(isValidExpiryDays(NaN), false);
        assert.strictEqual(isValidExpiryDays(Infinity), false);
    });
});

describe("expiryFromDays", function () {
    it("computes the expiry from the supplied clock, not the ambient one", function () {
        assert.strictEqual(expiryFromDays(2, NOW).getTime(), NOW + 2 * DAY_MS);
    });
});

describe("formatExpiresIn", function () {
    it("reports whole days when more than a day remains", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 3 * DAY_MS)}, NOW), "3 days");
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + DAY_MS)}, NOW), "1 day");
    });

    it("falls back to hours, then minutes", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 5 * 60 * 60 * 1000)}, NOW), "5 hours");
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 90 * 1000)}, NOW), "1 minute");
    });

    // Never round down to "0 minutes" for a link that is still usable.
    it("never reports zero for a share that is still active", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 1000)}, NOW), "1 minute");
    });

    it("reports the status itself when not active", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW - 1)}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(formatExpiresIn({...active, revokedAt: new Date(NOW)}, NOW), SHARE_STATUS.REVOKED);
    });

    // A permanent share is Active but has no expiresAt to subtract from: without its own branch
    // every unit below computes from NaN and the owner's list renders "NaN minutes".
    it("says Never for a permanent share rather than computing from a missing expiry", function () {
        assert.strictEqual(formatExpiresIn({neverExpires: true}, NOW), "Never");
        assert.strictEqual(formatExpiresIn({neverExpires: true, expiresAt: null}, NOW), "Never");
    });
});

describe("fullImportLostInputs (a full clone that copied no inputs)", function () {
    it("is true only for a full import that reported zero files", function () {
        assert.strictEqual(fullImportLostInputs("full", {files: 0}), true);
    });

    it("is false when files were copied", function () {
        assert.strictEqual(fullImportLostInputs("full", {files: 3}), false);
    });

    // A results-only import has no uploaded inputs BY DESIGN — that is not a loss to warn about.
    it("is false for a results-only import", function () {
        assert.strictEqual(fullImportLostInputs("results", {files: 0}), false);
    });

    // An absent count means "unknown", never "lost" — don't warn on missing data.
    it("is false when the count is absent or not a number", function () {
        assert.strictEqual(fullImportLostInputs("full", undefined), false);
        assert.strictEqual(fullImportLostInputs("full", {}), false);
        assert.strictEqual(fullImportLostInputs("full", {files: null}), false);
        assert.strictEqual(fullImportLostInputs(undefined, {files: 0}), false);
    });
});

describe("shareUrl", function () {
    it("builds the import link from origin and prefix", function () {
        assert.strictEqual(shareUrl("abc", "https://app.example.com"), "https://app.example.com/import/abc");
    });

    it("honours a deployment path prefix", function () {
        assert.strictEqual(shareUrl("abc", "https://x.io", "/cpa"), "https://x.io/cpa/import/abc");
    });

    it("tolerates an empty or missing prefix", function () {
        assert.strictEqual(shareUrl("abc", "https://x.io", ""), "https://x.io/import/abc");
        assert.strictEqual(shareUrl("abc", "https://x.io", undefined), "https://x.io/import/abc");
    });
});

// ---------------------------------------------------------------------------
// Prior imports: the caller's own earlier copies of a shared study, shown on the share-link landing
// page so a second import is understood as an ADDITIONAL copy rather than an update.
//
// The reason this is a server helper rather than a publication is that Session.importedFrom is
// deliberately withheld from every client publication (SESSION_PUBLIC_FIELDS,
// server/api/subscriptions/analysis.js): it records the DONOR's userId and sessionId. So the tests
// that matter most here are the two that pin the boundary — the selector is scoped to the caller,
// and the returned row carries no donor field.
// ---------------------------------------------------------------------------

const ME = "userMine00000000";
const SOMEONE_ELSE = "userOther0000000";
const DONOR_SESSION = "donorSess1234567";
const DONOR_OWNER = "donorUser1234567";

// The shape cloneStudy writes for an imported study (server/helper/cloneStudy.js:180-205), reduced
// to the fields PRIOR_IMPORT_FIELDS projects. importedFrom carries all three donor-side values so
// the leak assertions below have something real to catch.
const importedStudy = (overrides = {}) => ({
    _id: "sessImported001",
    userId: ME,
    name: "TCGA-LIHC hepatocellular carcinoma",
    status: "Active",
    expiredAt: new Date(NOW + 60 * DAY_MS),
    readOnly: false,
    importedFrom: {
        shareId: "shareAAAAAAAAAAAA",
        sourceSessionId: DONOR_SESSION,
        ownerUserId: DONOR_OWNER,
        mode: "full",
        importedAt: new Date(NOW - DAY_MS),
    },
    ...overrides,
});

const MATCH = {userId: ME, sourceSessionId: DONOR_SESSION};

// In-memory stand-in for DBCollections.Session, in the manner of tests/data-retention.tests.js.
// It records every find() so the SELECTOR and the PROJECTION can be asserted — the two things no
// amount of testing the pure builder can reach. Deliberately does NOT apply the selector: the rows
// it hands back are unfiltered, which is what makes the scoping assertions on priorImportRows real
// rather than circular.
const makeFakeSessions = (docs) => {
    const calls = [];
    return {
        find(selector, options) {
            calls.push({selector, options});
            return {
                fetchAsync: async () => docs.map((d) => ({...d})),
                countAsync: async () => docs.length,
            };
        },
        _calls: calls,
    };
};

describe("priorImportRows (which of the caller's studies came from this one)", function () {
    it("keeps the caller's own import of this study", function () {
        const rows = priorImportRows([importedStudy()], MATCH);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].studyId, "sessImported001");
        assert.strictEqual(rows[0].name, "TCGA-LIHC hepatocellular carcinoma");
        assert.strictEqual(rows[0].mode, "full");
    });

    // Listing other people's copies would disclose that they hold them — the privacy line the
    // importedFrom projection draws in the first place.
    it("excludes another user's import of the same study", function () {
        const rows = priorImportRows([importedStudy({userId: SOMEONE_ELSE})], MATCH);
        assert.deepStrictEqual(rows, []);
    });

    // The match key is the SOURCE STUDY, not the link. The owner asked for copies of "that original
    // study", and a study can be shared through more than one link.
    it("matches on the source study, so a copy made through a DIFFERENT link still counts", function () {
        const viaOtherLink = importedStudy({
            _id: "sessImported002",
            importedFrom: {...importedStudy().importedFrom, shareId: "shareBBBBBBBBBBBB"},
        });
        const rows = priorImportRows([viaOtherLink], MATCH);
        assert.strictEqual(rows.length, 1, "a second link to the same study is still the same study");
    });

    it("excludes a copy of a different study", function () {
        const other = importedStudy({
            importedFrom: {...importedStudy().importedFrom, sourceSessionId: "otherSess1234567"},
        });
        assert.deepStrictEqual(priorImportRows([other], MATCH), []);
    });

    // An ordinary study the user created has no importedFrom at all.
    it("excludes a study that was never imported", function () {
        const created = {_id: "sessOwn00000000", userId: ME, name: "My own study", status: "Active"};
        assert.deepStrictEqual(priorImportRows([created], MATCH), []);
    });

    it("returns the newest import first", function () {
        const older = importedStudy({
            _id: "sessOlder000000",
            importedFrom: {...importedStudy().importedFrom, importedAt: new Date(NOW - 10 * DAY_MS)},
        });
        const rows = priorImportRows([older, importedStudy()], MATCH);
        assert.deepStrictEqual(rows.map((r) => r.studyId), ["sessImported001", "sessOlder000000"]);
    });

    it("returns nothing when there are no prior imports", function () {
        assert.deepStrictEqual(priorImportRows([], MATCH), []);
    });

    // THE leak test. Asserting the exact key set (not merely that the donor fields are absent) is
    // what stops a future careless spread from widening the row silently.
    it("returns exactly the safe keys and no donor identity", function () {
        const [row] = priorImportRows([importedStudy()], MATCH);
        assert.deepStrictEqual(Object.keys(row).sort(), [
            "expiredAt",
            "importedAt",
            "mode",
            "name",
            "permanent",
            "readOnly",
            "status",
            "studyId",
        ]);
        assert.ok(!("sourceSessionId" in row), "the donor's session id must not reach the client");
        assert.ok(!("ownerUserId" in row), "the donor's user id must not reach the client");
        // Not donor identity, but it would reveal which OTHER link an earlier copy came through.
        assert.ok(!("shareId" in row), "the originating share id is not the client's business");
        assert.ok(!("importedFrom" in row), "the stamp itself never travels");
        assert.ok(!("userId" in row));
    });

    // share.preview has no try/catch above it, so a throw here is a 500 that makes a share link
    // permanently unopenable (see the note at share-selection.tests.js). Legacy and hand-edited
    // documents reach this function.
    it("never throws on malformed input", function () {
        assert.deepStrictEqual(priorImportRows(null, MATCH), []);
        assert.deepStrictEqual(priorImportRows(undefined, MATCH), []);
        assert.deepStrictEqual(priorImportRows("not an array", MATCH), []);
        assert.deepStrictEqual(priorImportRows([null, undefined], MATCH), []);
        assert.deepStrictEqual(priorImportRows([importedStudy({importedFrom: "a string"})], MATCH), []);
        assert.deepStrictEqual(priorImportRows([importedStudy({importedFrom: null})], MATCH), []);
        assert.deepStrictEqual(priorImportRows([{_id: "x", userId: ME}], MATCH), []);
        // Missing match arguments must not match everything.
        assert.deepStrictEqual(priorImportRows([importedStudy()], {}), []);
        assert.deepStrictEqual(priorImportRows([importedStudy()], undefined), []);
    });

    it("sorts an undated import last instead of poisoning the comparator", function () {
        const undated = importedStudy({
            _id: "sessUndated0000",
            importedFrom: {...importedStudy().importedFrom, importedAt: undefined},
        });
        const rows = priorImportRows([undated, importedStudy()], MATCH);
        assert.deepStrictEqual(rows.map((r) => r.studyId), ["sessImported001", "sessUndated0000"]);
    });
});

describe("findPriorImports (the query behind the landing page)", function () {
    it("scopes the selector to the caller AND to this source study", async function () {
        const Sessions = makeFakeSessions([importedStudy()]);
        await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        assert.deepStrictEqual(Sessions._calls[0].selector, {
            userId: ME,
            "importedFrom.sourceSessionId": DONOR_SESSION,
        });
    });

    // The projection names importedFrom's sub-fields one by one so the donor's ownerUserId never
    // leaves Mongo. `importedFrom: 1` would put it in server memory one spread away from the wire.
    it("never projects the donor's user id out of the database", function () {
        assert.ok(!("importedFrom" in PRIOR_IMPORT_FIELDS), "must not pull the whole stamp");
        assert.strictEqual(PRIOR_IMPORT_FIELDS["importedFrom.ownerUserId"], undefined);
        assert.deepStrictEqual(Object.keys(PRIOR_IMPORT_FIELDS).sort(), [
            "expiredAt",
            "importedFrom.importedAt",
            "importedFrom.mode",
            "importedFrom.sourceSessionId",
            "name",
            "permanent",
            "readOnly",
            "status",
            "userId",
        ]);
    });

    it("asks the database for the projection, newest first, capped", async function () {
        const Sessions = makeFakeSessions([importedStudy()]);
        await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        const {options} = Sessions._calls[0];
        assert.deepStrictEqual(options.fields, PRIOR_IMPORT_FIELDS);
        assert.deepStrictEqual(options.sort, {"importedFrom.importedAt": -1});
        assert.strictEqual(options.limit, PRIOR_IMPORT_LIMIT);
    });

    it("reports the true total even when the rows are capped", async function () {
        const many = Array.from({length: PRIOR_IMPORT_LIMIT + 5}, (_, i) =>
            importedStudy({_id: `sessImported${String(i).padStart(3, "0")}`})
        );
        const Sessions = makeFakeSessions(many);
        const {rows, total} = await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        assert.strictEqual(rows.length, PRIOR_IMPORT_LIMIT, "rows are capped");
        // The whole point: the page must be able to say it is not showing everything. Deriving the
        // total from rows.length would report the cap as the truth in exactly this case.
        assert.strictEqual(total, PRIOR_IMPORT_LIMIT + 5);
    });

    it("reports the total as the row count when under the cap", async function () {
        const Sessions = makeFakeSessions([importedStudy(), importedStudy({_id: "sessImported002"})]);
        const {rows, total} = await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(total, 2);
    });

    it("filters the caller's own rows even if the database hands back more", async function () {
        // The fake ignores the selector, standing in for any future selector mistake: the pure
        // re-check behind it still refuses another user's study.
        const Sessions = makeFakeSessions([importedStudy({userId: SOMEONE_ELSE})]);
        const {rows} = await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        assert.deepStrictEqual(rows, []);
    });

    it("answers empty rather than querying when it has nothing to match on", async function () {
        const Sessions = makeFakeSessions([importedStudy()]);
        assert.deepStrictEqual(await findPriorImports({Sessions, userId: ME}), {rows: [], total: 0});
        assert.deepStrictEqual(await findPriorImports({Sessions, sourceSessionId: DONOR_SESSION}), {rows: [], total: 0});
        assert.deepStrictEqual(await findPriorImports({userId: ME, sourceSessionId: DONOR_SESSION}), {rows: [], total: 0});
        assert.strictEqual(Sessions._calls.length, 0, "no pointless round trip");
    });
});

// The count is the second of two round trips on a page every visitor of a case-study link loads, so
// it is spent only when it can change the answer.
describe("findPriorImports — the count is only paid for when the cap was hit", function () {
    it("does not run a count query when the fetch came back under the cap", async function () {
        const Sessions = makeFakeSessions([importedStudy()]);
        const {total} = await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        assert.strictEqual(Sessions._calls.length, 1, "one query, not two");
        assert.strictEqual(total, 1, "a short fetch has already seen everything that matches");
    });

    it("runs the count only once the fetch filled the cap", async function () {
        const many = Array.from({length: PRIOR_IMPORT_LIMIT}, (_, i) =>
            importedStudy({_id: `sessImported${String(i).padStart(3, "0")}`})
        );
        const Sessions = makeFakeSessions(many);
        await findPriorImports({Sessions, userId: ME, sourceSessionId: DONOR_SESSION});
        assert.strictEqual(Sessions._calls.length, 2);
        assert.deepStrictEqual(Sessions._calls[1].selector, Sessions._calls[0].selector, "same selector");
        assert.strictEqual(Sessions._calls[1].options.limit, undefined, "the count must not be capped");
    });
});

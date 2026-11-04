import assert from "assert";
import { validateStudyName, canRenameStudy, MAX_STUDY_NAME_LENGTH } from "../imports/utils/studyName";
import { renameStudy } from "../server/helper/renameStudy";
import { NOT_AUTHORIZED, SESSION_NOT_FOUND } from "../imports/utils/ownership";

describe("validateStudyName (rename study)", function () {
    it("accepts a valid name and returns the trimmed value", function () {
        assert.deepStrictEqual(validateStudyName("  My Study  "), { ok: true, value: "My Study" });
    });

    it("rejects non-string input", function () {
        assert.strictEqual(validateStudyName(null).ok, false);
        assert.strictEqual(validateStudyName(undefined).ok, false);
        assert.strictEqual(validateStudyName(42).ok, false);
        assert.strictEqual(validateStudyName({}).ok, false);
        assert.strictEqual(validateStudyName({ $ne: null }).ok, false);
    });

    it("rejects empty or whitespace-only names", function () {
        assert.strictEqual(validateStudyName("").ok, false);
        assert.strictEqual(validateStudyName("   ").ok, false);
        assert.strictEqual(validateStudyName("\t\n ").ok, false);
    });

    it("rejects names over the maximum length", function () {
        assert.strictEqual(validateStudyName("x".repeat(MAX_STUDY_NAME_LENGTH + 1)).ok, false);
    });

    it("accepts a name exactly at the maximum length", function () {
        const exact = "x".repeat(MAX_STUDY_NAME_LENGTH);
        assert.deepStrictEqual(validateStudyName(exact), { ok: true, value: exact });
    });

    // The length limit is on the STORED value, so surrounding whitespace must not push an
    // otherwise-legal name over the edge.
    it("measures length after trimming", function () {
        const padded = `  ${"x".repeat(MAX_STUDY_NAME_LENGTH)}  `;
        const result = validateStudyName(padded);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.value.length, MAX_STUDY_NAME_LENGTH);
    });

    it("includes a human-readable error message on failure", function () {
        const result = validateStudyName("");
        assert.strictEqual(result.ok, false);
        assert.strictEqual(typeof result.error, "string");
        assert.ok(result.error.length > 0);
    });
});

// renameStudy is the whole server side of the feature: the writability guard, the validation, and
// the single-field write. Exercised end-to-end against an in-memory Session collection (same shape
// as the fakes in data-retention.tests.js) so the guard is proven, not assumed.
describe("renameStudy (guard + persist)", function () {
    // In-memory Session collection, in the style of makeColl in data-retention.tests.js but
    // deliberately UNFORGIVING in two places, so a test cannot pass for the wrong reason:
    //
    //  - a non-primitive selector value THROWS instead of quietly matching nothing. Real Mongo
    //    reads {$ne: null} as an operator and would match; a fake that just compares with === would
    //    make the injection test pass even if isValidId were deleted from the guard.
    //  - every modifier operator is applied, not only $set. A fake that ignores $unset/$rename
    //    would let a widened write ("$set name, $unset analyses") sail through the test whose whole
    //    job is to prove the write is narrow.
    const makeSessions = (docs = []) => {
        const store = docs.map((d) => ({ ...d }));
        const matches = (d, sel) => Object.entries(sel || {}).every(([k, v]) => {
            if (v !== null && typeof v === "object") {
                throw new Error(`fake collection: selector value for '${k}' reached Mongo as an operator`);
            }
            return d[k] === v;
        });
        const apply = (d, modifier) => {
            const ops = Object.keys(modifier || {}).filter((k) => k.startsWith("$"));
            if (ops.length === 0) throw new Error("fake collection: whole-document replacement");
            for (const op of ops) {
                if (op === "$set") Object.assign(d, modifier.$set);
                else if (op === "$unset") for (const k of Object.keys(modifier.$unset)) delete d[k];
                else throw new Error(`fake collection: unsupported modifier ${op}`);
            }
        };
        return {
            _store: store,
            async findOneAsync(sel = {}) {
                const d = store.find((x) => matches(x, sel));
                return d ? { ...d } : undefined;
            },
            async updateAsync(sel = {}, modifier = {}) {
                let n = 0;
                for (const d of store) {
                    if (matches(d, sel)) { apply(d, modifier); n += 1; }
                }
                return n;
            },
        };
    };

    const owned = () => ({ _id: "s1", userId: "u1", name: "Old name", analyses: [{ id: "a1" }] });

    const rejects = async (fn, code) => {
        try {
            await fn();
        } catch (error) {
            assert.strictEqual(error.error, code, `expected error code ${code}, got ${error.error}`);
            return error;
        }
        assert.fail(`expected a ${code} error, but the call resolved`);
    };

    it("persists a rename for the owner", async function () {
        const Session = makeSessions([owned()]);
        const value = await renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "New name", collections: { Session },
        });

        assert.strictEqual(value, "New name");
        assert.strictEqual(Session._store[0].name, "New name");
    });

    it("trims the stored name", async function () {
        const Session = makeSessions([owned()]);
        const value = await renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "   Padded name \t", collections: { Session },
        });

        assert.strictEqual(value, "Padded name");
        assert.strictEqual(Session._store[0].name, "Padded name");
    });

    it("writes name and nothing else — it is not a general-purpose Session updater", async function () {
        const Session = makeSessions([{ ...owned(), userId: "u1", status: "Active", editable: true }]);
        await renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "Renamed", collections: { Session },
        });

        assert.deepStrictEqual(Session._store[0], {
            _id: "s1",
            userId: "u1",
            name: "Renamed",
            analyses: [{ id: "a1" }],
            status: "Active",
            editable: true,
        });
    });

    it("rejects an empty or whitespace-only name and leaves the study untouched", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "", collections: { Session },
        }), "invalid-name");
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "   ", collections: { Session },
        }), "invalid-name");

        assert.strictEqual(Session._store[0].name, "Old name");
    });

    it("rejects a name over the maximum length", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: "s1",
            requesterUserId: "u1",
            name: "x".repeat(MAX_STUDY_NAME_LENGTH + 1),
            collections: { Session },
        }), "invalid-name");

        assert.strictEqual(Session._store[0].name, "Old name");
    });

    it("refuses a caller who does not own the study", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u2", name: "Stolen", collections: { Session },
        }), NOT_AUTHORIZED);

        assert.strictEqual(Session._store[0].name, "Old name");
    });

    it("refuses a logged-out caller", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: null, name: "Anonymous", collections: { Session },
        }), NOT_AUTHORIZED);

        assert.strictEqual(Session._store[0].name, "Old name");
    });

    // The recipient of a "results only" share DOES own the imported row, so ownership alone would
    // let the rename through — assertWritableSession is what stops it.
    it("refuses a view-only imported study even though the caller owns it", async function () {
        const Session = makeSessions([{ ...owned(), readOnly: true, editable: false }]);
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "Renaming a view-only import", collections: { Session },
        }), "read-only-study");

        assert.strictEqual(Session._store[0].name, "Old name");
    });

    it("reports a missing study as not found", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: "nope", requesterUserId: "u1", name: "Ghost", collections: { Session },
        }), SESSION_NOT_FOUND);
    });

    // Ids arrive as EJSON, so an object can be sent where a string is expected. isValidId inside the
    // guard must stop it before it reaches a selector as a query operator.
    it("refuses an operator object in place of a sessionId", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: { $ne: null }, requesterUserId: "u1", name: "Injected", collections: { Session },
        }), SESSION_NOT_FOUND);

        assert.strictEqual(Session._store[0].name, "Old name");
    });

    // Duplicate names are allowed: nothing in the live app looks a study up by name (studies are
    // addressed by _id, and workspace recovery keys on workspaceName + email + password), so two
    // studies sharing a title is a display matter, not a correctness one.
    it("allows a name that another study already uses", async function () {
        const Session = makeSessions([
            owned(),
            { _id: "s2", userId: "u1", name: "Taken", analyses: [] },
        ]);
        const value = await renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "Taken", collections: { Session },
        });

        assert.strictEqual(value, "Taken");
        assert.deepStrictEqual(Session._store.map((d) => d.name), ["Taken", "Taken"]);
    });

    // The guard must run BEFORE the payload is looked at, so a caller who may not touch this study
    // is never handed a verdict on their input. Without the ordering these two would report
    // 'invalid-name' — telling a stranger their proposed name was too long for someone else's study.
    it("authorizes before validating: a non-owner with a bad name still gets not-authorized", async function () {
        const Session = makeSessions([owned()]);
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u2", name: "   ", collections: { Session },
        }), NOT_AUTHORIZED);
    });

    it("authorizes before validating: a view-only study with a bad name still gets read-only-study", async function () {
        const Session = makeSessions([{ ...owned(), readOnly: true }]);
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "x".repeat(MAX_STUDY_NAME_LENGTH + 1), collections: { Session },
        }), "read-only-study");
    });

    // The UI renders error.reason, so every rejection has to carry readable prose.
    it("carries a human-readable reason on every rejection", async function () {
        const Session = makeSessions([owned()]);
        for (const [args, code] of [
            [{ sessionId: "s1", requesterUserId: "u1", name: "  " }, "invalid-name"],
            [{ sessionId: "s1", requesterUserId: "u2", name: "Nope" }, NOT_AUTHORIZED],
            [{ sessionId: "gone", requesterUserId: "u1", name: "Nope" }, SESSION_NOT_FOUND],
        ]) {
            const error = await rejects(() => renameStudy({ ...args, collections: { Session } }), code);
            assert.strictEqual(typeof error.reason, "string");
            assert.ok(error.reason.length > 0, `empty reason for ${code}`);
        }
    });

    // The guard read the study a moment ago. If the expiry sweep deletes it in the gap, the write
    // matches nothing — and returning the new name would have the UI announce a rename that never
    // happened.
    it("reports not-found when the study disappears between the guard and the write", async function () {
        const Session = makeSessions([owned()]);
        const realUpdate = Session.updateAsync.bind(Session);
        Session.findOneAsync = async () => ({ ...owned() }); // guard still sees it...
        Session.updateAsync = async (...args) => { Session._store.length = 0; return realUpdate(...args); };

        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "Ghost rename", collections: { Session },
        }), SESSION_NOT_FOUND);
    });

    it("refuses when no collections are available", async function () {
        await rejects(() => renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "Nowhere", collections: null,
        }), "collections-unavailable");
    });

    // Renaming one study must not touch a sibling — the selector is _id-scoped.
    it("renames only the target study", async function () {
        const Session = makeSessions([
            owned(),
            { _id: "s2", userId: "u1", name: "Sibling", analyses: [] },
        ]);
        await renameStudy({
            sessionId: "s1", requesterUserId: "u1", name: "Only me", collections: { Session },
        });

        assert.deepStrictEqual(Session._store.map((d) => d.name), ["Only me", "Sibling"]);
    });
});

// The rule deciding whether the study page OFFERS the rename control. Extracted from the JSX so it
// can be asserted directly, the way the repo's other display predicates are.
describe("canRenameStudy (when the study page offers the control)", function () {
    const FUTURE = new Date("2030-01-01T00:00:00Z");
    const PAST = new Date("2020-01-01T00:00:00Z");
    const NOW = new Date("2026-01-01T00:00:00Z").getTime();

    it("offers rename on a writable, unexpired study", function () {
        assert.strictEqual(canRenameStudy({ expiredAt: FUTURE }, NOW), true);
        assert.strictEqual(canRenameStudy({ expiredAt: FUTURE, readOnly: false }, NOW), true);
    });

    it("withholds rename on a view-only imported study", function () {
        assert.strictEqual(canRenameStudy({ expiredAt: FUTURE, readOnly: true }, NOW), false);
    });

    it("withholds rename on an expired study", function () {
        assert.strictEqual(canRenameStudy({ expiredAt: PAST }, NOW), false);
    });

    it("withholds rename when there is no study yet", function () {
        assert.strictEqual(canRenameStudy(undefined, NOW), false);
        assert.strictEqual(canRenameStudy(null, NOW), false);
    });

    // readOnly is the canonical flag and it is a BOOLEAN — matching isReadOnlySession on the server
    // and isReadOnlyStudy on the client, both of which reject truthy non-true values.
    it("treats only readOnly === true as view-only", function () {
        assert.strictEqual(canRenameStudy({ expiredAt: FUTURE, readOnly: "yes" }, NOW), true);
        assert.strictEqual(canRenameStudy({ expiredAt: FUTURE, readOnly: 1 }, NOW), true);
    });

    // A legacy or malformed doc with no usable expiry is never treated as expired — the same rule
    // isSessionExpired applies for the sweep, so the control stays available rather than vanishing.
    it("does not treat a missing or unparseable expiry as expired", function () {
        assert.strictEqual(canRenameStudy({}, NOW), true);
        assert.strictEqual(canRenameStudy({ expiredAt: null }, NOW), true);
        assert.strictEqual(canRenameStudy({ expiredAt: "not a date" }, NOW), true);
    });
});

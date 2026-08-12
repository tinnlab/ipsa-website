import assert from "assert";
import {
    isOwnedBy,
    isValidId,
    isValidIdArray,
    analysisOwnerSelector,
    collectAnalysisIds,
    sessionOwnsAllAnalyses,
    isStudyAccessError,
    NOT_AUTHORIZED,
    SESSION_NOT_FOUND,
} from "../imports/utils/ownership";
import {Meteor} from "meteor/meteor";

// Ids arrive from clients as EJSON, so an object can be sent where a string is expected. Left
// unchecked it reaches Mongo as a query operator: {$in: ["mine", "theirs"]} can satisfy the
// ownership lookup through the caller's own study and then widen the data query behind it.
describe("isValidId (block Mongo operator injection through ids)", function () {
    it("accepts a non-empty string", function () {
        assert.strictEqual(isValidId("abc123"), true);
    });

    it("rejects operator objects — the injection vector", function () {
        assert.strictEqual(isValidId({$ne: null}), false);
        assert.strictEqual(isValidId({$in: ["mine", "theirs"]}), false);
        assert.strictEqual(isValidId({$gt: ""}), false);
        assert.strictEqual(isValidId({$regex: ".*"}), false);
    });

    it("rejects arrays, empty strings and every non-string blank", function () {
        assert.strictEqual(isValidId([]), false);
        assert.strictEqual(isValidId(["a"]), false);
        assert.strictEqual(isValidId(""), false);
        assert.strictEqual(isValidId(null), false);
        assert.strictEqual(isValidId(undefined), false);
        assert.strictEqual(isValidId(0), false);
        assert.strictEqual(isValidId(1), false);
        assert.strictEqual(isValidId(true), false);
    });
});

describe("isValidIdArray (databaseIds reaches a $in selector)", function () {
    it("accepts an array of non-empty strings", function () {
        assert.strictEqual(isValidIdArray(["a", "b"]), true);
        assert.strictEqual(isValidIdArray([]), true); // empty $in is harmless: matches nothing
    });

    it("rejects an array containing an operator object or a blank", function () {
        assert.strictEqual(isValidIdArray(["a", {$ne: null}]), false);
        assert.strictEqual(isValidIdArray(["a", ""]), false);
        assert.strictEqual(isValidIdArray(["a", null]), false);
    });

    it("rejects non-arrays", function () {
        assert.strictEqual(isValidIdArray("a"), false);
        assert.strictEqual(isValidIdArray({$ne: null}), false);
        assert.strictEqual(isValidIdArray(undefined), false);
    });
});

describe("isOwnedBy (a study belongs to exactly one account)", function () {
    it("accepts the owner", function () {
        assert.strictEqual(isOwnedBy({userId: "u1"}, "u1"), true);
    });

    it("rejects a different user", function () {
        assert.strictEqual(isOwnedBy({userId: "u1"}, "u2"), false);
    });

    it("rejects a missing session", function () {
        assert.strictEqual(isOwnedBy(null, "u1"), false);
        assert.strictEqual(isOwnedBy(undefined, "u1"), false);
    });

    // A logged-out caller has userId null/undefined. A legacy session row missing userId must not
    // become "owned by nobody, therefore owned by everybody" — both sides have to be present.
    it("rejects when either side is missing", function () {
        assert.strictEqual(isOwnedBy({userId: "u1"}, null), false);
        assert.strictEqual(isOwnedBy({userId: "u1"}, undefined), false);
        assert.strictEqual(isOwnedBy({}, "u1"), false);
        assert.strictEqual(isOwnedBy({userId: undefined}, undefined), false);
        assert.strictEqual(isOwnedBy({userId: null}, null), false);
    });
});

describe("analysisOwnerSelector (reverse lookup analysisId -> owning study)", function () {
    it("searches both the analyses and metaAnalyses arrays", function () {
        const selector = analysisOwnerSelector("a1");
        assert.deepStrictEqual(selector, {
            $or: [{"analyses.id": "a1"}, {"metaAnalyses.id": "a1"}],
        });
    });

    // Meta-analysis ids are real analysisIds: they key AnalysisResult rows (inputType 'meta') and
    // AnalysisConfigSnapshot rows (inputType 'metaDE'). Searching only analyses[] would leave every
    // meta-analysis result reachable without an ownership check.
    it("does not omit metaAnalyses", function () {
        const selector = analysisOwnerSelector("m1");
        assert.ok(selector.$or.some((clause) => "metaAnalyses.id" in clause));
    });
});

describe("collectAnalysisIds", function () {
    it("collects ids from both arrays", function () {
        const session = {
            analyses: [{id: "a1"}, {id: "a2"}],
            metaAnalyses: [{id: "m1"}],
        };
        assert.deepStrictEqual(collectAnalysisIds(session).sort(), ["a1", "a2", "m1"]);
    });

    it("tolerates missing arrays and malformed entries", function () {
        assert.deepStrictEqual(collectAnalysisIds({}), []);
        assert.deepStrictEqual(collectAnalysisIds(null), []);
        assert.deepStrictEqual(
            collectAnalysisIds({analyses: [null, {}, {id: "a1"}], metaAnalyses: undefined}),
            ["a1"]
        );
    });

    it("de-duplicates", function () {
        const session = {analyses: [{id: "a1"}, {id: "a1"}], metaAnalyses: [{id: "a1"}]};
        assert.deepStrictEqual(collectAnalysisIds(session), ["a1"]);
    });
});

describe("sessionOwnsAllAnalyses (a share selection must be covered by one study)", function () {
    const session = {analyses: [{id: "a1"}, {id: "a2"}], metaAnalyses: [{id: "m1"}]};

    it("accepts a subset", function () {
        assert.strictEqual(sessionOwnsAllAnalyses(session, ["a1"]), true);
        assert.strictEqual(sessionOwnsAllAnalyses(session, ["a1", "a2", "m1"]), true);
    });

    it("rejects when any id is foreign", function () {
        assert.strictEqual(sessionOwnsAllAnalyses(session, ["a1", "other"]), false);
        assert.strictEqual(sessionOwnsAllAnalyses(session, ["other"]), false);
    });

    it("rejects empty or malformed input rather than vacuously passing", function () {
        assert.strictEqual(sessionOwnsAllAnalyses(session, []), false);
        assert.strictEqual(sessionOwnsAllAnalyses(session, null), false);
        assert.strictEqual(sessionOwnsAllAnalyses(null, ["a1"]), false);
    });
});

// The client cannot tell a denied study from a loading one by looking at its collections — the
// publications answer a non-owner with this.ready() and no docs — so the study pages key their
// permission-denied view off a rejected method carrying one of these codes.
describe("isStudyAccessError (the only signal a denied study gives the client)", function () {
    it("recognises both guard codes, so one UI state covers not-found and not-yours alike", function () {
        assert.strictEqual(isStudyAccessError(new Meteor.Error(NOT_AUTHORIZED, "You must be logged in.")), true);
        assert.strictEqual(isStudyAccessError(new Meteor.Error(NOT_AUTHORIZED, "You can only access your own studies.")), true);
        assert.strictEqual(isStudyAccessError(new Meteor.Error(SESSION_NOT_FOUND, "Study not found")), true);
    });

    it("does NOT evict an owner on an unrelated failure", function () {
        assert.strictEqual(isStudyAccessError(new Meteor.Error("read-only-study", "…")), false);
        assert.strictEqual(isStudyAccessError(new Meteor.Error("collections-unavailable", "…")), false);
        assert.strictEqual(isStudyAccessError(new Meteor.Error(500, "Internal server error")), false);
        assert.strictEqual(isStudyAccessError(new Error("network down")), false);
        assert.strictEqual(isStudyAccessError(undefined), false);
        assert.strictEqual(isStudyAccessError(null), false);
    });

    it("keeps the codes in step with the strings the server guards actually throw", function () {
        assert.strictEqual(NOT_AUTHORIZED, "not-authorized");
        assert.strictEqual(SESSION_NOT_FOUND, "session-not-found");
    });
});

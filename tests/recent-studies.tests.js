// "My recent studies": the homepage button's count and the page it opens read ONE selector, so the
// number and the rows behind it cannot drift apart.
import assert from "assert";
import { recentStudiesSelector, RECENT_STUDIES_SORT } from "../imports/utils/recentStudies";

describe("recentStudiesSelector", function () {
    it("scopes to the owner, and to nothing else", function () {
        // Ownership is the whole predicate: the list shows expired studies too, marked "Expired"
        // with their actions disabled, and there is no soft-delete field to consider.
        assert.deepStrictEqual(recentStudiesSelector("2j2W5fTpqF2FvyGnx"), { userId: "2j2W5fTpqF2FvyGnx" });
    });

    // null, not {}: an empty selector matches every study on the platform, so a caller that lost
    // its user id must count nothing rather than everything.
    it("is null — never an empty selector — without a usable user id", function () {
        assert.strictEqual(recentStudiesSelector(""), null);
        assert.strictEqual(recentStudiesSelector(null), null);
        assert.strictEqual(recentStudiesSelector(undefined), null);
        assert.strictEqual(recentStudiesSelector({ userId: "sneaky" }), null);
        assert.strictEqual(recentStudiesSelector(42), null);
    });

    it("sorts newest first, as the list is fetched", function () {
        assert.deepStrictEqual(RECENT_STUDIES_SORT, { createdAt: -1 });
    });
});

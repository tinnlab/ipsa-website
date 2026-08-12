import assert from "assert";
import { capTags, moreTagLabel, MAX_VISIBLE_TAGS } from "../imports/utils/tagDisplay";

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe("tagDisplay", function () {
    describe("capTags", function () {
        it("MAX_VISIBLE_TAGS is 10", function () {
            assert.strictEqual(MAX_VISIBLE_TAGS, 10);
        });

        it("shows all items and no extras when count <= max", function () {
            const { visible, extraCount } = capTags(range(7));
            assert.strictEqual(visible.length, 7);
            assert.strictEqual(extraCount, 0);
        });

        it("shows exactly max and no extras at the boundary (10)", function () {
            const { visible, extraCount } = capTags(range(10));
            assert.strictEqual(visible.length, 10);
            assert.strictEqual(extraCount, 0);
        });

        it("caps at 10 and reports the remainder when count > max", function () {
            const { visible, extraCount } = capTags(range(23));
            assert.strictEqual(visible.length, 10);
            assert.strictEqual(extraCount, 13);
            assert.deepStrictEqual(visible, range(10)); // keeps the first 10, in order
        });

        it("honors a custom max", function () {
            const { visible, extraCount } = capTags(range(8), 3);
            assert.strictEqual(visible.length, 3);
            assert.strictEqual(extraCount, 5);
        });

        it("handles empty and null input", function () {
            assert.deepStrictEqual(capTags([]), { visible: [], extraCount: 0 });
            assert.deepStrictEqual(capTags(null), { visible: [], extraCount: 0 });
        });

        it("does not mutate the input array", function () {
            const src = range(15);
            capTags(src);
            assert.strictEqual(src.length, 15);
        });

        it("max of 0 shows nothing and reports all as extra", function () {
            assert.deepStrictEqual(capTags(range(3), 0), { visible: [], extraCount: 3 });
        });

        it("falls back to the default cap for a negative, NaN, or non-finite max", function () {
            assert.strictEqual(capTags(range(12), -1).visible.length, MAX_VISIBLE_TAGS);
            assert.strictEqual(capTags(range(12), NaN).visible.length, MAX_VISIBLE_TAGS);
            assert.strictEqual(capTags(range(12), Infinity).visible.length, MAX_VISIBLE_TAGS);
        });
    });

    describe("moreTagLabel", function () {
        it("builds a '+N more <noun>' label", function () {
            assert.strictEqual(moreTagLabel(13, "genes"), "+13 more genes");
            assert.strictEqual(moreTagLabel(1, "pathways"), "+1 more pathways");
        });

        it("does not special-case a 0 count (suppression is the renderer's job)", function () {
            assert.strictEqual(moreTagLabel(0, "genes"), "+0 more genes");
        });
    });
});

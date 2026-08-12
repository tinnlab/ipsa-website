import assert from "assert";
import { validateInsightName, MAX_INSIGHT_NAME_LENGTH } from "../imports/utils/insightName";

describe("validateInsightName (rename report)", function () {
    it("accepts a valid name and returns the trimmed value", function () {
        assert.deepStrictEqual(validateInsightName("  My Report  "), { ok: true, value: "My Report" });
    });

    it("rejects non-string input", function () {
        assert.strictEqual(validateInsightName(null).ok, false);
        assert.strictEqual(validateInsightName(undefined).ok, false);
        assert.strictEqual(validateInsightName(42).ok, false);
        assert.strictEqual(validateInsightName({}).ok, false);
    });

    it("rejects empty or whitespace-only names", function () {
        assert.strictEqual(validateInsightName("").ok, false);
        assert.strictEqual(validateInsightName("   ").ok, false);
    });

    it("rejects names over the maximum length", function () {
        const tooLong = "x".repeat(MAX_INSIGHT_NAME_LENGTH + 1);
        assert.strictEqual(validateInsightName(tooLong).ok, false);
    });

    it("accepts a name exactly at the maximum length", function () {
        const exact = "x".repeat(MAX_INSIGHT_NAME_LENGTH);
        const result = validateInsightName(exact);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.value, exact);
    });

    it("includes a human-readable error message on failure", function () {
        const result = validateInsightName("");
        assert.strictEqual(result.ok, false);
        assert.strictEqual(typeof result.error, "string");
        assert.ok(result.error.length > 0);
    });
});

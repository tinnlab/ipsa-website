import assert from "assert";
import { mergePendingUpdateData } from "../imports/utils/pendingUpdateUtils";

describe("mergePendingUpdateData (debounced updateAnalysis accumulator)", function () {
    it("returns the new fields flat when there is no pending entry", function () {
        assert.deepStrictEqual(
            mergePendingUpdateData(undefined, { expressionFile: "a.csv" }),
            { expressionFile: "a.csv" }
        );
    });

    it("accumulates fields across two calls WITHOUT nesting (regression)", function () {
        // 1st call: updateAnalysis({ expressionFile }) -> stored as { inputType, data:{...} }
        const afterFirst = { inputType: "expression", data: mergePendingUpdateData(undefined, { expressionFile: "a.csv" }) };
        // 2nd call within the same debounce window: updateAnalysis({ groupFile })
        const merged = mergePendingUpdateData(afterFirst, { groupFile: "b.csv" });

        // Both keys must remain TOP-LEVEL; no leaked `inputType`/`data` keys.
        assert.deepStrictEqual(merged, { expressionFile: "a.csv", groupFile: "b.csv" });
        assert.strictEqual(merged.data, undefined, "must not nest prior payload under a `data` key");
        assert.strictEqual(merged.inputType, undefined, "must not leak an `inputType` key into data");
    });

    it("later fields override earlier ones for the same key", function () {
        const prev = { inputType: "ora", data: { taxId: "9606" } };
        assert.deepStrictEqual(
            mergePendingUpdateData(prev, { taxId: "10090" }),
            { taxId: "10090" }
        );
    });
});

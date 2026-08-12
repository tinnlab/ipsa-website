import assert from "assert";
import {
    makeNumericSorter,
    pickDefaultSortMethod,
} from "../imports/utils/resultTableSorters";

describe("result-table sorters", function () {
    describe("makeNumericSorter", function () {
        it("sorts numeric values ascending", function () {
            const cmp = makeNumericSorter("p");
            assert.ok(cmp({ p: 0.001 }, { p: 0.05 }) < 0);
            assert.ok(cmp({ p: 0.05 }, { p: 0.001 }) > 0);
            assert.strictEqual(cmp({ p: 0.01 }, { p: 0.01 }), 0);
        });

        it("treats null / undefined / '' as `missing` so they sort last on ascending", function () {
            const cmp = makeNumericSorter("p"); // default missing = 1
            // a missing value should compare as greater than a real p-value
            assert.ok(cmp({ p: null }, { p: 0.5 }) > 0);
            assert.ok(cmp({ p: undefined }, { p: 0.5 }) > 0);
            assert.ok(cmp({ p: "" }, { p: 0.5 }) > 0);
            // a real value sorts before a missing one
            assert.ok(cmp({ p: 0.5 }, { p: null }) < 0);
        });

        it("treats two missing values as equal", function () {
            const cmp = makeNumericSorter("p");
            assert.strictEqual(cmp({ p: null }, { p: "" }), 0);
            assert.strictEqual(cmp({ p: undefined }, { p: null }), 0);
        });

        it("supports the Score case where missing coerces to 0", function () {
            const cmp = makeNumericSorter("score", { missing: 0 });
            // missing -> 0, so it sorts below a positive score and above a negative one
            assert.ok(cmp({ score: null }, { score: 2 }) < 0);
            assert.ok(cmp({ score: null }, { score: -2 }) > 0);
            assert.strictEqual(cmp({ score: "" }, { score: 0 }), 0);
        });

        it("coerces string-numeric values (the render layer stores some as strings)", function () {
            const cmp = makeNumericSorter("p");
            assert.ok(cmp({ p: "0.01" }, { p: "0.05" }) < 0);
            assert.ok(cmp({ p: "0.5" }, { p: 0.1 }) > 0);
            const rows = [{ p: "0.2" }, { p: "0.001" }, { p: "0.05" }];
            assert.deepStrictEqual(
                [...rows].sort(cmp).map(r => r.p),
                ["0.001", "0.05", "0.2"]
            );
        });

        it("is a pure ascending comparator (antd reverses it for the descend direction)", function () {
            // The comparator only ever produces the ascending delta; antd negates it
            // for 'descend'. A consequence of the missing->1 sentinel is that on descend
            // missing values surface first — documented here so it is intentional.
            const cmp = makeNumericSorter("p");
            assert.strictEqual(cmp({ p: 0.1 }, { p: 0.2 }), -cmp({ p: 0.2 }, { p: 0.1 }));
            // a real p-value of exactly 1 is indistinguishable from a missing value
            assert.strictEqual(cmp({ p: 1 }, { p: null }), 0);
        });

        it("orders a representative array, pushing missing FDR values to the bottom", function () {
            const rows = [
                { pathway: "a", fdr: 0.2 },
                { pathway: "b", fdr: null },
                { pathway: "c", fdr: 0.001 },
                { pathway: "d", fdr: "" },
                { pathway: "e", fdr: 0.05 },
            ];
            const sorted = [...rows].sort(makeNumericSorter("fdr"));
            assert.deepStrictEqual(
                sorted.map(r => r.pathway),
                ["c", "e", "a", "b", "d"]
            );
        });
    });

    describe("pickDefaultSortMethod", function () {
        it("returns 'consensus' when present, regardless of position", function () {
            assert.strictEqual(
                pickDefaultSortMethod(["fgsea", "consensus", "ora"]),
                "consensus"
            );
            assert.strictEqual(
                pickDefaultSortMethod(["consensus", "fgsea"]),
                "consensus"
            );
        });

        it("returns the first method when there is no consensus", function () {
            assert.strictEqual(pickDefaultSortMethod(["fgsea", "ora"]), "fgsea");
            assert.strictEqual(pickDefaultSortMethod(["ora"]), "ora");
        });

        it("returns null for an empty or missing list", function () {
            assert.strictEqual(pickDefaultSortMethod([]), null);
            assert.strictEqual(pickDefaultSortMethod(), null);
        });
    });
});

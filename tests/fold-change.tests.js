import assert from "assert";
import { normalizeMetaFoldChange } from "../imports/utils/foldChange";

// Meta rows carry a LINEAR FC (2^logFC) plus the log2 value in logFC.
const meta = (logFC) => ({ id: `g${logFC}`, logFC, FC: Math.pow(2, logFC), pValueFDR: 0.01 });

describe("foldChange.normalizeMetaFoldChange", function () {
    it("sets FC to the exact stored log2 value (logFC) for meta rows", function () {
        const out = normalizeMetaFoldChange([meta(1), meta(-2), meta(0)]);
        assert.deepStrictEqual(out.map(g => g.FC), [1, -2, 0]);
    });

    it("recovers log2 from the linear FC when logFC is missing", function () {
        // 2^logFC round-trips: log2(4)=2, log2(0.5)=-1, log2(1)=0
        const rows = [
            { id: "a", FC: 4 },
            { id: "b", FC: 0.5 },
            { id: "c", FC: 1 },
        ];
        assert.deepStrictEqual(normalizeMetaFoldChange(rows).map(g => g.FC), [2, -1, 0]);
    });

    it("prefers logFC over deriving from FC (no double work / drift)", function () {
        // If logFC is present it is used verbatim, even if FC disagrees.
        const out = normalizeMetaFoldChange([{ id: "x", logFC: 1.5, FC: 999 }]);
        assert.strictEqual(out[0].FC, 1.5);
    });

    it("uses a falsy-but-finite logFC of 0 over a disagreeing FC", function () {
        // Number.isFinite(0) is true — logFC:0 must win, not fall through to log2(FC).
        assert.strictEqual(normalizeMetaFoldChange([{ id: "z", logFC: 0, FC: 999 }])[0].FC, 0);
    });

    it("coerces a numeric-string logFC (prefers it over the linear FC)", function () {
        const out = normalizeMetaFoldChange([{ id: "s", logFC: "1.5", FC: 999 }]);
        assert.strictEqual(out[0].FC, 1.5);
    });

    it("never turns a blank / whitespace / garbage / Infinity logFC into a bogus FC", function () {
        // A blank string must NOT become FC:0 (Number('')===0); it falls through to the linear FC.
        assert.strictEqual(normalizeMetaFoldChange([{ id: "blank", logFC: "", FC: 8 }])[0].FC, 3);   // log2(8)=3
        assert.strictEqual(normalizeMetaFoldChange([{ id: "ws", logFC: "  ", FC: 8 }])[0].FC, 3);
        assert.strictEqual(normalizeMetaFoldChange([{ id: "junk", logFC: "abc", FC: 8 }])[0].FC, 3);
        assert.strictEqual(normalizeMetaFoldChange([{ id: "inf", logFC: Infinity, FC: 8 }])[0].FC, 3);
        // Both fields unusable → passthrough, original FC untouched.
        assert.strictEqual(normalizeMetaFoldChange([{ id: "bad", logFC: "abc", FC: "xyz" }])[0].FC, "xyz");
    });

    it("passes through rows with neither finite logFC nor positive FC", function () {
        const rows = [
            { id: "noFcNoLog" },
            { id: "zero", FC: 0 },
            { id: "neg", FC: -3 },
            { id: "nan", FC: NaN, logFC: NaN },
        ];
        const out = normalizeMetaFoldChange(rows);
        assert.strictEqual(out[0].FC, undefined);
        assert.strictEqual(out[1].FC, 0);
        assert.strictEqual(out[2].FC, -3);
        assert.ok(Number.isNaN(out[3].FC));
    });

    it("keeps all other fields intact and does not mutate the input", function () {
        const rows = [meta(2)];
        const before = JSON.parse(JSON.stringify(rows));
        const out = normalizeMetaFoldChange(rows);
        assert.strictEqual(out[0].id, "g2");
        assert.strictEqual(out[0].pValueFDR, 0.01);
        assert.strictEqual(out[0].logFC, 2);
        assert.notStrictEqual(out, rows);
        assert.notStrictEqual(out[0], rows[0]);
        assert.deepStrictEqual(rows, before); // input unchanged (FC still linear)
    });

    it("returns [] for empty / null input", function () {
        assert.deepStrictEqual(normalizeMetaFoldChange([]), []);
        assert.deepStrictEqual(normalizeMetaFoldChange(null), []);
    });
});

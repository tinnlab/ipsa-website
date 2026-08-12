import assert from "assert";
import { parseGroupData } from "../imports/utils/groupDataUtils";

describe("parseGroupData (Fix 3: sample-data group tables)", function () {
    it("parses [sample, annotation] rows into the groupData config shape", function () {
        const rows = [
            ["S1", "c"],
            ["S2", "c"],
            ["S3", "d"],
            ["S4", "d"],
        ];
        const result = parseGroupData(rows);
        assert.deepStrictEqual(result.data, { S1: "c", S2: "c", S3: "d", S4: "d" });
        assert.deepStrictEqual(result.annotations.sort(), ["c", "d"]);
    });

    it("skips rows with an empty / missing first column (trailing blank lines)", function () {
        const rows = [
            ["S1", "c"],
            ["", "c"],
            [null, "d"],
            ["S2", "d"],
        ];
        const result = parseGroupData(rows);
        assert.deepStrictEqual(result.data, { S1: "c", S2: "d" });
    });

    it("de-duplicates annotation values", function () {
        const rows = [
            ["S1", "control"],
            ["S2", "control"],
            ["S3", "disease"],
        ];
        assert.deepStrictEqual(parseGroupData(rows).annotations.sort(), ["control", "disease"]);
    });

    it("handles empty / undefined input without throwing", function () {
        const empty = { data: {}, annotations: [], warnings: { duplicateSamples: [], conflictingLabels: [] } };
        assert.deepStrictEqual(parseGroupData([]), empty);
        assert.deepStrictEqual(parseGroupData(undefined), empty);
    });
});

describe("parseGroupData duplicate / conflict detection (group_dups fix)", function () {
    it("reports no warnings for a clean file and leaves data/annotations unchanged", function () {
        const rows = [
            ["S1", "c"],
            ["S2", "c"],
            ["S3", "d"],
            ["S4", "d"],
        ];
        const result = parseGroupData(rows);
        // back-compat guard: existing shape is untouched
        assert.deepStrictEqual(result.data, { S1: "c", S2: "c", S3: "d", S4: "d" });
        assert.deepStrictEqual(result.annotations.sort(), ["c", "d"]);
        assert.deepStrictEqual(result.warnings, { duplicateSamples: [], conflictingLabels: [] });
    });

    it("flags a duplicate sample name that has the SAME label (no conflict)", function () {
        const rows = [
            ["S1", "c"],
            ["S2", "d"],
            ["S1", "c"], // duplicate, same label
        ];
        const result = parseGroupData(rows);
        assert.deepStrictEqual(result.warnings.duplicateSamples, ["S1"]);
        assert.deepStrictEqual(result.warnings.conflictingLabels, []);
        // data still collapses to one entry
        assert.deepStrictEqual(result.data, { S1: "c", S2: "d" });
    });

    it("flags a duplicate sample with CONFLICTING labels and reports last-wins kept value", function () {
        const rows = [
            ["S1", "d"], // first: disease
            ["S2", "d"],
            ["S1", "c"], // later row overwrites -> control
        ];
        const result = parseGroupData(rows);
        assert.deepStrictEqual(result.warnings.duplicateSamples, ["S1"]);
        assert.strictEqual(result.warnings.conflictingLabels.length, 1);
        assert.deepStrictEqual(result.warnings.conflictingLabels[0], {
            sample: "S1",
            labels: ["d", "c"],
            kept: "c",
        });
        // last-write-wins: S1 collapses to the later "c"
        assert.strictEqual(result.data.S1, "c");
    });

    it("reproduces the real bug shape: a d/c collision drops a sample and mislabels it", function () {
        // Mimics bugs/group.csv: a tumor (d) row early, the matched normal (c) row later,
        // both sharing the same base name because the group file lost the expression
        // matrix's "_1" suffix.
        const rows = [
            ["TCGA_CW_5591", "d"], // tumor
            ["PLAIN_A", "d"],
            ["PLAIN_B", "c"],
            ["TCGA_CW_5591", "c"], // matched normal, same name -> collides
        ];
        const result = parseGroupData(rows);
        // 4 rows collapse to 3 unique samples
        assert.strictEqual(Object.keys(result.data).length, 3);
        // the collision is surfaced as a conflict, not silently swallowed
        assert.deepStrictEqual(result.warnings.duplicateSamples, ["TCGA_CW_5591"]);
        assert.deepStrictEqual(result.warnings.conflictingLabels, [
            { sample: "TCGA_CW_5591", labels: ["d", "c"], kept: "c" },
        ]);
        // the tumor got relabeled control (the very corruption we now warn about)
        assert.strictEqual(result.data.TCGA_CW_5591, "c");
    });

    it("handles a sample appearing 3+ times with all-distinct labels (kept = last)", function () {
        const rows = [
            ["S1", "a"],
            ["S1", "b"],
            ["S1", "c"], // last wins
        ];
        const result = parseGroupData(rows);
        assert.deepStrictEqual(result.warnings.duplicateSamples, ["S1"]);
        assert.strictEqual(result.warnings.conflictingLabels.length, 1);
        assert.deepStrictEqual(result.warnings.conflictingLabels[0].labels, ["a", "b", "c"]);
        assert.strictEqual(result.warnings.conflictingLabels[0].kept, "c");
        assert.strictEqual(result.data.S1, "c");
    });

    it("flags a malformed duplicate (missing second column) as a conflict, keeping the defined label", function () {
        const rows = [
            ["S1"],        // missing annotation -> undefined label
            ["S1", "c"],   // later defined label wins
        ];
        const result = parseGroupData(rows);
        assert.deepStrictEqual(result.warnings.duplicateSamples, ["S1"]);
        assert.strictEqual(result.warnings.conflictingLabels.length, 1);
        assert.strictEqual(result.warnings.conflictingLabels[0].kept, "c");
        assert.strictEqual(result.data.S1, "c");
    });

    it("excludes empty / null first-column rows from warnings (not just from data)", function () {
        const rows = [
            ["S1", "c"],
            ["", "d"],   // skipped entirely
            [null, "d"], // skipped entirely
            ["S1", "c"], // real duplicate, same label
        ];
        const result = parseGroupData(rows);
        // the blank-first-col rows must NOT appear as a phantom duplicate sample
        assert.deepStrictEqual(result.warnings.duplicateSamples, ["S1"]);
        assert.deepStrictEqual(result.warnings.conflictingLabels, []);
        assert.deepStrictEqual(Object.keys(result.data), ["S1"]);
    });
});

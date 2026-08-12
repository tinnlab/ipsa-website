import assert from "assert";
import {
    metadataValueKey,
    dedupeMetadataValues,
    aggregateMetadataValue,
    metadataFieldKey,
    parseLeadingNumber,
    canonicalizeMetadataConfig,
    classifyMetadataValues,
} from "../imports/utils/metadataValues";

describe("metadataValues", function () {
    describe("metadataValueKey", function () {
        it("trims and lowercases", function () {
            assert.strictEqual(metadataValueKey("  Female "), "female");
            assert.strictEqual(metadataValueKey("MALE"), "male");
        });
        it("collapses null/undefined to empty string", function () {
            assert.strictEqual(metadataValueKey(null), "");
            assert.strictEqual(metadataValueKey(undefined), "");
        });
        it("stringifies non-string values", function () {
            assert.strictEqual(metadataValueKey(42), "42");
        });
    });

    describe("dedupeMetadataValues", function () {
        it("merges values differing only by case", function () {
            assert.deepStrictEqual(
                dedupeMetadataValues(["female", "Female", "FEMALE"]),
                ["female"]
            );
        });
        it("merges values differing by surrounding whitespace", function () {
            assert.deepStrictEqual(
                dedupeMetadataValues(["female", "FEMALE "]),
                ["female"]
            );
        });
        it("keeps the first-seen original casing as representative", function () {
            assert.deepStrictEqual(
                dedupeMetadataValues(["Female", "female"]),
                ["Female"]
            );
        });
        it("preserves genuinely distinct values in order", function () {
            assert.deepStrictEqual(
                dedupeMetadataValues(["female", "male"]),
                ["female", "male"]
            );
        });
        it("skips null, undefined and empty/whitespace-only values", function () {
            assert.deepStrictEqual(
                dedupeMetadataValues([null, undefined, "", "   ", "male"]),
                ["male"]
            );
        });
        it("handles empty / missing input", function () {
            assert.deepStrictEqual(dedupeMetadataValues([]), []);
            assert.deepStrictEqual(dedupeMetadataValues(undefined), []);
        });
    });

    describe("aggregateMetadataValue", function () {
        it("returns a single representative when only one unique value remains", function () {
            assert.strictEqual(
                aggregateMetadataValue(["female", "Female", "FEMALE"]),
                "female"
            );
        });
        it("joins distinct values with a comma-space", function () {
            assert.strictEqual(
                aggregateMetadataValue(["female", "male"]),
                "female, male"
            );
        });
        it("trims the representative", function () {
            assert.strictEqual(aggregateMetadataValue(["  Female  "]), "Female");
        });
        it("returns empty string when there are no usable values", function () {
            assert.strictEqual(aggregateMetadataValue([null, "", "  "]), "");
            assert.strictEqual(aggregateMetadataValue([]), "");
        });
    });

    describe("metadataFieldKey", function () {
        it("normalizes field names like values (trim + lowercase)", function () {
            assert.strictEqual(metadataFieldKey("Sex"), "sex");
            assert.strictEqual(metadataFieldKey("  Cell Type "), "cell type");
        });
    });

    describe("parseLeadingNumber", function () {
        it("parses a plain number", function () {
            assert.strictEqual(parseLeadingNumber("30"), 30);
            assert.strictEqual(parseLeadingNumber("3.5"), 3.5);
        });
        it("keeps a genuine leading negative sign", function () {
            assert.strictEqual(parseLeadingNumber("-2.5 C"), -2.5);
            assert.strictEqual(parseLeadingNumber("-5"), -5);
        });
        it("takes the leading number of a range/units string without a sign", function () {
            assert.strictEqual(parseLeadingNumber("16-17 w weeks"), 16);
            assert.strictEqual(parseLeadingNumber("16 w weeks"), 16);
        });
        it("does NOT invent a sign from a mid-string dash", function () {
            assert.strictEqual(parseLeadingNumber("N-3"), 3);
        });
        it("preserves a real zero", function () {
            assert.strictEqual(parseLeadingNumber("0"), 0);
            assert.strictEqual(parseLeadingNumber(0), 0);
        });
        it("returns null for non-numeric / empty / nullish", function () {
            assert.strictEqual(parseLeadingNumber("N/A"), null);
            assert.strictEqual(parseLeadingNumber("."), null);
            assert.strictEqual(parseLeadingNumber(""), null);
            assert.strictEqual(parseLeadingNumber(null), null);
            assert.strictEqual(parseLeadingNumber(undefined), null);
        });
    });

    describe("canonicalizeMetadataConfig", function () {
        it("collapses case/whitespace field-name variants across datasets to one field", function () {
            const out = canonicalizeMetadataConfig({
                A: { Sex: "female", Age: "30" },
                B: { sex: "male", "Age ": "40" },
            });
            // First-seen casing wins: "Sex"/"Age" (from dataset A) are the canonical names.
            assert.deepStrictEqual(Object.keys(out.A).sort(), ["Age", "Sex"]);
            assert.deepStrictEqual(Object.keys(out.B).sort(), ["Age", "Sex"]);
            assert.strictEqual(out.B.Sex, "male");
            assert.strictEqual(out.B.Age, "40");
        });
        it("preserves each dataset's own values (no value merging)", function () {
            const out = canonicalizeMetadataConfig({
                A: { Sex: "female" },
                B: { Sex: "Male" },
            });
            assert.strictEqual(out.A.Sex, "female");
            assert.strictEqual(out.B.Sex, "Male");
        });
        it("keeps a legitimate 0 value (does not treat it as missing)", function () {
            const out = canonicalizeMetadataConfig({ A: { Dose: 0 } });
            assert.strictEqual(out.A.Dose, 0);
        });
        it("within one dataset, the first non-empty spelling wins", function () {
            const out = canonicalizeMetadataConfig({ A: { Sex: "", sex: "female" } });
            assert.strictEqual(out.A.Sex, "female");
        });
        it("drops empty field names and tolerates empty/missing input", function () {
            assert.deepStrictEqual(canonicalizeMetadataConfig({ A: { "": "x", Sex: "f" } }), { A: { Sex: "f" } });
            assert.deepStrictEqual(canonicalizeMetadataConfig({}), {});
            assert.deepStrictEqual(canonicalizeMetadataConfig(undefined), {});
        });
    });

    describe("classifyMetadataValues", function () {
        it("classifies a many-valued numeric field as gradient", function () {
            assert.strictEqual(classifyMetadataValues(["1", "2", "3", "4", "5"]), "gradient");
        });
        it("classifies a 2-value numeric field (e.g. 0/1 flag) as categorical, not gradient", function () {
            assert.strictEqual(classifyMetadataValues(["0", "1", "0", "1"]), "categorical");
        });
        it("respects a custom minGradientDistinct threshold", function () {
            assert.strictEqual(classifyMetadataValues(["1", "2"], { minGradientDistinct: 2 }), "gradient");
        });
        it("classifies a small non-numeric set as categorical", function () {
            assert.strictEqual(classifyMetadataValues(["female", "male", "female"]), "categorical");
        });
        it("counts case/whitespace variants as one distinct value", function () {
            // 2 distinct after normalization -> categorical, not gradient/text.
            assert.strictEqual(classifyMetadataValues(["Female", "female", "MALE", "male"]), "categorical");
        });
        it("treats a genuine negative-valued numeric field as gradient", function () {
            assert.strictEqual(classifyMetadataValues(["-3", "-1", "0", "2", "4"]), "gradient");
        });
        it("does NOT count junk like '--..' or 'N/A' as numeric", function () {
            // 3 distinct non-numeric strings, not >80% numeric -> categorical (<=10 distinct).
            assert.strictEqual(classifyMetadataValues(["--..", "N/A", "n/a", "pending"]), "categorical");
        });
        it("classifies empty/all-blank input as text", function () {
            assert.strictEqual(classifyMetadataValues([]), "text");
            assert.strictEqual(classifyMetadataValues([null, "", "  "]), "text");
        });
        it("classifies a single distinct value as text", function () {
            assert.strictEqual(classifyMetadataValues(["only", "only"]), "text");
        });
        it("classifies a high-cardinality non-numeric field (e.g. free text / IDs) as text", function () {
            const many = Array.from({ length: 12 }, (_, i) => `label-${i}`);
            assert.strictEqual(classifyMetadataValues(many), "text");
        });
    });
});

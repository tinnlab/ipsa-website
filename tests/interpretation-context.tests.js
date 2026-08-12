import assert from "assert";
import { formatInterpretationContext } from "../imports/utils/interpretationContext";

describe("formatInterpretationContext (Review Context rows)", function () {
    it("returns [] when no context is recorded", function () {
        assert.deepStrictEqual(formatInterpretationContext({}), []);
        assert.deepStrictEqual(formatInterpretationContext(null), []);
        assert.deepStrictEqual(formatInterpretationContext({ interpretationContext: null }), []);
    });

    it("formats consolidated metadata in a stable order, skipping empties", function () {
        const batch = {
            interpretationContext: {
                consolidatedMetadata: {
                    organism: "Homo sapiens",
                    tissue: "Liver",
                    disease: "",            // empty -> skipped
                    comparison: "tumor vs normal",
                    experimental_context: "  RNA-seq  ", // trimmed
                    study_type: "disease"
                }
            }
        };
        assert.deepStrictEqual(formatInterpretationContext(batch), [
            { label: "Organism", value: "Homo sapiens" },
            { label: "Tissue", value: "Liver" },
            { label: "Comparison", value: "tumor vs normal" },
            { label: "Experimental Context", value: "RNA-seq" },
            { label: "Study Type", value: "Disease-Focused Study" } // mapped from "disease"
        ]);
    });

    it("maps study_type keys to friendly labels", function () {
        const make = (study_type) => ({
            interpretationContext: { consolidatedMetadata: { study_type } }
        });
        assert.deepStrictEqual(formatInterpretationContext(make("disease")), [
            { label: "Study Type", value: "Disease-Focused Study" }
        ]);
        assert.deepStrictEqual(formatInterpretationContext(make("experimental")), [
            { label: "Study Type", value: "Treatment/Exposure Study" }
        ]);
        // Unknown keys fall back to the raw stored value.
        assert.deepStrictEqual(formatInterpretationContext(make("spaceflight")), [
            { label: "Study Type", value: "spaceflight" }
        ]);
    });

    it("falls back to legacy contextFields when no consolidated metadata", function () {
        const batch = {
            interpretationContext: {
                contextFields: {
                    tissueType: "Lung",
                    disease: "COPD",
                    condition: "smoker",
                    control: "non-smoker",
                    description: "case-control"
                }
            }
        };
        assert.deepStrictEqual(formatInterpretationContext(batch), [
            { label: "Tissue", value: "Lung" },
            { label: "Disease", value: "COPD" },
            { label: "Condition", value: "smoker" },
            { label: "Control", value: "non-smoker" },
            { label: "Description", value: "case-control" }
        ]);
    });

    it("accepts contextFields supplied as an array (uses the first)", function () {
        const batch = {
            interpretationContext: {
                contextFields: [{ tissueType: "Brain" }, { tissueType: "Heart" }]
            }
        };
        assert.deepStrictEqual(formatInterpretationContext(batch), [
            { label: "Tissue", value: "Brain" }
        ]);
    });

    it("appends free-text customContext when present", function () {
        const batch = {
            interpretationContext: {
                consolidatedMetadata: { organism: "Mouse" },
                customContext: "Focus on inflammation pathways"
            }
        };
        assert.deepStrictEqual(formatInterpretationContext(batch), [
            { label: "Organism", value: "Mouse" },
            { label: "Additional Context", value: "Focus on inflammation pathways" }
        ]);
    });
});

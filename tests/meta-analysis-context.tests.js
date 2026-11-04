import assert from "assert";
import {
    metaSelectionDatasets,
    datasetMetadataByName,
    extractedMetadataByName,
    consolidateMetadata,
} from "../imports/utils/metaAnalysisContext";

// Picking a meta-analysis in the AI wizard on a SHARED (cloned) mass-analysis study showed no
// dataset metadata at all, and generating a report threw 'No mass analysis found in this session.'
// Both because the only route to the datasets was MassAnalysisQueue.analysesMetadata, reached
// through the massAnalysisId on each analysis entry — and cloneStudy deliberately drops that pointer
// and copies no queue rows. The metadata itself survives the clone on Session.analyses[].metadata,
// which is the same object the queue map was built from, so the map can be rebuilt from the study.
//
// Fixtures are the real row shapes, transcribed from the review database (study LPyipYFjzmpLc5vs6,
// massAnalysisId jEbBJJkNkfRqACxyG).

const MASS_ANALYSIS_ID = "jEbBJJkNkfRqACxyG";

const OSD_111 = {
    id: "a111",
    name: "OSD-111-EDL",
    input: "expression",
    isMassAnalysis: true,
    massAnalysisId: MASS_ANALYSIS_ID,
    metadata: {
        raw: "analysisId: OSD-111-EDL\nsex: male",
        source: "metadata.txt",
        format: "key_value",
        extracted: {
            analysisId: "OSD-111-EDL",
            tissueType: "Extensor digitorum longus",
            organism: "Mus musculus",
            sex: "male",
        },
        confidence: "high",
    },
};

const OSD_101 = {
    id: "a101",
    name: "OSD-101",
    input: "expression",
    isMassAnalysis: true,
    massAnalysisId: MASS_ANALYSIS_ID,
    metadata: {
        raw: "analysisId: OSD-101\nsex: Female",
        source: "metadata.txt",
        format: "key_value",
        extracted: {
            analysisId: "OSD-101",
            tissueType: "Left gastrocnemius",
            organism: "Mus musculus",
            // Casing differs from OSD-111 on purpose: the consolidation must merge them.
            sex: "Female",
        },
        confidence: "high",
    },
};

const ANALYSES = {a111: OSD_111, a101: OSD_101};

// What the same two entries look like after cloneStudy: isMassAnalysis and massAnalysisId stripped,
// ids re-minted, `metadata` carried through untouched by `...rest`.
const CLONED_ANALYSES = {
    c111: {id: "c111", name: OSD_111.name, input: OSD_111.input, metadata: OSD_111.metadata},
    c101: {id: "c101", name: OSD_101.name, input: OSD_101.input, metadata: OSD_101.metadata},
};

const META = {
    id: "metaOne",
    name: "Spaceflight muscle meta",
    pathwayLevel: {method: "fisher", selectedAnalyses: ["a111", "a101"], database: "kegg", status: "completed"},
};

const CLONED_META = {
    id: "metaClone",
    name: META.name,
    pathwayLevel: {...META.pathwayLevel, selectedAnalyses: ["c111", "c101"]},
};

describe("metaSelectionDatasets (which datasets a selection covers)", function () {
    it("resolves a meta-analysis id through its own recorded sources", function () {
        const {datasets, missingIds, source} = metaSelectionDatasets("metaOne", ANALYSES, [META]);
        assert.deepStrictEqual(datasets.map(d => d.name), ["OSD-111-EDL", "OSD-101"]);
        assert.deepStrictEqual(missingIds, []);
        assert.strictEqual(source, "meta");
    });

    it("resolves an individual mass-analysis id through its cohort", function () {
        const {datasets, source} = metaSelectionDatasets("a111", ANALYSES, []);
        assert.deepStrictEqual(datasets.map(d => d.name), ["OSD-111-EDL", "OSD-101"]);
        assert.strictEqual(source, "mass");
    });

    it("works on a CLONE, where no analysis carries a massAnalysisId at all", function () {
        // The regression: this is the study shape that produced an empty context and a throw.
        const {datasets, missingIds, source} = metaSelectionDatasets(
            "metaClone", CLONED_ANALYSES, [CLONED_META]
        );
        assert.strictEqual(source, "meta");
        assert.deepStrictEqual(missingIds, []);
        assert.deepStrictEqual(datasets.map(d => d.name), ["OSD-111-EDL", "OSD-101"]);
        assert.ok(Object.values(CLONED_ANALYSES).every(a => !a.massAnalysisId),
            "fixture must have no massAnalysisId, or it is not testing the clone");
    });

    it("names every source that is not in the study instead of quietly shrinking", function () {
        // Reachable when an analysis is deleted after the meta was built: the meta entry keeps the
        // id in selectedAnalyses.
        const partial = {a111: OSD_111};
        const {datasets, missingIds} = metaSelectionDatasets("metaOne", partial, [META]);
        assert.deepStrictEqual(datasets.map(d => d.name), ["OSD-111-EDL"]);
        assert.deepStrictEqual(missingIds, ["a101"]);
    });

    it("reports ALL sources missing rather than falling back to the cohort", function () {
        // Both sources deleted, but a mass cohort still exists in the study. The caller must be able
        // to tell "nothing resolved" from "no sources recorded" — the first refuses, the second
        // (below) legitimately falls back — so this must NOT report source 'mass'.
        const cohortOnly = {other: {id: "other", name: "OSD-999", massAnalysisId: MASS_ANALYSIS_ID}};
        const {datasets, missingIds, source} = metaSelectionDatasets("metaOne", cohortOnly, [META]);
        assert.deepStrictEqual(datasets, []);
        assert.deepStrictEqual(missingIds, ["a111", "a101"]);
        assert.strictEqual(source, "meta");
    });

    it("falls back to the study's cohort for a legacy meta entry that recorded no sources", function () {
        const legacy = {id: "metaLegacy", name: "Legacy"};
        const {datasets, source} = metaSelectionDatasets("metaLegacy", ANALYSES, [legacy]);
        assert.deepStrictEqual(datasets.map(d => d.name), ["OSD-111-EDL", "OSD-101"]);
        assert.strictEqual(source, "mass");
    });

    it("returns nothing for an unknown id in a study with no mass analysis", function () {
        const {datasets, missingIds, source} = metaSelectionDatasets("nope", CLONED_ANALYSES, []);
        assert.deepStrictEqual(datasets, []);
        assert.deepStrictEqual(missingIds, []);
        assert.strictEqual(source, "none");
    });

    it("tolerates missing/!array inputs", function () {
        assert.strictEqual(metaSelectionDatasets("x", undefined, undefined).source, "none");
        assert.deepStrictEqual(metaSelectionDatasets(undefined, {}, []).datasets, []);
    });
});

describe("datasetMetadataByName / extractedMetadataByName", function () {
    it("builds the SAME map for a cloned study as for the original", function () {
        // The core regression, stated as an equality rather than as two separate expectations.
        const original = datasetMetadataByName(
            metaSelectionDatasets("metaOne", ANALYSES, [META]).datasets
        );
        const cloned = datasetMetadataByName(
            metaSelectionDatasets("metaClone", CLONED_ANALYSES, [CLONED_META]).datasets
        );
        assert.deepStrictEqual(cloned, original);
        assert.deepStrictEqual(Object.keys(cloned), ["OSD-111-EDL", "OSD-101"]);
    });

    it("keeps the {extracted: …} nesting the server payload depends on", function () {
        // aiWorkflow reads datasetsMetadata[name]?.extracted; flattening here empties every
        // dataset's metadata in the request without any error.
        const map = datasetMetadataByName([OSD_111]);
        assert.strictEqual(map["OSD-111-EDL"].extracted.organism, "Mus musculus");
        assert.strictEqual(map["OSD-111-EDL"].confidence, "high");
    });

    it("skips entries whose metadata is the empty STRING mass analysis writes", function () {
        // massAnalysis.create writes `metadata: analysis.metadata || ''`.
        const map = datasetMetadataByName([{id: "x", name: "No metadata", metadata: ""}, OSD_101]);
        assert.deepStrictEqual(Object.keys(map), ["OSD-101"]);
    });

    it("flattens to the display shape and tolerates an already-flat map", function () {
        const nested = extractedMetadataByName(datasetMetadataByName([OSD_111]));
        assert.strictEqual(nested["OSD-111-EDL"].sex, "male");
        // massAnalysis.getMetadata can return a flat map for older rows.
        const flat = extractedMetadataByName({"OSD-9": {organism: "Homo sapiens"}});
        assert.deepStrictEqual(flat, {"OSD-9": {organism: "Homo sapiens"}});
    });

    it("drops datasets whose extracted metadata is empty", function () {
        assert.deepStrictEqual(extractedMetadataByName({"OSD-9": {extracted: {}}}), {});
    });

    it("returns {} for empty / null input", function () {
        assert.deepStrictEqual(datasetMetadataByName(null), {});
        assert.deepStrictEqual(extractedMetadataByName(null), {});
    });
});

describe("consolidateMetadata (study-level context seeded into the modal)", function () {
    it("merges values that differ only by case across datasets", function () {
        const consolidated = consolidateMetadata(
            extractedMetadataByName(datasetMetadataByName([OSD_111, OSD_101]))
        );
        // "male"/"Female" are genuinely different and stay both; organism collapses to one.
        assert.strictEqual(consolidated.organism, "Mus musculus");
        assert.strictEqual(consolidated.tissue, "");
        assert.strictEqual(consolidated.study_type, "disease");
    });

    it("collapses a field whose values differ only by casing to a single value", function () {
        const consolidated = consolidateMetadata({
            d1: {organism: "mus musculus"},
            d2: {organism: "Mus Musculus"},
        });
        assert.strictEqual(consolidated.organism, "mus musculus");
    });

    it("defaults organism when no dataset declares one", function () {
        assert.strictEqual(consolidateMetadata({d1: {sex: "male"}}).organism, "Homo sapiens");
    });

    it("returns null when there is nothing to consolidate", function () {
        assert.strictEqual(consolidateMetadata({}), null);
        assert.strictEqual(consolidateMetadata(null), null);
    });
});

import assert from "assert";
import {
    buildIdMap,
    metaSourceAnalysisIds,
    metaAnalysisIsCloneable,
    remapMetaAnalysisEntry,
    remapSelectedDatasets,
    remapGeneStats,
    remapSelectedRows,
    remapConfigValue,
    remapCustomGeneSetValue,
    isTerminalWorkflow,
    WORKFLOW_FIELDS_TO_DROP,
} from "../imports/utils/cloneIdMap";

// Deterministic id minting so the assertions can name the results.
const mintSeq = () => {
    let n = 0;
    return () => `new${++n}`;
};

describe("buildIdMap", function () {
    it("mints one new id per distinct source id", function () {
        const map = buildIdMap(["a", "b"], mintSeq());
        assert.deepStrictEqual([...map.entries()], [["a", "new1"], ["b", "new2"]]);
    });

    it("reuses the same mapping for a repeated id", function () {
        const map = buildIdMap(["a", "a"], mintSeq());
        assert.strictEqual(map.size, 1);
        assert.strictEqual(map.get("a"), "new1");
    });

    it("skips blanks and non-strings", function () {
        const map = buildIdMap(["a", "", null, undefined, 5, {}], mintSeq());
        assert.deepStrictEqual([...map.keys()], ["a"]);
    });
});

describe("metaSourceAnalysisIds", function () {
    it("collects from both levels and de-duplicates", function () {
        const entry = {
            geneLevel: {selectedAnalyses: ["a1", "a2"]},
            pathwayLevel: {selectedAnalyses: ["a2", "a3"]},
        };
        assert.deepStrictEqual(metaSourceAnalysisIds(entry).sort(), ["a1", "a2", "a3"]);
    });

    it("tolerates missing levels and malformed entries", function () {
        assert.deepStrictEqual(metaSourceAnalysisIds(null), []);
        assert.deepStrictEqual(metaSourceAnalysisIds({}), []);
        assert.deepStrictEqual(metaSourceAnalysisIds({pathwayLevel: {}}), []);
        assert.deepStrictEqual(metaSourceAnalysisIds({pathwayLevel: {selectedAnalyses: [null, "a1"]}}), ["a1"]);
    });

    // selectedAnalyses reaches the database from a method that validates only the entry's id, so it can
    // be any shape. A for..of over a non-array throws, and this now runs inside share.preview (no
    // try/catch — a 500 that makes the link permanently unopenable) and inside the share modal's render.
    it("returns nothing for a non-array selectedAnalyses instead of throwing", function () {
        assert.deepStrictEqual(metaSourceAnalysisIds({pathwayLevel: {selectedAnalyses: {a: 1}}}), []);
        assert.deepStrictEqual(metaSourceAnalysisIds({geneLevel: {selectedAnalyses: "a1"}}), []);
        assert.deepStrictEqual(metaSourceAnalysisIds({pathwayLevel: {selectedAnalyses: 7}}), []);
    });
});

// This is the trap that corrupts the DONOR: a meta-analysis cloned without all its sources ends up
// pointing at the donor's analyses, and deleting the clone then wipes the donor's meta results.
describe("metaAnalysisIsCloneable (protects the donor study)", function () {
    const entry = {id: "m1", pathwayLevel: {selectedAnalyses: ["a1", "a2"]}};

    it("accepts a meta-analysis whose sources are all being cloned", function () {
        assert.strictEqual(metaAnalysisIsCloneable(entry, new Set(["a1", "a2", "a3"])), true);
    });

    it("REJECTS one whose sources are only partly selected", function () {
        assert.strictEqual(metaAnalysisIsCloneable(entry, new Set(["a1"])), false);
    });

    it("rejects one with no recorded sources rather than cloning on faith", function () {
        assert.strictEqual(metaAnalysisIsCloneable({id: "m1"}, new Set(["a1"])), false);
        assert.strictEqual(
            metaAnalysisIsCloneable({id: "m1", pathwayLevel: {selectedAnalyses: []}}, new Set(["a1"])),
            false
        );
    });

    it("rejects a malformed entry", function () {
        assert.strictEqual(metaAnalysisIsCloneable(null, new Set(["a1"])), false);
        assert.strictEqual(metaAnalysisIsCloneable({pathwayLevel: {selectedAnalyses: ["a1"]}}, new Set(["a1"])), false);
    });
});

describe("remapMetaAnalysisEntry", function () {
    const analysisIdMap = new Map([["a1", "A1"], ["a2", "A2"]]);
    const metaIdMap = new Map([["m1", "M1"]]);

    it("rewrites its own id and every source id, on both levels", function () {
        const cloned = remapMetaAnalysisEntry(
            {
                id: "m1",
                name: "meta",
                geneLevel: {selectedAnalyses: ["a1"], status: "done"},
                pathwayLevel: {selectedAnalyses: ["a1", "a2"], method: "fisher"},
            },
            analysisIdMap,
            metaIdMap
        );
        assert.strictEqual(cloned.id, "M1");
        assert.deepStrictEqual(cloned.geneLevel.selectedAnalyses, ["A1"]);
        assert.deepStrictEqual(cloned.pathwayLevel.selectedAnalyses, ["A1", "A2"]);
    });

    it("preserves unrelated fields on the entry and its levels", function () {
        const cloned = remapMetaAnalysisEntry(
            {id: "m1", name: "meta", pathwayLevel: {selectedAnalyses: ["a1"], method: "fisher"}},
            analysisIdMap,
            metaIdMap
        );
        assert.strictEqual(cloned.name, "meta");
        assert.strictEqual(cloned.pathwayLevel.method, "fisher");
    });

    it("does not mutate the source entry", function () {
        const original = {id: "m1", pathwayLevel: {selectedAnalyses: ["a1"]}};
        remapMetaAnalysisEntry(original, analysisIdMap, metaIdMap);
        assert.strictEqual(original.id, "m1");
        assert.deepStrictEqual(original.pathwayLevel.selectedAnalyses, ["a1"]);
    });

    it("leaves a level absent when the source had none", function () {
        const cloned = remapMetaAnalysisEntry({id: "m1", pathwayLevel: {selectedAnalyses: ["a1"]}}, analysisIdMap, metaIdMap);
        assert.strictEqual("geneLevel" in cloned, false);
    });

    // Falling back to the DONOR's id is the leak this module exists to prevent, and quietly dropping the
    // id instead would misreport what the meta was computed from. Callers filter with
    // metaAnalysisIsCloneable first, so reaching this is a caller bug and has to be loud.
    it("THROWS on an unmapped source rather than keeping the donor's id or dropping it", function () {
        assert.throws(
            () => remapMetaAnalysisEntry(
                {id: "m1", pathwayLevel: {selectedAnalyses: ["a1", "notInTheClone"]}},
                analysisIdMap,
                metaIdMap
            ),
            /unmapped analysis notInTheClone/
        );
    });

    it("keeps selectedAnalyses full-length when every source is mapped", function () {
        const cloned = remapMetaAnalysisEntry(
            {id: "m1", pathwayLevel: {selectedAnalyses: ["a1", "a2"]}},
            analysisIdMap,
            metaIdMap
        );
        assert.deepStrictEqual(cloned.pathwayLevel.selectedAnalyses, ["A1", "A2"]);
    });

    // The verdict and the rewrite have to accept the same values. metaSourceAnalysisIds skips a null,
    // so a meta carrying one is judged cloneable — and if the rewrite did not skip it too, that meta
    // would pass the gate and then abort the whole import.
    it("agrees with metaAnalysisIsCloneable about junk entries, rather than throwing on them", function () {
        const entry = {id: "m1", pathwayLevel: {selectedAnalyses: ["a1", null, "", "a2"]}};
        assert.strictEqual(metaAnalysisIsCloneable(entry, new Set(["a1", "a2"])), true);
        const cloned = remapMetaAnalysisEntry(entry, analysisIdMap, metaIdMap);
        assert.deepStrictEqual(cloned.pathwayLevel.selectedAnalyses, ["A1", "A2"]);
    });

    // An array-LIKE object is skipped by metaSourceAnalysisIds, so the cloneability verdict is reached
    // as though it held nothing. Copying it through verbatim would put the DONOR's ids inside it into
    // the clone, unremapped — the exact leak this module exists to prevent, so it is emptied instead.
    it("EMPTIES a non-array selectedAnalyses rather than copying donor ids through it", function () {
        const cloned = remapMetaAnalysisEntry(
            {id: "m1", pathwayLevel: {selectedAnalyses: {0: "donorAnalysisId"}, method: "fisher"}},
            analysisIdMap,
            metaIdMap
        );
        assert.deepStrictEqual(cloned.pathwayLevel.selectedAnalyses, []);
        // The rest of the level is still carried over.
        assert.strictEqual(cloned.pathwayLevel.method, "fisher");
    });

    // The whole point: no donor id survives anywhere in the cloned entry.
    it("leaves no donor id anywhere in the result, even from a malformed level", function () {
        const cloned = remapMetaAnalysisEntry(
            {
                id: "m1",
                geneLevel: {selectedAnalyses: ["a1"]},
                pathwayLevel: {selectedAnalyses: {0: "a2"}},
            },
            analysisIdMap,
            metaIdMap
        );
        assert.strictEqual(JSON.stringify(cloned).includes("a1"), false);
        assert.strictEqual(JSON.stringify(cloned).includes("a2"), false);
        assert.strictEqual(JSON.stringify(cloned).includes("m1"), false);
    });

    // pathwayLevel.database is the databaseId the meta was computed over. For a CUSTOM gene set that is
    // the gene set's SessionConfig._id, which is a primary key and therefore changes with the clone —
    // the same reference AnalysisResult.databaseId carries and the clone already rewrites there.
    describe("the database the pathway level was computed over", function () {
        const geneSetIdMap = new Map([["cg1", "CG1"]]);

        it("rewrites a custom gene-set id", function () {
            const cloned = remapMetaAnalysisEntry(
                {id: "m1", pathwayLevel: {selectedAnalyses: ["a1"], database: "cg1"}},
                analysisIdMap,
                metaIdMap,
                geneSetIdMap
            );
            assert.strictEqual(cloned.pathwayLevel.database, "CG1");
        });

        it("leaves a built-in database id alone", function () {
            const cloned = remapMetaAnalysisEntry(
                {id: "m1", pathwayLevel: {selectedAnalyses: ["a1"], database: "kegg"}},
                analysisIdMap,
                metaIdMap,
                geneSetIdMap
            );
            assert.strictEqual(cloned.pathwayLevel.database, "kegg");
        });

        it("does not invent the key on a level that never had one", function () {
            const cloned = remapMetaAnalysisEntry(
                {id: "m1", pathwayLevel: {selectedAnalyses: ["a1"]}},
                analysisIdMap,
                metaIdMap,
                geneSetIdMap
            );
            assert.strictEqual("database" in cloned.pathwayLevel, false);
        });

        it("still rewrites it on a level whose source list is malformed", function () {
            const cloned = remapMetaAnalysisEntry(
                {id: "m1", geneLevel: {selectedAnalyses: ["a1"]}, pathwayLevel: {selectedAnalyses: {}, database: "cg1"}},
                analysisIdMap,
                metaIdMap,
                geneSetIdMap
            );
            assert.strictEqual(cloned.pathwayLevel.database, "CG1");
        });

        it("is a no-op when the study has no custom gene sets", function () {
            const cloned = remapMetaAnalysisEntry(
                {id: "m1", pathwayLevel: {selectedAnalyses: ["a1"], database: "cg1"}},
                analysisIdMap,
                metaIdMap
            );
            assert.strictEqual(cloned.pathwayLevel.database, "cg1");
        });
    });
});

// SessionConfig._id IS the custom gene-set id, and it has to change because it is a primary key.
// Every reference to it must move in step or the cloned study points at the donor's gene sets.
describe("custom gene-set id remapping", function () {
    const geneSetIdMap = new Map([["cg1", "CG1"]]);

    it("rewrites selectedDatasets, leaving built-in database ids alone", function () {
        assert.deepStrictEqual(remapSelectedDatasets(["kegg", "cg1"], geneSetIdMap), ["kegg", "CG1"]);
    });

    it("rewrites geneStats entry ids", function () {
        const out = remapGeneStats([{id: "cg1", name: "mine"}, {id: "kegg", name: "KEGG"}], geneSetIdMap);
        assert.deepStrictEqual(out.map((e) => e.id), ["CG1", "kegg"]);
        assert.strictEqual(out[0].name, "mine");
    });

    it("rewrites selectedRows in both string and object form", function () {
        assert.deepStrictEqual(remapSelectedRows(["cg1", "kegg"], geneSetIdMap), ["CG1", "kegg"]);
        assert.deepStrictEqual(
            remapSelectedRows([{id: "cg1", checked: true}], geneSetIdMap).map((e) => e.id),
            ["CG1"]
        );
    });

    it("does not mutate the source values", function () {
        const rows = [{id: "cg1"}];
        remapGeneStats(rows, geneSetIdMap);
        assert.strictEqual(rows[0].id, "cg1");
    });

    it("passes through non-array values untouched", function () {
        assert.strictEqual(remapSelectedDatasets("nope", geneSetIdMap), "nope");
        assert.strictEqual(remapGeneStats(null, geneSetIdMap), null);
    });

    describe("remapConfigValue dispatch", function () {
        it("remaps only the keys that carry gene-set references", function () {
            assert.deepStrictEqual(remapConfigValue("selectedDatasets", ["cg1"], geneSetIdMap), ["CG1"]);
            assert.deepStrictEqual(remapConfigValue("geneStats", [{id: "cg1"}], geneSetIdMap).map((e) => e.id), ["CG1"]);
            assert.deepStrictEqual(remapConfigValue("selectedRows", ["cg1"], geneSetIdMap), ["CG1"]);
        });

        // analysis.start snapshots the SessionConfig row verbatim under this key, so the id INSIDE
        // the value has to move with SessionConfig._id. Missing this left result rows keyed by the
        // donor's gene-set id while the configs pointed at the new one — the custom branch vanished
        // from the results tree, and a re-run produced zero rows for it with no error.
        it("remaps the id inside a customGeneSets value", function () {
            const out = remapConfigValue("customGeneSets", {id: "cg1", name: "mine"}, geneSetIdMap);
            assert.strictEqual(out.id, "CG1");
            assert.strictEqual(out.name, "mine");
        });

        it("remaps customGeneSets when the value is an array", function () {
            const out = remapConfigValue("customGeneSets", [{id: "cg1"}, {id: "other"}], geneSetIdMap);
            assert.deepStrictEqual(out.map((e) => e.id), ["CG1", "other"]);
        });

        it("leaves every other key alone", function () {
            assert.deepStrictEqual(remapConfigValue("volcanoPlotData", ["cg1"], geneSetIdMap), ["cg1"]);
            assert.strictEqual(remapConfigValue("input", "GENE1 GENE2", geneSetIdMap), "GENE1 GENE2");
        });

        it("is a no-op when the study has no custom gene sets", function () {
            assert.deepStrictEqual(remapConfigValue("selectedDatasets", ["cg1"], new Map()), ["cg1"]);
            assert.deepStrictEqual(remapConfigValue("selectedDatasets", ["cg1"], null), ["cg1"]);
        });
    });
});

describe("workflow row cloning rules", function () {
    it("clones only terminal rows", function () {
        assert.strictEqual(isTerminalWorkflow({status: "completed"}), true);
        assert.strictEqual(isTerminalWorkflow({status: "failed"}), true);
        assert.strictEqual(isTerminalWorkflow({status: "pending"}), false);
        assert.strictEqual(isTerminalWorkflow({status: "running"}), false);
        assert.strictEqual(isTerminalWorkflow(null), false);
        assert.strictEqual(isTerminalWorkflow({}), false);
    });

    // Both point at the EXTERNAL pipeline; copying them would have two rows claiming one job.
    it("names the external fields that must be dropped", function () {
        assert.deepStrictEqual(WORKFLOW_FIELDS_TO_DROP, ["externalJobId", "outputPath"]);
    });
});

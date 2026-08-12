import assert from "assert";
import {analysisDisplayName, buildGeneLevelData} from "../imports/utils/metaAnalysisGeneLevel";

// Regression for the Meta-analysis tab crash:
//   "Cannot read properties of undefined (reading 'name')"
// On the Visualization page the `analyses` map is filtered to analyses that have
// pathway-enrichment results, while `configs` keeps every analysis. An Expression
// analysis present in `configs` but missing from `analyses` used to crash the
// gene-level init effect at `analyses[id].name`. buildGeneLevelData must tolerate
// the missing entry and keep the analysis selectable.

describe("analysisDisplayName (safe name resolution)", function () {
    const analyses = {a1: {id: "a1", name: "Liver vs Control"}};

    it("prefers the name carried on the config (fallbackName)", function () {
        assert.strictEqual(analysisDisplayName(analyses, "a1", "Config Name"), "Config Name");
    });

    it("falls back to the analyses map when no config name is given", function () {
        assert.strictEqual(analysisDisplayName(analyses, "a1"), "Liver vs Control");
    });

    it("falls back to the raw id when the analysis is missing — does not throw", function () {
        assert.strictEqual(analysisDisplayName(analyses, "ghost"), "ghost");
    });

    it("does not throw when the analyses map itself is undefined", function () {
        assert.strictEqual(analysisDisplayName(undefined, "a1", "Config Name"), "Config Name");
        assert.strictEqual(analysisDisplayName(undefined, "a1"), "a1");
    });
});

describe("buildGeneLevelData (gene-level meta-analysis selection)", function () {
    it("does NOT throw when an expression config's analysis is missing from `analyses`", function () {
        // The exact crash scenario: config exists, analyses[id] is undefined.
        const configs = {
            a1: {analysisId: "a1", inputType: "expression", name: "Expr A1", hasGeneResults: true},
        };
        const analyses = {}; // a1 was filtered out (no pathway results)

        let result;
        assert.doesNotThrow(() => {
            result = buildGeneLevelData(configs, analyses);
        });
        // Name resolves from the config's own name, analysis stays selectable.
        assert.deepStrictEqual(result.geneTreeData, [
            {title: "Expr A1", value: "a1", key: "a1", disabled: false, disableCheckbox: false},
        ]);
        assert.deepStrictEqual(result.initialSelectedItems, ["a1"]);
        assert.strictEqual(result.expressionData.length, 1);
    });

    it("includes only Expression analyses (excludes PGSEA and ORA)", function () {
        const configs = {
            a1: {analysisId: "a1", inputType: "expression", name: "Expr A1", hasGeneResults: true},
            a2: {analysisId: "a2", inputType: "pgsea", name: "PGSEA A2", hasGeneResults: true},
            a3: {analysisId: "a3", inputType: "ora", name: "ORA A3"},
            a4: {analysisId: "a4", inputType: "expression", name: "Expr A4", hasGeneResults: true},
        };
        const analyses = {
            a1: {id: "a1", name: "Expr A1"},
            a4: {id: "a4", name: "Expr A4"},
        };

        const {expressionData, geneTreeData, initialSelectedItems} = buildGeneLevelData(configs, analyses);

        assert.deepStrictEqual(initialSelectedItems, ["a1", "a4"]);
        assert.strictEqual(expressionData.length, 2);
        assert.deepStrictEqual(geneTreeData.map(t => t.title), ["Expr A1", "Expr A4"]);
        // Both have results, so every expression entry is pre-selected.
        assert.deepStrictEqual(
            initialSelectedItems,
            geneTreeData.map(t => t.value)
        );
    });

    it("keeps not-run expression analyses in the tree but disabled and unselected", function () {
        // User scenario: an Expression analysis that was created but never run has no
        // DE results (hasGeneResults falsy). It must remain visible (so users see why
        // it's unavailable) but disabled and NOT pre-selected.
        const configs = {
            a1: {analysisId: "a1", inputType: "expression", name: "Ran A1", hasGeneResults: true},
            a2: {analysisId: "a2", inputType: "expression", name: "NotRun A2"}, // no hasGeneResults
        };
        const analyses = {a1: {id: "a1", name: "Ran A1"}, a2: {id: "a2", name: "NotRun A2"}};

        const {geneTreeData, initialSelectedItems} = buildGeneLevelData(configs, analyses);

        // Only the analysis with DE results is pre-selected.
        assert.deepStrictEqual(initialSelectedItems, ["a1"]);
        // Both still appear in the tree.
        assert.strictEqual(geneTreeData.length, 2);
        const ran = geneTreeData.find(t => t.value === "a1");
        const notRun = geneTreeData.find(t => t.value === "a2");
        assert.strictEqual(ran.title, "Ran A1");
        assert.strictEqual(ran.disabled, false);
        // Not-run analysis is labelled and disabled.
        assert.strictEqual(notRun.title, "NotRun A2 (No DE results)");
        assert.strictEqual(notRun.disabled, true);
        assert.strictEqual(notRun.disableCheckbox, true);
        assert.ok(!initialSelectedItems.includes("a2"));
    });

    it("prefers the config name over the analyses-map name when both are present", function () {
        // The config carries the authoritative, server-attached name, so it wins.
        // Names are deliberately DIFFERENT so this pins the precedence (a ??-order
        // regression that preferred the map would fail here).
        const configs = {
            a1: {analysisId: "a1", inputType: "expression", name: "Config Name", hasGeneResults: true},
        };
        const analyses = {a1: {id: "a1", name: "Map Name"}};
        const {geneTreeData} = buildGeneLevelData(configs, analyses);
        assert.strictEqual(geneTreeData[0].title, "Config Name");
    });

    it("excludes an expression config missing its analysisId (no undefined tree keys)", function () {
        // Malformed-config variant: an entry with no analysisId must be dropped, not
        // turned into a TreeSelect entry with value/key === undefined.
        const configs = {
            a1: {analysisId: "a1", inputType: "expression", name: "Expr A1", hasGeneResults: true},
            x: {inputType: "expression", name: "Orphan Expr", hasGeneResults: true},
        };
        let result;
        assert.doesNotThrow(() => {
            result = buildGeneLevelData(configs, {});
        });
        assert.deepStrictEqual(result.initialSelectedItems, ["a1"]);
        assert.deepStrictEqual(result.geneTreeData.map(t => t.title), ["Expr A1"]);
        assert.ok(result.geneTreeData.every(t => t.value !== undefined));
    });

    it("accepts an array of configs (documented Object|Array contract)", function () {
        const configs = [
            {analysisId: "a1", inputType: "expression", name: "Expr A1", hasGeneResults: true},
            {analysisId: "a2", inputType: "ora", name: "ORA A2"},
        ];
        const {geneTreeData, initialSelectedItems} = buildGeneLevelData(configs, {});
        assert.deepStrictEqual(initialSelectedItems, ["a1"]);
        assert.deepStrictEqual(geneTreeData.map(t => t.title), ["Expr A1"]);
    });

    it("returns empty results for no configs and does not throw", function () {
        assert.deepStrictEqual(buildGeneLevelData({}, {}), {
            expressionData: [],
            geneTreeData: [],
            initialSelectedItems: [],
        });
        assert.doesNotThrow(() => buildGeneLevelData(undefined, undefined));
        assert.deepStrictEqual(buildGeneLevelData(undefined, undefined).initialSelectedItems, []);
    });
});

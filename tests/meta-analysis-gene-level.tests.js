import assert from "assert";
import {
    analysisDisplayName,
    resolveAnalysisName,
    nonEmptyLabel,
    buildGeneLevelData,
} from "../imports/utils/metaAnalysisGeneLevel";

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

    it("does not let an EMPTY name win over one that exists", function () {
        // `fallbackName ?? …` used to let '' through, rendering blank where a name was available.
        assert.strictEqual(analysisDisplayName(analyses, "a1", ""), "Liver vs Control");
        assert.strictEqual(analysisDisplayName(analyses, "a1", "   "), "Liver vs Control");
        assert.strictEqual(analysisDisplayName({a1: {name: ""}}, "a1"), "a1");
    });
});

// Meta-analyses live on Session.metaAnalyses[], a different array from Session.analyses[]. Sites
// that consulted only the analyses map resolved a meta id to nothing, which surfaced as raw ids in
// the wizard's review step and tab titles, "Analysis <id>" saved onto reports, and a label that
// rendered as a lone ':' with no name in front of it.
describe("resolveAnalysisName / nonEmptyLabel (meta-aware name resolution)", function () {
    const ANALYSES = {a1: {id: "a1", name: "Liver vs Control"}};
    const META_ANALYSES = [{id: "m1", name: "Liver meta-analysis"}];

    it("resolves a meta-analysis id to its name", function () {
        assert.strictEqual(resolveAnalysisName(ANALYSES, "m1", META_ANALYSES), "Liver meta-analysis");
    });

    it("resolves an ordinary analysis id to its name", function () {
        assert.strictEqual(resolveAnalysisName(ANALYSES, "a1", META_ANALYSES), "Liver vs Control");
    });

    it("returns undefined — not '' and not the id — when nothing names the id", function () {
        assert.strictEqual(resolveAnalysisName(ANALYSES, "ghost", META_ANALYSES), undefined);
        assert.strictEqual(resolveAnalysisName(undefined, "ghost", undefined), undefined);
    });

    it("skips a meta entry whose name is empty rather than returning it", function () {
        assert.strictEqual(resolveAnalysisName({}, "m2", [{id: "m2", name: ""}]), undefined);
    });

    it("routes the meta name through analysisDisplayName's 4th argument", function () {
        assert.strictEqual(
            analysisDisplayName(ANALYSES, "m1", undefined, META_ANALYSES), "Liver meta-analysis"
        );
        // Existing 3-arg callers are unaffected: still the raw id for an unknown meta id.
        assert.strictEqual(analysisDisplayName(ANALYSES, "m1"), "m1");
    });

    it("never yields an empty label, so a following ':' can never stand alone", function () {
        assert.strictEqual(nonEmptyLabel("Liver vs Control"), "Liver vs Control");
        assert.strictEqual(nonEmptyLabel(""), "Unnamed analysis");
        assert.strictEqual(nonEmptyLabel(undefined), "Unnamed analysis");
        assert.strictEqual(nonEmptyLabel(null), "Unnamed analysis");
        assert.strictEqual(nonEmptyLabel("   "), "Unnamed analysis");
        assert.strictEqual(nonEmptyLabel("", "Unnamed database"), "Unnamed database");
        // Even a caller that passes an empty fallback cannot produce a bare colon.
        assert.strictEqual(nonEmptyLabel("", ""), "Unnamed");
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

    it("includes Expression and PGSEA analyses (excludes ORA)", function () {
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

        assert.deepStrictEqual(initialSelectedItems, ["a1", "a2", "a4"]);
        assert.strictEqual(expressionData.length, 3);
        assert.deepStrictEqual(geneTreeData.map(t => t.title), ["Expr A1", "PGSEA A2", "Expr A4"]);
        // All have results, so every entry is pre-selected.
        assert.deepStrictEqual(
            initialSelectedItems,
            geneTreeData.map(t => t.value)
        );
    });

    it("keeps a single-metric PGSEA analysis (no gene-level rows) disabled, with the reason", function () {
        // A PGSEA upload without fold-change AND p-value columns gets no volcanoPlotData, so
        // hasGeneResults is falsy and it must not feed the meta-analysis.
        const configs = {
            p1: {analysisId: "p1", inputType: "pgsea", name: "Legacy P1"},
        };
        const {geneTreeData, initialSelectedItems} = buildGeneLevelData(configs, {});
        assert.deepStrictEqual(initialSelectedItems, []);
        assert.strictEqual(geneTreeData[0].title, "Legacy P1 (No fold-change and p-value statistics)");
        assert.strictEqual(geneTreeData[0].disabled, true);
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

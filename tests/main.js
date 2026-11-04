import assert from "assert";

describe("cpa", function () {
  it("package.json has correct name", async function () {
    const { name } = await import("../package.json");
    assert.strictEqual(name, "cpa");
  });

  if (Meteor.isClient) {
    it("client is not server", function () {
      assert.strictEqual(Meteor.isServer, false);
    });
  }

  if (Meteor.isServer) {
    it("server is not client", function () {
      assert.strictEqual(Meteor.isClient, false);
    });
  }
});

// Server-only test suites. Guarded + lazily required so the server-only modules they import
// are never pulled into the client bundle (and so the run needs no headless browser driver).
if (Meteor.isServer) {
  require("./chat.tests.js");
  require("./export-degenes.tests.js"); // Bug 4 (pure) + flexible export modes (pure)
  require("./viz-nav.tests.js");        // Visualize-Results opens the selected analysis + per-analysis nav anchors (pure)
  require("./plot-display-state.tests.js"); // Circos/sibling loading-vs-no-data (pure)
  require("./circos-gene-select.tests.js"); // Circos gene target + highlight pinning + node/relation graph (pure)
  require("./meta-analysis-gene-level.tests.js"); // Meta-analysis gene-level builder tolerates missing analyses (pure)
  require("./meta-analysis-levels.tests.js"); // Meta-analysis builder: gene/pathway level capability locks (pure)
  require("./meta-analysis-gene-level-rscript.tests.js"); // Gene-level "weight must be size 1" summarise regression (pure) + R integration (guarded)
  require("./meta-analysis-pathway-level.tests.js"); // Pathway-level seTE select regression + funnel helpers (pure) + R integration (guarded)
  require("./fgsea-reproducibility.tests.js"); // FGSEA set.seed(seed) before fgsea::fgsea in both generators (pure)
  require("./process-registry.tests.js"); // Bug 1 (uses Node async_hooks)
  require("./consensus-input.tests.js");  // Bug 2A (pure)
  require("./consensus-trigger.tests.js"); // consensus trigger gate (pure)
  require("./consensus-wiring.tests.js");  // consensus_method + rankBy wiring (pure)
  require("./de-analysis.tests.js");      // DE wizard helpers + validation maxTokens (pure)
  require("./group-data.tests.js");       // sample-data group parsing (pure)
  require("./pending-update.tests.js");   // updateAnalysis accumulator merge (pure)
  require("./result-table-sorters.tests.js"); // result-table column sorters + default-sort method (pure)
  require("./pathway-selection.tests.js"); // pathway top-N follows table sort + ranking helper (pure)
  require("./gene-selection.tests.js");    // DE-gene "select top N" + "use all DE genes" (analysis DE set) helpers (pure)
  require("./significance-filter.tests.js"); // Venn/forest "FDR <= x and |Score| >= y" predicate, 0 = filter off (pure)
  require("./fold-change.tests.js");        // meta fold-change log2 normalization (pure)
  require("./metadata-values.tests.js");    // case-insensitive metadata value dedup/aggregation (pure)
  require("./tag-display.tests.js");       // selection-tag cap "+N more" helper (pure)
  require("./insight-list-model.tests.js"); // first-panel-open + insight item model + view-insight routing (pure)
  require("./volcano-plot-options.tests.js"); // DE volcano plot ECharts option builder (pure)
  require("./gene-volcano-options.tests.js"); // DE-gene volcano plot ECharts option builder: focus/label/hide-rescale/border (pure)
  require("./volcano-label-layout.tests.js"); // DE-gene volcano staircase label placement: clustering/packing/row cap (pure)
  require("./heatmap-ordering.tests.js"); // Pathway Heat Map column/row ordering + metadata/markpoint remap (pure)
  require("./pathway-result-csv.tests.js"); // Pathway Heat Map result-table CSV export builder (pure)
  require("./geneset-membership.tests.js"); // GO/pathway category gene-membership rows + CSV + filter (pure)
  require("./interpretation-context.tests.js"); // Review Context row formatting (pure)
  require("./insight-name.tests.js");          // insight rename validation (pure)
  require("./study-name.tests.js");            // study rename: name validation + offer predicate (pure) + renameStudy guard/persist (fakes)
  require("./missing-input.tests.js");         // missing-upload guard (pure) + assertInputFileExists (fs)
  require("./data-retention.tests.js");        // retention staleness helpers + study-expiry cascade/sweep (pure + fs)
  require("./ai-interpretation-selection.tests.js"); // sidebar click/deep link → selection + wizard pre-selection (pure)
  require("./ai-interpretation-reports.tests.js");   // selection → its reports: scoping, grouping, read-only gate (pure)
  require("./ai-section-gating.tests.js");           // wizard Pathways/DE-Genes gating + pathway-only pathway-member naming (pure)
  require("./pgsea-input.tests.js");           // PGSEA Gene/Fold-Change/P-value normalizer + ranking (pure)
  require("./pgsea-logfcse.tests.js");         // PGSEA logFCSE derived from FC + p: round trip + clamps (pure)
  require("./pgsea-gene-meta-rscript.tests.js"); // Gene-level meta over pgsea datasets keeps every gene (R integration, guarded)
  require("./input-type-policy.tests.js");     // Interpretation gating / pgsea 3-column flags (pure)
  require("./pgsea-detection.tests.js");       // folder detection prompt accepts header/3-col PGSEA + response parse (pure)
  require("./organism-sort.tests.js");         // organism dropdown alphabetical ordering (pure)
  require("./ownership.tests.js");             // per-study ownership predicates + analysisId reverse-lookup selector (pure)
  require("./share-link.tests.js");            // share link status/expiry/url helpers (pure)
  require("./clone-id-map.tests.js");          // clone id remapping: meta sources, custom gene-set ids, workflow rows (pure)
  require("./share-selection.tests.js");       // share selection: owner-side meta auto-inclusion vs strict re-check of a stored link (pure)
  require("./case-study-shares.tests.js");     // permanent case-study shares: settings read + idempotent boot seeder (pure + fakes)
  require("./baseline-reports.tests.js");      // owner-supplied baseline reports: settings read + skip-if-present boot seeder (pure + fakes)
  require("./report-export-parity.tests.js");  // PDF/Word exports parse markdown by the same GFM rules the website renders with (pure)
  require("./dataset-genes.tests.js");         // meta payload datasets[].genes mapping + symbol-less shape guard (pure)
  require("./dataset-pathways.tests.js");      // meta payload datasets[].pathways name/gene resolution + pathwayId stability (pure)
  require("./ai-workflow-payload.tests.js");   // single payload unchanged + meta per-dataset lists restricted to the selection (fakes)
  require("./report-templates.tests.js");      // report body: export + TOC across ALL templates, not the open one (pure)
  require("./recent-studies.tests.js");        // homepage study count and the Recent Studies list share one selector (pure)
  require("./meta-pathway-info.tests.js");     // meta wizard table: custom gene-set resolution + no silent drop (pure)
  require("./meta-analysis-context.tests.js"); // meta dataset metadata rebuilt from the study, so a clone keeps its context (pure)
  require("./pipeline-steps.tests.js");        // AI report progress row: non-contiguous step list + execution-order status (pure)
  require("./method-results.tests.js");        // /api/resultData reader: absent db/analysis keys yield null, never a throw or undefined (pure)
  require("./homepage-demos.tests.js");        // homepage demos: analysis naming, example auto-load gate, video-tutorial flag (pure)
  // NOTE: the antd-import regression guard (Empty/Radio) can't run here — meteor test
  // executes from a temp build bundle with no access to the .jsx source. It lives as a
  // standalone static check: `npm run test:imports` (scripts/check-antd-imports.js).
}

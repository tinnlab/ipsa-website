// Interpretation payloads built by server/api/methods/aiWorkflow.js, run against an in-memory
// stand-in for DBCollections.
//
// 1. Single-analysis guard: transformToExternalFormat shares getDatasetPathways with the meta
//    transform (pathway-only submissions resolve organism-scoped gene membership through it). The
//    meta selection restriction must not change that payload, so its output is pinned here to the
//    exact object origin/main produces for the same fixture.
// 2. Meta grounding: per-dataset pathways and genes are restricted to the user's selection.
import assert from "assert";
import {
  getDatasetPathways,
  transformMetaAnalysisToExternalFormat,
  transformToExternalFormat,
} from "../server/api/methods/aiWorkflow";

// Equality and {$in: [...]} selectors — all getDatasetPathways / getDatasetGenes use.
const matches = (doc, selector) => Object.entries(selector).every(([field, cond]) => {
  if (cond && typeof cond === "object" && Array.isArray(cond.$in)) {
    return cond.$in.map(String).includes(String(doc[field]));
  }
  return doc[field] === cond;
});

const fakeCollection = (docs) => ({
  find: (selector = {}) => ({fetchAsync: async () => docs.filter(d => matches(d, selector))}),
  findOneAsync: async (selector = {}) => docs.find(d => matches(d, selector)),
});

const KEGG_ROWS = [
  {pathway: "path:hsa00010", pValue: 0.001, pValueFDR: 0.01, score: 1.5},
  {pathway: "path:hsa00020", pValue: 0.002, pValueFDR: 0.02, score: -1.2},
  {pathway: "path:hsa00030", pValue: 0.5, pValueFDR: 0.9, score: 0.1},
];

const fixture = () => ({
  AnalysisConfig: fakeCollection([
    {analysisId: "A1", key: "selectedDatasets", value: [{id: "DB1", name: "KEGG"}]},
    {analysisId: "A1", key: "taxId", value: "9606"},
    {analysisId: "A2", key: "selectedDatasets", value: [{id: "DB1", name: "KEGG"}]},
    {analysisId: "A2", key: "taxId", value: "9606"},
  ]),
  AnalysisConfigSnapshot: fakeCollection([
    {analysisId: "A1", key: "DEGenes", value: [
      {symbol: "HK1", FC: 1.1, pValue: 1e-4, pValueFDR: 1e-3},
      {symbol: "CS", FC: -0.9, pValue: 1e-3, pValueFDR: 1e-2},
      {symbol: "TP53", FC: 0.2},
    ]},
    {analysisId: "A2", key: "DEGenes", value: [{symbol: "Hk1", FC: 0.7}, {symbol: "Pfkm", FC: 0.3}]},
  ]),
  AnalysisResult: fakeCollection([
    {analysisId: "A1", databaseId: "DB1", key: "fgsea", value: KEGG_ROWS},
    // A2's rows carry both id fields and they differ: the selection's originalId is the ID.
    {analysisId: "A2", databaseId: "DB1", key: "fgsea", value: [
      {pathway: "local-10", ID: "path:hsa00010", pValue: 0.003, pValueFDR: 0.03, score: 1.1},
      {pathway: "local-20", ID: "path:hsa00020", pValue: 0.004, pValueFDR: 0.04, score: -0.4},
    ]},
  ]),
  Organism: fakeCollection([{_id: "ORG1", taxId: "9606"}]),
  GeneSet: fakeCollection([
    {id: "path:hsa00010", database: "DB1", organism: "ORG1", name: "Glycolysis", genes: ["1", "2"]},
    {id: "path:hsa00020", database: "DB1", organism: "ORG1", name: "TCA cycle", genes: ["3"]},
    {id: "local-10", database: "DB1", organism: "ORG1", name: "Glycolysis", genes: ["1", "2"]},
    {id: "local-20", database: "DB1", organism: "ORG1", name: "TCA cycle", genes: ["3"]},
  ]),
  GeneInfo: fakeCollection([
    {_id: "1", symbol: "HK1"}, {_id: "2", symbol: "PFKM"}, {_id: "3", symbol: "CS"},
  ]),
  Database: fakeCollection([{_id: "DB1", name: "KEGG"}]),
});

const withFakeCollections = (fn) => async function () {
  const saved = global.DBCollections;
  global.DBCollections = fixture();
  try {
    await fn();
  } finally {
    global.DBCollections = saved;
  }
};

describe("aiWorkflow interpretation payloads", function () {
  describe("single-analysis payload is unchanged (shares getDatasetPathways)", function () {
    it("pathway-only submission: exactly the origin/main payload", withFakeCollections(async () => {
      const payload = await transformToExternalFormat({
        pathways: [
          {id: "KEGG:path:hsa00010", originalId: "path:hsa00010", name: "Glycolysis", database: "KEGG",
           pValue: 0.001, pValueFDR: 0.01, score: 1.5, genes: ["HK1"]},
          {id: "KEGG:path:hsa00020", originalId: "path:hsa00020", name: "TCA cycle", database: "KEGG",
           pValue: 0.002, pValueFDR: 0.02, score: -1.2, genes: []},
        ],
        genes: [],
        analysisId: "A1",
        consolidatedMetadata: {organism: "Homo sapiens", tissue: "liver"},
      });
      assert.deepStrictEqual(payload, {
        metadata: {organism: "Homo sapiens", tissue: "liver"},
        genes: [],
        pathways: [
          {name: "Glycolysis", source: "KEGG", pathwayId: "path:hsa00010", pValue: 0.001,
           pValueFDR: 0.01, ES: 1.5, NES: 1.5, genes: ["HK1", "PFKM"]},
          {name: "TCA cycle", source: "KEGG", pathwayId: "path:hsa00020", pValue: 0.002,
           pValueFDR: 0.02, ES: -1.2, NES: -1.2, genes: ["CS"]},
        ],
        enable_validation: false,
        strict_mode: false,
      });
      // The failure this call site has had before: every pathway with an empty membership.
      assert.ok(payload.pathways.every(p => p.genes.length > 0));
    }));

    it("getDatasetPathways without a selection returns today's significant list",
      withFakeCollections(async () => {
        const pathways = await getDatasetPathways("A1", undefined);
        assert.deepStrictEqual(pathways.map(p => [p.pathwayId, p.name, p.genes]), [
          ["path:hsa00010", "Glycolysis", ["HK1", "PFKM"]],
          ["path:hsa00020", "TCA cycle", ["CS"]],
        ]);
      }));
  });

  describe("meta payload is grounded in the selection", function () {
    const metaData = () => ({
      pathways: [
        {id: "KEGG:path:hsa00010", originalId: "path:hsa00010", name: "Glycolysis", database: "KEGG",
         pValue: 1e-6, pValueFDR: 1e-5, score: 2, genes: ["HK1"]},
      ],
      // Shaped as the wizard sends it: {id, name}, no geneSymbol, symbol case differs.
      genes: [{id: "row-1", name: "hk1", foldChange: 1, pValue: 1e-4, pValueFDR: 1e-3}],
      analysisType: "meta-analysis",
      metaAnalysisData: {
        datasetsMetadata: {D1: {extracted: {tissue: "muscle"}}, D2: {extracted: {tissue: "muscle"}}},
        individualAnalyses: [{id: "A1", name: "D1"}, {id: "A2", name: "D2"}],
      },
    });

    it("restricts per-dataset pathways to (selected AND significant)", withFakeCollections(async () => {
      const payload = await transformMetaAnalysisToExternalFormat(metaData());
      const [d1, d2] = payload.datasets;
      assert.deepStrictEqual(d1.pathways.map(p => p.name), ["Glycolysis"]);
      // A2 rows have pathway ≠ ID; the selection's originalId is the ID and still matches.
      assert.deepStrictEqual(d2.pathways.map(p => p.pathwayId), ["local-10"]);
    }));

    it("restricts per-dataset genes to the selection, case-insensitively", withFakeCollections(async () => {
      const payload = await transformMetaAnalysisToExternalFormat(metaData());
      assert.deepStrictEqual(payload.datasets.map(d => d.genes.map(g => g.geneSymbol)), [["HK1"], ["Hk1"]]);
    }));
  });
});

// Meteor methods for AI Workflow
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Random } from 'meteor/random';
import axios from 'axios';
import { aggregateMetadataValue } from '../../../imports/utils/metadataValues';
import { mapDatasetGenes } from '../../../imports/utils/datasetGenes';
import {
  indexGeneSets,
  indexGeneSymbols,
  mapDatasetPathways,
  selectSignificantPathwayIds
} from '../../../imports/utils/datasetPathways';
import {
  indexPathwayMembership,
  pathwayLookupKey,
  resolvePathwayGenes
} from '../../../imports/utils/aiPathwayGenes';
import { getDEGenes } from './visualizationCore';
import { assertOwnsAnalysis, assertOwnsSession, assertWritableSession } from '../../helper/ownership';

// External pipeline API configuration
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_PIPELINE_API_URL || 'http://host.docker.internal:6000';

/**
 * Per-submission lookup cache shared by every dataset of one meta-analysis.
 *
 * A 15-dataset mass analysis is typically 15 runs of the SAME database and organism over a largely
 * overlapping pathway space, so without this the same `GeneSet` and `GeneInfo` documents are
 * fetched 15 times. Misses are cached too (as null), so a genuinely absent id is not re-queried
 * once per dataset. Created per invocation — plain Maps, no module-level state, so nothing goes
 * stale between submissions and nothing leaks.
 */
function createPathwayLookupCache() {
  return {
    organismByTaxId: new Map(), // taxId -> Organism._id | null
    geneSets: new Map(),        // `${dbId}::${organismId}::${pathwayId}` -> {id, name, genes} | null
    symbols: new Map()          // Entrez id -> {_id, symbol} | null
  };
}

/**
 * Resolve the analysis's organism, as a GeneSet-scoping id.
 *
 * `taxId` is written to both AnalysisConfig and AnalysisConfigSnapshot depending on the code path
 * that created the analysis, so read both rather than silently losing the organism (and with it
 * every gene list) for half the analyses.
 */
async function getAnalysisOrganismId(analysisId, cache) {
  const taxIdRow =
    (await DBCollections.AnalysisConfig.findOneAsync({analysisId, key: 'taxId'})) ||
    (await DBCollections.AnalysisConfigSnapshot.findOneAsync({analysisId, key: 'taxId'}));
  const taxId = taxIdRow?.value;
  if (!taxId) return null;

  if (cache.organismByTaxId.has(taxId)) return cache.organismByTaxId.get(taxId);
  const organism = await DBCollections.Organism.findOneAsync({taxId: String(taxId)});
  const organismId = organism?._id || null;
  cache.organismByTaxId.set(taxId, organismId);
  return organismId;
}

/**
 * Fetch the `GeneSet` documents for a database's pathways — name AND member gene ids in one read.
 *
 * This is the same `{database, organism, id}` lookup the "genes in a pathway" viewer performs
 * (imports/client/utils/geneSetGenesData.js `loadPathwayGeneRows` via `geneSet.getInfo`), so the
 * payload and the UI resolve pathway membership identically. It is fully served by the unique
 * index `{database: 1, organism: 1, id: 1}` (server/startup/collections.js). Queried directly
 * rather than through Meteor.callAsync: a nested method call buys nothing server-to-server and
 * would return whole documents with no projection.
 *
 * With no organism we do NOT widen to `{id: {$in: ids}}`. GO and MitoCarta ids are shared across
 * organisms, so an unscoped read returns one document per organism and would attach some other
 * species' gene list. We fall back to database-scoped, keep the name when every matching document
 * agrees (names are organism-invariant for the current builders) and leave the gene list empty
 * otherwise — names recovered, no wrong-organism membership.
 */
async function fetchGeneSets({dbId, organismId, pathwayIds, cache}) {
  if (!pathwayIds.length) return {docs: [], ambiguousOrganism: 0};

  const scope = organismId || '*';
  const missing = pathwayIds.filter(id => !cache.geneSets.has(`${dbId}::${scope}::${id}`));

  if (missing.length) {
    const selector = organismId
      ? {id: {$in: missing}, database: dbId, organism: organismId}
      : {id: {$in: missing}, database: dbId};
    const fetched = await DBCollections.GeneSet.find(
      selector,
      {fields: {id: 1, name: 1, genes: 1}}
    ).fetchAsync();

    const byId = new Map();
    fetched.forEach(doc => {
      const key = String(doc.id);
      if (!byId.has(key)) {
        byId.set(key, doc);
        return;
      }
      // Only reachable on the organism-less fallback: the same id in more than one organism.
      const kept = byId.get(key);
      byId.set(key, {
        id: doc.id,
        name: kept.name === doc.name ? kept.name : null,
        genes: [],
        ambiguousOrganism: true
      });
    });

    missing.forEach(id => cache.geneSets.set(`${dbId}::${scope}::${id}`, byId.get(id) || null));
  }

  let ambiguousOrganism = 0;
  const docs = [];
  pathwayIds.forEach(id => {
    const doc = cache.geneSets.get(`${dbId}::${scope}::${id}`);
    if (!doc) return;
    if (doc.ambiguousOrganism) ambiguousOrganism += 1;
    docs.push(doc);
  });

  return {docs, ambiguousOrganism};
}

/**
 * Resolve Entrez gene ids to symbols via `GeneInfo` — the same collection `visualization.getGeneInfo`
 * serves, which is deliberately unguarded shared reference data (see visualization.js).
 *
 * GeneInfo lives on a SEPARATE Mongo (IDMappingDB). If that connection is down we return an empty
 * map, which makes every pathway's gene list empty and is loudly reported — rather than aborting an
 * otherwise complete submission, and never falling back to emitting Entrez ids as symbols.
 */
async function fetchGeneSymbols(geneIds, analysisId, cache) {
  if (!geneIds.length) return [];

  const missing = geneIds.filter(id => !cache.symbols.has(id));
  if (missing.length) {
    try {
      const docs = await DBCollections.GeneInfo.find(
        {_id: {$in: missing}},
        {fields: {_id: 1, symbol: 1}}
      ).fetchAsync();
      const byId = new Map(docs.map(doc => [String(doc._id), doc]));
      missing.forEach(id => cache.symbols.set(id, byId.get(id) || null));
    } catch (error) {
      console.error(
        `  [getDatasetPathways] GeneInfo lookup failed for analysis ${analysisId}; pathway gene ` +
        `lists will be empty rather than filled with Entrez ids. ${error.message}`
      );
      return [];
    }
  }

  return geneIds.map(id => cache.symbols.get(id)).filter(Boolean);
}

/**
 * Helper: Get pathway results for a specific dataset/analysis
 *
 * Pathway names and gene symbols are resolved from the analysis's own gene-set definitions. They
 * used to be read off the result rows themselves (`row.name || row.pathway || row.ID`,
 * `row.genes || []`), which only ever works for the CONSENSUS row shape; the rows a per-method
 * run stores carry neither, so every standard-database pathway shipped as its raw id with an empty
 * gene list. See imports/utils/datasetPathways.js for the full note.
 */
async function getDatasetPathways(analysisId, sessionId, cache = createPathwayLookupCache()) {
  // The cache is shared across a submission's datasets, but must never be OPTIONAL to the helpers
  // below: a missing one would make every lookup miss and hand back exactly the empty gene lists
  // this change exists to fix. Defaulted here so a standalone call still resolves fully.

  // Get selected databases for this analysis
  const selectedDatabases = await DBCollections.AnalysisConfig.find({
    analysisId,
    key: 'selectedDatasets'
  }).fetchAsync();

  if (!selectedDatabases.length) {
    console.log(`  [getDatasetPathways] No selected databases for analysis ${analysisId}`);
    return [];
  }

  const databases = selectedDatabases[0].value || [];
  const pathways = [];
  console.log(`  [getDatasetPathways] Processing ${databases.length} databases for analysis ${analysisId}`);

  // Fetch custom gene sets for this analysis to get pathway names
  const customGeneSetsSnapshots = await DBCollections.AnalysisConfigSnapshot.find({
    analysisId,
    key: 'customGeneSets'
  }).fetchAsync();

  // Build a map of custom gene set ID -> gene set data (including pathway names)
  const customGeneSetsMap = {};
  customGeneSetsSnapshots.forEach(snapshot => {
    if (snapshot.value && snapshot.value.id && snapshot.value.geneSets) {
      // Map each pathway by its ID within this custom gene set
      snapshot.value.geneSets.forEach(geneSet => {
        customGeneSetsMap[geneSet.id] = {
          name: geneSet.name || geneSet.id,
          genes: geneSet.genes || [],
          customGeneSetName: snapshot.value.name
        };
      });
    }
  });

  console.log(`  [getDatasetPathways] Found ${Object.keys(customGeneSetsMap).length} custom gene set pathways`);

  // Scopes every GeneSet read below. Resolved once per analysis, shared across its databases.
  const organismId = await getAnalysisOrganismId(analysisId, cache);
  if (!organismId) {
    console.warn(
      `  [getDatasetPathways] Could not resolve an organism for analysis ${analysisId}; falling ` +
      `back to a database-scoped gene-set lookup (names only for ids shared across organisms).`
    );
  }

  const diagnostics = {unnamed: 0, unnamedIds: [], symbolless: 0, symbollessIds: [],
                       emptyMembership: 0, ambiguousOrganism: 0};

  for (const db of databases) {
    // Database might be stored as a string (just the ID) or as an object
    const dbId = typeof db === 'string' ? db : db.id;
    const dbNameFromConfig = typeof db === 'object' ? db.name : null;

    console.log(`  [getDatasetPathways] Database ID: ${dbId}, type: ${typeof db}`);

    const results = await DBCollections.AnalysisResult.find({
      analysisId,
      databaseId: dbId
    }).fetchAsync();

    // `results` is not filtered by `key` (the method) or `inputType` and is not sorted, so for a
    // multi-method analysis Mongo's return order decides both the row SHAPE and which p-values
    // ship. Left as-is deliberately — fixing it would change which numbers are sent, which this
    // change is not for — but logged, so a real run tells us whether it ever happens.
    if (results.length > 1) {
      console.warn(
        `    ⚠️  ${results.length} result rows for analysis ${analysisId} / database ${dbId} ` +
        `(keys: ${JSON.stringify(results.map(r => r.key))}); using the first, arbitrarily.`
      );
    }

    if (results.length > 0 && results[0].value) {
      // A custom gene set is identified by its snapshot, independently of whether the name came
      // from config. Previously `isCustomGeneSet` could only become true inside the `if (!dbName)`
      // branch, so a `selectedDatasets` entry stored as an object with a `name` skipped the custom
      // lookup entirely — and would now also run a GeneSet query matching nothing and then loudly
      // report every one of its pathways as unresolved, about data sitting in customGeneSetsMap
      // the whole time. `dbName` resolution below is unchanged, so `pathways[].source` is too.
      const customGeneSetSnapshot = customGeneSetsSnapshots.find(s => s.value && s.value.id === dbId);
      const isCustomGeneSet = !!customGeneSetSnapshot;

      let dbName = dbNameFromConfig;
      if (!dbName) {
        if (isCustomGeneSet) {
          dbName = customGeneSetSnapshot.value.name;
        } else {
          // Check Database collection for standard databases
          const dbDoc = await DBCollections.Database.findOneAsync({ _id: dbId });
          dbName = dbDoc ? (dbDoc.name || dbDoc._id) : 'Unknown';
        }
      }

      const rows = results[0].value;
      console.log(`    Database ${dbName} (ID: ${dbId}, custom: ${isCustomGeneSet}): ${rows.length} pathways`);

      // Resolve only the pathways that will survive the FDR filter below — ~49 of ~359 for a
      // typical KEGG run. `selectSignificantPathwayIds` reads the id and the FDR through the same
      // helpers the mapper emits with, so this can never leave a surviving pathway unresolved.
      const significantIds = selectSignificantPathwayIds(rows);

      let geneSetIndex = new Map();
      let symbolIndex = new Map();
      if (!isCustomGeneSet && significantIds.length) {
        const {docs, ambiguousOrganism} = await fetchGeneSets({
          dbId, organismId, pathwayIds: significantIds, cache
        });
        diagnostics.ambiguousOrganism += ambiguousOrganism;
        geneSetIndex = indexGeneSets(docs);

        // GeneSet.genes are bare NCBI Entrez ids for every builder; the pipeline keys on symbols.
        const memberIds = Array.from(
          new Set(docs.flatMap(doc => (Array.isArray(doc.genes) ? doc.genes : []).map(String)))
        );
        symbolIndex = indexGeneSymbols(await fetchGeneSymbols(memberIds, analysisId, cache));
      }

      const mapped = mapDatasetPathways({
        rows,
        source: dbName,
        geneSetIndex,
        symbolIndex,
        customPathways: isCustomGeneSet ? customGeneSetsMap : null,
        resolvableIds: new Set(significantIds)
      });

      pathways.push(...mapped.pathways);
      diagnostics.unnamed += mapped.unnamed;
      diagnostics.unnamedIds.push(...mapped.unnamedIds);
      diagnostics.symbolless += mapped.symbolless;
      diagnostics.symbollessIds.push(...mapped.symbollessIds);
      diagnostics.emptyMembership += mapped.emptyMembership;

      console.log(`    Processed ${rows.length} pathways from ${dbName}`);
    }
  }

  // Loud, counted reporting of everything that could not be resolved. An unresolved name still
  // ships as its pathway id — the row cannot be dropped, it is a cross-dataset matching key — and
  // an unresolved gene symbol is dropped rather than emitted as its Entrez id. Either way the
  // degradation is visible here instead of looking like valid data, which is exactly how the
  // original defect survived.
  if (diagnostics.unnamed > 0) {
    console.error(
      `  [getDatasetPathways] ${diagnostics.unnamed} significant pathways for analysis ` +
      `${analysisId} could not be resolved to a name and ship as their raw id. ` +
      `Sample: ${JSON.stringify(diagnostics.unnamedIds.slice(0, 10))}`
    );
  }
  if (diagnostics.symbolless > 0) {
    console.error(
      `  [getDatasetPathways] ${diagnostics.symbolless} pathway gene entries for analysis ` +
      `${analysisId} had no gene symbol and were dropped (never emitted as Entrez ids). ` +
      `Sample ids: ${JSON.stringify(diagnostics.symbollessIds.slice(0, 10))}`
    );
  }
  if (diagnostics.emptyMembership > 0) {
    console.warn(
      `  [getDatasetPathways] ${diagnostics.emptyMembership} significant pathways for analysis ` +
      `${analysisId} have an empty gene set definition.`
    );
  }
  if (diagnostics.ambiguousOrganism > 0) {
    console.warn(
      `  [getDatasetPathways] ${diagnostics.ambiguousOrganism} pathway ids for analysis ` +
      `${analysisId} matched more than one organism; their gene lists were left empty rather ` +
      `than filled from an arbitrary species.`
    );
  }

  // Filter to only significant pathways (pValueFDR < 0.05)
  const significantPathways = pathways.filter(p => p.pValueFDR < 0.05);
  console.log(`  [getDatasetPathways] Total pathways: ${pathways.length}, significant (FDR < 0.05): ${significantPathways.length}`);
  if (significantPathways.length > 0) {
    console.log(`  [getDatasetPathways] Sample pathway:`, JSON.stringify(significantPathways[0], null, 2));
  }
  return significantPathways;
}

/**
 * Helper: Get DE genes for a specific dataset (if expression-based)
 */
async function getDatasetGenes(analysisId, sessionId) {
  // Read the SAME source as the DE-genes table in the AI-interpretation view — /api/deGenes,
  // i.e. getDEGenes → the `DEGenes` snapshot — so this payload cannot drift from what the user
  // sees. This previously read the `volcanoPlotData` snapshot and mapped `gene.gene`,
  // `gene.log2FoldChange`, `gene.pvalue` and `gene.padj`; no stored row has ever had those
  // field names (they carry `id`/`FC`/`pValue`/`pValueFDR`), so every gene was sent as a
  // numeric Entrez id with foldChange 0 and pValue/pValueFDR 1.
  //
  // `sessionId` is supplied by the only caller below, but the method's check() leaves it
  // optional, so fall back to reading the snapshot directly rather than silently returning [].
  const rows = sessionId
    ? await getDEGenes({sessionId, analysisId})
    : (await DBCollections.AnalysisConfigSnapshot.findOneAsync({analysisId, key: 'DEGenes'}))?.value;

  const {genes, total, symbolless, sampleKeys} = mapDatasetGenes(rows);

  if (symbolless > 0) {
    // getDEGenes has a meta-analysis branch returning metaDE `volcanoPlotData` rows
    // ({ID, logFC, pValue, pFDR}) that carry no `symbol`. An individual mass-analysis dataset
    // should never take that branch — it is reached only for ids in session.metaAnalyses — but
    // if it ever does, drop those rows loudly instead of emitting Entrez ids as symbols. The
    // pipeline keys datasets by geneSymbol, so ids would match nothing and quietly turn every
    // meta gene into a "meta-unique" finding: the exact defect this function is fixing.
    console.error(
      `  [getDatasetGenes] ${symbolless}/${total} rows for analysis ${analysisId} carry no gene ` +
      `symbol and were dropped. Row keys: ${JSON.stringify(sampleKeys)}`
    );
  }

  return genes;
}

/**
 * Transform meta-analysis data to external API format for /api/meta-pipeline
 */
async function transformMetaAnalysisToExternalFormat(data) {
  // Create gene ID to symbol mapping from DE genes
  const geneIdToSymbol = new Map();
  data.genes.forEach(gene => {
    if (gene.id && gene.name) {
      geneIdToSymbol.set(String(gene.id), gene.name);
    }
  });

  // Transform META-LEVEL (consensus) genes
  const metaGenes = data.genes.map(gene => ({
    geneSymbol: gene.name || gene.id,
    foldChange: gene.foldChange || 0,
    pValue: gene.pValue || 1,
    pValueFDR: gene.pValueFDR || 1
  }));

  // Transform META-LEVEL (consensus) pathways
  const metaPathways = data.pathways.map(pathway => {
    let geneSymbols = [];

    // If pathway has genes, use them (should already be converted by frontend)
    if (pathway.genes && pathway.genes.length > 0) {
      geneSymbols = pathway.genes.filter(Boolean);
    } else {
      // Log warning if genes are empty
      console.warn(`  ⚠️  Meta pathway "${pathway.name}" has no genes`);
    }

    return {
      name: pathway.name,
      source: pathway.database || 'Unknown',
      pathwayId: pathway.originalId || pathway.id,
      pValue: pathway.pValue || 1,
      pValueFDR: pathway.pValueFDR || 1,
      // `score` is the fgsea NES; forward it as NES (falls back from normalizedScore).
      // See the note at the getDatasetPathways site above.
      ES: pathway.score || 0,
      NES: pathway.normalizedScore || pathway.score || 0,
      genes: geneSymbols
    };
  });

  // Build DATASETS array from individual analyses
  const datasets = [];
  const allMetadataFields = new Set();
  // Shared across every dataset below: they are usually the same database and organism over a
  // largely overlapping pathway space, so this collapses ~15 GeneSet/GeneInfo round trips into ~1.
  const pathwayLookupCache = createPathwayLookupCache();

  if (data.metaAnalysisData) {
    const { datasetsMetadata, individualAnalyses } = data.metaAnalysisData;

    console.log(`📦 Processing ${individualAnalyses.length} individual datasets for meta-analysis...`);

    if (individualAnalyses.length === 0) {
      console.error('⚠️ ERROR: individualAnalyses array is empty!');
      console.error('   This will result in an empty datasets array in the meta-pipeline request.');
      console.error('   datasetsMetadata keys:', Object.keys(datasetsMetadata));
    }

    for (const analysis of individualAnalyses) {
      const datasetName = analysis.name;
      const datasetMetadata = datasetsMetadata[datasetName]?.extracted || {};

      console.log(`  Processing dataset: ${datasetName}`);

      // Collect all metadata field names for meta-level aggregation
      Object.keys(datasetMetadata).forEach(field => allMetadataFields.add(field));

      // Fetch individual dataset pathway results
      const datasetPathways = await getDatasetPathways(analysis.id, data.sessionId, pathwayLookupCache);
      const datasetGenes = await getDatasetGenes(analysis.id, data.sessionId);

      console.log(`    - Pathways: ${datasetPathways.length}`);
      console.log(`    - Genes: ${datasetGenes.length}`);
      console.log(`    - Metadata fields: ${Object.keys(datasetMetadata).length}`);

      // Verify pathway structure
      if (datasetPathways.length > 0) {
        const firstPathway = datasetPathways[0];
        console.log(`    - First pathway has name: ${!!firstPathway.name}, pathwayId: ${!!firstPathway.pathwayId}`);
        if (!firstPathway.name) {
          console.error(`    ❌ ERROR: Pathway missing name!`, firstPathway);
        }
      }

      datasets.push({
        dataset_name: datasetName,
        metadata: {
          organism: 'Homo sapiens',
          ...datasetMetadata // Include all custom metadata fields from dataset
        },
        genes: datasetGenes,
        pathways: datasetPathways
      });
    }
  }

  // Build meta-level metadata by aggregating common values
  const metaMetadata = { organism: 'Homo sapiens' };

  // For each metadata field, check if all datasets have the same value
  allMetadataFields.forEach(field => {
    const values = datasets
      .map(d => d.metadata[field])
      .filter(v => v !== undefined && v !== null && v !== '');

    if (values.length > 0) {
      // Merge values differing only by case/whitespace (e.g. "female"/"Female") so a single
      // concept is not listed as multiple distinct values.
      metaMetadata[field] = aggregateMetadataValue(values);
    }
  });

  // Override with user-provided consolidated metadata from the modal
  const consolidatedMetadata = data.consolidatedMetadata || null;
  if (consolidatedMetadata) {
    console.log('📊 Meta-analysis: Using consolidated metadata from template validation');
    if (consolidatedMetadata.organism) metaMetadata.organism = consolidatedMetadata.organism;
    if (consolidatedMetadata.tissue) metaMetadata.tissue = consolidatedMetadata.tissue;
    if (consolidatedMetadata.disease) metaMetadata.disease = consolidatedMetadata.disease;

    // Build description from comparison + experimental_context
    const descriptionParts = [];
    if (consolidatedMetadata.experimental_context) {
      descriptionParts.push(consolidatedMetadata.experimental_context);
    }
    if (consolidatedMetadata.comparison) {
      descriptionParts.push(`Comparison: ${consolidatedMetadata.comparison}`);
    }
    if (descriptionParts.length > 0) {
      metaMetadata.description = descriptionParts.join('; ');
    }
  }

  console.log(`📊 Meta-analysis transform complete:`);
  console.log(`   - Meta pathways: ${metaPathways.length}`);
  console.log(`   - Meta genes: ${metaGenes.length}`);
  console.log(`   - Datasets: ${datasets.length}`);
  console.log(`   - Meta metadata fields:`, Object.keys(metaMetadata));

  return {
    meta: {
      metadata: metaMetadata,
      genes: metaGenes,
      pathways: metaPathways,
      enable_validation: false,
      strict_mode: false
    },
    datasets: datasets,
    max_workers: Math.min(datasets.length + 1, 4),
    enable_validation: true,
    strict_mode: false
  };
}

/**
 * Transform internal data format to external API format
 */
async function transformToExternalFormat(data) {
  // Prioritize consolidated metadata over legacy contextFields
  const consolidatedMetadata = data.consolidatedMetadata || null;
  const context = data.analyses && data.analyses.length > 0 ? data.analyses[0].contextFields : {};

  // Determine which metadata source to use
  let organism, tissue, disease, description;

  if (consolidatedMetadata) {
    // Use template-validated metadata (preferred)
    console.log('📊 Using consolidated metadata from template validation');
    organism = consolidatedMetadata.organism || 'Homo sapiens';
    tissue = consolidatedMetadata.tissue || '';
    disease = consolidatedMetadata.disease || null; // null if not a disease study

    // Build comprehensive description from all available context
    const descriptionParts = [];
    if (consolidatedMetadata.experimental_context) {
      descriptionParts.push(consolidatedMetadata.experimental_context);
    }
    if (consolidatedMetadata.comparison) {
      descriptionParts.push(`Comparison: ${consolidatedMetadata.comparison}`);
    }
    // Include additional metadata if available
    if (consolidatedMetadata.additional_metadata) {
      Object.entries(consolidatedMetadata.additional_metadata).forEach(([key, value]) => {
        if (value && !['organism', 'tissue', 'disease'].includes(key)) {
          descriptionParts.push(`${key}: ${value}`);
        }
      });
    }
    description = descriptionParts.join('; ');
  } else {
    // Fallback to legacy contextFields
    console.log('⚠️ Using legacy contextFields (no consolidated metadata)');
    organism = 'Homo sapiens';
    tissue = context.tissueType || '';
    disease = context.disease || '';

    // Build description from condition and control if no explicit description
    description = context.description || '';
    if (!description) {
      const parts = [];
      if (context.condition) parts.push(context.condition);
      if (context.control) parts.push(`Control: ${context.control}`);
      description = parts.join('; ');
    }
  }

  // Create Set of selected DE gene IDs for filtering
  const selectedGeneIds = new Set();
  data.genes.forEach(gene => {
    if (gene.id) {
      selectedGeneIds.add(String(gene.id));
    }
  });

  console.log(`📊 Selected DE genes: ${selectedGeneIds.size} genes`);

  // Create mapping from gene ID to gene symbol
  const geneIdToSymbol = new Map();
  data.genes.forEach(gene => {
    if (gene.id && gene.name) {
      geneIdToSymbol.set(String(gene.id), gene.name);
    }
  });

  console.log(`📊 Gene ID to symbol mapping: ${geneIdToSymbol.size} genes`);

  // Transform genes
  const genes = data.genes.map(gene => ({
    geneSymbol: gene.name || gene.id,
    foldChange: gene.foldChange || 0,
    pValue: gene.pValue || 1,
    pValueFDR: gene.pValueFDR || 1
  }));

  // With no DE genes in the payload — the user unticked "DE Genes", or the analysis has no
  // gene-level data — filtering pathway membership against the (empty) selected set would leave
  // EVERY pathway with `genes: []`, and the report's own per-theme pathway tables would then show
  // 0 genes for every row. Resolve the membership instead.
  //
  // NOT from `pathway.genes` as the payload carries it: the wizard fills that from
  // `geneSet.getByIds`, which is not organism-scoped (geneSet.js:140) while GO/MitoCarta ids are
  // shared across organisms, so it can carry another species' gene list. `getDatasetPathways`
  // reads the analysis's OWN organism-scoped gene sets and names them through GeneInfo — the same
  // route the meta per-dataset payload uses, and the one place that already handles custom gene
  // sets, symbol-less ids and the diagnostics for both.
  const pathwayOnly = selectedGeneIds.size === 0;
  let membershipByPathwayId = new Map();
  if (pathwayOnly && data.analysisId) {
    membershipByPathwayId = indexPathwayMembership(
      await getDatasetPathways(data.analysisId, data.sessionId)
    );
    const named = data.pathways.filter(
      p => (membershipByPathwayId.get(pathwayLookupKey(p)) || []).length > 0
    ).length;
    console.log(
      `📊 Pathway-only submission: organism-scoped membership resolved for ` +
      `${named}/${data.pathways.length} selected pathways ` +
      `(${membershipByPathwayId.size} resolvable in this analysis)`
    );
  }

  // Transform pathways
  const pathways = data.pathways.map(pathway => {
    const geneSymbols = resolvePathwayGenes({
      pathway,
      selectedGeneIds,
      geneIdToSymbol,
      membershipByPathwayId
    });

    return {
      name: pathway.name,
      source: pathway.database || 'Unknown',
      pathwayId: pathway.originalId || pathway.id,
      pValue: pathway.pValue || 1,
      pValueFDR: pathway.pValueFDR || 1,
      // `score` is the fgsea NES; forward it as NES (falls back from normalizedScore).
      // See the note at the getDatasetPathways site above.
      ES: pathway.score || 0,
      NES: pathway.normalizedScore || pathway.score || 0,
      genes: geneSymbols
    };
  });

  // Log filtering stats
  const totalPathwayGenes = pathways.reduce((sum, p) => sum + p.genes.length, 0);
  const totalOriginalGenes = data.pathways.reduce((sum, p) => sum + (p.genes?.length || 0), 0);

  if (pathwayOnly) {
    // Nothing was "filtered" here — the payload's own member lists are not used at all in this
    // mode, so reporting them as an input would be misleading. What matters is how many pathways
    // came back with a membership, because an empty one shows up as "0 genes" in the report.
    const empty = pathways.filter(p => p.genes.length === 0).length;
    console.log(`🔬 Pathway genes (no DE genes selected — full organism-scoped membership):`);
    console.log(`   - Pathway gene entries: ${totalPathwayGenes}`);
    console.log(`   - Pathways with no membership resolved: ${empty}/${pathways.length}`);
    if (empty === pathways.length && pathways.length > 0) {
      console.error(
        `   ❌ No pathway membership could be resolved — every pathway will ship an empty gene list ` +
        `and the report's pathway tables will read 0 genes. Check the analysis's organism/taxId ` +
        `and the GeneInfo (IDMappingDB) connection.`
      );
    }
  } else {
    console.log(`🔬 Pathway gene filtering:`);
    console.log(`   - Original pathway genes: ${totalOriginalGenes}`);
    console.log(`   - After filtering (DE genes only): ${totalPathwayGenes}`);
    console.log(`   - Filtered out: ${totalOriginalGenes - totalPathwayGenes} genes`);
  }

  // Show sample pathway
  if (pathways.length > 0) {
    const samplePathway = pathways[0];
    console.log(`   - Sample pathway: "${samplePathway.name}"`);
    console.log(`     Genes (${samplePathway.genes.length}): ${samplePathway.genes.slice(0, 5).join(', ')}${samplePathway.genes.length > 5 ? '...' : ''}`);
  }

  // Build metadata object (matching meta-analysis format)
  const metadata = {
    organism: organism || 'Homo sapiens'
  };

  // Add disease, tissue, description to metadata if they exist
  if (disease) metadata.disease = disease;
  if (tissue) metadata.tissue = tissue;
  if (description) metadata.description = description;

  return {
    metadata: metadata,
    genes,
    pathways,
    enable_validation: true,
    strict_mode: false
  };
}

Meteor.methods({
  /**
   * Start Publication-Ready workflow using external API
   */
  'aiWorkflow.startPublicationReady': async function(data) {
    check(data, {
      pathways: Array,
      genes: Array,
      analyses: Match.Optional([Match.ObjectIncluding({
        id: String,
        name: String,
        metadata: Match.Optional(String),
        contextFields: Match.Optional(Object),
        isMassAnalysis: Match.Optional(Boolean),
        massAnalysisId: Match.OneOf(String, null, undefined)
      })]),
      sessionId: Match.Optional(String),
      analysisId: Match.Optional(String),
      analysisType: Match.Optional(String),
      metaAnalysisData: Match.OneOf(Object, null, undefined),
      consolidatedMetadata: Match.Optional(Object) // LLM-validated consolidated metadata
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'User must be logged in');
    }

    // Being logged in is not enough: this reads AnalysisConfig / AnalysisResult /
    // AnalysisConfigSnapshot for whatever ids it is handed, ships them to the external pipeline,
    // and stores the result in a WorkflowExecutions row stamped with the CALLER's userId — which
    // they can then read back through the correctly-guarded aiWorkflow.getFinalReport. Without
    // these checks that is a laundering read of another user's study.
    // Writable, not merely owned: generating a report is a change to the study, so a view-only
    // import must refuse it.
    if (data.sessionId) {
      await assertWritableSession({sessionId: data.sessionId, requesterUserId: this.userId});
    }
    if (data.analysisId) {
      await assertOwnsAnalysis({analysisId: data.analysisId, requesterUserId: this.userId});
    }
    for (const analysis of data.analyses || []) {
      await assertOwnsAnalysis({analysisId: analysis.id, requesterUserId: this.userId});
    }
    // metaAnalysisData.individualAnalyses[] is a THIRD source of analysisIds: the meta-analysis
    // branch reads pathway results and the DE gene table for each of them
    // (transformMetaAnalysisToExternalFormat). Guarding only sessionId/analysisId/analyses[] left
    // it open — a caller could pass their own ids for those and a victim's id here.
    const individualAnalyses = data.metaAnalysisData?.individualAnalyses;
    if (individualAnalyses !== undefined) {
      check(individualAnalyses, [Match.ObjectIncluding({id: String})]);
      for (const analysis of individualAnalyses) {
        await assertOwnsAnalysis({analysisId: analysis.id, requesterUserId: this.userId});
      }
    }

    console.log('\n[aiWorkflow.startPublicationReady] Starting external API workflow...');

    // ========== INPUT DATA LOGGING (SERVER) ==========
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  🖥️  WORKFLOW INPUT DATA - SERVER RECEIVED                     ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('📊 DATA RECEIVED FROM CLIENT:');
    console.log(`  - Pathways: ${data.pathways.length}`);
    console.log(`  - Genes: ${data.genes.length}`);
    console.log(`  - Analyses: ${data.analyses?.length || 0}`);
    console.log(`  - User ID: ${this.userId}`);
    console.log(`  - Session ID: ${data.sessionId || 'N/A'}`);
    console.log(`  - Analysis ID: ${data.analysisId || 'N/A'}\n`);

    console.log('════════════════════════════════════════════════════════════════\n');
    // ========== END INPUT DATA LOGGING ==========

    let workflowId;

    try {
      // Generate workflow ID
      workflowId = Random.id();

      // Transform data based on analysis type
      let externalPayload;
      let apiEndpoint;

      if (data.analysisType === 'meta-analysis') {
          console.log('\n📊 META-ANALYSIS MODE - Using /api/meta-pipeline');
        externalPayload = await transformMetaAnalysisToExternalFormat(data);
        apiEndpoint = `${EXTERNAL_API_BASE_URL}/api/meta-pipeline`;

        console.log('📤 Meta-analysis payload:');
        console.log('   - Meta pathways:', externalPayload.meta.pathways.length);
        console.log('   - Meta genes:', externalPayload.meta.genes.length);
        console.log('   - Datasets:', externalPayload.datasets.length);
        console.log('   - Dataset names:', externalPayload.datasets.map(d => d.dataset_name).join(', '));
      } else {
        console.log('\n🔬 SINGLE ANALYSIS MODE - Using /api/pipeline');
        externalPayload = await transformToExternalFormat(data);
        apiEndpoint = `${EXTERNAL_API_BASE_URL}/api/pipeline`;

        console.log('📤 Single analysis payload:');
        console.log('   - Metadata:', externalPayload.metadata);
        console.log('   - Genes:', externalPayload.genes.length);
        console.log('   - Pathways:', externalPayload.pathways.length);
      }

      console.log('\n📤 Submitting to external API:', apiEndpoint);

      // Write request body to file for debugging
      const fs = require('fs');
      const path = require('path');
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, `meta-pipeline-request-${Date.now()}.json`);
      fs.writeFileSync(logFile, JSON.stringify(externalPayload, null, 2));
      console.log('📦 Request body saved to:', logFile);

      // Also log summary
      console.log('📦 Request summary:');
      console.log('   - Meta pathways:', externalPayload.meta?.pathways?.length || 0);
      console.log('   - Meta genes:', externalPayload.meta?.genes?.length || 0);
      console.log('   - Datasets:', externalPayload.datasets?.length || 0);

      // Wire size of the request body. `datasets[].genes` now carries each dataset's FULL DE
      // gene list, so a many-dataset mass analysis sends on the order of 100k gene objects —
      // measure it rather than assume it is fine.
      const requestBytes = Buffer.byteLength(JSON.stringify(externalPayload), 'utf8');
      const datasetGeneCount = (externalPayload.datasets || [])
        .reduce((sum, d) => sum + (d.genes?.length || 0), 0);
      // `datasets[].pathways[].genes` now carries each significant pathway's full member list as
      // symbols, so count those too rather than assuming they are noise next to the DE genes.
      const datasetPathwayGeneCount = (externalPayload.datasets || [])
        .reduce((sum, d) => sum + (d.pathways || [])
          .reduce((n, p) => n + (p.genes?.length || 0), 0), 0);
      console.log(`   - Dataset genes (total): ${datasetGeneCount}`);
      console.log(`   - Dataset pathway genes (total): ${datasetPathwayGeneCount}`);
      console.log(`   - Serialized request size: ${requestBytes} bytes (${(requestBytes / 1048576).toFixed(2)} MiB)`);

      // Submit job to external API
      const response = await axios.post(
        apiEndpoint,
        externalPayload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 600000 // 600 seconds timeout for submission
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error?.message || 'External API returned failure');
      }

      const externalJobId = response.data.job_id;
      console.log('✅ External job submitted:', externalJobId);

      // Create workflow record
      await DBCollections.WorkflowExecutions.insertAsync({
        workflowId,
        externalJobId,
        userId: this.userId,
        sessionId: data.sessionId,
        analysisId: data.analysisId,
        status: 'pending',
        createdAt: new Date(),
        inputSummary: {
          pathwayCount: data.pathways.length,
          geneCount: data.genes.length,
          analysisCount: data.analyses?.length || 0
        }
      });

      console.log('[aiWorkflow.startPublicationReady] ✅ Workflow submitted to external API');

      return {
        success: true,
        workflowId,
        externalJobId,
        status: 'pending'
      };

    } catch (error) {
      console.error('[aiWorkflow.startPublicationReady] ❌ Error:', error);

      // Update workflow as failed
      if (workflowId) {
        await DBCollections.WorkflowExecutions.updateAsync(
          { workflowId },
          {
            $set: {
              status: 'failed',
              error: error.message,
              failedAt: new Date()
            }
          }
        );
      }

      throw new Meteor.Error('workflow-failed', error.message);
    }
  },

  /**
   * Check external job status and update workflow
   */
  'aiWorkflow.checkExternalJobStatus': async function(workflowId) {
    check(workflowId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'User must be logged in');
    }

    const workflow = await DBCollections.WorkflowExecutions.findOneAsync({ workflowId });

    if (!workflow) {
      throw new Meteor.Error('not-found', 'Workflow not found');
    }

    if (workflow.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'Not your workflow');
    }

    if (!workflow.externalJobId) {
      throw new Meteor.Error('invalid-workflow', 'Workflow has no external job ID');
    }

    try {
      // Check status from external API
      const response = await axios.get(
        `${EXTERNAL_API_BASE_URL}/api/pipeline/job/${workflow.externalJobId}`,
        { timeout: 600000 }
      );

      const jobData = response.data;

      // Update workflow status
      const updateData = {
        lastCheckedAt: new Date()
      };

      if (jobData.status === 'completed') {
        // Extract final report markdown
        // Different structure for single analysis vs meta-analysis:
        // - Single analysis: jobData.results.steps.step5.markdown_content
        //   (report generation moved from step6 to step5 after the Therapeutic step
        //    was removed; step6 kept as a fallback for older job payloads)
        // - Meta-analysis: jobData.results.comparative_report
        let finalReport = '';
        let reportType = 'unknown';

        if (jobData.results?.comparative_report) {
          // Meta-analysis report
          finalReport = jobData.results.comparative_report;
          reportType = 'meta-analysis';
          console.log('📊 Meta-analysis report structure detected');
        } else if (jobData.results?.steps?.step5?.markdown_content ||
                   jobData.results?.steps?.step6?.markdown_content) {
          // Single analysis report (step5; step6 fallback for older payloads)
          finalReport = jobData.results.steps.step5?.markdown_content
                     || jobData.results.steps.step6.markdown_content;
          reportType = 'single-analysis';
          console.log('🔬 Single analysis report structure detected');
        } else {
          console.warn('⚠️  Unknown report structure, checking for any markdown content...');
          // Fallback: try to find any markdown content
          finalReport = jobData.results?.markdown_content ||
                       jobData.results?.final_report ||
                       '';
        }

        updateData.status = 'completed';
        updateData.completedAt = new Date();
        updateData.finalReport = finalReport;
        updateData.reportType = reportType;
        updateData.duration = jobData.results?.total_execution_time * 1000; // Convert to ms
        updateData.externalResults = jobData.results;

        // Store additional meta-analysis results if available
        if (jobData.results?.meta_results) {
          updateData.metaResults = jobData.results.meta_results;
        }
        if (jobData.results?.dataset_results) {
          updateData.datasetResults = jobData.results.dataset_results;
        }
        if (jobData.results?.reproducibility_results) {
          updateData.reproducibilityResults = jobData.results.reproducibility_results;
        }
        if (jobData.results?.output_path) {
          updateData.outputPath = jobData.results.output_path;
        }

        console.log(`✅ Job ${workflow.externalJobId} completed (${reportType}), report length: ${finalReport.length}`);
        if (reportType === 'meta-analysis') {
          console.log('   - Meta results:', !!updateData.metaResults);
          console.log('   - Dataset results:', !!updateData.datasetResults);
          console.log('   - Reproducibility results:', !!updateData.reproducibilityResults);
          console.log('   - Output path:', updateData.outputPath);
        }
      } else if (jobData.status === 'failed') {
        updateData.status = 'failed';
        updateData.error = jobData.error || 'External job failed';
        updateData.failedAt = new Date();

        console.error(`❌ Job ${workflow.externalJobId} failed:`, jobData.error);
      } else if (jobData.status === 'running') {
        updateData.status = 'running';
        updateData.startedAt = jobData.started_at ? new Date(jobData.started_at) : undefined;
      }

      await DBCollections.WorkflowExecutions.updateAsync(
        { workflowId },
        { $set: updateData }
      );

      return {
        success: true,
        workflowId,
        status: jobData.status,
        finalReport: updateData.finalReport,
        reportType: updateData.reportType,
        duration: updateData.duration,
        error: updateData.error,
        // Meta-analysis specific fields
        metaResults: updateData.metaResults,
        datasetResults: updateData.datasetResults,
        reproducibilityResults: updateData.reproducibilityResults,
        outputPath: updateData.outputPath,
        // Progress object for client-side progress display
        progress: {
          totalSteps: jobData.total_steps || 6,
          currentStep: jobData.current_step || 0,
          currentMessage: jobData.current_step_message || '',
          stepsInfo: jobData.steps_info || [],
          stepExecutionTimes: jobData.step_execution_times || {},
          status: jobData.status
        }
      };

    } catch (error) {
      console.error('[aiWorkflow.checkExternalJobStatus] ❌ Error:', error);
      throw new Meteor.Error('status-check-failed', error.message);
    }
  },

  /**
   * Get workflow status and results
   */
  'aiWorkflow.getWorkflowStatus': async function(workflowId) {
    check(workflowId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }

    const workflow = await DBCollections.WorkflowExecutions.findOneAsync({ workflowId });

    if (!workflow) {
      throw new Meteor.Error('not-found', 'Workflow not found');
    }

    if (workflow.userId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'Not your workflow');
    }

    // Get step results
    const steps = await DBCollections.WorkflowSteps.find({ workflowId }).fetchAsync();

    return {
      workflow,
      steps: steps.sort((a, b) => a.stepNumber - b.stepNumber)
    };
  },

  /**
   * Get final report
   */
  'aiWorkflow.getFinalReport': async function(workflowId) {
    check(workflowId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }

    const workflow = await DBCollections.WorkflowExecutions.findOneAsync({ workflowId });

    if (!workflow) {
      throw new Meteor.Error('not-found', 'Workflow not found');
    }

    if (workflow.userId !== this.userId) {
      throw new Meteor.Error('not-authorized');
    }

    return {
      report: workflow.finalReport,
      reportType: workflow.reportType,
      metadata: workflow.metadata,
      createdAt: workflow.createdAt,
      duration: workflow.duration,
      // Meta-analysis specific fields
      metaResults: workflow.metaResults,
      datasetResults: workflow.datasetResults,
      reproducibilityResults: workflow.reproducibilityResults,
      outputPath: workflow.outputPath
    };
  },

  /**
   * List user's workflows
   */
  'aiWorkflow.listWorkflows': async function() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }

    const workflows = await DBCollections.WorkflowExecutions.find(
      { userId: this.userId },
      {
        sort: { createdAt: -1 },
        limit: 50,
        fields: {
          workflowId: 1,
          status: 1,
          createdAt: 1,
          completedAt: 1,
          duration: 1,
          inputSummary: 1,
          error: 1
        }
      }
    ).fetchAsync();

    return workflows;
  }
});

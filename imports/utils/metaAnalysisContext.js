// Pure, dependency-free helpers that rebuild the per-dataset context behind an AI-interpretation
// selection. Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and
// can be imported on both client and server — including the server-side Mocha runner. Same
// placement rationale as metadataValues.js.
//
// WHY THIS EXISTS. The wizard used to reach the datasets behind a meta-analysis ONLY through
// MassAnalysisQueue.analysesMetadata — via massAnalysis.getMetadata and the massAnalysisId carried
// on each analysis entry. A CLONED study deliberately has neither: server/helper/cloneStudy.js drops
// the mass-analysis pointers (a surviving one would name the DONOR's queue row and be refused by the
// ownership guard) and no MassAnalysisQueue/QueueItem rows are cloned, since those are pure run
// state. So on a shared study the wizard showed no dataset metadata at all, and the submit path
// threw 'No mass analysis found in this session.' outright.
//
// The metadata itself DOES survive the clone: Session.analyses[].metadata rides through cloneStudy's
// `...rest` untouched, and MassAnalysisQueue.analysesMetadata was built FROM those same entries
// (server/api/methods/analysis.js, massAnalysis.create: `analysesMetadata[analysis.name] =
// analysis.metadata`). So the map can be rebuilt from the session's own analyses with no run state
// and no server round-trip — which also covers meta-analyses that were never mass analyses at all,
// the case that threw on an ordinary study too.

import {metaSourceAnalysisIds} from './cloneIdMap';
import {aggregateMetadataValue} from './metadataValues';

// The datasets behind a wizard selection, plus the source ids that could NOT be resolved.
//
// missingIds is not an internal detail. A source id absent from `analyses` means the report is about
// to be generated from fewer datasets than the meta-analysis was computed over, and the caller is
// expected to say so on screen rather than quietly shipping a smaller payload. It is reachable
// whenever an analysis is DELETED after the meta was built: the meta entry keeps the id in
// selectedAnalyses. (The wizard's `analyses` map is the session's full analyses[] — the AI
// interpretation page builds it straight from visualization.getConfigurations — so a filtered view
// is not a second cause. A clone cannot reach it either: metaAnalysisIsCloneable drops a meta
// unless every source comes along.)
//
// When NONE of the sources resolve, the caller is expected to refuse rather than substitute a
// different set: these become the pipeline's datasets[], the per-dataset evidence it compares.
//
// Resolution order:
//   1. the meta-analysis's own record of its sources (geneLevel/pathwayLevel.selectedAnalyses, read
//      through the same helper the clone uses, so the two can never disagree). This is what survives
//      cloning — cloneStudy remaps those ids onto the copied analyses.
//   2. the mass-analysis cohort, for an individual mass dataset or a legacy meta entry that recorded
//      no sources. This is the pre-existing behaviour and is kept so those studies are unaffected.
export const metaSelectionDatasets = (analysisId, analyses, metaAnalyses) => {
    const byId = analyses || {};
    const metaEntry = (metaAnalyses || []).find((meta) => meta && meta.id === analysisId);
    const sourceIds = metaEntry ? metaSourceAnalysisIds(metaEntry) : [];

    if (sourceIds.length > 0) {
        const datasets = [];
        const missingIds = [];
        sourceIds.forEach((id) => {
            const entry = byId[id];
            if (entry) datasets.push(entry);
            else missingIds.push(id);
        });
        return {datasets, missingIds, source: 'meta'};
    }

    // Prefer the selected analysis's own cohort; fall back to the single cohort the study has, which
    // is the shape the wizard assumed before (it collected massAnalysisIds across every analysis).
    const massAnalysisId = byId[analysisId]?.massAnalysisId
        || Object.values(byId).find((entry) => entry && entry.massAnalysisId)?.massAnalysisId;

    if (massAnalysisId) {
        return {
            datasets: Object.values(byId).filter((entry) => entry && entry.massAnalysisId === massAnalysisId),
            missingIds: [],
            source: 'mass'
        };
    }

    return {datasets: [], missingIds: [], source: 'none'};
};

// {analysisName: metadata} with the {extracted: …} nesting PRESERVED.
//
// The server reads datasetsMetadata[datasetName]?.extracted when it builds the meta payload
// (server/api/methods/aiWorkflow.js), so flattening here would silently empty every dataset's
// metadata in the request. The display map is derived separately by extractedMetadataByName.
//
// massAnalysis.create writes `metadata: analysis.metadata || ''` — a STRING when there is none — so
// a non-object is not metadata and is skipped rather than keyed in as junk.
export const datasetMetadataByName = (entries) => {
    const out = {};
    (entries || []).forEach((entry) => {
        if (!entry || !entry.name) return;
        const metadata = entry.metadata;
        if (!metadata || typeof metadata !== 'object') return;
        out[entry.name] = metadata;
    });
    return out;
};

// {analysisName: extracted} — the display/consolidation shape. Tolerates a map that is already flat,
// which is what massAnalysis.getMetadata can return for older rows.
export const extractedMetadataByName = (rawMap) => {
    const out = {};
    Object.entries(rawMap || {}).forEach(([name, meta]) => {
        if (!meta || typeof meta !== 'object') return;
        const extracted = meta.extracted && typeof meta.extracted === 'object' ? meta.extracted : meta;
        if (extracted && typeof extracted === 'object' && Object.keys(extracted).length > 0) {
            out[name] = extracted;
        }
    });
    return out;
};

// The consolidated study-level context the metadata modal is seeded with, aggregated across
// datasets. Lifted out of AnalysisWizard so it runs for ANY meta selection: it used to be built only
// inside the mass-analysis branch, so a cloned or non-mass meta got no consolidated context even
// when its per-dataset metadata was available.
//
// Returns null for an empty map so the caller can tell "nothing to consolidate" from "consolidated
// to empty strings".
export const consolidateMetadata = (extractedMap) => {
    const metadata = extractedMap || {};
    if (Object.keys(metadata).length === 0) return null;

    const allFields = new Set();
    Object.values(metadata).forEach((m) => Object.keys(m || {}).forEach((field) => allFields.add(field)));

    const aggregated = {};
    allFields.forEach((field) => {
        const values = Object.values(metadata)
            .map((m) => m?.[field])
            .filter((v) => v !== undefined && v !== null && v !== '');
        if (values.length > 0) {
            // Merge values differing only by case/whitespace (e.g. "female"/"Female").
            aggregated[field] = aggregateMetadataValue(values);
        }
    });

    return {
        organism: aggregated.organism || aggregated.Organism || 'Homo sapiens',
        tissue: aggregated.tissue || aggregated.Tissue || '',
        disease: aggregated.disease || aggregated.Disease || null,
        comparison: aggregated.comparison || aggregated.Comparison || '',
        experimental_context: aggregated.experimental_context || aggregated.description || '',
        study_type: 'disease'
    };
};

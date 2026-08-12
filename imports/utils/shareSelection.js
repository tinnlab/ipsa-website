// Which ids a share link actually covers.
//
// A study's shareable ids live in two arrays — `analyses` and `metaAnalyses` — and a meta-analysis is
// only meaningful alongside every analysis it was computed from. Its stored `selectedAnalyses` reference
// those analyses by id, so a meta that travelled without them would land in the copy pointing at analyses
// that are not there; imports/utils/cloneIdMap.js explains why that also endangers the DONOR study. So
// "what does this link hand over" is never simply the list of ids the caller typed: metas have to be
// reconciled against their sources first.
//
// That reconciliation happens at two different moments, and it deliberately is NOT the same rule at both:
//
//   - While the OWNER is choosing (the share modal, and share.create), a meta whose sources are all
//     selected is included even if it was not ticked. That is what "share this study" means, and it is
//     the behaviour this module exists to fix.
//   - When a RECIPIENT opens the link (share.preview, share.import), the study may have changed since the
//     link was minted. Applying the owner-facing rule there would hand out a meta-analysis computed AFTER
//     the link was created — one the owner never saw in the modal and never agreed to share. So the
//     recipient-facing rule only ever DROPS; it can never add.
//
// Hence two functions rather than one. Both are pure and both key off the session, so preview and import —
// same stored ids, same study — cannot disagree about what will arrive.

import {metaAnalysisIsCloneable, metaSourceAnalysisIds} from './cloneIdMap';

// Only entries of `analyses` can serve as a meta's sources. A meta id is never treated as one: no
// meta-of-meta exists through the builder (it offers only plain analyses as inputs), and admitting one
// here would let an id that the clone never maps reach remapMetaAnalysisEntry.
const analysisEntries = (session) => (session?.analyses || []).filter((entry) => entry && entry.id);
const metaEntries = (session) => (session?.metaAnalyses || []).filter((entry) => entry && entry.id);

// Entries are named by the user and an unnamed one still has to be identifiable in a warning.
const nameOf = (entry) => entry.name || entry.id;

const asSet = (ids) => new Set(Array.isArray(ids) ? ids : []);

// A malformed study can list the same id twice in one array. Left alone that lands in allIds twice and
// makes the recipient's "2 analyses" count a lie about what is arriving. The other half of that problem —
// one id in BOTH arrays — is handled where the two lists are joined below.
const dedupe = (ids) => [...new Set(ids)];

// Owner-facing. MAY EXPAND the selection: any meta-analysis whose every source is selected comes along,
// ticked or not. A meta that was asked for but whose sources are incomplete is dropped and reported, so
// the modal can name it and say what it is missing rather than dropping it in silence.
//
// Used by the share modal and by share.create, so that what the owner is shown is exactly what is stored.
//
// droppedMeta splits what is missing in two, because only one of them is fixable: missingSource* are
// analyses still in the study that the owner could add, while unavailableSource* are ids that are not
// among this study's analyses at all — deleted, or (defensively) another meta — and no amount of ticking
// will bring them back.
export const resolveShareSelection = (session, requestedIds) => {
    const requested = asSet(requestedIds);
    const entries = analysisEntries(session);
    const nameById = new Map(entries.map((entry) => [entry.id, nameOf(entry)]));
    const inStudy = new Set(entries.map((entry) => entry.id));

    const analysisIds = dedupe(entries.filter((entry) => requested.has(entry.id)).map((entry) => entry.id));
    const selected = new Set(analysisIds);

    const metaIds = [];
    const autoIncludedMeta = [];
    const droppedMeta = [];
    for (const entry of metaEntries(session)) {
        if (metaAnalysisIsCloneable(entry, selected)) {
            metaIds.push(entry.id);
            if (!requested.has(entry.id)) autoIncludedMeta.push({id: entry.id, name: nameOf(entry)});
            continue;
        }
        // Only complain about a meta the owner actually asked for. One left untouched with unselected
        // sources is simply not part of this share.
        if (!requested.has(entry.id)) continue;

        const missing = metaSourceAnalysisIds(entry).filter((id) => !selected.has(id));
        const missingSourceIds = missing.filter((id) => inStudy.has(id));
        const unavailableSourceIds = missing.filter((id) => !inStudy.has(id));
        droppedMeta.push({
            id: entry.id,
            name: nameOf(entry),
            missingSourceIds,
            missingSourceNames: missingSourceIds.map((id) => nameById.get(id) || id),
            unavailableSourceIds,
        });
    }

    // An id listed in BOTH arrays would otherwise appear once as an analysis and again as a
    // meta-analysis — counted twice, and named under both kinds on the landing page.
    const uniqueMetaIds = dedupe(metaIds).filter((id) => !selected.has(id));
    return {
        analysisIds,
        metaIds: uniqueMetaIds,
        allIds: [...analysisIds, ...uniqueMetaIds],
        autoIncludedMeta,
        droppedMeta,
    };
};

// Recipient-facing. NEVER EXPANDS: an id absent from the stored list can never appear in the result, no
// matter what the study has grown since. A stored analysis is kept while it still exists; a stored meta is
// kept only while every one of its sources is also still present and still shared.
//
// Used by share.preview and share.import, which is what makes the landing page's promise and the import
// the same answer to the same question.
export const validateShareSelection = (session, storedIds) => {
    const stored = asSet(storedIds);
    const entries = analysisEntries(session);

    const analysisIds = dedupe(entries.filter((entry) => stored.has(entry.id)).map((entry) => entry.id));
    const surviving = new Set(analysisIds);

    const metaIds = [];
    const droppedMeta = [];
    for (const entry of metaEntries(session)) {
        if (!stored.has(entry.id)) continue;
        if (metaAnalysisIsCloneable(entry, surviving)) metaIds.push(entry.id);
        else droppedMeta.push({id: entry.id, name: nameOf(entry)});
    }

    // As above: one id in both arrays must not be handed over twice under two different kinds.
    const uniqueMetaIds = dedupe(metaIds).filter((id) => !surviving.has(id));
    return {
        analysisIds,
        metaIds: uniqueMetaIds,
        allIds: [...analysisIds, ...uniqueMetaIds],
        droppedMeta,
    };
};

// Names for a resolved selection, split by kind, so the recipient can be told "2 analyses and 1
// meta-analysis" rather than one undifferentiated list that hides what a meta-analysis is.
export const shareSelectionNames = (session, {analysisIds, metaIds} = {}) => {
    const nameById = new Map(
        [...analysisEntries(session), ...metaEntries(session)].map((entry) => [entry.id, nameOf(entry)])
    );
    return {
        analysisNames: (analysisIds || []).map((id) => nameById.get(id)).filter(Boolean),
        metaAnalysisNames: (metaIds || []).map((id) => nameById.get(id)).filter(Boolean),
    };
};

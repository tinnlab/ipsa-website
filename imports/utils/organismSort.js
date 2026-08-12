// Pure, dependency-free helper for the organism dropdowns. Lives under imports/utils so it is
// architecture-neutral and unit-testable (server-side Mocha runner included).
//
// Organism docs reach minimongo in Mongo natural (insertion) order, which is the order the KEGG /
// Reactome APIs returned them in — taxonomic groupings, not alphabetical (see
// server/api/methods/orgamism.js, addOrganismsFromKegg / addOrganismsFromReactome). No selector
// passed a sort, so every dropdown showed that raw order and merely looked roughly alphabetical.

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Sort organism documents ({_id, code, name, taxId, isEnabled}) by display name.
 *
 * - case-insensitive, so "zebrafish" sits next to "Zebrafish" rather than after every capital
 * - numeric-aware, so "… strain 2" precedes "… strain 10"
 * - docs with a missing/blank/non-string name sort LAST rather than jumping to the top
 * - ties broken by code, then _id, so the order is deterministic whatever order minimongo
 *   returned; the two are compared as separate fields rather than as one joined string, which
 *   would let "ab"+"c" and "a"+"bc" collide
 * - returns a NEW array; the input is never mutated
 *
 * @param {Array<Object>} organisms
 * @returns {Array<Object>} new, sorted array (always an array, even for bad input)
 */
export const sortOrganismsByName = (organisms) => {
    if (!Array.isArray(organisms)) return [];

    return [...organisms].sort((a, b) => {
        const nameA = textOf(a?.name);
        const nameB = textOf(b?.name);

        if (!nameA !== !nameB) return nameA ? -1 : 1; // unnamed docs go last
        const byName = nameA.localeCompare(nameB, 'en', { sensitivity: 'base', numeric: true });
        if (byName !== 0) return byName;

        const byCode = textOf(a?.code).localeCompare(textOf(b?.code), 'en');
        if (byCode !== 0) return byCode;

        return String(a?._id ?? '').localeCompare(String(b?._id ?? ''), 'en');
    });
};

// Pure, dependency-free helpers for capping how many selection "tags" (chips) are
// rendered. Used by the AI-interpretation selected-pathway / selected-gene tag
// lists (AnalysisWizard.jsx and InsightComponents.jsx).
//
// The tags are purely cosmetic — the tables below them have name search — so when
// a user selects many items we show only the first `max` tags plus a single
// "+N more <noun>" summary tag instead of an arbitrarily long list.
//
// Lives under imports/utils so it is importable on both client and server
// (including the server-side Mocha runner).

export const MAX_VISIBLE_TAGS = 10;

/**
 * Split `items` into the visible head and the hidden remainder count.
 * @param {Array<*>} items
 * @param {number} max maximum tags to show (default MAX_VISIBLE_TAGS)
 * @returns {{visible: Array<*>, extraCount: number}}
 */
export function capTags(items, max = MAX_VISIBLE_TAGS) {
    const list = items || [];
    const limit = Number.isFinite(max) && max >= 0 ? max : MAX_VISIBLE_TAGS;
    const visible = list.slice(0, limit);
    return { visible, extraCount: Math.max(0, list.length - visible.length) };
}

/**
 * Label for the trailing summary tag, e.g. `+12 more genes`.
 * @param {number} extraCount how many items are hidden
 * @param {string} noun plural noun ("pathways" | "genes")
 * @returns {string}
 */
export function moreTagLabel(extraCount, noun) {
    return `+${extraCount} more ${noun}`;
}

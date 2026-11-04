// What "my recent studies" means, in one place.
//
// The Recent Studies page and the homepage's counted button have to agree: a button saying 7 that
// opens a list of 4 is worse than no number at all. They cannot agree by both being written
// correctly — they agree by reading the same selector, so a later change to one is a change to both.
//
// The predicate is ownership and nothing else, which is what the list actually shows today. Expired
// studies are NOT excluded: the page renders them, marks them "Expired", and disables their actions
// (see RecentSessions' status and actions columns), so they are studies the user still has. There is
// no soft-delete field to consider — removal is a hard cascade delete.

// The Mongo selector for the studies one user sees. Returns null for a missing or non-string id
// rather than an empty selector, because `{}` would match every study on the platform: a caller that
// forgot to pass an id must get nothing, not everything.
export function recentStudiesSelector(userId) {
    if (typeof userId !== 'string' || userId.length === 0) return null;
    return { userId };
}

// Newest first, the order the list is fetched in.
export const RECENT_STUDIES_SORT = { createdAt: -1 };

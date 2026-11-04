// Prior imports: the studies the CALLER has already made from one shared study.
//
// Server-side on purpose. The whole reason this module exists is that Session.importedFrom is
// deliberately withheld from every client publication (SESSION_PUBLIC_FIELDS,
// server/api/subscriptions/analysis.js) because it records the DONOR's userId and sessionId, which
// the recipient must never learn. So the rows are assembled here, behind that line, and handed back
// as a narrow shape that is asserted key-for-key in the tests. Putting any of this in
// imports/utils/ would ship the Mongo projection to the browser, which is exactly the wrong place
// for the one constant that decides what does not leak.
//
// Everything below tolerates malformed input instead of throwing. Two reasons, both real:
// share.preview has no try/catch of its own (a throw there is a 500 that makes a share link
// permanently unopenable — tests/share-selection.tests.js:183-185), and the rows render on a page
// with no React error boundary above it.

// How many rows the landing page shows. The caller is told the true total whenever it is larger, so
// the cap is a stated limit and never a silent truncation.
export const PRIOR_IMPORT_LIMIT = 20;

// The ONLY fields read out of Session.
//
// importedFrom's sub-fields are named individually rather than as `importedFrom: 1` so the donor's
// ownerUserId never leaves Mongo at all — a careless spread downstream then has nothing to leak.
// sourceSessionId IS read, because priorImportRows re-checks it in JS behind the selector; the row
// projection drops it again, and a test pins its absence.
export const PRIOR_IMPORT_FIELDS = {
    name: 1,
    status: 1,
    expiredAt: 1,
    permanent: 1,
    readOnly: 1,
    userId: 1,
    'importedFrom.sourceSessionId': 1,
    'importedFrom.mode': 1,
    'importedFrom.importedAt': 1,
};

const importedMs = (row) => {
    const value = row && row.importedAt;
    if (value === null || value === undefined) return 0;
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    // An undated row sorts last rather than poisoning the comparator with NaN.
    return Number.isFinite(t) ? t : 0;
};

// One row, and the exhaustive list of what the recipient is allowed to see: their OWN study id, its
// name, when they imported it, the scope they took, and the four fields the Recent Studies list
// already holds for its own rows — so the landing page renders Status and Expires In with the same
// helpers rather than a second copy of the rule, and so the two views cannot contradict each other.
//
// Nothing from the donor: no sourceSessionId, no ownerUserId. Not the shareId either — that is not
// donor identity, but it would reveal which OTHER link an earlier copy came through, and the table
// has no use for it.
const priorImportRow = (doc) => {
    const from = doc.importedFrom;
    return {
        studyId: doc._id,
        name: doc.name,
        importedAt: from.importedAt,
        mode: from.mode,
        status: doc.status,
        expiredAt: doc.expiredAt,
        permanent: doc.permanent,
        readOnly: doc.readOnly,
    };
};

// Pure. The ownership and match-key tests are re-applied here even though the Mongo selector already
// applied them: this function is the one place the shape is decided, so it is also the place worth
// pinning with tests, and the duplicate check costs nothing on a list this size.
//
// Match key is `importedFrom.sourceSessionId`, NOT shareId: the owner asked for copies of "that
// original study", and a study can be shared through more than one link.
export const priorImportRows = (docs, {userId, sourceSessionId} = {}) => {
    if (!Array.isArray(docs) || !userId || !sourceSessionId) return [];
    return docs
        .filter((doc) => {
            if (!doc || doc.userId !== userId) return false;
            const from = doc.importedFrom;
            // A string, null or absent importedFrom is not a match and must not throw: legacy rows
            // and hand-edited documents reach this.
            if (!from || typeof from !== 'object') return false;
            return from.sourceSessionId === sourceSessionId;
        })
        .map(priorImportRow)
        .sort((a, b) => importedMs(b) - importedMs(a));
};

// The query. `Sessions` is injected so this is testable against a fake collection without booting
// Meteor, following server/helper/cloneStudy.js and server/helper/caseStudies.js.
//
// Cost: the selector leads with userId, which is already indexed (server/startup/collections.js:76),
// so the scan is bounded by the CALLER's own studies rather than by the collection, and the limit
// bounds the response. No new index, and so no new write cost on Session.
export const findPriorImports = async ({Sessions, userId, sourceSessionId}) => {
    if (!Sessions || !userId || !sourceSessionId) return {rows: [], total: 0};

    const selector = {userId, 'importedFrom.sourceSessionId': sourceSessionId};

    const docs = await Sessions.find(selector, {
        fields: PRIOR_IMPORT_FIELDS,
        sort: {'importedFrom.importedAt': -1},
        limit: PRIOR_IMPORT_LIMIT,
    }).fetchAsync();

    // Capped again here rather than trusted to the driver: `rows` is what the page renders and
    // `total` is what it claims, so both numbers have to be decided in one place to stay honest.
    const rows = priorImportRows(docs, {userId, sourceSessionId}).slice(0, PRIOR_IMPORT_LIMIT);

    // The total only needs a second query when the cap was actually reached. A fetch that came back
    // under the limit has already seen every matching document, so its length IS the total — which
    // means the common case (no prior imports at all, i.e. every first visit to a link) costs one
    // query, not two. When the cap WAS hit, count on the SAME selector: deriving the total from
    // rows.length would report the cap as the truth in exactly the case the user must be told about.
    let total = docs.length;
    if (docs.length >= PRIOR_IMPORT_LIMIT) {
        const counted = await Sessions.find(selector, {fields: {_id: 1}}).countAsync();
        if (Number.isFinite(counted)) total = counted;
    }

    // Fetch and count are two round trips, so a study removed between them could leave
    // total < rows.length and render "showing 3 of 2". Never claim fewer than we are showing.
    return {rows, total: Math.max(total, rows.length)};
};

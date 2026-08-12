import {WebApp} from 'meteor/webapp';
import {resolveRequestUserId, AUTH_TOKEN_HEADER} from './resolveRequestUser';
import {findOwnedSession, findOwnedSessionForAnalysis} from './ownership';
import {collectAnalysisIds, isValidId, isValidIdArray} from '../../imports/utils/ownership';
import {
    getAllGeneSetAnalysis,
    getAnalysesForSession,
    getDEGenes,
    getFcPValueData,
    getGeneSetAnalysis,
    getMappedGeneIds,
    getResultById,
    getResultsByDatabase,
    getResultsByMethod,
    getResultsForAnalysis,
    getResultsForSession,
} from '../api/methods/visualizationCore';

// These endpoints are plain Connect middleware, so they get none of DDP's authenticated context.
// Until now that meant they were completely unauthenticated: anyone who knew (or guessed) a
// sessionId, analysisId or resultId could curl another user's full analysis results.
//
// Every handler now goes through restEndpoint(), which resolves the caller from the user-token
// header and proves they own the study before any data is read. Handlers call the auth-free
// visualizationCore functions directly rather than Meteor.callAsync — a server-side method call has
// no this.userId, so it could not satisfy the ownership-checked visualization.* methods anyway.

// Unchanged from the original one-year expiry — see the caching note in privateCacheHeaders.
const ONE_YEAR_SECONDS = 31536000;
const ONE_HOUR_SECONDS = 3600;

// `private` is the security-critical part. These responses were previously marked
// `public, max-age=31536000`, which invites any shared proxy or CDN in front of the app to store
// one user's results and serve them to the next requester of the same URL — bypassing the
// ownership check entirely, because the cache never re-consults the origin.
//
// `private` keeps the response in the requesting browser's own cache only. A long max-age stays
// appropriate: these payloads are immutable for a given id (a re-run wipes its AnalysisResult rows
// and writes fresh ones, and cloned studies get new ids), so there is no staleness to guard
// against, and these blobs are large enough that losing the browser cache would be a real
// regression. Vary: user-token additionally keys any intermediary cache on the identity header.
// Accept-Encoding stays in the Vary list (/api/methodResults set it before this change) so a
// cache cannot hand a gzipped entry to a client that did not ask for one.
const privateCacheHeaders = (maxAgeSeconds) => ({
    'Cache-Control': `private, max-age=${maxAgeSeconds}`,
    'Vary': `Accept-Encoding, ${AUTH_TOKEN_HEADER}`,
});

// no-store by default so error responses are never stored. 404 in particular IS heuristically
// cacheable, and there are four of them here — a cached 404 would keep showing a legitimate owner
// "not found" after their analysis finished. Success paths pass their own caching directives,
// which override this.
const sendJson = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    res.end(JSON.stringify(body));
};

// Shared preamble for every endpoint: decode args, validate required keys, identify the caller,
// authorize them against the study, then run the handler.
//
// Authorization failures answer 403 whether the study is missing or simply not the caller's. The
// DDP guards distinguish the two (a legitimate owner benefits from a clear "study not found"), but
// this HTTP surface is the more exposed one and gains nothing from confirming which ids exist.
const restEndpoint = ({required = [], authorize, handle}) => async (req, res) => {
    let args;
    try {
        args = JSON.parse(Buffer.from(req.query.args, 'base64').toString());
    } catch (e) {
        sendJson(res, 400, {error: 'Invalid args'});
        return;
    }

    // JSON.parse("null") succeeds, so the try/catch above does not catch it; indexing null below
    // would then throw outside any handler, leaving the promise rejected with no response written
    // and the socket open until the client times out. Arrays and primitives are rejected here too.
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        sendJson(res, 400, {error: 'Invalid args'});
        return;
    }

    // Required ids must be non-empty STRINGS, not merely truthy. args is attacker-controlled JSON,
    // so an object like {$in: [...]} or {$ne: null} would otherwise flow into a Mongo selector as a
    // query operator — satisfying the ownership lookup via the caller's own study while widening
    // the data query behind it to other users' rows.
    //
    // 400 bodies are now uniformly {errors: [...]}, which is what 12 of the 13 handlers already
    // returned; /api/customGeneSetsFull previously answered {error: "..."} and is brought into
    // line. No client reads either shape — every call site checks response.ok only.
    const missing = required.filter((key) => !isValidId(args[key]));
    if (missing.length > 0) {
        sendJson(res, 400, {errors: [`${missing.join(' and ')} is required`]});
        return;
    }

    const userId = await resolveRequestUserId(req);
    if (!userId) {
        sendJson(res, 401, {error: 'Authentication required'});
        return;
    }

    let session = null;
    try {
        session = await authorize(args, userId);
    } catch (e) {
        console.error(e);
        session = null;
    }
    if (!session) {
        sendJson(res, 403, {error: 'Not authorized for this study'});
        return;
    }

    try {
        await handle({req, res, args, userId, session});
    } catch (e) {
        console.error(e);
        if (!res.headersSent) {
            sendJson(res, 500, {error: e.message});
        }
    }
};

// --- authorizers -----------------------------------------------------------------------------

const ownsSession = ({sessionId}, userId) => findOwnedSession({sessionId, requesterUserId: userId});

const ownsAnalysis = ({analysisId}, userId) =>
    findOwnedSessionForAnalysis({analysisId, requesterUserId: userId});

// Several endpoints name their analysisId `resultId`. Kept as-is so existing clients keep working.
const ownsAnalysisNamedResultId = ({resultId}, userId) =>
    findOwnedSessionForAnalysis({analysisId: resultId, requesterUserId: userId});

// /api/results is keyed on an AnalysisResult._id, which carries no owner: resolve it to its
// analysisId first, then to the owning study.
const ownsResultRow = async ({resultId}, userId) => {
    const result = await DBCollections.AnalysisResult.findOneAsync(
        {_id: resultId},
        {fields: {analysisId: 1}}
    );
    if (!result) return null;
    return findOwnedSessionForAnalysis({analysisId: result.analysisId, requesterUserId: userId});
};

// Endpoints taking both ids: owning the study is not enough, the analysis must also belong to it.
const ownsSessionAnalysis = async ({sessionId, analysisId}, userId) => {
    const session = await findOwnedSession({sessionId, requesterUserId: userId});
    if (!session) return null;
    return collectAnalysisIds(session).includes(analysisId) ? session : null;
};

// --- endpoints -------------------------------------------------------------------------------

WebApp.connectHandlers.use('/api/results', restEndpoint({
    required: ['resultId'],
    authorize: ownsResultRow,
    handle: async ({req, res, args}) => {
        const data = await getResultById(args.resultId);
        if (!data || data.length === 0) {
            sendJson(res, 404, {error: 'Result not found'});
            return;
        }

        // Get the updated timestamp and use it for cache validation
        const lastModified = data[0].updatedAt || new Date();
        const etag = `"${lastModified.getTime()}"`;

        // Check if the client has a cached version
        const ifNoneMatch = req.headers['if-none-match'];
        const ifModifiedSince = req.headers['if-modified-since'];

        // If client's cached version matches our current version, return 304 Not Modified
        if ((ifNoneMatch && ifNoneMatch === etag) ||
            (ifModifiedSince && new Date(ifModifiedSince) >= lastModified)) {
            // Repeat the caching directives on the 304: a revalidation response updates the
            // stored entry's headers, so omitting them would let a cache hold the payload
            // without the `private` restriction or the user-token vary key.
            res.writeHead(304, privateCacheHeaders(ONE_HOUR_SECONDS));
            res.end();
            return;
        }

        // Revalidation still works under `private`; the browser keeps sending If-None-Match.
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'ETag': etag,
            'Last-Modified': lastModified.toUTCString(),
            ...privateCacheHeaders(ONE_HOUR_SECONDS),
        });
        res.end(JSON.stringify(data[0].value));
    },
}));

WebApp.connectHandlers.use('/api/resultsByDb', restEndpoint({
    required: ['resultId'],
    authorize: ownsAnalysisNamedResultId,
    handle: async ({res, args}) => {
        // databaseIds also lands in a selector ({$in: databaseIds}); reject anything that is not a
        // plain array of strings so it cannot carry operators.
        if (!isValidIdArray(args.databaseIds)) {
            sendJson(res, 400, {errors: ['databaseIds must be an array of ids']});
            return;
        }
        const data = await getResultsByDatabase({
            analysisId: args.resultId,
            databaseIds: args.databaseIds,
        });
        if (!data || data.length === 0) {
            sendJson(res, 404, {error: 'Result not found'});
            return;
        }
        sendJson(res, 200, data[0].value, privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/methodResults', restEndpoint({
    required: ['resultId', 'databaseId', 'method'],
    authorize: ownsAnalysisNamedResultId,
    handle: async ({req, res, args}) => {
        const data = await getResultsByMethod({
            analysisId: args.resultId,
            databaseId: args.databaseId,
            method: args.method,
        });

        // Sort the data array by updatedAt in descending order (most recent first)
        if (data && Array.isArray(data) && data.length > 0) {
            data.sort((a, b) => {
                // Handle cases where updatedAt might be missing in either object
                if (!a.updatedAt) return 1;  // Items without updatedAt go to the end
                if (!b.updatedAt) return -1; // Items without updatedAt go to the end

                const dateA = a.updatedAt instanceof Date ? a.updatedAt : new Date(a.updatedAt);
                const dateB = b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt);

                return dateB - dateA;
            });
        }

        // Handle empty or invalid response
        if (!data || !Array.isArray(data) || data.length === 0) {
            sendJson(res, 404, {error: 'Result not found'});
            return;
        }

        let lastModified = new Date();
        try {
            if (data[0] && data[0].updatedAt) {
                lastModified = new Date(data[0].updatedAt);
            }
        } catch (e) {
            console.warn('Could not parse updatedAt field, using current time');
        }

        const etag = `"${lastModified.getTime()}"`;

        const ifNoneMatch = req.headers['if-none-match'];
        const ifModifiedSince = req.headers['if-modified-since'];

        if ((ifNoneMatch && ifNoneMatch === etag) ||
            (ifModifiedSince && new Date(ifModifiedSince) >= lastModified)) {
            // Repeat the caching directives on the 304: a revalidation response updates the
            // stored entry's headers, so omitting them would let a cache hold the payload
            // without the `private` restriction or the user-token vary key.
            res.writeHead(304, privateCacheHeaders(ONE_HOUR_SECONDS));
            res.end();
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'ETag': etag,
            'Last-Modified': lastModified.toUTCString(),
            ...privateCacheHeaders(ONE_HOUR_SECONDS),
        });

        // Safely extract the value or return null
        const responseData = data[0]?.value !== undefined ? data[0].value : null;
        res.end(JSON.stringify(responseData));
    },
}));

WebApp.connectHandlers.use('/api/geneSet', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        const data = await getGeneSetAnalysis(args);
        // An analysis with no geneStats snapshot yields undefined, which would serialize to an
        // empty body under a 200 — a response no client can parse. Answer 404 instead.
        if (data === undefined) {
            sendJson(res, 404, {error: 'Result not found'});
            return;
        }
        sendJson(res, 200, data, privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/analysisGeneSetAll', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        const data = await getAllGeneSetAnalysis(args);
        sendJson(res, 200, data, privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/customGeneSetsFull', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        // Fetch full custom gene sets from snapshots (includes gene lists for pathway network)
        const customGeneSets = await DBCollections.AnalysisConfigSnapshot.find({
            analysisId: args.analysisId,
            key: 'customGeneSets'
        }).fetchAsync();

        sendJson(res, 200, customGeneSets.map((snapshot) => snapshot.value),
            privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/fcPValueData', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        const data = await getFcPValueData(args);
        sendJson(res, 200, data || [], privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/deGenes', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        const data = await getDEGenes(args);
        sendJson(res, 200, data, privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

// Group AnalysisResult rows into {databaseId: {analysisId: {method: value}}} — shared by
// /api/treeData and /api/resultData.
const groupResultsByDbAnalysisMethod = (rows) => {
    const resultData = {};
    rows.forEach((entry) => {
        const {databaseId, analysisId, key: method, value} = entry;

        if (!resultData[databaseId]) {
            resultData[databaseId] = {};
        }
        if (!resultData[databaseId][analysisId]) {
            resultData[databaseId][analysisId] = {};
        }
        resultData[databaseId][analysisId][method] = value;
    });
    return resultData;
};

WebApp.connectHandlers.use('/api/treeData', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        const rows = await getResultsForAnalysis(args.analysisId);
        const resultData = groupResultsByDbAnalysisMethod(rows);

        const analyses = await getAnalysesForSession(args.sessionId);
        const analysesObj = analyses.reduce((acc, curr) => {
            acc[curr.id] = curr;
            return acc;
        }, {});

        sendJson(res, 200, createTreeDataForAnalyses(resultData, analysesObj),
            privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/resultData', restEndpoint({
    required: ['analysisId'],
    authorize: ownsAnalysis,
    handle: async ({res, args}) => {
        const rows = await getResultsForAnalysis(args.analysisId);
        sendJson(res, 200, groupResultsByDbAnalysisMethod(rows),
            privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

const groupByDatabaseId = (rows) => rows.reduce((acc, curr) => {
    if (!acc[curr.databaseId]) {
        acc[curr.databaseId] = [];
    }
    acc[curr.databaseId].push(curr);
    return acc;
}, {});

WebApp.connectHandlers.use('/api/resultsGroupedByDb', restEndpoint({
    required: ['analysisId'],
    authorize: ownsAnalysis,
    handle: async ({res, args}) => {
        const rows = await getResultsForAnalysis(args.analysisId);
        sendJson(res, 200, groupByDatabaseId(rows), privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/resultsGroupedByDbAll', restEndpoint({
    required: ['sessionId'],
    authorize: ownsSession,
    handle: async ({res, args}) => {
        const rows = await getResultsForSession(args.sessionId);
        sendJson(res, 200, groupByDatabaseId(rows), privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

WebApp.connectHandlers.use('/api/mappedGeneIds', restEndpoint({
    required: ['sessionId', 'analysisId'],
    authorize: ownsSessionAnalysis,
    handle: async ({res, args}) => {
        // inputType is deliberately NOT forwarded from args: the previous implementation called
        // analysis.getMappedGeneIds with only {sessionId, analysisId}, so inputType was always
        // undefined and the query never matched. Forwarding it would quietly start returning real
        // data to any caller that supplied one — a behaviour change that does not belong in a
        // security pass. See the note on getMappedGeneIds.
        const data = await getMappedGeneIds({analysisId: args.analysisId});
        sendJson(res, 200, data, privateCacheHeaders(ONE_YEAR_SECONDS));
    },
}));

const createTreeDataForAnalyses = (allAnalysisData, analyses) => {
    let initialTreeData = {};
    let treeData = {};
    for (const databaseId in allAnalysisData) {
        treeData[databaseId] = [];
        initialTreeData[databaseId] = [];
        for (const analysisId in allAnalysisData[databaseId]) {
            if (!analyses[analysisId]) continue; // Ensure the analysisId exists in analyses

            let children = [];

            for (const method in allAnalysisData[databaseId][analysisId]) {
                initialTreeData[databaseId].push(`${analysisId}_${method}_${analyses[analysisId].input}`);
                children.push({
                    title: `${analyses[analysisId].name}_${method.toUpperCase()}`,
                    value: `${analysisId}_${method}_${analyses[analysisId].input}`,
                    key: `${analysisId}_${method}_${analyses[analysisId].input}`,
                });
            }

            treeData[databaseId].push({
                title: analyses[analysisId].name,
                value: analysisId,
                key: analysisId,
                children: children
            });
        }
    }
    return {treeData, initialTreeData};
};

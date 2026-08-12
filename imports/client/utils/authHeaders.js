// Identity header for the /api/* endpoints.
//
// Those endpoints are plain Connect handlers with no DDP session, so they can only identify the
// caller from a token on the request itself. This sends the same Meteor resume token the app
// already attaches to every XMLHttpRequest (imports/client/startup.js); the server hashes it,
// resolves the user, and checks study ownership before returning any data.
//
// Header name matches that existing XHR hook so both transports agree.
export const AUTH_TOKEN_HEADER = 'user-token';

export const authHeaders = () => ({[AUTH_TOKEN_HEADER]: Accounts._storedLoginToken()});

export default authHeaders;

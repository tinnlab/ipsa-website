import { Meteor } from "meteor/meteor";
import { Accounts } from "meteor/accounts-base";

// Resolve the caller of a raw Connect (WebApp.connectHandlers) request to a Meteor userId.
//
// The /api/* result endpoints are plain HTTP middleware, so they get none of DDP's authenticated
// invocation context — there is no this.userId. To check study ownership they must first establish
// who is asking, which means resolving the client's Meteor resume token the same way DDP does:
// hash it and look it up in services.resume.loginTokens.
//
// The raw token is never stored server-side, only its hash, so the lookup below is the only way
// back to the user. This works for every account type in this app — password, auto-created guest,
// and workspace — because the custom workspace login handler mints its token with the standard
// Accounts._hashStampedToken (server/startup/accounts.js), landing in the same array and format.
//
// Header name matches what the client already attaches to every XMLHttpRequest in
// imports/client/startup.js; fetch2 now sends the same header so both transports agree.
export const AUTH_TOKEN_HEADER = "user-token";

export const resolveRequestUserId = async (req) => {
    const rawToken = req && req.headers ? req.headers[AUTH_TOKEN_HEADER] : null;
    // Meteor writes 'null' into the header before login completes; treat any non-token as absent.
    if (!rawToken || typeof rawToken !== "string" || rawToken === "null" || rawToken === "undefined") {
        return null;
    }

    let hashedToken;
    try {
        hashedToken = Accounts._hashLoginToken(rawToken);
    } catch (e) {
        return null; // malformed token — indistinguishable from no token
    }

    const user = await Meteor.users.findOneAsync(
        { "services.resume.loginTokens.hashedToken": hashedToken },
        { fields: { _id: 1, "services.resume.loginTokens": 1 } }
    );
    if (!user) return null;

    // Match DDP's own resume path and honour expiry. Meteor's periodic sweep eventually removes
    // stale tokens from the array, but until it runs a presence-only check would keep accepting an
    // expired one.
    const token = (user.services?.resume?.loginTokens || [])
        .find((entry) => entry.hashedToken === hashedToken);
    if (!token) return null;

    const expiresAt = Accounts._tokenExpiration(token.when);
    if (expiresAt && expiresAt.getTime() <= Date.now()) return null;

    return user._id;
};

export default resolveRequestUserId;

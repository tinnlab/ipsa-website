import { Meteor } from 'meteor/meteor';

// Close direct client-side database writes.
//
// The app ships the `insecure` package (.meteor/packages), which was never removed after
// prototyping, and no collection declared a single allow/deny rule. That combination registers the
// default DDP mutation methods (/sessions/update and friends) and applies them WITHOUT validation
// for any connected client. The only constraint allow-deny still enforces is that the selector be a
// bare _id — which is exactly what a shared URL hands out.
//
// That made every ownership check in this app decorative, because ownership itself was writable:
//
//     DBCollections.Session.update(victimSessionId, {$set: {userId: Meteor.userId()}})
//
// run from the browser console reassigns a study to the caller, after which every publication,
// method and REST endpoint correctly answers "yes, you own this". Variants could push a foreign
// analysisId into a study's metaAnalyses[] (which the ownership guards read), or delete another
// user's AnalysisResult rows outright.
//
// Registering ANY rule flips a collection out of insecure mode into the validated path
// (allow-deny sets _restricted), where a write needs a passing allow rule. We register a blanket
// deny and no allow rules, so every client-originated insert/update/remove is refused. Server-side
// writes — every Meteor method in this app — bypass allow/deny entirely and are unaffected.
//
// allow-deny keeps a SEPARATE validator bucket per method name, and the sync and async names are
// distinct: _validatedUpdateAsync consults _validators.updateAsync.deny, not _validators.update.deny
// (allow-deny.js). Registering only the three sync names would leave the async buckets empty, so all
// six are declared here rather than relying on which name a given client call resolves to.
//
// fetch: [] keeps allow-deny from loading the target document just to run a validator that ignores
// it.
const DENY_ALL = {
    insert: () => true,
    update: () => true,
    remove: () => true,
    insertAsync: () => true,
    updateAsync: () => true,
    removeAsync: () => true,
    fetch: [],
};

Meteor.startup(() => {
    const collections = typeof DBCollections !== 'undefined' ? DBCollections : {};
    const names = Object.keys(collections);

    // Fail the boot rather than come up silently unprotected. This runs after collections.js
    // (same-directory siblings load alphabetically, and DBCollections is assigned in the
    // synchronous prefix of that startup hook), so an empty object means the load order moved and
    // every collection would otherwise be left in insecure mode.
    if (names.length === 0) {
        throw new Error(
            '[lockdown] DBCollections is empty at startup; refusing to boot with client writes open.'
        );
    }

    const unprotected = [];
    for (const [name, collection] of Object.entries(collections)) {
        if (collection && typeof collection.deny === 'function') {
            collection.deny(DENY_ALL);
        } else {
            unprotected.push(name);
        }
    }

    if (unprotected.length > 0) {
        throw new Error(
            `[lockdown] these collections do not support deny(), client writes would stay open: ${unprotected.join(', ')}`
        );
    }

    console.log(`[lockdown] client writes denied on ${names.length} collections`);

    // accounts-base installs its own allow rule permitting a client to update its OWN profile
    // field. This app stores the admin role at profile.roles (server/api/helper/Permission.js),
    // so that rule let any visitor — and every visitor is auto-issued a guest account on load —
    // promote itself with:
    //
    //     Meteor.users.update(Meteor.userId(), {$set: {profile: {roles: ['admin']}}})
    //
    // A deny rule takes precedence over any allow rule, so this closes it. Nothing in the app
    // writes to Meteor.users from the client; account creation and login go through methods,
    // which are server-side and unaffected.
    Meteor.users.deny(DENY_ALL);
});

import {Meteor} from "meteor/meteor";
import {Random} from "meteor/random";

Meteor.methods({
    async 'user.createGuestAccount'() {
        let info = {
            username: "guest-" + Random.id(),
            password: Random.id(),
            profile: {
                name: 'Guest',
                roles: ['guest']
            }
        }
        await Accounts.createUserAsync(info)
        return info
    },
});

// 'user.saveWorkspace' was removed here. It took currentUserId straight from the caller and used it
// to overwrite that account's username, email address and password hash, then mailed the new
// password to a client-supplied address — an unauthenticated takeover of any account by id, and
// through it every study that account owns:
//
//     Meteor.call('user.saveWorkspace', {currentUserId: VICTIM, email: 'attacker@example.com', ...})
//
// It had no callers anywhere in the app and was superseded by 'workspace.save'
// (server/api/methods/session.js), which derives the account from this.userId, validates its inputs
// and is what the Save Workspace modal actually calls.

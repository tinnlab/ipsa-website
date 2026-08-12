import {Meteor} from 'meteor/meteor';
import {Accounts} from 'meteor/accounts-base';
import {Random} from 'meteor/random';
import {createHash} from "crypto";

Meteor.startup(async () => {

    Accounts.config({
        forbidClientAccountCreation: true
    });

    // Seed a single administrator so a fresh database is usable. Every reference-data
    // import method is gated by Permission.checkAdmin, so without this there is no way in.
    // The password comes from ADMIN_PASSWORD; if it is unset a random one is generated and
    // printed once, so no usable credential is ever hard-coded in this repository.
    const adminUsername = process.env.ADMIN_USERNAME || "admin";

    if (!await Meteor.users.findOneAsync({username : adminUsername})){
        const generated = !process.env.ADMIN_PASSWORD;
        const adminPassword = process.env.ADMIN_PASSWORD || Random.secret(24);

        // createUser is async on the server in Meteor 3. Await it and report only after it
        // resolves, so the log cannot claim success for an account that was never created,
        // and a rejection (a racing replica, a transient Mongo error) cannot escape as an
        // unhandled rejection and take the process down on restart.
        try {
            await Accounts.createUserAsync({
                username : adminUsername,
                password : adminPassword,
                profile : {
                    roles : ["admin", "user"]
                }
            });

            if (generated) {
                console.log(
                    `[accounts] Created administrator "${adminUsername}" with a generated password: ${adminPassword}\n` +
                    `[accounts] Store it now - it is not shown again. Set ADMIN_PASSWORD to choose your own.`
                );
            } else {
                console.log(`[accounts] Created administrator "${adminUsername}" from ADMIN_PASSWORD.`);
            }
        } catch (e) {
            // Another instance winning the race is the expected benign case.
            if (await Meteor.users.findOneAsync({username : adminUsername})) {
                console.log(`[accounts] Administrator "${adminUsername}" already exists; nothing to do.`);
            } else {
                console.error(`[accounts] Failed to create administrator "${adminUsername}": ${e.message}`);
            }
        }
    }

    Accounts.registerLoginHandler(async function (loginRequest) {
        if (!loginRequest.workspace) {
            return undefined;
        }
        let user = await Meteor.users.findOneAsync({username: loginRequest.username});

        if (!user) {
            return {
                error: new Meteor.Error(403, "The workspace is not found. Please enter the correct workspace name to access it.")
            };
        }

        let userId = user._id;

        if (user.services.password && user.services.password.bcrypt) {
            // Password is set, verify the provided password
            if (!loginRequest.passcode) {
                return {
                    error: new Meteor.Error(403, "The workspace is password-protected. Please enter the password to access it")
                };
            }

            const passwordMatch = (user.services.password.bcrypt === hashPassword(loginRequest.passcode));

            if (!passwordMatch) {
                return {
                    error: new Meteor.Error(403, "Invalid password. Please enter the correct password to access the workspace.")
                };
            }
        }

        // Creating the token and adding to the user
        var stampedToken = Accounts._generateStampedLoginToken();
        var hashStampedToken = Accounts._hashStampedToken(stampedToken);

        await Meteor.users.updateAsync(userId,
            {$push: {'services.resume.loginTokens': hashStampedToken}}
        );

        // Send logged-in user's user ID
        return {
            userId: userId,
            token: stampedToken.token
        };
    });
});

function hashPassword(password) {
    const hash = createHash('sha256').update(password).digest('hex');
    return hash;
}
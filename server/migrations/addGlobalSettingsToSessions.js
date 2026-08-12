import { Meteor } from 'meteor/meteor';
import Permission from '../api/helper/Permission';

/**
 * Migration script to add globalSettings field to existing sessions
 *
 * This should be run once after deploying the global settings feature
 * to ensure all existing sessions have the default globalSettings values.
 *
 * Usage:
 * - Call Meteor.call('migration.addGlobalSettingsToSessions') from the server console
 * - Or run automatically on startup (uncomment Meteor.startup block below)
 */

Meteor.methods({
    async 'migration.addGlobalSettingsToSessions'() {
        // `!this.isSimulation` is ALWAYS true on the server, so this was not a guard at all — any
        // anonymous DDP caller could run a {multi: true} update across every study on the platform.
        // Operator-only.
        await Permission.isAdmin(this.userId);
        // Only allow running on server
        if (!this.isSimulation) {
            const defaultSettings = {
                pValueFDR: 0.05,
                pValue: 0.05,
                foldChange: 1.0,
                enrichmentScore: 1.5
            };

            try {
                // Find all sessions without globalSettings
                const sessionsToUpdate = await DBCollections.Session.find({
                    globalSettings: { $exists: false }
                }).countAsync();

                console.log(`Found ${sessionsToUpdate} sessions without globalSettings`);

                // Update all sessions that don't have globalSettings
                const result = await DBCollections.Session.updateAsync(
                    { globalSettings: { $exists: false } },
                    {
                        $set: {
                            globalSettings: defaultSettings
                        }
                    },
                    { multi: true }
                );

                console.log(`Migration complete: Updated ${result} sessions with default globalSettings`);

                return {
                    success: true,
                    message: `Successfully added globalSettings to ${result} sessions`,
                    sessionsUpdated: result
                };
            } catch (error) {
                console.error('Migration failed:', error);
                throw new Meteor.Error('migration-failed', `Failed to add globalSettings: ${error.message}`);
            }
        }
    }
});

// Uncomment this block to run migration automatically on server startup
// WARNING: Only do this once, then comment it out again
/*
Meteor.startup(async () => {
    console.log('Running globalSettings migration...');
    try {
        await Meteor.callAsync('migration.addGlobalSettingsToSessions');
        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    }
});
*/

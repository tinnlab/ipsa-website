import { Meteor } from "meteor/meteor";
import { seedBaselineReports } from "/server/helper/baselineReports";

// Seed the owner-supplied baseline reports on boot. The logic lives in
// server/helper/baselineReports.js (injectable deps, unit-tested); this file is only the wiring.
//
// THE FILENAME IS LOAD-BEARING, for the same reason seed-case-studies.js documents: package.json
// declares no server mainModule, so Meteor eagerly loads server/** in alphabetical order and
// Meteor.startup callbacks fire in registration order. "seed-baseline-reports.js" sorts AFTER
// collections.js, which creates global.DBCollections — a name sorting before it would crash here on
// an undefined DBCollections.
//
// It sorts BEFORE seed-case-studies.js, which is fine and deliberate: this seeder resolves its
// target study from the caseStudies SETTINGS block, never from the StudyShare row that seeder
// writes. Depending on that row would make this file's position load-bearing in the other
// direction, and would break on the very first boot after a deploy, when the row does not exist yet.
Meteor.startup(async () => {
    // Same guard cron-job.js and seed-case-studies.js use: importing this module in a test must
    // never write to the database.
    if (Meteor.isTest || Meteor.isAppTest) return;

    try {
        const result = await seedBaselineReports({});
        // Log even when there is nothing to do, so an operator can tell "none configured" from
        // "the seeder never ran".
        console.log(
            `[baseline-report] seed done: ${result.seeded} created, ${result.repointed} re-pointed, `
            + `${result.unchanged} already seeded, ${result.skipped} skipped`
        );
    } catch (error) {
        // Never take the server down over three static reports.
        console.error("[baseline-report] seed failed:", error);
    }
});

import { Meteor } from "meteor/meteor";
import { seedCaseStudies } from "/server/helper/caseStudies";

// Seed the public case studies on boot. The logic lives in server/helper/caseStudies.js (injectable
// deps, unit-tested); this file is only the wiring.
//
// THE FILENAME IS LOAD-BEARING. package.json declares no server mainModule, so Meteor eagerly loads
// server/** in alphabetical order and Meteor.startup callbacks fire in registration order.
// "seed-case-studies.js" sorts AFTER:
//
//   - collections.js — which creates global.DBCollections. A name like "case-studies.js" would sort
//     BEFORE it and crash here on an undefined DBCollections.
//   - cron-job.js — whose startup awaits backfillLegacyExpiry. On the very FIRST boot after deploy
//     a case study has no `permanent` flag yet, so that backfill's own {permanent: {$ne: true}}
//     guard cannot protect it and it stamps an expiredAt. Running after it means we clear that
//     stamp in the same boot. From the second boot on, the guard does the work and the order is
//     merely belt-and-braces. Both are needed; neither alone is sufficient.
Meteor.startup(async () => {
    // Same guard cron-job.js uses: importing this module in a test must never write to the database.
    if (Meteor.isTest || Meteor.isAppTest) return;

    try {
        const result = await seedCaseStudies({});
        // Log even when there is nothing to do, so an operator can tell "no case studies configured"
        // from "the seeder never ran".
        console.log(
            `[case-study] seed done: ${result.seeded} created, ${result.updated} refreshed, `
            + `${result.unchanged} unchanged, ${result.skipped} skipped`
        );
    } catch (error) {
        // Never take the server down over the examples on the homepage.
        console.error("[case-study] seed failed:", error);
    }
});

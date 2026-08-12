import { Meteor } from 'meteor/meteor';
import fs from 'fs';

Meteor.startup(() => {
    // Ensure the .data subdirs exist. They are created at image-build time
    // (Dockerfile_prod), but in prod .data is a host bind mount (CPA_DATA_PATH) that can
    // start empty or only partially seeded — which would shadow the build-time dirs and
    // make every R run fail when it writes scratch into tempDir. Re-create them here so an
    // empty mount is self-healing. Idempotent (recursive mkdir no-ops when present).
    const p = Meteor.settings.private || {};
    for (const dir of [p.tempDir, p.userDataDir, p.exampleDataDir, p.tempUploadDir, p.mitocartaDir]) {
        if (dir) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (e) {
                console.error(`Failed to ensure data dir ${dir}:`, e);
            }
        }
    }

    // query all analysis running, set isRunning equal to false then set status
    // internal error - please re-run analysis

    DBCollections.AnalysisLog.rawCollection().updateMany({isRunning: true}, {
        $set : {
            isRunning: false,
            status: "Server error, please rerun the analysis"
        }
    })

});

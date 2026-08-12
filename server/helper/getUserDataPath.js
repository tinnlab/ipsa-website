import {Meteor} from "meteor/meteor";
import path from "path"
import sanitize from "sanitize-filename"

// Resolve the on-disk path of an analysis input file for the CURRENT caller.
//
// The filename argument is not trustworthy. It comes from AnalysisConfig.expressionFile /
// .groupFile, which analysis.update writes verbatim from client-supplied data — so a caller could
// store '../../<otherUser>/<otherSession>/expression.csv', or walk out of the upload tree entirely,
// and this join would follow it. That turned the ordinary "read my input file" paths into an
// arbitrary server file read: the expression branch parses the file and stores it into the caller's
// own `input` config row (which analysis.update then returns), and the group branch reads it with a
// plain fs.readFile into `groupData`, which the caller's own subscription publishes.
//
// Confinement is enforced here rather than at each of the six call sites, so no reader can forget
// it. Mirrors the guards used by the upload handlers and the static-file routes.
const assertInsideUserDir = (userDir, fullPath) => {
    const rel = path.relative(path.resolve(userDir), path.resolve(fullPath));
    if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Meteor.Error("invalid-path", "Invalid input file path.");
    }
    return fullPath;
};

export default async (fileName, sessionId) => {

    let user = await Meteor.userAsync()
    if (!user) {
        throw new Meteor.Error("not-authorized", "You must be logged in.");
    }
    if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Meteor.Error("invalid-path", "Invalid study for this input file.");
    }

    // Strip any directory component from the stored name before it reaches the join. sanitize
    // collapses traversal and separators; a name that sanitizes to nothing is rejected outright
    // rather than silently resolving to the session directory.
    const safeName = sanitize(String(fileName ?? ""));
    if (!safeName) {
        throw new Meteor.Error("invalid-path", "Invalid input file name.");
    }

    const sessionDir = path.join(Meteor.settings.private.tempUploadDir, user._id, sessionId);
    return assertInsideUserDir(sessionDir, path.join(sessionDir, safeName));
}

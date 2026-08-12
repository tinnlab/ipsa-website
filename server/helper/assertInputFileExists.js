import { Meteor } from "meteor/meteor";
import fs from "fs";

// Error code shared between the throw site and the client banner that branches on it
// (imports/utils/deAnalysisUtils.js → isMissingInputError). Keep these in sync.
export const INPUT_FILE_MISSING_ERROR = "input-file-missing";

export const INPUT_FILE_MISSING_MESSAGE =
    "Your uploaded data file is no longer available (it may have been removed during " +
    "maintenance or after long inactivity). Please re-upload your data to re-run this analysis.";

// Guard the on-disk source file before handing it to R. The expression/group CSVs live in
// the bind-mounted .data/tmp-upload tree; if that file is gone (redeploy before the volume
// was added, or auto-purged after long inactivity) read.csv otherwise fails deep inside R
// with an opaque "cannot open the connection". Throwing a typed Meteor.Error lets the client
// show a friendly "please re-upload" prompt instead.
export const assertInputFileExists = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Meteor.Error(INPUT_FILE_MISSING_ERROR, INPUT_FILE_MISSING_MESSAGE);
    }
    return filePath;
};

export default assertInputFileExists;

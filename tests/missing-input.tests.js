// Tests for graceful missing-uploaded-file handling.
//   Unit: the client-side error predicate (imports/utils/deAnalysisUtils.isMissingInputError).
//   Integration: the server guard (server/helper/assertInputFileExists) against real files.
// Server-only (the guard imports Meteor + fs).
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { isMissingInputError, INPUT_FILE_MISSING_ERROR } from "../imports/utils/deAnalysisUtils";
import {
    assertInputFileExists,
    INPUT_FILE_MISSING_ERROR as SERVER_CODE,
} from "../server/helper/assertInputFileExists";

describe("missing input — isMissingInputError (client predicate)", function () {
    it("is true only for the typed input-file-missing error", function () {
        assert.strictEqual(isMissingInputError({ error: "input-file-missing" }), true);
        assert.strictEqual(isMissingInputError({ error: INPUT_FILE_MISSING_ERROR }), true);
    });
    it("is false for other Meteor errors / plain errors / empties", function () {
        assert.strictEqual(isMissingInputError({ error: "analysis.start.error" }), false);
        assert.strictEqual(isMissingInputError(new Error("boom")), false);
        assert.strictEqual(isMissingInputError(null), false);
        assert.strictEqual(isMissingInputError(undefined), false);
        assert.strictEqual(isMissingInputError({}), false);
    });
    it("server and client agree on the error code", function () {
        assert.strictEqual(SERVER_CODE, INPUT_FILE_MISSING_ERROR);
    });
});

describe("missing input — assertInputFileExists (server guard)", function () {
    let root;
    beforeEach(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-missing-input-"));
    });
    afterEach(function () {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it("returns the path for an existing file (no throw)", function () {
        const file = path.join(root, "expr.csv");
        fs.writeFileSync(file, "Gene,S1\nG1,1\n");
        assert.strictEqual(assertInputFileExists(file), file);
    });

    it("throws a typed Meteor.Error for a missing file", function () {
        const missing = path.join(root, "gone.csv");
        assert.throws(
            () => assertInputFileExists(missing),
            (err) => err && err.error === "input-file-missing"
        );
    });

    it("throws for an empty/undefined path", function () {
        assert.throws(() => assertInputFileExists(""), (err) => err.error === "input-file-missing");
        assert.throws(() => assertInputFileExists(undefined), (err) => err.error === "input-file-missing");
    });
});

import assert from "assert";
import {extractMethodResults} from "../imports/utils/methodResults";

const KEGG = "2GwfEq5Xu7T5MqgZG";
const ANALYSIS = "msDytHZRJyfpF374T";

const rows = [{pathway: "hsa04110", pValue: 0.001}];
const payload = {[KEGG]: {[ANALYSIS]: {ora: rows}}};

describe("extractMethodResults (/api/resultData reader)", function () {
    it("returns the per-method map for a present database + analysis", function () {
        assert.deepStrictEqual(extractMethodResults(payload, KEGG, ANALYSIS), {ora: rows});
    });

    it("returns the SAME rows reference, so no data is copied on the hot path", function () {
        assert.strictEqual(extractMethodResults(payload, KEGG, ANALYSIS).ora, rows);
    });

    // The reachable false negative: an analysis with no rows for this database made
    // `resJson[db][analysis]` throw INSIDE the fetch's try, the catch swallowed it, and the pane
    // reported "no significant pathways" for a study that may well have had them.
    it("returns null instead of throwing when the database key is absent", function () {
        assert.strictEqual(extractMethodResults({otherDb: {}}, KEGG, ANALYSIS), null);
    });

    // Not reachable through /api/resultData today (getResultsForAnalysis selects on analysisId, so
    // a present database key always carries it) — guarded because the client has no error boundary,
    // and `Object.keys(undefined)` in the render guard would blank the whole page.
    it("returns null instead of undefined when the analysis key is absent", function () {
        const result = extractMethodResults({[KEGG]: {someOtherAnalysis: {ora: rows}}}, KEGG, ANALYSIS);
        assert.strictEqual(result, null);
        // The distinction that matters: undefined would survive into state and throw later.
        assert.notStrictEqual(result, undefined);
    });

    it("distinguishes an empty-but-present method map from an absent one", function () {
        // A successful answer that happens to carry no methods is {}, not null: the fetch worked.
        assert.deepStrictEqual(extractMethodResults({[KEGG]: {[ANALYSIS]: {}}}, KEGG, ANALYSIS), {});
        assert.strictEqual(extractMethodResults({[KEGG]: {}}, KEGG, ANALYSIS), null);
    });

    it("never throws on a malformed or hostile payload", function () {
        const junk = [null, undefined, 0, "", "a string", 42, true, [], [1, 2], NaN];
        for (const value of junk) {
            assert.strictEqual(extractMethodResults(value, KEGG, ANALYSIS), null,
                `payload ${JSON.stringify(value)} should yield null`);
        }
        // Nested junk at each level.
        assert.strictEqual(extractMethodResults({[KEGG]: "nope"}, KEGG, ANALYSIS), null);
        assert.strictEqual(extractMethodResults({[KEGG]: [rows]}, KEGG, ANALYSIS), null);
        assert.strictEqual(extractMethodResults({[KEGG]: {[ANALYSIS]: []}}, KEGG, ANALYSIS), null);
        assert.strictEqual(extractMethodResults({[KEGG]: {[ANALYSIS]: "nope"}}, KEGG, ANALYSIS), null);
    });

    it("returns null for a missing/undefined databaseId rather than picking an arbitrary key", function () {
        assert.strictEqual(extractMethodResults(payload, undefined, ANALYSIS), null);
        assert.strictEqual(extractMethodResults(payload, KEGG, undefined), null);
    });
});

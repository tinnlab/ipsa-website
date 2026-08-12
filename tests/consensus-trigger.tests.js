// Unit tests for the consensus trigger gate.
// Pure helper — verifies consensus runs IFF the user enabled consensus AND more
// than one (non-consensus) method is enabled, and that the historical
// "fires on default {} / counts consensus itself / ignores consensus.enabled"
// defects are gone. See imports/methods/consensusTrigger.js.
import assert from "assert";
import { shouldRunConsensus, shouldRunConsensusForConfigDoc } from "../imports/methods/consensusTrigger";

// Convenience builders
const method = (enabled) => ({ enabled });
const withConsensus = (enabled, rest = {}) => ({ consensus: { enabled, methods: [] }, ...rest });

describe("consensus trigger gate (shouldRunConsensus)", function () {
    it("does NOT run for ORA-only analyses, even if consensus + many methods are enabled", function () {
        const ms = withConsensus(true, { ora: method(true), ks: method(true), wilcox: method(true) });
        assert.strictEqual(shouldRunConsensus(ms, "ora"), false);
    });

    it("does NOT run on the default/empty methodSettings ({})", function () {
        // Regression: the old gate's `Object.keys(ms).length === 0` branch fired
        // on the un-loaded default state.
        assert.strictEqual(shouldRunConsensus({}, "expression"), false);
        assert.strictEqual(shouldRunConsensus(undefined, "expression"), false);
    });

    it("does NOT run when the consensus key is absent", function () {
        const ms = { ora: method(true), ks: method(true) };
        assert.strictEqual(shouldRunConsensus(ms, "expression"), false);
    });

    it("does NOT run when consensus is disabled, even with 2+ methods enabled", function () {
        // Regression: the old gate never checked consensus.enabled.
        const ms = withConsensus(false, { ora: method(true), ks: method(true) });
        assert.strictEqual(shouldRunConsensus(ms, "expression"), false);
    });

    it("does NOT run with consensus enabled but 0 methods enabled", function () {
        const ms = withConsensus(true, { ora: method(false), ks: method(false) });
        assert.strictEqual(shouldRunConsensus(ms, "expression"), false);
    });

    it("does NOT run with consensus enabled but only 1 method enabled", function () {
        const ms = withConsensus(true, { ora: method(true), ks: method(false) });
        assert.strictEqual(shouldRunConsensus(ms, "expression"), false);
    });

    it("RUNS with consensus enabled and exactly 2 methods enabled", function () {
        const ms = withConsensus(true, { ora: method(true), ks: method(true) });
        assert.strictEqual(shouldRunConsensus(ms, "expression"), true);
    });

    it("does NOT count the consensus entry itself toward the >1 method check", function () {
        // Regression: consensus enabled + only 1 real method must be false, even
        // though `consensus` is also "enabled".
        const ms = { consensus: { enabled: true, methods: [] }, ora: method(true), ks: method(false) };
        assert.strictEqual(shouldRunConsensus(ms, "expression"), false);
    });

    it("ignores methods whose `enabled` is undefined/falsy", function () {
        const ms = { consensus: { enabled: true }, ora: {}, ks: { enabled: undefined }, wilcox: method(true) };
        // only wilcox is truly enabled -> 1 method -> false
        assert.strictEqual(shouldRunConsensus(ms, "expression"), false);
    });

    it("RUNS for pgsea input with consensus enabled and 2 methods enabled", function () {
        const ms = withConsensus(true, { wilcox: method(true), fgsea: method(true) });
        assert.strictEqual(shouldRunConsensus(ms, "pgsea"), true);
    });

    it("RUNS with 3 methods enabled (sanity, >2)", function () {
        const ms = withConsensus(true, { ora: method(true), ks: method(true), wilcox: method(true) });
        assert.strictEqual(shouldRunConsensus(ms, "expression"), true);
    });
});

// The config-doc wrapper used by BOTH the wizard (Step5_RunAnalysis) and the
// mass-analysis queue worker (processQueueItem). The AnalysisConfig doc stores
// the method map under `value`; this layer must extract it correctly.
describe("consensus trigger from config doc (shouldRunConsensusForConfigDoc)", function () {
    const configDoc = (valueMap) => ({
        _id: "x", analysisId: "a1", inputType: "expression",
        key: "methodSettings", value: valueMap,
    });

    it("returns false for a null/undefined config doc (analysis with no methodSettings doc)", function () {
        assert.strictEqual(shouldRunConsensusForConfigDoc(undefined, "expression"), false);
        assert.strictEqual(shouldRunConsensusForConfigDoc(null, "expression"), false);
    });

    it("returns false when the doc has no `value` field", function () {
        assert.strictEqual(shouldRunConsensusForConfigDoc({ key: "methodSettings" }, "expression"), false);
    });

    it("reads the method map from `value` and RUNS when consensus enabled + 2 methods", function () {
        const doc = configDoc({ consensus: { enabled: true, methods: [] }, ora: method(true), ks: method(true) });
        assert.strictEqual(shouldRunConsensusForConfigDoc(doc, "expression"), true);
    });

    it("does NOT run when consensus is disabled in `value`, even with 2 methods", function () {
        const doc = configDoc({ consensus: { enabled: false }, ora: method(true), ks: method(true) });
        assert.strictEqual(shouldRunConsensusForConfigDoc(doc, "expression"), false);
    });

    it("does NOT run for ORA input even when the doc would otherwise qualify", function () {
        const doc = configDoc({ consensus: { enabled: true }, ora: method(true), ks: method(true) });
        assert.strictEqual(shouldRunConsensusForConfigDoc(doc, "ora"), false);
    });

    it("RUNS for a mass-analysis pgsea config doc with consensus enabled + 2 methods", function () {
        const doc = configDoc({ consensus: { enabled: true, methods: [] }, wilcox: method(true), fgsea: method(true) });
        assert.strictEqual(shouldRunConsensusForConfigDoc(doc, "pgsea"), true);
    });
});

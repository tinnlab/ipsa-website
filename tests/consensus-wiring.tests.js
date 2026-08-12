// Unit tests for the consensus algorithm/ranking wiring.
// Pure helper — verifies the user's `consensus_method` and `rankBy` choices are
// honored instead of being silently forced to RRA/pFDR (the previous bug where
// consensus ALWAYS ran RRA regardless of the UI selection).
import assert from "assert";
import { resolveConsensusOptions } from "../imports/methods/consensusConfig";

describe("consensus wiring — resolveConsensusOptions", function () {
    it("honors weightedZMean (regression: was silently forced to RRA)", function () {
        const { method } = resolveConsensusOptions({ consensus_method: "weightedZMean", methods: ["ora", "gsea"] });
        assert.strictEqual(method, "weightedZMean");
    });

    it("honors RRA when explicitly selected", function () {
        assert.strictEqual(resolveConsensusOptions({ consensus_method: "RRA" }).method, "RRA");
    });

    it("honors rankBy = normalizedScore", function () {
        assert.strictEqual(resolveConsensusOptions({ rankBy: "normalizedScore" }).rankBy, "normalizedScore");
    });

    it("defaults to RRA / pFDR when fields are missing or block is absent", function () {
        assert.deepStrictEqual(resolveConsensusOptions({}), { method: "RRA", rankBy: "pFDR" });
        assert.deepStrictEqual(resolveConsensusOptions(undefined), { method: "RRA", rankBy: "pFDR" });
    });

    it("falls back to defaults on unknown values", function () {
        const r = resolveConsensusOptions({ consensus_method: "bogus", rankBy: "nope" });
        assert.deepStrictEqual(r, { method: "RRA", rankBy: "pFDR" });
    });

    it("neutralizes R-injection strings to the safe defaults (this resolver is the trust boundary the compute method uses)", function () {
        const evil = resolveConsensusOptions({
            consensus_method: 'RRA"); system("rm -rf /"); #',
            rankBy: 'pFDR"); file.remove(".") #',
        });
        // Any non-whitelisted value collapses to the default, so nothing
        // attacker-controlled can ever be interpolated into the R script.
        assert.deepStrictEqual(evil, { method: "RRA", rankBy: "pFDR" });
    });

    it("only accepts the two whitelisted rankBy values the UI offers", function () {
        assert.strictEqual(resolveConsensusOptions({ rankBy: "p.value" }).rankBy, "pFDR");
        assert.strictEqual(resolveConsensusOptions({ rankBy: "both" }).rankBy, "pFDR");
        assert.strictEqual(resolveConsensusOptions({ rankBy: "pFDR" }).rankBy, "pFDR");
        assert.strictEqual(resolveConsensusOptions({ rankBy: "normalizedScore" }).rankBy, "normalizedScore");
    });
});

import assert from "assert";
import fgsea from "../server/include/rCommand/fgsea";
import fgseaExpr from "../server/include/rCommand/fgsea-expr";
import {resolveMethodSeed} from "../server/include/rCommand/utils";

// Reproducibility regression for FGSEA.
//
// FGSEA's nperm-based p-values (and the BH-adjusted pValueFDR) come from
// randomly permuting gene labels against a fixed ranked list -- the only
// stochastic step. The expression-input generator (fgsea-expr.js) previously
// set no seed at all, so its pValueFDR drifted run-to-run for the same data.
// Both generators must now call set.seed(seed) BEFORE fgsea::fgsea(), where
// `seed` is threaded from the method's randomSeed setting (default 1).
//
// Pure test: asserts on the generated R string -- no R execution required.

describe("FGSEA reproducibility (configurable seed)", function () {
    for (const [name, gen] of [["fgsea", fgsea], ["fgsea-expr", fgseaExpr]]) {
        const script = gen({ rdsFile: "/tmp/dummy.rds" });

        it(`${name}: seeds the RNG from the passed seed argument`, function () {
            assert.ok(
                /set\.seed\s*\(\s*seed\s*\)/.test(script),
                `${name} must call set.seed(seed)`
            );
        });

        it(`${name}: set.seed runs before the fgsea::fgsea call`, function () {
            const s = script.indexOf("set.seed");
            const f = script.indexOf("fgsea::fgsea");
            assert.ok(s !== -1, `${name}: expected a set.seed call`);
            assert.ok(f !== -1, `${name}: expected a fgsea::fgsea call`);
            assert.ok(s < f, `${name}: set.seed must precede fgsea::fgsea`);
        });

        it(`${name}: accepts seed as a function parameter`, function () {
            assert.ok(
                /function\([^)]*\bseed\b[^)]*\)/.test(script),
                `${name}: do.call function must declare a seed parameter`
            );
        });

        // do.call matches RDS list elements to args BY NAME. The `seed = 1`
        // default guarantees a sane seed even if an older RDS payload (built
        // before the randomSeed wiring) lacks the key, so name-matching can't
        // leave `seed` unbound.
        it(`${name}: declares a default seed = 1 so do.call never leaves seed unbound`, function () {
            assert.ok(
                /\bseed\s*=\s*1\b/.test(script),
                `${name}: function signature should default seed = 1`
            );
        });
    }
});

// Guards the seed value that analysis.js interpolates into both FGSEA RDS
// payloads. Both fgsea sites call resolveMethodSeed(methods[method]); this
// helper is the trust boundary that prevents `seed = undefined` (invalid R that
// crashes the run) when a pre-existing analysis config -- whose methodSettings
// .fgsea predates the randomSeed parameter -- is re-run.
describe("resolveMethodSeed (FGSEA seed guard for analysis.js)", function () {
    it("passes a configured seed straight through", function () {
        assert.strictEqual(resolveMethodSeed({ randomSeed: 42 }), 42);
    });

    it("preserves a seed of 0 (uses ?? not ||; 0 is a valid seed)", function () {
        assert.strictEqual(resolveMethodSeed({ randomSeed: 0 }), 0);
    });

    it("falls back to 1 when randomSeed is absent (old config snapshot)", function () {
        assert.strictEqual(resolveMethodSeed({ permutation: 10000 }), 1);
    });

    it("falls back to 1 for null / undefined randomSeed or missing config", function () {
        assert.strictEqual(resolveMethodSeed({ randomSeed: null }), 1);
        assert.strictEqual(resolveMethodSeed({ randomSeed: undefined }), 1);
        assert.strictEqual(resolveMethodSeed(undefined), 1);
    });

    it("never yields undefined/NaN that would render as invalid R", function () {
        for (const cfg of [undefined, {}, { randomSeed: null }, { randomSeed: 7 }, { randomSeed: 0 }]) {
            const s = resolveMethodSeed(cfg);
            assert.ok(Number.isFinite(s), `seed must be finite for ${JSON.stringify(cfg)} (got ${s})`);
        }
    });
});

// The logFCSE a pgsea (gene list with statistics) dataset contributes to gene-level
// meta-analysis is derived from its FC and raw p — imports/utils/pgseaLogFCSE.js. These prove the
// inversion (a derived SE reproduces the original p) and every clamp. Pure module; runs server-side.
import assert from "assert";
import {
    derivePgseaLogFCSE, qnorm, SE_MIN, SE_MAX, FC_EPS, P_MIN, P_MAX,
} from "../imports/utils/pgseaLogFCSE";

// Independent complementary error function, so the round trip does not check qnorm against
// itself: the Maclaurin series of erf for small x, and the Laplace continued fraction
// erfc(x) = exp(-x^2) / (sqrt(pi) * (x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))) otherwise,
// evaluated backwards to a fixed depth.
const erfc = (x) => {
    const ax = Math.abs(x);
    let r;
    if (ax < 1) {
        let sum = ax, term = ax;
        for (let n = 1; n < 80; n++) {
            term *= -ax * ax / n;
            sum += term / (2 * n + 1);
        }
        r = 1 - (2 / Math.sqrt(Math.PI)) * sum;
    } else {
        let t = ax;
        for (let n = 4000; n >= 1; n--) t = ax + (n / 2) / t;
        r = Math.exp(-ax * ax) / (Math.sqrt(Math.PI) * t);
    }
    return x >= 0 ? r : 2 - r;
};
const pnorm = (x) => 0.5 * erfc(-x / Math.SQRT2);
const roundTrip = (fc, se) => 2 * pnorm(-Math.abs(fc) / se);
const relClose = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300);

describe("pgseaLogFCSE — qnorm", function () {
    it("matches known quantiles", function () {
        assert.ok(Math.abs(qnorm(0.975) - 1.959963984540054) < 1e-12);
        assert.ok(Math.abs(qnorm(0.5)) < 1e-15);
        assert.ok(Math.abs(qnorm(0.025) + 1.959963984540054) < 1e-12);
        assert.ok(Math.abs(qnorm(1e-10) + 6.361340902404056) < 1e-9);
    });
    it("agrees with the independent pnorm across the range", function () {
        for (const p of [1e-300, 1e-100, 1e-20, 1e-6, 0.001, 0.05, 0.3, 0.5, 0.7, 0.99]) {
            assert.ok(relClose(pnorm(qnorm(p)), p, 1e-8), `pnorm(qnorm(${p})) = ${pnorm(qnorm(p))}`);
        }
    });
});

describe("pgseaLogFCSE — SE = |logFC| / |qnorm(p/2)| round-trips to the original p", function () {
    const cases = [
        [1.5, 0.05], [1.5, 1e-6], [1.5, 0.5], [-2.3, 0.001], [0.4, 0.2], [3, 1e-50],
    ];
    for (const [fc, p] of cases) {
        it(`FC ${fc}, p ${p}`, function () {
            const se = derivePgseaLogFCSE(fc, p);
            assert.ok(se > SE_MIN && se < SE_MAX, `inside the bounds: ${se}`);
            assert.ok(relClose(roundTrip(fc, se), p, 1e-8), `2*pnorm(-|FC|/SE) = ${roundTrip(fc, se)}`);
        });
    }

    it("uses the sign-free |FC|: a negative FC gives the same SE as its positive", function () {
        assert.strictEqual(derivePgseaLogFCSE(-1.5, 0.05), derivePgseaLogFCSE(1.5, 0.05));
    });

    it("p = 0.05 with |FC| = 1.96 gives SE ~ 1 (the textbook case)", function () {
        assert.ok(Math.abs(derivePgseaLogFCSE(1.959963984540054, 0.05) - 1) < 1e-12);
    });
});

describe("pgseaLogFCSE — boundaries", function () {
    it("p near 1 gives a LARGE SE (near-zero weight), capped at SE_MAX — never floored small", function () {
        for (const p of [0.999999, 1 - 1e-12, 1]) {
            const se = derivePgseaLogFCSE(1.5, p);
            assert.ok(se >= 1e3, `p=${p}: SE ${se} must be large`);
            assert.ok(se <= SE_MAX && Number.isFinite(se));
        }
        assert.strictEqual(derivePgseaLogFCSE(1.5, 1), SE_MAX);
        // Round trip at the cap returns the p implied by the clamped SE — essentially 1.
        assert.ok(roundTrip(1.5, derivePgseaLogFCSE(1.5, 1)) > 0.9998);
    });

    it("p near 0 gives a small but FINITE SE, and the weight never exceeds 1/SE_MIN^2 = 1e8", function () {
        for (const p of [0, 1e-300, 1e-320]) {
            const se = derivePgseaLogFCSE(2, p);
            assert.ok(Number.isFinite(se) && se > 0, `p=${p}: ${se}`);
            assert.ok(1 / (se * se) <= 1e8 + 1e-6, `weight ${1 / (se * se)}`);
        }
        // p = 0 is clamped to P_MIN, |z| ~ 37.5, so SE = 2 / 37.5 and the round trip gives P_MIN.
        const se0 = derivePgseaLogFCSE(2, 0);
        assert.ok(relClose(roundTrip(2, se0), P_MIN, 1e-6), `round trip ${roundTrip(2, se0)}`);
    });

    it("a small FC with a tiny p lands on SE_MIN, capping the weight at 1e8", function () {
        const se = derivePgseaLogFCSE(1e-3, 1e-300);
        assert.strictEqual(se, SE_MIN);
        assert.ok(Math.abs(1 / (se * se) - 1e8) < 1e-3);
    });

    it("FC = 0 and |FC| < FC_EPS go to SE_MAX (zero weight), not to the floor", function () {
        for (const fc of [0, -0, 1e-9, -1e-9, FC_EPS / 2]) {
            const se = derivePgseaLogFCSE(fc, 1e-10);
            assert.strictEqual(se, SE_MAX, `FC=${fc}`);
            assert.ok(roundTrip(fc, se) > 0.9999, "a zero effect round-trips to p ~ 1");
        }
    });

    it("returns finite values only (Infinity would reach R as NA and drop the gene)", function () {
        for (const [fc, p] of [[5, 0], [5, 1], [0, 0], [0, 1], [1e300, 1e-300]]) {
            assert.ok(Number.isFinite(derivePgseaLogFCSE(fc, p)), `${fc}, ${p}`);
        }
        assert.ok(P_MAX < 1);
    });

    it("returns null for non-numeric input instead of inventing an SE", function () {
        assert.strictEqual(derivePgseaLogFCSE(NaN, 0.05), null);
        assert.strictEqual(derivePgseaLogFCSE(1, undefined), null);
    });
});

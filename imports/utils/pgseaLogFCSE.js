// Standard error of a log fold change, recovered from the fold change and its two-sided p-value.
//
// A ranked-gene-list-with-statistics (pgsea) upload carries Gene / log2FC / P-value but no
// standard error. Gene-level meta-analysis (server/include/rCommand/DEMetaAnalysis.js) needs one:
// every non-REML method pools logFC by inverse variance (weight = 1/SE^2, lines 80-95), and its
// drop_na() silently discards a gene whose logFCSE is missing. REML does not read logFCSE at all —
// meta::metagen back-derives the SE from TE and pval itself — so this is the same inversion.
//
// Under the z/Wald test that produced p:   z = qnorm(p/2),   SE = |logFC| / |z|.
//
// Direction of the approximation: for the same p, a t quantile exceeds the z quantile in magnitude
// (p = 0.05: t with 5 df is 2.571, z is 1.960), so using qnorm gives a LARGER SE than the true
// moderated-t SE, i.e. pgsea datasets are UNDER-weighted. That is the conservative direction. For a
// pasted file the upstream test and its degrees of freedom are unknown, so the normal approximation
// is the only general option. The derived SE carries no precision information beyond what p already
// encodes: two datasets reporting the same FC and p from different sample sizes get equal weight.
//
// Bounds. Both must be FINITE: JSON.stringify(Infinity) is null, R reads that as NA, and drop_na()
// would then drop the gene.
//   - SE_MAX = 1e4 (weight 1e-8). Used for p near 1, where |z| -> 0 and the SE blows up — a
//     near-zero weight is the correct reading, so this is a CAP, never a floor to a small value.
//   - SE_MIN = 1e-4 (weight capped at 1e8). Chosen from a maximum-weight argument, not float
//     safety: a smaller floor still lets one dataset's 1/SE^2 swamp the pool. Harmless for real
//     data — |z| <= ~37 at the p floor, so an SE below 1e-4 needs |logFC| below ~4e-3 at an extreme p.
//   - |logFC| < FC_EPS (including 0) -> SE_MAX. A zero effect must carry no weight. It is not
//     excluded instead: the non-REML path keeps only genes present in EVERY dataset
//     (DEMetaAnalysis.js:88), so dropping one zero-FC row would drop that gene from the whole meta.
//     Without this branch FC = 1e-9 would land on SE_MIN and get the maximum weight.
//   - p is clamped to [P_MIN, P_MAX] first, so p = 0 gives a small finite SE and p = 1 gives SE_MAX.

export const SE_MIN = 1e-4;
export const SE_MAX = 1e4;
export const FC_EPS = 1e-6;
export const P_MIN = 1e-300;
export const P_MAX = 1 - 1e-12;

/**
 * Inverse of the standard normal CDF (Wichura 1988, algorithm AS 241, PPND16; ~1e-16 relative
 * accuracy). The repo has no statistics library.
 * @param {number} p - in (0, 1)
 * @returns {number}
 */
export const qnorm = (p) => {
    if (!(p > 0 && p < 1)) {
        if (p === 0) return -Infinity;
        if (p === 1) return Infinity;
        return NaN;
    }
    const q = p - 0.5;
    let r;
    let val;
    if (Math.abs(q) <= 0.425) {
        r = 0.180625 - q * q;
        val = q * (((((((r * 2509.0809287301226727 +
            33430.575583588128105) * r + 67265.770927008700853) * r +
            45921.953931549871457) * r + 13731.693765509461125) * r +
            1971.5909503065514427) * r + 133.14166789178437745) * r +
            3.387132872796366608) /
            (((((((r * 5226.495278852545925 +
                28729.085735721942674) * r + 39307.89580009271061) * r +
                21213.794301586595867) * r + 5394.1960214247511077) * r +
                687.1870074920579083) * r + 42.313330701600911252) * r + 1.0);
        return val;
    }
    r = q < 0 ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));
    if (r <= 5) {
        r -= 1.6;
        val = (((((((r * 7.7454501427834140764e-4 +
            0.0227238449892691845833) * r + 0.24178072517745061177) * r +
            1.27045825245236838258) * r + 3.64784832476320460504) * r +
            5.7694972214606914055) * r + 4.6303378461565452959) * r +
            1.42343711074968357734) /
            (((((((r * 1.05075007164441684324e-9 +
                5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
                0.14810397642748007459) * r + 0.68976733498510000455) * r +
                1.6763848301838038494) * r + 2.05319162663775882187) * r + 1.0);
    } else {
        r -= 5;
        val = (((((((r * 2.01033439929228813265e-7 +
            2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
            0.026532189526576123093) * r + 0.29656057182850489123) * r +
            1.7848265399172913358) * r + 5.4637849111641143699) * r +
            6.6579046435011037772) /
            (((((((r * 2.04426310338993978564e-15 +
                1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
                7.868691311456132591e-4) * r + 0.0148753612908506148525) * r +
                0.13692988092273580531) * r + 0.59983220655588793769) * r + 1.0);
    }
    return q < 0 ? -val : val;
};

/**
 * Standard error of logFC from logFC and its RAW two-sided p-value (not the FDR).
 * @param {number} logFC
 * @param {number} p
 * @returns {number|null} a finite SE in [SE_MIN, SE_MAX], or null when either input is not a number
 */
export const derivePgseaLogFCSE = (logFC, p) => {
    if (!Number.isFinite(logFC) || !Number.isFinite(p)) return null;
    const absFC = Math.abs(logFC);
    if (absFC < FC_EPS) return SE_MAX;
    const pc = Math.min(Math.max(p, P_MIN), P_MAX);
    const z = Math.abs(qnorm(pc / 2));
    if (!(z > 0)) return SE_MAX;
    const se = absFC / z;
    if (!Number.isFinite(se)) return SE_MAX;
    return Math.min(Math.max(se, SE_MIN), SE_MAX);
};

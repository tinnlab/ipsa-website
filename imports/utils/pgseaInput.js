// Helpers for parsing a PGSEA input file and normalizing it to the canonical
// 2-column `Gene\tStatistic` text the backend consumes
// (server/api/methods/analysis.js `createPgseaParams` → rCommand/fgsea.js).
//
// Uses papaparse for row splitting (RFC-4180 quoting, `#` comments, empty-line
// skipping) — matching the pre-b202ac2 parser it restores — but layers on
// optional-header + 2/3-column + ranking-column support on top.
//
// Background: PGSEA historically accepted a `Gene / Fold-Change / P-value` table
// (with a header, 2 or 3 columns) plus a "Calculate gene rankings by" selector.
// Commit b202ac2 ("current good version", 2025-11-16) removed that and hard-coded a
// strict 2-column, no-header `Gene\tStatistic` format, which rejects the common DE
// results table (e.g. the OSD statDat_*.txt files). These helpers restore the richer
// input WITHOUT touching the backend: everything is normalized to `Gene\tStatistic`
// here, in the client parser.
//
// Ranking statistic (per buildPgseaContent):
//   - 'fc'   (default): statistic = the ranking column, verbatim. When that column is
//            the Fold-Change, the emitted `Gene\tStatistic` is identical to feeding the
//            current single-analysis PGSEA a 2-column `Gene\tFoldChange` file.
//   - 'pval': statistic = sign(rankingColumn) * -log10(clamp(P-value)) — directional and
//            significance-aware when a signed ranking column is present. For a
//            p-value-only file (no fold-change/signed column) it is the undirected
//            magnitude -log10(clamp(P-value)), so the most-significant genes rank on top.

import Papa from 'papaparse';

// Smallest positive value we substitute for p <= 0 so -log10 stays finite
// (-log10(1e-300) ≈ 300). Any p at or below this floor is treated as this floor;
// any p above 1 (invalid) is clamped down to 1 so -log10 stays >= 0.
const PVALUE_FLOOR = 1e-300;

/**
 * Options for the PGSEA "Calculate gene rankings by" selector, shared by BOTH the
 * mass-analysis modal and the single-analysis wizard so the two flows can never drift on
 * wording or values. The 'pval' radio is disabled unless a P-value column is present; the
 * 'fc' radio is always shown. For the rare p-value-only file (available === ['pval']) an
 * 'fc' selection is harmless — resolvePgseaRankingBy clamps every file to a mode it
 * actually supports, so such a file is always ranked by -log10(p) regardless of the radio.
 */
export const RANKING_OPTIONS = [
  {value: 'fc', label: 'Fold Change'},
  {value: 'pval', label: 'Signed -log10(P-value)'},
];

// A column header naming the gene/identifier column. ANCHORED on purpose: the previous
// unanchored /gene|symbol/ also matched ordinary gene symbols (e.g. "GENE1" — the very
// string in the single-analysis textarea placeholder), which classified the first DATA row
// of a headerless 2-column file as a header and silently dropped that gene.
//
// The optional `[a-z0-9]+[_. -]` qualifier keeps the real-world annotation headers the old
// regex accepted — external_gene_name, hgnc_symbol, ensembl_gene_id, probe_id — while still
// rejecting bare symbols. Verified against GENE1, MIR1-1, AL133245.1, RP11-34P13.7, 7SK,
// MT-CO1, NKX2-1: all correctly treated as data.
//
// Header rows whose value columns are non-numeric are caught by the second clause of the
// `hadHeader` test below regardless, so this regex only decides the case where every other
// column looks numeric — i.e. exactly the legacy 2-column file this protects.
const HEADER_GENE_RE = /^([a-z0-9]+[_. -])?(genes?|symbols?|gene[_. -]?(id|name|symbol)s?|id|name)$/i;
// A fold-change / signed-effect-size ranking column. Deliberately does NOT match bare
// `log2` (which appears in expression columns like log2CPM / log2TPM that are NOT fold-changes).
const HEADER_FC_RE = /fold|logfc|log2fc|log2foldchange|^fc$|^l2fc$/i;
// A p-value / FDR column. `adj` only in an adjusted-p context (adj.P / padj), not bare
// `adj` (which would match unrelated words like "adjacent").
// The trailing-`p` family (logrank_p, wald_p, lrt_p, chisq_p) and R's `Pr(>|t|)` are included
// via `(^|[_. -])p$` / `^pr\(`. Loosening the NAME test is safe now that a candidate must also
// pass columnIsProbability — a column called `..._p` holding values outside [0,1] is rejected
// on its values. Before that guard existed this would have been reckless.
const HEADER_PVAL_RE = /p[-_. ]?val|pvalue|p\.value|^p$|(^|[_. -])p$|^pr\(|fdr|padj|adj\.?p|q[-_. ]?val/i;
// A column whose header names a statistic that is DIRECTIONAL by construction. Preferred over
// a merely-signed column: limma's `B` (log-odds of DE) goes negative, but negative B means
// "probably not differentially expressed", not "down-regulated".
const HEADER_STAT_RE = /^(t|stat|statistic|z|z[_. -]?score|score|lfc|effect|effect[_. -]?size)$/i;

// Strict numeric test: rejects "3abc", "0x10", "7SK", "Infinity", "NaN"; accepts
// "-1.6", ".5", "3", "2.48e-11".
const NUMERIC_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/**
 * Strict numeric-token test. Exported so the advisory validator can apply the SAME rule this
 * parser does — `parseFloat` accepts "1.5x", "45%" and "3,14", which made the validator report
 * files as valid that then throw at parse time.
 */
export const isNumericToken = (s) => s != null && NUMERIC_RE.test(String(s).trim());
const isNumeric = isNumericToken;

// Conventional "no value here" tokens. These are MISSING DATA, not header labels — a
// headerless file whose first row happens to carry an NA must not be mistaken for a header
// row (which would silently discard that gene).
const MISSING_RE = /^(na|n\/a|nan|null|none|nd|inf|-inf|\.|-|)$/i;
const isMissing = (s) => MISSING_RE.test(String(s ?? '').trim());

/**
 * Detect the field delimiter (tab or comma) from a sample line.
 * Tabs win ties because PGSEA/TSV input is tab-first.
 */
const detectDelimiter = (line) => {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
};

/** First non-empty, non-comment line — used only to sniff the delimiter. */
const firstContentLine = (text) => {
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith('#')) return line;
  }
  return '';
};

/**
 * Parse a PGSEA input file's raw text into structured rows + available ranking
 * options. Does NOT throw on individual bad rows — they are dropped — but throws
 * when the file has no usable gene/statistic structure at all, mirroring the
 * error contract callers (FileParser.parsePGSEAFiles) already rely on.
 *
 * @param {string} text
 * @param {{rankingBy?: 'fc'|'pval'}} [opts]
 * @returns {{
 *   rows: Array<{gene: string, fc: number|null, pval: number|null, fcRaw: string|null}>,
 *   available: Array<'fc'|'pval'>,
 *   rankingBy: 'fc'|'pval',
 *   hadHeader: boolean,
 *   delimiter: string,
 *   content: string
 * }}
 */
export const normalizePgseaInput = (text, opts = {}) => {
  const sniff = firstContentLine(text);
  if (!sniff) {
    throw new Error('PGSEA Analysis: Data file is empty or contains no data rows.');
  }
  const delimiter = detectDelimiter(sniff);

  // papaparse handles quoting, `#` comments, and empty lines (matches the old parser).
  const parsed = Papa.parse(String(text), {
    delimiter,
    header: false,
    skipEmptyLines: 'greedy',
    comments: '#',
    dynamicTyping: false,
  });
  const grid = (parsed.data || []).filter((row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim() !== ''));

  if (grid.length === 0) {
    throw new Error('PGSEA Analysis: Data file is empty or contains no data rows.');
  }

  const firstCols = grid[0].map((c) => String(c ?? '').trim());
  if (firstCols.length < 2) {
    throw new Error(
      `PGSEA Analysis: Expected at least 2 columns (Gene, Statistic) but found ${firstCols.length}. ` +
      `Format: Gene<TAB>Fold-Change[<TAB>P-value].`
    );
  }

  // Header row = the gene column names it (e.g. "Gene"/"Symbol") OR any value column
  // is non-numeric (e.g. "Fold-Change"). The gene-name check catches the case where a
  // header's value columns happen to look numeric.
  // A value cell that is a MISSING-DATA token is not evidence of a header — otherwise a
  // headerless file whose first row carries an NA loses that gene entirely.
  const hadHeader =
    HEADER_GENE_RE.test(firstCols[0]) ||
    firstCols.slice(1).some((c) => !isNumeric(c) && !isMissing(c));

  const dataRows = (hadHeader ? grid.slice(1) : grid).map((r) => r.map((c) => String(c ?? '').trim()));

  // Resolve which column carries the ranking statistic (fc) and, if present, the p-value.
  let fcIdx = 1;
  let pvalIdx = null;
  // True when the ONLY ranking column is a p-value (no fold-change / signed statistic).
  // Such files are ranked by -log10(p) magnitude (undirected) rather than the raw p.
  let pvalOnly = false;

  // Samples the first 20 non-empty rows. A column with a non-numeric cell in that window
  // (e.g. an early "NA") is treated as non-numeric; for a Gene/Stat/P-value file that can
  // route the file to the p-value-only branch below, which ranks by -log10(p) — a useful
  // fallback rather than an error.
  const columnIsNumeric = (idx) => {
    const sample = dataRows.slice(0, 20).filter((r) => (r[0] ?? '') !== '');
    return sample.length > 0 && sample.every((r) => isNumeric(r[idx]));
  };

  // Does this column carry any negative value? A signed statistic (logFC, t, stat, z) does;
  // an unsigned magnitude (AveExpr, baseMean, log2CPM) does not. Used to pick the column that
  // can actually express direction.
  //
  // Scans EVERY row on purpose. This is an existence check, and DE tables are normally
  // delivered sorted by the statistic — so any window over the head of the file sees only
  // positives and silently falls back to the unsigned magnitude, i.e. the exact bug this
  // guards against. `.some()` short-circuits and dataRows is already in memory.
  const columnHasNegative = (idx) =>
    dataRows.some((r) => isNumeric(r[idx]) && parseFloat(r[idx]) < 0);

  // Is this column a PROBABILITY? Decided by value, not by name: every raw p-value lies in
  // [0, 1], while a transformed `-log10(p)` / `neg_log10_pval` column does not. A name-based
  // rule cannot do this — excluding anything matching /log/ also throws out genuine p-values
  // like `logrank_p` or `log.P.Value`, and the excluded column then becomes the ranking
  // statistic, so FGSEA ends up ranking on a raw p-value ascending (least significant first).
  // Tolerates a handful of stray cells rather than demanding every value in range. A single
  // `999` "not tested" sentinel or a `1.0000001` rounding artefact would otherwise disqualify
  // a genuine p-value column, and the column then becomes the ranking statistic — on a
  // 2-column file that inverts the ranking outright, since FGSEA ends up sorting on the raw
  // p-value ascending (least significant first).
  //
  // Distinguishes a genuine p-value column carrying a few bad cells from a `-log10(p)`
  // magnitude column, which must never be fed back through -log10().
  //
  // The decisive signal is how VARIED the out-of-range values are, not how many there are. A
  // sentinel is one or two repeated constants ({999}, {-1}); a -log10 tail is many distinct
  // values, because those values are the substance of the column. Counting alone is not
  // enough: after FDR correction a low-signal experiment parks most genes at padj ~ 1, so
  // -log10(padj) ~ 0 for nearly all of them and only the few real hits exceed 1. Such a column
  // reads as ~96% "in range" and, if admitted, inverts the ranking outright — the genuinely
  // significant genes clamp to statistic 0 (dead centre) while the null genes take the
  // extremes.
  //
  // KNOWN LIMITATION, and it is an ambiguity floor rather than a gap to be closed: a
  // `-log10(padj)` column from an experiment with only ONE OR TWO significant genes is
  // numerically indistinguishable from a p-value column carrying one or two sentinels — same
  // count, same distinctness, same fraction in range. Any rule over those three quantities
  // that rejects the first also rejects the second. In particular do NOT reach for a tighter
  // fraction: 200 in-range values plus 2 strays is 99.0%, so the ambiguous shape clears a 0.99
  // threshold too, while the tightening breaks genuine sentinel columns.
  //
  // Genome-scale tables are safe, because
  // -log10 values are continuous and even 5% of 20k genes yields ~1000 distinct strays, well
  // past the limit below. Separating the remaining shape would need a different signal (e.g.
  // distrusting a p-named column containing a `log` token that also has any value > 1, applied
  // only inside this zone) — deliberately not done, as it reintroduces name heuristics for a
  // rare case.
  const columnIsProbability = (idx) => {
    const values = dataRows
      .map((r) => r[idx])
      .filter((c) => isNumeric(c))
      .map(parseFloat);
    if (values.length === 0) return false;

    const outOfRange = values.filter((v) => v < 0 || v > 1);
    if (outOfRange.length === 0) return true;
    if (new Set(outOfRange).size > 2) return false;

    // A single stray value, given enough rows for "one" to be a small share. Two values cannot
    // support the judgement — one outlier out of two is half the column.
    if (values.length >= 3 && outOfRange.length <= 1) return true;

    // Otherwise the strays must be a small fraction of a long column.
    return (values.length - outOfRange.length) / values.length >= 0.95;
  };

  if (hadHeader) {
    const headers = firstCols;
    pvalIdx = headers.findIndex(
      (h, i) => i > 0 && HEADER_PVAL_RE.test(h) && columnIsProbability(i)
    );
    if (pvalIdx === -1) pvalIdx = null;

    // Candidate ranking-statistic column, in decreasing order of confidence. Being SIGNED
    // outranks being merely stat-NAMED: an all-positive `score` sitting before a real `t`
    // would otherwise win and hand every gene a positive p-value statistic, which is the
    // all-positive-sign bug this whole block exists to prevent.
    const findFcColumn = (predicate) => {
      for (let i = 1; i < headers.length; i++) {
        if (i === pvalIdx) continue;
        if (columnIsNumeric(i) && predicate(i)) return i;
      }
      return -1;
    };

    let fcFound = headers.findIndex((h, i) => i > 0 && HEADER_FC_RE.test(h));
    // 1. Named as a directional statistic AND actually signed — the safest pick.
    if (fcFound === -1) {
      fcFound = findFcColumn((i) => HEADER_STAT_RE.test(headers[i]) && columnHasNegative(i));
    }
    // 2. Any signed column. Without this, `Gene/AveExpr/t/P.Value` (limma topTable with no
    //    logFC) ranks by mean expression and, because sign() reads an always-positive column,
    //    every gene ranks positive in p-value mode — flipping every pathway's NES sign.
    //    Preferred over an unsigned stat-named column because direction is what matters here.
    if (fcFound === -1) {
      fcFound = findFcColumn((i) => columnHasNegative(i));
    }
    // 3. Stat-named but unsigned (a file with no direction to express at all).
    if (fcFound === -1) {
      fcFound = findFcColumn((i) => HEADER_STAT_RE.test(headers[i]));
    }
    // 4. First numeric non-p-value column, as before.
    if (fcFound === -1) {
      fcFound = findFcColumn(() => true);
    }
    if (fcFound === -1) {
      if (pvalIdx != null) {
        // Only a p-value column exists → rank by -log10(p) magnitude (undirected).
        pvalOnly = true;
        fcIdx = null;
      } else {
        fcIdx = 1; // last resort: treat the first value column as the statistic
      }
    } else {
      fcIdx = fcFound;
      if (fcIdx === pvalIdx) pvalIdx = null; // a lone p-value column can't also be the signed stat
    }
  } else if (firstCols.length >= 3) {
    // No header: assume the documented positional order Gene / Fold-Change / P-value.
    // (We do NOT guess by value range — an all-in-[0,1] fold-change column is
    // indistinguishable from a p-value column and guessing silently swaps them.)
    fcIdx = 1;
    pvalIdx = 2;
  }
  // else: no header, exactly 2 columns → back-compat `Gene\tStatistic`, fcIdx = 1.

  const rows = [];
  for (const parts of dataRows) {
    const gene = (parts[0] ?? '').trim();
    if (!gene) continue;

    const fcRawCell = fcIdx != null ? parts[fcIdx] : null;
    const fc = isNumeric(fcRawCell) ? parseFloat(fcRawCell) : null;
    const pval = pvalIdx != null && isNumeric(parts[pvalIdx]) ? parseFloat(parts[pvalIdx]) : null;

    // Usable if it has a ranking statistic: a fold-change / signed stat, or — for a
    // p-value-only file — a p-value (ranked as -log10(p)).
    if (fc == null && !(pvalOnly && pval != null)) continue;

    rows.push({ gene, fc, pval, fcRaw: fcRawCell != null ? String(fcRawCell).trim() : null });
  }

  if (rows.length === 0) {
    throw new Error('PGSEA Analysis: No valid Gene/Statistic rows found after parsing.');
  }

  const hasPval = pvalIdx != null && rows.some((r) => r.pval != null);
  const available = pvalOnly ? ['pval'] : hasPval ? ['fc', 'pval'] : ['fc'];
  const rankingBy = resolvePgseaRankingBy([opts.rankingBy], available);

  return {
    rows,
    available,
    rankingBy,
    hadHeader,
    delimiter,
    content: buildPgseaContent(rows, rankingBy),
  };
};

/**
 * Resolve the effective ranking mode from an ordered list of candidate choices
 * (highest priority first; falsy entries skipped), clamped to what the file supports.
 * Pure — used both inside the normalizer and by the mass-analysis submit path so the
 * precedence/clamp logic is unit-testable.
 *
 * @param {Array<'fc'|'pval'|undefined>} candidates
 * @param {Array<'fc'|'pval'>} [available]
 * @returns {'fc'|'pval'}
 */
export const resolvePgseaRankingBy = (candidates, available = ['fc']) => {
  const list = Array.isArray(available) && available.length ? available : ['fc'];
  const ordered = Array.isArray(candidates) ? candidates : [candidates];
  const requested = ordered.find(Boolean);
  // Clamp to what the file supports; fall back to the first available mode (which is
  // 'pval' for a p-value-only file, 'fc' otherwise).
  return requested && list.includes(requested) ? requested : list[0];
};

/**
 * Build the canonical 2-column `Gene\tStatistic` text from parsed rows for a given
 * ranking mode. `fc` preserves the original ranking-column token (byte-identical to a
 * 2-column FoldChange file); `pval` computes sign(rankingColumn) * -log10(clamp(P)),
 * or, when there is no fold-change to sign with (a p-value-only file), the undirected
 * magnitude -log10(clamp(P)) so the most-significant genes rank at the top.
 *
 * @param {Array<{gene: string, fc: number|null, pval: number|null, fcRaw: string|null}>} rows
 * @param {'fc'|'pval'} [rankingBy]
 * @returns {string}
 */
export const buildPgseaContent = (rows, rankingBy = 'fc') => {
  const out = [];
  for (const row of rows ?? []) {
    let statToken;
    if (rankingBy === 'pval') {
      if (row.pval == null) continue; // needs a p-value
      // A NEGATIVE p-value is not a probability — it means the column is corrupt or was
      // mis-identified. Saturating it to the floor made it |300|, i.e. the most significant
      // gene in the file, so garbage was promoted to the top of the ranking. Drop it, exactly
      // as a missing p-value is dropped.
      if (row.pval < 0) continue;
      // Clamp p into (0, 1]: p==0 (or underflow) → floor; p>1 (invalid) → 1.
      const p = row.pval <= PVALUE_FLOOR ? PVALUE_FLOOR : row.pval > 1 ? 1 : row.pval;
      // Directional when a fold-change exists; undirected (+) for a p-value-only file.
      const sign = row.fc == null ? 1 : row.fc > 0 ? 1 : row.fc < 0 ? -1 : 0;
      statToken = String(sign * -Math.log10(p));
    } else {
      // 'fc': keep the original token so ranking is identical to a Gene\tStatistic file.
      if (row.fcRaw != null) statToken = row.fcRaw;
      else if (row.fc != null) statToken = String(row.fc);
      else continue;
    }
    out.push(`${row.gene}\t${statToken}`);
  }
  return out.join('\n');
};

/**
 * Parse the CANONICAL 2-column `Gene\tStatistic` text into the gene list + per-gene ranking
 * statistic the FGSEA params builder consumes.
 *
 * This is the exact parser `server/api/methods/analysis.js` `createPgseaParams` runs (it was
 * lifted out of that function verbatim, `_.uniq` swapped for an order-preserving Set). It
 * lives here so the ranking-correctness tests can assert against the code the server really
 * executes instead of a re-implementation. Semantics are deliberately unchanged, including
 * the silent drop of any row that is not exactly 2 tab-separated fields.
 *
 * @param {string} canonicalText
 * @returns {{inputGeneList: string[], geneData: Object<string, {rankStat: number}>}}
 */
export const parsePgseaGeneStats = (canonicalText) => {
  // The original inline parser did `analysisConfigSnapshot.input.trim()` and threw a
  // TypeError when `input` was missing. Keep failing LOUDLY here: returning an empty result
  // instead would hand fgsea an empty ranking and report success on a broken analysis.
  if (canonicalText == null) {
    throw new Error('PGSEA Analysis: no input data found for this analysis.');
  }

  const inputRows = String(canonicalText)
    .trim()
    .split('\n')
    .map((row) => row.replace('\r', '').trim())
    .filter((row) => row.length > 0);

  const inputGeneList = [...new Set(
    inputRows.map((e) => e.split('\t')[0].trim()).filter((e) => e.length)
  )];

  const geneData = inputRows.reduce((acc, curr) => {
    const parts = curr.split('\t');
    if (parts.length !== 2) return acc;

    const gene = parts[0].trim();
    const statValue = parseFloat(parts[1].trim());

    if (!isNaN(statValue)) {
      acc[gene] = {rankStat: statValue};
    }
    return acc;
  }, {});

  return {inputGeneList, geneData};
};

/**
 * Build the `{id, pValue, FC}` rows the PGSEA volcano / DE-gene path needs from a stored
 * analysis input, or explain why there are none.
 *
 * Extracted from `server/api/methods/analysis.js` `pgsea.volcano.plot` so the decision — which
 * text to read, and the three "nothing to do" exits — is testable without a database. DE genes
 * need BOTH a fold-change and a p-value, so this reads the user's ORIGINAL upload: `input` has
 * been collapsed to a single ranking statistic and no longer carries p-values.
 *
 * @param {{inputRaw?: string, input?: string}} config
 * @returns {{pcaData: Array<{id: string, pValue: number, FC: number}>, skipped: string|null}}
 *   `skipped` is null when pcaData is usable; otherwise a reason the caller should no-op on.
 * @throws re-throws anything that is not the normalizer's own "unusable file" error
 */
export const buildPgseaVolcanoRows = (config = {}) => {
  const source = config.inputRaw || config.input;
  let parsed;
  try {
    parsed = normalizePgseaInput(source);
  } catch (e) {
    // Only swallow the normalizer's own errors; anything else is a real fault and must
    // surface rather than masquerade as "this file has no p-values".
    if (!/^PGSEA Analysis:/.test((e && e.message) || '')) throw e;
    return {pcaData: [], skipped: `unparseable: ${e.message}`};
  }

  if (!parsed.available.includes('pval')) {
    return {pcaData: [], skipped: 'no p-value column'};
  }

  const pcaData = [];
  for (const row of parsed.rows) {
    if (row.fc == null || row.pval == null) continue;
    pcaData.push({id: row.gene, pValue: row.pval, FC: row.fc});
  }

  // A p-value-only file passes the check above but yields nothing here. The caller must NOT
  // write in that case — it would overwrite previously computed DE genes (and the immutable
  // snapshot) with empty arrays.
  if (!pcaData.length) return {pcaData: [], skipped: 'no rows with both a fold-change and a p-value'};

  return {pcaData, skipped: null};
};

/**
 * Rescue for files whose tabs arrived as the two literal characters `\` `t` rather than a
 * real tab. Applied ONLY after a parse attempt has already failed — the older
 * `text.includes('\\t') && !text.includes('\t')` guard fired on any comma-separated file
 * that merely contained a literal `\t`, injecting real tabs which then won detectDelimiter's
 * tab-biased tie-break and turned a valid CSV into garbage.
 */
const applyLiteralTabFixup = (text) =>
  text.includes('\\t') ? text.replace(/\\t/g, '\t') : text;

/**
 * The whole single-analysis PGSEA input decision in one pure function: parse the user's raw
 * text (2-or-3 columns, optional header, tab or comma), resolve which ranking statistic to
 * use, and collapse to the canonical 2-column `Gene\tStatistic` text the backend consumes.
 *
 * Every entry point (file upload, textarea, "use example", ranking radio) goes through this,
 * so they cannot drift. Ranking precedence is requested → stored → the file's default, then
 * clamped to what the file actually supports.
 *
 * Never throws: an unparseable input comes back with `error` set and the raw text passed
 * through as `input`, which is what the single-analysis wizard stored before this change —
 * the advisory `data.validate` alert is what explains the problem to the user.
 *
 * @param {string} rawText - exactly what the user uploaded or typed
 * @param {{storedRankingBy?: 'fc'|'pval', requestedRankingBy?: 'fc'|'pval'}} [opts]
 * @returns {{inputRaw: string, input: string, rankingBy: 'fc'|'pval'|null,
 *            available: Array<'fc'|'pval'>, hadHeader: boolean, isEmpty: boolean,
 *            error: string|null}}
 */
export const derivePgseaPersistPayload = (rawText, opts = {}) => {
  const text = String(rawText ?? '');

  if (!text.trim()) {
    return {
      inputRaw: '', input: '', rankingBy: null,
      available: [], hadHeader: false, isEmpty: true, error: null,
    };
  }

  const attempt = (candidate) => {
    try {
      return {parsed: normalizePgseaInput(candidate), text: candidate, error: null};
    } catch (e) {
      return {parsed: null, text: candidate, error: e?.message || String(e)};
    }
  };

  let result = attempt(text);
  if (!result.parsed) {
    const fixed = applyLiteralTabFixup(text);
    if (fixed !== text) result = attempt(fixed);
  }

  if (!result.parsed) {
    // Unparseable — preserve the ORIGINAL text verbatim in both keys (pre-change behaviour).
    return {
      inputRaw: text, input: text, rankingBy: null,
      available: [], hadHeader: false, isEmpty: false, error: result.error,
    };
  }

  const {rows, available, hadHeader} = result.parsed;
  const rankingBy = resolvePgseaRankingBy(
    [opts.requestedRankingBy, opts.storedRankingBy],
    available
  );

  return {
    // Post-fixup text: `input` must always be re-derivable from `inputRaw`.
    inputRaw: result.text,
    input: buildPgseaContent(rows, rankingBy),
    rankingBy,
    available,
    hadHeader,
    isEmpty: false,
    error: null,
  };
};

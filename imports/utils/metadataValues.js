// Pure, dependency-free helpers for grouping metadata values case-insensitively.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and can be
// imported on both client and server — including the server-side Mocha runner. Same placement
// rationale as heatmapOrdering.js.
//
// Metadata extracted from different datasets in a mass/meta analysis preserves whatever casing the
// source text used, so the same concept can arrive as "female", "Female", or "FEMALE ". Plain
// JS Set/object-key dedup is case-sensitive, which splits these into distinct values (surfacing as
// "female, Female" in the consolidated template and as separate heatmap colors). These helpers
// collapse values that differ only by case and surrounding whitespace, KEEPING the first-seen
// original casing as the representative.

// Canonical comparison key: trimmed + lowercased. `null`/`undefined` collapse to ''.
export const metadataValueKey = (v) => String(v ?? '').trim().toLowerCase();

// Case-insensitive-unique values, each the FIRST-SEEN value (trimmed, original casing preserved).
// null/undefined/empty (after trim) are skipped.
export const dedupeMetadataValues = (values) => {
    const seen = new Set();
    const out = [];
    (values || []).forEach((raw) => {
        const key = metadataValueKey(raw);
        if (key === '' || seen.has(key)) return;
        seen.add(key);
        out.push(String(raw).trim());
    });
    return out;
};

// Aggregate a field's values across datasets: the single representative if only one unique value
// remains after case-insensitive dedup, otherwise the distinct representatives joined with ", ".
// Returns '' when there are no usable values.
export const aggregateMetadataValue = (values) => {
    const unique = dedupeMetadataValues(values);
    if (unique.length === 0) return '';
    return unique.length === 1 ? unique[0] : unique.join(', ');
};

// Canonical comparison key for a metadata FIELD NAME (same normalization as values). Field names,
// like values, arrive with uncontrolled casing/whitespace across datasets ("Sex" vs "sex" vs
// "Sex "), and must collapse to one row/column concept.
export const metadataFieldKey = metadataValueKey;

// Parse the leading number out of a metadata value, SIGN-AWARE. Returns a finite number or null.
// A leading '-' counts as a sign only when the number begins the (trimmed) string, so ranges
// ("16-17") and mid-string dashes ("N-3") stay positive, while a genuine negative ("-2.5 C") keeps
// its sign — unlike a bare /[\d.]+/ match, which silently drops the sign. Non-finite parses ("."
// , "") return null. This is the single numeric extractor shared by sorting, gradient ranges, and
// gradient color mapping so those paths can never disagree on a value's numeric interpretation.
export const parseLeadingNumber = (raw) => {
    const s = String(raw ?? '').trim();
    const m = s.match(/^-?[\d.]+/) || s.match(/[\d.]+/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
};

// Minimum distinct numeric values a field needs before it is treated as a continuous GRADIENT.
// A mostly-numeric field with fewer distinct values (e.g. a 0/1 flag) is shown as distinct
// categorical colors instead of a degenerate 2-stop ramp.
export const GRADIENT_MIN_DISTINCT = 3;

// Classify a field's raw values as 'gradient' | 'categorical' | 'text' from the VALUES alone
// (callers apply any field-name overrides first, e.g. always-text or hardcoded-palette fields).
//  - gradient   : mostly numeric (>80%) AND at least `minGradientDistinct` distinct values.
//  - categorical: 2..10 distinct values (case-insensitive).
//  - text       : everything else (empty, single-valued, or too many distinct non-numeric values).
// The numeric test requires the value to START with a number (optionally a single leading '-'), so
// a genuine negative keeps its sign while junk like "--.." or "N/A" is not counted as numeric.
export const classifyMetadataValues = (rawValues, { minGradientDistinct = GRADIENT_MIN_DISTINCT } = {}) => {
    const values = (rawValues || [])
        .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
        .map((v) => String(v));
    if (values.length === 0) return 'text';

    const numericCount = values.filter((v) => /^-?[\d.]+(\s|$)/.test(v.trim())).length;
    const isNumeric = numericCount > values.length * 0.8;
    const distinct = new Set(values.map(metadataValueKey)).size;

    if (isNumeric && distinct >= minGradientDistinct) return 'gradient';
    if (distinct > 1 && distinct <= 10) return 'categorical';
    return 'text';
};

// Collapse metadata FIELD NAMES across datasets so case/whitespace variants ("Sex"/"sex"/"Sex ")
// become a single field. Returns a NEW per-dataset metadata map whose keys are the canonical
// (first-seen) display name for each field, preserving each dataset's values. Without this, a field
// that different datasets spell differently renders as two separate heatmap rows, each populated for
// only the datasets that used that exact spelling (half-blank bands). Mirrors dedupeMetadataValues,
// but for keys. First-seen (in dataset then insertion order) wins the display casing.
export const canonicalizeMetadataConfig = (analysesMetadata) => {
    const canonicalByKey = new Map(); // fieldKey -> canonical display name (first seen)

    // Pass 1: establish the canonical display name for every field key, in stable order.
    Object.values(analysesMetadata || {}).forEach((meta) => {
        Object.keys(meta || {}).forEach((field) => {
            const key = metadataFieldKey(field);
            if (key !== '' && !canonicalByKey.has(key)) {
                canonicalByKey.set(key, String(field).trim());
            }
        });
    });

    // Pass 2: rewrite each dataset's keys to the canonical name. If one dataset happens to carry two
    // spellings of the same field, keep the first non-empty value encountered.
    const out = {};
    Object.entries(analysesMetadata || {}).forEach(([dataset, meta]) => {
        const rewritten = {};
        Object.entries(meta || {}).forEach(([field, value]) => {
            const key = metadataFieldKey(field);
            if (key === '') return;
            const canonical = canonicalByKey.get(key);
            const existing = rewritten[canonical];
            if (existing === undefined || existing === null || existing === '') {
                rewritten[canonical] = value;
            }
        });
        out[dataset] = rewritten;
    });
    return out;
};

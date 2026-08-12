// Pure, dependency-free builder for the Pathway Heat Map "result table" CSV export.
// Lives under imports/utils (NOT imports/**/client/**) so it is architecture-neutral and can be
// imported on both client and server — including the server-side Mocha runner. The DOM download
// (Blob + <a>) stays in the component; this module only turns data into a CSV string, so the
// formatting/escaping is unit-testable without a browser.

// RFC-4180 field escaping: wrap in quotes and double any embedded quote when the value contains a
// comma, quote, or newline; otherwise emit it as-is.
const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Emit finite numbers faithfully (no rounding — this is a data export), everything else as blank.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * Build the CSV text for the full pathway × analysis result matrix.
 *
 * @param {Array<{id:string,name:string,values:Object}>} pathways
 *        one row per pathway; `values[analysisKey] = { pValue, pValueFDR, score }`.
 * @param {Array<{key:string,label:string}>} analyses  columns, in display order.
 * @returns {string} header row + one row per pathway, `\n`-joined.
 */
export const buildPathwayResultCsv = (pathways = [], analyses = []) => {
    const cols = Array.isArray(analyses) ? analyses : [];
    const header = ['Pathway ID', 'Name'];
    cols.forEach((a) => {
        header.push(`${a.label} p-value`, `${a.label} FDR`, `${a.label} Score`);
    });

    const lines = [header.map(csvEscape).join(',')];
    (Array.isArray(pathways) ? pathways : []).filter(Boolean).forEach((p) => {
        const values = p.values || {};
        const row = [p.id, p.name];
        cols.forEach((a) => {
            const d = values[a.key] || {};
            row.push(num(d.pValue), num(d.pValueFDR), num(d.score));
        });
        lines.push(row.map(csvEscape).join(','));
    });
    return lines.join('\n');
};

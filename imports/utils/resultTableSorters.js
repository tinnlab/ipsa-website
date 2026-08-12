// Pure helpers for the pathway-analysis result tables (antd Table).
// Extracted so the sort logic can be unit-tested without rendering React.

// Numeric ascending comparator for an antd Table column `sorter`.
// Missing values (null / undefined / '') coerce to `missing` so they sort last
// on ascending — matches the existing pValue comparator in the result tables.
export function makeNumericSorter(field, { missing = 1 } = {}) {
    return (a, b) => {
        const av = a[field] == null || a[field] === '' ? missing : a[field];
        const bv = b[field] == null || b[field] === '' ? missing : b[field];
        return av - bv;
    };
}

// Default-sort target for a result table: the consensus method when present,
// else the first enabled method. Mirrors the Visualization table's behavior,
// where `sortedMethods` forces consensus to the front.
export function pickDefaultSortMethod(enabledMethods = []) {
    if (enabledMethods.includes('consensus')) return 'consensus';
    return enabledMethods[0] ?? null;
}

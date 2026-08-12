#!/usr/bin/env node
// Static regression guard for: `ReferenceError: Empty is not defined`.
//
// MassAnalysisModal.jsx renders <Empty .../> (the "No analyses for fine-tuning"
// empty state, and image={Empty.PRESENTED_IMAGE_SIMPLE}) and, after this fix,
// <Radio.Group> for the restored PGSEA ranking selector. If either component is used
// as a JSX tag but NOT imported from 'antd', the page crashes at render with a
// ReferenceError. A browser render test would need a driver; this cheap source scan
// asserts that every antd primitive used as a JSX tag in the file is imported.
//
// Runs as a plain Node script (not inside `meteor test`, which executes from a temp
// build bundle with no access to the source tree). Wire: `npm run test:imports`.

const fs = require('fs');
const path = require('path');

// antd primitives referenced as JSX tags that must appear in the file's
// `import { ... } from 'antd'` block. Locals destructured from antd (Title/Text/Step/
// Dragger) and in-file components are intentionally excluded.
const ANTD_TAGS = [
    'Modal', 'Button', 'Steps', 'Upload', 'Card', 'Table', 'Select', 'Collapse',
    'Form', 'InputNumber', 'Checkbox', 'Space', 'Alert', 'Progress', 'Tag', 'Divider',
    'Spin', 'Input', 'Transfer', 'Tooltip', 'Empty', 'Radio', 'Row', 'Col', 'Badge',
];

// Files to check, plus the tags each one is REQUIRED to still be using. The `requires`
// entries are the components whose absence would mean the guard has silently stopped
// covering the thing it was written for.
const TARGETS = [
    {
        file: 'imports/client/pages/home/Analysis/Session/components/MassAnalysisModal.jsx',
        requires: ['Empty', 'Radio'],
    },
    {
        // Renders the PGSEA "Calculate gene rankings by" <Radio.Group>.
        file: 'imports/client/pages/home/Analysis/Session/components/wizard/Step2_DataInput.jsx',
        requires: ['Radio'],
    },
];

function fail(msg) {
    console.error(`✗ antd-import check: ${msg}`);
    process.exit(1);
}

let totalImports = 0;

for (const target of TARGETS) {
    const fullPath = path.join(__dirname, '..', target.file);
    const src = fs.readFileSync(fullPath, 'utf8');

    const importBlock = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]antd['"]/);
    if (!importBlock) fail(`${target.file}: could not find the \`import { ... } from 'antd'\` block`);
    const imported = new Set(importBlock[1].split(',').map((s) => s.trim()).filter(Boolean));
    totalImports += imported.size;

    // Collect capitalized JSX tags actually used, e.g. <Empty ...> and <Radio ...>.
    const used = new Set();
    for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)) used.add(m[1]);

    for (const tag of target.requires) {
        if (!used.has(tag)) fail(`${target.file}: expected <${tag} /> to be used in the file`);
    }

    const missing = [];
    for (const tag of ANTD_TAGS) {
        if (used.has(tag) && !imported.has(tag)) missing.push(tag);
    }
    if (missing.length) {
        fail(`${target.file}: used as JSX but not imported from 'antd': ${missing.join(', ')}`);
    }
}

// The PGSEA "Calculate gene rankings by" options live in /imports/utils/pgseaInput and are
// shared so the mass modal and the single-analysis wizard cannot drift on wording. A local
// re-definition in either file would silently reintroduce that drift, and a unit test cannot
// catch it (meteor test runs from a temp bundle with no source access), so it is checked here.
for (const target of TARGETS) {
    const src = fs.readFileSync(path.join(__dirname, '..', target.file), 'utf8');
    if (!/<Radio[\s/>]/.test(src)) continue; // only files that render the selector
    if (!/import\s*\{[^}]*\bRANKING_OPTIONS\b[^}]*\}\s*from\s*['"][^'"]*pgseaInput['"]/.test(src)) {
        fail(`${target.file}: must import RANKING_OPTIONS from /imports/utils/pgseaInput`);
    }
    if (/(?:const|let|var)\s+RANKING_OPTIONS\s*=/.test(src)) {
        fail(`${target.file}: must not define its own RANKING_OPTIONS — import the shared one`);
    }
}

console.log(`✓ antd-import check passed (${TARGETS.length} files, ${totalImports} antd imports; RANKING_OPTIONS shared)`);

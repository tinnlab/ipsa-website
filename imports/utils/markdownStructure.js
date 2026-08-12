// markdownStructure.js — turn report markdown into the flat element list the PDF/Word
// exporters render.
//
// This exists so the exports and the website agree. The website renders reports with
// react-markdown v8 + remark-gfm, which is `unified().use(remarkParse).use(remarkPlugins)`
// under the hood (react-markdown/lib/react-markdown.js). The exporters used to run a
// hand-rolled line scanner instead, and the two disagreed — most visibly on tables, because
// the scanner opened a table on any line containing a "|", while GFM requires a header row
// followed by a delimiter row. A gene pair written "TP53|MDM2" in prose therefore came out as
// a bordered table in the PDF and a <w:tbl> in the .docx while rendering as plain text in the
// browser. Parsing with the same libraries is what keeps the two from drifting again.
//
// Deliberately free of React/antd/jspdf/docx imports so it can be exercised from plain Node.

import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const processor = unified().use(remarkParse).use(remarkGfm);

export const BULLET = '•';

const MARK_BY_NODE_TYPE = {
    strong: 'bold',
    emphasis: 'italic',
    delete: 'strike'
};

const emptyRun = (text) => ({
    text,
    bold: false,
    italic: false,
    code: false,
    strike: false,
    link: null
});

const sameMarks = (a, b) => (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.strike === b.strike &&
    a.link === b.link
);

// Runs carry the inline formatting the website shows (bold/italic/code/strikethrough/links)
// so the exporters can reproduce it instead of flattening everything to plain text.
const pushRun = (runs, text, marks) => {
    if (!text) return;

    const run = {
        text,
        bold: !!marks.bold,
        italic: !!marks.italic,
        code: !!marks.code,
        strike: !!marks.strike,
        link: marks.link || null
    };

    const previous = runs[runs.length - 1];
    if (previous && sameMarks(previous, run)) {
        previous.text += run.text;
        return;
    }

    runs.push(run);
};

export const runsToText = (runs) => (runs || []).map(run => run.text).join('');

// The exact source text a node came from. Used for nodes we cannot resolve semantically, so
// they degrade to what the reader sees in the browser rather than to something shorter.
const rawSlice = (node, source) => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    return (typeof start === 'number' && typeof end === 'number') ? source.slice(start, end) : '';
};

const collectRuns = (nodes, source, marks, runs) => {
    for (const node of nodes || []) {
        switch (node.type) {
            // A newline inside a text node is a SOFT break: the browser collapses it to
            // whitespace and reflows the paragraph. Only a `break` node (a hard break) starts
            // a new line. Carrying the newline through would re-impose the markdown source's
            // line wrapping on the PDF and the .docx, which the website never does.
            case 'text':
                pushRun(runs, node.value.replace(/\r?\n/g, ' '), marks);
                break;

            case 'inlineCode':
                pushRun(runs, node.value, {...marks, code: true});
                break;

            case 'break':
                pushRun(runs, '\n', marks);
                break;

            case 'strong':
            case 'emphasis':
            case 'delete':
                collectRuns(node.children, source, {...marks, [MARK_BY_NODE_TYPE[node.type]]: true}, runs);
                break;

            case 'link':
                collectRuns(node.children, source, {...marks, link: node.url || null}, runs);
                break;

            case 'image':
                pushRun(runs, node.alt || '', marks);
                break;

            // A label with no matching definition never becomes a reference — micromark only
            // resolves one when parser.defined contains the label — so report citations like
            // "[1]" arrive here as plain text and keep their brackets. These cases are the
            // ones that DO have a definition; emit the source text so numbering never shifts.
            case 'linkReference':
            case 'imageReference':
            case 'footnoteReference':
                pushRun(runs, rawSlice(node, source), marks);
                break;

            // react-markdown v8 is used without rehype-raw, so raw HTML renders as nothing.
            case 'html':
                break;

            default:
                if (node.children) collectRuns(node.children, source, marks, runs);
                else if (typeof node.value === 'string') pushRun(runs, node.value, marks);
        }
    }

    return runs;
};

const textAndRuns = (node, source) => {
    const runs = collectRuns(node.children, source, {}, []);
    return {text: runsToText(runs), runs};
};

const walkList = (list, source, context, elements) => {
    const depth = context.depth || 0;
    const ordered = !!list.ordered;
    const start = typeof list.start === 'number' ? list.start : 1;

    list.children.forEach((item, index) => {
        if (item.type !== 'listItem') return;

        const runs = [];
        // Nested lists and non-paragraph blocks are emitted after the item rather than folded
        // into its text, which is how the browser stacks them.
        const trailing = [];

        item.children.forEach(child => {
            if (child.type === 'paragraph') {
                if (runs.length) pushRun(runs, '\n', {});
                collectRuns(child.children, source, {}, runs);
                return;
            }
            trailing.push(child);
        });

        // remark-gfm lifts the checkbox out of the text and onto the item, so put a visible
        // marker back for formats that have no checkbox of their own.
        if (typeof item.checked === 'boolean') {
            runs.unshift(emptyRun(item.checked ? '[x] ' : '[ ] '));
        }

        elements.push({
            type: 'list',
            text: runsToText(runs),
            runs,
            ordered,
            marker: ordered ? `${start + index}.` : BULLET,
            depth
        });

        walkBlocks(trailing, source, {...context, depth: depth + 1}, elements);
    });
};

function walkBlocks(nodes, source, context, elements) {
    for (const node of nodes || []) {
        switch (node.type) {
            case 'heading':
                elements.push({type: 'heading', level: node.depth, ...textAndRuns(node, source)});
                break;

            case 'paragraph': {
                const element = {type: 'paragraph', ...textAndRuns(node, source)};
                if (context.blockquote) element.blockquote = true;
                if (element.runs.length) elements.push(element);
                break;
            }

            case 'blockquote':
                walkBlocks(node.children, source, {...context, blockquote: true}, elements);
                break;

            case 'list':
                walkList(node, source, context, elements);
                break;

            case 'table':
                elements.push({
                    type: 'table',
                    rows: node.children.map(row => row.children.map(cell => textAndRuns(cell, source)))
                });
                break;

            case 'code':
                elements.push({
                    type: 'code',
                    language: (node.lang || '').trim(),
                    content: node.value || ''
                });
                break;

            case 'thematicBreak':
                elements.push({type: 'hr'});
                break;

            // Nothing the browser paints: link definitions are consumed by their references,
            // and raw HTML is dropped for want of rehype-raw.
            case 'definition':
            case 'footnoteDefinition':
            case 'yaml':
            case 'html':
                break;

            default:
                if (node.children) walkBlocks(node.children, source, context, elements);
        }
    }
}

/**
 * Parse markdown into the element list the exporters render.
 *
 * Element types, all of which the jsPDF and docx renderers understand:
 *   {type:'heading',    level, text, runs}
 *   {type:'paragraph',  text, runs, blockquote?}
 *   {type:'list',       text, runs, ordered, marker, depth}   one element per item
 *   {type:'table',      rows: [[{text, runs}]]}
 *   {type:'code',       language, content}
 *   {type:'hr'}
 *
 * A run is {text, bold, italic, code, strike, link}.
 *
 * Element indices matter: preRenderMermaidDiagrams keys its diagram map by an element's index
 * in this array, and the renderers look diagrams up by the same index.
 */
export const parseMarkdownToStructure = (markdown) => {
    if (!markdown) return [];

    const source = String(markdown);
    const elements = [];
    walkBlocks(processor.parse(source).children, source, {depth: 0, blockquote: false}, elements);
    return elements;
};

// Heading extraction and TOC assembly for rendered markdown reports.
//
// Moved here verbatim from the AIForm/utils.js it used to share a file with. Those functions are
// pure, but that module imports React, antd, react-markdown and mermaid, so the server-side Mocha
// runner cannot load it — which meant the rules driving the report's table of contents could not be
// exercised outside a browser. Nothing about their behaviour changes; AIForm/utils.js re-exports
// them so every existing import site keeps working.

// URL-friendly slug for a heading. Two headings with the same text produce the same slug — a
// collision markdown itself permits — so anywhere several documents are rendered onto one page,
// namespacedHeadingId below is what keeps their ids apart.
export const slugify = (text) => {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
};

// The DOM id for a heading that belongs to a named block, and therefore the id the table of contents
// scrolls to.
//
// The report body renders every template of a batch at once, and six-section batches routinely repeat
// a heading title ("Methods", "Overview") across templates. Slugs alone would give those the same id,
// and a TOC click on the second would scroll to the first. Prefixing with the block's own id — the
// prompt id, which is unique where titles are not — makes every id unique.
//
// An empty prefix yields the bare slug, so a single standalone document is unaffected.
export const namespacedHeadingId = (prefix, text) => {
    const slug = slugify(text);
    return prefix ? `${prefix}-${slug}` : slug;
};

// Every ATX heading in a markdown string, in document order.
export const extractMarkdownHeadings = (markdownContent) => {
    if (!markdownContent) return [];

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings = [];
    let match;

    while ((match = headingRegex.exec(markdownContent)) !== null) {
        const level = match[1].length; // Number of # characters
        const text = match[2].trim();
        const id = slugify(text);

        headings.push({
            level,
            text,
            id
        });
    }

    return headings;
};

// Nest a flat heading list by level, so the sider can render it as a tree.
export const buildTOCHierarchy = (headings) => {
    if (!headings || headings.length === 0) return [];

    const result = [];
    const stack = [];

    headings.forEach(heading => {
        const node = { ...heading, children: [] };

        // Find the parent for this heading
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }

        if (stack.length === 0) {
            // Top-level heading
            result.push(node);
        } else {
            // Nested heading
            stack[stack.length - 1].children.push(node);
        }

        stack.push(node);
    });

    return result;
};

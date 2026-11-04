// Pure helpers for a report's TEMPLATES — the completed prompts of one batch.
//
// A batch holds one entry per completed prompt. The publication-ready workflow produces exactly one
// ("Publication-Ready Report with Fact-Checking", server/api/methods/queue.js); legacy batches
// routinely hold six ("Biological Insights", "Pathways Interaction", "Therapeutic Targets", ...).
// Both are ordinary, so nothing here may assume a single template — and nothing may change what the
// single-template case already does.

import { extractMarkdownHeadings, buildTOCHierarchy, namespacedHeadingId } from './markdownHeadings';

// The DOM id of a template's title, and therefore what the table of contents scrolls to. Keyed on
// the prompt _id rather than on the title: two templates can share a title, ids cannot.
export function templateAnchorId(template) {
    return template && template.id != null ? `template-${String(template.id)}` : '';
}

// The markdown to export.
//
// With one template this is its content, untouched — byte for byte what was exported before, when
// it was the only panel the accordion could open. With several, they are concatenated in the order
// they are rendered, each under an H1 of its title: H1 is the document's top level in both
// exporters (parseMarkdownToStructure -> level 1 -> 18pt bold in the PDF, HeadingLevel.HEADING_1 in
// the .docx), which is what makes them read as peer sections rather than as subsections of whichever
// template happened to come first.
//
// Exporting one of six visible sections is what this replaces: the export used to follow whichever
// accordion panel was open, and there is no open panel any more.
export function exportMarkdownForTemplates(templates) {
    const withContent = (templates || []).filter(t => t && t.content);
    if (withContent.length === 0) return '';
    if (withContent.length === 1) return withContent[0].content;
    return withContent
        .map(t => (t.title ? `# ${t.title}\n\n${t.content}` : t.content))
        .join('\n\n');
}

// The table of contents for the whole report body.
//
// It used to cover the ACTIVE accordion panel only — the one template the user had open. With the
// accordion gone every template is on screen at once, so a TOC of one of them would describe a
// fraction of the page. (It also starts working across templates for the first time: the sider
// tracks headings that are mounted, and collapsed panels mounted none of theirs.)
//
// One template keeps precisely the shape of TOC it had — its own H1/H2s, nothing injected, so the
// common publication-ready report reads as before. Several get one top-level entry per template
// carrying that template's own hierarchy beneath, so the reader can see the report has parts and jump
// between them.
//
// Every entry's id is namespaced by its template, matching what MarkdownWithReferences renders for
// the same heading. That is load-bearing now rather than tidy: the accordion used to mount ONE
// template at a time, so two identically titled headings could never share the page. Stacking them
// puts both in the DOM at once, and legacy six-section batches repeat titles ("Methods", "Overview")
// routinely — without the namespace, a click on the second scrolls to the first.
export function templatesTocStructure(templates) {
    const list = (templates || []).filter(t => t && t.content);
    if (list.length === 0) return [];

    const own = (template) => {
        const prefix = templateAnchorId(template);
        return buildTOCHierarchy(
            extractMarkdownHeadings(template.content)
                .filter(h => h.level === 1 || h.level === 2)
                .map(h => ({ ...h, id: namespacedHeadingId(prefix, h.text) }))
        );
    };

    if (list.length === 1) return own(list[0]);

    return list.map(template => ({
        level: 1,
        text: template.title || 'Untitled section',
        id: templateAnchorId(template),
        children: own(template)
    }));
}

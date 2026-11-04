// The report body renders every completed template at once — no accordion, no "active" one. These
// pin the two things that decision moved: what gets exported, and what the TOC covers.
import assert from "assert";
import { parseMarkdownToStructure } from "../imports/utils/markdownStructure";
import {
    templateAnchorId,
    exportMarkdownForTemplates,
    templatesTocStructure,
} from "../imports/utils/reportTemplates";
import { namespacedHeadingId, slugify } from "../imports/utils/markdownHeadings";

// processTemplateResult's real output shape: {id: prompt._id, templateId, title: prompt.templateTitle,
// content, references[], referenceMapping: Map, orderedIds[]}.
const template = (id, title, content, refs = 0) => ({
    id,
    templateId: `tpl-${id}`,
    title,
    content,
    references: Array.from({ length: refs }, (_, i) => ({ paperId: `p${i}`, bibtex_json: {} })),
    referenceMapping: new Map(),
    orderedIds: [],
});

// One template, titled by queue.js:393 — what the publication-ready workflow always produces.
const PUBREADY = template(
    "pq1",
    "Publication-Ready Report with Fact-Checking",
    "# Summary\n\nThe cell cycle is enriched.\n\n## Methods\n\nORA over KEGG.",
    12
);

// Six sections is the ordinary shape of a legacy batch.
const LEGACY = [
    template("pq1", "Biological Insights", "## Overview\n\nA.\n\n### Detail\n\nB."),
    template("pq2", "Pathways Interaction", "## Networks\n\nC."),
    template("pq3", "Therapeutic Targets", "## Targets\n\nD.", 4),
];

// Repeated heading titles across templates are ordinary in this data — "Methods" and "Overview" turn
// up in most sections of a six-section batch.
const REPEATED_TITLES = [
    template("pq1", "Biological Insights", "## Overview\n\nA.\n\n## Methods\n\nB."),
    template("pq2", "Therapeutic Targets", "## Overview\n\nC.\n\n## Methods\n\nD."),
];

describe("report templates", function () {
    describe("templateAnchorId", function () {
        it("prefixes the prompt id, so two templates sharing a title still differ", function () {
            const a = template("pq1", "Biological Insights", "x");
            const b = template("pq2", "Biological Insights", "y");
            assert.strictEqual(templateAnchorId(a), "template-pq1");
            assert.notStrictEqual(templateAnchorId(a), templateAnchorId(b));
        });

        it("coerces a non-string id", function () {
            assert.strictEqual(templateAnchorId({ id: 7 }), "template-7");
        });

        it("is empty for a missing template or id", function () {
            assert.strictEqual(templateAnchorId(null), "");
            assert.strictEqual(templateAnchorId(undefined), "");
            assert.strictEqual(templateAnchorId({}), "");
        });
    });

    describe("exportMarkdownForTemplates", function () {
        // The publication-ready case must not change at all: it was the only panel the accordion
        // could open, so it is exactly what used to be exported.
        it("exports a single template's content untouched", function () {
            assert.strictEqual(exportMarkdownForTemplates([PUBREADY]), PUBREADY.content);
        });

        it("concatenates several under an H1 of each title, in render order", function () {
            assert.strictEqual(
                exportMarkdownForTemplates(LEGACY),
                "# Biological Insights\n\n## Overview\n\nA.\n\n### Detail\n\nB.\n\n" +
                "# Pathways Interaction\n\n## Networks\n\nC.\n\n" +
                "# Therapeutic Targets\n\n## Targets\n\nD."
            );
        });

        // The join is what makes this a risk: a heading glued to the previous paragraph parses as
        // text, and the exported document would silently lose its section structure. The website and
        // both exporters read the same markdown, so assert against the exporters' own parser.
        it("produces headings the exporters' parser actually recognises", function () {
            const structure = parseMarkdownToStructure(exportMarkdownForTemplates(LEGACY));
            const titles = structure
                .filter(el => el.type === "heading" && el.level === 1)
                .map(el => el.text);
            assert.deepStrictEqual(titles, [
                "Biological Insights",
                "Pathways Interaction",
                "Therapeutic Targets",
            ]);
        });

        it("skips templates with no content, and unwraps to the lone survivor", function () {
            const withEmpty = [template("pq0", "Empty", ""), PUBREADY, template("pq9", "Nothing", null)];
            assert.strictEqual(exportMarkdownForTemplates(withEmpty), PUBREADY.content);
        });

        // '' rather than a throw, so the caller can keep saying "Report content is empty".
        it("is empty for no templates at all", function () {
            assert.strictEqual(exportMarkdownForTemplates([]), "");
            assert.strictEqual(exportMarkdownForTemplates(null), "");
            assert.strictEqual(exportMarkdownForTemplates(undefined), "");
            assert.strictEqual(exportMarkdownForTemplates([template("pq0", "Empty", "")]), "");
        });

        it("falls back to bare content for a template with no title", function () {
            const untitled = [template("pq1", "", "A."), template("pq2", "Second", "B.")];
            assert.strictEqual(exportMarkdownForTemplates(untitled), "A.\n\n# Second\n\nB.");
        });
    });

    describe("namespacedHeadingId", function () {
        it("prefixes the slug so two blocks cannot collide", function () {
            assert.strictEqual(namespacedHeadingId("template-pq1", "Methods"), "template-pq1-methods");
            assert.notStrictEqual(
                namespacedHeadingId("template-pq1", "Methods"),
                namespacedHeadingId("template-pq2", "Methods")
            );
        });

        it("is the bare slug with no prefix, so a lone document is unaffected", function () {
            assert.strictEqual(namespacedHeadingId("", "Methods"), slugify("Methods"));
            assert.strictEqual(namespacedHeadingId(undefined, "Methods"), "methods");
        });
    });

    describe("templatesTocStructure", function () {
        // Structurally unchanged for the common report: its own headings, no synthetic entry above
        // them. Only the ids are namespaced.
        it("leaves a single template's own heading structure alone", function () {
            assert.deepStrictEqual(
                templatesTocStructure([PUBREADY]),
                [{
                    level: 1, text: "Summary", id: "template-pq1-summary",
                    children: [{ level: 2, text: "Methods", id: "template-pq1-methods", children: [] }],
                }]
            );
        });

        it("filters to levels 1 and 2, so an H3 never reaches the sider", function () {
            const toc = templatesTocStructure([LEGACY[0]]);
            assert.deepStrictEqual(toc, [
                { level: 2, text: "Overview", id: "template-pq1-overview", children: [] },
            ]);
        });

        it("gives several templates one top-level entry each, with their own headings nested", function () {
            const toc = templatesTocStructure(LEGACY);
            assert.deepStrictEqual(toc.map(t => t.text), [
                "Biological Insights", "Pathways Interaction", "Therapeutic Targets",
            ]);
            assert.deepStrictEqual(toc[0].children.map(c => c.text), ["Overview"]);
            assert.deepStrictEqual(toc[2].children.map(c => c.text), ["Targets"]);
        });

        // The sider does getElementById on these, so they have to be the ids the body renders.
        it("uses the anchor the body renders, so the sider can find the section", function () {
            const toc = templatesTocStructure(LEGACY);
            assert.deepStrictEqual(toc.map(t => t.id), LEGACY.map(templateAnchorId));
        });

        it("names an untitled section rather than rendering a blank entry", function () {
            const toc = templatesTocStructure([template("pq1", "", "## A"), template("pq2", "B", "## C")]);
            assert.strictEqual(toc[0].text, "Untitled section");
        });

        // The regression this pins: the accordion mounted ONE template at a time, so duplicate
        // heading ids could never share the page. Stacking them puts both in the DOM, and without the
        // namespace a contents click on the second "Methods" scrolls to the first.
        it("keeps repeated heading titles apart across templates", function () {
            const toc = templatesTocStructure(REPEATED_TITLES);
            const innerIds = toc.flatMap(t => t.children.map(c => c.id));
            assert.deepStrictEqual(innerIds, [
                "template-pq1-overview", "template-pq1-methods",
                "template-pq2-overview", "template-pq2-methods",
            ]);
            assert.strictEqual(new Set(innerIds).size, innerIds.length, "ids must be unique");
        });

        // The ids only work if they are the ids MarkdownWithReferences actually renders, which it
        // builds from the same helper with the same prefix.
        it("uses ids the renderer reproduces from the same prefix", function () {
            const toc = templatesTocStructure(REPEATED_TITLES);
            toc.forEach((section, i) => {
                const prefix = templateAnchorId(REPEATED_TITLES[i]);
                section.children.forEach(child => {
                    assert.strictEqual(child.id, namespacedHeadingId(prefix, child.text));
                });
            });
        });

        it("namespaces a single template's headings too, so there is one rule and no branch", function () {
            const toc = templatesTocStructure([PUBREADY]);
            assert.deepStrictEqual(toc.map(t => t.id), ["template-pq1-summary"]);
            assert.deepStrictEqual(toc[0].children.map(c => c.id), ["template-pq1-methods"]);
        });

        it("is empty while there is nothing to show", function () {
            assert.deepStrictEqual(templatesTocStructure([]), []);
            assert.deepStrictEqual(templatesTocStructure(null), []);
            assert.deepStrictEqual(templatesTocStructure([template("pq0", "Empty", "")]), []);
        });
    });
});

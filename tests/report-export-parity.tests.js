import assert from "assert";
import {parseMarkdownToStructure} from "../imports/utils/markdownStructure";
import {sanitizeForDocx} from "../imports/utils/reportExport";

// The exported PDF/Word report has to look like the report on the website. Both start from the
// same markdown string, so the only thing that can make them differ is how each side parses
// it. The website uses react-markdown v8 + remark-gfm; these tests pin the exporters' parser
// to the same GFM rules.

const types = (structure) => structure.map(element => element.type);
const tables = (structure) => structure.filter(element => element.type === "table");
const grid = (table) => table.rows.map(row => row.map(cell => cell.text));

const cp = (...codes) => String.fromCharCode(...codes);
const SUB5 = cp(0x2085);
const SUB0 = cp(0x2080);
const BETA = cp(0x03b2);
const INCREMENT = cp(0x2206);
const MICRO = cp(0x00b5);
const ZWSP = cp(0x200b);
const BEL = cp(0x0007);

describe("report export - tables", function () {
    // The reported bug. The old parser opened a table on any line containing a "|", so a gene
    // pair in prose came out as a bordered table in the PDF and a <w:tbl> in the .docx while
    // the browser showed plain text. GFM needs a delimiter row; prose pipes are just text.
    it("does not make a table out of prose containing pipes", function () {
        const structure = parseMarkdownToStructure(
            "The TP53|MDM2 axis was disrupted.\n\nExpression moved up|down at a 2|1 ratio."
        );

        assert.deepStrictEqual(types(structure), ["paragraph", "paragraph"]);
        assert.strictEqual(tables(structure).length, 0);
        assert.ok(structure[0].text.includes("TP53|MDM2"));
    });

    it("still builds a real table from a real GFM table", function () {
        const structure = parseMarkdownToStructure(
            "| Gene | Score |\n|------|-------|\n| TP53 | 1.24 |\n| MDM2 | -0.88 |"
        );

        assert.deepStrictEqual(types(structure), ["table"]);
        assert.deepStrictEqual(grid(structure[0]), [
            ["Gene", "Score"],
            ["TP53", "1.24"],
            ["MDM2", "-0.88"]
        ]);
    });

    // The old parser filtered empty cells out of the split, so a blank cell shifted every
    // later column left and the padding step then padded the wrong end of the row.
    it("keeps an empty cell in place instead of shifting the columns", function () {
        const structure = parseMarkdownToStructure(
            "| Gene | Score | Note |\n|------|-------|------|\n| TP53 |  | hub |\n| MDM2 | -0.88 |  |"
        );

        assert.deepStrictEqual(grid(structure[0]), [
            ["Gene", "Score", "Note"],
            ["TP53", "", "hub"],
            ["MDM2", "-0.88", ""]
        ]);
    });

    it("treats an escaped pipe as cell content", function () {
        const structure = parseMarkdownToStructure(
            "| Term | Meaning |\n|------|---------|\n| a \\| b | logical or |"
        );

        assert.deepStrictEqual(grid(structure[0])[1], ["a | b", "logical or"]);
    });
});

describe("report export - blocks", function () {
    // A soft break is whitespace to the browser, which reflows the paragraph to the column
    // width. Carrying the newline through would re-impose the markdown source's line wrapping
    // on the PDF and the .docx.
    it("reflows a soft-wrapped paragraph instead of keeping the source line breaks", function () {
        const structure = parseMarkdownToStructure(
            "This paragraph is soft wrapped\nacross two source lines."
        );

        assert.deepStrictEqual(types(structure), ["paragraph"]);
        assert.strictEqual(structure[0].text, "This paragraph is soft wrapped across two source lines.");
    });

    // A hard break (two trailing spaces) is a real <br> and must survive as one.
    it("keeps a hard line break", function () {
        const structure = parseMarkdownToStructure("first line  \nsecond line");

        assert.deepStrictEqual(types(structure), ["paragraph"]);
        assert.strictEqual(structure[0].text, "first line\nsecond line");
    });

    it("handles ordered, nested and task lists", function () {
        const structure = parseMarkdownToStructure([
            "1. First",
            "2. Second",
            "   - nested",
            "",
            "- [x] done",
            "- [ ] pending"
        ].join("\n"));

        assert.deepStrictEqual(types(structure), ["list", "list", "list", "list", "list"]);

        assert.deepStrictEqual(
            structure.map(item => [item.text, item.marker, item.ordered, item.depth]),
            [
                ["First", "1.", true, 0],
                ["Second", "2.", true, 0],
                ["nested", "•", false, 1],
                ["[x] done", "•", false, 0],
                ["[ ] pending", "•", false, 0]
            ]
        );
    });

    it("marks blockquote paragraphs and drops the quote marker", function () {
        const structure = parseMarkdownToStructure("> Enrichment was strongest in p53 signalling.");

        assert.deepStrictEqual(types(structure), ["paragraph"]);
        assert.strictEqual(structure[0].blockquote, true);
        assert.strictEqual(structure[0].text, "Enrichment was strongest in p53 signalling.");
    });

    it("strips markdown out of heading text and keeps the level", function () {
        const structure = parseMarkdownToStructure("## **Bold** section\n\n---\n");

        assert.deepStrictEqual(types(structure), ["heading", "hr"]);
        assert.strictEqual(structure[0].level, 2);
        assert.strictEqual(structure[0].text, "Bold section");
    });
});

describe("report export - inline formatting", function () {
    it("carries bold, italic, code, strikethrough and links as runs", function () {
        const structure = parseMarkdownToStructure(
            "A **bold** claim, an *italic* aside, `code()`, a [link](https://example.org) and ~~struck~~ text."
        );
        const runs = structure[0].runs;
        const find = (text) => runs.find(run => run.text === text);

        // The text the reader sees carries no markdown markers any more.
        assert.ok(!structure[0].text.includes("**"));
        assert.ok(!structure[0].text.includes("~~"));

        assert.strictEqual(find("bold").bold, true);
        assert.strictEqual(find("italic").italic, true);
        assert.strictEqual(find("code()").code, true);
        assert.strictEqual(find("struck").strike, true);
        assert.strictEqual(find("link").link, "https://example.org");
    });

    // Citations are already numbered upstream by convertPaperIdsToNumbers, and "[1]" with no
    // link definition is plain text in CommonMark. Numbering must survive the parser untouched.
    it("leaves citation markers exactly as they are", function () {
        const structure = parseMarkdownToStructure("p53 drives apoptosis [1], MDM2 inhibits it [2]. See [1].");

        assert.strictEqual(structure[0].text, "p53 drives apoptosis [1], MDM2 inhibits it [2]. See [1].");
    });
});

describe("report export - code blocks", function () {
    // preRenderMermaidDiagrams keys its diagram map by an element's index in this array and
    // both renderers look diagrams up by the same index, so the shape here is load-bearing.
    it("keeps a mermaid block as a code element with its language and source", function () {
        const structure = parseMarkdownToStructure("Intro.\n\n```mermaid\ngraph TD\n  A --> B\n```");

        assert.deepStrictEqual(types(structure), ["paragraph", "code"]);
        assert.strictEqual(structure[1].language, "mermaid");
        assert.strictEqual(structure[1].content, "graph TD\n  A --> B");
    });

    it("keeps a non-mermaid block, which the exporters used to drop", function () {
        const structure = parseMarkdownToStructure("```python\nimport pandas as pd\n```");

        assert.deepStrictEqual(types(structure), ["code"]);
        assert.strictEqual(structure[0].language, "python");
        assert.strictEqual(structure[0].content, "import pandas as pd");
    });
});

describe("sanitizeForDocx", function () {
    // DOCX is UTF-8. The PDF path still transliterates because jsPDF's core fonts are Latin-1,
    // but running that same transform on Word silently deleted any character it had not been
    // taught -- "4.2 <micro>M" came out as "4.2 M", which changes a reported concentration.
    it("passes real Unicode through untouched", function () {
        const text = `IC${SUB5}${SUB0} for ${BETA}-catenin was 4.2 ${MICRO}M; ${INCREMENT}G`;

        assert.strictEqual(sanitizeForDocx(text), text);
    });

    // Word refuses to open a document whose word/document.xml contains a C0 control character,
    // and zero-width characters do turn up in LLM output.
    it("removes zero-width and XML-invalid control characters", function () {
        assert.strictEqual(sanitizeForDocx(`a${ZWSP}b${BEL}c`), "abc");
    });

    it("keeps tab, newline and carriage return", function () {
        assert.strictEqual(sanitizeForDocx("a\tb\nc\rd"), "a\tb\nc\rd");
    });

    it("tolerates empty input", function () {
        assert.strictEqual(sanitizeForDocx(""), "");
        assert.strictEqual(sanitizeForDocx(null), "");
        assert.strictEqual(sanitizeForDocx(undefined), "");
    });
});

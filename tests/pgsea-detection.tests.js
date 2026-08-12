// Tests for the folder-detection prompt + response parsing in dataValidator.js.
// The prompt is what tells the LLM whether a `Gene / Fold-Change / P-value` (header,
// 3-column) file is valid PGSEA — the OSD statDat_*.txt files were coming back
// ambiguous/invalid because the old prompt declared "PGSEA = 2 columns, NO header".
// Server-only (dataValidator imports Meteor + LLM config).
import assert from "assert";
import {
    buildDetectionAndValidationPrompt,
    parseDetectionAndValidationResponse,
    quickValidate,
} from "../server/llm/validators/dataValidator";
import { normalizePgseaInput } from "../imports/utils/pgseaInput";

describe("buildDetectionAndValidationPrompt — PGSEA accepts header + 3 columns", function () {
    const prompt = buildDetectionAndValidationPrompt(
        "OSD-99",
        [{ name: "statDat_OSD-99.txt", extension: "txt", lineCount: 17115, preview: "Gene\tFold-Change\tP-value\nGNAI3\t3.02\t0.0009" }],
        ["metadata.txt", "statDat_OSD-99.txt"],
        0
    );

    it("describes PGSEA as allowing a header and one-or-more numeric columns", function () {
        assert.ok(/header/i.test(prompt), "prompt should mention a header");
        assert.ok(/Fold-Change/i.test(prompt), "prompt should mention Fold-Change");
        assert.ok(/ALLOWED/i.test(prompt), "prompt should say a header IS ALLOWED");
    });

    it("marks a 3-column Gene/Fold-Change/P-value file as VALID in the examples", function () {
        assert.ok(
            /Gene\/Fold-Change\/P-value[^\n]*"valid":\s*true/i.test(prompt),
            "the valid example for the 3-column format is missing"
        );
    });

    it("no longer instructs that a header makes PGSEA invalid", function () {
        assert.ok(!/requires NO header/i.test(prompt), "stale 'requires NO header' rule still present");
        assert.ok(!/Found 3 columns but PGSEA requires exactly 2/i.test(prompt), "stale 3-column error still present");
    });

    it("keeps genuine invalid examples (no gene column, non-numeric ranking column)", function () {
        assert.ok(/no gene column|gene identifier column/i.test(prompt), "missing 'no gene column' invalid example");
        assert.ok(/non-numeric/i.test(prompt), "missing 'non-numeric ranking column' invalid example");
    });

    it("still includes the file preview and folder name", function () {
        assert.ok(prompt.includes("OSD-99"));
        assert.ok(prompt.includes("statDat_OSD-99.txt"));
    });
});

describe("parseDetectionAndValidationResponse", function () {
    it("parses a well-formed detection JSON", function () {
        const json = JSON.stringify({
            detectedType: "pgsea",
            confidence: "high",
            reasoning: "Gene + Fold-Change + P-value",
            primaryFile: "statDat_OSD-99.txt",
            validation: { valid: true, errors: [], detectedFormat: "3-column Gene/Fold-Change/P-value" },
            metadata: { found: true, sourceFile: "metadata.txt", format: "key_value", extractedFields: { organism: "Mus musculus" } },
        });
        const r = parseDetectionAndValidationResponse(json);
        assert.strictEqual(r.detectedType, "pgsea");
        assert.strictEqual(r.confidence, "high");
        assert.strictEqual(r.validation.valid, true);
        assert.strictEqual(r.metadata.found, true);
        assert.strictEqual(r.metadata.extractedFields.organism, "Mus musculus");
    });

    it("recovers a truncated JSON response (vLLM cut-off) instead of throwing", function () {
        // Missing the trailing closing braces — the recovery path should reconstruct it.
        const truncated =
            '{"detectedType":"pgsea","confidence":"medium","validation":{"valid":true,"errors":[]},"metadata":{"found":true';
        const r = parseDetectionAndValidationResponse(truncated);
        assert.strictEqual(r.detectedType, "pgsea");
        assert.strictEqual(r.validation.valid, true);
    });

    it("returns an unknown/invalid fallback when there is no JSON at all", function () {
        const r = parseDetectionAndValidationResponse("the model said nothing useful");
        assert.strictEqual(r.detectedType, "unknown");
        assert.strictEqual(r.validation.valid, false);
    });
});

// The single-analysis wizard's `data.validate` path runs quickValidate before the LLM. It
// must accept exactly what imports/utils/pgseaInput.js `normalizePgseaInput` accepts, or a
// perfectly good upload gets flagged as invalid in the UI.
describe("quickValidate('pgsea') — tolerant, matching the shared normalizer", function () {
    const ok = (label, text) => it(`accepts ${label}`, function () {
        const r = quickValidate("pgsea", text);
        assert.strictEqual(r.valid, true, `expected valid, got: ${JSON.stringify(r.errors)}`);
    });

    ok("3 columns with a header", "Gene\tFold-Change\tP-value\nGNAI3\t3.02\t0.0009\nCDC45\t-0.16\t0.69");
    ok("3 columns without a header", "GNAI3\t3.02\t0.0009\nCDC45\t-0.16\t0.69");
    ok("2 columns without a header (legacy)", "GOLM1\t0.377827741\nPOLD4\t0.442827998");
    ok("2 columns with a header", "Gene\tFold-Change\nGOLM1\t0.377\nPOLD4\t0.442");
    ok("a comma-separated 3-column table", "Gene,Fold-Change,P-value\nGNAI3,3.02,0.0009\nCDC45,-0.16,0.69");
    ok("negative and scientific-notation values", "A\t-2.5\t1e-10\nB\t0.3\t2.48e-11");

    it("still rejects a single column", function () {
        const r = quickValidate("pgsea", "BRCA1\nTP53\nEGFR");
        assert.strictEqual(r.valid, false);
        assert.ok(/at least 2 columns/i.test(r.errors[0]), r.errors[0]);
    });

    ok("a full limma topTable (7 columns)",
        "Gene\tlogFC\tAveExpr\tt\tP.Value\tadj.P.Val\tB\nTP53\t2.1\t8.0\t5.5\t0.001\t0.01\t3.2\nBRCA1\t-1.4\t7.2\t-4.0\t0.004\t0.02\t1.1");
    ok("a DESeq2 results table (7 columns)",
        "gene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nA\t500\t2.1\t0.3\t7.0\t1e-8\t1e-6\nB\t420\t-1.4\t0.4\t-3.5\t4e-4\t2e-3");

    it("does not impose an upper column bound the parser lacks", function () {
        // normalizePgseaInput enforces only `>= 2` columns, so rejecting >3 here would flag
        // files it parses and ranks correctly — the exact mismatch this change exists to fix.
        const wide = "Gene\tlogFC\tAveExpr\tt\tP.Value\tadj.P.Val\tB\nX\t1\t2\t3\t0.01\t0.02\t1";
        assert.strictEqual(quickValidate("pgsea", wide).valid, true);
    });

    it("accepts a file whose FIRST data rows are all-NA", function () {
        // DE exports carry NA for independently-filtered / low-count genes, and an unsorted
        // table can easily lead with one. The parser scans every row and samples 20 for column
        // typing, so it handles these — checking only one data row reported them invalid.
        const cases = [
            "Gene\tlogFC\tadj.P.Val\nRP11-1\tNA\tNA\nTP53\t2.1\t0.01\nBRCA1\t-1.4\t0.02",
            "Gene\tFold-Change\nRP11-1\tNA\nTP53\t2.1\nBRCA1\t-1.4",
            "Gene\tlogFC\tadj.P.Val\nRP11-1\tNA\tNA\nRP11-2\tNA\tNA\nTP53\t2.1\t0.01",
        ];
        for (const text of cases) {
            const r = quickValidate("pgsea", text);
            assert.strictEqual(r.valid, true, `should accept:\n${text}\nerrors: ${JSON.stringify(r.errors)}`);
        }
    });

    it("accepts a file with many leading all-NA rows", function () {
        // A DESeq2 result sorted with independently-filtered genes first leads with hundreds of
        // all-NA rows. Any fixed scan window would reject it while the parser accepts it — the
        // parser's own 20-row window is for column typing only, not for finding usable rows.
        const rows = [];
        for (let i = 0; i < 50; i++) rows.push(`FILTERED${i}\tNA\tNA`);
        rows.push("TP53\t2.1\t0.01");
        const r = quickValidate("pgsea", `Gene\tlog2FoldChange\tpadj\n${rows.join("\n")}`);
        assert.strictEqual(r.valid, true, `errors: ${JSON.stringify(r.errors)}`);
    });

    it("still rejects a file where NO row has a numeric value column", function () {
        const rows = [];
        for (let i = 0; i < 30; i++) rows.push(`G${i}\tNA\tNA`);
        const r = quickValidate("pgsea", `Gene\tlog2FoldChange\tpadj\n${rows.join("\n")}`);
        assert.strictEqual(r.valid, false);
    });

    it("rejects value tokens the parser would reject, not just what parseFloat accepts", function () {
        // parseFloat("1.5x") === 1.5 and parseFloat("45%") === 45, so these used to be called
        // valid while normalizePgseaInput threw on them — the mismatch in the other direction.
        for (const bad of ["A\t1.5x\nB\t2.3x", "A\t45%\nB\t12%", "A\t3,14\nB\t2,71"]) {
            assert.strictEqual(quickValidate("pgsea", bad).valid, false, `should reject: ${bad}`);
        }
    });

    it("rejects a file with no numeric ranking column at all", function () {
        const r = quickValidate("pgsea", "Gene\tNotes\nBRCA1\tsomething\nTP53\telse");
        assert.strictEqual(r.valid, false);
        assert.ok(/numeric/i.test(r.errors[0]), r.errors[0]);
    });

    it("rejects a header row with no data rows", function () {
        const r = quickValidate("pgsea", "Gene\tFold-Change\tP-value");
        assert.strictEqual(r.valid, false);
        assert.ok(/only a header|no gene data/i.test(r.errors[0]), r.errors[0]);
    });

    it("still reports an empty file", function () {
        const r = quickValidate("pgsea", "   \n  ");
        assert.strictEqual(r.valid, false);
        assert.ok(/empty/i.test(r.errors[0]), r.errors[0]);
    });

    // The whole point of relaxing this validator: the advisory check and the parser that
    // actually consumes the file must agree. A file the wizard happily parses must never be
    // reported as invalid — that mismatch was the original bug.
    it("never rejects an input that normalizePgseaInput successfully parses", function () {
        const corpus = [
            "GOLM1\t0.377827741\nPOLD4\t0.442827998",
            "Gene\tFold-Change\nGOLM1\t0.377\nPOLD4\t0.442",
            "Gene\tFold-Change\tP-value\nGNAI3\t3.02\t0.0009\nCDC45\t-0.16\t0.69",
            "GNAI3\t3.02\t0.0009\nCDC45\t-0.16\t0.69",
            "Gene,Fold-Change,P-value\nGNAI3,3.02,0.0009\nCDC45,-0.16,0.69",
            "Gene\tP-value\nA\t0.01\nB\t0.5",
            "Gene\tt\tP.Value\nA\t3.1\t0.01\nB\t-2.2\t0.04",
            "A\t-2.5\t1e-10\nB\t0.3\t2.48e-11",
            "GENE1\t2.5\nGENE2\t1.8",
            "hgnc_symbol\t2.5\nA\t1.8",
            "# a comment line\nA\t1\nB\t2",
            "A\t1\r\nB\t2\r\n",
            // Adversarial: delimiter ambiguity, quoting, stray blank lines, odd tokens.
            "\n\nA\t1\nB\t2",                                   // leading blank lines
            "Gene\tFold-Change\nBRCA1, variant\t2.5\nTP53\t1",  // tabs win over commas
            '"BRCA1,var",2.5\n"TP53",1.0',                      // RFC-4180 quoted gene, CSV
            "Gene\tlog2FoldChange\tpadj\nA\t1.5\t0.01",         // DESeq2 naming
            "Gene\tlogFC\tadj.P.Val\nA\t1.5\t0.01",             // limma naming
            "A\t.5\nB\t-.25",                                   // leading-dot numbers
            "A\t+1.5\nB\t-1.5",                                 // explicit plus sign
            "Gene\tFold-Change\tP-value\nA\t1\tNA\nB\t2\t0.01", // NA p-value in a data row
            "A\t1\t0.5",                                        // single 3-column row
            "A\t1",                                             // single 2-column row
            // All-NA leading rows. The earlier corpus missed these for STRUCTURAL reasons, not
            // luck: the headerless variant passes only because the NA row is taken as a header,
            // and the DESeq2 shape is saved by baseMean being numeric.
            "Gene\tlogFC\tadj.P.Val\nRP11-1\tNA\tNA\nTP53\t2.1\t0.01\nBRCA1\t-1.4\t0.02",
            "Gene\tFold-Change\nRP11-1\tNA\nTP53\t2.1\nBRCA1\t-1.4",
            "Gene\tlogFC\tadj.P.Val\nRP11-1\tNA\tNA\nRP11-2\tNA\tNA\nTP53\t2.1\t0.01",
            "Gene\tlogFC\tP.Value\nA\tNA\t0.01\nB\t2.1\t0.02",  // NA in one column only
        ];
        for (const text of corpus) {
            let parsed = null;
            try { parsed = normalizePgseaInput(text); } catch (e) { parsed = null; }
            if (!parsed) continue; // parser rejects it too — no disagreement to check
            const r = quickValidate("pgsea", text);
            assert.strictEqual(
                r.valid, true,
                `quickValidate rejected an input the parser accepts:\n${JSON.stringify(text)}\nerrors: ${JSON.stringify(r.errors)}`
            );
        }
    });
});

import assert from "assert";
import { pipelineStepNodes } from "../imports/utils/pipelineSteps";

// The "Generating AI Report" progress row used to be driven by Array.from({length: totalSteps}) with
// a stepsInfo.find(s => s.step === position) lookup. That is wrong twice over, and both were live:
//
//  1. the meta pipeline's step NUMBERS are not contiguous with the array length. With no genes the
//     service declares [1,4,5,6,8,7] and reports total_steps 6, so positions 2 and 3 rendered as
//     literal "Step 2"/"Step 3" placeholders, Discovery Analysis and Comparative Report were never
//     rendered at all, and a currentStep of 7 or 8 matched no node — nothing ever active.
//  2. the numbers are not execution order either. meta_orchestrator.py reports set_current_step 6,
//     then 8, then 7. Scoring by number (stepNumber < currentStep => completed) marks Comparative
//     Report (7) completed while Discovery Analysis (8) is still running, then walks the active
//     marker BACKWARDS when Comparative starts.
//
// The array order IS execution order, so order and status are both positional.

// Transcribed from interpretation-api server.py (the meta branch), including the 8-before-7 order.
const META_STEPS_WITH_GENES = [
    {step: 1, name: "Pathway Themes", message: "Identifying pathway themes from combined data"},
    {step: 2, name: "Hub Genes", message: "Detecting hub genes from combined data"},
    {step: 3, name: "Pathway Mechanisms", message: "Analyzing pathway mechanisms from combined data"},
    {step: 4, name: "Hypothesis Generation", message: "Generating mechanistic hypotheses from combined data"},
    {step: 5, name: "Analysis Report", message: "Generating analysis report from combined data"},
    {step: 6, name: "Reproducibility Analysis", message: "Comparing results across datasets"},
    {step: 8, name: "Discovery Analysis", message: "Identifying meta-unique findings"},
    {step: 7, name: "Comparative Report", message: "Generating final comparative report"},
];

// The same list with the two gene-dependent steps omitted, which is what the service sends when the
// run carries no genes. total_steps is then 6 while the step numbers still reach 8.
const META_STEPS_NO_GENES = META_STEPS_WITH_GENES.filter(s => s.step !== 2 && s.step !== 3);

// Single-analysis, no genes: [1,4,5], total_steps 3.
const SINGLE_STEPS_NO_GENES = [
    {step: 1, name: "Pathway Theme Identification", message: "Clustering pathways..."},
    {step: 4, name: "Hypothesis Generation", message: "Generating testable research hypotheses..."},
    {step: 5, name: "Report Generation", message: "Compiling analysis results into final report..."},
];

// The order meta_orchestrator.py actually reports for the 8-step run, after the inner pipeline has
// walked 1..5 itself.
const META_PROGRESS_WALK = [6, 8, 7];

describe("pipelineStepNodes (AI report progress row)", function () {
    it("renders every declared step, in declared order, for the 8-step meta pipeline", function () {
        const nodes = pipelineStepNodes(META_STEPS_WITH_GENES, {totalSteps: 8});
        assert.strictEqual(nodes.length, 8);
        assert.deepStrictEqual(nodes.map(n => n.name), [
            "Pathway Themes",
            "Hub Genes",
            "Pathway Mechanisms",
            "Hypothesis Generation",
            "Analysis Report",
            "Reproducibility Analysis",
            // Declared order, NOT numeric order: Discovery (8) runs before Comparative (7).
            "Discovery Analysis",
            "Comparative Report",
        ]);
    });

    it("renders all six declared steps when the gene steps are skipped (no placeholders, none dropped)", function () {
        // totalSteps 6 while the numbers reach 8 — the case a 1..totalSteps range got wrong.
        const nodes = pipelineStepNodes(META_STEPS_NO_GENES, {totalSteps: 6});
        assert.strictEqual(nodes.length, 6);
        const names = nodes.map(n => n.name);
        assert.ok(!names.some(n => /^Step \d+$/.test(n)), `no placeholders, got ${names.join(", ")}`);
        assert.ok(names.includes("Discovery Analysis"));
        assert.ok(names.includes("Comparative Report"));
    });

    it("marks a step active when currentStep names it, even above totalSteps", function () {
        const nodes = pipelineStepNodes(META_STEPS_NO_GENES, {totalSteps: 6, currentStep: 8});
        const active = nodes.filter(n => n.status === "active");
        assert.strictEqual(active.length, 1);
        assert.strictEqual(active[0].name, "Discovery Analysis");
    });

    it("never completes a step before it has run, and never moves the marker backwards", function () {
        // The regression, asserted over the whole walk rather than one frame.
        let previousActiveIndex = -1;
        const everActive = new Set();

        META_PROGRESS_WALK.forEach((currentStep) => {
            const nodes = pipelineStepNodes(META_STEPS_WITH_GENES, {totalSteps: 8, currentStep});
            const activeIndex = nodes.findIndex(n => n.status === "active");

            assert.ok(activeIndex > previousActiveIndex,
                `active marker moved backwards at currentStep ${currentStep}`);
            previousActiveIndex = activeIndex;
            everActive.add(nodes[activeIndex].name);

            nodes.forEach((node) => {
                if (node.status !== "completed") return;
                assert.ok(everActive.has(node.name) || node.step < 6,
                    `${node.name} shown completed at currentStep ${currentStep} before it ran`);
            });
        });

        // Specifically: while Discovery (8) runs, Comparative (7) is still pending, not completed.
        const midWalk = pipelineStepNodes(META_STEPS_WITH_GENES, {totalSteps: 8, currentStep: 8});
        assert.strictEqual(midWalk.find(n => n.name === "Comparative Report").status, "pending");
        assert.strictEqual(midWalk.find(n => n.name === "Reproducibility Analysis").status, "completed");
    });

    it("leaves every step pending while the job is still initialising", function () {
        const nodes = pipelineStepNodes(META_STEPS_WITH_GENES, {totalSteps: 8, currentStep: 0});
        assert.ok(nodes.every(n => n.status === "pending"));
    });

    it("marks the active step failed and leaves later steps pending", function () {
        const nodes = pipelineStepNodes(META_STEPS_WITH_GENES, {
            totalSteps: 8, currentStep: 8, status: "failed"
        });
        assert.strictEqual(nodes.find(n => n.name === "Discovery Analysis").status, "failed");
        assert.strictEqual(nodes.find(n => n.name === "Comparative Report").status, "pending");
        assert.strictEqual(nodes.find(n => n.name === "Analysis Report").status, "completed");
    });

    it("falls back to a numeric position when currentStep is not declared", function () {
        // Nothing declares step 3 here, so it is read as the 3rd position.
        const nodes = pipelineStepNodes(SINGLE_STEPS_NO_GENES, {totalSteps: 3, currentStep: 3});
        assert.strictEqual(nodes[2].status, "active");
        assert.strictEqual(nodes[1].status, "completed");
    });

    it("clamps a currentStep past the end instead of completing everything", function () {
        const nodes = pipelineStepNodes(SINGLE_STEPS_NO_GENES, {totalSteps: 3, currentStep: 99});
        assert.strictEqual(nodes.filter(n => n.status === "active").length, 1);
        assert.strictEqual(nodes[nodes.length - 1].status, "active");
    });

    it("falls back to totalSteps placeholders before the first poll returns", function () {
        // The wizard seeds totalSteps 6 with no stepsInfo; this is what renders in that window.
        const nodes = pipelineStepNodes([], {totalSteps: 6, currentStep: 0});
        assert.deepStrictEqual(nodes.map(n => n.name),
            ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6"]);
    });

    it("ignores duplicate and malformed step entries", function () {
        const nodes = pipelineStepNodes([
            {step: 1, name: "First"},
            {step: 1, name: "Duplicate"},
            {name: "No step number"},
            null,
            {step: 2, name: "Second"},
        ], {totalSteps: 5});
        assert.deepStrictEqual(nodes.map(n => n.name), ["First", "Second"]);
    });

    it("returns [] for empty / null input with no totalSteps", function () {
        assert.deepStrictEqual(pipelineStepNodes(null, {totalSteps: 0}), []);
        assert.deepStrictEqual(pipelineStepNodes(undefined, {totalSteps: 0}), []);
    });
});

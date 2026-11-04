// Pure, dependency-free step model for the "Generating AI Report" progress row. Lives under
// imports/utils so it can be imported on both client and server — including the server-side Mocha
// runner — and so the ordering rules below are unit-tested rather than argued about in JSX.
//
// THE RULE THAT MATTERS: `stepsInfo` is in EXECUTION order, and its `step` values are LABELS, not
// positions. The meta pipeline declares [1,2,3,4,5,6,8,7] (interpretation-api server.py) and reports
// progress in exactly that order — set_current_step 6, then 8, then 7 (meta_orchestrator.py:
// Reproducibility, Discovery Analysis, Comparative Report). Two consequences, both of which were
// live bugs in the component this replaces:
//
//   1. Do NOT iterate a 1..totalSteps numeric range. With no genes the meta list is [1,4,5,6,8,7]:
//      totalSteps is 6 while the step numbers reach 8, so a range invents "Step 2"/"Step 3"
//      placeholders for the skipped gene steps, never renders Discovery Analysis or Comparative
//      Report at all, and leaves a currentStep of 7 or 8 matching no node — nothing ever active.
//   2. Do NOT sort by step number, and do NOT decide status by comparing step numbers. Numerically,
//      Comparative Report (7) sorts before Discovery Analysis (8), so while Discovery is running
//      Comparative would render as COMPLETED before it had run, and when Comparative started
//      Discovery would flip back to PENDING with the active marker moving BACKWARDS.
//
// So both the order and the status are positional: the INDEX of currentStep within the declared
// array decides what is completed. Nothing in ipsa-llm-service needs to change for this to be right.

// [{step, name, message, status: 'completed' | 'active' | 'pending' | 'failed'}] in render order.
//
// `stepsInfo` empty (or not an array) falls back to `totalSteps` generic placeholders, which is the
// real first-render state: the wizard seeds totalSteps 6 with no stepsInfo and only learns the true
// list on the first poll.
export const pipelineStepNodes = (
    stepsInfo,
    {totalSteps = 6, currentStep = 0, status = 'running'} = {}
) => {
    const declared = Array.isArray(stepsInfo) ? stepsInfo : [];

    const seen = new Set();
    const steps = [];
    declared.forEach((entry) => {
        const step = entry && entry.step;
        // A duplicate step number would render two nodes that the same currentStep resolves to, so
        // the first declaration wins — consistent with the array being the execution record.
        if (!Number.isFinite(step) || seen.has(step)) return;
        seen.add(step);
        steps.push({
            step,
            name: entry.name || `Step ${step}`,
            message: entry.message || ''
        });
    });

    if (steps.length === 0) {
        const count = Number.isFinite(totalSteps) && totalSteps > 0 ? Math.floor(totalSteps) : 0;
        for (let n = 1; n <= count; n += 1) {
            steps.push({step: n, name: `Step ${n}`, message: ''});
        }
    }

    const activeIndex = resolveActiveIndex(steps, currentStep);

    return steps.map((entry, index) => ({
        ...entry,
        status: stepStatus(index, activeIndex, status)
    }));
};

// Where currentStep sits in the declared list. Falls back to treating it as a 1-based POSITION when
// the list does not declare it — which is exactly the placeholder case, where step number and
// position coincide. Clamped, so a currentStep past the end cannot mark every node completed by
// being greater than all of them.
const resolveActiveIndex = (steps, currentStep) => {
    if (!Number.isFinite(currentStep) || currentStep <= 0 || steps.length === 0) return -1;
    const declaredIndex = steps.findIndex((entry) => entry.step === currentStep);
    if (declaredIndex >= 0) return declaredIndex;
    return Math.min(currentStep - 1, steps.length - 1);
};

const stepStatus = (index, activeIndex, status) => {
    if (index === activeIndex) return status === 'failed' ? 'failed' : 'active';
    return index < activeIndex ? 'completed' : 'pending';
};

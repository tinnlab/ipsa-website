import assert from "assert";
import {
    computePlotDisplayState,
    computeFetchedPlotState,
    PLOT_STATE_MESSAGES,
} from "../imports/utils/plotDisplayState";

// A "fully ready" baseline; individual tests override fields to exercise each branch.
const ready = {
    isLoadingData: false,
    loadingDEGenes: false,
    result: [{pathway: "p1"}],
    DEGenes: [{_id: "g1", symbol: "G1"}],
    pathwaysResolved: true,
    selectedPathwaysForDb: ["p1"],
    inputGenesPathways: [{id: 0, type: "pathway"}, {id: 1, type: "gene"}],
};

describe("computePlotDisplayState (loading vs no-data for Circos & siblings)", function () {
    it("returns 'ready' when everything has loaded and there is data", function () {
        assert.strictEqual(computePlotDisplayState(ready), "ready");
    });

    it("returns 'loading' while the method-results / chart fetch is in flight", function () {
        assert.strictEqual(computePlotDisplayState({...ready, isLoadingData: true}), "loading");
    });

    it("returns 'loading' while DE genes are still being derived", function () {
        // Even though DEGenes is momentarily empty, we must NOT say "no DE genes" yet.
        assert.strictEqual(
            computePlotDisplayState({...ready, loadingDEGenes: true, DEGenes: []}),
            "loading"
        );
    });

    it("BLINK GUARD: pathways selected but chart not built yet => 'loading', not 'no-pathways'", function () {
        // This is the exact window that caused the "No significant pathway" flash:
        // loads have settled, pathways ARE selected, but inputGenesPathways is not
        // built yet. It must read as loading.
        const state = computePlotDisplayState({
            ...ready,
            isLoadingData: false,
            loadingDEGenes: false,
            inputGenesPathways: [],
        });
        assert.strictEqual(state, "loading");
    });

    it("returns 'loading' when result is in but its pathways are not resolved yet", function () {
        assert.strictEqual(
            computePlotDisplayState({...ready, pathwaysResolved: false, selectedPathwaysForDb: [], inputGenesPathways: []}),
            "loading"
        );
    });

    it("returns 'no-de-genes' when there are genuinely no DE genes", function () {
        assert.strictEqual(computePlotDisplayState({...ready, DEGenes: []}), "no-de-genes");
    });

    it("returns 'no-result' when the method produced no result", function () {
        assert.strictEqual(computePlotDisplayState({...ready, result: []}), "no-result");
    });

    it("returns 'no-pathways' only after pathways are resolved and none are significant", function () {
        const state = computePlotDisplayState({
            ...ready,
            pathwaysResolved: true,
            selectedPathwaysForDb: [],
            inputGenesPathways: [],
        });
        assert.strictEqual(state, "no-pathways");
    });

    it("prefers 'no-de-genes' over 'no-result' when both are empty (matches the original cascade)", function () {
        // Pins the precedence: with neither DE genes nor a method result, the
        // root-cause message (no DE genes) wins — the pre-existing behaviour.
        const state = computePlotDisplayState({...ready, DEGenes: [], result: []});
        assert.strictEqual(state, "no-de-genes");
    });

    it("exposes a human-readable message for each non-loading, non-ready state", function () {
        assert.ok(PLOT_STATE_MESSAGES["no-de-genes"]);
        assert.ok(PLOT_STATE_MESSAGES["no-result"]);
        assert.ok(PLOT_STATE_MESSAGES["no-pathways"]);
    });

    it("must be fed the nodes INCLUDING pathways, so a tight gene target never reads as loading", function () {
        // The Circos gene target caps GENE nodes but never drops pathway nodes, so the array
        // handed to this helper stays non-empty however aggressive the target is. If a future
        // refactor passed only the surviving gene nodes, an aggressive target would flip the
        // pane back to 'loading' and hide the very control needed to recover.
        const pathwaysOnly = [{id: 0, type: "pathway"}];
        assert.strictEqual(
            computePlotDisplayState({...ready, inputGenesPathways: pathwaysOnly}),
            "ready",
            "pathway nodes alone are still a built chart, not a loading state"
        );
    });

    it("does not throw on empty/default input and reports loading", function () {
        // Defaults: nothing loaded -> DEGenes empty but no loading flag set.
        // With all-empty defaults it should not crash and should resolve to a
        // deterministic state.
        const state = computePlotDisplayState();
        assert.ok(["loading", "no-de-genes"].includes(state));
    });
});

// ---------------------------------------------------------------------------------------------
// computeFetchedPlotState — the KEGG / Forest / Neg-bar panes.
//
// Each of those panes computes its own `hasData` (their emptiness tests genuinely differ), so this
// helper owns only the precedence. The rule worth testing is the one the old code got wrong: a
// swallowed fetch error rendered the same "no significant pathways" copy as a real empty result,
// which is precisely why the false negative went unreported.
// ---------------------------------------------------------------------------------------------

describe("computeFetchedPlotState (fetch-backed pathway panes)", function () {
    it("'loading' outranks everything, so no no-data verdict fires mid-flight", function () {
        assert.strictEqual(computeFetchedPlotState({loading: true}), "loading");
        assert.strictEqual(
            computeFetchedPlotState({loading: true, failed: true, hasData: false}),
            "loading"
        );
        assert.strictEqual(
            computeFetchedPlotState({loading: true, failed: false, hasData: true}),
            "loading"
        );
    });

    it("renders the data when a fetch failed but we still have something to show", function () {
        // A transient failure must not blank a pane that already has a usable selection.
        assert.strictEqual(
            computeFetchedPlotState({loading: false, failed: true, hasData: true}),
            "ready"
        );
    });

    it("says 'load-failed', NOT 'no-pathways', when a fetch failed and left nothing", function () {
        assert.strictEqual(
            computeFetchedPlotState({loading: false, failed: true, hasData: false}),
            "load-failed"
        );
    });

    it("says 'no-pathways' only for a settled, successful, genuinely empty result", function () {
        assert.strictEqual(
            computeFetchedPlotState({loading: false, failed: false, hasData: false}),
            "no-pathways"
        );
    });

    it("distinguishes the two empty states by MESSAGE, not just by state name", function () {
        const failed = computeFetchedPlotState({failed: true, hasData: false});
        const empty = computeFetchedPlotState({failed: false, hasData: false});
        assert.notStrictEqual(PLOT_STATE_MESSAGES[failed], PLOT_STATE_MESSAGES[empty]);
        assert.ok(PLOT_STATE_MESSAGES[failed]);
        assert.ok(PLOT_STATE_MESSAGES[empty]);
    });

    it("defaults to 'no-pathways' when called with nothing", function () {
        assert.strictEqual(computeFetchedPlotState(), "no-pathways");
        assert.strictEqual(computeFetchedPlotState({}), "no-pathways");
    });

    it("every non-ready state it can return has a message", function () {
        const states = new Set();
        for (const loading of [true, false]) {
            for (const failed of [true, false]) {
                for (const hasData of [true, false]) {
                    states.add(computeFetchedPlotState({loading, failed, hasData}));
                }
            }
        }
        assert.deepStrictEqual(
            [...states].sort(),
            ["load-failed", "loading", "no-pathways", "ready"]
        );
        for (const state of states) {
            if (state === "ready" || state === "loading") continue;
            assert.ok(PLOT_STATE_MESSAGES[state], `no message for '${state}'`);
        }
    });
});

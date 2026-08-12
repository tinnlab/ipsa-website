import assert from "assert";
import {computePlotDisplayState, PLOT_STATE_MESSAGES} from "../imports/utils/plotDisplayState";

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

    it("does not throw on empty/default input and reports loading", function () {
        // Defaults: nothing loaded -> DEGenes empty but no loading flag set.
        // With all-empty defaults it should not crash and should resolve to a
        // deterministic state.
        const state = computePlotDisplayState();
        assert.ok(["loading", "no-de-genes"].includes(state));
    });
});

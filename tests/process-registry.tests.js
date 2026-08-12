// Unit tests for the R-process registry that backs analysis cancellation (Bug 1).
// Pure (only depends on Node's async_hooks via the module) — server-only.
import assert from "assert";
import {
    register,
    unregister,
    killAll,
    runningCount,
    markCancelled,
    consumeCancelled,
    clearCancelled,
} from "../server/include/processRegistry";

const fakeChild = () => {
    const signals = [];
    return {
        signals,
        kill(sig) { signals.push(sig); },
        // no numeric pid → killAll skips the process-group branch
    };
};

describe("processRegistry (Bug 1: analysis cancellation)", function () {
    it("registers and counts children per analysisId", function () {
        const a = "reg-A";
        assert.strictEqual(runningCount(a), 0);
        const c1 = fakeChild();
        const c2 = fakeChild();
        register(a, c1);
        register(a, c2);
        assert.strictEqual(runningCount(a), 2);
        unregister(a, c1);
        assert.strictEqual(runningCount(a), 1);
    });

    it("isolates children across different analyses", function () {
        register("reg-B", fakeChild());
        register("reg-C", fakeChild());
        assert.strictEqual(runningCount("reg-B"), 1);
        assert.strictEqual(runningCount("reg-C"), 1);
        killAll("reg-B");
        assert.strictEqual(runningCount("reg-B"), 0);
        assert.strictEqual(runningCount("reg-C"), 1);
    });

    it("killAll signals every registered child and clears them", function () {
        const a = "reg-kill";
        const c1 = fakeChild();
        const c2 = fakeChild();
        register(a, c1);
        register(a, c2);
        const killed = killAll(a);
        assert.strictEqual(killed, 2);
        assert.ok(c1.signals.includes("SIGTERM"));
        assert.ok(c2.signals.includes("SIGTERM"));
        assert.strictEqual(runningCount(a), 0);
    });

    it("killAll on an unknown analysis is a no-op returning 0", function () {
        assert.strictEqual(killAll("never-registered"), 0);
    });

    it("ignores missing analysisId / child", function () {
        register(undefined, fakeChild()); // should not throw
        register("reg-D", null); // should not throw
        assert.strictEqual(runningCount("reg-D"), 0);
    });

    it("consumeCancelled returns true once then clears the flag", function () {
        const a = "reg-cancel";
        assert.strictEqual(consumeCancelled(a), false);
        markCancelled(a);
        assert.strictEqual(consumeCancelled(a), true);
        assert.strictEqual(consumeCancelled(a), false);
    });

    it("clearCancelled drops a stale flag so a later run is not misreported", function () {
        const a = "reg-stale";
        // Cancel issued while nothing was running leaves a stale flag...
        markCancelled(a);
        // ...a fresh run clears it at entry...
        clearCancelled(a);
        // ...so a genuine failure later is NOT seen as a cancellation.
        assert.strictEqual(consumeCancelled(a), false);
    });
});

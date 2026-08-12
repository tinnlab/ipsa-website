import {AsyncLocalStorage} from "async_hooks";

// AsyncLocalStorage carrying the current analysis context (analysisId) through
// all awaited calls of a running analysis. This lets rEval() associate the R
// child processes it spawns with the analysis that started them, WITHOUT
// threading analysisId through every helper signature, and it stays correct
// when several analyses run concurrently in the same Node process.
export const analysisContext = new AsyncLocalStorage();

// analysisId -> Set<ChildProcess>
const registry = new Map();

export const register = (analysisId, child) => {
    if (!analysisId || !child) return;
    let set = registry.get(analysisId);
    if (!set) {
        set = new Set();
        registry.set(analysisId, set);
    }
    set.add(child);
};

export const unregister = (analysisId, child) => {
    if (!analysisId) return;
    const set = registry.get(analysisId);
    if (!set) return;
    set.delete(child);
    if (set.size === 0) registry.delete(analysisId);
};

const killChild = (child) => {
    // SIGTERM first, then SIGKILL shortly after in case it ignores the term.
    // rEval spawns its children detached (own process group), so when a numeric
    // pid is present we also signal the whole group (negative pid) — that kills
    // the underlying Rscript, not just the conda/shell wrapper.
    const signalAll = (signal) => {
        try { child.kill(signal); } catch (e) { /* already exited */ }
        if (typeof child.pid === "number") {
            try { process.kill(-child.pid, signal); } catch (e) { /* no group / already gone */ }
        }
    };
    signalAll("SIGTERM");
    setTimeout(() => signalAll("SIGKILL"), 2000);
};

// Kill every R process registered for an analysis. Returns how many were killed.
export const killAll = (analysisId) => {
    const set = registry.get(analysisId);
    if (!set) return 0;
    const children = [...set];
    children.forEach(killChild);
    registry.delete(analysisId);
    return children.length;
};

export const runningCount = (analysisId) => registry.get(analysisId)?.size ?? 0;

// Tracks analyses that were explicitly cancelled, so the analysis pipeline's
// error handler can tell a user cancellation apart from a genuine failure
// (killing the R process makes the awaiting rEval reject).
const cancelled = new Set();

export const markCancelled = (analysisId) => {
    if (analysisId) cancelled.add(analysisId);
};

// Returns true once if the analysis was cancelled, then clears the flag.
export const consumeCancelled = (analysisId) => {
    if (cancelled.has(analysisId)) {
        cancelled.delete(analysisId);
        return true;
    }
    return false;
};

// Drop any pending cancel flag for an analysis. Call this when a fresh run
// starts so a stale flag (e.g. a cancel issued while nothing was running) can
// never be misattributed to a later genuine failure.
export const clearCancelled = (analysisId) => {
    cancelled.delete(analysisId);
};

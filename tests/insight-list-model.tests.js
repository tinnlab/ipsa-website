import assert from "assert";
import {
    firstPanelKeys,
    insightItemModel,
    resolveViewInsight,
    resolveExitWizard,
    reportHeaderModel,
} from "../imports/utils/insightListModel";

describe("insightListModel", function () {
    describe("firstPanelKeys", function () {
        it("returns [] for empty/null", function () {
            assert.deepStrictEqual(firstPanelKeys([]), []);
            assert.deepStrictEqual(firstPanelKeys(null), []);
        });

        it("returns just the first key for one item", function () {
            assert.deepStrictEqual(firstPanelKeys([{ key: "KEGG" }]), ["KEGG"]);
        });

        it("returns ONLY the first key when there are several", function () {
            const items = [{ key: "KEGG" }, { key: "GO" }, { key: "Reactome" }];
            assert.deepStrictEqual(firstPanelKeys(items), ["KEGG"]);
        });
    });

    describe("insightItemModel", function () {
        it("normalizes a batch document", function () {
            const m = insightItemModel({
                _id: "x1",
                insightName: "My report",
                status: "completed",
                createdAt: 123,
                workflowType: "publication-ready",
            });
            assert.deepStrictEqual(m, {
                id: "x1",
                title: "My report",
                statusKey: "completed",
                createdAt: 123,
            });
        });

        it("never exposes a publication-ready flag (redundant tag removed)", function () {
            const m = insightItemModel({ _id: "x", workflowType: "publication-ready", status: "completed" });
            assert.ok(!("workflowType" in m));
            assert.ok(!("publicationReady" in m));
            assert.ok(!Object.values(m).includes("publication-ready"));
        });

        it("falls back to defaults for missing fields", function () {
            const m = insightItemModel({ _id: "y" });
            assert.strictEqual(m.title, "Untitled report");
            assert.strictEqual(m.statusKey, "completed");
        });

        it("falls back to defaults for empty-string name/status too", function () {
            const m = insightItemModel({ _id: "z", insightName: "", status: "", createdAt: 7 });
            assert.strictEqual(m.title, "Untitled report");
            assert.strictEqual(m.statusKey, "completed");
            assert.strictEqual(m.createdAt, 7);
        });

        it("tolerates an undefined batch", function () {
            const m = insightItemModel(undefined);
            assert.strictEqual(m.title, "Untitled report");
            assert.strictEqual(m.statusKey, "completed");
        });
    });

    describe("resolveViewInsight", function () {
        it("lifts to onViewInsight when provided (full-width parent path)", function () {
            const calls = [];
            const setView = (v) => calls.push(["setView", v]);
            const setSelectedInsight = (b) => calls.push(["setSelectedInsight", b]);
            const onViewInsight = (b) => calls.push(["onViewInsight", b]);
            resolveViewInsight("batch7", { onViewInsight, setView, setSelectedInsight });
            assert.deepStrictEqual(calls, [["onViewInsight", "batch7"]]);
        });

        it("falls back to the internal viewer when no callback is provided", function () {
            const calls = [];
            const setView = (v) => calls.push(["setView", v]);
            const setSelectedInsight = (b) => calls.push(["setSelectedInsight", b]);
            resolveViewInsight("batch7", { setView, setSelectedInsight });
            assert.deepStrictEqual(calls, [
                ["setSelectedInsight", "batch7"],
                ["setView", "viewer"],
            ]);
        });

        it("sets only the viewer state that is provided in the fallback path", function () {
            const calls = [];
            resolveViewInsight("b7", { setView: (v) => calls.push(["setView", v]) }); // no setSelectedInsight
            assert.deepStrictEqual(calls, [["setView", "viewer"]]);
        });

        it("does not throw when handlers are missing", function () {
            assert.doesNotThrow(() => resolveViewInsight("b", {}));
            assert.doesNotThrow(() => resolveViewInsight("b"));
        });
    });

    describe("resolveExitWizard", function () {
        it("hands back to the host when provided, and never shows the wizard's own dashboard", function () {
            const calls = [];
            resolveExitWizard({
                onExitWizard: () => calls.push(["onExitWizard"]),
                setView: (v) => calls.push(["setView", v]),
            });
            assert.deepStrictEqual(calls, [["onExitWizard"]]);
        });

        it("falls back to the internal dashboard when no host owns the list", function () {
            const calls = [];
            resolveExitWizard({ setView: (v) => calls.push(["setView", v]) });
            assert.deepStrictEqual(calls, [["setView", "dashboard"]]);
        });

        it("does not throw when handlers are missing", function () {
            assert.doesNotThrow(() => resolveExitWizard({}));
            assert.doesNotThrow(() => resolveExitWizard());
        });

        // Same seam, same rule as viewing — the two directions must not disagree about who owns
        // the reports list.
        it("mirrors resolveViewInsight: a host callback always wins over the internal view", function () {
            const seen = [];
            resolveViewInsight("b1", { onViewInsight: () => seen.push("host-view"), setView: () => seen.push("internal") });
            resolveExitWizard({ onExitWizard: () => seen.push("host-exit"), setView: () => seen.push("internal") });
            assert.deepStrictEqual(seen, ["host-view", "host-exit"]);
        });
    });

    describe("reportHeaderModel", function () {
        const batch = {
            _id: "b1",
            insightName: "Hypoxia signature v3",
            analysisName: "Tumor vs Normal",
        };

        it("names the report, its analysis and its study", function () {
            assert.deepStrictEqual(
                reportHeaderModel({ batch, studyName: "Study A", analysisName: "Tumor vs Normal" }),
                { reportTitle: "Hypoxia signature v3", studyName: "Study A", analysisName: "Tumor vs Normal" }
            );
        });

        it("shows the SAME title the list item shows", function () {
            assert.strictEqual(reportHeaderModel({ batch }).reportTitle, insightItemModel(batch).title);
        });

        it("prefers a host-supplied name, so a rename shows without a reload", function () {
            const m = reportHeaderModel({ batch, reportName: "Renamed after the fact" });
            assert.strictEqual(m.reportTitle, "Renamed after the fact");
        });

        it("falls back to the batch's own name, then to 'Untitled report'", function () {
            assert.strictEqual(reportHeaderModel({ batch }).reportTitle, "Hypoxia signature v3");
            assert.strictEqual(reportHeaderModel({ batch: { _id: "x" } }).reportTitle, "Untitled report");
            assert.strictEqual(reportHeaderModel({}).reportTitle, "Untitled report");
            assert.strictEqual(reportHeaderModel().reportTitle, "Untitled report");
        });

        it("never falls back to a generic placeholder in place of the real name", function () {
            // The viewer used to read insightName off the wrong level of the getBatchStatus
            // response, so every report was titled "Analysis Insight". Nothing here produces it.
            const values = Object.values(reportHeaderModel({ batch, studyName: "S", analysisName: "A" }));
            assert.ok(!values.includes("Analysis Insight"));
        });

        it("falls back to the analysis name denormalized on the batch", function () {
            assert.strictEqual(reportHeaderModel({ batch }).analysisName, "Tumor vs Normal");
        });

        it("returns empty strings for segments it cannot name, so the breadcrumb can drop them", function () {
            const m = reportHeaderModel({ batch: { _id: "x", insightName: "R" } });
            assert.strictEqual(m.studyName, "");
            assert.strictEqual(m.analysisName, "");
        });
    });
});

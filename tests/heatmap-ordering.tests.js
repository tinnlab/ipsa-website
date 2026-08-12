import assert from "assert";
import {
    buildColumnOrder,
    buildRowOrder,
    buildDisplayOrder,
    buildPositionMap,
    remapPlotPoint,
    remapMarkPoint,
    remapScatterPoint,
    buildMetadataPlotData,
    buildAxisLabels,
    defaultParseSortValue,
} from "../imports/utils/heatmapOrdering";
import { parseLeadingNumber } from "../imports/utils/metadataValues";

// --- Fixture -------------------------------------------------------------------------------
// Four columns whose ORIGINAL order, METADATA-VALUE order, and CLUSTERING order all disagree,
// and one of which is the meta-analysis column. Index 3 ("meta-1_meta") is the meta column.
// `mGy Exposure` is a numeric-parsed field; `Sex` is categorical; `Return` normalizes to hours.
//   origIdx  method       mGy   Sex   Return
//   0        OSD-A_ora    30    F     0        (0 hr)
//   1        OSD-B_ora    10    M     1 days   (24 hr)
//   2        OSD-C_ora    20    F     3.5 hr   (3.5 hr)
//   3        meta-1_meta  (meta column — no metadata entry)
const analysisMethods = ["OSD-A_ora", "OSD-B_ora", "OSD-C_ora", "meta-1_meta"];
const metadataConfig = {
    "OSD-A": { "mGy Exposure": "30", Sex: "F", Return: "0" },
    "OSD-B": { "mGy Exposure": "10", Sex: "M", Return: "1 days" },
    "OSD-C": { "mGy Exposure": "20", Sex: "F", Return: "3.5 hr" },
    // "meta-1" intentionally has no metadata entry
};
const metadataFields = ["mGy Exposure", "Sex", "Return"];
// meta column := methods ending in _meta (mirrors the component's isMetaColumn predicate)
const isMetaColumn = (method) => method.includes("_meta");

const metaLast = ["OSD-A_ora", "OSD-B_ora", "OSD-C_ora", "meta-1_meta"];

describe("heatmapOrdering", function () {
    describe("defaultParseSortValue", function () {
        it("parses Return into hours (days -> *24, hr as-is, 0)", function () {
            assert.strictEqual(defaultParseSortValue("Return", "0"), 0);
            assert.strictEqual(defaultParseSortValue("Return", "3.5 hr"), 3.5);
            assert.strictEqual(defaultParseSortValue("Return", "1 days"), 24);
        });
        it("parses numeric-with-unit fields into their leading number", function () {
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "8.97"), 8.97);
            assert.strictEqual(defaultParseSortValue("Radio Sensitivity", "5"), 5);
        });
        it("keeps other fields as their raw string (Age/Sex/Strain sort alphabetically)", function () {
            // Faithful to the original component: only the three fields above are numeric-parsed.
            assert.strictEqual(defaultParseSortValue("Sex", "F"), "F");
            assert.strictEqual(defaultParseSortValue("Age", "16 w weeks"), "16 w weeks");
        });
    });

    describe("buildColumnOrder", function () {
        const base = {
            analysisMethods,
            metadataConfig,
            isMetaColumn,
            metadataSortOrder: "asc",
        };

        it("is identity-with-meta-last when nothing reorders it", function () {
            const order = buildColumnOrder({ ...base, analysisOrder: [], showMetadata: false });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), metaLast);
        });

        it("applies the clustering permutation, keeping meta last", function () {
            // cluster puts C, A, B, meta -> meta still forced to the end
            const order = buildColumnOrder({ ...base, analysisOrder: [2, 0, 1, 3], showMetadata: false });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), [
                "OSD-C_ora",
                "OSD-A_ora",
                "OSD-B_ora",
                "meta-1_meta",
            ]);
        });

        it("keeps meta LAST when metadata is shown (Bug 2: meta must not jump to the left)", function () {
            const order = buildColumnOrder({ ...base, analysisOrder: [], showMetadata: true });
            assert.strictEqual(analysisMethods[order[order.length - 1]], "meta-1_meta");
        });

        it("keeps meta LAST regardless of showMetadata (Bug 2 stability across the toggle)", function () {
            const off = buildColumnOrder({ ...base, analysisOrder: [], showMetadata: false });
            const on = buildColumnOrder({ ...base, analysisOrder: [], showMetadata: true });
            assert.strictEqual(analysisMethods[off[off.length - 1]], "meta-1_meta");
            assert.strictEqual(analysisMethods[on[on.length - 1]], "meta-1_meta");
        });

        it("sorts regular columns by a numeric metadata field asc, meta still last", function () {
            // mGy asc: B(10), C(20), A(30), then meta
            const order = buildColumnOrder({
                ...base,
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
                metadataSortOrder: "asc",
            });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), [
                "OSD-B_ora",
                "OSD-C_ora",
                "OSD-A_ora",
                "meta-1_meta",
            ]);
        });

        it("reverses the regular block for descending, meta still last", function () {
            const order = buildColumnOrder({
                ...base,
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
                metadataSortOrder: "desc",
            });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), [
                "OSD-A_ora",
                "OSD-C_ora",
                "OSD-B_ora",
                "meta-1_meta",
            ]);
        });

        it("sorts by a Return field via hour-normalization (0 < 3.5hr < 1day)", function () {
            // Return hours: A=0, C=3.5, B=24 -> asc order A, C, B, meta
            const order = buildColumnOrder({
                ...base,
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "Return",
                metadataSortOrder: "asc",
            });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), [
                "OSD-A_ora",
                "OSD-C_ora",
                "OSD-B_ora",
                "meta-1_meta",
            ]);
        });

        it("ignores sortByMetadata when metadata is not shown (Bug 3: stale sort field stays inert)", function () {
            const order = buildColumnOrder({
                ...base,
                analysisOrder: [],
                showMetadata: false,
                sortByMetadata: "mGy Exposure", // latent stale value after unchecking metadata
            });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), metaLast);
        });

        it("falls back to identity when the clustering order length mismatches", function () {
            const order = buildColumnOrder({ ...base, analysisOrder: [0, 1], showMetadata: false });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), metaLast);
        });
    });

    describe("buildRowOrder", function () {
        it("returns identity when there is no clustering order", function () {
            assert.deepStrictEqual(buildRowOrder({ pathwayCount: 3, pathwayOrder: [] }), [0, 1, 2]);
        });
        it("honors a valid same-length permutation", function () {
            assert.deepStrictEqual(buildRowOrder({ pathwayCount: 3, pathwayOrder: [2, 0, 1] }), [2, 0, 1]);
        });
        it("falls back to identity on a length mismatch (Bug 3: stale clustering order after re-sort)", function () {
            // pathwayOrder left over from a run with 5 pathways; current run has 3.
            assert.deepStrictEqual(buildRowOrder({ pathwayCount: 3, pathwayOrder: [4, 3, 2, 1, 0] }), [0, 1, 2]);
        });
        it("falls back to identity when the order is not a real permutation", function () {
            assert.deepStrictEqual(buildRowOrder({ pathwayCount: 3, pathwayOrder: [0, 0, 1] }), [0, 1, 2]);
        });
    });

    describe("buildPositionMap", function () {
        it("inverts a permutation (posMap[order[i]] === i)", function () {
            const order = [2, 0, 1, 3];
            const posMap = buildPositionMap(order);
            order.forEach((orig, display) => assert.strictEqual(posMap[orig], display));
        });
        it("marks absent original indices as -1", function () {
            const posMap = buildPositionMap([0, 2]); // index 1 absent
            assert.strictEqual(posMap[1], -1);
        });
    });

    describe("remapPlotPoint / remapMarkPoint", function () {
        const colPosMap = buildPositionMap([2, 0, 1, 3]); // original -> display column
        const rowPosMap = buildPositionMap([1, 0, 2]); //     original -> display row

        it("remaps column and row with no metadata offset", function () {
            const p = remapPlotPoint([0, 0, 5, 0.01, 2], colPosMap, rowPosMap, 0, false);
            assert.deepStrictEqual(p, [1, 1, 5, 0.01, 2]); // col 0->1, row 0->1
        });

        it("adds metadataRowCount to the ROW only when metadata is shown", function () {
            const p = remapPlotPoint([0, 0, 5, 0.01, 2], colPosMap, rowPosMap, 3, true);
            assert.deepStrictEqual(p, [1, 1 + 3, 5, 0.01, 2]); // column unchanged, row offset by 3
        });

        it("remaps a markpoint the same way, preserving its style + info payload", function () {
            const mp = { xAxis: 3, yAxis: 2, symbolSize: 8, itemStyle: { color: "#FFB84D" }, pValueFDR: 0.002, score: -1.5 };
            const out = remapMarkPoint(mp, colPosMap, rowPosMap, 3, true);
            assert.strictEqual(out.xAxis, 3); // col 3 -> display 3 (rightmost, the meta column)
            assert.strictEqual(out.yAxis, 2 + 3); // row 2 -> display 2, + metadata offset
            assert.deepStrictEqual(out.itemStyle, { color: "#FFB84D" });
            // FDR + score ride along so the dot's tooltip works on non-significant cells.
            assert.strictEqual(out.pValueFDR, 0.002);
            assert.strictEqual(out.score, -1.5);
        });

        it("DROPS a point whose row can't be placed (Bug 1: no -1 + offset onto metadata rows)", function () {
            const stale = buildPositionMap([0, 1]); // only rows 0,1 exist
            assert.strictEqual(remapPlotPoint([0, 9, 5, 0.01, 2], colPosMap, stale, 3, true), null);
            assert.strictEqual(remapMarkPoint({ xAxis: 0, yAxis: 9 }, colPosMap, stale, 3, true), null);
        });

        it("DROPS a point whose column can't be placed", function () {
            const stale = buildPositionMap([0, 1]); // only cols 0,1 exist
            assert.strictEqual(remapPlotPoint([9, 0, 5, 0.01, 2], stale, rowPosMap, 0, false), null);
        });
    });

    // Scatter is the primary way the effect-magnitude circles are drawn (EFFECT_MAGNITUDE_MODE).
    // Unlike a markpoint, its datum carries `value: [col, row]` so it shares the cells' coordinate
    // system — which is what keeps dots off the metadata rows and makes non-significant cells
    // hoverable. These tests lock in that placement contract.
    describe("remapScatterPoint", function () {
        const colPosMap = buildPositionMap([2, 0, 1, 3]); // original -> display column
        const rowPosMap = buildPositionMap([1, 0, 2]); //     original -> display row

        it("emits value [col, row] with no offset when metadata is hidden", function () {
            const out = remapScatterPoint({ xAxis: 0, yAxis: 0 }, colPosMap, rowPosMap, 0, false);
            assert.deepStrictEqual(out.value, [1, 1]); // col 0->1, row 0->1, no offset
        });

        it("adds metadataRowCount to the ROW only, keeping the column, when metadata is shown", function () {
            const out = remapScatterPoint({ xAxis: 0, yAxis: 0 }, colPosMap, rowPosMap, 3, true);
            assert.deepStrictEqual(out.value, [1, 1 + 3]); // column unchanged, row offset by 3
        });

        it("preserves symbolSize, itemStyle, and the FDR/score payload (tooltip on non-sig cells)", function () {
            const pt = { xAxis: 3, yAxis: 2, symbolSize: 8, itemStyle: { color: "#7AB3CF" }, pValueFDR: 0.42, score: -1.5 };
            const out = remapScatterPoint(pt, colPosMap, rowPosMap, 3, true);
            assert.deepStrictEqual(out.value, [3, 2 + 3]);
            assert.strictEqual(out.symbolSize, 8);
            assert.deepStrictEqual(out.itemStyle, { color: "#7AB3CF" });
            // 0.42 is a NON-significant FDR: it must still ride along so the dot's tooltip works.
            assert.strictEqual(out.pValueFDR, 0.42);
            assert.strictEqual(out.score, -1.5);
        });

        it("never lands in the metadata band: any placeable row >= metadataRowCount", function () {
            const metadataRowCount = 3;
            // Every original row that HAS a display position must map to a row at or below the band.
            [0, 1, 2].forEach((yAxis) => {
                const out = remapScatterPoint({ xAxis: 0, yAxis }, colPosMap, rowPosMap, metadataRowCount, true);
                assert.ok(out.value[1] >= metadataRowCount, `row ${yAxis} landed in metadata band`);
            });
        });

        it("DROPS an unplaceable point (stale row) instead of -1 + offset onto a metadata row", function () {
            const stale = buildPositionMap([0, 1]); // only rows 0,1 exist
            assert.strictEqual(remapScatterPoint({ xAxis: 0, yAxis: 9 }, colPosMap, stale, 3, true), null);
        });

        it("DROPS an unplaceable point (stale column)", function () {
            const stale = buildPositionMap([0, 1]); // only cols 0,1 exist
            assert.strictEqual(remapScatterPoint({ xAxis: 9, yAxis: 0 }, stale, rowPosMap, 0, false), null);
        });

        it("does not produce a NaN row when metadataRowCount is missing (defensive)", function () {
            const out = remapScatterPoint({ xAxis: 0, yAxis: 0 }, colPosMap, rowPosMap, undefined, true);
            assert.strictEqual(out.value[1], 1); // offset coerced to 0, not NaN
            assert.ok(Number.isInteger(out.value[1]));
        });
    });

    describe("buildMetadataPlotData", function () {
        it("places every metadata cell at its columnOrder display position", function () {
            const columnOrder = buildColumnOrder({
                analysisMethods,
                metadataConfig,
                isMetaColumn,
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
                metadataSortOrder: "asc",
            });
            const { data } = buildMetadataPlotData({
                columnOrder,
                analysisMethods,
                metadataFields,
                metadataConfig,
                getMetadataColor: () => "#123456",
            });
            // For each metadata cell [displayCol, fieldIdx, color, value, field], the value must equal
            // the metadata of whatever original analysis columnOrder maps that display column to.
            data.forEach(([displayCol, fieldIdx, , value, field]) => {
                const origIdx = columnOrder[displayCol];
                const name = analysisMethods[origIdx].split("_")[0];
                assert.strictEqual(field, metadataFields[fieldIdx]);
                assert.strictEqual(value, metadataConfig[name][field] || "");
            });
            // The meta column has no metadata entry, so it contributes no metadata cells.
            const metaDisplayCol = columnOrder.indexOf(3);
            assert.ok(!data.some(([c]) => c === metaDisplayCol));
        });

        it("bakes the resolved color into each cell (index 2) — one color per field:value", function () {
            const columnOrder = [0, 1, 2, 3];
            const { data, colorMap } = buildMetadataPlotData({
                columnOrder,
                analysisMethods,
                metadataFields,
                metadataConfig,
                getMetadataColor: (field, value) => `${field}:${value}`, // deterministic per field:value
            });
            // Index 2 is the color STRING the custom series renders (no encoded numeric code anymore).
            data.forEach(([, fieldIdx, color, value]) =>
                assert.strictEqual(color, `${metadataFields[fieldIdx]}:${value}`)
            );
            // Sex has two distinct values (F, M) among A/B/C -> two distinct colors. Filter by field
            // name only (no dependency on the module's private color-key delimiter).
            const sexColors = new Set(
                Object.keys(colorMap).filter((k) => k.startsWith("Sex")).map((k) => colorMap[k])
            );
            assert.strictEqual(sexColors.size, 2);
        });

        it("shares one color across case/whitespace variants of the same value", function () {
            // Two columns whose Sex differs only by casing/whitespace must get the SAME color.
            const cfg = {
                "OSD-A": { Sex: "female" },
                "OSD-B": { Sex: "Female " },
            };
            const methods = ["OSD-A_ora", "OSD-B_ora"];
            const { data, colorMap } = buildMetadataPlotData({
                columnOrder: [0, 1],
                analysisMethods: methods,
                metadataFields: ["Sex"],
                metadataConfig: cfg,
                // Distinct color per raw value: only shared caching (via a normalized color key)
                // can collapse "female" and "Female " to a single color.
                getMetadataColor: (field, value) => `${field}:${value}`,
            });
            // One color-map entry for Sex despite two casing variants.
            const sexKeys = Object.keys(colorMap).filter((k) => k.startsWith("Sex"));
            assert.strictEqual(sexKeys.length, 1);
            // Both cells render the identical baked color; original values are still preserved.
            const colors = new Set(data.map(([, , color]) => color));
            assert.strictEqual(colors.size, 1);
            assert.deepStrictEqual(data.map(([, , , value]) => value), ["female", "Female "]);
        });

        it("resolves metadata by the exact display name via metadataKeys (names with '_' don't truncate)", function () {
            // metadataConfig is keyed by the full display name, which may contain '_'. Splitting the
            // label on '_' would look up "Tumor" (miss). metadataKeys carries the exact key per column.
            const cfg = { "Tumor_vs_Normal": { Sex: "F" }, "Ctrl": { Sex: "M" } };
            const methods = ["Tumor_vs_Normal", "Ctrl"];

            const withKeys = buildMetadataPlotData({
                columnOrder: [0, 1], analysisMethods: methods, metadataFields: ["Sex"],
                metadataConfig: cfg, metadataKeys: ["Tumor_vs_Normal", "Ctrl"],
                getMetadataColor: () => "#000",
            });
            assert.deepStrictEqual(withKeys.data.map((d) => d[3]), ["F", "M"]);

            // Legacy fallback (no metadataKeys) truncates "Tumor_vs_Normal" -> "Tumor" -> missing, so
            // that column contributes NO metadata cell (only the underscore-free "Ctrl" survives).
            const withoutKeys = buildMetadataPlotData({
                columnOrder: [0, 1], analysisMethods: methods, metadataFields: ["Sex"],
                metadataConfig: cfg, getMetadataColor: () => "#000",
            });
            assert.strictEqual(withoutKeys.data.length, 1);
            assert.strictEqual(withoutKeys.data[0][3], "M");
        });

        it("keeps a legitimate 0 value instead of rendering it as missing", function () {
            const { data } = buildMetadataPlotData({
                columnOrder: [0], analysisMethods: ["X"], metadataFields: ["Dose"],
                metadataConfig: { X: { Dose: 0 } }, getMetadataColor: () => "#000",
            });
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0][3], 0);
        });
    });

    describe("metadata-value sort", function () {
        it("defaultParseSortValue keeps a negative sign for numeric-parsed fields", function () {
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "-5"), -5);
        });

        it("buildColumnOrder sorts a numeric field numerically when given a numeric parseSortValue", function () {
            const numericParse = (field, raw) => {
                const n = parseLeadingNumber(raw);
                return n === null ? "" : n;
            };
            const order = buildColumnOrder({
                analysisMethods: ["a", "b", "c"],
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "Dose",
                metadataSortOrder: "asc",
                metadataConfig: { a: { Dose: "10" }, b: { Dose: "2" }, c: { Dose: "9" } },
                isMetaColumn: () => false,
                parseSortValue: numericParse,
            });
            // Numeric order 2 < 9 < 10 -> b, c, a (NOT lexical "10" < "2" < "9").
            assert.deepStrictEqual(order.map((i) => ["a", "b", "c"][i]), ["b", "c", "a"]);
        });

        it("pushes datasets missing the sort field to the END, in both directions", function () {
            const base = {
                analysisMethods: ["a", "b", "c"],
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "Sex",
                isMetaColumn: () => false,
                // 'b' is missing the Sex field entirely.
                metadataConfig: { a: { Sex: "M" }, b: {}, c: { Sex: "F" } },
            };
            const asc = buildColumnOrder({ ...base, metadataSortOrder: "asc" });
            // asc: F, M, then missing(b) last — NOT b floating to the front as an empty string.
            assert.deepStrictEqual(asc.map((i) => ["a", "b", "c"][i]), ["c", "a", "b"]);

            const desc = buildColumnOrder({ ...base, metadataSortOrder: "desc" });
            // desc: M, F, then missing(b) still last.
            assert.deepStrictEqual(desc.map((i) => ["a", "b", "c"][i]), ["a", "c", "b"]);
        });

        it("sorts by the exact metadata key via metadataKeys (name contains '_')", function () {
            const order = buildColumnOrder({
                analysisMethods: ["X_1", "Y_2"],
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "Sex",
                metadataSortOrder: "asc",
                metadataConfig: { "X_1": { Sex: "M" }, "Y_2": { Sex: "F" } },
                metadataKeys: ["X_1", "Y_2"],
                isMetaColumn: () => false,
            });
            // F < M asc -> Y_2 (F) before X_1 (M). The legacy split would key "X"/"Y" (both miss) and
            // leave the order unsorted.
            assert.deepStrictEqual(order.map((i) => ["X_1", "Y_2"][i]), ["Y_2", "X_1"]);
        });
    });

    // --- The headline anti-desync regressions (prove Bugs 1, 2, 3 together) -----------------
    describe("cross-artifact consistency (anti-desync)", function () {
        // Build ONE column order and derive everything from it, exactly as the component now does.
        const buildScenario = ({ showMetadata, sortByMetadata }) => {
            const columnOrder = buildColumnOrder({
                analysisMethods,
                metadataConfig,
                isMetaColumn,
                analysisOrder: [],
                showMetadata,
                sortByMetadata,
                metadataSortOrder: "asc",
            });
            const pathwayNames = ["P0", "P1"];
            const rowOrder = buildRowOrder({ pathwayCount: pathwayNames.length, pathwayOrder: [] });
            const colPosMap = buildPositionMap(columnOrder);
            const rowPosMap = buildPositionMap(rowOrder);
            const metadataRowCount = showMetadata ? metadataFields.length : 0;
            const labels = buildAxisLabels({
                columnOrder,
                analysisMethods,
                rowOrder,
                pathwayNames,
                metadataFields,
                showMetadata,
            });
            return { columnOrder, colPosMap, rowPosMap, metadataRowCount, labels };
        };

        it("cell, circle, and label agree on the meta column position, and it is rightmost (Bugs 1 & 2)", function () {
            for (const scenario of [
                { showMetadata: false, sortByMetadata: null },
                { showMetadata: true, sortByMetadata: null },
                { showMetadata: true, sortByMetadata: "mGy Exposure" },
            ]) {
                const { columnOrder, colPosMap, rowPosMap, metadataRowCount, labels } = buildScenario(scenario);
                const metaOrig = 3; // meta-1_meta
                const metaDisplayCol = colPosMap[metaOrig];

                // rightmost
                assert.strictEqual(metaDisplayCol, columnOrder.length - 1, JSON.stringify(scenario));
                // label agrees
                assert.strictEqual(labels.xLabels[metaDisplayCol], "meta-1_meta");
                // a pathway cell for meta lands on that same column...
                const cell = remapPlotPoint(
                    [metaOrig, 0, 4, 0.001, 5],
                    colPosMap,
                    rowPosMap,
                    metadataRowCount,
                    scenario.showMetadata
                );
                // ...and so does its circle
                const circle = remapMarkPoint(
                    { xAxis: metaOrig, yAxis: 0 },
                    colPosMap,
                    rowPosMap,
                    metadataRowCount,
                    scenario.showMetadata
                );
                // ...and so does the scatter datum that actually renders it (EFFECT_MAGNITUDE_MODE)
                const scatter = remapScatterPoint(
                    { xAxis: metaOrig, yAxis: 0 },
                    colPosMap,
                    rowPosMap,
                    metadataRowCount,
                    scenario.showMetadata
                );
                assert.strictEqual(cell[0], metaDisplayCol);
                assert.strictEqual(circle.xAxis, metaDisplayCol);
                assert.strictEqual(scatter.value[0], metaDisplayCol);
                // circle sits on the pathway band, never on a metadata row
                assert.ok(circle.yAxis >= metadataRowCount, `circle above metadata band ${JSON.stringify(scenario)}`);
                assert.ok(scatter.value[1] >= metadataRowCount, `scatter above metadata band ${JSON.stringify(scenario)}`);
                assert.strictEqual(cell[1], circle.yAxis); // cell and its circle share the exact row
                // the scatter datum lands on the EXACT same cell as the pathway rect
                assert.deepStrictEqual(scatter.value, [cell[0], cell[1]]);
            }
        });

        it("every remapped cell refers to the same original analysis as its column label (Bug 3)", function () {
            const { columnOrder, colPosMap, rowPosMap, metadataRowCount, labels } = buildScenario({
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
            });
            // Emit a full pathway grid in ORIGINAL order and remap it.
            const pathwayCount = 2;
            const original = [];
            analysisMethods.forEach((_, a) => {
                for (let p = 0; p < pathwayCount; p++) original.push([a, p, a * 10 + p, 0.01, 1]);
            });
            original
                .map((pt) => remapPlotPoint(pt, colPosMap, rowPosMap, metadataRowCount, true))
                .filter(Boolean)
                .forEach((pt) => {
                    const [displayCol, , value] = pt;
                    const origAnalysis = columnOrder[displayCol];
                    // value encodes the original analysis index (a*10 + p); recover `a` and compare
                    // to the label shown at that display column.
                    const recoveredAnalysis = Math.floor(value / 10);
                    assert.strictEqual(recoveredAnalysis, origAnalysis);
                    assert.strictEqual(labels.xLabels[displayCol], analysisMethods[origAnalysis]);
                });
        });
    });

    // --- Hardening added after the multi-angle audit -----------------------------------------
    describe("defaultParseSortValue — hardening", function () {
        it("preserves a leading minus (negative dose/exposure sorts correctly)", function () {
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "-5"), -5);
            assert.strictEqual(defaultParseSortValue("Radio Sensitivity", "-2"), -2);
            assert.strictEqual(defaultParseSortValue("Return", "-2 days"), -48);
        });
        it("treats a minus as a sign only when the number starts the string (ranges/mid-string stay positive)", function () {
            assert.strictEqual(defaultParseSortValue("μg Exposure (Days)", "10-20"), 10); // range lower bound, positive
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "N-3"), 3); // mid-string dash is not a sign
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "-5 mGy"), -5); // leading sign kept
        });
        it("returns 0 (never NaN) for a numeric field with no real number", function () {
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "."), 0);
            assert.strictEqual(defaultParseSortValue("mGy Exposure", "n/a"), 0);
        });
        it("parses μg Exposure (Days): plain number and range (lower bound)", function () {
            assert.strictEqual(defaultParseSortValue("μg Exposure (Days)", "2.5"), 2.5);
            assert.strictEqual(defaultParseSortValue("μg Exposure (Days)", "10-20"), 10);
        });
        it("falls back to the raw string for an unrecognized Return format", function () {
            assert.strictEqual(defaultParseSortValue("Return", "immediately"), "immediately");
        });
    });

    describe("buildColumnOrder — meta detection via original index (display label lost '_meta')", function () {
        // Real-world regression: with a single non-meta method, the component maps each column to a
        // DISPLAY label that drops the method suffix, so the meta column's label ("Meta-1") no longer
        // contains "_meta". Detection must fall back to the raw key via the original index, or the
        // meta column sorts by its (empty) metadata value and drifts off the right edge after a sort.
        const displayLabels = ["OSD-A", "OSD-B", "OSD-C", "Meta-1"]; // index 3 is the meta column
        const rawKeys = ["OSD-A_ora", "OSD-B_ora", "OSD-C_ora", "meta-1_meta"]; // index-aligned
        const cfg = {
            "OSD-A": { "mGy Exposure": "30" },
            "OSD-B": { "mGy Exposure": "10" },
            "OSD-C": { "mGy Exposure": "20" },
            // Meta-1 has a mid-range value so a value-only predicate would sort it into the MIDDLE
            // (not the far right) — demonstrating the drift. Index-based detection still pins it last.
            "Meta-1": { "mGy Exposure": "15" },
        };
        // Mirrors the component: detect meta from the raw key (index-aligned), not the display label.
        const isMetaByIndex = (_label, index) => rawKeys[index].split("_")[1] === "meta";

        it("keeps meta rightmost after a metadata sort when detected via the index (the fix)", function () {
            const order = buildColumnOrder({
                analysisMethods: displayLabels,
                metadataConfig: cfg,
                isMetaColumn: isMetaByIndex,
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
                metadataSortOrder: "asc",
            });
            const ordered = order.map((i) => displayLabels[i]);
            assert.strictEqual(ordered[ordered.length - 1], "Meta-1"); // pinned rightmost
            assert.deepStrictEqual(ordered, ["OSD-B", "OSD-C", "OSD-A", "Meta-1"]);
        });

        it("a value-only predicate on the display label FAILS to pin meta (documents the bug)", function () {
            // The old predicate searched the label for "_meta"; the display label no longer has it,
            // so the meta column is treated as a regular column and sorts by its value (15) into the
            // MIDDLE instead of being pinned rightmost.
            const valueOnly = (label) => label.includes("_meta");
            const order = buildColumnOrder({
                analysisMethods: displayLabels,
                metadataConfig: cfg,
                isMetaColumn: valueOnly,
                analysisOrder: [],
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
                metadataSortOrder: "asc",
            });
            const ordered = order.map((i) => displayLabels[i]);
            assert.notStrictEqual(ordered[ordered.length - 1], "Meta-1"); // NOT pinned -> the bug
        });
    });

    describe("buildColumnOrder — meta forcing is actually exercised", function () {
        // Fixture where the meta column is NOT already last, so meta-forcing is not a no-op.
        const methods = ["m1_meta", "A_ora", "B_ora"];
        const meta = (m) => m.includes("_meta");

        it("moves a not-originally-last meta column to the end (identity input)", function () {
            const order = buildColumnOrder({
                analysisMethods: methods,
                metadataConfig: {},
                isMetaColumn: meta,
                analysisOrder: [],
                showMetadata: false,
            });
            assert.deepStrictEqual(order.map((i) => methods[i]), ["A_ora", "B_ora", "m1_meta"]);
        });

        it("keeps multiple meta columns last, preserving their relative order", function () {
            const m = ["A_ora", "m1_meta", "B_ora", "m2_meta"];
            const order = buildColumnOrder({
                analysisMethods: m,
                metadataConfig: {},
                isMetaColumn: meta,
                analysisOrder: [],
                showMetadata: true,
            });
            assert.deepStrictEqual(order.map((i) => m[i]), ["A_ora", "B_ora", "m1_meta", "m2_meta"]);
        });

        it("lets the metadata-value sort override clustering, with meta still last", function () {
            // Clustering says C,B,A,meta; metadata sort by mGy asc must win -> B,C,A,meta.
            const order = buildColumnOrder({
                analysisMethods,
                metadataConfig,
                isMetaColumn,
                analysisOrder: [2, 1, 0, 3],
                showMetadata: true,
                sortByMetadata: "mGy Exposure",
                metadataSortOrder: "asc",
            });
            assert.deepStrictEqual(order.map((i) => analysisMethods[i]), [
                "OSD-B_ora",
                "OSD-C_ora",
                "OSD-A_ora",
                "meta-1_meta",
            ]);
        });

        it("orders a mixed numeric/string column transitively (numbers before strings)", function () {
            // Return values: A='0'(0), B='immediately'(string), C='3.5 hr'(3.5) -> numbers first.
            const m = ["A_ora", "B_ora", "C_ora"];
            const cfg = { A: { Return: "0" }, B: { Return: "immediately" }, C: { Return: "3.5 hr" } };
            const asc = buildColumnOrder({
                analysisMethods: m, metadataConfig: cfg, isMetaColumn: () => false,
                analysisOrder: [], showMetadata: true, sortByMetadata: "Return", metadataSortOrder: "asc",
            });
            assert.deepStrictEqual(asc.map((i) => m[i]), ["A_ora", "C_ora", "B_ora"]);
        });

        it("sorts a categorical field descending and keeps ties stable", function () {
            // Sex: A=F, B=M, C=F. desc -> M first, then the F's in original (stable) order (A before C).
            const desc = buildColumnOrder({
                analysisMethods, metadataConfig, isMetaColumn: () => false,
                analysisOrder: [], showMetadata: true, sortByMetadata: "Sex", metadataSortOrder: "desc",
            });
            assert.deepStrictEqual(desc.slice(0, 3).map((i) => analysisMethods[i]), [
                "OSD-B_ora", // M
                "OSD-A_ora", // F (original order preserved among ties)
                "OSD-C_ora", // F
            ]);
        });

        it("handles zero columns and an all-meta set", function () {
            assert.deepStrictEqual(
                buildColumnOrder({ analysisMethods: [], metadataConfig: {}, isMetaColumn, analysisOrder: [], showMetadata: false }),
                []
            );
            const allMeta = ["m1_meta", "m2_meta"];
            assert.deepStrictEqual(
                buildColumnOrder({ analysisMethods: allMeta, metadataConfig: {}, isMetaColumn: meta, analysisOrder: [], showMetadata: true })
                    .map((i) => allMeta[i]),
                ["m1_meta", "m2_meta"]
            );
        });

        it("keys metadata off split('_')[0] — documents the multi-underscore assumption", function () {
            // An analysis id containing an underscore resolves its config key to the FIRST token.
            const m = ["GLDS_47_ora"];
            const col = buildColumnOrder({ analysisMethods: m, metadataConfig: { GLDS: { Sex: "F" } }, isMetaColumn: () => false, analysisOrder: [], showMetadata: true, sortByMetadata: "Sex" });
            const built = buildMetadataPlotData({ columnOrder: col, analysisMethods: m, metadataFields: ["Sex"], metadataConfig: { GLDS: { Sex: "F" } }, getMetadataColor: () => "#000" });
            assert.strictEqual(built.data.length, 1); // matched on "GLDS", not "GLDS_47"
            assert.strictEqual(built.data[0][3], "F");
        });
    });

    describe("buildDisplayOrder / buildRowOrder guards", function () {
        it("buildDisplayOrder returns identity for empty/mismatched/non-permutation orders", function () {
            assert.deepStrictEqual(buildDisplayOrder(3, []), [0, 1, 2]);
            assert.deepStrictEqual(buildDisplayOrder(3, [4, 3, 2, 1, 0]), [0, 1, 2]); // wrong length
            assert.deepStrictEqual(buildDisplayOrder(3, [0, 0, 1]), [0, 1, 2]); // not a permutation
        });
        it("buildDisplayOrder honors a valid permutation", function () {
            assert.deepStrictEqual(buildDisplayOrder(3, [2, 0, 1]), [2, 0, 1]);
        });
        it("buildRowOrder(pathwayCount:0) returns []", function () {
            assert.deepStrictEqual(buildRowOrder({ pathwayCount: 0, pathwayOrder: [] }), []);
        });
    });

    describe("buildPositionMap / remap — scale + safety", function () {
        it("does not crash on a large sparse index (no Math.max spread RangeError)", function () {
            const order = [0, 1, 2, 3, 4, 250000];
            const posMap = buildPositionMap(order);
            assert.strictEqual(posMap[250000], 5);
            assert.strictEqual(posMap[0], 0);
        });
        it("drops a point whose index is beyond the position map (out-of-bounds lookup)", function () {
            const pm = buildPositionMap([0, 1, 2]);
            assert.strictEqual(remapPlotPoint([99, 0, 1, 0.1, 1], pm, pm, 0, false), null);
            assert.strictEqual(remapMarkPoint({ xAxis: 99, yAxis: 0 }, pm, pm, 0, false), null);
        });
        it("does not produce a NaN row when metadataRowCount is missing (defensive)", function () {
            const pm = buildPositionMap([0]);
            const p = remapPlotPoint([0, 0, 1, 0.1, 1], pm, pm, undefined, true);
            assert.deepStrictEqual(p, [0, 0, 1, 0.1, 1]); // offset coerced to 0, not NaN
        });
        it("Bug 1 proof: a placeable circle sits on the pathway band while a stale one is dropped", function () {
            const colPm = buildPositionMap([0, 1]);
            const rowPm = buildPositionMap([0, 1]); // only rows 0,1 exist
            const metadataRowCount = 3;
            const placeable = remapMarkPoint({ xAxis: 0, yAxis: 1 }, colPm, rowPm, metadataRowCount, true);
            assert.ok(placeable.yAxis >= metadataRowCount); // lands below the metadata band
            const stale = remapMarkPoint({ xAxis: 0, yAxis: 9 }, colPm, rowPm, metadataRowCount, true);
            assert.strictEqual(stale, null); // NOT -1 + metadataRowCount inside the band
        });
    });

    describe("metadata field subset (Show-metadata-rows selection)", function () {
        // The "which metadata rows to show" control passes a subset of fields to the builders;
        // rows, labels, and the pathway-row offset must all stay consistent with that subset.
        it("renders only the chosen fields, with a matching offset and labels", function () {
            const subset = ["Sex"]; // user chose to show only Sex
            const columnOrder = [0, 1, 2, 3];
            const { data } = buildMetadataPlotData({
                columnOrder,
                analysisMethods,
                metadataFields: subset,
                metadataConfig,
                getMetadataColor: () => "#000",
            });
            // One metadata row (fieldIdx 0 = "Sex") per column that has metadata (A/B/C, not meta).
            assert.ok(data.every(([, fieldIdx, , , field]) => fieldIdx === 0 && field === "Sex"));
            assert.strictEqual(data.length, 3);

            const rowOrder = buildRowOrder({ pathwayCount: 2, pathwayOrder: [] });
            const { yLabels } = buildAxisLabels({
                columnOrder,
                analysisMethods,
                rowOrder,
                pathwayNames: ["P0", "P1"],
                metadataFields: subset,
                showMetadata: true,
            });
            assert.deepStrictEqual(yLabels, ["Sex", "P0", "P1"]); // one metadata row, then pathways

            // Pathway cells are offset by the subset length (1), not the full field count.
            const cell = remapPlotPoint([0, 0, 5, 0.01, 2], buildPositionMap(columnOrder), buildPositionMap(rowOrder), subset.length, true);
            assert.strictEqual(cell[1], 0 + 1);
        });
    });

    describe("buildMetadataPlotData — no color-key collision", function () {
        it("gives distinct codes to the same value under different fields", function () {
            const { data, colorMap } = buildMetadataPlotData({
                columnOrder: [0],
                analysisMethods: ["X_ora"],
                metadataFields: ["mGy Exposure", "Sex"],
                metadataConfig: { X: { "mGy Exposure": "F", Sex: "F" } }, // same value "F", two fields
                getMetadataColor: (f, v) => `${f}|${v}`,
            });
            const codes = new Set(data.map((d) => d[2]));
            assert.strictEqual(codes.size, 2);
            assert.strictEqual(Object.keys(colorMap).length, 2);
        });
    });
});

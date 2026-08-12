import React, {useEffect, useState, useMemo, useRef, useCallback} from "react";
import ReactEcharts from "echarts-for-react";
import EchartsWrapper from './EchartsWrapper';
import * as echarts from 'echarts/core'
import {install as ScatterGLChart} from '/imports/echarts/scatterGL/install';
import {Meteor} from "meteor/meteor";
import fetch2 from "../../../../../utils/fetch";
import {Button, Dropdown, Input, Space, Typography} from "antd";
import {DownOutlined} from "@ant-design/icons";
import AnalysisUtils from "../../Session/components/AnalysisUtils";
import {selectGenesForExport} from "/imports/utils/exportUtils";
import {getGeneVolcanoOptions, displayNameOf} from "/imports/utils/geneVolcanoOptions";
import {classifyGene} from "/imports/utils/volcanoGeneSelect";
import VolcanoGenePicker from "./VolcanoGenePicker";


echarts.use([ScatterGLChart])

export default ({analysisId, sessionId, config, handleChangingDESettings}) => {
    const chartRef = useRef(null);
    const [fcPValueData, setFcPValueData] = useState([]);
    const [nameToIdMap, setNameToIdMap] = useState({});
    // Authoritative gene-symbol map (id -> official symbol) from GeneInfo, the same
    // source the heatmap/CSV export use. `mappedGeneIds` only yields the input
    // identifier (e.g. the raw id for a gene-id upload), so it cannot show a symbol.
    const [symbolMap, setSymbolMap] = useState({});
    // Ephemeral (view-only) view state. `focus` = genes to isolate & highlight;
    // `label` = the subset of focused genes whose names are drawn on the plot;
    // `displayMode` = whether names render as gene symbols or raw ids.
    const [focusGeneIds, setFocusGeneIds] = useState([]);
    const [labelGeneIds, setLabelGeneIds] = useState([]);
    const [displayMode, setDisplayMode] = useState('symbol');
    // Hide the non-focused cloud and rescale the axes to just the focused genes.
    const [hideNonFocused, setHideNonFocused] = useState(false);

    const volcanoPlotData = useMemo(() => {
        if (!fcPValueData || fcPValueData.length === 0) return [];

        return fcPValueData.map(e => ({
            FC: e.FC,
            pValue: config.inputType !== 'expression' ? e.pValue : e.pValueFDR,
            id: e.id,
            // `name` is the gene SYMBOL for display: prefer the authoritative GeneInfo
            // symbol, then any symbol the row already carries, then the input-id map,
            // then the raw id as a last resort.
            name: symbolMap[e.id] || e.symbol || (nameToIdMap && nameToIdMap[e.id]) || e.id
        }));
    }, [fcPValueData, symbolMap, nameToIdMap, config.inputType]);

    const deSettings = useMemo(() => ({
        maxAdjustedPValue: config.maxAdjustedPValue ?? 0.05,
        minLogFoldChange: config.minLogFoldChange ?? 0.5,
    }), [config.maxAdjustedPValue, config.minLogFoldChange]);

    // How many genes pass the current DE filter (up- or down-regulated), out of the
    // total, using the SAME predicate the plot colours with so the count matches the
    // coloured points.
    const deGeneStats = useMemo(() => {
        const total = volcanoPlotData.length;
        const de = volcanoPlotData.reduce(
            (n, g) => (classifyGene(g, deSettings) !== 'nonsig' ? n + 1 : n),
            0
        );
        return {de, total};
    }, [volcanoPlotData, deSettings]);

    // Render each gene's picker/label text per the chosen display mode
    // (same helper the plot uses, so pickers and plot labels always agree).
    const displayName = useCallback((g) => displayNameOf(g, displayMode), [displayMode]);

    // Focus picker options: all genes. Label picker options: only the focused genes
    // (labels are a subset of the focus). Both re-label when the display mode flips.
    const geneOptions = useMemo(
        () => volcanoPlotData.map(g => ({label: displayName(g), value: g.id})),
        [volcanoPlotData, displayName]
    );
    const labelOptions = useMemo(() => {
        const focusSet = new Set(focusGeneIds);
        return volcanoPlotData.filter(g => focusSet.has(g.id)).map(g => ({label: displayName(g), value: g.id}));
    }, [volcanoPlotData, focusGeneIds, displayName]);

    // Changing the focus prunes any labels that are no longer focused.
    const handleFocusChange = useCallback((ids) => {
        const next = ids || [];
        setFocusGeneIds(next);
        const focusSet = new Set(next);
        setLabelGeneIds(prev => (prev || []).filter(id => focusSet.has(id)));
        // Clearing the focus restores the default view, so drop the hide/rescale flag.
        if (next.length === 0) setHideNonFocused(false);
    }, []);

    const option = useMemo(
        () => getGeneVolcanoOptions(volcanoPlotData, deSettings, focusGeneIds, labelGeneIds, displayMode, hideNonFocused),
        [volcanoPlotData, deSettings, focusGeneIds, labelGeneIds, displayMode, hideNonFocused]
    );

    // Export the gene list as CSV. `mode` selects the subset:
    //   de   -> significant genes (the original "Export DE genes")
    //   up   -> significant + upregulated
    //   down -> significant + downregulated
    //   all  -> the full, unfiltered gene list
    const exportGenes = useCallback(async (mode) => {
        try {
            // Use the data already loaded for the plot; fall back to a fresh fetch
            // if the user exports before the plot has finished loading.
            let genes = fcPValueData;
            let idMap = nameToIdMap;
            if (!genes || genes.length === 0) {
                const args = {analysisId, sessionId};
                const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                genes = await response.json();
                const mappedRes = await fetch2(`/api/mappedGeneIds?args=${btoa(JSON.stringify(args))}`);
                const mapped = await mappedRes.json();
                idMap = mapped.reduce((acc, curr) => {
                    acc[curr.from] = curr.to;
                    return acc;
                }, {});
            }

            // Keep the raw gene id and add a separate `symbol` column. Prefer the
            // symbol map already loaded for the plot, then any symbol the row already
            // carries (meta-analysis rows are pre-enriched with `symbol` server-side);
            // ensureGeneSymbols then fills any remaining gaps via visualization.getGeneInfo.
            const withSymbols = await AnalysisUtils.ensureGeneSymbols(
                (genes ?? []).map(gene => ({
                    ...gene,
                    symbol: (idMap && idMap[gene.id]) || gene.symbol || '',
                }))
            );

            const fileNames = {
                de: 'DEGenes.csv',
                up: 'Upregulated.csv',
                down: 'Downregulated.csv',
                all: 'AllGenes.csv',
            };

            await AnalysisUtils.exportDEGenes({
                deGenesData: selectGenesForExport(withSymbols, {
                    mode,
                    maxAdjustedPValue: config.maxAdjustedPValue ?? 0.05,
                    minLogFoldChange: config.minLogFoldChange ?? 0.5,
                }),
                inputType: config.inputType,
                fileName: fileNames[mode] ?? 'DEGenes.csv',
            });
        } catch (error) {
            console.error("Error exporting genes:", error);
        }
    }, [fcPValueData, nameToIdMap, analysisId, sessionId, config]);

    const exportMenu = useMemo(() => ({
        items: [
            {key: 'de', label: 'Export DE genes'},
            {key: 'up', label: 'Upregulated only'},
            {key: 'down', label: 'Downregulated only'},
            {key: 'all', label: 'Export all genes'},
        ],
        onClick: ({key}) => exportGenes(key),
    }), [exportGenes]);

    useEffect(() => {
        async function fetchData() {
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                setFcPValueData(resJson);
            } catch (error) {
                console.error("Error fetching data:", error);
                // Handle the error appropriately, e.g., set an error state
            }
        }

        const fetchMappedGeneIds = async () => {
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/mappedGeneIds?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                const tmpNameToIdMap = resJson.reduce((acc, curr) => {
                    acc[curr.from] = curr.to;
                    return acc;
                }, {})
                setNameToIdMap(tmpNameToIdMap);
            } catch (error) {
                console.error("Error fetching data:", error);
            }
        }
        fetchData();
        fetchMappedGeneIds()
    }, []);

    // Resolve official gene symbols for every plotted gene (id -> symbol) once the
    // gene list is loaded. Mirrors the heatmap/export path (visualization.getGeneInfo);
    // genes with no GeneInfo doc simply fall back to their id in the display logic.
    useEffect(() => {
        if (!fcPValueData || fcPValueData.length === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const ids = [...new Set(fcPValueData.map(e => String(e.id)))];
                const docs = await Meteor.callAsync('visualization.getGeneInfo', ids);
                if (cancelled) return;
                const map = {};
                (docs || []).forEach(d => {
                    if (d && d._id != null && d.symbol) map[String(d._id)] = d.symbol;
                });
                setSymbolMap(map);
            } catch (error) {
                console.error("Error fetching gene symbols:", error);
            }
        })();
        return () => { cancelled = true; };
    }, [fcPValueData]);

    return (
        <Space direction={'vertical'} style={{width: '100%'}}>
            <Space wrap>
                <Space>
                    <Typography.Text>{'pValue.FDR ≤'}</Typography.Text>
                    <Input
                        type="number"
                        onChange={async (e) => {
                            await handleChangingDESettings('maxAdjustedPValue', e.target.value, analysisId)
                        }}
                        value={config.maxAdjustedPValue ?? 0.05}
                    />
                </Space>
                <Space>
                    <Typography.Text>{'Absolute Log2FC ≥'}</Typography.Text>
                    <Input
                        type="number"
                        onChange={async (e) => {
                            await handleChangingDESettings('minLogFoldChange', e.target.value, analysisId)
                        }}
                        value={config.minLogFoldChange ?? 0.5}
                    />
                </Space>
                {deGeneStats.total > 0 && (
                    <Typography.Text type="secondary">
                        {deGeneStats.de.toLocaleString()}/{deGeneStats.total.toLocaleString()} DE genes
                    </Typography.Text>
                )}
                <Dropdown menu={exportMenu} trigger={['click']}>
                    <Button type={'primary'}>
                        <Space>
                            Export genes
                            <DownOutlined/>
                        </Space>
                    </Button>
                </Dropdown>
            </Space>
            <VolcanoGenePicker
                displayMode={displayMode}
                onDisplayModeChange={setDisplayMode}
                geneOptions={geneOptions}
                focusGeneIds={focusGeneIds}
                onFocusChange={handleFocusChange}
                labelOptions={labelOptions}
                labelGeneIds={labelGeneIds}
                onLabelChange={setLabelGeneIds}
                hideNonFocused={hideNonFocused}
                onHideNonFocusedChange={setHideNonFocused}
                volcanoPlotData={volcanoPlotData}
                deSettings={deSettings}
            />
            <EchartsWrapper>
                <ReactEcharts
                    option={option}
                    style={{height: "700px"}}
                    ref={chartRef}
                />
            </EchartsWrapper>
        </Space>
    );
};

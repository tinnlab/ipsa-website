import React, {useEffect, useState, useCallback, useMemo} from "react";
import Layout from "antd/lib/layout/layout";
import _ from "lodash";
import Button from "antd/lib/button";
import Text from "antd/lib/typography/Text";
import Space from "antd/lib/space";
import Collapse from "antd/lib/collapse";
import useSubscription from "/imports/client/hooks/useSubscription";
import {useTracker} from "meteor/react-meteor-data";
import Table from "antd/lib/table";
import Tabs from "antd/lib/tabs";
import InputNumber from "antd/lib/input-number";
import Select from "antd/lib/select";
import SearchOutlined from "@ant-design/icons/SearchOutlined";
import EyeOutlined from "@ant-design/icons/EyeOutlined";
import Input from "antd/lib/input";
import Modal from "antd/lib/modal";
import Checkbox from "antd/lib/checkbox";
import Tooltip from "antd/lib/tooltip";
import '../../Session/components/AnalysisResult.style.less';
import Row from "antd/lib/row";
import Col from "antd/lib/col";
import fetch2 from "/imports/client/utils/fetch";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";
import { makeNumericSorter } from "/imports/utils/resultTableSorters";
import GeneSetGenesView from "/imports/client/components/GeneSetGenesView";
import {loadPathwayGeneRows, GENE_EXPORT_OPTIONS, GENE_EXPORT_HEADER} from "/imports/client/utils/geneSetGenesData";
import {joinGeneSymbols} from "/imports/utils/geneSetMembership";

// Memoized Filter Dropdown Component
const FilterDropdown = React.memo(({
                                       placeholder,
                                       selectedKeys,
                                       setSelectedKeys,
                                       confirm,
                                       clearFilters
                                   }) => (
    <div style={{padding: 8}}>
        <Input
            placeholder={placeholder}
            value={selectedKeys[0]}
            onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={confirm}
            style={{width: 188, marginBottom: 8, display: 'block'}}
        />
        <Space>
            <Button
                type="primary"
                onClick={confirm}
                size="small"
                style={{width: 90}}
            >
                Search
            </Button>
            <Button
                onClick={() => {
                    clearFilters();
                    setSelectedKeys([]);
                    confirm();
                }}
                size="small"
                style={{width: 90}}
            >
                Reset
            </Button>
        </Space>
    </div>
));
// Memoized Table Component
const MemoizedTable = React.memo(({
                                      database,
                                      columns,
                                      selectType,
                                      keysByDb,
                                      setKeysByDb,
                                      onRowSelectionChange,
                                      onRowSelectAllChange,
                                      handleTableChange
                                  }) => {
    const rowSelection = selectType ? {
        type: selectType,
        selectedRowKeys: keysByDb[database.id],
        onChange: (selectedRowKeys) => {
            setKeysByDb(prevKeys => ({
                ...prevKeys,
                [database.id]: selectedRowKeys
            }));
        },
        onSelect: onRowSelectionChange,
        columnWidth: 48,
        onSelectAll: onRowSelectAllChange
    } : undefined;

    return (
        <Table
            virtual={true}
            columns={columns}
            dataSource={database.geneSets.map(e => ({
                ...e,
                key: e.pathway
            }))}
            rowKey={record => record.pathway}
            rowSelection={rowSelection}
            size="small"
            scroll={{x: 1500, y: 300}}
            pagination={false}
            onChange={handleTableChange}
        />
    );
});

// Memoized ResultContent Component
const ResultContent = React.memo(({
                                      analysisLog,
                                      isRunnable,
                                      analysisId,
                                      inputType,
                                      sessionId,
                                      tableData,
                                      columns,
                                      setHighlightPValue,
                                      setHighlightPValueFDR,
                                      keysByDb,
                                      setKeysByDb,
                                      selectType,
                                      onRowSelectionChange,
                                      onRowSelectAllChange,
                                      activeTabKey,
                                      setActiveTabKey,
                                      exportToCSV,
                                      urlPrefix,
                                      handleTableChange,
                                      labelControl
                                  }) => {
    return (
        <Space direction="vertical" style={{width: '100%', background: 'white'}}>
            {labelControl && (
                <Space direction="vertical" size={4} style={{width: '100%'}}>
                    <Space direction="horizontal" wrap style={{width: '100%'}} align="center">
                        <Text strong>Pathways labeled on plot:</Text>
                        <Select
                            mode="multiple"
                            showSearch
                            allowClear
                            placeholder="Search pathway name to label"
                            optionFilterProp="label"
                            style={{minWidth: 320}}
                            options={labelControl.options}
                            value={labelControl.value}
                            onChange={labelControl.onChange}
                            maxTagCount={labelControl.maxTags ?? 20}
                            maxTagPlaceholder={(omitted) => `+${omitted.length} pathway(s)`}
                        />
                        <Button size="small" onClick={labelControl.onReset}>Reset to top 20</Button>
                    </Space>
                    {labelControl.value.length > 40 && (
                        <Text type="warning" style={{fontSize: 12}}>
                            Labeling {labelControl.value.length} pathways may clutter the plot and slow rendering.
                        </Text>
                    )}
                </Space>
            )}

            {analysisLog && analysisLog.isRunning ? (
                <div className="progress-wrapper">
                    <div
                        className="ant-progress ant-progress-line ant-progress-status-active ant-progress-show-info ant-progress-default">
                        <div>
                            <div className="ant-progress-outer">
                                <div className="ant-progress-inner">
                                    <div className="ant-progress-bg analysis-status">
                                        {analysisLog.status || 'Analysis started'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <Button
                    type="primary"
                    style={{width: '100%', display: isRunnable ? undefined : 'none'}}
                    onClick={async () => {
                        await Meteor.callAsync('analysis.start', {
                            analysisId,
                            inputType,
                            sessionId
                        });
                    }}
                >
                    Start Analysis
                </Button>
            )}

            {tableData.length > 0 && (
                <>
                    <Space direction="horizontal" style={{width: '100%'}}>
                        <Text>Highlight:</Text>
                        <Space direction="horizontal" style={{width: '100%'}}>
                            <Text>{'pValue ≤'}</Text>
                            <InputNumber
                                defaultValue={0.05}
                                onChange={setHighlightPValue}
                            />
                        </Space>
                        <Space direction="horizontal" style={{width: '100%'}}>
                            <Text>{'pValue.FDR ≤'}</Text>
                            <InputNumber
                                defaultValue={0.05}
                                onChange={setHighlightPValueFDR}
                            />
                        </Space>
                        <Space style={{width: "100%"}} direction="horizontal">
                            <Button onClick={exportToCSV} type="primary" style={{marginRight: '20px'}}>
                                Export to CSV
                            </Button>
                        </Space>
                    </Space>

                    <Tabs
                        defaultActiveKey="0"
                        type="card"
                        activeKey={activeTabKey}
                        onChange={setActiveTabKey}
                        items={tableData.map((database, index) => ({
                            label: database.namespace ?
                                `${database.name} (${database.namespace})` :
                                database.name,
                            key: index.toString(),
                            children: (
                                <MemoizedTable
                                    database={database}
                                    columns={columns}
                                    selectType={selectType}
                                    keysByDb={keysByDb}
                                    setKeysByDb={setKeysByDb}
                                    onRowSelectionChange={onRowSelectionChange}
                                    onRowSelectAllChange={onRowSelectAllChange}
                                    handleTableChange={handleTableChange}
                                />
                            )
                        }))}
                    />

                    {tableData.length > 0 && (
                        <Button
                            type="primary"
                            style={{width: '100%', display: isRunnable ? undefined : 'none'}}
                            disabled={analysisLog?.isRunning}
                            onClick={() => {
                                window.location.href = `${urlPrefix}/analysis/visualization/${sessionId}`;
                            }}
                        >
                            Visualize
                        </Button>
                    )}
                </>
            )}
        </Space>
    )
});

const AnalysisResultComponent = ({
                                     inputType,
                                     analysisId,
                                     sessionId,
                                     isRunnable = true,
                                     selectType,
                                     onRowSelectionChange,
                                     onRowSelectAllChange,
                                     databaseIds,
                                     selectedPathways,
                                     urlPrefix,
                                     defaultActiveKey = [],
                                     selectedMethod = '',
                                     labelControl,
                                 }) => {
    // Get global settings
    const { globalSettings } = useGlobalSettings();

    // State
    const [isExpanded, setIsExpanded] = useState(false);
    const [tableData, setTableData] = useState([]);
    const [highlightPValue, setHighlightPValue] = useState(globalSettings.pValue);
    const [highlightPValueFDR, setHighlightPValueFDR] = useState(globalSettings.pValueFDR);
    const [keysByDb, setKeysByDb] = useState({});
    const [activeTabKey, setActiveTabKey] = useState("0");
    const [results, setResults] = useState([]);
    const [geneStats, setGeneStats] = useState([]);
    const [methodSettings, setMethodSettings] = useState({});
    const [tableSortState, setTableSortState] = useState({
        columnKey: 'consensus_pValue',
        order: 'ascend'
    });

    // Single, reusable gene-membership drawer (swaps content on eye-icon click; never stacks).
    const [genesDrawer, setGenesDrawer] = useState({open: false, pathwayId: null, name: '', databaseId: null, count: 0});
    const openGenesDrawer = useCallback((record) => {
        setGenesDrawer({
            open: true,
            pathwayId: record.pathway,
            name: record.name,
            databaseId: record.databaseId,
            count: record.genes,
        });
    }, []);
    const closeGenesDrawer = useCallback(() => setGenesDrawer(prev => ({...prev, open: false})), []);

    // "Export to CSV" options dialog (optional per-category gene columns).
    const [exportModal, setExportModal] = useState({open: false, loading: false});
    const [geneExportCols, setGeneExportCols] = useState([]);

    // Sync with global settings when they change
    useEffect(() => {
        setHighlightPValue(globalSettings.pValue);
        setHighlightPValueFDR(globalSettings.pValueFDR);
    }, [globalSettings]);

    // Subscriptions
    const analysisLog = useTracker(() => {
        if (!analysisId || !inputType) return {};
        const handle = Meteor.subscribe('analysis.running.logs', {analysisId, inputType});

        if (!handle.ready()) return null;

        return DBCollections.AnalysisLog.findOne({analysisId, inputType}) || {isRunning: false};
    })

    const configSnapshot = useTracker(() => {
        if (!analysisId || !inputType) return {};
        const handle = Meteor.subscribe('analysisConfig.snapshot', {
            analysisId,
            inputType,
            keys: ["geneStats", "methodSettings"]
        });

        if (!handle.ready()) return {};

        return {
            geneStats: DBCollections.AnalysisConfigSnapshot.findOne({
                analysisId,
                inputType,
                key: 'geneStats'
            })?.value || [],
            methodSettings: DBCollections.AnalysisConfigSnapshot.findOne({
                analysisId,
                inputType,
                key: 'methodSettings'
            })?.value || {}
        }
    }, [inputType, analysisId])

    useEffect(() => {
        if (defaultActiveKey.length > 0 && defaultActiveKey.includes("1")) {
            setIsExpanded(true)
        }
    }, [defaultActiveKey])

    useEffect(() => {
        if (configSnapshot.geneStats) {
            setGeneStats(configSnapshot.geneStats)
        }
        if (configSnapshot.methodSettings) {
            setMethodSettings(configSnapshot.methodSettings)
        }

    }, [configSnapshot]);

    useEffect(() => {
        if (selectedMethod === '') return
        setTableSortState({
            columnKey: `${selectedMethod}_pValue`,
            order: 'ascend'
        })
    }, [selectedMethod]);

    const handleTableChange = (pagination, filters, sorter) => {
        setTableSortState({
            columnKey: sorter.field,
            order: sorter.order
        });
    }

    // Memoized columns calculation
    const columns = useMemo(() => {
        if (!methodSettings || Object.keys(methodSettings).length === 0) return [];
        const allMethods = Object.keys(methodSettings).filter(method => method !== 'consensus')
        allMethods.unshift('consensus')


        const methodBasedColumns = allMethods
            .filter(method => methodSettings[method]?.enabled)
            .flatMap(method => {
                // Base columns for all methods
                const baseColumns = [
                    {
                        title: `${method.toUpperCase()} pValue`,
                        dataIndex: `${method.toLowerCase()}_pValue`,
                        key: `${method}_pValue`,
                        sorter: makeNumericSorter(`${method}_pValue`),
                        sortDirections: ['ascend', 'descend', 'ascend'],
                        render: (text, record) => {
                            if (text == null || text === '') return Number('1').toExponential(3);
                            const numText = Number(text).toExponential(3);
                            return record[`${method}_pValue`] <= highlightPValue ?
                                <Text style={{color: '#e74c3c', fontWeight: 800}}>{numText}</Text> :
                                numText;
                        },
                        width: 175,
                        sortOrder: tableSortState.columnKey === `${method}_pValue` ? tableSortState.order : undefined,
                        // ...(selectedMethod !== '' && selectedMethod === method ? {
                        //     sortOrder: 'ascend'
                        // } : {})
                    },
                    {
                        title: `${method.toUpperCase()} pValue.FDR`,
                        dataIndex: `${method}_pValueFDR`,
                        key: `${method.toLowerCase()}_pValueFDR`,
                        sorter: makeNumericSorter(`${method}_pValueFDR`),
                        sortDirections: ['ascend', 'descend', 'ascend'],
                        render: (text, record) => {
                            if (text == null || text === '') return Number('1').toExponential(3);
                            const numText = Number(text).toExponential(3);
                            return record[`${method}_pValueFDR`] <= highlightPValueFDR ?
                                <Text style={{color: '#e74c3c', fontWeight: 800}}>{numText}</Text> :
                                numText;
                        },
                        width: 175,
                        sortOrder: tableSortState.columnKey === `${method}_pValueFDR` ? tableSortState.order : undefined,
                    }
                ];

                // Add Score column only if method is not "consensus"

                baseColumns.push({
                    title: `${method.toUpperCase()} Score`,
                    dataIndex: `${method}_Score`,
                    key: `${method}_Score`,
                    sorter: makeNumericSorter(`${method}_Score`, {missing: 0}),
                    sortDirections: ['ascend', 'descend', 'ascend'],
                    render: (text) => {
                        if (text == null || text === '') return Number('0').toExponential(3);
                        return Number(text).toExponential(3);
                    },
                    width: 175,
                    sortOrder: tableSortState.columnKey === `${method}_Score` ? tableSortState.order : undefined,
                });

                return baseColumns;
            });

        return [
            {
                title: "ID",
                dataIndex: 'pathway',
                key: 'pathway',
                width: 150,
                fixed: 'left',
                filterDropdown: (props) => (
                    <FilterDropdown {...props} placeholder="Search ID"/>
                ),
                onFilter: (value, record) =>
                    record.pathway.toLowerCase().includes(value.toLowerCase()),
                filterIcon: filtered =>
                    <SearchOutlined style={{color: filtered ? '#1890ff' : undefined}}/>,
                sorter: (a, b) => a.pathway.localeCompare(b.pathway),
                sortDirections: ['ascend', 'descend', 'ascend'],
                sortOrder: tableSortState.columnKey === 'pathway' ? tableSortState.order : undefined,
            },
            {
                title: "Name",
                dataIndex: 'name',
                key: 'name',
                width: 250,
                fixed: 'left',
                filterDropdown: (props) => (
                    <FilterDropdown {...props} placeholder="Search Name"/>
                ),
                onFilter: (value, record) =>
                    record.name.toLowerCase().includes(value.toLowerCase()),
                filterIcon: filtered =>
                    <SearchOutlined style={{color: filtered ? '#1890ff' : undefined}}/>,
                sorter: (a, b) => a.name.localeCompare(b.name),
                sortDirections: ['ascend', 'descend', 'ascend'],
                sortOrder: tableSortState.columnKey === 'name' ? tableSortState.order : undefined,
            },
            {
                title: "#Genes",
                dataIndex: 'genes',
                key: 'genes',
                sorter: (a, b) => a.genes - b.genes,
                sortDirections: ['ascend', 'descend', 'ascend'],
                width: 110,
                sortOrder: tableSortState.columnKey === 'genes' ? tableSortState.order : undefined,
                render: (text, record) => (
                    <Space size={4}>
                        <span>{text}</span>
                        <Tooltip title="View genes in this category">
                            <EyeOutlined
                                style={{cursor: 'pointer', color: '#1890ff'}}
                                onClick={() => openGenesDrawer(record)}
                            />
                        </Tooltip>
                    </Space>
                )
            },
            ...methodBasedColumns
        ];
    }, [methodSettings, highlightPValue, highlightPValueFDR, selectedMethod, tableSortState, openGenesDrawer]);

    // Data fetching
    const getProcessedData = useCallback(async () => {
        try {
            return await Meteor.callAsync('visualization.getProcessedAnalyses', {
                analysisId,
                databaseIds
            }) || [];
        } catch (error) {
            console.error("Error fetching analysis results:", error);
            throw error;
        }
    }, [analysisId, inputType, databaseIds]);

    const fetchAndProcessData = useCallback(async () => {
        const processed = await getProcessedData();
        if (processed.length === 0) return;

        try {
            const res = await Promise.all(processed.map(async f => {
                const args = {resultId: f._id};
                const response = await fetch2(`/api/results?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const resJson = await response.json();
                return {...f, value: resJson};
            }));
            setResults(res);
        } catch (error) {
            console.error("Error fetching results:", error);
        }
    }, [getProcessedData]);

    // Format one base (non-gene) cell exactly as the on-screen render does, then CSV-escape it.
    const formatBaseCell = (col, row) => {
        let value = row[col.dataIndex];
        if (col.dataIndex.includes('_pValue') || col.dataIndex.includes('_pValueFDR')) {
            value = (value == null || value === '') ? Number('1').toExponential(3) : Number(value).toExponential(3);
        } else if (col.dataIndex.includes('_Score')) {
            value = (value == null || value === '') ? Number('0').toExponential(3) : Number(value).toExponential(3);
        }
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
    };

    // Export the active tab, optionally appending per-category gene columns. Honors the checkbox
    // row-selection: when categories are checked, only those are exported; otherwise all rows.
    const runExport = useCallback(async (selectedGeneModes) => {
        if (tableData.length === 0 || !columns) return;
        const activeTabData = tableData[parseInt(activeTabKey)];
        if (!activeTabData?.geneSets) return;

        const selectedKeys = keysByDb[activeTabData.id];
        const selectedSet = Array.isArray(selectedKeys) && selectedKeys.length > 0 ? new Set(selectedKeys) : null;
        const rows = selectedSet
            ? activeTabData.geneSets.filter(r => selectedSet.has(r.pathway))
            : activeTabData.geneSets;

        let genesByPathway = new Map();
        if (selectedGeneModes.length > 0) {
            const {byPathway} = await loadPathwayGeneRows({
                sessionId,
                analysisId,
                databaseId: activeTabData.id,
                pathwayIds: rows.map(r => r.pathway),
            });
            genesByPathway = byPathway;
        }

        const header = [
            ...columns.map(col => col.title),
            ...selectedGeneModes.map(mode => GENE_EXPORT_HEADER[mode]),
        ].join(',');

        const body = rows.map(row => {
            const baseCells = columns.map(col => formatBaseCell(col, row));
            const geneCells = selectedGeneModes.map(mode => {
                const geneRows = genesByPathway.get(row.pathway) || [];
                const val = joinGeneSymbols(geneRows, mode);
                return val.includes(',') ? `"${val}"` : val;
            });
            return [...baseCells, ...geneCells].join(',');
        });

        const csvContent = [header, ...body].join('\n');
        const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${activeTabData.name}_export.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    }, [tableData, columns, activeTabKey, keysByDb, sessionId, analysisId]);

    const openExportModal = useCallback(() => {
        setGeneExportCols([]);
        setExportModal({open: true, loading: false});
    }, []);

    const handleExportConfirm = useCallback(async () => {
        setExportModal(prev => ({...prev, loading: true}));
        try {
            await runExport(geneExportCols);
            setExportModal({open: false, loading: false});
        } catch (e) {
            console.error('Export failed:', e);
            setExportModal(prev => ({...prev, loading: false}));
        }
    }, [runExport, geneExportCols]);

    // Effects
    useEffect(() => {
        if (isExpanded) {
            fetchAndProcessData();
        }
    }, [isExpanded, fetchAndProcessData]);

    useEffect(() => {
        if (results.length > 0 && geneStats.length > 0) {
            const geneStatsMap = _.keyBy(
                geneStats.map(geneStat => ({
                    ...geneStat,
                    geneSets: _.keyBy(geneStat.geneSets, 'id')
                })),
                'id'
            );

            const resultMappedPathways = results.map(result => ({
                ...result,
                geneSets: _.keyBy(result.value, 'pathway'),
                value: null
            }));
            const tDataObject = resultMappedPathways.reduce((acc, result) => {
                if (!acc[result.databaseId]) {
                    acc[result.databaseId] = {
                        ...result,
                        geneSets: _.keyBy(Object.keys(result.geneSets).map(pathway => ({
                            ...result.geneSets[pathway],
                            [`${result.key}_pValue`]: result.geneSets[pathway].pValue,
                            [`${result.key}_pValueFDR`]: result.geneSets[pathway].pValueFDR,
                            [`${result.key}_Score`]: result.geneSets[pathway].score
                        })), 'pathway')
                    };
                } else {
                    acc[result.databaseId] = {
                        ...acc[result.databaseId],
                        geneSets: {
                            ..._.keyBy(Object.keys(result.geneSets).map(pathway => ({
                                ...acc[result.databaseId].geneSets[pathway],
                                ...result.geneSets[pathway],
                                [`${result.key}_pValue`]: result.geneSets[pathway].pValue,
                                [`${result.key}_pValueFDR`]: result.geneSets[pathway].pValueFDR,
                                [`${result.key}_Score`]: result.geneSets[pathway].score,
                            })), 'pathway')
                        }
                    };
                }
                return acc;
            }, {});
            const tData = Object.keys(tDataObject)
                .map(databaseId => {
                    const mappedGeneSets = geneStatsMap[databaseId];
                    if (!mappedGeneSets) return null;

                    const geneSets = Object.keys(tDataObject[databaseId].geneSets)
                        .map(pathway => ({
                            ...tDataObject[databaseId].geneSets[pathway],
                            name: mappedGeneSets.geneSets[pathway].name,
                            genes: mappedGeneSets.geneSets[pathway].genes,
                            databaseId: mappedGeneSets.id,
                            pValue: null,
                            pValueFDR: null,
                            score: null
                        }));

                    return {
                        name: mappedGeneSets.name,
                        namespace: mappedGeneSets.namespace,
                        id: mappedGeneSets.id,
                        geneSets
                    };
                })
                .filter(Boolean);

            setTableData(tData);
        } else {
            setTableData([]);
        }
    }, [results, geneStats]);

    useEffect(() => {
        if (results.length > 0 && selectedPathways?.length) {
            const selectedPathwaysSet = new Set(selectedPathways);
            setKeysByDb(prevKeys => {
                const newKeysByDb = {...prevKeys};
                results.forEach((e) => {
                    const keys = e.value
                        .map(e => e.pathway)
                        .filter(e => selectedPathwaysSet.has(e));
                    newKeysByDb[e.databaseId] = keys;
                });
                return newKeysByDb;
            });
        }
    }, [results, selectedPathways]);

    // Render
    return (
        <Layout>
            <Collapse
                bordered={false}
                defaultActiveKey={defaultActiveKey}
                onChange={(keys) => setIsExpanded(keys.includes("1"))}
                items={[
                    {
                        key: "1",
                        label: "Result table",
                        children: isExpanded ? (
                            <ResultContent
                                analysisLog={analysisLog}
                                isRunnable={isRunnable}
                                analysisId={analysisId}
                                inputType={inputType}
                                sessionId={sessionId}
                                tableData={tableData}
                                columns={columns}
                                setHighlightPValue={setHighlightPValue}
                                setHighlightPValueFDR={setHighlightPValueFDR}
                                keysByDb={keysByDb}
                                setKeysByDb={setKeysByDb}
                                selectType={selectType}
                                onRowSelectionChange={onRowSelectionChange}
                                onRowSelectAllChange={onRowSelectAllChange}
                                activeTabKey={activeTabKey}
                                setActiveTabKey={setActiveTabKey}
                                exportToCSV={openExportModal}
                                urlPrefix={urlPrefix}
                                handleTableChange={handleTableChange}
                                labelControl={labelControl}
                            />
                        ) : null
                    }
                ]}
            />

            <GeneSetGenesView
                open={genesDrawer.open}
                onClose={closeGenesDrawer}
                sessionId={sessionId}
                analysisId={analysisId}
                pathwayId={genesDrawer.pathwayId}
                pathwayName={genesDrawer.name}
                databaseId={genesDrawer.databaseId}
                totalCount={genesDrawer.count}
            />

            <Modal
                title="Export to CSV"
                open={exportModal.open}
                onOk={handleExportConfirm}
                onCancel={() => setExportModal({open: false, loading: false})}
                okText="Export"
                confirmLoading={exportModal.loading}
            >
                <Space direction="vertical" style={{width: '100%'}}>
                    <Text>Include per-category gene columns (optional):</Text>
                    <Checkbox.Group
                        options={GENE_EXPORT_OPTIONS}
                        value={geneExportCols}
                        onChange={setGeneExportCols}
                        style={{display: 'flex', flexDirection: 'column', gap: 8}}
                    />
                    <Text type="secondary" style={{fontSize: 12}}>
                        Gene symbols are joined with “;”. Leave unchecked to export the result table only.
                        When categories are selected via the checkboxes, only those are exported.
                    </Text>
                </Space>
            </Modal>
        </Layout>
    );
};

export default AnalysisResultComponent;
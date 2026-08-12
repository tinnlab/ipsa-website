import React, {useEffect, useState, useCallback, useMemo, useRef} from "react";
import {Tracker} from "meteor/tracker";
import {Meteor} from "meteor/meteor";
import {
    Layout,
    Button,
    Space,
    Collapse,
    Typography,
    Table,
    Tabs,
    InputNumber,
    Row,
    Col,
    Tooltip,
    Progress,
    Input,
    Modal,
    Checkbox
} from "antd";
import {SearchOutlined, EyeOutlined} from "@ant-design/icons";
import useSubscription from "/imports/client/hooks/useSubscription";
import _ from "lodash";
import fetch2 from "/imports/client/utils/fetch";
import MethodSettings from "../../../../../../methods/settings";
import {makeNumericSorter, pickDefaultSortMethod} from "/imports/utils/resultTableSorters";
import GeneSetGenesView from "/imports/client/components/GeneSetGenesView";
import {loadPathwayGeneRows, GENE_EXPORT_OPTIONS, GENE_EXPORT_HEADER} from "/imports/client/utils/geneSetGenesData";
import {joinGeneSymbols} from "/imports/utils/geneSetMembership";

const {Text, Title} = Typography;

// Note: Custom VirtualRow and VirtualCell components removed to fix DOM nesting warning
// Ant Design's virtual table handles row/cell rendering properly without custom components

export default ({inputType, analysisId, sessionId, isRunnable = true}) => {
    const [state, setState] = useState({
        tableData: [],
        columns: [],
        highlightPValue: 0.05,
        highlightPValueFDR: 0.05,
        activeTabKey: "0",
        isAnalysisCompleted: false,
        results: [],
        analysisLog: {
            progress: 0,
            isRunning: false
        },
        geneStats: [],
        methodSettings: {},
        selectedDatasets: []
    });

    const cachedResults = useRef({});

    // Single, reusable gene-membership drawer: clicking the eye icon on any category's #Genes cell
    // swaps its content rather than opening a new drawer.
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

    // "Export to CSV" opens an options dialog to optionally append per-category gene columns.
    const [exportModal, setExportModal] = useState({open: false, loading: false});
    const [geneExportCols, setGeneExportCols] = useState([]);

    // Set up subscriptions
    useEffect(() => {
        // Create subscriptions and store the handles
        const handles = [
            Meteor.subscribe("analysis.results.api", {analysisId, inputType}),
            Meteor.subscribe('analysis.running.logs', {analysisId, inputType}),
            Meteor.subscribe("analysisConfig.snapshot", {
                analysisId,
                inputType,
                keys: ["geneStats", "methodSettings", "selectedDatasets"]
            }),
            Meteor.subscribe('analysis.config', {
               analysisId,
               inputType,
               keys: ['methodSettings']
            })
        ];

        // Cleanup function to stop all subscriptions
        return () => {
            handles.forEach(handle => {
                if (handle && handle.stop) {
                    handle.stop();
                }
            });
        };
    }, [analysisId, inputType]);

    // Set up reactive computations
    useEffect(() => {
        // Track analysis log
        const logComputation = Tracker.autorun(() => {
            const analysisLog = DBCollections.AnalysisLog.findOne({analysisId, inputType}) || {isRunning: false};
            console.log("Analysis log:", analysisLog);
            setState(prev => ({
                ...prev,
                analysisLog,
                isAnalysisCompleted: !analysisLog.isRunning && analysisLog.status === 'Done'
            }));
        });

        // Track gene stats
        const statsComputation = Tracker.autorun(() => {
            const geneStats = DBCollections.AnalysisConfigSnapshot.findOne({
                analysisId,
                inputType,
                key: 'geneStats'
            })?.value || [];
            setState(prev => ({...prev, geneStats}));
        });

        // Track method settings
        const settingsComputation = Tracker.autorun(() => {
            const methodSettings = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'methodSettings'
            })?.value || {};
            setState(prev => ({...prev, methodSettings}));
        });

        // Track selected datasets
        const selectedDatasetsComputation = Tracker.autorun(() => {
            const selectedDatasets = DBCollections.AnalysisConfigSnapshot.findOne({
                analysisId,
                inputType,
                key: 'selectedDatasets'
            })?.value || [];
            setState(prev => ({...prev, selectedDatasets}));
        })

        // Track analysis results
        const resultsComputation = Tracker.autorun(() => {
            const processed = DBCollections.AnalysisResult.find(
                {analysisId},
                {fields: {_id: 1, analysisId: 1, inputType: 1, key: 1, databaseId: 1}}
            ).fetch() || [];

            console.log("processed:", processed);
            if (processed.length === 0) return;

            if (processed.length < Object.keys(cachedResults.current).length) {
                cachedResults.current = {};
            }

            const newResults = processed.filter(f => !cachedResults.current[f._id]);

            Promise.all(newResults.map(async f => {
                let args = {resultId: f._id};
                const response = await fetch2(`/api/results?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                return {...f, value: resJson};
            })).then(res => {
                res.forEach(result => {
                    cachedResults.current[result._id] = result;
                });

                const currentIds = new Set(processed.map(p => p._id));
                Object.keys(cachedResults.current).forEach(id => {
                    if (!currentIds.has(id)) {
                        delete cachedResults.current[id];
                    }
                });

                setState(prev => ({...prev, results: Object.values(cachedResults.current)}));
            }).catch(error => {
                console.error("Error fetching results:", error);
            });
        });

        // Cleanup computations when component unmounts
        return () => {
            logComputation.stop();
            statsComputation.stop();
            settingsComputation.stop();
            resultsComputation.stop();
            selectedDatasetsComputation.stop();
        };
    }, [analysisId, inputType]);

    const startAnalysis = useCallback(async () => {
        setState(prev => ({
            ...prev,
            tableData: [],
            isAnalysisCompleted: false
        }));

        try {
            const session = await DBCollections.Session.findOneAsync(
                {"analyses.id": analysisId}
            );

            if (session.editable) {
                notify.success("Analysis started");
                await Meteor.callAsync('analysis.log', {
                    analysisId,
                    inputType,
                    message: 'Reading data...',
                    progress: 0,
                    done: 0
                });
                setState(prev => ({
                    ...prev,
                    analysisLog: {
                        progress: 0,
                        done: 0,
                        isRunning: true
                    }
                }))
                if (inputType === 'expression') {
                    await Meteor.callAsync('ora.run.volcano.plot', {analysisId, inputType});
                } else if (inputType === 'pgsea') {
                    await Meteor.callAsync('pgsea.volcano.plot', {analysisId, inputType});
                }
                try {
                    await Meteor.asyncCallWithNotification('analysis.start', {
                        analysisId, inputType, sessionId
                    });
                    if (inputType !== 'ora' && state.methodSettings) {
                        if (Object.keys(state.methodSettings).length === 0 || Object.keys(state.methodSettings).filter(key => state.methodSettings[key].enabled).length > 1) {
                            await Meteor.callAsync('consensus.processAnalysis', {analysisId, sessionId, inputType})
                        }
                    }
                    setState(prev => ({...prev, isAnalysisCompleted: true}));
                    await Meteor.callAsync('analysis.log', {
                        analysisId,
                        inputType,
                        message: 'Done',
                        progress: 100,
                        isRunning: false
                    })
                    notify.success("Analysis completed!");
                } catch (e) {
                    // do nothing
                    await Meteor.callAsync('analysis.log', {
                        analysisId,
                        inputType,
                        isRunning: false,
                    });
                }
            } else {
                notify.error("Analysis is in read-only mode");
            }
        } catch (error) {
            console.error('Error starting analysis:', error);
            notify.error("Failed to start analysis. Please try again.");
            await Meteor.callAsync('analysis.log', {
                analysisId,
                inputType,
                isRunning: false,
            });
        }
    }, [analysisId, inputType, sessionId, state]);

    const memoizedColumns = useMemo(() => {
        if (!state.methodSettings) return [];

        const enabledMethods = Object.keys(state.methodSettings)
            .filter(method => state.methodSettings[method].enabled);
        // Default sort: consensus pValue ascending (or the sole/first method's
        // pValue when there is no consensus), matching the Visualization table.
        const defaultSortMethod = pickDefaultSortMethod(enabledMethods);

        let methodBasedColumns = enabledMethods
            .flatMap(method => {
                // Create basic columns that all methods have
                const columns = [
                    {
                        title: `${method.toUpperCase()} pValue`,
                        dataIndex: `${method}_pValue`,
                        key: `${method}_pValue`,
                        sorter: makeNumericSorter(`${method}_pValue`),
                        sortDirections: ['ascend', 'descend', 'ascend'],
                        ...(method === defaultSortMethod ? {defaultSortOrder: 'ascend'} : {}),
                        render: (text, record) => {
                            if (text == null || text === '') return Number('1').toExponential(3);
                            text = Number(text).toExponential(3);
                            return record[`${method}_pValue`] <= state.highlightPValue
                                ? <Text style={{color: '#e74c3c', fontWeight: 800}}>{text}</Text>
                                : text;
                        },
                        width: 175,
                        filterDropdown: ({setSelectedKeys, confirm}) => (
                            <div style={{padding: 8}}>
                                <Space>
                                    <Text>{'pValue ≤'}</Text>
                                    <InputNumber
                                        style={{width: 100}}
                                        onChange={e => setSelectedKeys([e])}
                                        min={0}
                                        max={1}
                                    />
                                    <Button
                                        size="small"
                                        type="primary"
                                        onClick={() => confirm()}
                                    >
                                        Filter
                                    </Button>
                                </Space>
                            </div>
                        ),
                        onFilter: (value, record) => record[`${method}_pValue`] <= value,
                    },
                    {
                        title: `${method.toUpperCase()} pValue.FDR`,
                        dataIndex: `${method}_pValueFDR`,
                        key: `${method}_pValueFDR`,
                        sorter: makeNumericSorter(`${method}_pValueFDR`),
                        sortDirections: ['ascend', 'descend', 'ascend'],
                        render: (text, record) => {
                            if (text == null || text === '') return Number('1').toExponential(3);
                            text = Number(text).toExponential(3);
                            return record[`${method}_pValueFDR`] <= state.highlightPValueFDR
                                ? <Text style={{color: '#e74c3c', fontWeight: 800}}>{text}</Text>
                                : text;
                        },
                        width: 175,
                        filterDropdown: ({setSelectedKeys, confirm}) => (
                            <div style={{padding: 8}}>
                                <Space>
                                    <Text>{'pValue.FDR ≤'}</Text>
                                    <InputNumber
                                        style={{width: 100}}
                                        onChange={e => setSelectedKeys([e])}
                                        min={0}
                                        max={1}
                                    />
                                    <Button
                                        size="small"
                                        type="primary"
                                        onClick={() => confirm()}
                                    >
                                        Filter
                                    </Button>
                                </Space>
                            </div>
                        ),
                        onFilter: (value, record) => record[`${method}_pValueFDR`] <= value,
                    }
                ];

                // Add Score column only if method is not "consensus"
                // if (method !== "consensus") {
                columns.push({
                    title: `${method.toUpperCase()} Score`,
                    dataIndex: `${method}_Score`,
                    key: `${method}_Score`,
                    sorter: makeNumericSorter(`${method}_Score`, {missing: 0}),
                    sortDirections: ['ascend', 'descend', 'ascend'],
                    render: (text) => {
                        if (text == null || text === '') return Number('0').toExponential(3);
                        return Number(text).toExponential(3);
                    },
                    width: 175
                });
                // }

                return columns;
            });

        return [
            {
                title: "ID",
                dataIndex: 'pathway',
                key: 'pathway',
                width: 150,
                fixed: 'left',
                ellipsis: {
                    showTitle: false
                },
                render: (text) => (
                    <Tooltip placement="topLeft" title={text}>
                        <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            width: '150px'
                        }}>
                            {text}
                        </div>
                    </Tooltip>
                )
            },
            {
                title: "Name",
                dataIndex: 'name',
                key: 'name',
                width: 250,
                fixed: 'left',
                ellipsis: {
                    showTitle: false
                },
                // Add sorting functionality
                sorter: (a, b) => {
                    // Handle null or undefined values
                    const aName = a.name || '';
                    const bName = b.name || '';
                    return aName.localeCompare(bName);
                },
                sortDirections: ['ascend', 'descend', 'ascend'],
                // Add filtering functionality
                filterDropdown: ({setSelectedKeys, selectedKeys, confirm, clearFilters}) => (
                    <div style={{padding: 8}}>
                        <Input
                            placeholder="Search name"
                            value={selectedKeys[0]}
                            onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                            onPressEnter={() => confirm()}
                            style={{width: 188, marginBottom: 8, display: 'block'}}
                        />
                        <Space>
                            <Button
                                type="primary"
                                onClick={() => confirm()}
                                size="small"
                                style={{width: 90}}
                            >
                                Filter
                            </Button>
                            <Button
                                onClick={() => {
                                    clearFilters();
                                    confirm();
                                }}
                                size="small"
                                style={{width: 90}}
                            >
                                Reset
                            </Button>
                        </Space>
                    </div>
                ),
                filterIcon: filtered => (
                    <SearchOutlined style={{color: filtered ? '#1890ff' : undefined}}/>
                ),
                onFilter: (value, record) => {
                    // Case-insensitive search
                    return record.name
                        ? record.name.toString().toLowerCase().includes(value.toLowerCase())
                        : false;
                },
                render: (text) => (
                    <Tooltip placement="topLeft" title={text}>
                        <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            width: '250px'
                        }}>
                            {text}
                        </div>
                    </Tooltip>
                )
            },
            {
                title: "#Genes",
                dataIndex: 'genes',
                key: 'genes',
                sorter: (a, b) => a.genes - b.genes,
                sortDirections: ['ascend', 'descend', 'ascend'],
                width: 110,
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
    }, [state.methodSettings, state.highlightPValue, state.highlightPValueFDR, openGenesDrawer]);

    useEffect(() => {
        setState(prev => ({...prev, columns: memoizedColumns}));
    }, [memoizedColumns]);

    useEffect(() => {
        if (state.results.length > 0 && state.geneStats.length > 0) {
            const geneStatsMap = _.keyBy(state.geneStats.map(geneStat => ({
                ...geneStat,
                geneSets: _.keyBy(geneStat.geneSets, 'id')
            })), 'id');

            const resultMappedPathways = state.results.map(result => ({
                ...result,
                geneSets: _.keyBy(result.value, 'pathway'),
                value: null
            }));

            let tDataObject = {};
            resultMappedPathways.forEach(result => {
                if (!tDataObject[result.databaseId]) {
                    tDataObject[result.databaseId] = {
                        ...result,
                        geneSets: _.keyBy(Object.values(result.geneSets).map(pathway => ({
                            ...pathway,
                            [`${result.key}_pValue`]: pathway.pValue,
                            [`${result.key}_pValueFDR`]: pathway.pValueFDR,
                            [`${result.key}_Score`]: pathway.score
                        })), 'pathway')
                    };
                } else {
                    tDataObject[result.databaseId] = {
                        ...tDataObject[result.databaseId],
                        geneSets: _.keyBy(Object.values(result.geneSets).map(pathway => ({
                            ...tDataObject[result.databaseId].geneSets[pathway.pathway],
                            ...pathway,
                            [`${result.key}_pValue`]: pathway.pValue,
                            [`${result.key}_pValueFDR`]: pathway.pValueFDR,
                            [`${result.key}_Score`]: pathway.score
                        })), 'pathway')
                    };
                }
            });

            const tData = Object.values(tDataObject)
                .map(database => {
                    const mappedGeneSets = geneStatsMap[database.databaseId];
                    if (mappedGeneSets) {
                        return {
                            name: mappedGeneSets.name,
                            namespace: mappedGeneSets?.namespace,
                            id: mappedGeneSets.id,
                            geneSets: Object.values(database.geneSets).map(pathway => ({
                                ...pathway,
                                name: mappedGeneSets.geneSets[pathway.pathway]?.name,
                                genes: mappedGeneSets.geneSets[pathway.pathway]?.genes,
                                databaseId: mappedGeneSets.id,
                                pValue: null,
                                pValueFDR: null
                            }))
                        };
                    }
                    return null;
                })
                .filter(Boolean);

            setState(prev => ({...prev, tableData: tData}));
        } else {
            setState(prev => ({...prev, tableData: []}));
        }
    }, [state.results, state.geneStats]);

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

    // Build + download the CSV for the active tab, optionally appending per-category gene columns
    // (selected in the export dialog). The gene columns require a fetch, so this is async.
    const runExport = useCallback(async (selectedGeneModes) => {
        if (state.tableData.length === 0 || !state.columns) return;
        const activeTabData = state.tableData[parseInt(state.activeTabKey)];
        if (!activeTabData || !activeTabData.geneSets) return;

        const rows = activeTabData.geneSets;

        // Only the base columns exclude the injected #Genes eye-icon render — that render returns
        // JSX, but for CSV we read the raw `genes` count value directly via formatBaseCell.
        let genesByPathway = new Map();
        if (selectedGeneModes.length > 0) {
            const pathwayIds = rows.map(r => r.pathway);
            const {byPathway} = await loadPathwayGeneRows({
                sessionId,
                analysisId,
                databaseId: activeTabData.id,
                pathwayIds,
            });
            genesByPathway = byPathway;
        }

        const header = [
            ...state.columns.map(col => col.title),
            ...selectedGeneModes.map(mode => GENE_EXPORT_HEADER[mode]),
        ].join(',');

        const body = rows.map(row => {
            const baseCells = state.columns.map(col => formatBaseCell(col, row));
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
    }, [state.tableData, state.columns, state.activeTabKey, sessionId, analysisId]);

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
            if (typeof notify !== 'undefined') notify.error('Failed to export genes. Please try again.');
        }
    }, [runExport, geneExportCols]);

    // Generate tab items configuration
    const tabItems = useMemo(() =>
            state.selectedDatasets.map((dbKey, index) => {
                const database = state.tableData.filter(db => db.id === dbKey)[0];
                return database ? {
                    key: index.toString(),
                    label: (
                        <Text>
                            {database.namespace
                                ? `${database.name} (${database.namespace})`
                                : database.name
                            }
                        </Text>
                    ),
                    children: (
                        <Table
                            columns={state.columns}
                            dataSource={database.geneSets}
                            rowKey={record => record.pathway}
                            size="small"
                            scroll={{
                                x: 1500,
                                y: 600
                            }}
                            virtual
                            pagination={false}
                            rowHeight={54}
                            summary={() => (
                                <Table.Summary fixed={true}>
                                    <Table.Summary.Row>
                                        <Table.Summary.Cell index={0} colSpan={state.columns.length}>
                                            {/* The cell spans every column, so it is as wide as the
                                                horizontal scroll area and its text would slide out of
                                                view as the table is scrolled right. Pin the label to
                                                the left edge of the viewport instead. */}
                                            <div style={{position: 'sticky', left: 0, display: 'inline-block'}}>
                                                <Text type="secondary">
                                                    Total rows: {database.geneSets.length}
                                                </Text>
                                            </div>
                                        </Table.Summary.Cell>
                                    </Table.Summary.Row>
                                </Table.Summary>
                            )}
                        />
                    )
                } : {}
            }),
        [state.tableData, state.columns]
    );

    // Define collapse items
    const collapseItems = [
        {
            key: "1",
            label: <Title level={5} style={{display: "inline-block", margin: 0}}>Analysis Result</Title>,
            children: (
                <>
                    {state.tableData.length > 0 && (
                        <Space direction="horizontal" style={{width: '100%', marginBottom: '16px'}}>
                            <Text>Highlight:</Text>
                            <Space direction="horizontal">
                                <Text>{'pValue ≤'}</Text>
                                <InputNumber
                                    value={state.highlightPValue}
                                    onChange={value => setState(prev => ({...prev, highlightPValue: value}))}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                />
                            </Space>
                            <Space direction="horizontal">
                                <Text>{'pValue.FDR ≤'}</Text>
                                <InputNumber
                                    value={state.highlightPValueFDR}
                                    onChange={value => setState(prev => ({...prev, highlightPValueFDR: value}))}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                />
                            </Space>
                        </Space>
                    )}

                    {state.tableData.length > 0 && (
                        <Row justify="end" style={{marginBottom: '16px'}}>
                            <Col>
                                <Button onClick={openExportModal} type="primary">
                                    Export to CSV
                                </Button>
                            </Col>
                        </Row>
                    )}

                    {/* Wait for columns too: antd reads `defaultSortOrder` only at the
                        Table's first mount, so the Table must not mount before the
                        (default-sorted) columns are ready, else the default sort is dropped. */}
                    {state.tableData.length > 0 && state.columns.length > 0 && (
                        <Tabs
                            activeKey={state.activeTabKey}
                            onChange={key => setState(prev => ({...prev, activeTabKey: key}))}
                            items={tabItems}
                        />
                    )}

                </>
            )
        }
    ];

    return (
        <Layout>
            <Space direction="vertical" style={{width: '100%', background: 'white'}}>
                {state.analysisLog.isRunning && (
                    <Space direction={"vertical"} style={{width: '100%'}}>
                        <Progress
                            percent={state.analysisLog.progress || 0}
                            status="active"
                            percentPosition={{
                                align: 'center',
                                type: 'inner'
                            }}
                            size={['100%', 20]}
                        />
                        <div className="progress-wrapper">
                            <div
                                className="ant-progress ant-progress-line ant-progress-status-active ant-progress-show-info ant-progress-default">
                                <div>
                                    <div className="ant-progress-outer">
                                        <div className="ant-progress-inner">
                                            <div className="ant-progress-bg analysis-status">
                                                {state.analysisLog.status || 'Analysis started'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Space>
                )}

                <Collapse
                    bordered={false}
                    defaultActiveKey={["1"]}
                    items={collapseItems}
                />
            </Space>

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
                    </Text>
                </Space>
            </Modal>
        </Layout>
    );
};
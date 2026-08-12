import React, {useEffect, useMemo, useState} from 'react';
import {TreeSelect, Button, Table, Input, Select, Modal, Progress, Spin, message, Collapse, Checkbox} from 'antd';
import {Random} from "meteor/random";
import {useTracker} from "meteor/react-meteor-data";
import useSubscription from "/imports/client/hooks/useSubscription";
import fetch2 from "../../../../../utils/fetch";
import {Meteor} from "meteor/meteor";
import GeneLoading from "../../../../../components/GeneLoading";
import {analysisDisplayName, buildGeneLevelData} from "/imports/utils/metaAnalysisGeneLevel";
import {useGlobalSettings} from "/imports/client/contexts/GlobalSettingsContext";

const {SHOW_CHILD} = TreeSelect;
const {Option} = Select;
const {Panel} = Collapse;

export default ({configs, analyses, sessionId, resultGroupedDbAll: resultGroupedDbAllProp}) => {
    // True for a view-only imported study; supplied by the Visualization page's provider.
    const {readOnly} = useGlobalSettings();
    // Meta-analysis name
    const [analysisName, setAnalysisName] = useState('');
    const [metaAnalyses, setMetaAnalyses] = useState([]);
    const [isMetaAnalysesLoading, setIsMetaAnalysesLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [selectedAnalysis, setSelectedAnalysis] = useState(null);

    // Gene-level state
    const [enableGeneLevel, setEnableGeneLevel] = useState(true);
    const [geneLevelMethod, setGeneLevelMethod] = useState('');
    const [selectedGeneAnalyses, setSelectedGeneAnalyses] = useState([]);
    const [geneTreeData, setGeneTreeData] = useState([]);
    const [expressionData, setExpressionData] = useState([]);

    // Pathway-level state
    const [enablePathwayLevel, setEnablePathwayLevel] = useState(true);
    const [pathwayLevelMethod, setPathwayLevelMethod] = useState('');
    const [selectedPathwayAnalyses, setSelectedPathwayAnalyses] = useState([]);
    const [pathwayTreeData, setPathwayTreeData] = useState([]);
    const [selectedDatabase, setSelectedDatabase] = useState('');
    const [selectedEnrichmentMethod, setSelectedEnrichmentMethod] = useState('');
    const [availableDatabases, setAvailableDatabases] = useState([]);
    const [availableEnrichmentMethods, setAvailableEnrichmentMethods] = useState([]);
    const [databaseNameMap, setDatabaseNameMap] = useState({});
    const [resultsByDb, setResultsByDb] = useState({});
    const [pathwayResultsData, setPathwayResultsData] = useState([]);
    const [initialDataLoaded, setInitialDataLoaded] = useState(false);

    const methods = [
        {label: 'Fisher', value: 'fisher'},
        {label: 'Stouffer', value: 'stouffer'},
        {label: 'addCLT', value: 'addCLT'},
        {label: 'Minimum p-value', value: 'minP'},
        {label: 'Geometric mean', value: 'geoMean'},
        {label: 'Restricted maximum likelihood', value: 'REML'},
    ];

    const analysesTracking = useTracker(() => {
        const handle = Meteor.subscribe('analysis.session', sessionId)
        if (!handle.ready()) {
            return null;
        }

        return DBCollections.Session.find({_id: sessionId}).fetch();
    }, [sessionId])

    const sessionMetaAnalyses = useMemo(() => {
        return analysesTracking?.[0]?.metaAnalyses || []
    }, [analysesTracking])

    // Load meta-analyses
    useEffect(() => {
        setIsMetaAnalysesLoading(true);
        Meteor.asyncCallWithNotification('visualization.getMetaAnalyses', {sessionId}).then((res) => {
            let metaAnalysesRes = res.map(e => {
                return {
                    id: e.id,
                    key: e.id,
                    name: e.name,
                    geneLevel: e.geneLevel,
                    pathwayLevel: e.pathwayLevel,
                    createdAt: e.createdAt,
                    updatedAt: e.updatedAt
                }
            });
            setMetaAnalyses(metaAnalysesRes);
            setIsMetaAnalysesLoading(false);
        }).catch(error => {
            console.error("Error fetching meta analyses:", error);
            setIsMetaAnalysesLoading(false);
        });
    }, [sessionId, sessionMetaAnalyses]);

    // Initialize gene-level data
    useEffect(() => {
        // ONLY Expression analyses are eligible for gene-level meta-analysis (PGSEA's
        // 2-column Gene+Statistic format lacks fold-change + p-value + standard errors).
        // Names are resolved from the config itself with a safe fallback, so an
        // Expression analysis present in `configs` but missing from `analyses` (e.g. it
        // has gene data but no pathway-enrichment results) does not crash the builder.
        const {expressionData, geneTreeData, initialSelectedItems} = buildGeneLevelData(configs, analyses);

        setSelectedGeneAnalyses(initialSelectedItems);
        setGeneTreeData(geneTreeData);
        setExpressionData(expressionData);

        // Auto-disable gene-level meta-analysis when nothing is runnable: either no
        // Expression analyses at all (e.g. only PGSEA), or none of them have DE
        // results yet (not run). initialSelectedItems holds only with-results ones.
        if (initialSelectedItems.length === 0) {
            setEnableGeneLevel(false);
        }
    }, [configs, analyses]);

    // Use pathway results from prop
    useEffect(() => {
        if (resultGroupedDbAllProp && Object.keys(resultGroupedDbAllProp).length > 0) {
            console.log('[MetaAnalysisBuilder] Using resultGroupedDbAll from prop, keys:', Object.keys(resultGroupedDbAllProp).length);
            setResultsByDb(resultGroupedDbAllProp);
            setInitialDataLoaded(true);
        }
    }, [resultGroupedDbAllProp]);

    // Initialize pathway-level data
    useEffect(() => {
        if (Object.keys(resultsByDb).length === 0) {
            return;
        }

        // Build database name mapping from configs
        let dbNameMap = {};
        Object.values(configs).forEach(config => {
            if (config.geneSets) {
                config.geneSets.forEach(geneSet => {
                    const displayName = geneSet.namespace
                        ? `${geneSet.name} (${geneSet.namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})`
                        : geneSet.name;
                    dbNameMap[geneSet.id] = displayName;
                });
            }
        });
        setDatabaseNameMap(dbNameMap);

        // Extract available databases and enrichment methods
        let databases = Object.keys(resultsByDb);
        let methodsSet = new Set();

        Object.keys(resultsByDb).forEach((db) => {
            resultsByDb[db].forEach((result) => {
                methodsSet.add(result.key);
            });
        });

        setAvailableDatabases(databases);
        setAvailableEnrichmentMethods(Array.from(methodsSet));

        // Set default selections if not already set
        if (!selectedDatabase && databases.length > 0) {
            setSelectedDatabase(databases[0]);
        }
        if (!selectedEnrichmentMethod && methodsSet.size > 0) {
            setSelectedEnrichmentMethod(Array.from(methodsSet)[0]);
        }

        let pathwayResData = {};
        Object.keys(resultsByDb).forEach((db) => {
            pathwayResData[db] = {};
            resultsByDb[db].forEach((result) => {
                let key = result.analysisId + '-' + result.key;
                pathwayResData[db][key] = result.value;
            });
        });
        setPathwayResultsData(pathwayResData);
        let resultGroupByAnalysis = {};
        Object.keys(resultsByDb).forEach((db) => {
            resultsByDb[db].forEach((result) => {
                if (!resultGroupByAnalysis[result.analysisId]) {
                    resultGroupByAnalysis[result.analysisId] = [];
                }
                if (!resultGroupByAnalysis[result.analysisId].some(e => e.key === result.key)) {
                    resultGroupByAnalysis[result.analysisId].push(result);
                }
            });
        })
        // Build tree with all analyses, disabling those without the selected database+method
        let initialTreeData = [];
        let treeData = Object.keys(resultGroupByAnalysis).map((analysisId) => {
            // Check if this analysis has results for the selected database and enrichment method
            let hasSelectedCombination = false;
            if (selectedDatabase && selectedEnrichmentMethod && resultsByDb[selectedDatabase]) {
                hasSelectedCombination = resultsByDb[selectedDatabase].some(
                    result => result.analysisId === analysisId && result.key === selectedEnrichmentMethod
                );
            }

            // Add to initial selection only if it has the selected combination
            if (hasSelectedCombination) {
                initialTreeData.push(analysisId);
            }

            const analysisName = analyses[analysisId]?.name || analysisId;
            const databaseDisplayName = dbNameMap[selectedDatabase] || selectedDatabase;
            const title = hasSelectedCombination
                ? analysisName
                : `${analysisName} (No ${selectedEnrichmentMethod} results for ${databaseDisplayName})`;

            return {
                title: title,
                value: analysisId,
                key: analysisId,
                disabled: !hasSelectedCombination,
                disableCheckbox: !hasSelectedCombination
            }
        });
        setPathwayTreeData(treeData);
        setSelectedPathwayAnalyses(initialTreeData);
    }, [configs, analyses, resultsByDb, selectedDatabase, selectedEnrichmentMethod]);

    const updateAnalysisStatus = async (id, level, status, retries = 3) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`Attempting to update meta-analysis status (attempt ${attempt}/${retries})`, {id, level, status});
                await Meteor.callAsync('visualization.updateMetaAnalysis', {sessionId, analysisId: id, level, status});
                // Update local state
                setMetaAnalyses(prev => prev.map(analysis => {
                    if (analysis.id === id || analysis.key === id) {
                        const updated = {...analysis};
                        if (level === 'gene' && updated.geneLevel) {
                            updated.geneLevel.status = status;
                        } else if (level === 'pathway' && updated.pathwayLevel) {
                            updated.pathwayLevel.status = status;
                        }
                        updated.updatedAt = new Date();
                        return updated;
                    }
                    return analysis;
                }));
                console.log('Successfully updated meta-analysis status', {id, level, status});
                return;
            } catch (error) {
                console.error(`Error updating meta analysis status (attempt ${attempt}/${retries}):`, error);

                if (attempt === retries) {
                    message.error(`Failed to update meta-analysis status after ${retries} attempts. Please refresh the page.`);
                    throw error;
                } else {
                    const delay = 200 * Math.pow(2, attempt - 1);
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    };

    const onComputeMetaAnalysis = async () => {
        // Validate
        if (!analysisName.trim()) {
            message.error('Please enter a meta-analysis name');
            return;
        }

        if (!enableGeneLevel && !enablePathwayLevel) {
            message.error('Please enable at least one level (Gene or Pathway)');
            return;
        }

        if (enableGeneLevel && (!geneLevelMethod || selectedGeneAnalyses.length < 2)) {
            message.error('Please select a method and at least 2 analyses for gene-level meta-analysis');
            return;
        }

        if (enablePathwayLevel && (!pathwayLevelMethod || selectedPathwayAnalyses.length < 2 || !selectedDatabase || !selectedEnrichmentMethod)) {
            message.error('Please select a method, database, enrichment method, and at least 2 analyses for pathway-level meta-analysis');
            return;
        }

        setIsProcessing(true);

        try {
            const analysisId = Random.id();

            // Build meta-analysis object
            const newAnalysis = {
                id: analysisId,
                name: analysisName,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Prepare gene-level data
            let geneLevelData = null;
            if (enableGeneLevel) {
                let selectedExpressionData = expressionData.filter(e => selectedGeneAnalyses.includes(e.analysisId));

                for (let i = 0; i < selectedExpressionData.length; i++) {
                    let args = {
                        analysisId: selectedExpressionData[i].analysisId,
                        sessionId
                    };
                    const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let resJson = await response.json();
                    selectedExpressionData[i].fcPValueData = resJson;
                }

                // Resolve names defensively: an Expression analysis may be in `configs`
                // (so it's selectable here) but absent from the `analyses` map.
                let geneConfigById = expressionData.reduce((acc, cfg) => {
                    acc[cfg.analysisId] = cfg;
                    return acc;
                }, {});
                let analysisNames = selectedGeneAnalyses
                    .map(e => analysisDisplayName(analyses, e, geneConfigById[e]?.name))
                    .join(', ');

                newAnalysis.geneLevel = {
                    method: geneLevelMethod,
                    selectedAnalyses: selectedGeneAnalyses,
                    status: 'processing',
                    datasets: analysisNames
                };

                geneLevelData = {
                    selectedExpressionData,
                    method: geneLevelMethod
                };
            }

            // Prepare pathway-level data
            let pathwayLevelData = null;
            if (enablePathwayLevel) {
                let selectedPathwayResData = {};

                if (selectedDatabase && selectedEnrichmentMethod) {
                    selectedPathwayResData[selectedDatabase] = {};

                    selectedPathwayAnalyses.forEach((analysisId) => {
                        const key = analysisId + '-' + selectedEnrichmentMethod;
                        if (pathwayResultsData[selectedDatabase] && pathwayResultsData[selectedDatabase][key]) {
                            selectedPathwayResData[selectedDatabase][key] = pathwayResultsData[selectedDatabase][key];
                        }
                    });
                }

                let analysisNames = selectedPathwayAnalyses.map(analysisId => analyses[analysisId]?.name || analysisId).join(', ');
                let databaseDisplayName = databaseNameMap[selectedDatabase] || selectedDatabase;
                let datasetsDisplay = `Database: ${databaseDisplayName} | Method: ${selectedEnrichmentMethod} | Analyses: ${analysisNames}`;

                newAnalysis.pathwayLevel = {
                    method: pathwayLevelMethod,
                    selectedAnalyses: selectedPathwayAnalyses,
                    database: selectedDatabase,
                    enrichmentMethod: selectedEnrichmentMethod,
                    status: 'processing',
                    datasets: datasetsDisplay
                };

                pathwayLevelData = {
                    selectedPathwayResData,
                    method: pathwayLevelMethod
                };
            }

            // Add to session
            await Meteor.callAsync('visualization.addMetaAnalysis', {sessionId, analysis: newAnalysis});
            setMetaAnalyses(prev => [...prev, {...newAnalysis, key: analysisId}]);

            // Small delay to ensure database write is committed
            await new Promise(resolve => setTimeout(resolve, 100));

            // Compute meta-analysis
            await Meteor.callAsync('meta.analysis.compute', {
                sessionId,
                analysisId,
                name: analysisName,
                geneLevel: geneLevelData,
                pathwayLevel: pathwayLevelData
            });

            message.success('Meta-analysis computation completed');
        } catch (error) {
            console.error("Error in meta analysis computation:", error);
            const errorMsg = error.message || 'Failed to compute meta-analysis';
            message.error(errorMsg);
        } finally {
            setIsProcessing(false);
        }
    };

    const showConfirm = (analysis) => {
        setSelectedAnalysis(analysis);
        setConfirmOpen(true);
    };

    const handleConfirmOk = async () => {
        await onRemoveAnalysis(selectedAnalysis.key);
        setConfirmOpen(false);
    };

    const handleConfirmCancel = () => {
        setConfirmOpen(false);
    };

    const onRemoveAnalysis = async (analysisId) => {
        await Meteor.callAsync('visualization.removeMetaAnalysis', {sessionId, analysisId});
        setIsMetaAnalysesLoading(true);
        Meteor.asyncCallWithNotification('visualization.getMetaAnalyses', {sessionId}).then((res) => {
            let metaAnalysesRes = res.map(e => {
                return {
                    id: e.id,
                    key: e.id,
                    name: e.name,
                    geneLevel: e.geneLevel,
                    pathwayLevel: e.pathwayLevel,
                    createdAt: e.createdAt,
                    updatedAt: e.updatedAt
                }
            });
            setMetaAnalyses(metaAnalysesRes);
            setIsMetaAnalysesLoading(false);
        })
    };

    const columns = [
        {
            title: 'Meta Analysis Name',
            dataIndex: 'name',
            key: 'name',
        },
        {
            title: 'Gene-Level Status',
            key: 'geneLevelStatus',
            render: (_, record) => {
                if (!record.geneLevel) return 'N/A';
                const status = record.geneLevel.status;
                if (status === 'processing') {
                    return (
                        <Progress
                            percent={100}
                            status="active"
                            showInfo={false}
                            strokeColor={{
                                '0%': '#108ee9',
                                '100%': '#87d068',
                            }}
                        />
                    );
                }
                return status;
            },
        },
        {
            title: 'Pathway-Level Status',
            key: 'pathwayLevelStatus',
            render: (_, record) => {
                if (!record.pathwayLevel) return 'N/A';
                const status = record.pathwayLevel.status;
                if (status === 'processing') {
                    return (
                        <Progress
                            percent={100}
                            status="active"
                            showInfo={false}
                            strokeColor={{
                                '0%': '#108ee9',
                                '100%': '#87d068',
                            }}
                        />
                    );
                }
                return status;
            },
        },
        {
            title: 'Action',
            dataIndex: 'action',
            key: 'action',
            align: 'center',
            render: (_, record) => {
                const isProcessing = (record.geneLevel?.status === 'processing') || (record.pathwayLevel?.status === 'processing');
                // Removing a meta-analysis deletes its stored results, so it is unavailable on a
                // view-only import.
                if (readOnly) return null;
                return (
                    <Button
                        onClick={() => showConfirm(record)}
                        type="link"
                        danger
                        style={{marginLeft: 'auto', marginRight: 'auto'}}
                        disabled={isProcessing}
                    >
                        Remove
                    </Button>
                );
            },
        },
    ];

    console.log('[MetaAnalysisBuilder] initialDataLoaded:', initialDataLoaded, 'resultsByDb keys:', Object.keys(resultsByDb).length);
    if (!initialDataLoaded && Object.keys(resultsByDb).length === 0) {
        console.log('[MetaAnalysisBuilder] Showing GeneLoading');
        return <GeneLoading />
    }

    return (
        <div>
            <Input
                placeholder="Enter meta analysis name"
                value={analysisName}
                onChange={(e) => setAnalysisName(e.target.value)}
                style={{marginBottom: 16}}
            />

            <Collapse
                defaultActiveKey={['gene', 'pathway']}
                style={{marginBottom: 16}}
                items={[
                    {
                        key: 'gene',
                        label: (
                            <div>
                                <Checkbox
                                    checked={enableGeneLevel}
                                    onChange={(e) => setEnableGeneLevel(e.target.checked)}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    Gene-Level Meta-Analysis
                                </Checkbox>
                            </div>
                        ),
                        collapsible: enableGeneLevel ? undefined : 'disabled',
                        children: (
                            <>
                                <Select
                                    placeholder="Select meta-analysis method"
                                    value={geneLevelMethod}
                                    onChange={(value) => setGeneLevelMethod(value)}
                                    style={{width: '100%', marginBottom: 16}}
                                    disabled={!enableGeneLevel}
                                >
                                    <Option value="" disabled>
                                        Select a meta-analysis method
                                    </Option>
                                    {methods.map((method) => (
                                        <Option key={method.value} value={method.value}>
                                            {method.label}
                                        </Option>
                                    ))}
                                </Select>
                                <TreeSelect
                                    style={{width: '100%'}}
                                    value={selectedGeneAnalyses}
                                    onChange={setSelectedGeneAnalyses}
                                    treeData={geneTreeData}
                                    treeCheckable={true}
                                    showCheckedStrategy={SHOW_CHILD}
                                    placeholder="Select analyses"
                                    multiple
                                    disabled={!enableGeneLevel}
                                />
                            </>
                        )
                    },
                    {
                        key: 'pathway',
                        label: (
                            <div>
                                <Checkbox
                                    checked={enablePathwayLevel}
                                    onChange={(e) => setEnablePathwayLevel(e.target.checked)}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    Pathway-Level Meta-Analysis
                                </Checkbox>
                            </div>
                        ),
                        collapsible: enablePathwayLevel ? undefined : 'disabled',
                        children: (
                            <>
                                <Select
                                    placeholder="Select meta-analysis method"
                                    value={pathwayLevelMethod}
                                    onChange={(value) => setPathwayLevelMethod(value)}
                                    style={{width: '100%', marginBottom: 16}}
                                    disabled={!enablePathwayLevel}
                                >
                                    <Option value="" disabled>
                                        Select a meta-analysis method
                                    </Option>
                                    {methods.map((method) => (
                                        <Option key={method.value} value={method.value}>
                                            {method.label}
                                        </Option>
                                    ))}
                                </Select>
                                <Select
                                    placeholder="Select pathway database"
                                    value={selectedDatabase}
                                    onChange={(value) => setSelectedDatabase(value)}
                                    style={{width: '100%', marginBottom: 16}}
                                    disabled={!enablePathwayLevel}
                                >
                                    <Option value="" disabled>
                                        Select a pathway database
                                    </Option>
                                    {availableDatabases.map((db) => (
                                        <Option key={db} value={db}>
                                            {databaseNameMap[db] || db}
                                        </Option>
                                    ))}
                                </Select>
                                <Select
                                    placeholder="Select enrichment method"
                                    value={selectedEnrichmentMethod}
                                    onChange={(value) => setSelectedEnrichmentMethod(value)}
                                    style={{width: '100%', marginBottom: 16}}
                                    disabled={!enablePathwayLevel}
                                >
                                    <Option value="" disabled>
                                        Select an enrichment method
                                    </Option>
                                    {availableEnrichmentMethods.map((method) => (
                                        <Option key={method} value={method}>
                                            {method.toUpperCase()}
                                        </Option>
                                    ))}
                                </Select>
                                <TreeSelect
                                    style={{width: '100%'}}
                                    value={selectedPathwayAnalyses}
                                    onChange={setSelectedPathwayAnalyses}
                                    treeData={pathwayTreeData}
                                    treeCheckable={true}
                                    showCheckedStrategy={SHOW_CHILD}
                                    placeholder="Select analyses"
                                    multiple
                                    disabled={!enablePathwayLevel}
                                />
                            </>
                        )
                    }
                ]}
            />

            {/* Creating a meta-analysis runs R and writes results into the study, so it is not
                offered on a view-only import. Existing meta-analyses remain viewable. */}
            {!readOnly && (
                <Button
                    onClick={onComputeMetaAnalysis}
                    style={{marginBottom: 16}}
                    disabled={isProcessing || metaAnalyses.some(analysis =>
                        analysis.geneLevel?.status === 'processing' || analysis.pathwayLevel?.status === 'processing'
                    )}
                    type="primary"
                >
                    Create Meta-Analysis
                </Button>
            )}

            <Spin spinning={isMetaAnalysesLoading} tip="Loading meta analyses...">
                <Table
                    dataSource={metaAnalyses}
                    columns={columns}
                />
            </Spin>

            <Modal
                title="Confirm Removal"
                open={confirmOpen}
                onOk={handleConfirmOk}
                onCancel={handleConfirmCancel}
                okText="Yes"
                cancelText="No"
            >
                {selectedAnalysis && (
                    <p>Do you want to remove meta analysis "{selectedAnalysis.name}"?</p>
                )}
            </Modal>
        </div>
    );
}

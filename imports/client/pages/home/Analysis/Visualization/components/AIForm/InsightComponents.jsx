// InsightComponents.jsx - Components for viewing and managing insights

import React, {useState, useEffect, useMemo} from 'react';
import {
    Table,
    Checkbox,
    Tag,
    Card,
    Button,
    Space,
    Collapse,
    Typography,
    Spin,
    List,
    Tooltip,
    Empty,
    Modal,
    Flex,
    Dropdown,
    message,
    Layout,
    Input,
    Descriptions
} from 'antd';
import {
    CheckCircleOutlined,
    SyncOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    CloseCircleOutlined,
    ArrowLeftOutlined,
    DeleteOutlined,
    DownloadOutlined,
    ProfileOutlined,
    EyeOutlined,
    EditOutlined
} from '@ant-design/icons';
import { firstPanelKeys, insightItemModel, reportHeaderModel } from '/imports/utils/insightListModel';
import { capTags, moreTagLabel } from '/imports/utils/tagDisplay';
import { formatInterpretationContext } from '/imports/utils/interpretationContext';
import moment from 'moment';
import {
    extractPaperIds,
    createReferenceMapping,
    convertPaperIdsToNumbers,
    MarkdownWithReferences,
    getDatabaseMapping,
    buildPathwayMethodsData,
    getVirtualTableProps,
    extractMarkdownHeadings,
    buildTOCHierarchy
} from './utils';
import { exportToPDF, exportToWord } from '/imports/utils/reportExport';
import MarkdownTableOfContents from './MarkdownTableOfContents';
import {resolveConsensusOptions} from '/imports/methods/consensusConfig';
import AnalysisUtils from '/imports/client/pages/home/Analysis/Session/components/AnalysisUtils';
import {formatNumberForExport} from '/imports/utils/exportUtils';
import {authHeaders} from '/imports/client/utils/authHeaders';
import {useGlobalSettings} from '/imports/client/contexts/GlobalSettingsContext';

const {Title, Text} = Typography;

// Shared presentational list of insight/report items. Used by BOTH the default
// AI-interpretation page and the per-analysis InsightDashboard so the two views
// stay visually identical (status tag + View/Edit name/Delete + date). Deliberately
// carries no "publication-ready" tag — the Completed status tag already conveys it.
// Handlers receive the raw batch; `onEdit` is optional.
export const InsightList = ({batches, onView, onEdit, onDelete, getStatusTag, formatDate}) => (
    <List
        size="small"
        dataSource={batches}
        renderItem={(batch) => {
            const model = insightItemModel(batch);
            return (
                <List.Item
                    actions={[
                        <Button
                            key="view"
                            type="link"
                            size="small"
                            icon={<EyeOutlined/>}
                            onClick={() => onView(batch)}
                        >
                            View
                        </Button>,
                        // "Edit name", not "Edit": renaming is the only thing this does, and a bare
                        // "Edit" reads as though the report itself could be edited. Matches the
                        // wording already used for renaming a study (SelectOrgAndPath). The label
                        // says it, so the old "Rename report" tooltip is gone as redundant.
                        onEdit && (
                            <Button
                                key="edit"
                                type="link"
                                size="small"
                                icon={<EditOutlined/>}
                                onClick={() => onEdit(batch)}
                            >
                                Edit name
                            </Button>
                        ),
                        onDelete && (
                            <Tooltip key="delete" title="Delete report">
                                <Button
                                    type="link"
                                    size="small"
                                    danger
                                    icon={<DeleteOutlined/>}
                                    onClick={() => onDelete(batch)}
                                >
                                    Delete
                                </Button>
                            </Tooltip>
                        )
                    ].filter(Boolean)}
                >
                    <List.Item.Meta
                        title={
                            <Space>
                                <Text>{model.title}</Text>
                                {getStatusTag(model.statusKey)}
                            </Space>
                        }
                        description={
                            <Text type="secondary" style={{fontSize: 12}}>
                                {formatDate(model.createdAt)}
                            </Text>
                        }
                    />
                </List.Item>
            );
        }}
    />
);

// Process template result function
const processTemplateResult = async (prompt) => {
    try {
        // Remove any <think></think> content
        let processedResult = prompt.result?.answer || '';
        processedResult = processedResult.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        console.log('Processing template result for:', prompt.templateTitle);

        // Extract paper IDs from the content
        const { paperIds } = extractPaperIds(processedResult);
        console.log('Paper IDs found in text:', paperIds);

        if (paperIds.length === 0) {
            return {
                id: prompt._id,
                templateId: prompt.templateId,
                title: prompt.templateTitle,
                content: processedResult,
                references: [],
                referenceMapping: new Map(),
                orderedIds: []
            };
        }

        // Fetch reference data
        let allReferences = [];
        try {
            const referenceData = await Meteor.callAsync('queue.getReferences', paperIds);
            allReferences = referenceData.references || [];
            console.log('API returned references with paper IDs:', allReferences.map(r => r.paperId));
        } catch (error) {
            console.error('Error fetching references:', error);
        }

        // Filter out references with null bibtex_json
        const validReferences = allReferences.filter(ref => {
            const isValid = ref && ref.bibtex_json !== null && ref.bibtex_json !== undefined;
            if (!isValid) {
                console.log('Filtering out reference with null bibtex_json:', ref?.paperId);
            }
            return isValid;
        });

        console.log('Valid references after filtering:', validReferences.map(r => r.paperId));

        // Check for mismatches between text IDs and reference IDs
        paperIds.forEach(textId => {
            const found = validReferences.find(ref => ref.paperId === textId);
            if (!found) {
                console.warn(`Paper ID from text NOT found in references: "${textId}"`);
                console.warn(`Available reference IDs:`, validReferences.map(r => r.paperId));

                // Check for similar IDs (might help identify the issue)
                const similar = validReferences.filter(ref =>
                    ref.paperId.includes(textId.substring(0, 20)) ||
                    textId.includes(ref.paperId.substring(0, 20))
                );
                if (similar.length > 0) {
                    console.warn(`Found similar IDs:`, similar.map(r => r.paperId));
                }
            }
        });

        // Extract valid paper IDs (only those with valid bibtex_json)
        const validPaperIds = validReferences.map(ref => ref.paperId);

        // Create reference mapping only for valid references
        const { mapping, orderedIds } = createReferenceMapping(validPaperIds);
        console.log('Reference mapping:', Array.from(mapping.entries()));

        // Debug the conversion process
        console.log('Before conversion - sample text:', processedResult.substring(0, 500));
        const contentWithNumbers = convertPaperIdsToNumbers(processedResult, mapping);
        console.log('After conversion - sample text:', contentWithNumbers.substring(0, 500));

        // Check if any paper IDs remain in the text after conversion
        const remainingIds = extractPaperIds(contentWithNumbers);
        if (remainingIds.paperIds.length > 0) {
            console.warn('Paper IDs still remaining in text after conversion:', remainingIds.paperIds);
        }

        const result = {
            id: prompt._id,
            templateId: prompt.templateId,
            title: prompt.templateTitle,
            content: contentWithNumbers,
            references: validReferences,
            referenceMapping: mapping,
            orderedIds
        };

        console.log('Final result summary:', {
            title: result.title,
            originalPaperIds: paperIds.length,
            validReferences: validReferences.length,
            remainingUnconvertedIds: remainingIds.paperIds.length
        });

        return result;
    } catch (error) {
        console.error('Error processing template result:', error);
        return {
            id: prompt._id,
            templateId: prompt.templateId,
            title: prompt.templateTitle,
            content: prompt.result?.answer || '',
            references: [],
            referenceMapping: new Map(),
            orderedIds: []
        };
    }
};

// studyName / analysisName / reportName are optional context supplied by a host that knows where
// the report sits (AIInterpretation). They drive the persistent header: a user with several report
// versions for one analysis has to be able to see which one they are reading, at any scroll
// position. reportName in particular comes from the host's own batch list, which is reloaded after
// every rename, so the header follows a rename without a reload.
export const InsightViewer = ({batchId, onClose, setView, setSelectedInsight, studyName, analysisName, reportName}) => {
    // No `insight` state: it held the raw {batch, prompts} envelope purely so the title could read
    // `insight.insightName` off it, which never existed at that level. The header now names the
    // report from `batch` (queue.getBatchInfo returns the document itself) via reportHeaderModel.
    const [loading, setLoading] = useState(true);
    const [isOpenConsensus, setIsOpenConsensus] = useState(false);
    const [isOpenContext, setIsOpenContext] = useState(false);
    const [genes, setGenes] = useState([]);
    const [methodOrder, setMethodOrder] = useState([]);
    const [pathwayData, setPathwayData] = useState([]);
    const [batch, setBatch] = useState({});
    const [geneNameFilter, setGeneNameFilter] = useState('');
    const [pathwayNameFilter, setPathwayNameFilter] = useState('');
    const [processedTemplates, setProcessedTemplates] = useState([]);
    const [activeTemplateKey, setActiveTemplateKey] = useState('');
    const [activeReferenceId, setActiveReferenceId] = useState(null);

    useEffect(() => {
        const fetchInsight = async () => {
            try {
                const batchData = await Meteor.callAsync('queue.getBatchStatus', batchId);
                console.log('Batch data:', batchData);

                if (batchData?.prompts) {
                    // Process each completed prompt individually
                    const completedPrompts = batchData.prompts.filter(prompt =>
                        prompt.status === 'completed' && prompt.result
                    );

                    const processed = await Promise.all(
                        completedPrompts.map(prompt => processTemplateResult(prompt))
                    );

                    setProcessedTemplates(processed);

                    // Set the first template as active by default - convert to string
                    if (processed.length > 0) {
                        const firstTemplateKey = processed[0].id.toString();
                        setActiveTemplateKey(firstTemplateKey);
                    }
                }
            } catch (error) {
                console.error('Error fetching insight:', error);
            } finally {
                setLoading(false);
            }
        };

        const fetchBatch = async () => {
            try {
                const batch = await Meteor.callAsync('queue.getBatchInfo', batchId);
                setBatch(batch ?? {});
            } catch (error) {
                console.error('Error fetching batch:', error);
            }
        }

        fetchBatch()
        fetchInsight();
    }, [batchId]);

    useEffect(() => {
        if (batch && Object.keys(batch).length > 0) {
            const fetchDEGenes = async () => {
                try {
                    const batch = await Meteor.callAsync('queue.getBatchInfo', batchId);
                    const response = await fetch(`/api/deGenes?args=${btoa(JSON.stringify({
                        analysisId: batch.analysisId,
                        sessionId: batch.sessionId
                    }))}`, {headers: authHeaders()})

                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    const resJson = await response.json();
                    const geneData = resJson.map(gene => ({
                        id: gene._id,
                        name: gene.symbol,
                        foldChange: gene.FC,
                        absFoldChange: Math.abs(gene.FC),
                        description: gene.description,
                        ...(resJson.some(gene => gene.pValueFDR) ? {
                            pValueFDR: gene.pValueFDR ?? 0
                        } : {}),
                        ...(resJson.some(gene => gene.pValue) ? {
                            pValue: gene.pValue ?? 0
                        } : {})
                    })).sort((a, b) => a.pValue - b.pValue);

                    setGenes(geneData);
                } catch (error) {
                    console.error('Error fetching DE Genes:', error);
                }
            }

            const fetchAnalysisResults = async () => {
                try {
                    const sessionConfigs = await Meteor.callAsync('visualization.getConfigurations', {sessionId: batch.sessionId});
                    const config = Object.entries(sessionConfigs.allConfigs).filter(([id, value]) => id === batch.analysisId).map(([id, value]) => value)[0];
                    const analysis = sessionConfigs.analyses.filter(e => e.id === batch.analysisId)[0];

                    const response = await Meteor.callAsync('analysis.results.aggregate', {
                        analysisId: batch.analysisId,
                        inputType: analysis.input === config.inputType ? analysis.input : config.inputType,
                        geneSets: config.geneSets
                    })

                    const dbOrder = config.geneSets.sort((a, b) => config.selectedDatasets.indexOf(a.id) - config.selectedDatasets.indexOf(b.id)).map(db => db.namespace ? `${db.name}-${db.namespace}` : db.name);
                    const databases = Object.keys(response).sort((a, b) => dbOrder.indexOf(a) - dbOrder.indexOf(b));
                    if (methodOrder.length === 0) {
                        const methodSet = new Set()
                        const orderedMethods = []

                        databases.forEach(db => {
                            if (response[db].methods[0]) {
                                Object.keys(response[db].methods[0]).forEach(method => {
                                    const upperMethod = method.toUpperCase()
                                    if (!methodSet.has(upperMethod)) {
                                        methodSet.add(upperMethod)
                                        orderedMethods.push(upperMethod)
                                    }
                                })
                            }
                        })

                        setMethodOrder(orderedMethods.filter(method => batch.selectedMethods?.includes(method) && method.toLowerCase() !== 'consensus'))
                    }

                    const initialMethods = Array.from(new Set(
                        Object.values(response).flatMap(db =>
                            db.methods[0] ? Object.keys(db.methods[0]) : []
                        )
                    )).map(m => m.toUpperCase()).filter(method => batch.selectedMethods?.includes(method));

                    if (initialMethods.length === 1) {
                        const formattedData = await Promise.all(databases.map(async (db, index) => {
                            const dbResults = response[db].methods[0];
                            const uniquePathways = new Map();

                            const methodResults = dbResults[initialMethods[0].toLowerCase()] || [];
                            methodResults.forEach(pathway => {
                                uniquePathways.set(pathway.pathway, {
                                    id: `${db}:${pathway.pathway}`,
                                    originalId: pathway.pathway,
                                    name: pathway.name,
                                    pValue: pathway.pValue,
                                    pValueFDR: pathway.pValueFDR,
                                    score: pathway.score,
                                    database: db
                                });
                            });

                            return {
                                database: db,
                                pathways: Array.from(uniquePathways.values())
                            };
                        }));

                        setPathwayData(formattedData);
                    } else {
                        const dbMapping = await getDatabaseMapping();
                        const pathwayMethodsData = await buildPathwayMethodsData(response, databases, initialMethods);

                        const formattedData = await Promise.all(databases.map(async (db, index) => {
                            const uniquePathways = new Map();
                            const databaseId = dbMapping[db];

                            const consensusResults = await Meteor.callAsync('visualization.getConsensusAnalysisResult', {
                                enrichmentMethods: initialMethods,
                                analysisId: batch.analysisId,
                                databaseId: databaseId
                            });

                            if (consensusResults?.length > 0) {
                                consensusResults[0].value.forEach(pathway => {
                                    uniquePathways.set(pathway.ID, {
                                        id: `${db}:${pathway.ID}`,
                                        originalId: pathway.ID,
                                        name: pathway.name,
                                        pValue: pathway.pValue,
                                        pValueFDR: pathway.pValueFDR,
                                        score: pathway.score,
                                        database: db
                                    });
                                });
                            } else {
                                // Use the user's chosen algorithm + ranking (was hard-coded to
                                // RRA, ignoring the consensus_method/rankBy settings), and pass
                                // inputType so this lazy recompute upserts the SAME consensus
                                // document key the main pipeline writes (selector includes
                                // inputType) instead of a divergent one.
                                const {method: consensusMethod, rankBy: consensusRankBy} = resolveConsensusOptions(config?.methods?.consensus);
                                await Meteor.callAsync('consensus.analysis.pathway.compute', {
                                    selectedPathwayResData: pathwayMethodsData,
                                    selectedMethod: consensusMethod,
                                    selectedRankBy: consensusRankBy,
                                    enrichmentMethods: initialMethods,
                                    analysisId: batch.analysisId,
                                    databaseId: databaseId,
                                    name: "Analysis",
                                    inputType: analysis.input === config.inputType ? analysis.input : config.inputType
                                });

                                const newConsensusResults = await Meteor.callAsync('visualization.getConsensusAnalysisResult', {
                                    enrichmentMethods: initialMethods,
                                    analysisId: batch.analysisId,
                                    databaseId: databaseId
                                });

                                if (newConsensusResults?.length > 0) {
                                    newConsensusResults[0].value.forEach(pathway => {
                                        uniquePathways.set(pathway.ID, {
                                            id: `${db}:${pathway.ID}`,
                                            originalId: pathway.ID,
                                            name: pathway.name,
                                            pValue: pathway.pValue,
                                            pValueFDR: pathway.pValueFDR,
                                            score: pathway.score,
                                            database: db
                                        });
                                    });
                                }
                            }

                            return {
                                database: db,
                                pathways: Array.from(uniquePathways.values())
                            };
                        }));

                        setPathwayData(formattedData);
                    }
                } catch (error) {
                    console.error('Error fetching analysis results:', error);
                }
            }

            fetchAnalysisResults()
            fetchDEGenes()
        }
    }, [batch])

    const handleReferenceClick = (refNumber) => {
        setActiveReferenceId(refNumber);
    };

    // Export handlers
    const handleExport = async (format) => {
        if (!processedTemplates || processedTemplates.length === 0) {
            message.error('No report content to export');
            return;
        }

        // Export the report that is actually on screen: the collapse panel the user has open,
        // falling back to the first template (which is the final report in workflow mode).
        const activeTemplate = processedTemplates.find(t => t.id.toString() === activeTemplateKey);
        const reportContent = (activeTemplate || processedTemplates[0])?.content;
        if (!reportContent) {
            message.error('Report content is empty');
            return;
        }

        const filename = `pathway-analysis-report-${Date.now()}`;

        try {
            message.loading(`Exporting to ${format.toUpperCase()}...`, 0);

            if (format === 'pdf') {
                const result = await exportToPDF(reportContent, `${filename}.pdf`);
                message.destroy();
                if (result.success) {
                    message.success('PDF exported successfully');
                } else {
                    message.error(`Export failed: ${result.error}`);
                }
            } else if (format === 'word') {
                const result = await exportToWord(reportContent, `${filename}.docx`);
                message.destroy();
                if (result.success) {
                    message.success('Word document exported successfully');
                } else {
                    message.error(`Export failed: ${result.error}`);
                }
            }
        } catch (error) {
            message.destroy();
            message.error(`Export failed: ${error.message}`);
            console.error('Export error:', error);
        }
    };

    const exportMenuItems = [
        {
            key: 'pdf',
            label: 'Export as PDF',
            onClick: () => handleExport('pdf')
        },
        {
            key: 'word',
            label: 'Export as Word',
            onClick: () => handleExport('word')
        }
    ];

    const handleCollapseChange = (activeKeys) => {
        console.log('Collapse change - activeKeys:', activeKeys);
        if (activeKeys.length > 0) {
            console.log('Setting activeTemplateKey to:', activeKeys[0]);
            setActiveTemplateKey(activeKeys[0]);
            setActiveReferenceId(null); // Reset active reference when switching templates
        } else {
            console.log('No active keys, clearing activeTemplateKey');
            setActiveTemplateKey('');
        }
    };

    const deGenesDataMemo = useMemo(() => {
        if (geneNameFilter !== '') {
            if (geneNameFilter.includes(',')) {
                const geneNames = geneNameFilter.split(',').map(name => name.trim())
                return genes.filter(gene => geneNames.some(name => gene.name.toLowerCase().includes(name.toLowerCase())))
            }
            return genes.filter(gene => gene.name.toLowerCase().includes(geneNameFilter.toLowerCase()))
        } else {
            return genes
        }
    }, [genes, geneNameFilter])

    const pathwayDataMemo = useMemo(() => {
        if (pathwayNameFilter !== '') {
            if (pathwayNameFilter.includes(',')) {
                const pathwayNames = pathwayNameFilter.split(',').map(name => name.trim())
                return pathwayData.map(db => ({
                    ...db,
                    pathways: db.pathways.filter(pathway => pathwayNames.some(name => pathway.name.toLowerCase().includes(name.toLowerCase())))
                }))
            }
            return pathwayData.map(db => ({
                ...db,
                pathways: db.pathways.filter(pathway => pathway.name.toLowerCase().includes(pathwayNameFilter.toLowerCase()))
            }))
        }
        return pathwayData
    }, [pathwayData, pathwayNameFilter])

    const deGenesTable = () => {
        if (!batch || Object.keys(batch).length === 0) return <></>
        const deGenesTableColumns = [
            {
                title: 'Select',
                key: 'select',
                width: 100,
                fixed: 'left',
                render: (_, record) => (
                    <Checkbox
                        checked={batch.selectedGenes.some(g => g.id === record.id)}
                        disabled={true}
                    />
                ),
            },
            {
                title: 'ID',
                dataIndex: 'id',
                key: 'id',
                width: 150,
                ellipsis: true
            },
            {
                title: (
                    <Space direction={'vertical'} style={{width: '100%'}}>
                        <Space>
                            <Typography.Text>Name</Typography.Text>
                        </Space>
                    </Space>
                ),
                dataIndex: 'name',
                key: 'name',
                width: 200,
                ellipsis: true
            },
            {
                title: 'Description',
                dataIndex: 'description',
                key: 'description',
                width: 300,
                ellipsis: true
            },
            ...(deGenesDataMemo.every(gene => gene.pValue) ? [{
                title: 'pValue',
                dataIndex: 'pValue',
                key: 'pValue',
                width: 150,
                render: val => val?.toExponential(3),
                sorter: (a, b) => a.pValue - b.pValue,
                sortDirections: ['ascend', 'descend', 'ascend'],
                defaultSortOrder: 'ascend',
            }] : []),
            ...(deGenesDataMemo.every(gene => gene.pValueFDR) ? [{
                title: 'pValue.FDR',
                dataIndex: 'pValueFDR',
                key: 'pValueFDR',
                width: 150,
                render: val => val?.toExponential(3),
                sorter: (a, b) => a.pValueFDR - b.pValueFDR,
                sortDirections: ['ascend', 'descend', 'ascend'],
            }] : []),
            {
                // Fold change is log2 across all analysis types (expression, meta —
                // normalized at the API — and PGSEA, which the app filters/plots as log2).
                title: 'Log2FC',
                dataIndex: 'foldChange',
                key: 'foldChange',
                width: 150,
                render: val => val?.toFixed(3),
                sorter: (a, b) => b.foldChange - a.foldChange,
                sortDirections: ['ascend', 'descend', 'ascend'],
            },
        ]

        return (
            <Space direction="vertical" style={{width: '100%'}}>
                {batch && batch.selectedGenes && batch.selectedGenes.length > 0 && (() => {
                    const {visible, extraCount} = capTags(batch.selectedGenes);
                    return (
                        <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                            <Text type="secondary">Selected genes:</Text>
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                {visible.map(gene => (
                                    <Tag key={gene.id}>
                                        {gene.name}
                                    </Tag>
                                ))}
                                {extraCount > 0 && <Tag>{moreTagLabel(extraCount, 'genes')}</Tag>}
                            </div>
                        </div>
                    );
                })()}

                {/* NOTE: this is a READ-ONLY viewer of a generated report — the Select checkboxes
                    are disabled and batch.selectedGenes is fixed. The DE-gene threshold filter +
                    "Use all DE Genes" button that live in the editable AnalysisWizard table have
                    no meaning here (nothing to re-select), so they are intentionally omitted. */}
                <div>
                    <Button
                        icon={<DownloadOutlined/>}
                        disabled={deGenesDataMemo.length === 0}
                        onClick={() => AnalysisUtils.exportTableCsv({
                            rows: deGenesDataMemo,
                            columns: [
                                {header: 'Gene ID', field: 'id'},
                                {header: 'Symbol', field: 'name'},
                                {header: 'Description', field: 'description'},
                                ...(deGenesDataMemo.every(gene => gene.pValue)
                                    ? [{header: 'pValue', field: 'pValue', format: formatNumberForExport}] : []),
                                ...(deGenesDataMemo.every(gene => gene.pValueFDR)
                                    ? [{header: 'pValue.FDR', field: 'pValueFDR', format: formatNumberForExport}] : []),
                                {header: 'Log2FC', field: 'foldChange', format: formatNumberForExport},
                            ],
                            fileName: 'DEGenes.csv',
                        })}
                    >
                        Download CSV
                    </Button>
                </div>
                <Table
                    {...getVirtualTableProps()}
                    columns={deGenesTableColumns}
                    dataSource={deGenesDataMemo}
                    rowKey={'id'}
                />
            </Space>
        )
    }

    const getPathwayCollapseItems = () => {
        if (!batch || Object.keys(batch).length === 0) return []
        const pathwayTableColumns = [
            {
                title: 'Select',
                key: 'select',
                width: 100,
                fixed: 'left',
                render: (_, record) => (
                    <Checkbox
                        checked={batch.selectedPathways.some(p => p.id === record.id)}
                        disabled={true}
                    />
                ),
            },
            {
                title: 'ID',
                dataIndex: 'originalId',
                key: 'originalId',
                width: 150,
                ellipsis: true
            },
            {
                title: (
                    <Space direction={'vertical'} style={{width: '100%'}}>
                        <Space>
                            <Typography.Text>Name</Typography.Text>
                        </Space>
                    </Space>
                ),
                dataIndex: 'name',
                key: 'name',
                width: 200,
                ellipsis: true
            },
            {
                title: 'pValue',
                dataIndex: 'pValue',
                key: 'pValue',
                width: 150,
                render: val => val.toExponential(3),
                sorter: (a, b) => a.pValue - b.pValue,
                sortDirections: ['ascend', 'descend', 'ascend'],
                defaultSortOrder: 'ascend',
            },
            {
                title: 'pValue.FDR',
                dataIndex: 'pValueFDR',
                key: 'pValueFDR',
                width: 150,
                render: val => val.toExponential(3),
                sorter: (a, b) => a.pValueFDR - b.pValueFDR,
                sortDirections: ['ascend', 'descend', 'ascend'],
            },
            {
                title: 'Score',
                dataIndex: 'score',
                key: 'score',
                width: 150,
                render: val => val?.toFixed(3),
                sorter: (a, b) => a.score - b.score,
                sortDirections: ['ascend', 'descend', 'ascend'],
            },
        ]
        return pathwayData.map(db => ({
            key: db.database,
            label: db.database,
            children: (
                <Space direction={'vertical'} style={{width: '100%'}} size={'large'}>
                    {batch.selectedPathways.filter(p => p.database === db.database).length > 0 && (() => {
                        const dbSelected = batch.selectedPathways.filter(p => p.database === db.database);
                        const {visible, extraCount} = capTags(dbSelected);
                        return (
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                <Text type="secondary">Selected pathways:</Text>
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                    {visible.map(pathway => (
                                        <Tag key={pathway.id}>
                                            {pathway.name}
                                        </Tag>
                                    ))}
                                    {extraCount > 0 && <Tag>{moreTagLabel(extraCount, 'pathways')}</Tag>}
                                </div>
                            </div>
                        );
                    })()}

                    <Table
                        {...getVirtualTableProps()}
                        columns={pathwayTableColumns}
                        dataSource={pathwayDataMemo.find(data => data.database === db.database)?.pathways || []}
                        rowKey={'id'}
                    />
                </Space>
            )
        }))
    }

    // Extract TOC from the active template's markdown content (must be before early returns)
    const tocStructure = useMemo(() => {
        if (loading || !processedTemplates || processedTemplates.length === 0) return [];

        // Get the active template (currently opened in collapse)
        const activeTemplate = processedTemplates.find(t => t.id.toString() === activeTemplateKey);
        if (!activeTemplate || !activeTemplate.content) return [];

        // Extract headings and filter to only level 1 and 2
        const headings = extractMarkdownHeadings(activeTemplate.content);
        const filteredHeadings = headings.filter(h => h.level === 1 || h.level === 2);
        return buildTOCHierarchy(filteredHeadings);
    }, [processedTemplates, activeTemplateKey, loading]);

    // Which report this is, and where it sits. Same title the list item shows — one definition, so
    // the two can never disagree. Computed before the loading return so the user can see WHICH
    // report is opening; the host already knows the name, no fetch required.
    const header = reportHeaderModel({batch, studyName, analysisName, reportName});
    const trail = [header.studyName, header.analysisName].filter(Boolean);

    if (loading) {
        return (
            <div style={{padding: '24px'}}>
                <Title level={4} style={{margin: 0}}>{header.reportTitle}</Title>
                {trail.length > 0 && (
                    <Text type="secondary" style={{fontSize: 12}}>{trail.join('  ›  ')}</Text>
                )}
                <div className="flex justify-center items-center h-64">
                    <Spin size="large"/>
                </div>
            </div>
        );
    }

    const collapseItems = processedTemplates.map(template => {
        console.log('Creating collapse item for template:', {
            id: template.id,
            title: template.title,
            contentLength: template.content?.length || 0,
            referencesCount: template.references?.length || 0,
            hasReferences: template.references && template.references.length > 0,
        });

        return {
            key: template.id.toString(), // Convert ObjectID to string
            label: (
                <span>
                {template.title}
                    {template.references && template.references.length > 0 && (
                        <span style={{marginLeft: '8px', fontSize: '12px', color: '#666'}}>
                        ({template.references.length} refs)
                    </span>
                    )}
            </span>
            ),
            children: (
                <MarkdownWithReferences
                    content={template.content}
                    references={template.references}
                    referenceMapping={template.referenceMapping}
                    onReferenceClick={handleReferenceClick}
                />
            )
        };
    });

    return (
        <div style={{padding: '24px'}}>
            {/* Persistent header. The report title used to live inside the scrolling content
                container below, so it left the screen as soon as the user read into the report —
                exactly when knowing which version they are reading starts to matter. Sticky, and
                pulled out to the container's edges by the negative margin so nothing scrolls
                through beside it. top clears the app header, matching the page's own side rail. */}
            <div
                style={{
                    position: 'sticky',
                    top: 70,
                    zIndex: 10,
                    background: '#fff',
                    margin: '-24px -24px 16px',
                    padding: '16px 24px',
                    borderBottom: '1px solid #f0f0f0',
                }}
            >
                <Flex
                    style={{
                        width: '100%',
                        justifyContent: 'space-between',
                    }}
                >
                    <Button
                        onClick={() => {
                            setView('dashboard');
                            setSelectedInsight(null);
                        }}
                        icon={<ArrowLeftOutlined/>}
                    >
                        Back to Insights
                    </Button>
                    <Space>
                        <Dropdown menu={{ items: exportMenuItems }}>
                            <Button icon={<DownloadOutlined/>}>
                                Export Report
                            </Button>
                        </Dropdown>
                        <Button
                            icon={<ProfileOutlined/>}
                            onClick={() => setIsOpenContext(true)}
                        >
                            Review Context
                        </Button>
                        <Button
                            icon={<FileTextOutlined/>}
                            type={'primary'}
                            onClick={() => setIsOpenConsensus(true)}
                        >
                            View Consensus Results
                        </Button>
                    </Space>
                </Flex>
                <div style={{marginTop: 12}}>
                    {trail.length > 0 && (
                        <Text type="secondary" style={{fontSize: 12, display: 'block'}}>
                            {trail.join('  ›  ')}
                        </Text>
                    )}
                    <Title level={4} style={{margin: 0}} ellipsis={{tooltip: header.reportTitle}}>
                        {header.reportTitle}
                    </Title>
                </div>
            </div>

            {/* Both modals are portals, so they render outside this tree wherever they sit; keeping
                them out of the toolbar row means they are not flex items by accident. */}
            <Modal
                title="Interpretation Context"
                open={isOpenContext}
                footer={null}
                onCancel={() => setIsOpenContext(false)}
                width={720}
                style={{ top: 20 }}
            >
                {(() => {
                    const contextRows = formatInterpretationContext(batch);
                    if (contextRows.length === 0) {
                        return (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="No context was recorded for this report."
                            />
                        );
                    }
                    return (
                        <Descriptions
                            column={1}
                            bordered
                            size="small"
                        >
                            {contextRows.map((row, index) => (
                                <Descriptions.Item key={index} label={row.label}>
                                    {row.value}
                                </Descriptions.Item>
                            ))}
                        </Descriptions>
                    );
                })()}
            </Modal>
            <Modal
                title="Consensus Results"
                open={isOpenConsensus}
                footer={null}
                onCancel={() => setIsOpenConsensus(false)}
                width={960}
                style={{
                    top: 20,
                    maxHeight: '95vh',
                    overflowY: 'auto',
                }}
            >
                <Space
                    direction={'vertical'}
                    style={{
                        width: '100%',
                    }}
                >
                    <Card title={'Statistical Methods'}>
                        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px'}}>
                            {methodOrder.map((methodId, index) => (
                                <Typography.Text key={index}>{index + 1}. {methodId}</Typography.Text>
                            ))}
                        </div>
                    </Card>
                    <Card title={"Pathways"}>
                        {(() => {
                            const pathwayItems = getPathwayCollapseItems();
                            return (
                                <Collapse
                                    defaultActiveKey={firstPanelKeys(pathwayItems)}
                                    items={pathwayItems}
                                />
                            );
                        })()}
                    </Card>
                    {
                        genes && genes.length > 0 && (
                            <Card title={"DE Genes"}>
                                {deGenesTable()}
                            </Card>
                        )
                    }
                </Space>
            </Modal>

            <Layout style={{background: 'white'}}>
                {tocStructure && tocStructure.length > 0 && (
                    <Layout.Sider
                        width={280}
                        style={{
                            background: '#fff',
                            padding: '16px 8px',
                            borderRight: '1px solid #f0f0f0'
                        }}
                        breakpoint="lg"
                        collapsedWidth="0"
                    >
                        <MarkdownTableOfContents headings={tocStructure} />
                    </Layout.Sider>
                )}
                <Layout.Content style={{padding: '0 24px', minHeight: '100vh'}}>
                    <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
                        <div style={{
                            flex: 1,
                            display: 'flex',
                            gap: '24px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                flex: 1,
                                overflowY: 'auto',
                                padding: '20px'
                            }}>
                                <Card className="shadow-sm">
                                    {/* The report's name lives in the persistent header above,
                                        not here. It used to be rendered at this spot, inside the
                                        scrolling container — and from `insight?.insightName`,
                                        which is always undefined: queue.getBatchStatus answers
                                        {batch, prompts}, so the name is one level down. Every
                                        report was therefore titled "Analysis Insight". */}
                            {batch?.workflowType === 'publication-ready' && processedTemplates.length > 0 && processedTemplates[0]?.result?.metadata && (
                                <Card
                                    size="small"
                                    style={{marginBottom: '24px', backgroundColor: '#f0f5ff', borderColor: '#adc6ff'}}
                                    title={
                                        <Space>
                                            <Tag color="blue">📋 Complete Publication-Ready Workflow (13 Steps)</Tag>
                                            <Text type="secondary">Comprehensive analysis with fact-checking</Text>
                                        </Space>
                                    }
                                >
                                    <Space direction="vertical" style={{width: '100%', gap: 12}}>
                                        <div>
                                            <Text strong style={{display: 'block', marginBottom: 8}}>Quality & Validation:</Text>
                                            <Space wrap>
                                                <Text strong>Quality Score:</Text>
                                                <Tag color="cyan">{processedTemplates[0].result.metadata.qualityScore || 'N/A'}/10</Tag>
                                                {processedTemplates[0].result.metadata.validationStatus && (
                                                    <>
                                                        <Text strong>Validation:</Text>
                                                        <Tag color={processedTemplates[0].result.metadata.validationStatus === 'validated' ? 'green' : 'orange'}>
                                                            {processedTemplates[0].result.metadata.validationStatus}
                                                        </Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.biologicalPlausibility && (
                                                    <>
                                                        <Text strong>Plausibility:</Text>
                                                        <Tag>{processedTemplates[0].result.metadata.biologicalPlausibility}</Tag>
                                                    </>
                                                )}
                                            </Space>
                                        </div>

                                        <div>
                                            <Text strong style={{display: 'block', marginBottom: 8}}>Pathway Analysis:</Text>
                                            <Space wrap>
                                                {processedTemplates[0].result.metadata.themesCount > 0 && (
                                                    <>
                                                        <Text strong>Themes:</Text>
                                                        <Tag>{processedTemplates[0].result.metadata.themesCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.criticalPathwaysCount > 0 && (
                                                    <>
                                                        <Text strong>Critical Pathways:</Text>
                                                        <Tag color="red">{processedTemplates[0].result.metadata.criticalPathwaysCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.novelPathwaysCount > 0 && (
                                                    <>
                                                        <Text strong>Novel:</Text>
                                                        <Tag color="purple">{processedTemplates[0].result.metadata.novelPathwaysCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.activatedPathwaysCount > 0 && (
                                                    <>
                                                        <Text strong>Activated:</Text>
                                                        <Tag color="green">{processedTemplates[0].result.metadata.activatedPathwaysCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.suppressedPathwaysCount > 0 && (
                                                    <>
                                                        <Text strong>Suppressed:</Text>
                                                        <Tag color="orange">{processedTemplates[0].result.metadata.suppressedPathwaysCount}</Tag>
                                                    </>
                                                )}
                                            </Space>
                                        </div>

                                        <div>
                                            <Text strong style={{display: 'block', marginBottom: 8}}>Gene-Level Insights:</Text>
                                            <Space wrap>
                                                {processedTemplates[0].result.metadata.hubGenesCount > 0 && (
                                                    <>
                                                        <Text strong>Hub Genes:</Text>
                                                        <Tag color="volcano">{processedTemplates[0].result.metadata.hubGenesCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.masterRegulatorsCount > 0 && (
                                                    <>
                                                        <Text strong>Master Regulators:</Text>
                                                        <Tag color="magenta">{processedTemplates[0].result.metadata.masterRegulatorsCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.pathwayInteractionsCount > 0 && (
                                                    <>
                                                        <Text strong>Interactions:</Text>
                                                        <Tag>{processedTemplates[0].result.metadata.pathwayInteractionsCount}</Tag>
                                                    </>
                                                )}
                                            </Space>
                                        </div>

                                        <div>
                                            <Text strong style={{display: 'block', marginBottom: 8}}>Hypotheses & Therapeutic:</Text>
                                            <Space wrap>
                                                {processedTemplates[0].result.metadata.hypothesesCount > 0 && (
                                                    <>
                                                        <Text strong>Hypotheses:</Text>
                                                        <Tag color="geekblue">{processedTemplates[0].result.metadata.hypothesesCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.drugTargetsCount > 0 && (
                                                    <>
                                                        <Text strong>Drug Targets:</Text>
                                                        <Tag color="gold">{processedTemplates[0].result.metadata.drugTargetsCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.repurposingOpportunitiesCount > 0 && (
                                                    <>
                                                        <Text strong>Repurposing:</Text>
                                                        <Tag color="lime">{processedTemplates[0].result.metadata.repurposingOpportunitiesCount}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.validationExperimentsCount > 0 && (
                                                    <>
                                                        <Text strong>Experiments:</Text>
                                                        <Tag>{processedTemplates[0].result.metadata.validationExperimentsCount}</Tag>
                                                    </>
                                                )}
                                            </Space>
                                        </div>

                                        <div>
                                            <Text strong style={{display: 'block', marginBottom: 8}}>Literature & References:</Text>
                                            <Space wrap>
                                                {processedTemplates[0].result.metadata.claimsVerified !== undefined && (
                                                    <>
                                                        <Text strong>Verified Claims:</Text>
                                                        <Tag color="green">{processedTemplates[0].result.metadata.claimsVerified}</Tag>
                                                    </>
                                                )}
                                                {processedTemplates[0].result.metadata.referencesCount > 0 && (
                                                    <>
                                                        <Text strong>PubMed References:</Text>
                                                        <Tag color="blue">{processedTemplates[0].result.metadata.referencesCount} citations</Tag>
                                                    </>
                                                )}
                                            </Space>
                                        </div>
                                    </Space>
                                </Card>
                            )}

                            {processedTemplates.length > 0 ? (
                                <Collapse
                                    activeKey={activeTemplateKey ? [activeTemplateKey.toString()] : []}
                                    onChange={handleCollapseChange}
                                    items={collapseItems}
                                    accordion
                                />
                            ) : (
                                <Empty description="No completed templates available"/>
                            )}
                                </Card>
                            </div>
                        </div>
                    </div>
                </Layout.Content>
            </Layout>
        </div>
    );
};

export const InsightDashboard = ({userId, sessionId, onViewInsight}) => {
    // True for a view-only imported study; supplied by the Visualization page's provider.
    const {readOnly} = useGlobalSettings();
    const [batchesData, setBatchesData] = useState([]);
    const [renamingBatch, setRenamingBatch] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [renameSaving, setRenameSaving] = useState(false);

    useEffect(() => {
        const fetchBatches = async () => {
            try {
                const batches = await Meteor.callAsync('queue.getBatchesBySession', {userId, sessionId});

                // Organize batches by analysis
                const batchesByAnalysis = batches.filter(b => b.prompts.length > 0).reduce((acc, batch) => {
                    if (!acc[batch.analysisId]) {
                        acc[batch.analysisId] = {
                            analysisName: batch.analysisName || `Analysis`,
                            batches: []
                        };
                    }
                    acc[batch.analysisId].batches.push(batch);
                    return acc;
                }, {});

                // Sort batches within each analysis
                Object.values(batchesByAnalysis).forEach(analysis => {
                    analysis.batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                });

                const organizedBatches = Object.entries(batchesByAnalysis).map(([analysisId, data]) => ({
                    analysisId,
                    analysisName: data.analysisName,
                    batches: data.batches.map((batch, index) => ({
                        ...batch,
                        insightNumber: data.batches.length - index
                    }))
                }));

                setBatchesData(organizedBatches);
            } catch (error) {
                console.error('Error fetching batches:', error);
                setBatchesData([]);
            }
        };

        fetchBatches();

        // Set up an interval to refresh data
        const intervalId = setInterval(fetchBatches, 5000); // Refresh every 5 seconds

        return () => clearInterval(intervalId); // Cleanup interval on unmount
    }, [userId]);

    const getStatusTag = (status) => {
        switch (status) {
            case 'completed':
                return (
                    <Tag icon={<CheckCircleOutlined/>} color="success">
                        Completed
                    </Tag>
                );
            case 'processing':
                return (
                    <Tag icon={<SyncOutlined spin/>} color="processing">
                        Processing
                    </Tag>
                );
            case 'pending':
                return (
                    <Tag icon={<ClockCircleOutlined/>} color="default">
                        In Queue
                    </Tag>
                );
            case 'error':
            case 'failed':
                return (
                    <Tag icon={<CloseCircleOutlined/>} color="error">
                        Failed
                    </Tag>
                );
            default:
                return status ? <Tag>{status}</Tag> : null;
        }
    };

    const formatDate = (date) => {
        if (!date) return '';
        return new Date(date).toLocaleString();
    };

    const removeBatchFromState = (batchId) =>
        setBatchesData((prev) =>
            prev.map((b) => ({...b, batches: b.batches.filter((i) => i._id !== batchId)}))
        );

    const handleDelete = (batch) => {
        Modal.confirm({
            title: 'Delete this report?',
            content: `"${batch.insightName || 'Untitled report'}" will be permanently removed.`,
            okText: 'Delete',
            okButtonProps: {danger: true},
            onOk: async () => {
                await Meteor.callAsync('queue.removeBatch', batch._id);
                removeBatchFromState(batch._id);
            }
        });
    };

    const openRename = (batch) => {
        setRenamingBatch(batch);
        setRenameValue(batch.insightName || '');
    };

    const handleRenameSave = async () => {
        if (!renamingBatch) return;
        setRenameSaving(true);
        try {
            await Meteor.callAsync('queue.updateBatchName', renamingBatch._id, renameValue);
            setBatchesData((prev) =>
                prev.map((b) => ({
                    ...b,
                    batches: b.batches.map((i) =>
                        i._id === renamingBatch._id ? {...i, insightName: renameValue} : i
                    )
                }))
            );
            setRenamingBatch(null);
        } finally {
            setRenameSaving(false);
        }
    };

    if (!batchesData?.length) {
        return (
            <div className="flex justify-center items-center h-64">
                <Empty
                    description="No insights generated yet"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {batchesData.map(({analysisId, analysisName, batches}) => (
                <Card key={analysisId} className="shadow-sm">
                    <Title level={4}>{analysisName}</Title>
                    {/* Reports stay fully readable on a view-only import; only renaming and
                        deleting are withheld, since both write to the study. Passing undefined
                        omits the buttons — InsightList already filters them out. */}
                    <InsightList
                        batches={batches}
                        onView={(batch) => onViewInsight(batch._id)}
                        onEdit={readOnly ? undefined : openRename}
                        onDelete={readOnly ? undefined : handleDelete}
                        getStatusTag={getStatusTag}
                        formatDate={formatDate}
                    />
                </Card>
            ))}

            <Modal
                title="Rename report"
                open={!!renamingBatch}
                onOk={handleRenameSave}
                onCancel={() => setRenamingBatch(null)}
                confirmLoading={renameSaving}
                okText="Save"
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={handleRenameSave}
                    placeholder="Report name"
                />
            </Modal>
        </div>
    );
};
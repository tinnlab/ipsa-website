// AnalysisWizard.jsx - Main wizard component and pathway analysis

import React, {useState, useRef, useCallback, useMemo, useEffect} from 'react';
import {
    Steps,
    Select,
    Table,
    Checkbox,
    Tag,
    Card,
    Radio,
    Button,
    Space,
    Input,
    InputNumber,
    Collapse,
    Typography,
    Spin,
    Modal,
    TreeSelect,
    Tabs,
    Divider,
    notification
} from 'antd';
import {
    ArrowLeftOutlined,
    ExclamationCircleOutlined,
    PlusOutlined,
    BulbOutlined,
    SearchOutlined,
    InfoCircleOutlined,
    ThunderboltOutlined
} from '@ant-design/icons';
import {debounce} from 'lodash';
import {useTracker} from "meteor/react-meteor-data";
import MethodSettings from "../../../../../../../methods/settings";
import {
    comparePathways,
    selectPathways,
    DEFAULT_SORT,
    SELECTION_MODES,
    PATHWAY_COLUMNS
} from "../../../../../../../utils/pathwaySelection";
import {
    selectTopGenes,
    selectAnalysisDEGenes,
    originalDEThresholds,
    DEFAULT_GENE_TOP_N
} from "../../../../../../../utils/geneSelection";
import {
    collectSubmissionSelections,
    describeSelectedSections
} from "../../../../../../../utils/aiSectionGating";
import { capTags, moreTagLabel } from "../../../../../../../utils/tagDisplay";
import { aggregateMetadataValue } from "../../../../../../../utils/metadataValues";
import { firstPanelKeys, resolveViewInsight, resolveExitWizard } from "../../../../../../../utils/insightListModel";
import { useGlobalSettings } from "../../../../../../contexts/GlobalSettingsContext";

// Import components and utilities
import {InsightViewer, InsightDashboard} from './InsightComponents';
import PipelineProgress from '../../../../AIInterpretation/PipelineProgress';
import {
    DEFAULT_SELECTED_SECTIONS
} from './constants';
import {
    getDatabaseMapping,
    buildPathwayMethodsData,
    organizeAnalysesForPrompt,
    formatPathwayList,
    getVirtualTableProps
} from './utils';
import {
    COMMON_TISSUES,
    DISEASES,
    CONDITIONS,
    CONTROL_TYPES
} from './contextTemplates';
import MetadataTemplateModal from './MetadataTemplateModal';
import {authHeaders} from '/imports/client/utils/authHeaders';

const {Title, Paragraph, Text} = Typography;
const {Panel} = Collapse;
const {TabPane} = Tabs;
const {Option} = Select;

// Virtual table components
const VirtualPathwayTable = ({data, selectedPathways, onSelectionChange, onSortChange}) => {
    const columns = [
        {
            title: 'Select',
            key: 'select',
            width: 100,
            fixed: 'left',
            render: (_, record) => (
                <Checkbox
                    checked={selectedPathways.some(p => p.id === record.id)}
                    onChange={e => {
                        if (e.target.checked) {
                            onSelectionChange([...selectedPathways, record]);
                        } else {
                            onSelectionChange(selectedPathways.filter(p => p.id !== record.id));
                        }
                    }}
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
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            width: 200,
            ellipsis: true,
            sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
            filterDropdown: ({setSelectedKeys, selectedKeys, confirm, clearFilters}) => (
                <div style={{padding: 8}}>
                    <Input
                        placeholder="Search name"
                        value={selectedKeys[0]}
                        onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                        onPressEnter={confirm}
                        style={{marginBottom: 8, display: 'block'}}
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
                        <Button onClick={() => { clearFilters(); confirm(); }} size="small" style={{width: 90}}>
                            Reset
                        </Button>
                    </Space>
                </div>
            ),
            filterIcon: filtered => <SearchOutlined style={{color: filtered ? '#1890ff' : undefined}} />,
            onFilter: (value, record) => (record.name || '').toLowerCase().includes(value.toLowerCase())
        },
        {
            title: 'pValue',
            dataIndex: 'pValue',
            key: 'pValue',
            width: 150,
            render: val => val?.toExponential(3),
            sorter: comparePathways(PATHWAY_COLUMNS.P_VALUE),
            // Default sort: pValue ascending. "Top N" follows whatever the table is
            // sorted by, so this also drives the initial top selection on load.
            defaultSortOrder: 'ascend',
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
        {
            title: 'pValue.FDR',
            dataIndex: 'pValueFDR',
            key: 'pValueFDR',
            width: 150,
            render: val => val?.toExponential(3),
            sorter: comparePathways(PATHWAY_COLUMNS.P_VALUE_FDR),
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
        {
            title: 'Score',
            dataIndex: 'score',
            key: 'score',
            width: 150,
            render: val => val?.toFixed(3),
            // Ranks by absolute score, so sorting descending surfaces the most
            // enriched pathways (positive or negative) first.
            sorter: comparePathways(PATHWAY_COLUMNS.SCORE),
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
    ];

    return (
        <>
            <style>{`
                .significant-row {
                    background-color: #e6f7ff !important;
                }
                .significant-row:hover {
                    background-color: #bae7ff !important;
                }
            `}</style>
            <Table
                {...getVirtualTableProps()}
                columns={columns}
                dataSource={data}
                rowKey="id"
                rowClassName={(record) => record.pValueFDR < 0.05 ? 'significant-row' : ''}
                onChange={(pagination, filters, sorter, extra) => {
                    // Only react to sort changes (not name-filter / pagination), so the
                    // top selection isn't reshuffled when the user just filters the table.
                    if (!onSortChange || extra?.action !== 'sort') return;
                    onSortChange({
                        columnKey: sorter?.columnKey || DEFAULT_SORT.columnKey,
                        order: sorter?.order || DEFAULT_SORT.order,
                    });
                }}
            />
        </>
    );
};

const VirtualGeneTable = ({data, selectedGenes, onSelectionChange, analyses, selectedAnalyses}) => {
    const columns = [
        {
            title: 'Select',
            key: 'select',
            width: 100,
            fixed: 'left',
            render: (_, record) => (
                <Checkbox
                    checked={selectedGenes.some(g => g.id === record.id)}
                    onChange={e => {
                        if (e.target.checked) {
                            onSelectionChange([...selectedGenes, record]);
                        } else {
                            onSelectionChange(selectedGenes.filter(g => g.id !== record.id));
                        }
                    }}
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
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            width: 200,
            ellipsis: true,
            sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
            filterDropdown: ({setSelectedKeys, selectedKeys, confirm, clearFilters}) => (
                <div style={{padding: 8}}>
                    <Input
                        placeholder="Search name"
                        value={selectedKeys[0]}
                        onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                        onPressEnter={confirm}
                        style={{marginBottom: 8, display: 'block'}}
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
                        <Button onClick={() => { clearFilters(); confirm(); }} size="small" style={{width: 90}}>
                            Reset
                        </Button>
                    </Space>
                </div>
            ),
            filterIcon: filtered => <SearchOutlined style={{color: filtered ? '#1890ff' : undefined}} />,
            onFilter: (value, record) => (record.name || '').toLowerCase().includes(value.toLowerCase())
        },
        {
            title: 'Description',
            dataIndex: 'description',
            key: 'description',
            width: 300,
            ellipsis: true
        },
        ...(data.every(gene => gene.pValue || gene.pValueFDR >= 0) ? [{
            title: 'pValue',
            dataIndex: 'pValue',
            key: 'pValue',
            width: 150,
            render: val => val?.toExponential(3),
            sorter: (a, b) => a.pValue - b.pValue,
            sortDirections: ['ascend', 'descend', 'ascend'],
            defaultSortOrder: 'ascend',
        }] : []),
        ...(data.every(gene => gene.pValueFDR || gene.pValueFDR >= 0) ? [{
            title: 'pValue.FDR',
            dataIndex: 'pValueFDR',
            key: 'pValueFDR',
            width: 150,
            render: val => val?.toExponential(3),
            sorter: (a, b) => a.pValueFDR - b.pValueFDR,
            sortDirections: ['ascend', 'descend', 'ascend'],
        }] : []),
        {
            // Fold change is log2 across all analysis types: expression (limma logFC),
            // meta (normalized to log2 at the API), and PGSEA (filtered/plotted as log2).
            title: 'Log2FC',
            dataIndex: 'foldChange',
            key: 'foldChange',
            width: 150,
            render: val => val?.toFixed(3),
            sorter: (a, b) => b.foldChange - a.foldChange,
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
    ];

    return (
        <>
            <style>{`
                .significant-row {
                    background-color: #e6f7ff !important;
                }
                .significant-row:hover {
                    background-color: #bae7ff !important;
                }
            `}</style>
            <Table
                {...getVirtualTableProps()}
                columns={columns}
                dataSource={data}
                rowKey="id"
                rowClassName={(record) => record.pValueFDR < 0.05 ? 'significant-row' : ''}
            />
        </>
    );
};

// Loading overlay component
const LoadingOverlay = ({loading, loadingMessage, loadingProgress, pipelineProgress}) => {
    if (!loading) return null;

    // Show pipeline progress for AI report generation
    if (pipelineProgress) {
        return (
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
            }}>
                <div style={{
                    background: '#fff',
                    borderRadius: '12px',
                    padding: '24px',
                    maxWidth: '800px',
                    width: '90%',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                }}>
                    <div style={{
                        textAlign: 'center',
                        marginBottom: '16px',
                        fontSize: '18px',
                        fontWeight: 600,
                        color: '#1890ff'
                    }}>
                        Generating AI Report
                    </div>
                    <PipelineProgress
                        totalSteps={pipelineProgress.totalSteps}
                        currentStep={pipelineProgress.currentStep}
                        currentMessage={pipelineProgress.currentMessage}
                        stepsInfo={pipelineProgress.stepsInfo}
                        stepExecutionTimes={pipelineProgress.stepExecutionTimes}
                        status={pipelineProgress.status}
                    />
                </div>
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000
        }}>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center'
            }}>
                <Spin size="large"/>
                <div style={{
                    marginTop: '12px',
                    color: '#fff',
                    textAlign: 'center'
                }}>
                    <div style={{fontSize: '16px'}}>
                        {loadingMessage}
                    </div>
                    {loadingProgress.total > 0 && (
                        <div style={{fontSize: '12px', marginTop: '4px'}}>
                            Processing database {loadingProgress.completed} of {loadingProgress.total}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Main Analysis Wizard Component
// onExitWizard: optional. Supplied by a host that renders its own reports list, it replaces every
// exit from the wizard — the "Back to Insights" button and the hand-off after a report finishes —
// so control returns to that list instead of to this component's internal dashboard. Omitted, the
// wizard behaves exactly as before. See resolveExitWizard.
const AnalysisWizard = ({analyses, metaAnalyses, configs, sessionId, organismId, initialView = 'dashboard', onViewInsight, onExitWizard, initialSelectedAnalyses = []}) => {
    // Get global settings
    const { globalSettings, readOnly } = useGlobalSettings();

    const [currentStep, setCurrentStep] = useState(0);
    const [options, setOptions] = useState([]);
    const [selectedAnalyses, setSelectedAnalyses] = useState([]);
    const [selectedMethods, setSelectedMethods] = useState([]);
    const [availableMethods, setAvailableMethods] = useState([]);
    const [pathwayData, setPathwayData] = useState({});
    const [selectedPathways, setSelectedPathways] = useState({});
    // Which pathway-database Collapse panels are open, per analysisId. Undefined =>
    // fall back to first-panel-open (firstPanelKeys); once the user toggles, their
    // choice is stored here. Controlled so it survives the async pathwayData load
    // (an uncontrolled defaultActiveKey is read before the data arrives -> all closed).
    const [pathwayActiveKeys, setPathwayActiveKeys] = useState({});
    const [genes, setGenes] = useState({});
    const [selectedGenes, setSelectedGenes] = useState({});
    const [selectedSections, setSelectedSections] = useState(DEFAULT_SELECTED_SECTIONS);
    const [report, setReport] = useState();
    const [dbTopN, setDbTopN] = useState({});
    // Current table sort per `${analysisId}:${database}` -> {columnKey, order}.
    // "Top N" follows this so re-sorting the table re-picks the top pathways.
    const [dbSort, setDbSort] = useState({});
    const [genesTopN, setGenesTopN] = useState('5');
    const [geneFilterFDR, setGeneFilterFDR] = useState(globalSettings.pValueFDR);
    const [geneFilterFC, setGeneFilterFC] = useState(globalSettings.foldChange);
    const [customGeneFDRInput, setCustomGeneFDRInput] = useState('');
    const [customGeneFCInput, setCustomGeneFCInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [pipelineProgress, setPipelineProgress] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState({
        total: 0,
        completed: 0
    });
    const [methodOrder, setMethodOrder] = useState([]);
    const [view, setView] = useState(initialView);
    const [selectedInsight, setSelectedInsight] = useState(null);
    const [insightName, setInsightName] = useState('');
    const [analysesMetadata, setAnalysesMetadata] = useState({});
    const [customContext, setCustomContext] = useState('');

    // Metadata validation states
    const [showMetadataModal, setShowMetadataModal] = useState(false);
    const [consolidatedMetadata, setConsolidatedMetadata] = useState(null);
    const [metadataAssessment, setMetadataAssessment] = useState(null);
    const [metadataSuggestions, setMetadataSuggestions] = useState(null);

    // Experimental context states - 4 required fields + 1 optional description
    const [tissueType, setTissueType] = useState('');
    const [disease, setDisease] = useState('');
    const [condition, setCondition] = useState('');
    const [control, setControl] = useState('');
    const [description, setDescription] = useState('');
    const [experimentalContext, setExperimentalContext] = useState('');

    // Custom options for each field (to support user-entered values)
    const [tissueOptions, setTissueOptions] = useState(COMMON_TISSUES.map(t => ({ label: t, value: t })));
    const [diseaseOptions, setDiseaseOptions] = useState(DISEASES.map(d => ({ label: d, value: d })));
    const [conditionOptions, setConditionOptions] = useState(CONDITIONS.map(c => ({ label: c, value: c })));
    const [controlOptions, setControlOptions] = useState(CONTROL_TYPES.map(c => ({ label: c, value: c })));

    // Track search text for custom input
    const [tissueSearchText, setTissueSearchText] = useState('');
    const [diseaseSearchText, setDiseaseSearchText] = useState('');
    const [conditionSearchText, setConditionSearchText] = useState('');
    const [controlSearchText, setControlSearchText] = useState('');

    // Track validation state - only show errors after user tries to proceed
    const [showValidationErrors, setShowValidationErrors] = useState(false);

    // Sync with global settings when they change
    useEffect(() => {
        setGeneFilterFDR(globalSettings.pValueFDR);
        setGeneFilterFC(globalSettings.foldChange);
    }, [globalSettings]);

    // Pre-select an analysis when the wizard is opened from the AI-interpretation sidebar by
    // clicking a specific analysis (a study click passes none, leaving the Step-0 picker open for
    // the user to choose). Reuses the same handleAnalysisSelection path a manual pick uses (fetches
    // genes/pathways, auto-selects top pathways/genes); we stay on the Selection step so the user
    // sees what was pre-selected. The host (AIInterpretation) remounts this wizard on every sidebar
    // change (it nulls wizardData while loading), so the ref-guard below is belt-and-suspenders
    // against a same-mount prop change — it does not need to survive across selections.
    const appliedInitialSelectionRef = useRef(null);
    useEffect(() => {
        const ids = (Array.isArray(initialSelectedAnalyses) ? initialSelectedAnalyses : []).filter(Boolean);
        if (ids.length === 0) return;
        const key = ids.join('|');
        if (appliedInitialSelectionRef.current === key) return;
        appliedInitialSelectionRef.current = key;
        handleAnalysisSelection(ids);
    }, [initialSelectedAnalyses]);

    const referencesContainerRef = useRef(null);
    const reportContainerRef = useRef(null);
    const [containerHeight, setContainerHeight] = useState(0);

    // Helper to update experimental context from all fields
    const updateExperimentalContext = (tissue, dis, cond, ctrl, desc) => {
        const parts = [];
        if (tissue) parts.push(`Tissue: ${tissue}`);
        if (dis) parts.push(`Disease: ${dis}`);
        if (cond) parts.push(`Condition: ${cond}`);
        if (ctrl) parts.push(`Control: ${ctrl}`);
        if (desc) parts.push(`Description: ${desc}`);
        setExperimentalContext(parts.join(' | '));
    };

    // Handler for tissue type with custom input support
    const handleTissueTypeChange = (value) => {
        setTissueType(value);
        setTissueSearchText(''); // Clear search text when value is selected
        updateExperimentalContext(value, disease, condition, control, description);
    };

    const handleTissueTypeSearch = (searchText) => {
        setTissueSearchText(searchText);
        if (searchText && !tissueOptions.some(opt => opt.value.toLowerCase() === searchText.toLowerCase())) {
            setTissueOptions([...COMMON_TISSUES.map(t => ({ label: t, value: t })), { label: searchText, value: searchText }]);
        }
    };

    const handleTissueTypeBlur = () => {
        if (tissueSearchText && tissueSearchText.trim()) {
            setTissueType(tissueSearchText.trim());
            updateExperimentalContext(tissueSearchText.trim(), disease, condition, control, description);
            setTissueSearchText('');
        }
    };

    // Handler for disease with custom input support
    const handleDiseaseChange = (value) => {
        setDisease(value);
        setDiseaseSearchText(''); // Clear search text when value is selected
        updateExperimentalContext(tissueType, value, condition, control, description);
    };

    const handleDiseaseSearch = (searchText) => {
        setDiseaseSearchText(searchText);
        if (searchText && !diseaseOptions.some(opt => opt.value.toLowerCase() === searchText.toLowerCase())) {
            setDiseaseOptions([...DISEASES.map(d => ({ label: d, value: d })), { label: searchText, value: searchText }]);
        }
    };

    const handleDiseaseBlur = () => {
        if (diseaseSearchText && diseaseSearchText.trim()) {
            setDisease(diseaseSearchText.trim());
            updateExperimentalContext(tissueType, diseaseSearchText.trim(), condition, control, description);
            setDiseaseSearchText('');
        }
    };

    // Handler for condition with custom input support
    const handleConditionChange = (value) => {
        setCondition(value);
        setConditionSearchText(''); // Clear search text when value is selected
        updateExperimentalContext(tissueType, disease, value, control, description);
    };

    const handleConditionSearch = (searchText) => {
        setConditionSearchText(searchText);
        if (searchText && !conditionOptions.some(opt => opt.value.toLowerCase() === searchText.toLowerCase())) {
            setConditionOptions([...CONDITIONS.map(c => ({ label: c, value: c })), { label: searchText, value: searchText }]);
        }
    };

    const handleConditionBlur = () => {
        if (conditionSearchText && conditionSearchText.trim()) {
            setCondition(conditionSearchText.trim());
            updateExperimentalContext(tissueType, disease, conditionSearchText.trim(), control, description);
            setConditionSearchText('');
        }
    };

    // Handler for control with custom input support
    const handleControlChange = (value) => {
        setControl(value);
        setControlSearchText(''); // Clear search text when value is selected
        updateExperimentalContext(tissueType, disease, condition, value, description);
    };

    const handleControlSearch = (searchText) => {
        setControlSearchText(searchText);
        if (searchText && !controlOptions.some(opt => opt.value.toLowerCase() === searchText.toLowerCase())) {
            setControlOptions([...CONTROL_TYPES.map(c => ({ label: c, value: c })), { label: searchText, value: searchText }]);
        }
    };

    const handleControlBlur = () => {
        if (controlSearchText && controlSearchText.trim()) {
            setControl(controlSearchText.trim());
            updateExperimentalContext(tissueType, disease, condition, controlSearchText.trim(), description);
            setControlSearchText('');
        }
    };

    // Handler for description
    const handleDescriptionChange = (e) => {
        const value = e.target.value;
        setDescription(value);
        updateExperimentalContext(tissueType, disease, condition, control, value);
    };

    useEffect(() => {
        const calculateHeight = () => {
            if (reportContainerRef.current) {
                const windowHeight = window.innerHeight;
                const containerTop = reportContainerRef.current.getBoundingClientRect().top;
                const headerHeight = 32;
                const footerHeight = 24 + 40;
                const newHeight = windowHeight - containerTop - headerHeight - footerHeight;
                setContainerHeight(newHeight);
            }
        };

        calculateHeight();
        window.addEventListener('resize', calculateHeight);
        return () => window.removeEventListener('resize', calculateHeight);
    }, [currentStep]);

    React.useEffect(() => {
        // Create tree data for TreeSelect
        const createTreeData = () => {
            const treeData = [];
            const groupedItems = {};

            // Process meta analyses
            if (metaAnalyses && metaAnalyses.length > 0) {
                metaAnalyses.forEach(meta => {
                    if (meta.groupId && meta.groupName) {
                        // Grouped meta analysis
                        if (!groupedItems[meta.groupId]) {
                            groupedItems[meta.groupId] = {
                                title: meta.groupName,
                                value: `group_${meta.groupId}`,
                                key: `group_${meta.groupId}`,
                                children: [],
                                selectable: false,
                                checkable: true
                            };
                        }
                        groupedItems[meta.groupId].children.push({
                            title: `📊 ${meta.name}`,
                            value: meta.id,
                            key: meta.id,
                            isLeaf: true
                        });
                    } else {
                        // Ungrouped meta analysis
                        treeData.push({
                            title: `📊 ${meta.name}`,
                            value: meta.id,
                            key: meta.id,
                            isLeaf: true
                        });
                    }
                });
            }

            // Create a set of meta-analysis IDs to avoid duplicates
            const metaAnalysisIds = new Set(metaAnalyses?.map(m => m.id) || []);

            // Process regular analyses
            Object.entries(analyses).forEach(([id, analysis]) => {
                // Skip if this is a meta-analysis (already processed above)
                if (metaAnalysisIds.has(id)) {
                    return;
                }

                if (analysis.groupId && analysis.groupName && analysis.isMassAnalysis && !analysis.isUngrouped) {
                    // Grouped mass analysis
                    if (!groupedItems[analysis.groupId]) {
                        groupedItems[analysis.groupId] = {
                            title: analysis.groupName,
                            value: `group_${analysis.groupId}`,
                            key: `group_${analysis.groupId}`,
                            children: [],
                            selectable: false,
                            checkable: true
                        };
                    }
                    groupedItems[analysis.groupId].children.push({
                        title: `📊 ${analysis.name}`,
                        value: id,
                        key: id,
                        isLeaf: true
                    });
                } else {
                    // Regular analysis or ungrouped mass analysis
                    const icon = analysis.isMassAnalysis ? '📊 ' : '';
                    treeData.push({
                        title: `${icon}${analysis.name}`,
                        value: id,
                        key: id,
                        isLeaf: true
                    });
                }
            });

            // Add all grouped items to tree data
            Object.values(groupedItems).forEach(group => {
                group.children.sort((a, b) => a.title.localeCompare(b.title));
                treeData.push(group);
            });

            // Sort top-level items
            treeData.sort((a, b) => {
                const aIsGroup = a.children && a.children.length > 0;
                const bIsGroup = b.children && b.children.length > 0;

                if (aIsGroup && !bIsGroup) return -1;
                if (!aIsGroup && bIsGroup) return 1;
                return a.title.localeCompare(b.title);
            });

            return treeData;
        };

        const newTreeData = createTreeData();
        setOptions(newTreeData);
    }, [analyses, metaAnalyses]);

    React.useEffect(() => {
        const fetchGenes = async () => {
            const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));

            if (actualAnalysisIds.length > 0) {
                try {
                    const genesData = {};
                    const selectedGenesData = {};

                    for (const analysisId of actualAnalysisIds) {
                        const response = await fetch(`/api/deGenes?args=${btoa(JSON.stringify({
                            analysisId: analysisId,
                            sessionId
                        }))}`, {headers: authHeaders()});
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const resJson = await response.json();

                        // Use a Map to deduplicate genes by ID
                        const geneMap = new Map();
                        resJson.forEach(gene => {
                            const geneId = gene._id;
                            // Only add if not already present, or if this entry has better (lower) pValue
                            if (!geneMap.has(geneId) || (gene.pValue && gene.pValue < geneMap.get(geneId).pValue)) {
                                geneMap.set(geneId, {
                                    id: geneId,
                                    name: gene.symbol,
                                    foldChange: gene.FC,
                                    absFoldChange: Math.abs(gene.FC),
                                    description: gene.description,
                                    ...(resJson.some(g => g.pValueFDR) ? {
                                        pValueFDR: gene.pValueFDR ?? 0
                                    } : {}),
                                    ...(resJson.some(g => g.pValue) ? {
                                        pValue: gene.pValue ?? 0
                                    } : {})
                                });
                            }
                        });

                        const geneData = Array.from(geneMap.values()).sort((a, b) => a.pValue - b.pValue);
                        genesData[analysisId] = geneData;
                        // Auto-select the top N genes by pValue ascending (unfiltered),
                        // honoring the "Select top N" count (defaults to DEFAULT_GENE_TOP_N).
                        selectedGenesData[analysisId] = selectTopGenes(geneData, {
                            fdr: Infinity,
                            fc: -Infinity,
                            topN: parseInt(genesTopN) || DEFAULT_GENE_TOP_N
                        });
                    }

                    setGenes(genesData);
                    setSelectedGenes(selectedGenesData);
                } catch (error) {
                    console.error('Error fetching DE genes:', error);
                    setGenes({});
                    setSelectedGenes({});
                }
            } else {
                setGenes({});
                setSelectedGenes({});
            }
        };

        fetchGenes();
    }, [selectedAnalyses, sessionId]);

    const fetchAnalysisResults = async (analysisId) => {
        const analysis = analyses[analysisId];
        const config = configs.find(c => c.analysisId === analysisId);

        try {
            const response = await Meteor.callAsync("analysis.results.aggregate", {
                analysisId: analysisId,
                inputType: analysis.input === config.inputType ? analysis.input : config.inputType,
                geneSets: config.geneSets
            });

            const databases = Object.keys(response);

            if (methodOrder.length === 0) {
                const methodSet = new Set();
                const orderedMethods = [];
                const methodsInOrder = Object.keys(MethodSettings.getSupportedMethods(analysis.input))
                databases.forEach(db => {
                    if (response[db].methods[0]) {
                        methodsInOrder.filter(method => Object.keys(response[db].methods[0]).includes(method)).forEach(method => {
                            const upperMethod = method.toUpperCase();
                            if (!methodSet.has(upperMethod)) {
                                methodSet.add(upperMethod);
                                orderedMethods.push(upperMethod);
                            }
                        });
                    }
                });
                const filteredMethods = orderedMethods.filter(method => method.toLowerCase() !== 'consensus');
                setMethodOrder(filteredMethods);
                setAvailableMethods(filteredMethods.map(method => ({
                    id: method,
                    name: method
                })));
            }

            return response;
        } catch (error) {
            console.error(`Error fetching results for analysis ${analysisId}:`, error);
            return null;
        }
    };

    const handleAnalysisSelection = async (analysisIds) => {
        try {
            const actualAnalysisIds = analysisIds.filter(id => !id.startsWith('group_'));

            setSelectedAnalyses(actualAnalysisIds);
            if (actualAnalysisIds.length === 0) return;

            const getAnalysisName = (analysisId) => {
                if (analyses[analysisId]) {
                    return analyses[analysisId].name;
                }
                const metaAnalysis = metaAnalyses?.find(meta => meta.id === analysisId);
                if (metaAnalysis) {
                    return metaAnalysis.name;
                }
                return `Analysis ${analysisId}`;
            };

            const firstAnalysisName = getAnalysisName(actualAnalysisIds[0]);
            const insightNameSuffix = actualAnalysisIds.length > 1
                ? ` (${actualAnalysisIds.length} analyses)`
                : '';

            setLoading(true);
            setLoadingMessage(`Initializing...`);
            setInsightName(`${firstAnalysisName}${insightNameSuffix}`);

            // Extract metadata from analyses (it's already in the analyses prop)
            const metadata = {};
            actualAnalysisIds.forEach(id => {
                const analysis = analyses[id];
                if (analysis && analysis.metadata && analysis.metadata.extracted) {
                    metadata[analysis.name] = analysis.metadata.extracted;
                }
            });

            // For meta-analyses, fetch per-dataset metadata from the mass analysis
            const isMetaSelection = actualAnalysisIds.length === 1 && (
                analyses[actualAnalysisIds[0]]?.isMassAnalysis ||
                metaAnalyses?.some(meta => meta.id === actualAnalysisIds[0])
            );

            if (isMetaSelection && Object.keys(metadata).length === 0) {
                try {
                    const allAnalysesArray = Object.values(analyses);
                    const massAnalysisIds = new Set();
                    allAnalysesArray.forEach(a => {
                        if (a.massAnalysisId) massAnalysisIds.add(a.massAnalysisId);
                    });

                    if (massAnalysisIds.size > 0) {
                        const massAnalysisId = Array.from(massAnalysisIds)[0];
                        const datasetsMetadata = await Meteor.callAsync('massAnalysis.getMetadata', {
                            massAnalysisId
                        });

                        // Populate analysesMetadata with per-dataset extracted metadata
                        Object.entries(datasetsMetadata).forEach(([datasetName, meta]) => {
                            const extracted = meta?.extracted || meta;
                            if (extracted && Object.keys(extracted).length > 0) {
                                metadata[datasetName] = extracted;
                            }
                        });

                        // Auto-build consolidatedMetadata by aggregating common values
                        if (Object.keys(metadata).length > 0) {
                            const allFields = new Set();
                            Object.values(metadata).forEach(m => Object.keys(m).forEach(k => allFields.add(k)));

                            const aggregated = {};
                            allFields.forEach(field => {
                                const values = Object.values(metadata)
                                    .map(m => m[field])
                                    .filter(v => v !== undefined && v !== null && v !== '');
                                if (values.length > 0) {
                                    // Merge values differing only by case/whitespace (e.g. "female"/"Female").
                                    aggregated[field] = aggregateMetadataValue(values);
                                }
                            });

                            setConsolidatedMetadata({
                                organism: aggregated.organism || aggregated.Organism || 'Homo sapiens',
                                tissue: aggregated.tissue || aggregated.Tissue || '',
                                disease: aggregated.disease || aggregated.Disease || null,
                                comparison: aggregated.comparison || aggregated.Comparison || '',
                                experimental_context: aggregated.experimental_context || aggregated.description || '',
                                study_type: 'disease'
                            });
                            console.log('📊 Auto-built consolidatedMetadata from mass analysis datasets');
                        }
                    }
                } catch (err) {
                    console.warn('Could not fetch mass analysis metadata:', err);
                }
            }

            setAnalysesMetadata(metadata);
            console.log('📋 Extracted analyses metadata:', metadata);

            const pathwayDataResults = {};
            const selectedPathwaysResults = {};

            // Pre-fetch database mapping once for all analyses (optimization)
            setLoadingMessage(`Loading databases...`);
            const dbMapping = await getDatabaseMapping();
            // Create reverse mapping: ID -> Name
            const dbIdToNameMapping = Object.entries(dbMapping).reduce((acc, [name, id]) => {
                acc[id] = name;
                return acc;
            }, {});
            setLoadingMessage(`Databases loaded, processing analyses...`);

            // Helper function to create gene ID to symbol mapping
            const createGeneIdToSymbolMap = async (analysisId) => {
                try {
                    const response = await fetch(`/api/mappedGeneIds?args=${btoa(JSON.stringify({
                        analysisId: analysisId,
                        sessionId
                    }))}`, {headers: authHeaders()});
                    if (!response.ok) {
                        console.warn(`Could not fetch gene mapping for analysis ${analysisId}`);
                        return new Map();
                    }
                    const mappedGenes = await response.json();

                    // Create a map: geneId -> symbol
                    const geneMap = new Map();
                    if (Array.isArray(mappedGenes)) {
                        mappedGenes.forEach(gene => {
                            if (gene.geneId && gene.symbol) {
                                geneMap.set(String(gene.geneId), gene.symbol);
                            }
                        });
                    }
                    return geneMap;
                } catch (error) {
                    console.warn(`Error fetching gene mapping for analysis ${analysisId}:`, error);
                    return new Map();
                }
            };

            // Helper function to convert gene IDs to symbols
            const convertGeneIdsToSymbols = (geneIds, geneMap) => {
                if (!geneIds || !Array.isArray(geneIds)) return [];
                return geneIds.map(geneId => {
                    const symbol = geneMap.get(String(geneId));
                    return symbol || geneId; // Return symbol if found, otherwise keep ID
                }).filter(gene => gene); // Remove any null/undefined values
            };

            for (let i = 0; i < actualAnalysisIds.length; i++) {
                const analysisId = actualAnalysisIds[i];
                setLoadingMessage(`Processing analysis ${i + 1} of ${actualAnalysisIds.length}...`);

                // Check if this is a meta-analysis
                const metaAnalysis = metaAnalyses?.find(meta => meta.id === analysisId);

                if (metaAnalysis && metaAnalysis.pathwayLevel && metaAnalysis.pathwayLevel.status === 'completed') {
                    // Handle meta-analysis pathway results
                    setLoadingMessage(`Processing meta-analysis ${i + 1} of ${actualAnalysisIds.length}...`);

                    try {
                        // Fetch gene ID to symbol mapping for meta-analysis
                        setLoadingMessage(`Processing meta-analysis ${i + 1} of ${actualAnalysisIds.length} - Loading gene mapping...`);
                        const geneIdToSymbolMap = await createGeneIdToSymbolMap(analysisId);
                        console.log(`Gene mapping loaded for meta-analysis ${analysisId}: ${geneIdToSymbolMap.size} genes`);

                        // Fetch pathway results for this meta-analysis
                        const metaResults = await Meteor.callAsync('visualization.getMetaAnalysisResults', {
                            sessionId: sessionId,
                            analysisId: analysisId
                        });

                        const pathwayResults = metaResults.pathwayLevel;

                        if (!pathwayResults || pathwayResults.length === 0) continue;

                        // Get unique pathway IDs to fetch gene lists
                        const allPathwayIds = new Set();
                        pathwayResults.forEach(dbResult => {
                            if (dbResult.value && Array.isArray(dbResult.value)) {
                                dbResult.value.forEach(pathway => {
                                    allPathwayIds.add(pathway.ID);
                                });
                            }
                        });

                        // Fetch gene sets to get pathway names and genes
                        setLoadingMessage(`Processing meta-analysis ${i + 1} of ${actualAnalysisIds.length} - Loading pathways...`);
                        const geneSets = await Meteor.callAsync('geneSet.getByIds', {
                            ids: Array.from(allPathwayIds)
                        });

                        const pathwayInfoMap = new Map();
                        geneSets.forEach(gs => {
                            // Convert gene IDs to symbols
                            const geneSymbols = (gs.genes || [])
                                .map(geneId => geneIdToSymbolMap.get(String(geneId)) || null)
                                .filter(Boolean);

                            pathwayInfoMap.set(gs.id, {
                                name: gs.name,
                                genes: geneSymbols  // Store gene symbols, not IDs
                            });
                        });

                        // Format results for the UI
                        const formattedData = pathwayResults.map(dbResult => {
                            const pathways = [];
                            const databaseName = dbIdToNameMapping[dbResult.databaseId] || dbResult.databaseId;

                            if (dbResult.value && Array.isArray(dbResult.value)) {
                                dbResult.value.forEach(pathway => {
                                    const pathwayInfo = pathwayInfoMap.get(pathway.ID);
                                    if (pathwayInfo) {
                                        pathways.push({
                                            id: `${databaseName}:${pathway.ID}`,
                                            originalId: pathway.ID,
                                            name: pathwayInfo.name,
                                            pValue: pathway.pValue,
                                            pValueFDR: pathway.pFDR,
                                            // `score` is the enrichment score (NES here);
                                            // carry normalizedScore through when present (meta)
                                            // so the interpretation service labels it as NES.
                                            score: pathway.score,
                                            normalizedScore: pathway.normalizedScore,
                                            database: databaseName,
                                            genes: pathwayInfo.genes
                                        });
                                    }
                                });
                            }

                            return {
                                database: databaseName,
                                pathways: pathways
                            };
                        });

                        pathwayDataResults[analysisId] = formattedData;

                        // Auto-select top 20 pathways from each database (by the default
                        // table sort; "Top N" then follows the table's live sort).
                        const initialSelectedPathways = [];
                        formattedData.forEach(db => {
                            const topPathways = selectPathways(
                                db.pathways, DEFAULT_SORT.columnKey, DEFAULT_SORT.order, SELECTION_MODES.TOP, 20
                            );
                            initialSelectedPathways.push(...topPathways);
                            setDbTopN(prev => ({...prev, [`${analysisId}:${db.database}`]: '20'}));
                            setDbSort(prev => ({...prev, [`${analysisId}:${db.database}`]: DEFAULT_SORT}));
                        });
                        selectedPathwaysResults[analysisId] = initialSelectedPathways;

                        // Set method to the meta-analysis method
                        if (methodOrder.length === 0) {
                            const method = metaAnalysis.pathwayLevel.method?.toUpperCase() || 'META';
                            setMethodOrder([method]);
                            setSelectedMethods([method]);
                        }

                        continue;
                    } catch (error) {
                        console.error(`Error processing meta-analysis ${analysisId}:`, error);
                        continue;
                    }
                }

                const analysisConfigs = configs.find(c => c.analysisId === analysisId);
                if (!analysisConfigs) continue;

                // Fetch gene ID to symbol mapping for this analysis
                setLoadingMessage(`Processing analysis ${i + 1} of ${actualAnalysisIds.length} - Loading gene mapping...`);
                const geneIdToSymbolMap = await createGeneIdToSymbolMap(analysisId);
                console.log(`Gene mapping loaded for analysis ${analysisId}: ${geneIdToSymbolMap.size} genes`);

                const initialMethods = Object.keys(analysisConfigs?.methods).filter(method =>
                    analysisConfigs?.methods[method].enabled
                ).map(m => m.toUpperCase()).filter(m => m.toLowerCase() !== 'consensus');

                const methodsInOrder = Object.keys(MethodSettings.getSupportedMethods(
                    Object.keys(configs.find(c => c.analysisId === analysisId)?.input)
                ));

                const upperMethodsInOrder = methodsInOrder.map(m => m.toUpperCase());

                const sortedMethods = initialMethods.sort((a, b) => {
                    const aIndex = upperMethodsInOrder.indexOf(a);
                    const bIndex = upperMethodsInOrder.indexOf(b);

                    if (aIndex === -1 && bIndex === -1) return 0;
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;

                    return aIndex - bIndex;
                });

                if (methodOrder.length === 0) {
                    setMethodOrder(sortedMethods);
                }

                // Process each analysis
                if (initialMethods.length === 1) {
                    setLoadingMessage(`Processing analysis ${i + 1} of ${actualAnalysisIds.length} - Fetching results...`);
                    const results = await fetchAnalysisResults(analysisId);
                    if (!results) continue;

                    const databases = Object.keys(results);
                    const formattedData = await Promise.all(databases.map(async (db, dbIndex) => {
                        const dbResults = results[db].methods[0];
                        const uniquePathways = new Map();

                        const methodResults = dbResults[initialMethods[0].toLowerCase()] || [];
                        methodResults.forEach(pathway => {
                            // Convert gene IDs to symbols
                            const geneSymbols = convertGeneIdsToSymbols(pathway.genes, geneIdToSymbolMap);

                            uniquePathways.set(pathway.pathway, {
                                id: `${db}:${pathway.pathway}`,
                                originalId: pathway.pathway,
                                name: pathway.name,
                                pValue: pathway.pValue,
                                pValueFDR: pathway.pValueFDR,
                                score: pathway.score,
                                normalizedScore: pathway.normalizedScore,
                                database: db,
                                genes: geneSymbols // Use gene symbols instead of IDs
                            });
                        });

                        return {
                            database: db,
                            pathways: Array.from(uniquePathways.values())
                        };
                    }));

                    pathwayDataResults[analysisId] = formattedData;
                    setSelectedMethods(initialMethods);

                    const initialSelectedPathways = [];
                    formattedData.forEach(db => {
                        const topPathways = selectPathways(
                            db.pathways, DEFAULT_SORT.columnKey, DEFAULT_SORT.order, SELECTION_MODES.TOP, 20
                        );
                        initialSelectedPathways.push(...topPathways);
                        setDbTopN(prev => ({...prev, [`${analysisId}:${db.database}`]: '20'}));
                        setDbSort(prev => ({...prev, [`${analysisId}:${db.database}`]: DEFAULT_SORT}));
                    });
                    selectedPathwaysResults[analysisId] = initialSelectedPathways;

                } else {
                    // Handle consensus analysis
                    const databases = Object.keys(dbMapping);

                    // Build gene set lookup for this analysis
                    // Note: geneSet.genes in config is just a count, we need to fetch actual gene lists
                    const geneSetLookup = new Map();
                    if (analysisConfigs?.geneSets) {
                        const allPathwayIds = [];
                        analysisConfigs.geneSets.forEach(geneSetGroup => {
                            if (geneSetGroup.geneSets) {
                                geneSetGroup.geneSets.forEach(geneSet => {
                                    allPathwayIds.push(geneSet.id);
                                });
                            }
                        });

                        // Fetch actual gene sets from server
                        try {
                            setLoadingMessage(`Processing analysis ${i + 1} of ${actualAnalysisIds.length} - Loading gene sets...`);
                            const geneSetDetails = await Meteor.callAsync('geneSet.getByIds', {
                                ids: allPathwayIds
                            });
                            geneSetDetails.forEach(gs => {
                                // Convert gene IDs to symbols for gene sets too
                                const geneSymbols = convertGeneIdsToSymbols(gs.genes, geneIdToSymbolMap);
                                geneSetLookup.set(gs.id, geneSymbols);
                            });
                        } catch (error) {
                            console.warn('Could not fetch gene set details:', error);
                        }
                    }

                    const formattedData = await Promise.all(databases.map(async (db, index) => {
                        const uniquePathways = new Map();
                        const databaseId = dbMapping[db];

                        setLoadingMessage(`Processing analysis ${i + 1} of ${actualAnalysisIds.length} - Database ${index + 1}/${databases.length} (${db})`);

                        const consensusResults = await Meteor.callAsync('visualization.getConsensusAnalysisResult', {
                            analysisId: analysisId,
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
                                    normalizedScore: pathway.normalizedScore,
                                    database: db,
                                    genes: geneSetLookup.get(pathway.ID) || [] // Gene symbols already converted
                                });
                            });
                        }

                        return {
                            database: db,
                            pathways: Array.from(uniquePathways.values())
                        };
                    }));

                    const filteredFormattedData = formattedData.filter(db => db.pathways.length > 0);
                    pathwayDataResults[analysisId] = filteredFormattedData;
                    setSelectedMethods(initialMethods);

                    const initialSelectedPathways = [];
                    filteredFormattedData.forEach(db => {
                        const topPathways = selectPathways(
                            db.pathways, DEFAULT_SORT.columnKey, DEFAULT_SORT.order, SELECTION_MODES.TOP, 20
                        );
                        initialSelectedPathways.push(...topPathways);
                        setDbTopN(prev => ({...prev, [`${analysisId}:${db.database}`]: '20'}));
                        setDbSort(prev => ({...prev, [`${analysisId}:${db.database}`]: DEFAULT_SORT}));
                    });
                    selectedPathwaysResults[analysisId] = initialSelectedPathways;
                }
            }

            setPathwayData(pathwayDataResults);
            setSelectedPathways(selectedPathwaysResults);
            setLoading(false);
        } catch (error) {
            console.error('Error in handleAnalysisSelection:', error);
            setLoading(false);
        }
    };

    const handleStartNewInsight = () => {
        setView('wizard');
        setCurrentStep(0);
    };

    const handleViewInsight = (batchId) => {
        // When a host (AIInterpretation) provides onViewInsight, lift to it so the
        // report renders full-width with no sidebar; otherwise use the internal viewer.
        resolveViewInsight(batchId, {onViewInsight, setView, setSelectedInsight});
    };

    // The single way out of the wizard. Every path that used to call setView('dashboard') goes
    // through here, so a host that owns the reports list (AIInterpretation) gets control back
    // instead of the user landing on this component's OWN, differently-scoped list of the same
    // reports. With no onExitWizard this is exactly the old setView('dashboard').
    const exitToDashboard = useCallback(() => {
        resolveExitWizard({onExitWizard, setView});
    }, [onExitWizard]);

    // Backstop, so "the internal dashboard is unreachable" is a property of the component rather
    // than an argument about call sites. Should any path — including one added later — still put
    // the view into 'dashboard' while a host owns the list, hand back instead of rendering it.
    // Paired with the render branch below, which refuses to draw the internal dashboard at all.
    useEffect(() => {
        if (typeof onExitWizard === 'function' && view === 'dashboard') onExitWizard();
    }, [view, onExitWizard]);


    const handleMetadataImprove = async (updatedMetadata) => {
        // User has improved metadata, close modal and update consolidated metadata
        setConsolidatedMetadata(updatedMetadata);
        setShowMetadataModal(false);

        // Automatically trigger report generation with improved metadata
        // The metadata is already validated by the modal before calling this
        await continueWithReportGeneration(updatedMetadata);
    };

    const handleMetadataCancel = () => {
        setShowMetadataModal(false);
        setLoading(false);
    };

    const continueWithReportGeneration = async (validatedMetadata) => {
        // This function continues the report generation after metadata is validated
        // It's split out so it can be called after metadata improvement
        try {
            setLoading(true);
            const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));

            // Detect if this is a meta-analysis (check both analyses and metaAnalyses)
            const isMetaAnalysis = actualAnalysisIds.length === 1 && (
                analyses[actualAnalysisIds[0]]?.isMassAnalysis ||
                metaAnalyses?.some(meta => meta.id === actualAnalysisIds[0])
            );

            const analysisNames = actualAnalysisIds.map(id =>
                analyses[id]?.name || `Analysis ${id}`
            );
            const batchAnalysisName = analysisNames.length === 1
                ? analysisNames[0]
                : `Multi-Analysis (${analysisNames.slice(0, 2).join(', ')}${analysisNames.length > 2 ? '...' : ''})`;

            // Both sections gated the same way, and the sections recorded alongside them describe
            // what this submission actually carries. Genes used to be pushed with no gate at all,
            // so unticking "DE Genes" shipped them anyway while the review step said otherwise.
            // Unticking does not clear `selectedGenes` — pathways do not clear `selectedPathways`
            // either, and the selection is worth keeping if the user ticks the box again.
            const {
                pathways: allSelectedPathways,
                genes: allSelectedGenes,
                sections: submittedSections
            } = collectSubmissionSelections({
                analysisIds: actualAnalysisIds,
                selectedSections,
                selectedPathways,
                selectedGenes
            });

            // Fetch meta-analysis data if needed
            let metaAnalysisData = null;
            if (isMetaAnalysis) {
                const allAnalysesArray = Object.values(analyses);
                const massAnalysisIds = new Set();

                allAnalysesArray.forEach(a => {
                    if (a.massAnalysisId) {
                        massAnalysisIds.add(a.massAnalysisId);
                    }
                });

                if (massAnalysisIds.size === 0) {
                    throw new Error('No mass analysis found in this session.');
                }

                const massAnalysisId = Array.from(massAnalysisIds)[0];
                setLoadingMessage('Preparing meta-analysis data...');

                const datasetsMetadata = await Meteor.callAsync('massAnalysis.getMetadata', {
                    massAnalysisId
                });

                const individualAnalyses = allAnalysesArray.filter(a => a.massAnalysisId === massAnalysisId);

                if (individualAnalyses.length === 0) {
                    throw new Error('No individual datasets found for this meta-analysis.');
                }

                metaAnalysisData = {
                    datasetsMetadata,
                    individualAnalyses: individualAnalyses
                };
            }

            setLoadingMessage('Running Publication-Ready workflow with fact-checking...');

            try {
                // Submit job to external API
                const submitResult = await Meteor.callAsync('aiWorkflow.startPublicationReady', {
                    pathways: allSelectedPathways,
                    genes: allSelectedGenes,
                    analyses: actualAnalysisIds.map(id => {
                        const analysisName = analyses[id]?.name || `Analysis ${id}`;
                        const metadata = analysesMetadata[analysisName] || {};

                        return {
                            id,
                            name: analysisName,
                            metadata: customContext || '',
                            analysisMetadata: metadata,
                            contextFields: {
                                tissueType: tissueType || '',
                                disease: disease || '',
                                condition: condition || '',
                                control: control || '',
                                description: description || ''
                            },
                            isMassAnalysis: analyses[id]?.isMassAnalysis || false,
                            massAnalysisId: analyses[id]?.massAnalysisId || null
                        };
                    }),
                    sessionId,
                    analysisId: actualAnalysisIds[0],
                    analysisType: isMetaAnalysis ? 'meta-analysis' : 'single-analysis',
                    metaAnalysisData: metaAnalysisData,
                    consolidatedMetadata: validatedMetadata // Use the validated metadata from modal
                });

                const { workflowId, externalJobId } = submitResult;
                setLoadingMessage(`Job submitted (ID: ${externalJobId.substring(0, 8)}...). Processing...`);

                // Initialize pipeline progress
                setPipelineProgress({
                    totalSteps: 6,
                    currentStep: 0,
                    currentMessage: 'Initializing...',
                    stepsInfo: [],
                    stepExecutionTimes: {},
                    status: 'running'
                });

                // Poll for job completion
                const pollInterval = 5000;
                const maxWaitTime = 1800000; // 30 minutes
                const startTime = Date.now();
                const pollStatus = async () => {
                    const elapsed = Date.now() - startTime;
                    if (elapsed > maxWaitTime) {
                        throw new Error('Timeout waiting for job completion (30 minutes)');
                    }

                    const statusResult = await Meteor.callAsync('aiWorkflow.checkExternalJobStatus', workflowId);
                    const progress = statusResult.progress || {};

                    // Update pipeline progress
                    setPipelineProgress({
                        totalSteps: progress.totalSteps || 6,
                        currentStep: progress.currentStep || 0,
                        currentMessage: progress.currentMessage || '',
                        stepsInfo: progress.stepsInfo || [],
                        stepExecutionTimes: progress.stepExecutionTimes || {},
                        status: statusResult.status
                    });

                    const elapsedSec = Math.floor(elapsed / 1000);
                    setLoadingMessage(
                        `Processing analysis... Step ${progress.currentStep || 0}/${progress.totalSteps || 6} (${elapsedSec}s elapsed)`
                    );

                    if (statusResult.status === 'completed') {
                        await Meteor.callAsync('queue.createWorkflowBatch', {
                            userId: Meteor.userId(),
                            sessionId,
                            analysisName: batchAnalysisName,
                            insightName,
                            analysisId: actualAnalysisIds[0],
                            workflowId,
                            workflowType: 'publication-ready',
                            selectedGenes: allSelectedGenes,
                            selectedMethods,
                            selectedPathways: allSelectedPathways,
                            selectedAnalyses: actualAnalysisIds,
                            // The sections this report was actually generated from, not the raw
                            // checkbox state — so a stored report can tell "the user opted out of
                            // DE genes" apart from "this analysis had none".
                            selectedSections: submittedSections,
                            // Persist the biological context the user entered so it can
                            // be reviewed later on the finished report.
                            interpretationContext: {
                                consolidatedMetadata: validatedMetadata || null,
                                contextFields: {
                                    tissueType: tissueType || '',
                                    disease: disease || '',
                                    condition: condition || '',
                                    control: control || '',
                                    description: description || ''
                                },
                                customContext: customContext || ''
                            },
                        });

                        setLoading(false);
                        setLoadingMessage('');
                        setPipelineProgress(null);
                        handleReset();
                        exitToDashboard();

                        return true;
                    } else if (statusResult.status === 'failed') {
                        setPipelineProgress(prev => prev ? { ...prev, status: 'failed' } : null);
                        throw new Error(statusResult.error || 'External job failed');
                    }

                    return false;
                };

                // Start polling loop
                while (true) {
                    const completed = await pollStatus();
                    if (completed) break;
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                }

            } catch (workflowError) {
                setLoading(false);
                setLoadingMessage('');
                setPipelineProgress(null);
                console.error('Workflow error:', workflowError);
                Modal.error({
                    title: 'Workflow Error',
                    content: workflowError.message || 'An error occurred while running the workflow.',
                    okText: 'Ok'
                });
            }

        } catch (error) {
            console.error('Error in report generation:', error);
            setLoading(false);

            if (error.error === 'submission-limit-exceeded') {
                Modal.error({
                    title: 'Submission Limit Exceeded',
                    icon: <ExclamationCircleOutlined/>,
                    content: (
                        <div>
                            <p>{error.reason || 'You have exceeded the submission limit.'}</p>
                        </div>
                    ),
                    okText: 'Got it',
                    maskClosable: true
                });
            } else {
                Modal.error({
                    title: 'Error',
                    content: (
                        <div>
                            <p>An error occurred while generating the report:</p>
                            <p style={{ color: 'red', fontSize: '12px', marginTop: '8px' }}>
                                {error.message || error.reason || 'Unknown error'}
                            </p>
                        </div>
                    ),
                    okText: 'Ok'
                });
            }
        }
    };

    const handleGenerateReport = async () => {
        if (!consolidatedMetadata) {
            setShowMetadataModal(true);
            return;
        }
        await continueWithReportGeneration(consolidatedMetadata);
    };

    const handleReset = () => {
        setCurrentStep(0);
        setSelectedAnalyses([]);
        setSelectedPathways({});
        setSelectedGenes({});
        setSelectedSections(DEFAULT_SELECTED_SECTIONS);
        setReport(null);
        setDbTopN({});
        setGenesTopN('5');
        setTissueType('');
        setDisease('');
        setCondition('');
        setControl('');
        setDescription('');
        setExperimentalContext('');
        // Reset custom options to predefined lists
        setTissueOptions(COMMON_TISSUES.map(t => ({ label: t, value: t })));
        setDiseaseOptions(DISEASES.map(d => ({ label: d, value: d })));
        setConditionOptions(CONDITIONS.map(c => ({ label: c, value: c })));
        setControlOptions(CONTROL_TYPES.map(c => ({ label: c, value: c })));
        // Reset validation and metadata state
        setShowValidationErrors(false);
        setConsolidatedMetadata(null);
        setTissueSearchText('');
        setDiseaseSearchText('');
        setConditionSearchText('');
        setControlSearchText('');
    };

    const renderStatisticalMethods = () => (
        <Card title="Statistical Methods">
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px'}}>
                {methodOrder.map(methodId => (
                    <Checkbox
                        key={methodId}
                        checked={selectedMethods && selectedMethods.includes(methodId)}
                        onChange={(e) => handleMethodChange(methodId, e.target.checked)}
                        disabled={true}
                    >
                        {methodId}
                    </Checkbox>
                ))}
            </div>
        </Card>
    );

    const getCollapseItems = (analysisId) => {
        if (!pathwayData[analysisId]) return [];

        const analysisConfig = configs.filter(config => config.id === analysisId)[0]
        const dbOrder = analysisConfig?.geneSets?.sort((a, b) =>
            analysisConfig.selectedDatasets.indexOf(a.id) - analysisConfig.selectedDatasets.indexOf(b.id)
        ).map(db => db.namespace ? `${db.name}-${db.namespace}` : db.name) || [];

        return [...pathwayData[analysisId]].sort((a, b) =>
            dbOrder.indexOf(a.database) - dbOrder.indexOf(b.database)
        ).map(db => ({
            key: db.database,
            label: db.database,
            children: (
                <Space direction="vertical" style={{width: '100%'}} size="large">
                    <Radio.Group
                        value={
                            dbTopN[`${analysisId}:${db.database}`] === 'allSignificant' ? 'allSignificant' :
                            dbTopN[`${analysisId}:${db.database}`] === 'all' ? 'all' : 'top'
                        }
                        onChange={e => {
                            const mode = e.target.value;
                            if (mode === 'top') {
                                const currentVal = dbTopN[`${analysisId}:${db.database}`];
                                const topN = (currentVal && !isNaN(currentVal)) ? currentVal : '20';
                                handleTopNChange(analysisId, db.database, topN);
                            } else {
                                handleTopNChange(analysisId, db.database, mode);
                            }
                        }}
                    >
                        <Radio value="top">
                            <Space size="small">
                                Top
                                <InputNumber
                                    min={1}
                                    max={db.pathways.length}
                                    value={parseInt(dbTopN[`${analysisId}:${db.database}`] || '20')}
                                    onChange={value => {
                                        handleTopNChange(analysisId, db.database, value?.toString() || '20');
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    style={{width: 80}}
                                    disabled={dbTopN[`${analysisId}:${db.database}`] === 'allSignificant' || dbTopN[`${analysisId}:${db.database}`] === 'all'}
                                />
                            </Space>
                        </Radio>
                        <Radio value="allSignificant">All Significant</Radio>
                        <Radio value="all">All</Radio>
                    </Radio.Group>

                    {selectedPathways[analysisId]?.filter(p => p.database === db.database).length > 0 && (() => {
                        const dbSelected = selectedPathways[analysisId].filter(p => p.database === db.database);
                        const {visible, extraCount} = capTags(dbSelected);
                        return (
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                <Text type="secondary">Selected pathways:</Text>
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                    {visible.map(pathway => (
                                        <Tag
                                            key={pathway.id}
                                            closable
                                            onClose={() => handlePathwayRemove(analysisId, pathway.id)}
                                        >
                                            {pathway.name}
                                        </Tag>
                                    ))}
                                    {extraCount > 0 && <Tag>{moreTagLabel(extraCount, 'pathways')}</Tag>}
                                </div>
                            </div>
                        );
                    })()}

                    <Text type="secondary">
                        {selectedPathways[analysisId]?.filter(p => p.database === db.database).length || 0} of {db.pathways.length} pathways selected
                    </Text>

                    <VirtualPathwayTable
                        data={db.pathways}
                        selectedPathways={selectedPathways[analysisId] || []}
                        onSelectionChange={(newSelection) => handlePathwaySelectionChange(analysisId, newSelection)}
                        onSortChange={(sort) => handleSortChange(analysisId, db.database, sort)}
                    />
                </Space>
            )
        }));
    };

    const renderSelectedGenes = (analysisId) => {
        const genes = selectedGenes[analysisId] || [];
        if (genes.length === 0) return null;

        const {visible, extraCount} = capTags(genes);
        return (
            <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                <Text type="secondary">Selected genes:</Text>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                    {visible.map(gene => (
                        <Tag
                            key={gene.id}
                            closable
                            onClose={() => handleGeneRemove(analysisId, gene.id)}
                        >
                            {gene.name}
                        </Tag>
                    ))}
                    {extraCount > 0 && <Tag>{moreTagLabel(extraCount, 'genes')}</Tag>}
                </div>
            </div>
        );
    };

    // Collapsed-by-default list of names (pathways/genes) for the review step, so a
    // selection of thousands doesn't render one giant text block. Click to expand.
    const renderCollapsibleNameList = (names, singular) => {
        const list = names || [];
        if (list.length === 0) return <Text type="secondary">none</Text>;
        const noun = list.length === 1 ? singular : `${singular}s`;
        return (
            <Collapse
                ghost
                size="small"
                items={[{
                    key: 'names',
                    label: <Text type="secondary">{list.length} {noun} — click to expand</Text>,
                    children: <Text style={{wordBreak: 'break-word'}}>{list.join(', ')}</Text>,
                }]}
            />
        );
    };

    const handleGeneSelectionChange = (analysisId, newSelection) => {
        setSelectedGenes(prev => ({
            ...prev,
            [analysisId]: newSelection
        }));
    };

    const handleGeneRemove = (analysisId, geneId) => {
        setSelectedGenes(prev => ({
            ...prev,
            [analysisId]: prev[analysisId]?.filter(g => g.id !== geneId) || []
        }));
    };

    const handlePathwaySelectionChange = (analysisId, newSelection) => {
        setSelectedPathways(prev => ({
            ...prev,
            [analysisId]: newSelection
        }));
    };

    const handlePathwayRemove = (analysisId, pathwayId) => {
        setSelectedPathways(prev => ({
            ...prev,
            [analysisId]: prev[analysisId]?.filter(p => p.id !== pathwayId) || []
        }));
    };

    // Apply a top-N / all-significant / all selection for one database, ranking by
    // the table's current sort. Shared by handleTopNChange and handleSortChange.
    const applyPathwaySelection = (analysisId, database, value, sort) => {
        const pathways = pathwayData[analysisId]?.find(d => d.database === database)?.pathways || [];
        const mode = (value === 'allSignificant' || value === 'all') ? value : SELECTION_MODES.TOP;
        const topPathways = selectPathways(pathways, sort.columnKey, sort.order, mode, value);

        // Replace only this database's pathways, keeping every other database's
        // selection. Match on the structured `database` field (not an id prefix,
        // which would collide when one database name is a prefix of another, e.g.
        // "GO" vs "GO_BP"). Compute from `prev` so concurrent updates don't clobber.
        setSelectedPathways(prev => {
            const otherPathways = (prev[analysisId] || []).filter(p => p.database !== database);
            return {...prev, [analysisId]: [...otherPathways, ...topPathways]};
        });
    };

    const handleTopNChange = (analysisId, database, value) => {
        setDbTopN(prev => ({...prev, [`${analysisId}:${database}`]: value}));
        const sort = dbSort[`${analysisId}:${database}`] || DEFAULT_SORT;
        applyPathwaySelection(analysisId, database, value, sort);
    };

    // When the user re-sorts the table, "Top N" follows: re-pick the top pathways
    // using the new sort. "All significant" / "All" sets don't change with sort.
    const handleSortChange = (analysisId, database, sort) => {
        setDbSort(prev => ({...prev, [`${analysisId}:${database}`]: sort}));
        const currentVal = dbTopN[`${analysisId}:${database}`];
        if (currentVal === 'allSignificant' || currentVal === 'all') return;
        const n = (currentVal && !isNaN(currentVal)) ? currentVal : '20';
        applyPathwaySelection(analysisId, database, n, sort);
    };

    const handleGenesTopNChange = (value, analysisId = null) => {
        setGenesTopN(value);

        if (analysisId) {
            // Sort by pValue ascending
            const sortedGenes = [...(genes[analysisId] || [])].sort((a, b) => a.pValue - b.pValue);

            // Take top N or all
            let topGenes;
            if (value === 'all') {
                topGenes = sortedGenes;
            } else {
                topGenes = sortedGenes.slice(0, parseInt(value));
            }

            setSelectedGenes(prev => ({
                ...prev,
                [analysisId]: topGenes
            }));
        } else {
            const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
            const updatedSelectedGenes = {};
            actualAnalysisIds.forEach(analysisId => {
                if (genes[analysisId]) {
                    // Sort by pValue ascending
                    const sortedGenes = [...genes[analysisId]].sort((a, b) => a.pValue - b.pValue);

                    // Take top N or all
                    if (value === 'all') {
                        updatedSelectedGenes[analysisId] = sortedGenes;
                    } else {
                        updatedSelectedGenes[analysisId] = sortedGenes.slice(0, parseInt(value));
                    }
                }
            });
            setSelectedGenes(prev => ({...prev, ...updatedSelectedGenes}));
        }
    };

    // "Select top N genes with FDR < X and |Log2FC| > Y": filter by the thresholds,
    // then keep the top N by pValue ascending.
    const handleSelectTopGenes = (analysisId = null) => {
        const topN = parseInt(genesTopN) || DEFAULT_GENE_TOP_N;
        const pick = (list) => selectTopGenes(list || [], {fdr: geneFilterFDR, fc: geneFilterFC, topN});
        if (analysisId) {
            setSelectedGenes(prev => ({...prev, [analysisId]: pick(genes[analysisId])}));
        } else {
            const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
            const updated = {};
            actualAnalysisIds.forEach(id => {
                if (genes[id]) updated[id] = pick(genes[id]);
            });
            setSelectedGenes(prev => ({...prev, ...updated}));
        }
    };

    // "Use all DE Genes": select the analysis's DE gene set — the genes the user
    // filtered before running pathway analysis. Uses the same predicate as the volcano
    // plot's "Export DE genes" (pValueFDR <= maxAdjustedPValue && |log2FC| >=
    // minLogFoldChange) with the analysis's own thresholds (fallback 0.05 / 0.5).
    const handleUseAllDEGenes = (analysisId = null) => {
        const pick = (id) => {
            const cfg = configs.find(c => c.analysisId === id);
            // Use the ORIGINAL DE thresholds (the analysis's DE definition at creation), NOT the
            // live volcano-tuned values, so this always yields the "DE genes from the beginning".
            return selectAnalysisDEGenes(genes[id] || [], originalDEThresholds(cfg));
        };
        if (analysisId) {
            setSelectedGenes(prev => ({...prev, [analysisId]: pick(analysisId)}));
        } else {
            const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
            const updated = {};
            actualAnalysisIds.forEach(id => {
                if (genes[id]) updated[id] = pick(id);
            });
            setSelectedGenes(prev => ({...prev, ...updated}));
        }
    };

    const handleMethodChange = async (methodId, checked) => {
        // Implementation for method change handling
        console.log('Method change:', methodId, checked);
    };

    const canProceedToNextStep = () => {
        switch (currentStep) {
            case 0:
                const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
                const hasSelectedAnalyses = actualAnalysisIds.length > 0;
                const hasSelectedSections = selectedSections.pathways || selectedSections.genes;
                const hasData = (selectedSections.pathways && Object.values(selectedPathways).some(pathways => pathways.length > 0)) ||
                    (selectedSections.genes && Object.values(selectedGenes).some(genes => genes.length > 0));

                return hasSelectedAnalyses && hasSelectedSections && hasData;
            case 1:
                // Check if metadata exists OR user has provided consolidated metadata via template
                return Object.keys(analysesMetadata).length > 0 || consolidatedMetadata !== null;
            default:
                return true;
        }
    };

    const handleNextStep = () => {
        // If on step 1 (Experimental Context), validate before proceeding
        if (currentStep === 1) {
            // Check if we have metadata or consolidated metadata from template
            if (Object.keys(analysesMetadata).length === 0 && !consolidatedMetadata) {
                setShowValidationErrors(true);
                return;
            }
        }
        setCurrentStep(currentStep + 1);
    };

    const handlePreviousStep = () => {
        setShowValidationErrors(false);
        setCurrentStep(currentStep - 1);
    };

    // What the Review step describes: the sections a submission made right now would actually
    // carry, computed by the same helper the submission itself uses, so the summary cannot claim
    // something the payload does not contain.
    const {sections: reviewSections} = collectSubmissionSelections({
        analysisIds: selectedAnalyses.filter(id => !id.startsWith('group_')),
        selectedSections,
        selectedPathways,
        selectedGenes
    });

    const steps = [
        {
            title: 'Selection',
            content: (
                <div className="space-y-4">
                    <Card title="Analysis Selection">
                        <Space direction={'vertical'} style={{width: '100%'}}>
                            <TreeSelect
                                style={{width: '100%'}}
                                placeholder="Select an analysis..."
                                value={selectedAnalyses[0] || undefined}
                                onChange={(value) => handleAnalysisSelection(value ? [value] : [])}
                                treeData={options}
                                treeDefaultExpandAll
                                treeLine
                                showSearch
                                filterTreeNode={(search, node) => {
                                    return node.title.toLowerCase().includes(search.toLowerCase());
                                }}
                            />
                            <Space direction={'vertical'} style={{width: '100%'}}>
                                <Typography.Text>Insight name:</Typography.Text>
                                <Input
                                    value={insightName}
                                    onChange={e => setInsightName(e.target.value)}
                                />
                            </Space>
                        </Space>
                    </Card>

                    {selectedAnalyses.length > 0 && (
                        <>
                            {renderStatisticalMethods()}

                            <Card title={
                                <Space>
                                    <Checkbox
                                        checked={selectedSections.pathways}
                                        onChange={(e) => setSelectedSections(prev => ({
                                            ...prev,
                                            pathways: e.target.checked
                                        }))}
                                    />
                                    <span>Pathways</span>
                                </Space>
                            }>
                                {selectedSections.pathways && (() => {
                                    const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
                                    // Controlled Collapse: open the first database panel by default
                                    // (only the first, even with multiple databases) and keep the
                                    // user's expand/collapse choices once they interact.
                                    const renderPathwayCollapse = (analysisId) => {
                                        const items = getCollapseItems(analysisId);
                                        return (
                                            <Collapse
                                                activeKey={pathwayActiveKeys[analysisId] ?? firstPanelKeys(items)}
                                                onChange={keys => setPathwayActiveKeys(prev => ({...prev, [analysisId]: keys}))}
                                                items={items}
                                            />
                                        );
                                    };
                                    return actualAnalysisIds.length === 1 ? (
                                        renderPathwayCollapse(actualAnalysisIds[0])
                                    ) : (
                                        <Tabs
                                            type="card"
                                            items={actualAnalysisIds.map(analysisId => {
                                                const analysisName = analyses[analysisId]?.name || `Analysis ${analysisId}`;
                                                return {
                                                    key: analysisId,
                                                    label: analysisName,
                                                    children: renderPathwayCollapse(analysisId)
                                                };
                                            })}
                                        />
                                    );
                                })()}
                                {!selectedSections.pathways && (
                                    <div style={{padding: '20px', textAlign: 'center', color: '#666'}}>
                                        Pathways section is disabled. Check the box above to include pathway information
                                        in the analysis.
                                    </div>
                                )}
                            </Card>

                            {Object.keys(genes).length > 0 && (
                                <Card title={
                                    <Space>
                                        <Checkbox
                                            checked={selectedSections.genes}
                                            onChange={(e) => setSelectedSections(prev => ({
                                                ...prev,
                                                genes: e.target.checked
                                            }))}
                                        />
                                        <span>DE Genes</span>
                                    </Space>
                                }>
                                    {selectedSections.genes && (() => {
                                        const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
                                        const analysisId = actualAnalysisIds[0];

                                        // Check if genes data exists for this analysis (meta-analyses don't have gene-level data)
                                        if (actualAnalysisIds.length === 1 && !genes[analysisId]) {
                                            return (
                                                <div style={{padding: '20px', textAlign: 'center', color: '#666'}}>
                                                    Gene-level data is not available for this analysis.
                                                </div>
                                            );
                                        }

                                        return actualAnalysisIds.length === 1 ? (
                                            <Space direction="vertical" style={{width: '100%'}} size="large">
                                                <Space wrap>
                                                    <Text>Select top</Text>
                                                    <InputNumber
                                                        min={1}
                                                        value={parseInt(genesTopN) || DEFAULT_GENE_TOP_N}
                                                        onChange={(val) => setGenesTopN(String(val || DEFAULT_GENE_TOP_N))}
                                                        size="small"
                                                        style={{width: 70}}
                                                    />
                                                    <Text>genes with:</Text>
                                                    <Text>pValue.FDR &lt;</Text>
                                                    <Select
                                                        value={geneFilterFDR}
                                                        onChange={setGeneFilterFDR}
                                                        style={{width: 100}}
                                                        size="small"
                                                        dropdownRender={(menu) => (
                                                            <>
                                                                {menu}
                                                                <Divider style={{margin: '8px 0'}} />
                                                                <Space style={{padding: '0 8px 4px'}}>
                                                                    <InputNumber
                                                                        placeholder="Custom"
                                                                        value={customGeneFDRInput}
                                                                        onChange={(val) => {
                                                                            if (val !== null && val >= 0 && val <= 1) {
                                                                                setCustomGeneFDRInput(val);
                                                                                setGeneFilterFDR(val);
                                                                            }
                                                                        }}
                                                                        min={0}
                                                                        max={1}
                                                                        step={0.01}
                                                                        size="small"
                                                                        style={{width: 80}}
                                                                    />
                                                                </Space>
                                                            </>
                                                        )}
                                                    >
                                                        <Option value={0.01}>0.01</Option>
                                                        <Option value={0.05}>0.05</Option>
                                                        <Option value={0.1}>0.1</Option>
                                                    </Select>
                                                    <Text>and |Log2FC| &gt;</Text>
                                                    <Select
                                                        value={geneFilterFC}
                                                        onChange={setGeneFilterFC}
                                                        style={{width: 100}}
                                                        size="small"
                                                        dropdownRender={(menu) => (
                                                            <>
                                                                {menu}
                                                                <Divider style={{margin: '8px 0'}} />
                                                                <Space style={{padding: '0 8px 4px'}}>
                                                                    <InputNumber
                                                                        placeholder="Custom"
                                                                        value={customGeneFCInput}
                                                                        onChange={(val) => {
                                                                            if (val !== null && val >= 0 && val <= 10) {
                                                                                setCustomGeneFCInput(val);
                                                                                setGeneFilterFC(val);
                                                                            }
                                                                        }}
                                                                        min={0}
                                                                        max={10}
                                                                        step={0.1}
                                                                        size="small"
                                                                        style={{width: 80}}
                                                                    />
                                                                </Space>
                                                            </>
                                                        )}
                                                    >
                                                        <Option value={0.5}>0.5</Option>
                                                        <Option value={1.0}>1.0</Option>
                                                        <Option value={1.5}>1.5</Option>
                                                        <Option value={2.0}>2.0</Option>
                                                    </Select>
                                                    <Button
                                                        type="primary"
                                                        size="small"
                                                        onClick={() => handleSelectTopGenes()}
                                                    >
                                                        Select genes
                                                    </Button>
                                                    <Button
                                                        type="primary"
                                                        size="small"
                                                        icon={<ThunderboltOutlined/>}
                                                        style={{background: '#52c41a', borderColor: '#52c41a'}}
                                                        onClick={() => handleUseAllDEGenes()}
                                                    >
                                                        Use all DE Genes
                                                    </Button>
                                                </Space>

                                                {renderSelectedGenes(analysisId)}

                                                <Text type="secondary">
                                                    {(selectedGenes[analysisId] || []).length} of {genes[analysisId].length} genes selected
                                                </Text>

                                                <VirtualGeneTable
                                                    data={[...genes[analysisId]].sort((a, b) => Math.abs(b.foldChange) - Math.abs(a.foldChange))}
                                                    selectedGenes={selectedGenes[analysisId] || []}
                                                    onSelectionChange={(newSelection) => handleGeneSelectionChange(analysisId, newSelection)}
                                                    analyses={analyses}
                                                    selectedAnalyses={selectedAnalyses}
                                                />
                                            </Space>
                                        ) : (
                                            <Tabs
                                                type="card"
                                                items={actualAnalysisIds.filter(analysisId => genes[analysisId]).map(analysisId => {
                                                    const analysisName = analyses[analysisId]?.name || `Analysis ${analysisId}`;
                                                    return {
                                                        key: analysisId,
                                                        label: analysisName,
                                                        children: (
                                                            <Space direction="vertical" style={{width: '100%'}}
                                                                   size="large">
                                                                <Space wrap>
                                                                    <Text>Select top</Text>
                                                                    <InputNumber
                                                                        min={1}
                                                                        value={parseInt(genesTopN) || DEFAULT_GENE_TOP_N}
                                                                        onChange={(val) => setGenesTopN(String(val || DEFAULT_GENE_TOP_N))}
                                                                        size="small"
                                                                        style={{width: 70}}
                                                                    />
                                                                    <Text>genes with:</Text>
                                                                    <Text>pValue.FDR &lt;</Text>
                                                                    <Select
                                                                        value={geneFilterFDR}
                                                                        onChange={setGeneFilterFDR}
                                                                        style={{width: 100}}
                                                                        size="small"
                                                                        dropdownRender={(menu) => (
                                                                            <>
                                                                                {menu}
                                                                                <Divider style={{margin: '8px 0'}} />
                                                                                <Space style={{padding: '0 8px 4px'}}>
                                                                                    <InputNumber
                                                                                        placeholder="Custom"
                                                                                        value={customGeneFDRInput}
                                                                                        onChange={(val) => {
                                                                                            if (val !== null && val >= 0 && val <= 1) {
                                                                                                setCustomGeneFDRInput(val);
                                                                                                setGeneFilterFDR(val);
                                                                                            }
                                                                                        }}
                                                                                        min={0}
                                                                                        max={1}
                                                                                        step={0.01}
                                                                                        size="small"
                                                                                        style={{width: 80}}
                                                                                    />
                                                                                </Space>
                                                                            </>
                                                                        )}
                                                                    >
                                                                        <Option value={0.01}>0.01</Option>
                                                                        <Option value={0.05}>0.05</Option>
                                                                        <Option value={0.1}>0.1</Option>
                                                                    </Select>
                                                                    <Text>and |Log2FC| &gt;</Text>
                                                                    <Select
                                                                        value={geneFilterFC}
                                                                        onChange={setGeneFilterFC}
                                                                        style={{width: 100}}
                                                                        size="small"
                                                                        dropdownRender={(menu) => (
                                                                            <>
                                                                                {menu}
                                                                                <Divider style={{margin: '8px 0'}} />
                                                                                <Space style={{padding: '0 8px 4px'}}>
                                                                                    <InputNumber
                                                                                        placeholder="Custom"
                                                                                        value={customGeneFCInput}
                                                                                        onChange={(val) => {
                                                                                            if (val !== null && val >= 0 && val <= 10) {
                                                                                                setCustomGeneFCInput(val);
                                                                                                setGeneFilterFC(val);
                                                                                            }
                                                                                        }}
                                                                                        min={0}
                                                                                        max={10}
                                                                                        step={0.1}
                                                                                        size="small"
                                                                                        style={{width: 80}}
                                                                                    />
                                                                                </Space>
                                                                            </>
                                                                        )}
                                                                    >
                                                                        <Option value={0.5}>0.5</Option>
                                                                        <Option value={1.0}>1.0</Option>
                                                                        <Option value={1.5}>1.5</Option>
                                                                        <Option value={2.0}>2.0</Option>
                                                                    </Select>
                                                                    <Button
                                                                        type="primary"
                                                                        size="small"
                                                                        onClick={() => handleSelectTopGenes(analysisId)}
                                                                    >
                                                                        Select genes
                                                                    </Button>
                                                                    <Button
                                                                        type="primary"
                                                                        size="small"
                                                                        icon={<ThunderboltOutlined/>}
                                                                        style={{background: '#52c41a', borderColor: '#52c41a'}}
                                                                        onClick={() => handleUseAllDEGenes(analysisId)}
                                                                    >
                                                                        Use all DE Genes
                                                                    </Button>
                                                                </Space>

                                                                {renderSelectedGenes(analysisId)}

                                                                <Text type="secondary">
                                                                    {(selectedGenes[analysisId] || []).length} of {genes[analysisId].length} genes selected
                                                                </Text>

                                                                <VirtualGeneTable
                                                                    data={[...genes[analysisId]].sort((a, b) => Math.abs(b.foldChange) - Math.abs(a.foldChange))}
                                                                    selectedGenes={selectedGenes[analysisId] || []}
                                                                    onSelectionChange={(newSelection) => handleGeneSelectionChange(analysisId, newSelection)}
                                                                    analyses={analyses}
                                                                    selectedAnalyses={[analysisId]}
                                                                />
                                                            </Space>
                                                        )
                                                    };
                                                })}
                                            />
                                        );
                                    })()}
                                    {!selectedSections.genes && (
                                        <div style={{padding: '20px', textAlign: 'center', color: '#666'}}>
                                            DE Genes section is disabled. Check the box above to include gene
                                            information in the analysis.
                                        </div>
                                    )}
                                </Card>
                            )}
                        </>
                    )}
                </div>
            ),
        },
        {
            title: 'Template',
            content: (
                <Space direction="vertical" size="large" style={{width: '100%'}}>
                    <Card title="Experimental Context">
                        {Object.keys(analysesMetadata).length > 0 ? (
                            <Space direction="vertical" style={{ width: '100%' }} size="middle">
                                <Text type="secondary">
                                    Metadata automatically loaded from {Object.keys(analysesMetadata).length} dataset{Object.keys(analysesMetadata).length > 1 ? 's' : ''}:
                                </Text>
                                <div style={{
                                    maxHeight: 300,
                                    overflowY: 'auto',
                                    paddingRight: 4
                                }}>
                                    {Object.entries(analysesMetadata).map(([datasetName, metadata]) => {
                                        if (!metadata || Object.keys(metadata).length === 0) return null;

                                        return (
                                            <div key={datasetName} style={{
                                                padding: 12,
                                                background: '#f0f2f5',
                                                borderRadius: 6,
                                                marginTop: 8
                                            }}>
                                                <Text strong>{datasetName}</Text>
                                                <div style={{ marginTop: 8 }}>
                                                    {Object.entries(metadata).map(([key, value]) => (
                                                        <div key={key} style={{ marginBottom: 4 }}>
                                                            <Text type="secondary">{key}: </Text>
                                                            <Text>{value}</Text>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <Text type="secondary" style={{ fontSize: '12px', marginTop: 8 }}>
                                    This metadata will be used for AI interpretation and validation.
                                </Text>
                            </Space>
                        ) : (
                            <Space direction="vertical" style={{ width: '100%', textAlign: 'center' }} size="large">
                                <div>
                                    <InfoCircleOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
                                    <Title level={5}>Biological Context Required</Title>
                                    <Text type="secondary">
                                        AI interpretation requires biological context about your study.
                                    </Text>
                                </div>
                                <Button
                                    type="primary"
                                    size="large"
                                    icon={<PlusOutlined />}
                                    onClick={() => setShowMetadataModal(true)}
                                >
                                    Provide Study Context
                                </Button>
                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                    💡 You'll select your study type and fill in required fields (organism, tissue, etc.)
                                </Text>
                            </Space>
                        )}
                    </Card>

                    <Card title="Analysis Summary">
                        <Space direction="vertical" size="middle" style={{width: '100%'}}>
                            <div>
                                <Title level={5}>Selected Analyses</Title>
                                <Text>{selectedAnalyses.filter(id => !id.startsWith('group_')).map(id => analyses[id]?.name || id).join(', ')}</Text>
                            </div>

                            <div>
                                <Title level={5}>Selected Sections</Title>
                                <Text>{describeSelectedSections(reviewSections)}</Text>
                            </div>

                            <div>
                                <Title level={5}>Methods</Title>
                                <Text>{selectedMethods.join(', ')}</Text>
                            </div>

                            {reviewSections.pathways && (
                                <div>
                                    <Title level={5}>Selected databases and pathways</Title>
                                    {selectedAnalyses.filter(id => !id.startsWith('group_')).map(analysisId => (
                                        <div key={analysisId} style={{marginBottom: 16}}>
                                            <Text strong>{analyses[analysisId]?.name}:</Text>
                                            {pathwayData[analysisId]?.map(db => (
                                                <div key={db.database} style={{marginLeft: 24, marginBottom: 8}}>
                                                    <Text strong>- {db.database}:</Text>{' '}
                                                    {renderCollapsibleNameList(
                                                        selectedPathways[analysisId]
                                                            ?.filter(p => p.database === db.database)
                                                            .map(p => p.name),
                                                        'pathway'
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {reviewSections.genes && (
                                <div>
                                    <Title level={5}>Selected DE genes</Title>
                                    {selectedAnalyses.filter(id => !id.startsWith('group_')).map(analysisId => (
                                        genes[analysisId] && (
                                            <div key={analysisId} style={{marginBottom: 8}}>
                                                <Text strong>{analyses[analysisId]?.name}:</Text>{' '}
                                                {renderCollapsibleNameList(
                                                    selectedGenes[analysisId]?.map(g => g.name),
                                                    'gene'
                                                )}
                                            </div>
                                        )
                                    ))}
                                </div>
                            )}
                        </Space>
                    </Card>

                </Space>
            ),
        }
    ];

    const renderContent = () => {
        switch (view) {
            case 'wizard':
                return (
                    <div style={{padding: '24px'}}>
                        <Steps
                            current={currentStep}
                            items={steps.map(step => ({title: step.title}))}
                            style={{marginBottom: '32px'}}
                        />

                        <div style={{
                            marginTop: '16px',
                            backgroundColor: 'white',
                            borderRadius: '8px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                        }}>
                            {steps[currentStep].content}
                        </div>

                        <div style={{
                            marginTop: '24px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '16px'
                        }}>
                            <Button
                                onClick={exitToDashboard}
                                icon={<ArrowLeftOutlined/>}
                            >
                                Back to Insights
                            </Button>

                            <Space>
                                {currentStep > 0 && (
                                    <Button onClick={handlePreviousStep}>
                                        Previous
                                    </Button>
                                )}

                                {currentStep === steps.length - 1 ? (
                                    <Button
                                        type="primary"
                                        onClick={handleGenerateReport}
                                        disabled={loading || !canProceedToNextStep()}
                                        loading={loading}
                                    >
                                        Generate Insight
                                    </Button>
                                ) : (
                                    <Button
                                        type="primary"
                                        onClick={handleNextStep}
                                        disabled={!canProceedToNextStep()}
                                    >
                                        Next
                                    </Button>
                                )}
                            </Space>
                        </div>
                    </div>
                );

            case 'viewer':
                return (
                    <InsightViewer
                        batchId={selectedInsight}
                        onClose={() => {
                            exitToDashboard();
                            setSelectedInsight(null);
                        }}
                        // The viewer's own "Back to Insights" calls setView('dashboard'); route
                        // that through the same exit so it cannot slip past onExitWizard either.
                        setView={(next) => (next === 'dashboard' ? exitToDashboard() : setView(next))}
                        setSelectedInsight={setSelectedInsight}
                    />
                );

            default: // dashboard view
                // A host that owns the reports list gets it back rather than seeing this one. The
                // effect above performs the hand-off; rendering nothing here is what makes the
                // internal dashboard genuinely unreachable from such a host, whatever set `view`.
                if (typeof onExitWizard === 'function') return null;
                return (
                    <div style={{padding: '24px'}}>
                        <div style={{marginBottom: '24px'}}>
                            <Tabs
                                defaultActiveKey="insights"
                                items={[
                                    {
                                        key: 'insights',
                                        label: (
                                            <span>
                                                <BulbOutlined/>
                                                My Insights
                                            </span>
                                        ),
                                        children: (
                                            <div>
                                                {/* Generating an insight writes a report into the
                                                    study, which a view-only import rejects
                                                    server-side. Existing reports stay readable. */}
                                                {!readOnly && (
                                                    <div className="flex justify-between items-center mb-6"
                                                         style={{marginBottom: 10}}>
                                                        <Button
                                                            type="primary"
                                                            icon={<PlusOutlined/>}
                                                            onClick={handleStartNewInsight}
                                                        >
                                                            Generate New Insight
                                                        </Button>
                                                    </div>
                                                )}
                                                <InsightDashboard
                                                    userId={Meteor.userId()}
                                                    sessionId={sessionId}
                                                    onViewInsight={handleViewInsight}
                                                />
                                            </div>
                                        )
                                    }
                                ]}
                            />
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="analysis-wizard-container">
            <LoadingOverlay
                loading={loading}
                loadingMessage={loadingMessage}
                loadingProgress={loadingProgress}
                pipelineProgress={pipelineProgress}
            />
            {renderContent()}

            {/* Metadata Template Modal */}
            <MetadataTemplateModal
                visible={showMetadataModal}
                initialMetadata={consolidatedMetadata || {}}
                onSubmit={handleMetadataImprove}
                onCancel={handleMetadataCancel}
            />
        </div>
    );
};

export default AnalysisWizard;
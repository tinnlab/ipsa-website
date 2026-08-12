import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import {
    Layout, Card, Tree, Button, Space, Typography, Spin, Empty,
    Tag, Divider, Badge, Alert, Modal, Input
} from 'antd';
import {
    FolderOutlined, FileTextOutlined, ExperimentOutlined,
    ReloadOutlined, ArrowLeftOutlined, PlusOutlined,
    CheckCircleOutlined, SyncOutlined, ClockCircleOutlined,
    CloseCircleOutlined, GroupOutlined
} from '@ant-design/icons';
import { Helmet } from 'react-helmet';
import { InsightViewer, InsightList } from '../Analysis/Visualization/components/AIForm/InsightComponents';
import AnalysisWizard from '../Analysis/Visualization/components/AIForm/AnalysisWizard';
import { GlobalSettingsProvider } from '../../../contexts/GlobalSettingsContext';
import { resolveTreeSelection, initialSelectedAnalysesFor, resolveDeepLinkSelection, analysisNameInStudy } from '../../../../utils/aiInterpretationSelection';
import { batchesForSelection, groupBatchesByAnalysis, isReadOnlyStudy } from '../../../../utils/aiInterpretationReports';

const { Title, Text } = Typography;
const { Content, Sider } = Layout;

export default function AIInterpretation() {
    const navigate = useNavigate();
    const location = useLocation();
    const deepLinkAppliedRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [studies, setStudies] = useState([]);
    const [batches, setBatches] = useState([]);
    const [studyMetaAnalyses, setStudyMetaAnalyses] = useState({});
    const [selectedKeys, setSelectedKeys] = useState([]);
    const [expandedKeys, setExpandedKeys] = useState([]);
    const [selectedBatchId, setSelectedBatchId] = useState(null);
    const [selectedAnalysis, setSelectedAnalysis] = useState(null);
    // The page has one hierarchy: overview -> the selection's reports -> (only on request) the
    // generator. Selecting something used to mount the wizard immediately, so the user was thrown
    // into "generate" without ever being shown what they already had. `generating` is what the
    // "Generate new insight" button turns on, and it is cleared by every change of selection.
    const [generating, setGenerating] = useState(false);

    // Rename-report modal state
    const [renamingBatch, setRenamingBatch] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [renameSaving, setRenameSaving] = useState(false);

    // Wizard data state
    const [wizardLoading, setWizardLoading] = useState(false);
    const [wizardData, setWizardData] = useState(null);

    const user = useTracker(() => Meteor.user());

    // Subscribe to sessions
    useEffect(() => {
        if (user?._id) {
            const handle = Meteor.subscribe('session.all', user._id);
            return () => handle.stop();
        }
    }, [user?._id]);

    // Get studies reactively from subscription
    const studiesFromTracker = useTracker(() => {
        if (!user?._id) return [];
        return DBCollections.Session.find(
            { userId: user._id, status: 'Active' },
            { sort: { createdAt: -1 } }
        ).fetch();
    }, [user?._id]);

    // Update studies state when tracker data changes
    useEffect(() => {
        setStudies(studiesFromTracker);
        // Auto-expand first study if there are studies and no expanded keys yet
        if (studiesFromTracker.length > 0 && expandedKeys.length === 0) {
            setExpandedKeys([studiesFromTracker[0]._id]);
        }
    }, [studiesFromTracker]);

    // Arriving by link should open exactly what clicking the same thing in the sidebar opens:
    // ?sessionId= alone selects the study, ?sessionId=&analysisId= selects that analysis. Both land
    // on that selection's REPORTS, like a click. Ref-guarded so it runs once, only after the studies
    // have loaded, and never overrides a later click of the user's own.
    useEffect(() => {
        if (deepLinkAppliedRef.current || studies.length === 0) return;
        deepLinkAppliedRef.current = true; // consume the link even if it does not resolve

        const selection = resolveDeepLinkSelection(location.search, studies);
        if (!selection) return;

        setSelectedAnalysis(selection);
        // Select the same tree key the equivalent click would have selected, so the sidebar
        // highlights the analysis — not merely its study — when the link named one.
        setSelectedKeys([selection.analysisId ? `${selection.sessionId}|${selection.analysisId}` : selection.sessionId]);
        setExpandedKeys(prev => prev.includes(selection.sessionId) ? prev : [...prev, selection.sessionId]);
        setSelectedBatchId(null);
        setGenerating(false);
        setWizardData(null);
    }, [studies, location.search]);

    // Fetch batches
    useEffect(() => {
        const fetchBatches = async () => {
            if (!user?._id) return;

            setLoading(true);
            try {
                const userBatches = await Meteor.callAsync('queue.getUserBatches', user._id);
                setBatches(userBatches);
            } catch (error) {
                console.error('Error fetching batches:', error);
                notify.error('Failed to load reports');
            } finally {
                setLoading(false);
            }
        };

        fetchBatches();
    }, [user?._id]);

    // Fetch meta-analyses for each study
    useEffect(() => {
        const fetchMetaAnalyses = async () => {
            if (studies.length === 0) return;

            const metaAnalysesMap = {};

            for (const study of studies) {
                try {
                    const metaAnalyses = await Meteor.callAsync(
                        'visualization.getMetaAnalyses',
                        { sessionId: study._id }
                    );
                    metaAnalysesMap[study._id] = metaAnalyses || [];
                } catch (error) {
                    console.error(`Error fetching meta-analyses for study ${study._id}:`, error);
                    metaAnalysesMap[study._id] = [];
                }
            }

            setStudyMetaAnalyses(metaAnalysesMap);
        };

        fetchMetaAnalyses();
    }, [studies]);

    // Build tree data from studies and analyses
    const treeData = useMemo(() => {
        return studies.map(study => {
            const studyBatches = batches.filter(b => b.sessionId === study._id);
            const analyses = study.analyses || [];
            const metaAnalyses = studyMetaAnalyses[study._id] || [];

            // Build analysis nodes
            const analysisNodes = analyses.map(analysis => {
                const analysisBatches = batches.filter(b => b.analysisId === analysis.id);
                return {
                    key: `${study._id}|${analysis.id}`,
                    title: (
                        <Space>
                            <ExperimentOutlined />
                            <Text>{analysis.name}</Text>
                            {analysisBatches.length > 0 && (
                                <Badge count={analysisBatches.length} size="small" />
                            )}
                        </Space>
                    ),
                    isLeaf: true,
                    sessionId: study._id,
                    analysisId: analysis.id,
                    analysisName: analysis.name,
                    batches: analysisBatches
                };
            });

            // Build meta-analysis nodes
            const metaAnalysisNodes = metaAnalyses.map(meta => {
                const metaBatches = batches.filter(b => b.analysisId === meta.id);
                return {
                    key: `${study._id}|${meta.id}`,
                    title: (
                        <Space>
                            <GroupOutlined />
                            <Text>📊 {meta.name}</Text>
                            {metaBatches.length > 0 && (
                                <Badge count={metaBatches.length} size="small" />
                            )}
                        </Space>
                    ),
                    isLeaf: true,
                    sessionId: study._id,
                    analysisId: meta.id,
                    analysisName: meta.name,
                    batches: metaBatches
                };
            });

            return {
                key: study._id,
                title: (
                    <Space>
                        <FolderOutlined />
                        <Text strong>{study.name}</Text>
                        {studyBatches.length > 0 && (
                            <Badge count={studyBatches.length} size="small" style={{ backgroundColor: '#52c41a' }} />
                        )}
                    </Space>
                ),
                // Selectable: clicking a study ("big analysis") opens the interpretation picker
                // scoped to this study's analyses, with nothing pre-selected (the user chooses).
                sessionId: study._id,
                studyName: study.name,
                children: [...analysisNodes, ...metaAnalysisNodes]
            };
        });
    }, [studies, batches, studyMetaAnalyses]);

    // The study the current selection belongs to, and its reports grouped by analysis. A study
    // selection covers every analysis and meta-analysis under it; an analysis selection covers
    // just that one. See aiInterpretationReports.
    const selectedStudy = useMemo(
        () => studies.find(s => s._id === selectedAnalysis?.sessionId) || null,
        [studies, selectedAnalysis]
    );

    const selectionReportGroups = useMemo(
        () => groupBatchesByAnalysis(batchesForSelection(batches, selectedAnalysis), selectedStudy),
        [batches, selectedAnalysis, selectedStudy]
    );

    const selectionReportCount = useMemo(
        () => selectionReportGroups.reduce((n, group) => n + group.batches.length, 0),
        [selectionReportGroups]
    );

    // A view-only imported study can be read but not written: rename, delete and generate are all
    // refused server-side, so they are not offered. Resolved per study because this page shows
    // several at once (the overview spans all of them).
    const selectionReadOnly = isReadOnlyStudy(studies, selectedAnalysis?.sessionId);

    // Group all batches by study for overview display
    const batchesGroupedByStudy = useMemo(() => {
        const grouped = {};

        batches.forEach(batch => {
            const study = studies.find(s => s._id === batch.sessionId);
            if (!study) return;

            if (!grouped[study._id]) {
                grouped[study._id] = {
                    studyId: study._id,
                    studyName: study.name,
                    analyses: {}
                };
            }

            // Find analysis name
            const analysis = study.analyses?.find(a => a.id === batch.analysisId);
            const analysisName = analysis?.name || batch.analysisName || 'Unknown Analysis';

            if (!grouped[study._id].analyses[batch.analysisId]) {
                grouped[study._id].analyses[batch.analysisId] = {
                    analysisId: batch.analysisId,
                    analysisName,
                    batches: []
                };
            }

            grouped[study._id].analyses[batch.analysisId].batches.push(batch);
        });

        // Sort batches within each analysis by date
        Object.values(grouped).forEach(study => {
            Object.values(study.analyses).forEach(analysis => {
                analysis.batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            });
        });

        return Object.values(grouped);
    }, [batches, studies]);

    const handleTreeSelect = (keys, info) => {
        if (keys.length === 0) return;

        // A study key ("big analysis") opens the picker scoped to its analyses with nothing
        // pre-selected; an analysis key pre-selects that analysis. (See aiInterpretationSelection.)
        const selection = resolveTreeSelection(keys[0], info.node);
        if (!selection) return;
        setSelectedAnalysis(selection);
        setSelectedKeys(keys);
        setSelectedBatchId(null);
        setGenerating(false); // a click shows what exists; it never opens the generator
        setWizardData(null); // Clear previous wizard data
    };

    // Load the wizard's data only once the user actually asks to generate. Loading it on every
    // sidebar click cost two round-trips per click for a screen that shows reports and needs none
    // of it.
    useEffect(() => {
        const loadWizardData = async () => {
            if (!selectedAnalysis || !generating) {
                setWizardData(null);
                return;
            }

            setWizardLoading(true);

            try {
                // Fetch configurations and analyses for the session
                const { analyses, allConfigs } = await Meteor.callAsync(
                    'visualization.getConfigurations',
                    { sessionId: selectedAnalysis.sessionId }
                );

                // Fetch meta analyses
                const metaAnalyses = await Meteor.callAsync(
                    'visualization.getMetaAnalyses',
                    { sessionId: selectedAnalysis.sessionId }
                );

                // Build analysesObj
                const analysesObj = analyses.reduce((acc, curr) => {
                    acc[curr.id] = curr;
                    return acc;
                }, {});

                // Get configs array
                const configs = Object.values(allConfigs).filter(config => config.analysisId);

                // Get organism ID from first analysis
                const organismId = analyses.length > 0 ? analyses[0].organismId : null;

                setWizardData({
                    analyses: analysesObj,
                    metaAnalyses,
                    sessionId: selectedAnalysis.sessionId,
                    configs,
                    organismId,
                    // Pre-select the clicked analysis; empty when a study was clicked.
                    initialSelectedAnalyses: initialSelectedAnalysesFor(selectedAnalysis)
                });
            } catch (error) {
                console.error('Error loading wizard data:', error);
                notify.error('Failed to load analysis data');
            } finally {
                setWizardLoading(false);
            }
        };

        loadWizardData();
    }, [selectedAnalysis, generating]);

    // Back navigation, one level at a time. The generator returns to the reports of the selection
    // it was opened from — never straight to the overview, which would lose the user's place.
    const handleBackToOverview = () => {
        setSelectedAnalysis(null);
        setSelectedKeys([]);
        setGenerating(false);
        setWizardData(null);
        handleRefresh();
    };

    const handleGenerateNewInsight = () => setGenerating(true);

    // Also where the wizard hands back once a report has finished generating, hence the refresh:
    // the user lands on this selection's list with the report they just made in it.
    const handleExitWizard = () => {
        setGenerating(false);
        setWizardData(null);
        handleRefresh();
    };

    const handleViewReport = (batchId) => {
        setSelectedBatchId(batchId);
    };

    const handleDeleteReport = (batch) => {
        Modal.confirm({
            title: 'Delete this report?',
            content: `"${batch.insightName || 'Untitled report'}" will be permanently removed.`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await Meteor.callAsync('queue.removeBatch', batch._id);
                    notify.success('Report deleted');
                    if (selectedBatchId === batch._id) setSelectedBatchId(null);
                    await handleRefresh();
                } catch (error) {
                    notify.error(error.reason || 'Failed to delete report');
                }
            }
        });
    };

    const openRenameModal = (batch) => {
        setRenamingBatch(batch);
        setRenameValue(batch.insightName || '');
    };

    const handleRenameSave = async () => {
        if (!renamingBatch) return;
        setRenameSaving(true);
        try {
            await Meteor.callAsync('queue.updateBatchName', renamingBatch._id, renameValue);
            notify.success('Report renamed');
            setRenamingBatch(null);
            await handleRefresh();
        } catch (error) {
            notify.error(error.reason || 'Failed to rename report');
        } finally {
            setRenameSaving(false);
        }
    };

    const handleBackToList = () => {
        setSelectedBatchId(null);
    };

    const handleRefresh = async () => {
        if (!user?._id) return;

        setLoading(true);
        try {
            const userBatches = await Meteor.callAsync('queue.getUserBatches', user._id);
            setBatches(userBatches);
        } catch (error) {
            console.error('Error refreshing batches:', error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusTag = (status) => {
        switch (status) {
            case 'completed':
                return <Tag icon={<CheckCircleOutlined />} color="success">Completed</Tag>;
            case 'processing':
                return <Tag icon={<SyncOutlined spin />} color="processing">Processing</Tag>;
            case 'pending':
                return <Tag icon={<ClockCircleOutlined />} color="default">Pending</Tag>;
            case 'failed':
            case 'error':
                return <Tag icon={<CloseCircleOutlined />} color="error">Failed</Tag>;
            default:
                return <Tag>{status}</Tag>;
        }
    };

    const formatDate = (date) => {
        if (!date) return '';
        return new Date(date).toLocaleString();
    };

    // Show InsightViewer if a batch is selected. Full-width, no sidebar — that is the whole point
    // of routing "View" up to this page instead of the wizard's internal viewer.
    if (selectedBatchId) {
        // Name the report from THIS page's batch list rather than leaving the viewer to work it
        // out: this copy is reloaded after every rename, so the header cannot show a stale name.
        const viewedBatch = batches.find(b => b._id === selectedBatchId);
        const viewedStudy = studies.find(s => s._id === viewedBatch?.sessionId);
        return (
            <GlobalSettingsProvider>
                <Layout style={{ minHeight: 'calc(100vh - 70px - 60px)', background: '#f5f5f5' }}>
                    <Helmet title="AI Report - IPSA Platform" />
                    <Content style={{ padding: '24px' }}>
                        <InsightViewer
                            batchId={selectedBatchId}
                            onClose={handleBackToList}
                            setView={() => setSelectedBatchId(null)}
                            setSelectedInsight={() => {}}
                            studyName={viewedStudy?.name}
                            analysisName={analysisNameInStudy(viewedStudy, viewedBatch?.analysisId) || viewedBatch?.analysisName}
                            reportName={viewedBatch?.insightName}
                        />
                    </Content>
                </Layout>
            </GlobalSettingsProvider>
        );
    }

    return (
        <Layout style={{ minHeight: 'calc(100vh - 70px - 60px)', background: '#f5f5f5' }}>
            <Helmet title="AI-interpretation - IPSA Platform" />

            {/* Rename-report modal */}
            <Modal
                title="Rename report"
                open={!!renamingBatch}
                onCancel={() => setRenamingBatch(null)}
                onOk={handleRenameSave}
                okText="Save"
                confirmLoading={renameSaving}
                okButtonProps={{ disabled: !renameValue.trim() }}
                destroyOnClose
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={handleRenameSave}
                    placeholder="Report title"
                    maxLength={200}
                    autoFocus
                />
            </Modal>

            {/* Left Sidebar - Study/Analysis Tree */}
            <Sider
                width={350}
                style={{
                    background: '#fff',
                    padding: '16px',
                    borderRight: '1px solid #f0f0f0',
                    // Sticky rather than fixed: a fixed rail escapes the layout's scroll port and
                    // paints over the footer. A sticky one cannot leave its containing block, which
                    // ends above the footer, so the overlap is impossible by construction, with no
                    // arithmetic to rot if the chrome heights change. top clears the sticky header.
                    //
                    // Height is left to the flex default (stretch to the container) and only capped
                    // here. On a short page that fills the container exactly, so the border runs the
                    // full height; on a long one the cap leaves room to travel, which is what gives
                    // sticky its range.
                    //
                    // No `left`: for a sticky box that is a horizontal threshold, and it detached
                    // the rail from its own centred content column on wide viewports.
                    position: 'sticky',
                    top: 70,
                    maxHeight: 'calc(100vh - 70px)',
                    overflowY: 'auto'
                }}
            >
                <div style={{ marginBottom: 16 }}>
                    <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
                        Studies & Analyses
                    </Title>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Select a study or an analysis to see its reports
                    </Text>
                </div>

                <Button
                    icon={<ReloadOutlined />}
                    onClick={handleRefresh}
                    loading={loading}
                    size="small"
                    style={{ marginBottom: 16 }}
                >
                    Refresh
                </Button>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px' }}>
                        <Spin />
                    </div>
                ) : studies.length === 0 ? (
                    <Empty
                        description="No studies found"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                ) : (
                    <Tree
                        treeData={treeData}
                        selectedKeys={selectedKeys}
                        expandedKeys={expandedKeys}
                        onSelect={handleTreeSelect}
                        onExpand={setExpandedKeys}
                        showLine={{ showLeafIcon: false }}
                        style={{ background: 'transparent' }}
                    />
                )}
            </Sider>

            {/* Main Content — no marginLeft: the sticky Sider is back in normal flow, so antd's
                flex layout already reserves its width. */}
            <Layout>
                <Content style={{ padding: '24px', width: '100%' }}>
                    <Card>
                        <Title level={3} style={{ marginBottom: 16 }}>
                            AI-interpretation
                        </Title>

                        <Alert
                            message="AI-Powered Pathway Analysis Reports"
                            description="Reports are organised by study and analysis. Select a study or an analysis on the left to see its reports and generate a new one. Reports include pathway analysis, gene insights, and publication-ready summaries."
                            type="info"
                            showIcon
                            style={{ marginBottom: 24 }}
                        />

                        {/* Three levels, one hierarchy: the overview, the selection's reports, and
                            — only once asked for — the generator. */}
                        {!selectedAnalysis ? (
                            // Level 1: every report, grouped by study then analysis. No generate
                            // button here: the wizard is scoped to one study, and at this level no
                            // study has been named, so there would be nothing to scope it to.
                            <Space direction="vertical" style={{ width: '100%' }} size="large">
                                <Divider orientation="left">
                                    All Generated Reports ({batches.length})
                                </Divider>

                                {batchesGroupedByStudy.length === 0 ? (
                                    <Empty
                                        description="No AI reports generated yet. Select a study or an analysis on the left to see its reports and generate your first one."
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    />
                                ) : (
                                    batchesGroupedByStudy.map(studyGroup => {
                                        // Per study: a view-only import can be read but not written,
                                        // and this list spans studies, so the flag is resolved for
                                        // each one rather than for the page.
                                        const studyReadOnly = isReadOnlyStudy(studies, studyGroup.studyId);
                                        return (
                                            <Card
                                                key={studyGroup.studyId}
                                                title={
                                                    <Space>
                                                        <FolderOutlined />
                                                        <Text strong>{studyGroup.studyName}</Text>
                                                        {studyReadOnly && <Tag>View only</Tag>}
                                                    </Space>
                                                }
                                                size="small"
                                                style={{ marginBottom: 16 }}
                                            >
                                                {Object.values(studyGroup.analyses).map(analysisGroup => (
                                                    <div key={analysisGroup.analysisId} style={{ marginBottom: 16 }}>
                                                        <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                                            <ExperimentOutlined style={{ marginRight: 8 }} />
                                                            {analysisGroup.analysisName}
                                                        </Text>
                                                        <InsightList
                                                            batches={analysisGroup.batches}
                                                            onView={(batch) => handleViewReport(batch._id)}
                                                            // Renaming and deleting write to the
                                                            // study; the server refuses both on a
                                                            // view-only import. Undefined omits the
                                                            // buttons — InsightList filters them out.
                                                            onEdit={studyReadOnly ? undefined : openRenameModal}
                                                            onDelete={studyReadOnly ? undefined : handleDeleteReport}
                                                            getStatusTag={getStatusTag}
                                                            formatDate={formatDate}
                                                        />
                                                    </div>
                                                ))}
                                            </Card>
                                        );
                                    })
                                )}
                            </Space>
                        ) : !generating ? (
                            // Level 2: the reports of whatever was selected — the layer that used
                            // to be missing, which is why a click landed straight in the generator.
                            <Space direction="vertical" style={{ width: '100%' }} size="large">
                                <div>
                                    <Button
                                        icon={<ArrowLeftOutlined />}
                                        onClick={handleBackToOverview}
                                        style={{ marginBottom: 16 }}
                                    >
                                        Back to Overview
                                    </Button>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
                                        <div>
                                            {selectedAnalysis.analysisId && selectedStudy?.name && (
                                                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                                    {selectedStudy.name}
                                                </Text>
                                            )}
                                            <Title level={4} style={{ margin: 0 }}>
                                                <Space>
                                                    {selectedAnalysis.analysisId ? <ExperimentOutlined /> : <FolderOutlined />}
                                                    {selectedAnalysis.displayName}
                                                    {selectionReadOnly && <Tag>View only</Tag>}
                                                </Space>
                                            </Title>
                                        </div>
                                        {/* Generating writes a report into the study, which a
                                            view-only import rejects server-side. */}
                                        {!selectionReadOnly && (
                                            <Button
                                                type="primary"
                                                icon={<PlusOutlined />}
                                                onClick={handleGenerateNewInsight}
                                            >
                                                Generate new insight
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <Divider orientation="left">
                                    Reports ({selectionReportCount})
                                </Divider>

                                {selectionReportGroups.length === 0 ? (
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={selectionReadOnly
                                            ? 'No reports here yet. This study was shared with you as view-only, so new reports cannot be generated for it.'
                                            : `No reports for this ${selectedAnalysis.analysisId ? 'analysis' : 'study'} yet — use "Generate new insight" above to create the first one.`}
                                    />
                                ) : (
                                    selectionReportGroups.map(group => (
                                        <div key={group.analysisId} style={{ marginBottom: 8 }}>
                                            {/* A study spans several analyses, so its reports stay
                                                grouped and labelled; for a single analysis the
                                                heading above already names it. */}
                                            {!selectedAnalysis.analysisId && (
                                                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                                    <ExperimentOutlined style={{ marginRight: 8 }} />
                                                    {group.analysisName}
                                                </Text>
                                            )}
                                            <InsightList
                                                batches={group.batches}
                                                onView={(batch) => handleViewReport(batch._id)}
                                                onEdit={selectionReadOnly ? undefined : openRenameModal}
                                                onDelete={selectionReadOnly ? undefined : handleDeleteReport}
                                                getStatusTag={getStatusTag}
                                                formatDate={formatDate}
                                            />
                                        </div>
                                    ))
                                )}
                            </Space>
                        ) : (
                            // Level 3: the generator, mounted only now that the user has asked for
                            // it. Its own reports list is suppressed via onExitWizard, so this page
                            // stays the single place reports are listed.
                            <Space direction="vertical" style={{ width: '100%' }} size="large">
                                <div style={{ marginBottom: 16 }}>
                                    <Button
                                        icon={<ArrowLeftOutlined />}
                                        onClick={handleExitWizard}
                                        style={{ marginBottom: 16 }}
                                    >
                                        Back to Reports
                                    </Button>
                                    <Title level={4} style={{ margin: 0 }}>
                                        Generate new insight — {selectedAnalysis.displayName}
                                    </Title>
                                </div>

                                {wizardLoading ? (
                                    <div style={{ textAlign: 'center', padding: '60px' }}>
                                        <Spin size="large" />
                                        <div style={{ marginTop: 16 }}>
                                            <Text>Loading analysis data...</Text>
                                        </div>
                                    </div>
                                ) : wizardData ? (
                                    // sessionId is required for the provider to resolve the study's
                                    // settings and its readOnly flag; without it a view-only
                                    // imported study reads as editable and offers report rename,
                                    // delete and generation that the server then refuses.
                                    <GlobalSettingsProvider sessionId={wizardData.sessionId}>
                                        <AnalysisWizard
                                            analyses={wizardData.analyses}
                                            metaAnalyses={wizardData.metaAnalyses}
                                            sessionId={wizardData.sessionId}
                                            configs={wizardData.configs}
                                            organismId={wizardData.organismId}
                                            initialView="wizard"
                                            onViewInsight={setSelectedBatchId}
                                            // Every exit from the wizard — its "Back to Insights"
                                            // button and the hand-off once a report finishes —
                                            // returns to the reports above, which then refresh so
                                            // the new report is there. Without this the wizard
                                            // would show its own second list of the same reports.
                                            onExitWizard={handleExitWizard}
                                            initialSelectedAnalyses={wizardData.initialSelectedAnalyses}
                                        />
                                    </GlobalSettingsProvider>
                                ) : (
                                    <Empty
                                        description="Failed to load analysis data"
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    />
                                )}
                            </Space>
                        )}
                    </Card>
                </Content>
            </Layout>
        </Layout>
    );
}

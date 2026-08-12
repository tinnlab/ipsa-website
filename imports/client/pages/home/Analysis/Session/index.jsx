import React, {useEffect, useMemo, useState, useCallback} from "react";
import _ from "lodash";
import {Helmet} from "react-helmet";
import {Tabs, Input, Layout, Select, Space, Modal, Form, Typography, Popover, Button, Flex, Spin, Collapse, Result} from "antd";
import {Random} from "meteor/random";
import {useTracker} from "meteor/react-meteor-data"
import {useNavigate, useParams, useSearchParams} from "react-router-dom";
import {PlusOutlined, GroupOutlined} from "@ant-design/icons";

import './index.style.less'
import Analysis from "./components/Analysis";
import {SettingOutlined} from "@ant-design/icons";
import useSubscription from "../../../../hooks/useSubscription";
import useStudyAccess from "../../../../hooks/useStudyAccess";
import StudyAccessDenied from "../../../../components/StudyAccessDenied";
import {Tracker} from "meteor/tracker";
import MassAnalysisModal from "./components/MassAnalysisModal";
import { GlobalSettingsProvider } from "../../../../contexts/GlobalSettingsContext";
import GlobalSettingsPanel from "../Visualization/components/GlobalSettingsPanel";
import MetadataTable from "../Visualization/components/MetadataTable";

// Lazy Analysis Component
const LazyAnalysis = React.memo(({analysisId, inputType, sessionId, isActive, form, sessionInfo, exampleType}) => {
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (isActive && !isLoaded) {
            setIsLoaded(true);
        }
    }, [isActive, isLoaded]);

    if (!isActive && !isLoaded) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#666',
                backgroundColor: '#fafafa',
                border: '1px dashed #d9d9d9',
                borderRadius: '6px'
            }}>
                <Typography.Text type="secondary">
                    Analysis will load when tab is selected
                </Typography.Text>
            </div>
        );
    }

    return (
        <Space direction={'vertical'} style={{width: '100%'}}>
            <Flex justify={'space-between'}>
                <Form
                    form={form}
                    layout="inline"
                    name="analysis-form"
                    onValuesChange={async (_, allValues) => {
                        await Meteor.callAsync('session.updateAnalysis', {
                            sessionId,
                            analysisId: sessionInfo.activeAnalysis,
                            analysis: allValues
                        });
                    }}
                >
                    <Form.Item hidden name="id">
                        <Input/>
                    </Form.Item>
                    <Form.Item name="name" label="Analysis name">
                        <Input/>
                    </Form.Item>
                    {/* Hidden: input type is chosen via the large boxes in Step 1
                        (AnalysisWizard). Kept as a hidden field (not removed) so its value
                        keeps round-tripping through the form's whole-object onValuesChange. */}
                    <Form.Item hidden name="input" label="Input Type">
                        <Select style={{width: 350}}>
                            <Select.Option value={"ora"}>
                                Gene list: ORA/WebGestalt
                            </Select.Option>
                            <Select.Option value={"pgsea"}>
                                Gene list and fold change: KS, Wilcox, FGSEA
                            </Select.Option>
                            <Select.Option value={"expression"}>
                                Expression matrix: 8 pathway analysis methods
                            </Select.Option>
                        </Select>
                    </Form.Item>
                </Form>
            </Flex>
            <Analysis
                analysisId={analysisId}
                inputType={inputType}
                sessionId={sessionId}
                exampleType={exampleType}
            />
        </Space>
    );
});

const {Title} = Typography;

export default () => {
    // ALL HOOKS MUST BE DECLARED AT THE TOP - NO CONDITIONAL HOOKS
    const sessionId = useParams().sessionId;
    const [searchParams] = useSearchParams();
    const exampleType = searchParams.get('example'); // Get example parameter from URL
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const [isMassAnalysisModalOpen, setIsMassAnalysisModalOpen] = useState(false);
    const [searchTabValue, setSearchTabValue] = useState('');
    const [groupedAnalyses, setGroupedAnalyses] = useState([]);
    const [openSettings, setOpenSettings] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [analysisSettings, setAnalysisSettings] = useState({
        analysisId: '',
        inputType: '',
        maxAdjustedPValue: 0.05,
        minLogFoldChange: 0.5,
    });

    // Get current user
    const currentUser = useTracker(() => Meteor.user(), []);

    // Always call useTracker
    let sessionInfo = useTracker(() => {
        return DBCollections.Session.findOne({_id: sessionId});
    }, [sessionId]);

    // sessionInfo comes from minimongo, which stays empty for a non-owner exactly as it does while
    // loading — the "Loading..." below would never clear. This asks the server for a verdict.
    const {accessDenied} = useStudyAccess(sessionId);

    // Always call useSubscription - it should handle undefined values gracefully
    useSubscription('analysis.config', {
        analysisId: sessionInfo?.activeAnalysis || '',
        inputType: sessionInfo?.analyses?.find(a => a.id === sessionInfo?.activeAnalysis)?.input || '',
        keys: ['maxAdjustedPValue', 'minLogFoldChange']
    }, [sessionInfo?.activeAnalysis]);

    // All useEffect hooks
    useEffect(() => {
        if (sessionId) {
            Meteor.callAsync('massAnalysis.getGroupedAnalyses', {sessionId})
                .then(setGroupedAnalyses)
                .catch(error => {
                    console.error('Error fetching grouped analyses:', error);
                    setGroupedAnalyses([]);
                });
        }
    }, [sessionId, sessionInfo?.analyses]);

    useEffect(() => {
        const analysis = sessionInfo?.analyses?.find(a => a.id === sessionInfo?.activeAnalysis);
        if (!analysis) return;

        setAnalysisSettings(prevSettings => ({
            ...prevSettings,
            analysisId: analysis.id,
            inputType: analysis.input,
        }));
    }, [sessionInfo, sessionInfo?.activeAnalysis]);

    useEffect(() => {
        if (currentUser?._id) {
            Meteor.subscribe("session.all", currentUser._id);
        }
        Meteor.subscribe("organism.all");
        Meteor.subscribe("massAnalysisQueue", sessionId);
    }, [sessionId, currentUser?._id]);

    useEffect(() => {
        if (sessionInfo?.activeAnalysis && sessionInfo?.analyses) {
            let analysis = sessionInfo.analyses.find(a => a.id === sessionInfo.activeAnalysis);
            if (analysis) {
                form.setFieldsValue({
                    ...analysis
                });
            }
        }
    }, [sessionInfo, form]);

    // Stable onChange function with useCallback
    const onChange = useCallback(async (targetKey) => {
        // Check if this is a group key
        if (targetKey.startsWith('group_')) {
            const groupId = targetKey.replace('group_', '');
            const group = groupedAnalyses.find(g => g.groupId === groupId);
            if (group && group.analyses && group.analyses.length > 0) {
                // Select the first analysis in the group
                const firstAnalysis = group.analyses[0];
                await Meteor.callAsync('session.setAnalysis', {sessionId, analysisId: firstAnalysis.id});
                navigate(`${window.urlPrefix || ''}/analysis/session/${sessionId}/${firstAnalysis.id}`);
            }
        } else {
            // Regular analysis selection (including ungrouped mass analyses)
            await Meteor.callAsync('session.setAnalysis', {sessionId, analysisId: targetKey});
            navigate(`${window.urlPrefix || ''}/analysis/session/${sessionId}/${targetKey}`);
        }
    }, [sessionId, navigate, groupedAnalyses]);

    // Stable onEdit function with useCallback
    const onEdit = useCallback(async (targetKey, action) => {
        if (action === 'add') {
            const indexes = (sessionInfo?.analyses || []).map(analysis => {
                const match = analysis.name.match(/analysis-(\d+)/);
                return match ? parseInt(match[1]) : 0;
            }).filter(index => !isNaN(index));
            const maxIndex = Math.max(...indexes, 0);

            let analysis = {
                id: Random.id(),
                name: `analysis-${maxIndex + 1}`,
                input: "ora"
            };
            await Meteor.callAsync('session.addAnalysis', {sessionId, analysis});
            navigate(`${window.urlPrefix || ''}/analysis/session/${sessionId}/${analysis.id}`);
        } else if (action === 'remove') {
            if ((sessionInfo?.analyses || []).length === 1) {
                window.notify?.error("The last analysis cannot be removed");
                return;
            }
            Modal.confirm({
                title: 'Remove this analysis?',
                okText: 'Yes',
                okType: 'danger',
                cancelText: 'No',
                onOk: async () => {
                    const tmpSessionInfo = {...sessionInfo};
                    tmpSessionInfo.analyses = tmpSessionInfo.analyses.filter(a => a.id !== targetKey);
                    await Meteor.callAsync('session.removeAnalysis', {
                        sessionId, analysisId: targetKey,
                        activeAnalysis: tmpSessionInfo.analyses[0].id
                    });
                    navigate(`${window.urlPrefix || ''}/analysis/session/${sessionId}/${tmpSessionInfo.analyses[0].id}`);
                },
            });
        }
    }, [sessionInfo, sessionId, navigate]);

    // All useMemo hooks with stable dependencies
    const filteredAnalyses = useMemo(() => {
        if (!searchTabValue) return sessionInfo?.analyses || [];
        return (sessionInfo?.analyses || []).filter(analysis =>
            analysis.name.toLowerCase().includes(searchTabValue.toLowerCase())
        );
    }, [sessionInfo?.analyses, searchTabValue]);

    const analysisGrouping = useMemo(() => {
        const grouped = [];
        const ungrouped = [];
        const regular = [];

        filteredAnalyses.forEach(analysis => {
            if (analysis.isMassAnalysis) {
                if (analysis.groupId && !analysis.isUngrouped) {
                    grouped.push(analysis);
                } else {
                    // Treat ungrouped mass analyses as regular analyses
                    ungrouped.push(analysis);
                }
            } else {
                regular.push(analysis);
            }
        });

        return {
            massAnalyses: grouped,
            ungroupedMassAnalyses: ungrouped,
            regularAnalyses: [...regular, ...ungrouped] // Combine regular and ungrouped mass analyses
        };
    }, [filteredAnalyses]);

    const groupedMassAnalysesForTabs = useMemo(() => {
        const groups = {};

        analysisGrouping.massAnalyses.forEach(analysis => {
            const groupKey = analysis.groupId;
            if (!groups[groupKey]) {
                const groupInfo = groupedAnalyses.find(g => g.groupId === groupKey);
                groups[groupKey] = {
                    groupId: groupKey,
                    groupName: groupInfo?.groupName || analysis.groupName || 'Ungrouped',
                    inputType: analysis.input,
                    groupColor: analysis.groupColor,
                    analyses: []
                };
            }
            groups[groupKey].analyses.push(analysis);
        });

        return Object.values(groups);
    }, [analysisGrouping.massAnalyses, groupedAnalyses]);

    const findAnalysisGroup = useCallback((analysisId) => {
        if (!analysisId) return null;

        // First check in groupedAnalyses from server
        const serverGroup = groupedAnalyses.find(group =>
            group.analyses && group.analyses.some(analysis => analysis.id === analysisId)
        );
        if (serverGroup) return serverGroup;

        // Then check in local grouped mass analyses
        return groupedMassAnalysesForTabs.find(group =>
            group.analyses && group.analyses.some(analysis => analysis.id === analysisId)
        );
    }, [groupedAnalyses, groupedMassAnalysesForTabs]);

    const currentAnalysisGroup = useMemo(() => {
        return findAnalysisGroup(sessionInfo?.activeAnalysis);
    }, [sessionInfo?.activeAnalysis, findAnalysisGroup]);

    // Create tab items for regular analyses
    const regularTabItems = useMemo(() => {
        return analysisGrouping.regularAnalyses.map((analysis, index) => ({
            key: analysis.id,
            label: (
                <span style={{
                    color: analysis.groupColor || 'inherit',
                    fontWeight: analysis.isMassAnalysis ? 'bold' : 'normal'
                }}>
                    {analysis.isMassAnalysis && '📊 '}{analysis.name}
                </span>
            ),
            children: (
                <LazyAnalysis
                    analysisId={analysis.id}
                    inputType={analysis.input}
                    sessionId={sessionId}
                    isActive={sessionInfo?.activeAnalysis === analysis.id}
                    form={form}
                    sessionInfo={sessionInfo}
                    exampleType={exampleType}
                />
            )
        }));
    }, [analysisGrouping.regularAnalyses, sessionId, sessionInfo?.activeAnalysis]);

    const massAnalysisTabItems = useMemo(() => {
        return groupedMassAnalysesForTabs.map(group => {
            const isGroupActive = group.analyses && group.analyses.some(analysis =>
                analysis.id === sessionInfo?.activeAnalysis
            );

            // If this group contains the active analysis, show individual tabs
            if (isGroupActive) {
                const groupTabItems = (group.analyses || []).map(analysis => ({
                    key: analysis.id,
                    label: (
                        <span style={{
                            color: group.groupColor || 'inherit',
                            fontWeight: 'bold'
                        }}>
                            📊 {analysis.name}
                        </span>
                    ),
                    children: (
                        <LazyAnalysis
                            analysisId={analysis.id}
                            inputType={analysis.input}
                            sessionId={sessionId}
                            isActive={sessionInfo?.activeAnalysis === analysis.id}
                            form={form}
                            sessionInfo={sessionInfo}
                            exampleType={exampleType}
                        />
                    )
                }));

                return {
                    key: `group_${group.groupId}`,
                    label: (
                        <span>
                            <GroupOutlined style={{marginRight: 4}}/>
                            {group.groupName}
                        </span>
                    ),
                    children: (
                        <div>
                            <Space direction="vertical" style={{width: '100%', marginBottom: 16}}>
                                <Typography.Text type="secondary">
                                    Group: {group.groupName} ({(group.analyses || []).length} analyses)
                                </Typography.Text>
                            </Space>
                            <Tabs
                                type="card"
                                size="small"
                                onChange={onChange}
                                activeKey={sessionInfo?.activeAnalysis}
                                items={groupTabItems}
                                tabBarGutter={4}
                            />
                        </div>
                    )
                };
            } else {
                // Show as a collapsed group
                return {
                    key: `group_${group.groupId}`,
                    label: (
                        <span>
                            <GroupOutlined style={{marginRight: 4}}/>
                            {group.groupName}
                            <span style={{
                                marginLeft: 8,
                                fontSize: '12px',
                                color: '#666',
                                fontWeight: 'normal'
                            }}>
                                ({(group.analyses || []).length})
                            </span>
                        </span>
                    ),
                    children: (
                        <div style={{
                            padding: '40px',
                            textAlign: 'center',
                            color: '#666',
                            backgroundColor: '#fafafa',
                            border: '1px dashed #d9d9d9',
                            borderRadius: '6px'
                        }}>
                            <Typography.Text type="secondary">
                                Click to view analyses in this group
                            </Typography.Text>
                        </div>
                    )
                };
            }
        });
    }, [groupedMassAnalysesForTabs, sessionInfo?.activeAnalysis, onChange, sessionId]);

    // Extract metadata from analyses
    const analysesMetadata = useMemo(() => {
        if (!sessionInfo?.analyses || sessionInfo.analyses.length === 0) return {};

        const metadata = {};
        sessionInfo.analyses.forEach(analysis => {
            if (analysis.metadata && analysis.metadata.extracted) {
                metadata[analysis.name] = analysis.metadata.extracted;
            }
        });

        return metadata;
    }, [sessionInfo?.analyses]);

    // Metadata tab
    const metadataTabItem = useMemo(() => {
        if (Object.keys(analysesMetadata).length === 0) return null;

        return {
            key: 'dataset-metadata',
            label: '📋 Dataset Metadata',
            closable: false,
            children: (
                <MetadataTable
                    analysesMetadata={analysesMetadata}
                    sessionId={sessionId}
                />
            )
        };
    }, [analysesMetadata, sessionId]);

    // Combine all tab items
    const allTabItems = useMemo(() => {
        const tabs = [
            ...regularTabItems,
            ...massAnalysisTabItems
        ];

        // Add metadata tab at the end if it exists
        if (metadataTabItem) {
            tabs.push(metadataTabItem);
        }

        return tabs;
    }, [regularTabItems, massAnalysisTabItems, metadataTabItem]);

    // Helper functions
    const getActiveTabKey = useCallback(() => {
        if (!sessionInfo?.activeAnalysis) return undefined;

        // Check if the active analysis is in a group (and not ungrouped)
        const activeAnalysis = (sessionInfo.analyses || []).find(a => a.id === sessionInfo.activeAnalysis);
        if (activeAnalysis?.isMassAnalysis && activeAnalysis?.groupId && !activeAnalysis?.isUngrouped) {
            const group = findAnalysisGroup(sessionInfo.activeAnalysis);
            if (group) {
                return `group_${group.groupId}`;
            }
        }

        // Regular analysis or ungrouped mass analysis
        return sessionInfo.activeAnalysis;
    }, [sessionInfo?.activeAnalysis, sessionInfo?.analyses, findAnalysisGroup]);

    // END OF HOOKS SECTION

    // Early return after all hooks are called.
    // The denial must come first: for a study that is not ours sessionInfo never arrives, so the
    // loading return below would spin forever.
    if (accessDenied) return <StudyAccessDenied className="analysis-page-wrapper"/>;

    if (!sessionInfo) return <div style={{ padding: 24 }}>Loading...</div>;

    // A view-only imported study has no uploaded inputs and rejects every write, so this editing
    // wizard cannot do anything useful with it. The Recent Studies entry point is already hidden;
    // this covers arriving by a typed or bookmarked URL, which would otherwise render a fully live
    // wizard that fails on save.
    if (sessionInfo.readOnly) {
        return (
            <Layout className="analysis-page-wrapper">
                <Helmet title={sessionInfo?.name}/>
                <Result
                    status="info"
                    title="This study is view-only"
                    subTitle="It was shared with you as results only, so it cannot be edited or re-run. You can still explore and export its results."
                    extra={
                        <Button
                            type="primary"
                            onClick={() => navigate(`${window.urlPrefix || ''}/analysis/visualization/${sessionId}`)}
                        >
                            View results
                        </Button>
                    }
                />
            </Layout>
        );
    }

    const configList = ['maxAdjustedPValue', 'minLogFoldChange'];

    return (
        <GlobalSettingsProvider sessionId={sessionId}>
            <Layout className="analysis-page-wrapper">
                <Helmet title={sessionInfo?.name}/>
            <Title level={3}>
                {sessionInfo?.name}
            </Title>
            <GlobalSettingsPanel />
            <Space direction="vertical" size="large" style={{width: '100%'}}>
                <Flex justify="space-between" align="center">
                    <div></div>
                    <Input.Search
                        placeholder="Search analyses..."
                        value={searchTabValue}
                        onChange={(e) => setSearchTabValue(e.target.value)}
                        style={{width: 200}}
                        allowClear
                    />
                </Flex>

                <Tabs
                    type="editable-card"
                    onChange={onChange}
                    activeKey={getActiveTabKey()}
                    items={allTabItems}
                    onEdit={onEdit}
                    tabBarGutter={4}
                    size="small"
                />

                {/*<Flex justify={'space-between'}>*/}
                {/*    <Form*/}
                {/*        form={form}*/}
                {/*        layout="inline"*/}
                {/*        name="analysis-form"*/}
                {/*        onValuesChange={async (_, allValues) => {*/}
                {/*            await Meteor.callAsync('session.updateAnalysis', {*/}
                {/*                sessionId,*/}
                {/*                analysisId: sessionInfo.activeAnalysis,*/}
                {/*                analysis: allValues*/}
                {/*            });*/}
                {/*        }}*/}
                {/*    >*/}
                {/*        <Form.Item hidden name="id">*/}
                {/*            <Input/>*/}
                {/*        </Form.Item>*/}
                {/*        <Form.Item name="name" label="Analysis name">*/}
                {/*            <Input/>*/}
                {/*        </Form.Item>*/}
                {/*        <Form.Item name="input" label="Input Type">*/}
                {/*            <Select style={{width: 350}}>*/}
                {/*                <Select.Option value={"ora"}>*/}
                {/*                    Gene list: ORA/WebGestalt*/}
                {/*                </Select.Option>*/}
                {/*                <Select.Option value={"pgsea"}>*/}
                {/*                    Gene list and fold change: KS, Wilcox, FGSEA*/}
                {/*                </Select.Option>*/}
                {/*                <Select.Option value={"expression"}>*/}
                {/*                    Expression matrix: 8 pathway analysis methods*/}
                {/*                </Select.Option>*/}
                {/*            </Select>*/}
                {/*        </Form.Item>*/}
                {/*    </Form>*/}
                {/*</Flex>*/}
            </Space>

            <MassAnalysisModal
                open={isMassAnalysisModalOpen}
                onCancel={() => setIsMassAnalysisModalOpen(false)}
                sessionId={sessionId}
                onSuccess={() => {
                    setIsMassAnalysisModalOpen(false);
                }}
            />
        </Layout>
        </GlobalSettingsProvider>
    );
};
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Layout, Button, Steps, Typography, Upload, Card, Table,
    Select, Collapse, Form, InputNumber, Checkbox, Space,
    Alert, Progress, Tag, Divider, Spin, Input, Transfer
} from 'antd';
import {
    InboxOutlined, FolderOpenOutlined, PlayCircleOutlined,
    CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
    PlusOutlined, EditOutlined, DeleteOutlined, GroupOutlined,
    UploadOutlined, SettingOutlined, DownloadOutlined, InfoCircleOutlined,
    ArrowLeftOutlined, BarChartOutlined
} from '@ant-design/icons';
import { useTracker } from 'meteor/react-meteor-data';
import { Helmet } from 'react-helmet';

// Import the original modal component for reuse
import MassAnalysisModalContent from '../Session/components/MassAnalysisModal';
import useStudyAccess from '/imports/client/hooks/useStudyAccess';
import StudyAccessDenied from '/imports/client/components/StudyAccessDenied';

const { Title, Text } = Typography;
const { Content, Sider } = Layout;
const { Step } = Steps;

export default function MassAnalysis() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);
    const [queueProgress, setQueueProgress] = useState(null);

    // Steps for the sidebar
    const steps = [
        { title: 'Upload', description: 'Upload analysis folders' },
        { title: 'Review', description: 'Review detected analyses' },
        { title: 'Configure', description: 'Set parameters' },
        { title: 'Confirm', description: 'Review and create' },
        { title: 'Progress', description: 'Running analyses' }
    ];

    // Subscribe to session data using Meteor's reactive pattern
    const session = useTracker(() => {
        const handle = Meteor.subscribe('session.all', Meteor.userId());
        if (!handle.ready()) return null;

        return DBCollections.Session.findOne({ _id: sessionId });
    }, [sessionId]);

    // A non-owner is never sent the Session document — the publication answers this.ready() with no
    // docs — so `session` stays null and the spinner below would never clear. Ask the server directly.
    const { accessDenied } = useStudyAccess(sessionId);

    const handleBackToStudies = () => {
        navigate('/analysis/recent-studies');
    };

    const handleShowVisualization = () => {
        navigate(`/analysis/visualization/${sessionId}`);
    };

    const handleStepChange = (step) => {
        setCurrentStep(step);
    };

    const handleProgressChange = (progress) => {
        setQueueProgress(progress);
    };

    // Get status color
    const getStatusColor = (status) => {
        switch (status) {
            case 'completed': return 'green';
            case 'processing': return 'blue';
            case 'failed': return 'red';
            default: return 'default';
        }
    };

    // Ahead of the spinner: for a denied study `session` never arrives, so this must win.
    if (accessDenied) {
        return <StudyAccessDenied />;
    }

    if (!session) {
        return (
            <Layout style={{ padding: '24px', minHeight: 'calc(100vh - 70px - 60px)' }}>
                <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: '100px' }} />
            </Layout>
        );
    }

    return (
        <Layout style={{ minHeight: 'calc(100vh - 70px - 60px)', background: '#f5f5f5' }}>
            <Helmet title={`Mass Analysis - ${session?.name || 'Loading...'}`} />

            {/* Progress Sidebar */}
            <Sider
                width={250}
                style={{
                    background: '#fff',
                    padding: '24px 16px',
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
                    position: 'sticky',
                    top: 70,
                    maxHeight: 'calc(100vh - 70px)',
                    overflowY: 'auto'
                }}
            >
                <Title level={4} style={{ marginBottom: 24 }}>
                    <BarChartOutlined style={{ marginRight: 8 }} />
                    Progress
                </Title>
                <Steps
                    direction="vertical"
                    size="small"
                    current={currentStep}
                    style={{ marginTop: 16 }}
                >
                    {steps.map((step, index) => (
                        <Step
                            key={step.title}
                            title={step.title}
                            description={step.description}
                        />
                    ))}
                </Steps>

                {/* Show analysis progress when running */}
                {currentStep === 4 && queueProgress && (
                    <>
                        <Divider />
                        <div style={{ marginBottom: 16 }}>
                            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                Analysis Progress
                            </Text>
                            <Progress
                                percent={Math.round((queueProgress.completed / queueProgress.total) * 100)}
                                size="small"
                                status={queueProgress.status === 'failed' ? 'exception' : undefined}
                            />
                            <div style={{ marginTop: 8 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    {queueProgress.completed} / {queueProgress.total} completed
                                </Text>
                            </div>
                            <div style={{ marginTop: 4 }}>
                                <Tag color={getStatusColor(queueProgress.status)}>
                                    {queueProgress.status}
                                </Tag>
                            </div>
                            {queueProgress.currentAnalysis && queueProgress.status === 'processing' && (
                                <div style={{ marginTop: 8 }}>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                        Processing: {queueProgress.currentAnalysis}
                                    </Text>
                                </div>
                            )}
                        </div>
                    </>
                )}

                <Divider />

                <Space direction="vertical" style={{ width: '100%' }}>
                    <Button
                        block
                        icon={<ArrowLeftOutlined />}
                        onClick={handleBackToStudies}
                    >
                        Back to Studies
                    </Button>
                </Space>
            </Sider>

            {/* Main Content — no marginLeft: the sticky Sider is back in normal flow, so antd's
                flex layout already reserves its width. */}
            <Layout>
                <Content style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                    <Card>
                        <Space direction="vertical" style={{ width: '100%' }} size="large">
                            <Title level={3} style={{ margin: 0 }}>
                                Mass Analysis: {session?.name}
                            </Title>

                            <Alert
                                message="Mass Analysis Mode"
                                description="Upload multiple analysis folders to process them in batch. Each folder should contain data files for a single analysis."
                                type="info"
                                showIcon
                            />

                            {/* Render the MassAnalysisModal content as embedded component */}
                            <MassAnalysisModalContent
                                open={true}
                                onCancel={handleBackToStudies}
                                sessionId={sessionId}
                                onSuccess={handleBackToStudies}
                                onShowVisualization={handleShowVisualization}
                                onStepChange={handleStepChange}
                                onProgressChange={handleProgressChange}
                                isPageMode={true}
                            />
                        </Space>
                    </Card>
                </Content>
            </Layout>
        </Layout>
    );
}

import React, { useState } from 'react';
import { 
    Drawer, Button, List, Progress, Tag, Typography, Space, 
    Card, Tooltip, Popconfirm, Alert, Empty, Divider, Collapse
} from 'antd';
import {
    PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined,
    CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
    BarsOutlined, GroupOutlined
} from '@ant-design/icons';
import { useTracker } from 'meteor/react-meteor-data';
import moment from 'moment';

const { Text, Title } = Typography;
const { Panel } = Collapse;

const MassAnalysisTracker = ({ sessionId }) => {
    const [drawerVisible, setDrawerVisible] = useState(false);

    // Track mass analysis queues for this session
    const massAnalyses = useTracker(() => {
        return DBCollections.MassAnalysisQueue.find(
            { sessionId },
            { sort: { createdAt: -1 } }
        ).fetch();
    }, [sessionId]);

    // Track queue items for active mass analyses
    const queueItems = useTracker(() => {
        const activeMassAnalyses = massAnalyses.filter(ma =>
            ma.status === 'running' || ma.status === 'pending'
        );
        const massAnalysisIds = activeMassAnalyses.map(ma => ma._id);

        if (massAnalysisIds.length === 0) return [];

        return DBCollections.MassAnalysisQueueItem.find(
            { massAnalysisId: { $in: massAnalysisIds } },
            { sort: { createdAt: 1 } }
        ).fetch();
    }, [massAnalyses]);

    const activeMassAnalyses = massAnalyses.filter(ma =>
        ma.status === 'running' || ma.status === 'pending'
    );

    const handleRetryMassAnalysis = async (massAnalysisId) => {
        try {
            await Meteor.callAsync('massAnalysis.queue.retry', { massAnalysisId });
            notification.success({
                message: 'Mass Analysis Retried',
                description: 'Failed analyses have been queued for retry.'
            });
        } catch (error) {
            console.error('Error retrying mass analysis:', error);
            notification.error({
                message: 'Retry Failed',
                description: error.message
            });
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'pending': return <ClockCircleOutlined style={{ color: '#faad14' }} />;
            case 'running': return <PlayCircleOutlined style={{ color: '#1890ff' }} />;
            case 'completed': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
            case 'failed': return <CloseCircleOutlined style={{ color: '#f5222d' }} />;
            case 'error': return <CloseCircleOutlined style={{ color: '#f5222d' }} />;
            default: return <ClockCircleOutlined />;
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'pending': return 'warning';
            case 'running': return 'processing';
            case 'completed': return 'success';
            case 'failed': return 'error';
            case 'error': return 'error';
            default: return 'default';
        }
    };

    const getInputTypeColor = (inputType) => {
        const colors = { ora: 'blue', pgsea: 'green', expression: 'orange' };
        return colors[inputType] || 'default';
    };

    const renderMassAnalysisCard = (massAnalysis) => {
        const progress = massAnalysis.total > 0 ?
            Math.round(((massAnalysis.completed + massAnalysis.failed) / massAnalysis.total) * 100) : 0;

        const relatedQueueItems = queueItems.filter(item =>
            item.massAnalysisId === massAnalysis._id
        );

        // Group queue items by group
        const groupedQueueItems = {};
        relatedQueueItems.forEach(item => {
            const groupKey = item.groupId || 'ungrouped';
            if (!groupedQueueItems[groupKey]) {
                groupedQueueItems[groupKey] = {
                    groupName: item.groupName || 'Ungrouped',
                    items: []
                };
            }
            groupedQueueItems[groupKey].items.push(item);
        });

        return (
            <Card key={massAnalysis._id} size="small" style={{ marginBottom: 12 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                            {getStatusIcon(massAnalysis.status)}
                            <Text strong>Mass Analysis</Text>
                            <Tag color={getStatusColor(massAnalysis.status)}>
                                {massAnalysis.status.toUpperCase()}
                            </Tag>
                        </Space>
                        <Text type="secondary">
                            {moment(massAnalysis.createdAt).fromNow()}
                        </Text>
                    </div>

                    <Progress
                        percent={progress}
                        status={massAnalysis.status === 'error' ? 'exception' :
                               massAnalysis.status === 'running' ? 'active' : 'normal'}
                        format={() =>
                            `${massAnalysis.completed + massAnalysis.failed}/${massAnalysis.total}`
                        }
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space size="large">
                            <Text type="secondary">
                                ✅ Completed: {massAnalysis.completed}
                            </Text>
                            {massAnalysis.failed > 0 && (
                                <Text type="danger">
                                    ❌ Failed: {massAnalysis.failed}
                                </Text>
                            )}
                        </Space>

                        {(massAnalysis.status === 'error' || massAnalysis.failed > 0) && (
                            <Popconfirm
                                title="Retry failed analyses?"
                                description="This will retry all failed analyses in this mass analysis."
                                onConfirm={() => handleRetryMassAnalysis(massAnalysis._id)}
                                okText="Yes"
                                cancelText="No"
                            >
                                <Button size="small" icon={<ReloadOutlined />}>
                                    Retry
                                </Button>
                            </Popconfirm>
                        )}
                    </div>

                    {massAnalysis.currentAnalysis && (
                        <Alert
                            message={`Currently processing: ${massAnalysis.currentAnalysis}`}
                            type="info"
                            showIcon
                            style={{ marginTop: 8 }}
                        />
                    )}

                    {massAnalysis.error && (
                        <Alert
                            message="Error"
                            description={massAnalysis.error}
                            type="error"
                            showIcon
                            style={{ marginTop: 8 }}
                        />
                    )}

                    {/* Show groups information */}
                    {massAnalysis.groups && Object.keys(massAnalysis.groups).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                            <Text strong style={{ fontSize: '12px' }}>Groups:</Text>
                            <div style={{ marginTop: 4 }}>
                                <Collapse size="small">
                                    {Object.values(massAnalysis.groups).map(group => (
                                        <Panel
                                            key={group.id}
                                            header={
                                                <Space>
                                                    <GroupOutlined />
                                                    <Text style={{ fontSize: '12px' }}>{group.name}</Text>
                                                    <Tag size="small" color={getInputTypeColor(group.inputType)}>
                                                        {group.inputType?.toUpperCase()}
                                                    </Tag>
                                                    <Text type="secondary" style={{ fontSize: '11px' }}>
                                                        ({group.analyses.length} analyses)
                                                    </Text>
                                                </Space>
                                            }
                                            style={{ fontSize: '12px' }}
                                        >
                                            <div style={{ maxHeight: 100, overflowY: 'auto' }}>
                                                {group.analyses.map(analysisName => {
                                                    const queueItem = relatedQueueItems.find(item =>
                                                        item.analysisName === analysisName
                                                    );
                                                    return (
                                                        <div key={analysisName} style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            padding: '2px 0',
                                                            fontSize: '11px'
                                                        }}>
                                                            <Text style={{ fontSize: '11px' }}>{analysisName}</Text>
                                                            {queueItem && (
                                                                <Tag size="small" color={getStatusColor(queueItem.status)}>
                                                                    {queueItem.status}
                                                                </Tag>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </Panel>
                                    ))}
                                </Collapse>
                            </div>
                        </div>
                    )}

                    {/* Fallback: show queue items if no groups info */}
                    {(!massAnalysis.groups || Object.keys(massAnalysis.groups).length === 0) && relatedQueueItems.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                            <Text strong style={{ fontSize: '12px' }}>Queue Items:</Text>
                            <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 4 }}>
                                {relatedQueueItems.map(item => (
                                    <div key={item._id} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '2px 0',
                                        fontSize: '12px'
                                    }}>
                                        <Text style={{ fontSize: '12px' }}>{item.analysisName}</Text>
                                        <Tag size="small" color={getStatusColor(item.status)}>
                                            {item.status}
                                        </Tag>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Space>
            </Card>
        );
    };

    const totalActive = activeMassAnalyses.length;
    const totalRunning = massAnalyses.filter(ma => ma.status === 'running').length;

    return (
        <>
            <Tooltip title={`${totalActive} active mass analyses`}>
                <Button
                    icon={<BarsOutlined />}
                    onClick={() => setDrawerVisible(true)}
                    style={{ position: 'relative' }}
                >
                    Mass Analysis
                    {totalActive > 0 && (
                        <span style={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            backgroundColor: totalRunning > 0 ? '#1890ff' : '#52c41a',
                            color: 'white',
                            borderRadius: '50%',
                            width: 18,
                            height: 18,
                            fontSize: 10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold'
                        }}>
                            {totalActive}
                        </span>
                    )}
                </Button>
            </Tooltip>

            <Drawer
                title="Mass Analysis Progress"
                placement="right"
                onClose={() => setDrawerVisible(false)}
                open={drawerVisible}
                width={450}
            >
                <div>
                    {massAnalyses.length === 0 ? (
                        <Empty
                            description="No mass analyses found"
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                    ) : (
                        <div>
                            {activeMassAnalyses.length > 0 && (
                                <div>
                                    <Title level={5}>Active ({activeMassAnalyses.length})</Title>
                                    {activeMassAnalyses.map(renderMassAnalysisCard)}
                                </div>
                            )}

                            {massAnalyses.filter(ma => ma.status === 'completed' || ma.status === 'error').length > 0 && (
                                <div>
                                    {activeMassAnalyses.length > 0 && <Divider />}
                                    <Title level={5}>Recent</Title>
                                    {massAnalyses
                                        .filter(ma => ma.status === 'completed' || ma.status === 'error')
                                        .slice(0, 5)
                                        .map(renderMassAnalysisCard)
                                    }
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Drawer>
        </>
    );
};

export default MassAnalysisTracker;

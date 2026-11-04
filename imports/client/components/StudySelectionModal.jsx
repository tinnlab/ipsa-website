import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, Radio, Select, Space, Typography, Divider } from 'antd';
import { PlusOutlined, FolderOpenOutlined, ExperimentOutlined, DatabaseOutlined } from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';
// Random.id() is called below and was never imported — there is no global. Every "add to existing
// study" submission threw ReferenceError. The homepage now opens this modal, so the path matters.
import { Random } from 'meteor/random';
import { useTracker } from 'meteor/react-meteor-data';
import { useNavigate } from 'react-router-dom';

const { Text, Title } = Typography;

// 'createAnalysis' and 'massAnalysis' each commit to one kind up front — that is what the header's
// two menu entries mean. 'choose' asks instead, for an entry point that is not already an answer:
// the homepage's "Start Your Analysis" knows the user wants to analyse something, not which of the
// two they want.
export default function StudySelectionModal({
    visible,
    onClose,
    mode = 'createAnalysis' // 'createAnalysis', 'massAnalysis' or 'choose'
}) {
    const navigate = useNavigate();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [studyOption, setStudyOption] = useState('new'); // 'new' or 'existing'
    // Only consulted in 'choose'; the other two modes are their own answer.
    const [analysisKind, setAnalysisKind] = useState('createAnalysis');
    const effectiveMode = mode === 'choose' ? analysisKind : mode;
    // A mass analysis always starts a new study — its "add to existing" picker is not rendered. This
    // keeps a stale 'existing', chosen before the user switched kind, from both hiding the study-name
    // field and adding a single analysis to some unrelated study.
    const effectiveStudyOption = effectiveMode === 'massAnalysis' ? 'new' : studyOption;

    const user = useTracker(() => Meteor.user());

    // Subscribe to sessions
    useEffect(() => {
        if (user?._id) {
            const handle = Meteor.subscribe('session.all', user._id);
            return () => handle.stop();
        }
    }, [user?._id]);

    // Get existing studies for the user
    const existingStudies = useTracker(() => {
        if (!user) return [];
        return DBCollections.Session.find(
            { userId: user._id, status: 'Active' },
            { sort: { createdAt: -1 } }
        ).fetch();
    }, [user?._id]);

    // Reset form when modal opens
    useEffect(() => {
        if (visible) {
            form.resetFields();
            setStudyOption('new');
            setAnalysisKind('createAnalysis');
        }
    }, [visible, form, mode]);

    const handleSubmit = async (values) => {
        setLoading(true);
        try {
            let sessionId, activeAnalysis;

            if (effectiveStudyOption === 'new') {
                // Create new study
                const result = await Meteor.callAsync('session.create', {
                    userId: user?._id,
                    name: values.studyName
                });
                sessionId = result.sessionId;
                activeAnalysis = result.activeAnalysis;
            } else {
                // Use existing study
                sessionId = values.existingStudy;
                // Create new analysis in existing study
                const newAnalysis = {
                    id: Random.id(),
                    name: `Analysis ${Date.now()}`,
                    input: 'ora',
                    status: 'draft'
                };
                await Meteor.callAsync('session.addAnalysis', { sessionId, analysis: newAnalysis });
                activeAnalysis = newAnalysis.id;
            }

            // Navigate based on mode
            if (effectiveMode === 'massAnalysis') {
                navigate(`${urlPrefix}/analysis/mass-analysis/${sessionId}`);
            } else {
                navigate(`${urlPrefix}/analysis/session/${sessionId}/${activeAnalysis}`);
            }

            onClose();
            notify.success(effectiveStudyOption === 'new' ? 'Study created successfully!' : 'Analysis created in existing study!');
        } catch (error) {
            notify.error(error.reason || 'Failed to create. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const getTitle = () => {
        if (mode === 'choose') {
            return 'Start Your Analysis';
        }
        if (mode === 'massAnalysis') {
            return 'Create Mass Analysis';
        }
        return 'Create Analysis';
    };

    const getDescription = () => {
        if (mode === 'choose') {
            return 'Analyse one dataset, or several at once.';
        }
        if (mode === 'massAnalysis') {
            return 'Create a new study to run mass analysis on multiple datasets.';
        }
        return 'Create a new study or add an analysis to an existing study.';
    };

    return (
        <Modal
            title={getTitle()}
            open={visible}
            onCancel={onClose}
            footer={null}
            width={500}
        >
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                {getDescription()}
            </Text>

            <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
            >
                {mode === 'choose' && (
                    <Form.Item>
                        <Radio.Group
                            value={analysisKind}
                            onChange={(e) => setAnalysisKind(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <Space direction="vertical" style={{ width: '100%' }}>
                                <Radio value="createAnalysis">
                                    <Space>
                                        <ExperimentOutlined />
                                        Single analysis
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            (one dataset)
                                        </Text>
                                    </Space>
                                </Radio>
                                <Radio value="massAnalysis">
                                    <Space>
                                        <DatabaseOutlined />
                                        Mass analysis
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            (many datasets at once)
                                        </Text>
                                    </Space>
                                </Radio>
                            </Space>
                        </Radio.Group>
                    </Form.Item>
                )}

                {effectiveMode === 'createAnalysis' && (
                    <Form.Item>
                        <Radio.Group
                            value={studyOption}
                            onChange={(e) => setStudyOption(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <Space direction="vertical" style={{ width: '100%' }}>
                                <Radio value="new">
                                    <Space>
                                        <PlusOutlined />
                                        Create new study
                                    </Space>
                                </Radio>
                                <Radio value="existing" disabled={existingStudies.length === 0}>
                                    <Space>
                                        <FolderOpenOutlined />
                                        Add to existing study
                                        {existingStudies.length === 0 && (
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                (no studies available)
                                            </Text>
                                        )}
                                    </Space>
                                </Radio>
                            </Space>
                        </Radio.Group>
                    </Form.Item>
                )}

                {effectiveStudyOption === 'new' && (
                    <Form.Item
                        label="Study Name"
                        name="studyName"
                        rules={[{ required: true, message: 'Please enter a study name' }]}
                    >
                        <Input placeholder="Enter a name for your study" />
                    </Form.Item>
                )}

                {effectiveStudyOption === 'existing' && effectiveMode === 'createAnalysis' && (
                    <Form.Item
                        label="Select Study"
                        name="existingStudy"
                        rules={[{ required: true, message: 'Please select a study' }]}
                    >
                        <Select
                            placeholder="Choose an existing study"
                            showSearch
                            optionFilterProp="children"
                        >
                            {existingStudies.map(study => (
                                <Select.Option key={study._id} value={study._id}>
                                    {study.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                )}

                <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
                    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                        <Button onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="primary" htmlType="submit" loading={loading}>
                            {effectiveMode === 'massAnalysis' ? 'Create & Start Mass Analysis' : 'Create'}
                        </Button>
                    </Space>
                </Form.Item>
            </Form>
        </Modal>
    );
}

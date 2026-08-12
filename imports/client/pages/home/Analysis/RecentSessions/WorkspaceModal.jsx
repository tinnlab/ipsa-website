import React, { useState, useMemo } from 'react';
import { Modal, Tabs, Form, Input, Button, Alert, Space, List, Card } from 'antd';
import { Meteor } from 'meteor/meteor';
import { SaveOutlined, ReloadOutlined, InfoCircleOutlined, ArrowLeftOutlined } from '@ant-design/icons';

export default function WorkspaceModal({ visible, onClose, onSuccess }) {
    const [saveForm] = Form.useForm();
    const [recoverForm] = Form.useForm();
    const [saveLoading, setSaveLoading] = useState(false);
    const [recoverLoading, setRecoverLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('save');
    const [availableWorkspaces, setAvailableWorkspaces] = useState([]);
    const [showWorkspaceList, setShowWorkspaceList] = useState(false);
    const [verifiedCredentials, setVerifiedCredentials] = useState(null);

    const handleSaveWorkspace = async (values) => {
        setSaveLoading(true);
        try {
            await Meteor.callAsync('workspace.save', {
                workspaceName: values.workspaceName,
                email: values.email,
                password: values.password
            });

            notify.success('Workspace saved successfully! Remember your email, workspace name, and password to recover later.');
            saveForm.resetFields();
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            notify.error(error.reason || 'Failed to save workspace. Please try again.');
        } finally {
            setSaveLoading(false);
        }
    };

    const handleVerifyCredentials = async (values) => {
        setRecoverLoading(true);
        try {
            const result = await Meteor.callAsync('workspace.list', {
                email: values.recoverEmail,
                password: values.recoverPassword
            });

            if (result.workspaces && result.workspaces.length > 0) {
                setAvailableWorkspaces(result.workspaces);
                setVerifiedCredentials({ email: values.recoverEmail, password: values.recoverPassword });
                setShowWorkspaceList(true);
                notify.success(`Found ${result.workspaces.length} workspace(s). Select one to recover.`);
            } else {
                notify.warning('No workspaces found with these credentials.');
            }
        } catch (error) {
            notify.error(error.reason || 'Failed to verify credentials. Please check your email and password.');
        } finally {
            setRecoverLoading(false);
        }
    };

    const handleSelectWorkspace = async (workspaceName) => {
        setRecoverLoading(true);
        try {
            const result = await Meteor.callAsync('workspace.recover', {
                workspaceName: workspaceName,
                email: verifiedCredentials.email,
                password: verifiedCredentials.password
            });

            notify.success(result.message || `Successfully recovered ${result.recoveredCount} study/studies!`);
            recoverForm.resetFields();
            setShowWorkspaceList(false);
            setAvailableWorkspaces([]);
            setVerifiedCredentials(null);
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            notify.error(error.reason || 'Recovery failed. Please try again.');
        } finally {
            setRecoverLoading(false);
        }
    };

    const handleBackToCredentials = () => {
        setShowWorkspaceList(false);
        setAvailableWorkspaces([]);
        setVerifiedCredentials(null);
    };

    const handleModalClose = () => {
        saveForm.resetFields();
        recoverForm.resetFields();
        setShowWorkspaceList(false);
        setAvailableWorkspaces([]);
        setVerifiedCredentials(null);
        setActiveTab('save');
        onClose();
    };

    const tabItems = useMemo(() => [
        {
            key: 'save',
            label: (
                <span>
                    <SaveOutlined /> Save Workspace
                </span>
            ),
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                    <Alert
                        message="Save All Your Studies"
                        description="Save all your current studies as a workspace. You'll be able to recover all of them at once using the workspace name and password."
                        type="info"
                        showIcon
                        icon={<InfoCircleOutlined />}
                    />

                    <Form
                        form={saveForm}
                        layout="vertical"
                        onFinish={handleSaveWorkspace}
                    >
                        <Form.Item
                            label="Workspace Name"
                            name="workspaceName"
                            rules={[
                                { required: true, message: 'Please enter a workspace name' }
                            ]}
                        >
                            <Input
                                placeholder="e.g., My Research Project"
                            />
                        </Form.Item>

                        <Form.Item
                            label="Email"
                            name="email"
                            rules={[
                                { required: true, message: 'Please enter your email' },
                                { type: 'email', message: 'Please enter a valid email' }
                            ]}
                        >
                            <Input
                                placeholder="your.email@example.com"
                            />
                        </Form.Item>

                        <Form.Item
                            label="Password"
                            name="password"
                            rules={[
                                { required: true, message: 'Please enter a password' },
                                { min: 6, message: 'Password must be at least 6 characters' }
                            ]}
                        >
                            <Input.Password
                                placeholder="Enter password (min 6 characters)"
                            />
                        </Form.Item>

                        <Form.Item
                            label="Confirm Password"
                            name="confirmPassword"
                            dependencies={['password']}
                            rules={[
                                { required: true, message: 'Please confirm your password' },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (!value || getFieldValue('password') === value) {
                                            return Promise.resolve();
                                        }
                                        return Promise.reject(new Error('Passwords do not match'));
                                    },
                                }),
                            ]}
                        >
                            <Input.Password
                                placeholder="Confirm password"
                            />
                        </Form.Item>

                        <Form.Item>
                            <Button
                                type="primary"
                                htmlType="submit"
                                loading={saveLoading}
                                block
                            >
                                Save Workspace
                            </Button>
                        </Form.Item>
                    </Form>

                    <Alert
                        message="Important"
                        description="Remember your email and password. You'll use them to find and recover your workspaces later."
                        type="warning"
                        showIcon
                    />
                </Space>
            )
        },
        {
            key: 'recover',
            label: (
                <span>
                    <ReloadOutlined /> Recover Workspace
                </span>
            ),
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                    {!showWorkspaceList ? (
                        <>
                            <Alert
                                message="Recover Your Workspaces"
                                description="Enter your email and password to see available workspaces."
                                type="info"
                                showIcon
                                icon={<InfoCircleOutlined />}
                            />

                            <Form
                                form={recoverForm}
                                layout="vertical"
                                onFinish={handleVerifyCredentials}
                            >
                                <Form.Item
                                    label="Email"
                                    name="recoverEmail"
                                    rules={[
                                        { required: true, message: 'Please enter your email' },
                                        { type: 'email', message: 'Please enter a valid email' }
                                    ]}
                                >
                                    <Input
                                        placeholder="Enter your email"
                                    />
                                </Form.Item>

                                <Form.Item
                                    label="Password"
                                    name="recoverPassword"
                                    rules={[
                                        { required: true, message: 'Please enter your password' }
                                    ]}
                                >
                                    <Input.Password
                                        placeholder="Enter workspace password"
                                    />
                                </Form.Item>

                                <Form.Item>
                                    <Button
                                        type="primary"
                                        htmlType="submit"
                                        loading={recoverLoading}
                                        block
                                    >
                                        Find Workspaces
                                    </Button>
                                </Form.Item>
                            </Form>
                        </>
                    ) : (
                        <>
                            <Button
                                icon={<ArrowLeftOutlined />}
                                onClick={handleBackToCredentials}
                                style={{ marginBottom: 16 }}
                            >
                                Back
                            </Button>

                            <Alert
                                message="Select Workspace to Recover"
                                description={`Found ${availableWorkspaces.length} workspace(s). Click on one to recover all its studies.`}
                                type="success"
                                showIcon
                            />

                            <List
                                dataSource={availableWorkspaces}
                                renderItem={(workspace) => (
                                    <Card
                                        hoverable
                                        style={{ marginBottom: 12, cursor: 'pointer' }}
                                        onClick={() => handleSelectWorkspace(workspace.name)}
                                    >
                                        <Card.Meta
                                            title={workspace.name}
                                            description={
                                                <Space direction="vertical" size="small">
                                                    <div>Studies: {workspace.sessionCount}</div>
                                                    <div>Saved: {new Date(workspace.savedAt).toLocaleDateString()}</div>
                                                </Space>
                                            }
                                        />
                                    </Card>
                                )}
                            />

                            <Alert
                                message="Note"
                                description="Selecting a workspace will transfer all its studies to your current account."
                                type="warning"
                                showIcon
                            />
                        </>
                    )}
                </Space>
            )
        }
    ], [saveForm, recoverForm, saveLoading, recoverLoading, handleSaveWorkspace, handleVerifyCredentials, showWorkspaceList, availableWorkspaces, handleBackToCredentials, handleSelectWorkspace]);

    return (
        <Modal
            title="Workspace Management"
            open={visible}
            onCancel={handleModalClose}
            footer={null}
            width={600}
        >
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={tabItems}
            />
        </Modal>
    );
}

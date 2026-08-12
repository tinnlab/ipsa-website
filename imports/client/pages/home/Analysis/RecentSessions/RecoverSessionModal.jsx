import React, { useState } from 'react';
import { Modal, Form, Input, Button, Alert, Space } from 'antd';
import { Meteor } from 'meteor/meteor';
import { InfoCircleOutlined } from '@ant-design/icons';

export default function RecoverSessionModal({ visible, onClose, onSuccess }) {
    const [passwordForm] = Form.useForm();
    const [passwordLoading, setPasswordLoading] = useState(false);

    const handlePasswordRecovery = async (values) => {
        setPasswordLoading(true);
        try {
            const result = await Meteor.callAsync('session.recoverWithPassword', {
                sessionName: values.sessionName,
                recoveryPassword: values.recoveryPassword
            });

            notify.success(result.message || 'Session recovered successfully!');
            passwordForm.resetFields();
            onClose();
            if (onSuccess) onSuccess();
        } catch (error) {
            notify.error(error.reason || 'Recovery failed. Please check your session name and password.');
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleModalClose = () => {
        passwordForm.resetFields();
        onClose();
    };

    return (
        <Modal
            title="Recover Lost Sessions"
            open={visible}
            onCancel={handleModalClose}
            footer={null}
            width={500}
        >
            <Space direction="vertical" style={{ width: '100%' }} size="large">
                <Alert
                    message="Recover with Password"
                    description="If you set a recovery password when creating your session, you can use it to recover access."
                    type="info"
                    showIcon
                    icon={<InfoCircleOutlined />}
                />

                <Form
                    form={passwordForm}
                    layout="vertical"
                    onFinish={handlePasswordRecovery}
                >
                    <Form.Item
                        label="Session Name"
                        name="sessionName"
                        rules={[
                            { required: true, message: 'Please enter the exact session name' }
                        ]}
                    >
                        <Input
                            placeholder="Enter exact session name"
                        />
                    </Form.Item>

                    <Form.Item
                        label="Recovery Password"
                        name="recoveryPassword"
                        rules={[
                            { required: true, message: 'Please enter your recovery password' }
                        ]}
                    >
                        <Input.Password
                            placeholder="Enter recovery password"
                        />
                    </Form.Item>

                    <Form.Item>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={passwordLoading}
                            block
                        >
                            Recover Session
                        </Button>
                    </Form.Item>
                </Form>

                <Alert
                    message="Note"
                    description="This method only works if you set a recovery password when creating the session."
                    type="warning"
                    showIcon
                />
            </Space>
        </Modal>
    );
}

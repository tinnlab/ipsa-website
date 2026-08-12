// MetadataImprovementModal.jsx
// Interactive modal for improving metadata quality before AI interpretation

import React, { useState } from 'react';
import {
    Modal,
    Form,
    Input,
    Button,
    Space,
    Alert,
    Divider,
    Card,
    Typography,
    Collapse,
    Spin,
    Select
} from 'antd';
import {
    InfoCircleOutlined,
    CheckCircleOutlined,
    WarningOutlined
} from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;
const { TextArea } = Input;
const { Option } = Select;

export default function MetadataImprovementModal({
    visible,
    assessment,
    suggestions,
    currentMetadata,
    analysisType,
    onImprove,
    onCancel
}) {
    const [formData, setFormData] = useState(currentMetadata || {});
    const [validating, setValidating] = useState(false);
    const [validationResult, setValidationResult] = useState(null);

    const handleFieldChange = (field, value) => {
        setFormData({
            ...formData,
            [field]: value
        });
        // Clear previous validation when user makes changes
        setValidationResult(null);
    };

    const handleTemplateSelect = (template) => {
        // Pre-fill form with template structure
        const templateText = template.template;
        setFormData({
            ...formData,
            experimental_context: templateText
        });
    };

    const handleValidateAndContinue = async () => {
        setValidating(true);
        setValidationResult(null);

        try {
            // Build experimental_context if not provided but we have other fields
            const enrichedFormData = { ...formData };

            // If experimental_context is empty but we have tissue/comparison, auto-generate
            if (!enrichedFormData.experimental_context || enrichedFormData.experimental_context.trim() === '') {
                const contextParts = [];

                if (enrichedFormData.tissue) {
                    contextParts.push(`${enrichedFormData.tissue} tissue analysis`);
                }

                if (enrichedFormData.comparison) {
                    contextParts.push(`comparing ${enrichedFormData.comparison}`);
                }

                if (enrichedFormData.organism) {
                    contextParts.push(`in ${enrichedFormData.organism}`);
                }

                if (contextParts.length > 0) {
                    enrichedFormData.experimental_context = contextParts.join(' ');
                    // Update the form state so user can see the generated context
                    setFormData(enrichedFormData);
                }
            }

            // Re-assess with updated metadata
            const newAssessment = await Meteor.callAsync(
                'analysis.assessMetadataCompleteness',
                {
                    metadata: enrichedFormData,
                    analysisType: analysisType
                }
            );

            setValidationResult(newAssessment);

            if (newAssessment.is_sufficient) {
                // Metadata is now sufficient, proceed with enriched data
                onImprove(enrichedFormData);
            } else {
                // Still insufficient, show feedback
                // User can try again or cancel
            }
        } catch (error) {
            console.error('Validation error:', error);
            setValidationResult({
                is_sufficient: false,
                user_message: 'Failed to validate metadata: ' + error.message
            });
        } finally {
            setValidating(false);
        }
    };

    if (!visible || !assessment || !suggestions) {
        return null;
    }

    return (
        <Modal
            title={
                <Space>
                    <WarningOutlined style={{ color: '#faad14' }} />
                    <span>Metadata Needed for AI Interpretation</span>
                </Space>
            }
            open={visible}
            onCancel={onCancel}
            width={800}
            footer={[
                <Button key="cancel" onClick={onCancel}>
                    Cancel
                </Button>,
                <Button
                    key="validate"
                    type="primary"
                    onClick={handleValidateAndContinue}
                    loading={validating}
                >
                    {validating ? 'Validating...' : 'Validate & Continue'}
                </Button>
            ]}
        >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                {/* Assessment Feedback */}
                <Alert
                    message={assessment.user_message}
                    description={assessment.reasoning}
                    type="warning"
                    showIcon
                    icon={<InfoCircleOutlined />}
                />

                {/* Validation Result (if re-validated) */}
                {validationResult && (
                    <Alert
                        message={
                            validationResult.is_sufficient
                                ? 'Metadata is now sufficient!'
                                : 'Still needs improvement'
                        }
                        description={validationResult.user_message}
                        type={validationResult.is_sufficient ? 'success' : 'warning'}
                        showIcon
                        icon={
                            validationResult.is_sufficient ? (
                                <CheckCircleOutlined />
                            ) : (
                                <InfoCircleOutlined />
                            )
                        }
                    />
                )}

                {/* Quick Questions */}
                <div>
                    <Title level={5}>Answer These Questions</Title>
                    <Form layout="vertical">
                        {suggestions.quick_questions?.map((q, index) => (
                            <Form.Item
                                key={index}
                                label={
                                    <span>
                                        {q.question}
                                        {q.required && (
                                            <Text type="danger"> *</Text>
                                        )}
                                    </span>
                                }
                                extra={
                                    q.examples?.length > 0 && (
                                        <Text type="secondary">
                                            Examples: {q.examples.join(', ')}
                                        </Text>
                                    )
                                }
                            >
                                {q.field === 'organism' ? (
                                    <Select
                                        placeholder={q.examples?.[0] || 'Select or type...'}
                                        value={formData[q.field]}
                                        onChange={(value) => handleFieldChange(q.field, value)}
                                        showSearch
                                        allowClear
                                    >
                                        {q.examples?.map(ex => (
                                            <Option key={ex} value={ex}>{ex}</Option>
                                        ))}
                                    </Select>
                                ) : (
                                    <Input
                                        placeholder={q.examples?.[0] || 'Enter value...'}
                                        value={formData[q.field]}
                                        onChange={(e) => handleFieldChange(q.field, e.target.value)}
                                    />
                                )}
                            </Form.Item>
                        ))}

                        {/* Experimental Context (free-form) */}
                        <Form.Item
                            label="Experimental Context (Optional but Recommended)"
                            extra="Provide additional details about your study design, methods, or experimental conditions"
                        >
                            <TextArea
                                rows={4}
                                placeholder="E.g., RNA-seq analysis of tumor samples from TCGA cohort, comparing primary tumor vs adjacent normal tissue..."
                                value={formData.experimental_context || ''}
                                onChange={(e) => handleFieldChange('experimental_context', e.target.value)}
                            />
                        </Form.Item>
                    </Form>
                </div>

                <Divider />

                {/* Template Suggestions */}
                {suggestions.template_suggestions?.length > 0 && (
                    <div>
                        <Title level={5}>Or Use a Template</Title>
                        <Space direction="vertical" style={{ width: '100%' }}>
                            {suggestions.template_suggestions.map((template, index) => (
                                <Card
                                    key={index}
                                    hoverable
                                    onClick={() => handleTemplateSelect(template)}
                                    size="small"
                                    style={{
                                        borderLeft: '3px solid #1890ff',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <Text strong>{template.scenario}</Text>
                                    <br />
                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                        {template.template}
                                    </Text>
                                </Card>
                            ))}
                        </Space>
                    </div>
                )}

                <Divider />

                {/* Help Section */}
                <Collapse ghost>
                    <Panel
                        header={
                            <Text strong>
                                <InfoCircleOutlined /> Need Help?
                            </Text>
                        }
                        key="help"
                    >
                        <Space direction="vertical" style={{ width: '100%' }}>
                            <div>
                                <Text strong>What biological context is needed?</Text>
                                <Paragraph type="secondary">
                                    {suggestions.what_to_include}
                                </Paragraph>
                            </div>
                            <div>
                                <Text strong>Where can I find this information?</Text>
                                <Paragraph type="secondary">
                                    {suggestions.where_to_find_it}
                                </Paragraph>
                            </div>
                            {assessment.missing_critical?.length > 0 && (
                                <div>
                                    <Text strong>Critical Missing Fields:</Text>
                                    <ul>
                                        {assessment.missing_critical.map((field, i) => (
                                            <li key={i}>
                                                <Text type="danger">{field}</Text>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {assessment.missing_recommended?.length > 0 && (
                                <div>
                                    <Text strong>Recommended Fields:</Text>
                                    <ul>
                                        {assessment.missing_recommended.map((field, i) => (
                                            <li key={i}>
                                                <Text type="warning">{field}</Text>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </Space>
                    </Panel>
                </Collapse>

                {/* Current Metadata Preview */}
                <Collapse ghost>
                    <Panel
                        header={
                            <Text strong>
                                <InfoCircleOutlined /> Current Metadata
                            </Text>
                        }
                        key="current"
                    >
                        <pre style={{
                            background: '#f5f5f5',
                            padding: 12,
                            borderRadius: 4,
                            fontSize: '12px',
                            overflow: 'auto'
                        }}>
                            {JSON.stringify(formData, null, 2)}
                        </pre>
                    </Panel>
                </Collapse>
            </Space>
        </Modal>
    );
}

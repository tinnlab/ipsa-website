// MetadataTemplateModal.jsx
// Simple template-based metadata collection for AI interpretation

import React, { useState } from 'react';
import {
    Modal,
    Form,
    Input,
    Button,
    Space,
    Alert,
    Card,
    Typography,
    Radio,
    Select
} from 'antd';
import {
    InfoCircleOutlined,
    ExperimentOutlined,
    MedicineBoxOutlined
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const STUDY_TEMPLATES = {
    disease: {
        name: 'Disease-Focused Study',
        icon: <MedicineBoxOutlined />,
        description: 'Studying a specific disease or condition (e.g., cancer, diabetes)',
        example: 'KIRC (Kidney Renal Clear Cell Carcinoma)',
        required: ['organism', 'tissue', 'disease'],
        optional: ['comparison', 'experimental_context'],
        placeholder: {
            organism: 'Homo sapiens',
            tissue: 'kidney',
            disease: 'KIRC',
            comparison: 'tumor vs normal tissue',
            experimental_context: 'RNA-seq analysis of TCGA-KIRC samples...'
        }
    },
    experimental: {
        name: 'Treatment/Exposure Study',
        icon: <ExperimentOutlined />,
        description: 'Studying effects of treatment, exposure, or experimental conditions',
        example: 'Spaceflight radiation exposure',
        required: ['organism', 'tissue', 'experimental_context', 'comparison'],
        optional: ['disease'],
        placeholder: {
            organism: 'Mus musculus',
            tissue: 'brain',
            disease: '',
            comparison: 'Spaceflight vs ground control',
            experimental_context: 'Spaceflight radiation exposure, 8.97 mGy over 39-41 days'
        }
    }
};

const COMMON_ORGANISMS = [
    'Homo sapiens',
    'Mus musculus',
    'Rattus norvegicus',
    'Drosophila melanogaster',
    'Caenorhabditis elegans',
    'Danio rerio',
    'Saccharomyces cerevisiae'
];

export default function MetadataTemplateModal({
    visible,
    onSubmit,
    onCancel,
    initialMetadata = {}
}) {
    const [studyType, setStudyType] = useState(null);
    const [formData, setFormData] = useState({
        organism: initialMetadata.organism || '',
        tissue: initialMetadata.tissue || '',
        disease: initialMetadata.disease || '',
        comparison: initialMetadata.comparison || '',
        experimental_context: initialMetadata.experimental_context || ''
    });
    const [validationErrors, setValidationErrors] = useState([]);

    const handleStudyTypeChange = (type) => {
        setStudyType(type);
        setValidationErrors([]);

        // Pre-fill with template placeholders as hints
        const template = STUDY_TEMPLATES[type];
        if (template) {
            // Only set if fields are empty
            setFormData(prev => ({
                organism: prev.organism || template.placeholder.organism,
                tissue: prev.tissue || '',
                disease: prev.disease || '',
                comparison: prev.comparison || '',
                experimental_context: prev.experimental_context || ''
            }));
        }
    };

    const handleFieldChange = (field, value) => {
        setFormData({
            ...formData,
            [field]: value
        });
        setValidationErrors([]);
    };

    const validateMetadata = () => {
        if (!studyType) {
            return ['Please select a study type'];
        }

        const template = STUDY_TEMPLATES[studyType];
        const errors = [];

        template.required.forEach(field => {
            if (!formData[field] || formData[field].trim() === '') {
                errors.push(`${field.replace('_', ' ')} is required for ${template.name}`);
            }
        });

        return errors;
    };

    const handleSubmit = () => {
        const errors = validateMetadata();

        if (errors.length > 0) {
            setValidationErrors(errors);
            return;
        }

        // Clean up the data
        const cleanedData = {
            organism: formData.organism.trim(),
            tissue: formData.tissue.trim(),
            disease: formData.disease.trim() || null,
            comparison: formData.comparison.trim(),
            experimental_context: formData.experimental_context.trim(),
            study_type: studyType
        };

        onSubmit(cleanedData);
    };

    return (
        <Modal
            title={
                <Space>
                    <InfoCircleOutlined style={{ color: '#1890ff' }} />
                    <span>Provide Biological Context for AI Interpretation</span>
                </Space>
            }
            open={visible}
            onCancel={onCancel}
            width={900}
            footer={[
                <Button key="cancel" onClick={onCancel}>
                    Cancel
                </Button>,
                <Button
                    key="submit"
                    type="primary"
                    onClick={handleSubmit}
                    disabled={!studyType}
                >
                    Continue with AI Interpretation
                </Button>
            ]}
        >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Alert
                    message="Biological context is required for AI interpretation"
                    description="The AI needs to understand your study design to provide accurate pathway interpretations. Select your study type and fill in the required fields."
                    type="info"
                    showIcon
                />

                {validationErrors.length > 0 && (
                    <Alert
                        message="Missing Required Fields"
                        description={
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                                {validationErrors.map((error, i) => (
                                    <li key={i}>{error}</li>
                                ))}
                            </ul>
                        }
                        type="error"
                        showIcon
                    />
                )}

                {/* Study Type Selection */}
                <div>
                    <Title level={5}>Step 1: Select Study Type</Title>
                    <Radio.Group
                        value={studyType}
                        onChange={(e) => handleStudyTypeChange(e.target.value)}
                        style={{ width: '100%' }}
                    >
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            {Object.entries(STUDY_TEMPLATES).map(([key, template]) => (
                                <Card
                                    key={key}
                                    hoverable
                                    onClick={() => handleStudyTypeChange(key)}
                                    style={{
                                        borderLeft: studyType === key ? '4px solid #1890ff' : '4px solid transparent',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <Radio value={key}>
                                        <Space direction="vertical" size="small">
                                            <Space>
                                                {template.icon}
                                                <Text strong style={{ fontSize: '16px' }}>
                                                    {template.name}
                                                </Text>
                                            </Space>
                                            <Text type="secondary">
                                                {template.description}
                                            </Text>
                                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                                Example: {template.example}
                                            </Text>
                                        </Space>
                                    </Radio>
                                </Card>
                            ))}
                        </Space>
                    </Radio.Group>
                </div>

                {/* Form Fields */}
                {studyType && (
                    <div>
                        <Title level={5}>Step 2: Fill in Required Information</Title>
                        <Form layout="vertical">
                            {/* Organism */}
                            <Form.Item
                                label={
                                    <span>
                                        Organism
                                        <Text type="danger"> *</Text>
                                    </span>
                                }
                                extra="Scientific name of the organism studied"
                            >
                                <Select
                                    showSearch
                                    placeholder={STUDY_TEMPLATES[studyType].placeholder.organism}
                                    value={formData.organism || undefined}
                                    onChange={(value) => handleFieldChange('organism', value)}
                                    allowClear
                                >
                                    {COMMON_ORGANISMS.map(org => (
                                        <Option key={org} value={org}>{org}</Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            {/* Tissue */}
                            <Form.Item
                                label={
                                    <span>
                                        Tissue / Cell Type
                                        <Text type="danger"> *</Text>
                                    </span>
                                }
                                extra="Tissue, organ, or cell type analyzed"
                            >
                                <Input
                                    placeholder={STUDY_TEMPLATES[studyType].placeholder.tissue}
                                    value={formData.tissue}
                                    onChange={(e) => handleFieldChange('tissue', e.target.value)}
                                />
                            </Form.Item>

                            {/* Disease (conditionally required) */}
                            <Form.Item
                                label={
                                    <span>
                                        Disease / Condition
                                        {STUDY_TEMPLATES[studyType].required.includes('disease') && (
                                            <Text type="danger"> *</Text>
                                        )}
                                    </span>
                                }
                                extra={
                                    studyType === 'disease'
                                        ? 'Disease or medical condition being studied'
                                        : 'Leave empty if not a disease study'
                                }
                            >
                                <Input
                                    placeholder={STUDY_TEMPLATES[studyType].placeholder.disease || 'N/A for non-disease studies'}
                                    value={formData.disease}
                                    onChange={(e) => handleFieldChange('disease', e.target.value)}
                                />
                            </Form.Item>

                            {/* Comparison (conditionally required) */}
                            <Form.Item
                                label={
                                    <span>
                                        Comparison
                                        {STUDY_TEMPLATES[studyType].required.includes('comparison') && (
                                            <Text type="danger"> *</Text>
                                        )}
                                    </span>
                                }
                                extra="What groups are being compared?"
                            >
                                <Input
                                    placeholder={STUDY_TEMPLATES[studyType].placeholder.comparison}
                                    value={formData.comparison}
                                    onChange={(e) => handleFieldChange('comparison', e.target.value)}
                                />
                            </Form.Item>

                            {/* Experimental Context (conditionally required) */}
                            <Form.Item
                                label={
                                    <span>
                                        Experimental Context
                                        {STUDY_TEMPLATES[studyType].required.includes('experimental_context') && (
                                            <Text type="danger"> *</Text>
                                        )}
                                    </span>
                                }
                                extra={
                                    studyType === 'experimental'
                                        ? 'Detailed description of treatment, exposure, or experimental conditions'
                                        : 'Optional: Additional study design details'
                                }
                            >
                                <TextArea
                                    rows={4}
                                    placeholder={STUDY_TEMPLATES[studyType].placeholder.experimental_context}
                                    value={formData.experimental_context}
                                    onChange={(e) => handleFieldChange('experimental_context', e.target.value)}
                                />
                            </Form.Item>
                        </Form>

                        {/* Preview */}
                        <Alert
                            message="Your metadata"
                            description={
                                <pre style={{
                                    background: '#f5f5f5',
                                    padding: 12,
                                    borderRadius: 4,
                                    fontSize: '12px',
                                    overflow: 'auto',
                                    margin: '8px 0 0 0'
                                }}>
                                    {JSON.stringify({
                                        study_type: studyType,
                                        organism: formData.organism || '(not set)',
                                        tissue: formData.tissue || '(not set)',
                                        disease: formData.disease || null,
                                        comparison: formData.comparison || '(not set)',
                                        experimental_context: formData.experimental_context || '(not set)'
                                    }, null, 2)}
                                </pre>
                            }
                            type="info"
                        />
                    </div>
                )}
            </Space>
        </Modal>
    );
}

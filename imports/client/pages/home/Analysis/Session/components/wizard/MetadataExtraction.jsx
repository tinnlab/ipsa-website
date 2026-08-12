import React, { useState } from 'react';
import { Card, Upload, Button, Space, Typography, Alert, Table, Input, Spin, Divider } from 'antd';
import { UploadOutlined, ThunderboltOutlined, DeleteOutlined } from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';

const { Text, Title } = Typography;
const { TextArea } = Input;

const MetadataExtraction = ({ analysisId, inputType, onMetadataExtracted }) => {
    const [metadataText, setMetadataText] = useState('');
    const [extractedMetadata, setExtractedMetadata] = useState(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [error, setError] = useState(null);

    const handleFileUpload = async (file) => {
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                setMetadataText(content);
                setError(null);
            };
            reader.readAsText(file);
        } catch (err) {
            setError('Failed to read file: ' + err.message);
        }
        return false; // Prevent default upload behavior
    };

    const handleExtractMetadata = async () => {
        if (!metadataText || metadataText.trim().length === 0) {
            notify.warning('Please enter or upload metadata text first');
            return;
        }

        setIsExtracting(true);
        setError(null);

        try {
            // Call LLM to extract structured metadata
            const result = await Meteor.callAsync('analysis.extractMetadata', {
                analysisId,
                inputType,
                metadataText
            });

            setExtractedMetadata(result.extracted);

            // Save to database
            await Meteor.callAsync('analysis.update', {
                analysisId,
                inputType,
                data: {
                    metadata: {
                        raw: metadataText,
                        extracted: result.extracted
                    }
                }
            });

            if (onMetadataExtracted) {
                onMetadataExtracted(result.extracted);
            }

            notify.success('Metadata extracted successfully');
        } catch (err) {
            console.error('Error extracting metadata:', err);
            setError(err.message || 'Failed to extract metadata');
            notify.error('Failed to extract metadata');
        } finally {
            setIsExtracting(false);
        }
    };

    const handleClearMetadata = () => {
        setMetadataText('');
        setExtractedMetadata(null);
        setError(null);
    };

    const metadataColumns = [
        {
            title: 'Field',
            dataIndex: 'field',
            key: 'field',
            width: '30%',
            render: (text) => <Text strong>{text}</Text>
        },
        {
            title: 'Value',
            dataIndex: 'value',
            key: 'value',
            width: '70%'
        }
    ];

    const metadataTableData = extractedMetadata
        ? Object.entries(extractedMetadata).map(([key, value]) => ({
              key,
              field: key,
              value: String(value)
          }))
        : [];

    return (
        <Card
            title={
                <Space>
                    <Text strong>Metadata (Optional)</Text>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                        Provide additional context about your experiment
                    </Text>
                </Space>
            }
            size="small"
        >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                    message="What is metadata?"
                    description="Metadata provides context about your experiment (e.g., tissue type, disease, treatment, time point). This information helps interpret analysis results and can be used for AI-powered interpretation."
                    type="info"
                    closable
                    showIcon
                />

                <Space direction="horizontal" size="middle">
                    <Upload
                        accept=".txt,.json,.csv"
                        showUploadList={false}
                        beforeUpload={handleFileUpload}
                    >
                        <Button icon={<UploadOutlined />}>
                            Upload Metadata File
                        </Button>
                    </Upload>
                    <Text type="secondary">or paste/type below</Text>
                </Space>

                <TextArea
                    rows={6}
                    placeholder={`Enter metadata in plain text or structured format, for example:\n\nTissue: Liver\nDisease: Hepatocellular carcinoma\nTreatment: Drug A, 10μM\nTime Point: 24 hours\nOrganism: Homo sapiens\n\nOr paste JSON/CSV content...`}
                    value={metadataText}
                    onChange={(e) => setMetadataText(e.target.value)}
                    disabled={isExtracting}
                />

                <Space>
                    <Button
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        onClick={handleExtractMetadata}
                        loading={isExtracting}
                        disabled={!metadataText || metadataText.trim().length === 0}
                    >
                        {isExtracting ? 'Extracting...' : 'Extract Structured Metadata'}
                    </Button>
                    {(metadataText || extractedMetadata) && (
                        <Button
                            icon={<DeleteOutlined />}
                            onClick={handleClearMetadata}
                            disabled={isExtracting}
                        >
                            Clear
                        </Button>
                    )}
                </Space>

                {error && (
                    <Alert
                        message="Extraction Error"
                        description={error}
                        type="error"
                        closable
                        onClose={() => setError(null)}
                        showIcon
                    />
                )}

                {extractedMetadata && (
                    <>
                        <Divider style={{ margin: '12px 0' }} />
                        <div>
                            <Title level={5} style={{ marginBottom: 12 }}>
                                ✅ Extracted Metadata ({Object.keys(extractedMetadata).length} fields)
                            </Title>
                            <Table
                                columns={metadataColumns}
                                dataSource={metadataTableData}
                                pagination={false}
                                size="small"
                                bordered
                                style={{ marginTop: 8 }}
                            />
                        </div>
                    </>
                )}
            </Space>
        </Card>
    );
};

export default MetadataExtraction;

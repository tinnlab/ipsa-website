import React from 'react';
import { Card, Row, Col, Typography, Space, Button, Divider } from 'antd';
import { FileTextOutlined, LineChartOutlined, TableOutlined, CheckCircleFilled } from '@ant-design/icons';
import example from '../example';
import useInputTypePolicy from '/imports/client/hooks/useInputTypePolicy';

const { Title, Text, Paragraph } = Typography;

// The 3-column (Gene / log2 Fold-Change / P-value) example, served from the same text the
// "Use sample data" button loads. /files/pgsea-sample.tsv is single-metric, which the
// 3-column requirement refuses.
const PGSEA_STATS_EXAMPLE_HREF =
    `data:text/tab-separated-values;charset=utf-8,${encodeURIComponent(example.PGSEA_3COL)}`;

const Step1_InputTypeSelection = ({ selectedInputType, onSelectInputType }) => {
    const { pgseaRequireStatsColumns } = useInputTypePolicy();
    const inputTypes = [
        {
            key: 'ora',
            title: 'ORA',
            fullName: 'Over-Representation Analysis',
            icon: <FileTextOutlined style={{ fontSize: 48, color: '#1890ff' }} />,
            description: 'Analyze a list of genes to find enriched pathways. Best for: Gene lists from literature, GWAS hits, or differential expression.',
            format: 'Plain text file with one gene identifier per line',
            examples: [
                { name: 'Gene List Example', file: '/files/ora-sample.txt' }
            ],
            color: '#e6f7ff'
        },
        {
            key: 'pgsea',
            title: 'PGSEA',
            fullName: 'Parametric Gene Set Enrichment Analysis',
            icon: <LineChartOutlined style={{ fontSize: 48, color: '#52c41a' }} />,
            // description: 'Analyze a ranked gene list with statistics to find pathways correlated with the ranking. Best for: differential-expression results (gene, log2 fold change, p-value).',
            description: 'Analyze a ranked gene list with statistics to find pathways correlated with the ranking. Best for: differential-expression results (gene, fold change, p-value).',
            // format: pgseaRequireStatsColumns
            //     ? '3-column file, tab- or comma-separated, header optional: Gene ID [TAB] log2 fold change [TAB] p-value. A column of linear fold changes (all > 0, centred on 1) will be interpreted incorrectly.'
            //     : '2 or 3 columns, tab- or comma-separated, header optional: Gene ID [TAB] log2 fold change [TAB] p-value (optional)',
            format: pgseaRequireStatsColumns
                ? '3-column file, tab- or comma-separated, header optional: Gene ID [TAB] fold change [TAB] p-value. The fold change can be log2 (default) or linear; you choose which on the next step.'
                : '2 or 3 columns, tab- or comma-separated, header optional: Gene ID [TAB] fold change [TAB] p-value (optional). The fold change can be log2 (default) or linear; you choose which on the next step.',
            examples: pgseaRequireStatsColumns
                ? [
                    { name: 'Ranked Gene List with Statistics Example', file: PGSEA_STATS_EXAMPLE_HREF, download: 'pgsea-stats-sample.tsv' }
                ]
                : [
                    { name: 'Ranked Gene List with Statistics Example', file: PGSEA_STATS_EXAMPLE_HREF, download: 'pgsea-stats-sample.tsv' },
                    { name: 'Single-Metric Ranked List Example', file: '/files/pgsea-sample.tsv' }
                ],
            color: '#f6ffed'
        },
        {
            key: 'expression',
            title: 'Expression Data',
            fullName: 'Gene Expression Analysis',
            icon: <TableOutlined style={{ fontSize: 48, color: '#fa8c16' }} />,
            description: 'Analyze gene expression matrices to find differential expression and pathway enrichment. Best for: RNA-seq, microarray data.',
            format: 'Two CSV files: Expression matrix (genes × samples) + Group assignments',
            examples: [
                { name: 'Expression Matrix Example', file: '/files/GSE48350-expression.csv' },
                { name: 'Group File Example', file: '/files/GSE48350-group.csv' }
            ],
            color: '#fff7e6'
        }
    ];

    return (
        <div>
            <div style={{ marginBottom: 32, textAlign: 'center' }}>
                <Title level={3}>Step 1: Select Input Type</Title>
                <Text type="secondary">
                    Choose the type of data you want to analyze. You can download example files to see the expected format.
                </Text>
            </div>

            <Row gutter={[24, 24]}>
                {inputTypes.map(type => {
                    const isSelected = selectedInputType === type.key;

                    return (
                        <Col xs={24} md={8} key={type.key}>
                            <Card
                                hoverable
                                onClick={() => onSelectInputType(type.key)}
                                style={{
                                    height: '100%',
                                    border: isSelected ? '2px solid #1890ff' : '1px solid #d9d9d9',
                                    backgroundColor: isSelected ? type.color : '#ffffff',
                                    cursor: 'pointer',
                                    position: 'relative'
                                }}
                                styles={{ body: { padding: 24, height: '100%', display: 'flex', flexDirection: 'column' } }}
                            >
                                {isSelected && (
                                    <div style={{
                                        position: 'absolute',
                                        top: 16,
                                        right: 16
                                    }}>
                                        <CheckCircleFilled style={{ fontSize: 24, color: '#52c41a' }} />
                                    </div>
                                )}

                                <Space direction="vertical" size="middle" style={{ width: '100%', flex: 1 }}>
                                    <div style={{ textAlign: 'center' }}>
                                        {type.icon}
                                    </div>

                                    <div style={{ textAlign: 'center' }}>
                                        <Title level={4} style={{ marginBottom: 4 }}>
                                            {type.title}
                                        </Title>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {type.fullName}
                                        </Text>
                                    </div>

                                    <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
                                        {type.description}
                                    </Paragraph>

                                    <Divider style={{ margin: '8px 0' }} />

                                    <div>
                                        <Text strong style={{ fontSize: 12 }}>Expected Format:</Text>
                                        <Paragraph style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: '#666' }}>
                                            {type.format}
                                        </Paragraph>
                                    </div>

                                    <div style={{ marginTop: 'auto' }}>
                                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                                            Download Examples:
                                        </Text>
                                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                            {type.examples.map((example, idx) => (
                                                <Button
                                                    key={idx}
                                                    size="small"
                                                    type="link"
                                                    href={example.file}
                                                    download={example.download || true}
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{ padding: 0, height: 'auto', fontSize: 12 }}
                                                >
                                                    📥 {example.name}
                                                </Button>
                                            ))}
                                        </Space>
                                    </div>
                                </Space>
                            </Card>
                        </Col>
                    );
                })}
            </Row>

            <div style={{ marginTop: 32, textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    💡 Tip: Download and examine the example files to understand the required format before uploading your data.
                </Text>
            </div>
        </div>
    );
};

export default Step1_InputTypeSelection;

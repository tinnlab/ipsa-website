import React, { useState, useMemo, useRef } from 'react';
import { Table, Input, Button, Space, Tag, Typography, Card, message, Upload, Modal } from 'antd';
import { SearchOutlined, DownloadOutlined, EditOutlined, SaveOutlined, CloseOutlined, UploadOutlined } from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';
import { useGlobalSettings } from '/imports/client/contexts/GlobalSettingsContext';

const { Text } = Typography;

const MetadataTable = ({ analysesMetadata = {}, sessionId }) => {
    // Provided by the Visualization page's GlobalSettingsProvider; true for a view-only import.
    const { readOnly } = useGlobalSettings();
    const [searchText, setSearchText] = useState('');
    const [filteredMetadata, setFilteredMetadata] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editedData, setEditedData] = useState({}); // Store edited values
    const [importModalVisible, setImportModalVisible] = useState(false);
    const fileInputRef = useRef(null);

    // Convert metadata object to table data
    const tableData = useMemo(() => {
        const datasets = Object.keys(analysesMetadata);

        if (datasets.length === 0) {
            return [];
        }

        // Collect all unique metadata fields
        const allFields = new Set();
        Object.values(analysesMetadata).forEach(metadata => {
            Object.keys(metadata).forEach(field => allFields.add(field));
        });

        const fieldsList = Array.from(allFields).sort();

        // Build table rows
        return datasets.map(datasetName => {
            const metadata = analysesMetadata[datasetName];
            const row = {
                key: datasetName,
                datasetName: datasetName,
            };

            // Add each metadata field as a column
            fieldsList.forEach(field => {
                row[field] = metadata[field] || '';
            });

            return row;
        });
    }, [analysesMetadata]);

    // Get all metadata fields for columns
    const metadataFields = useMemo(() => {
        const fields = new Set();
        Object.values(analysesMetadata).forEach(metadata => {
            Object.keys(metadata).forEach(field => fields.add(field));
        });
        return Array.from(fields).sort();
    }, [analysesMetadata]);

    // Filter data based on search
    const displayData = useMemo(() => {
        if (!searchText) return filteredMetadata || tableData;

        const lowerSearch = searchText.toLowerCase();
        return (filteredMetadata || tableData).filter(row => {
            // Search in dataset name
            if (row.datasetName.toLowerCase().includes(lowerSearch)) return true;

            // Search in any metadata value
            return metadataFields.some(field => {
                const value = row[field];
                return value && String(value).toLowerCase().includes(lowerSearch);
            });
        });
    }, [tableData, filteredMetadata, searchText, metadataFields]);

    // Enter edit mode
    const enterEditMode = () => {
        // Initialize editedData with current metadata
        const initialData = {};
        Object.keys(analysesMetadata).forEach(datasetName => {
            initialData[datasetName] = { ...analysesMetadata[datasetName] };
        });
        setEditedData(initialData);
        setIsEditMode(true);
    };

    // Cancel editing
    const cancelEdit = () => {
        setIsEditMode(false);
        setEditedData({});
    };

    // Update edited value
    const updateEditedValue = (datasetName, field, value) => {
        setEditedData(prev => ({
            ...prev,
            [datasetName]: {
                ...prev[datasetName],
                [field]: value
            }
        }));
    };

    // Save all edits
    const saveAllEdits = async () => {
        try {
            // Call Meteor method to update all metadata changes
            await Meteor.callAsync('session.updateAnalysisMetadata', {
                sessionId,
                metadataUpdates: editedData
            });

            message.success('Metadata updated successfully');
            setIsEditMode(false);
            setEditedData({});
            setFilteredMetadata(null); // Force table refresh
        } catch (error) {
            console.error('Error updating metadata:', error);
            message.error('Failed to update metadata: ' + error.message);
        }
    };

    // Handle metadata import
    const handleImportMetadata = (file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target.result;
                const importedData = JSON.parse(content);

                // Validate imported data format
                if (typeof importedData !== 'object' || Array.isArray(importedData)) {
                    message.error('Invalid metadata format. Expected an object with dataset names as keys.');
                    return;
                }

                console.log('Importing metadata for datasets:', Object.keys(importedData));

                // Update metadata via API
                await Meteor.callAsync('session.updateAnalysisMetadata', {
                    sessionId,
                    metadataUpdates: importedData
                });

                message.success(`Metadata imported successfully for ${Object.keys(importedData).length} datasets`);
                setImportModalVisible(false);
                setFilteredMetadata(null); // Force table refresh
            } catch (error) {
                console.error('Error importing metadata:', error);
                message.error('Failed to import metadata: ' + error.message);
            }
        };
        reader.readAsText(file);
        return false; // Prevent default upload behavior
    };

    // Export as CSV
    const exportAsCSV = () => {
        if (displayData.length === 0) {
            return;
        }

        // Build CSV header
        const headers = ['Dataset', ...metadataFields];
        const csvHeader = headers.join(',');

        // Build CSV rows
        const csvRows = displayData.map(row => {
            const values = [
                row.datasetName,
                ...metadataFields.map(field => {
                    const value = row[field];
                    // Escape commas and quotes
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                })
            ];
            return values.join(',');
        });

        const csv = [csvHeader, ...csvRows].join('\n');

        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `dataset-metadata-${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Export as JSON
    const exportAsJSON = () => {
        if (displayData.length === 0) {
            return;
        }

        const jsonData = displayData.map(row => {
            const obj = { dataset: row.datasetName };
            metadataFields.forEach(field => {
                if (row[field]) {
                    obj[field] = row[field];
                }
            });
            return obj;
        });

        const json = JSON.stringify(jsonData, null, 2);

        // Download
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `dataset-metadata-${Date.now()}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Build table columns
    const columns = [
        {
            title: 'Dataset',
            dataIndex: 'datasetName',
            key: 'datasetName',
            fixed: 'left',
            width: 200,
            sorter: (a, b) => a.datasetName.localeCompare(b.datasetName),
            render: (text) => <Text strong>{text}</Text>
        },
        ...metadataFields.map(field => ({
            title: field,
            dataIndex: field,
            key: field,
            width: 180,
            ellipsis: true,
            sorter: (a, b) => {
                const valA = String(a[field] || '');
                const valB = String(b[field] || '');
                return valA.localeCompare(valB);
            },
            render: (text, record) => {
                if (isEditMode) {
                    const editedValue = editedData[record.datasetName]?.[field] ?? text ?? '';
                    return (
                        <Input
                            value={editedValue}
                            onChange={(e) => updateEditedValue(record.datasetName, field, e.target.value)}
                            size="small"
                        />
                    );
                }

                if (!text) return <Text type="secondary">-</Text>;
                return <Text>{text}</Text>;
            }
        }))
    ];

    if (Object.keys(analysesMetadata).length === 0) {
        return (
            <Card>
                <div style={{ textAlign: 'center', padding: '40px' }}>
                    <Text type="secondary">No metadata available. Upload data with metadata files to see dataset information here.</Text>
                </div>
            </Card>
        );
    }

    return (
        <div style={{ padding: '20px' }}>
            <Card>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    {/* Header with search and export */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                            <Input
                                placeholder="Search datasets or metadata..."
                                prefix={<SearchOutlined />}
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                style={{ width: 300 }}
                                allowClear
                                disabled={isEditMode}
                            />
                            <Text type="secondary">
                                {displayData.length} dataset{displayData.length !== 1 ? 's' : ''}
                                {searchText && ` (filtered from ${tableData.length})`}
                            </Text>
                        </Space>
                        <Space>
                            {isEditMode ? (
                                <>
                                    <Button
                                        type="primary"
                                        icon={<SaveOutlined />}
                                        onClick={saveAllEdits}
                                    >
                                        Save Changes
                                    </Button>
                                    <Button
                                        icon={<CloseOutlined />}
                                        onClick={cancelEdit}
                                    >
                                        Cancel
                                    </Button>
                                </>
                            ) : (
                                <>
                                    {/* Import and Edit both write metadata back to the study, so
                                        they are omitted on a view-only import. Export stays: it has
                                        no database side-effect. */}
                                    {!readOnly && (
                                        <Upload
                                            accept=".json"
                                            showUploadList={false}
                                            beforeUpload={handleImportMetadata}
                                        >
                                            <Button icon={<UploadOutlined />}>
                                                Import Metadata
                                            </Button>
                                        </Upload>
                                    )}
                                    {!readOnly && (
                                        <Button
                                            icon={<EditOutlined />}
                                            onClick={enterEditMode}
                                            disabled={displayData.length === 0}
                                        >
                                            Edit Metadata
                                        </Button>
                                    )}
                                    <Button
                                        icon={<DownloadOutlined />}
                                        onClick={exportAsCSV}
                                        disabled={displayData.length === 0}
                                    >
                                        Export CSV
                                    </Button>
                                    <Button
                                        icon={<DownloadOutlined />}
                                        onClick={exportAsJSON}
                                        disabled={displayData.length === 0}
                                    >
                                        Export JSON
                                    </Button>
                                </>
                            )}
                        </Space>
                    </div>

                    {/* Metadata fields summary */}
                    <div>
                        <Text type="secondary">Metadata fields: </Text>
                        <Space wrap>
                            {metadataFields.slice(0, 10).map(field => (
                                <Tag key={field}>{field}</Tag>
                            ))}
                            {metadataFields.length > 10 && (
                                <Tag>+{metadataFields.length - 10} more</Tag>
                            )}
                        </Space>
                    </div>

                    {/* Table */}
                    <Table
                        columns={columns}
                        dataSource={displayData}
                        pagination={{
                            pageSize: 20,
                            showSizeChanger: true,
                            showTotal: (total) => `Total ${total} datasets`,
                            pageSizeOptions: ['10', '20', '50', '100']
                        }}
                        scroll={{ x: 'max-content', y: 600 }}
                        size="small"
                        bordered
                    />
                </Space>
            </Card>
        </div>
    );
};

export default MetadataTable;

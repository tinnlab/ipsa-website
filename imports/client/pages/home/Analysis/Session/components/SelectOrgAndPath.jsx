import React, {useEffect, useState, useMemo, useRef, useCallback} from "react";
import {useTracker} from "meteor/react-meteor-data";
import {Meteor} from 'meteor/meteor';
import {
    Layout,
    Collapse,
    Typography,
    Space,
    Tabs,
    Button,
    Upload,
    Tooltip,
    Table,
    Popover,
    Input,
    Spin,
    Select,
    message,
    Modal,
    Form,
    Alert,
    Card,
    Divider,
    Checkbox
} from "antd";
import {
    UploadOutlined,
    DownloadOutlined,
    EditOutlined,
    DeleteOutlined
} from "@ant-design/icons";
import _ from "lodash";

import AnalysisUtils from "./AnalysisUtils";
import useSubscription from "../../../../../hooks/useSubscription";
import {useUpdate} from "react-use";
import {sortOrganismsByName} from "/imports/utils/organismSort";

const {Title, Text, Paragraph} = Typography;
const {Option} = Select;

const GeneSetAnalysis = ({analysisId, inputType, sessionId}) => {
    // State management
    const [activeTab, setActiveTab] = useState('0');
    const [selectedCustomRowKeys, setSelectedCustomRowKeys] = useState({});
    const [databases, setDatabases] = useState([]);
    const [loadingDatabases, setLoadingDatabases] = useState(true);
    const [selectedDatasets, setSelectedDatasets] = useState([]);
    const [scrollConfig, setScrollConfig] = useState({x: 'max-content', y: 500});
    const [isOpenCustomGeneModal, setIsOpenCustomGeneModal] = useState(false);
    const [isUploadingCustomGeneSet, setIsUploadingCustomGeneSet] = useState(false);
    const [customGeneSetForm] = Form.useForm();
    const [gmtFormatDetection, setGmtFormatDetection] = useState(null);
    const [showFormatConfig, setShowFormatConfig] = useState(false);
    const [formatConfig, setFormatConfig] = useState({
        pathwayNameColumn: 0,
        pathwayIdColumn: null,
        genesStartColumn: 2
    });
    const update = useUpdate()

    useSubscription('session.config', {sessionId, keys: ['customGeneSets']}, [sessionId]);
    useSubscription('analysis.config', {
        analysisId,
        inputType,
        keys: ['geneStats', 'selectedRows', 'selectedDatasets']
    }, [analysisId, inputType]);
    useSubscription("organism.user.all", {}, []);

    // Tracking loading state
    const loading = useTracker(() => {
        const subscription = Meteor.subscribe('analysisConfig', {
            analysisId,
            inputType,
            key: 'geneStatsProcessingStatus'
        });
        if (!subscription.ready()) return true;

        const config = DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'geneStatsProcessingStatus'
        });
        return config?.value === "loading";
    }, [inputType, analysisId]);

    // Tracking table data
    const tableData = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'geneStats'
        })?.value || [];
    }, [inputType, analysisId]);

    // Tracking selected rows
    const selectedRows = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'selectedRows'
        })?.value || [];
    }, [inputType, analysisId]);

    // Tracking custom genesets
    const customGeneSets = useTracker(() => {
        return DBCollections.SessionConfig.find({
            sessionId,
            key: 'customGeneSets'
        }).fetch() ?? [];
    }, [sessionId, analysisId]);

    const organism = useTracker(() => {
        return sortOrganismsByName(DBCollections.Organism.find({isEnabled: true}).fetch());
    })

    // Tracking selected datasets reactively
    const selectedDatasetsFromDB = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'selectedDatasets'
        })?.value || [];
    }, [analysisId, inputType]);

    // Effects
    useEffect(() => {
        if (selectedRows.length > 0) {
            setSelectedCustomRowKeys(selectedRows.reduce((acc, curr) => {
                acc[curr.id] = curr.rowKeys;
                return acc;
            }, {}));
        } else {
            setSelectedCustomRowKeys({});
        }
    }, [selectedRows]);

    useEffect(() => {
        const handleResize = () => {
            setScrollConfig({
                x: 'max-content',
                y: 400
            });
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const fetchDataAndDatabases = async () => {
            setLoadingDatabases(true);
            try {
                Meteor.call('database.getAll', (error, result) => {
                    if (error) {
                        message.error('Failed to fetch databases');
                        console.error('Error fetching databases:', error);
                    } else {
                        if (customGeneSets && customGeneSets.length > 0) {
                            customGeneSets.forEach(customGeneSet => {
                                result.push({
                                    _id: customGeneSet._id,
                                    name: customGeneSet.value.name,
                                    isCustom: true
                                });
                            })
                        }
                        setDatabases(result);
                    }
                    setLoadingDatabases(false);
                });
            } catch (error) {
                console.error('Error fetching data:', error);
                message.error('Failed to fetch data');
                setLoadingDatabases(false);
            }
        };

        fetchDataAndDatabases();
    }, [analysisId, inputType, customGeneSets]);

    // Sync reactive selected datasets from DB to local state
    useEffect(() => {
        if (selectedDatasetsFromDB && selectedDatasetsFromDB.length > 0) {
            setSelectedDatasets(selectedDatasetsFromDB);
        }
    }, [selectedDatasetsFromDB]);

    // Table columns configuration
    const columns = useMemo(() => [
        {
            title: "ID",
            dataIndex: "id",
            key: "id",
            width: 100,
            fixed: 'left',
            ellipsis: true
        },
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            width: 200,
            ellipsis: true
        },
        {
            title: "#Genes",
            dataIndex: "genes",
            key: "genes",
            width: 75,
            sorter: (a, b) => a.genes - b.genes,
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
        ...(inputType === 'ora' ? [{
            title: "#Background genes",
            dataIndex: "background",
            key: "background",
            width: 75,
            sorter: (a, b) => a.background - b.background,
            sortDirections: ['ascend', 'descend', 'ascend'],
        }] : []),
        {
            title: "#Common genes",
            dataIndex: "common",
            key: "common",
            width: 75,
            sorter: (a, b) => a.common - b.common,
            sortDirections: ['ascend', 'descend', 'ascend'],
        }
    ], [inputType]);

    // Event handlers
    const handleRowSelection = async (selectedRowKeys, group) => {
        const newSelectedCustomRowKeys = {
            ...selectedCustomRowKeys,
            [group.id]: selectedRowKeys
        };
        setSelectedCustomRowKeys(newSelectedCustomRowKeys);

        await AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                selectedRows: Object.keys(newSelectedCustomRowKeys).map(key => ({
                    id: key,
                    rowKeys: newSelectedCustomRowKeys[key]
                }))
            }
        });
    };

    const handleDatasetSelection = async (value) => {
        console.log("selected value: ", value)
        if (value.length > 0) {
            await AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {selectedDatasets: value}
            });
        }
    };

    const debounceDatasetSelectionRef = useRef()
    debounceDatasetSelectionRef.current = async (value) => {
        await handleDatasetSelection(value);
    }

    const debounceDatasetSelection = useCallback(_.debounce(
        async (value) => await debounceDatasetSelectionRef.current(value),
        1500
    ), [])

    const handleFileUpload = async (file) => {
        const customGeneSet = await AnalysisUtils.parseGMTFile(file);
        await Meteor.callAsync("session.add.custom.geneSets", {
            sessionId,
            analysisId,
            customGeneSet
        });
        return false;
    };

    const handleDeleteGeneSet = async (customGeneSetId) => {
        await Meteor.callAsync("session.remove.custom.geneSets", {
            sessionId,
            customGeneSetId
        });
        setActiveTab('0');
    };

    const filterOption = (input, option) =>
        option.children.toLowerCase().includes(input.toLowerCase());

    // Render table function
    const renderTable = (group) => {
        return (
            <Table
                rowSelection={group.isCustom ? {
                    selectedRowKeys: selectedCustomRowKeys[group.id] || [],
                    onChange: (selectedRowKeys) => handleRowSelection(selectedRowKeys, group),
                    columnWidth: 50,
                } : undefined}
                columns={columns}
                dataSource={group.geneSets}
                rowKey={record => record.id}
                size="small"
                scroll={scrollConfig}
                virtual={true}
                pagination={false}
                rowHeight={54}
                summary={() => (
                    <Table.Summary fixed={true}>
                        <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={2}>
                                {/* Pinned for the same reason as the results table: the cell is as
                                    wide as the horizontal scroll area, so the label would otherwise
                                    slide out of view when scrolling right. */}
                                <div style={{position: 'sticky', left: 0, display: 'inline-block'}}>
                                    Total Items: {group.geneSets.length}
                                </div>
                            </Table.Summary.Cell>
                        </Table.Summary.Row>
                    </Table.Summary>
                )}
                loading={{
                    // spinning: loading || loadingDatabases,
                    spinning: loading,
                    indicator: <Spin tip="Loading Table..."/>
                }}
            />
        )
    };

    // Generate tab items
    const tabItems = useMemo(() => {
            return tableData.filter(db => selectedDatasets.includes(db.id))?.sort((a, b) => selectedDatasets.indexOf(a.id) - selectedDatasets.indexOf(b.id)).map((group, index) => ({
                key: String(index),
                label: (
                    <>
                        <Text>
                            {group.namespace ?
                                `${group.name} (${group.namespace})` :
                                group.name}
                        </Text>
                        {group.isCustom && (
                            <Space>
                                <Tooltip title="Edit name">
                                    <Popover
                                        trigger="click"
                                        content={
                                            <div style={{display: "inline-block"}}>
                                                <Input
                                                    defaultValue={group.name}
                                                    onChange={(e) => {
                                                    }}
                                                    placeholder="Enter new name"
                                                    style={{width: 200}}
                                                />
                                                <Button
                                                    style={{marginLeft: 10}}
                                                    type="primary"
                                                    onClick={() => {
                                                    }}
                                                >
                                                    Save
                                                </Button>
                                            </div>
                                        }
                                    >
                                        <Button
                                            size="small"
                                            type="link"
                                            icon={<EditOutlined/>}
                                        />
                                    </Popover>
                                </Tooltip>
                                <Button
                                    size="small"
                                    type="link"
                                    icon={<DeleteOutlined/>}
                                    onClick={() => handleDeleteGeneSet(group.id)}
                                />
                            </Space>
                        )}
                    </>
                ),
                children: renderTable(group)
            }))
        },
        [tableData, selectedCustomRowKeys, loading, loadingDatabases, scrollConfig, selectedDatasets]
    );

    // Collapse items configuration
    const collapseItems = [
        {
            key: "1",
            label: (
                <Title level={5} style={{margin: 0}}>
                    Select Pathway Databases
                </Title>
            ),
            children: (
                <Space direction="vertical" style={{width: '100%'}}>
                    <Paragraph>
                        Enter text to search for more databases. Click
                        <a onClick={() => {
                        }}> here</a> to see all supported databases.
                        If the interested databases is not supported, please upload a GMT file.
                        The ID type in the GMT file must match the ID type in the input.
                        Download example GMT file with Gene IDs
                        <a href={`${urlPrefix}/resources/gmt/h.all.v7.4.entrez.gmt`} target='__blank'> here</a> or
                        with Gene Symbols <a href={`${urlPrefix}/resources/gmt/h.all.v7.4.symbols.gmt`}
                                             target='__blank'>here</a>.
                    </Paragraph>

                    <Select
                        mode="multiple"
                        style={{width: '100%'}}
                        placeholder="Select dataset"
                        onChange={(value) => {
                            setSelectedDatasets(value);
                            debounceDatasetSelection(value);
                        }}
                        value={selectedDatasets}
                        loading={loadingDatabases}
                        disabled={loading}
                        filterOption={filterOption}
                        showSearch
                    >
                        {databases.map(db => (
                            <Select.Option key={db._id} value={db._id}>
                                {db.isCustom ?
                                    `${db.name} (Custom)` :
                                    (db.namespace ? `${db.name} (${db.namespace})` : db.name)
                                }
                            </Select.Option>
                        ))}
                    </Select>

                    {loading && selectedDatasets.length > 0 && (
                        <Alert
                            message="Calculating Gene Overlaps"
                            description={`Please wait while we calculate gene overlaps for ${selectedDatasets.length} selected database${selectedDatasets.length > 1 ? 's' : ''}. This may take a moment...`}
                            type="info"
                            showIcon
                            style={{ marginBottom: 16 }}
                        />
                    )}
                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        items={tabItems}
                        tabBarExtraContent={{
                            right: (
                                <Space>
                                    <Tooltip title="ID type in the GMT file must match the ID type in the input">
                                        <Button
                                            type="primary"
                                            icon={<UploadOutlined/>}
                                            onClick={() => {
                                                setIsOpenCustomGeneModal(true)
                                                customGeneSetForm.resetFields()
                                            }}
                                        >
                                            Upload GMT file
                                        </Button>
                                    </Tooltip>
                                    <Modal
                                        title="Upload GMT file"
                                        open={isOpenCustomGeneModal}
                                        footer={false}
                                        onCancel={() => {
                                            setIsOpenCustomGeneModal(false)
                                            customGeneSetForm.resetFields()
                                        }}
                                    >
                                        <Spin spinning={isUploadingCustomGeneSet} tip="Uploading...">
                                            <Form
                                                form={customGeneSetForm}
                                                initialValues={{
                                                    gmtFile: undefined,
                                                    genesetName: 'My gene set',
                                                    taxId: undefined,
                                                }}
                                                onFinish={async () => {
                                                    setIsUploadingCustomGeneSet(true)
                                                    const {
                                                        gmtFile,
                                                        genesetName,
                                                        taxId
                                                    } = customGeneSetForm.getFieldsValue()
                                                    const customGeneSet = await AnalysisUtils.parseGMTFile(gmtFile.file, formatConfig)
                                                    console.log("customGeneSet", customGeneSet)
                                                    await Meteor.callAsync("session.add.custom.geneSets", {
                                                        sessionId,
                                                        customGeneSet,
                                                        name: genesetName,
                                                        taxId
                                                    })
                                                    setIsOpenCustomGeneModal(false)
                                                    customGeneSetForm.resetFields()
                                                    setIsUploadingCustomGeneSet(false)
                                                }}
                                            >
                                                <Form.Item
                                                    name={'gmtFile'}
                                                    rules={[{required: true, message: 'Please select a GMT file'}]}
                                                >
                                                    <Upload
                                                        accept={'.gmt,.tmt'}
                                                        // showUploadList={false}
                                                        beforeUpload={async (file) => {
                                                            // Detect format
                                                            const detection = await AnalysisUtils.detectGMTFormat(file);

                                                            console.log('GMT format detection:', detection);
                                                            setGmtFormatDetection(detection);

                                                            customGeneSetForm.setFieldsValue({
                                                                gmtFile: file
                                                            });

                                                            // Show format config UI if needed
                                                            if (detection.needsUserInput) {
                                                                setShowFormatConfig(true);
                                                                // Set suggested config based on detection
                                                                if (detection.suggestion === 'custom') {
                                                                    setFormatConfig({
                                                                        pathwayNameColumn: 0,
                                                                        pathwayIdColumn: null,
                                                                        genesStartColumn: 2
                                                                    });
                                                                }
                                                            } else {
                                                                setShowFormatConfig(false);
                                                                // Standard format
                                                                setFormatConfig({
                                                                    pathwayNameColumn: 1,
                                                                    pathwayIdColumn: 0,
                                                                    genesStartColumn: 2
                                                                });
                                                            }

                                                            update();
                                                            return false;
                                                        }}
                                                        onRemove={(file) => {
                                                            customGeneSetForm.setFieldsValue({
                                                                gmtFile: undefined
                                                            })
                                                            update()
                                                            return true
                                                        }}
                                                    >
                                                        <Button icon={<UploadOutlined/>}>Select GMT file</Button>
                                                    </Upload>
                                                </Form.Item>

                                                {/* Format Detection Results */}
                                                {customGeneSetForm.getFieldValue('gmtFile') && gmtFormatDetection && (
                                                    <Alert
                                                        message={gmtFormatDetection.isStandard
                                                            ? "✓ Standard GMT format detected"
                                                            : "⚠ Non-standard format detected"}
                                                        description={gmtFormatDetection.isStandard
                                                            ? "File uses standard GMT format (ID, Name, Genes...)"
                                                            : "Please configure column mapping below"}
                                                        type={gmtFormatDetection.isStandard ? "success" : "warning"}
                                                        showIcon
                                                        style={{ marginBottom: 16 }}
                                                    />
                                                )}

                                                {/* Column Configuration (shown only for non-standard) */}
                                                {showFormatConfig && customGeneSetForm.getFieldValue('gmtFile') && (
                                                    <Card
                                                        title="Configure Column Mapping"
                                                        size="small"
                                                        style={{ marginBottom: 16, backgroundColor: '#fafafa' }}
                                                    >
                                                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                                Sample from your file: {gmtFormatDetection?.analysis?.sampleData?.row1?.slice(0, 4).join(' | ')}...
                                                            </Text>

                                                            <Divider style={{ margin: '8px 0' }} />

                                                            <Space align="baseline">
                                                                <Text strong>Pathway Name is in column:</Text>
                                                                <Select
                                                                    value={formatConfig.pathwayNameColumn}
                                                                    onChange={(val) => setFormatConfig({...formatConfig, pathwayNameColumn: val})}
                                                                    style={{ width: 100 }}
                                                                >
                                                                    <Option value={0}>Column 1</Option>
                                                                    <Option value={1}>Column 2</Option>
                                                                    <Option value={2}>Column 3</Option>
                                                                </Select>
                                                            </Space>

                                                            <Space align="baseline">
                                                                <Text strong>Genes start from column:</Text>
                                                                <Select
                                                                    value={formatConfig.genesStartColumn}
                                                                    onChange={(val) => setFormatConfig({...formatConfig, genesStartColumn: val})}
                                                                    style={{ width: 100 }}
                                                                >
                                                                    <Option value={1}>Column 2</Option>
                                                                    <Option value={2}>Column 3</Option>
                                                                    <Option value={3}>Column 4</Option>
                                                                </Select>
                                                            </Space>

                                                            <Checkbox
                                                                checked={formatConfig.pathwayIdColumn === 0}
                                                                onChange={(e) => setFormatConfig({
                                                                    ...formatConfig,
                                                                    pathwayIdColumn: e.target.checked ? 0 : null
                                                                })}
                                                            >
                                                                Use separate column 1 as pathway ID (optional)
                                                            </Checkbox>
                                                        </Space>
                                                    </Card>
                                                )}

                                                {
                                                    customGeneSetForm.getFieldValue('gmtFile') && (
                                                        <>
                                                            <Form.Item
                                                                label={"Gene set name"}
                                                                name={'genesetName'}
                                                                rules={[{required: true, message: 'Please enter a name'}]}
                                                            >
                                                                <Input/>
                                                            </Form.Item>
                                                            <Form.Item
                                                                label={"Select organism"}
                                                                name={'taxId'}
                                                                rules={[{
                                                                    required: true,
                                                                    message: 'Please select an organism'
                                                                }]}
                                                            >
                                                                <Select
                                                                    showSearch
                                                                    filterOption={(input, option) =>
                                                                        option.children.toLowerCase().includes(input.toLowerCase())
                                                                    }
                                                                >
                                                                    {organism.map(org => (
                                                                        <Select.Option key={org._id} value={org.taxId}>
                                                                            {org.name}
                                                                        </Select.Option>
                                                                    ))}
                                                                </Select>
                                                            </Form.Item>
                                                            {/*<Form.Item*/}
                                                            {/*    label={"Select Gene ID type"}*/}
                                                            {/*    name={'idType'}*/}
                                                            {/*    rules={[{required: true, message: 'Please select an ID type'}]}*/}
                                                            {/*>*/}
                                                            {/*    <Select />*/}
                                                            {/*</Form.Item>*/}
                                                            <Form.Item
                                                                style={{display: 'flex', justifyContent: 'flex-end'}}>
                                                                <Button type={'primary'}
                                                                        htmlType={'submit'}>Submit</Button>
                                                            </Form.Item>
                                                        </>
                                                    )
                                                }
                                            </Form>
                                        </Spin>
                                    </Modal>
                                    <Button
                                        type="primary"
                                        icon={<DownloadOutlined/>}
                                        onClick={() => AnalysisUtils.exportTable({
                                            tableData,
                                            activeTab
                                        })}
                                    >
                                        Export table
                                    </Button>
                                </Space>
                            )
                        }}
                    />
                </Space>
            )
        }
    ];

    return (
        <Layout>
            <Spin
                spinning={loadingDatabases || loading}
                tip={loading ? "Calculating gene overlaps for selected databases..." : "Loading databases..."}
            >
                <Collapse
                    items={collapseItems}
                    bordered={false}
                    defaultActiveKey={["1"]}
                />
            </Spin>
        </Layout>
    );
};

export default GeneSetAnalysis;
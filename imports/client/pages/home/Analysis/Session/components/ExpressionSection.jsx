import React, {useState, useEffect} from "react";
import {Tracker} from "meteor/tracker";
import {Meteor} from "meteor/meteor";
import {Space, Button, Typography, Table, Upload, Select, Divider, Dropdown, Menu, Spin, Tooltip, Alert} from "antd";
import {UploadOutlined, DownOutlined} from "@ant-design/icons";
import AnalysisUtils from "./AnalysisUtils";
import useMethod from "/imports/client/hooks/useMethod";
import useSubscription from "../../../../../hooks/useSubscription";
import axios from "axios";
import {Random} from "meteor/random";
import {sortOrganismsByName} from "/imports/utils/organismSort";

const {Text} = Typography;
const CHUNK_SIZE = 4 * 1024 * 1024;

export default ({analysisId, inputType, sessionId, exampleType}) => {
    const [state, setState] = useState({
        selectedOrg: null,
        selectedExpressionFile: [],
        selectedGroupFile: [],
        organisms: [],
        user: null,
        inputData: null,
        isUploading: false,
    });
    const [disableUpload, setDisableUpload] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState({ expression: null, group: null });
    const [exampleLoaded, setExampleLoaded] = useState(false);

    const exampleFiles = {
        expression: ['GSE48350-expression', 'GSE5281-expression'],
        group: ['GSE48350-group', 'GSE5281-group']
    };

    // Set up subscriptions
    useSubscription("organism.user.all", {}, []);

    const {isLoading, data, error} = useMethod("analysis.getData", {
        analysisId,
        inputType,
        keys: ['expressionFile', 'groupFile', 'taxId']
    }, [analysisId, inputType]);

    // useEffect(() => {
    //     if (state.inputData) {
    //         setState(prev => ({
    //             ...prev,
    //             isUploading: false,
    //         }))
    //     }
    // }, [state.inputData, state.selectedGroupFile]);
    useEffect(() => {
        if (state.inputData) {
            setState(prev => ({
                ...prev,
                isUploading: false,
            }))
        }
    }, [state.inputData]);

    // Set up reactive computations
    useEffect(() => {
        // Track user
        const userComputation = Tracker.autorun(() => {
            const currentUser = Meteor.user();
            setState(prev => ({...prev, user: currentUser}));
        });

        // Track organisms
        const organismComputation = Tracker.autorun(() => {
            const organisms = sortOrganismsByName(DBCollections.Organism.find({isEnabled: true}).fetch());
            setState(prev => ({...prev, organisms}));
        });

        // Track input data
        const inputDataComputation = Tracker.autorun(() => {
            const inputData = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "input"
            })?.value;
            setState(prev => ({...prev, inputData}));
        });

        // Cleanup computations when component unmounts
        return () => {
            userComputation.stop();
            organismComputation.stop();
            inputDataComputation.stop();
        };
    }, [analysisId, inputType]);

    // Handle initial data load
    useEffect(() => {
        if (data) {
            setDisableUpload(!data.taxId || data.taxId === '');
            setState(prev => ({
                ...prev,
                selectedOrg: data.taxId,
                selectedExpressionFile: data.expressionFile || [],
                selectedGroupFile: data.groupFile || []
            }));
        } else {
            setDisableUpload(true);
        }
    }, [data]);

    // Step 1: Auto-fill organism and upload files when demo loads
    useEffect(() => {
        if (exampleType === 'expression' && !exampleLoaded && state.user && data) {
            const loadFiles = async () => {
                console.log('Step 1: Setting organism to Homo sapiens (9606)...');

                // Set organism in state
                setState(prev => ({...prev, selectedOrg: '9606'}));

                // IMPORTANT: Save taxId to database FIRST before uploading files
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        taxId: '9606'
                    }
                });

                console.log('Step 1: Organism saved. Now uploading files...');

                // Now upload files with taxId already in database
                await handleUseExampleFile(exampleFiles.expression[0], 'expression');
                await handleUseExampleFile(exampleFiles.group[0], 'group');

                setExampleLoaded(true);
                console.log('Step 1 complete: Files uploaded');
            };
            loadFiles();
        }
    }, [exampleType, exampleLoaded, state.user, data]);

    // Step 2: Auto-select Gene ID type when it becomes available
    useEffect(() => {
        if (exampleType !== 'expression' || !exampleLoaded) return;

        const computation = Tracker.autorun(async () => {
            const idTypesConfig = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'idTypes'
            });

            const currentIdType = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'idType'
            });

            // Only auto-select if idTypes exist and idType is not yet set
            if (idTypesConfig?.value && idTypesConfig.value.length > 0 && !currentIdType?.value) {
                console.log('Step 2: Gene ID types detected:', idTypesConfig.value);
                const selectedIdType = idTypesConfig.value[0];
                console.log('Step 2: Auto-selecting ID type:', selectedIdType);

                Tracker.nonreactive(async () => {
                    await AnalysisUtils.updateAnalysis({
                        analysisId, inputType, data: {
                            idType: selectedIdType
                        }
                    });
                    console.log('Step 2 complete: ID type selected');
                });
            }
        });

        return () => computation.stop();
    }, [exampleType, exampleLoaded, analysisId, inputType]);

    // Step 3: Auto-select Control and Condition groups when groupData becomes available
    useEffect(() => {
        if (exampleType !== 'expression' || !exampleLoaded) return;

        const computation = Tracker.autorun(async () => {
            const groupDataConfig = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'groupData'
            });

            const selectedControlSamples = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'selectedControlSamples'
            });

            // Only auto-select if groupData exists and groups are not yet set
            if (groupDataConfig?.value?.data && !selectedControlSamples?.value) {
                const groupData = groupDataConfig.value;
                const controlSamples = Object.keys(groupData.data).filter(
                    sample => groupData.data[sample] === 'c'
                );
                const conditionSamples = Object.keys(groupData.data).filter(
                    sample => groupData.data[sample] === 'd'
                );

                if (controlSamples.length > 0 && conditionSamples.length > 0) {
                    console.log('Step 3: Group data parsed');
                    console.log('Step 3: Control samples (c):', controlSamples);
                    console.log('Step 3: Condition samples (d):', conditionSamples);

                    Tracker.nonreactive(async () => {
                        await AnalysisUtils.updateAnalysis({
                            analysisId, inputType, data: {
                                selectedControlSamples: controlSamples,
                                selectedConditionSamples: conditionSamples
                            }
                        });
                        console.log('Step 3 complete: Sample groups selected');
                    });
                }
            }
        });

        return () => computation.stop();
    }, [exampleType, exampleLoaded, analysisId, inputType]);

    // Step 4: Pre-select pathway databases after groups are set
    useEffect(() => {
        if (exampleType !== 'expression' || !exampleLoaded) return;

        const computation = Tracker.autorun(async () => {
            const selectedControlSamples = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'selectedControlSamples'
            });

            const selectedDatasets = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'selectedDatasets'
            });

            // Only auto-select databases if groups are set and databases are not yet set
            if (selectedControlSamples?.value && selectedControlSamples.value.length > 0 && !selectedDatasets?.value) {
                console.log('Step 4: Groups are set, now selecting pathway databases...');

                Tracker.nonreactive(async () => {
                    const databases = await Meteor.callAsync('database.getAll');

                    const keggDb = databases.find(db => db.name === 'KEGG');

                    const datasetsToSelect = [keggDb?._id].filter(Boolean);

                    if (datasetsToSelect.length > 0) {
                        await AnalysisUtils.updateAnalysis({
                            analysisId, inputType, data: {
                                selectedDatasets: datasetsToSelect
                            }
                        });
                        console.log('Step 4 complete: KEGG database selected');
                    }
                });
            }
        });

        return () => computation.stop();
    }, [exampleType, exampleLoaded, analysisId, inputType]);

    if (isLoading || !state.user) {
        return <Text>Loading...</Text>;
    }

    const filterOption = (input, option) => {
        return option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0;
    };

    const validateFileContent = async (fileContent, fileName = '', validationType) => {
        try {
            setIsValidating(true);
            setValidationResult(prev => ({ ...prev, [validationType]: null }));

            const result = await Meteor.callAsync('data.validate', {
                inputType: validationType,
                fileContent,
                fileName,
                useLLM: true
            });

            setValidationResult(prev => ({ ...prev, [validationType]: result }));
            return result;
        } catch (error) {
            console.error('Validation error:', error);
            notify.error(`Validation failed: ${error.message}`);
            return { valid: false, errors: [error.message] };
        } finally {
            setIsValidating(false);
        }
    };

    const readFileAsText = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    };

    const readFileFirstLines = (file, maxLines = 20) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                const lines = content.split('\n').slice(0, maxLines);
                resolve(lines.join('\n'));
            };
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    };

    const handleUseExampleFile = async (fileName, fileType, taxIdOverride = null) => {
        const session = await DBCollections.Session.findOneAsync(
            {"analyses.id": analysisId}
        );

        if (!session.editable) {
            notify.error("Analysis is in read-only mode");
            return;
        }

        setState(prev => ({...prev, isUploading: true}));

        try {
            // Remove input data at db
            if (fileType === 'expression') {
                await Meteor.asyncCallWithNotification('analysis.removeConfig', {
                    analysisId,
                    inputType,
                    key: 'input'
                })
            }

            const response = await fetch(`/files/${fileName}.csv`);
            const fileContent = await response.text();

            const data = {
                filename: `${fileName}.csv`,
                fileContent: fileContent,
                userId: state.user._id,
                sessionId
            };

            await Meteor.asyncCallWithNotification('file.upload', data);

            // For expression file, just set the file (taxId should already be saved)
            if (fileType === 'expression') {
                console.log('Demo: Setting expression file...');

                // Set expression file - server should auto-detect idTypes
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        expressionFile: `${fileName}.csv`
                    }
                });

                console.log('Demo: Expression file set. Waiting for idType detection...');

                // Wait for server processing
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Check if idTypes detected
                const currentData = await Meteor.callAsync('analysis.getData', {
                    analysisId,
                    inputType,
                    keys: ['idTypes', 'taxId']
                });

                console.log('Demo: Current idTypes after upload:', currentData?.idTypes);
                console.log('Demo: Current taxId:', currentData?.taxId);

                if (!currentData?.idTypes || currentData.idTypes.length === 0) {
                    console.log('Demo: IdTypes not detected, triggering manual detection...');
                    // Get taxId from database
                    const savedTaxId = currentData?.taxId || '9606';
                    // Trigger detection manually by updating taxId again
                    await AnalysisUtils.updateAnalysis({
                        analysisId,
                        inputType,
                        data: {
                            taxId: savedTaxId
                        }
                    });
                    console.log('Demo: Manual idType detection triggered with taxId:', savedTaxId);
                }
            } else {
                // For group file, just update normally
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        groupFile: `${fileName}.csv`
                    }
                });
                setState(prev => ({...prev, isUploading: false}));
            }
        } catch (error) {
            console.error(`Error using example ${fileType} file:`, error);
            notify.error(`Error uploading ${fileType} file`);
            setState(prev => ({...prev, isUploading: false}));
        }
    };

    const handleFileUpload = async (file, fileType) => {
        const session = await DBCollections.Session.findOneAsync(
            {"analyses.id": analysisId}
        );

        if (!session.editable) {
            notify.error("Analysis is in read-only mode");
            return;
        }

        // Require organism selection before file upload
        if (!state.selectedOrg) {
            notify.error("Please select an organism before uploading files");
            return;
        }

        setState(prev => ({...prev, isUploading: true}));

        try {
            // Read only first 20 lines for validation (to avoid "too much recursion" error with large files)
            const fileContentForValidation = await readFileFirstLines(file, 20);
            const validationType = fileType === 'expressionFile' ? 'expression' : 'group';
            const validation = await validateFileContent(fileContentForValidation, file.name, validationType);

            if (!validation.valid) {
                notify.warning(`${fileType === 'expressionFile' ? 'Expression' : 'Group'} file format issues detected - please review`);
                setState(prev => ({...prev, isUploading: false}));
                // Still allow upload but show warnings
            } else {
                notify.success(`${fileType === 'expressionFile' ? 'Expression' : 'Group'} file format is valid!`);
            }

            if (fileType === 'expressionFile') {
                // Remove input data at db
                await Meteor.asyncCallWithNotification('analysis.removeConfig', {
                    analysisId,
                    inputType,
                    key: 'input'
                })
            }

            const formData = new FormData();
            formData.append('file', file);
            const uploaded = await axios.post(`/api/upload?userId=${state.user._id}&sessionId=${sessionId}&fileName=${encodeURIComponent(file.name)}`, formData, {})
            // The upload handler sanitises the filename, so record what the SERVER wrote rather
            // than the local name — otherwise a name needing sanitising is stored under one name
            // and looked up under another when the analysis runs.
            const storedFileName = uploaded?.data?.fileName || file.name;

            // For expression file, update file and taxId separately to ensure taxId is available
            if (fileType === 'expressionFile') {
                console.log('Updating expressionFile with taxId:', state.selectedOrg);

                // First, ensure taxId is saved
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        taxId: state.selectedOrg
                    }
                });

                console.log('TaxId saved. Now uploading expression file...');

                // Then upload the expression file (this should trigger idType detection)
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        expressionFile: storedFileName
                    }
                });

                console.log('Expression file uploaded. Waiting for idType detection...');

                // Wait a bit for server processing
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Check if idTypes were detected, if not trigger detection manually
                const currentData = await Meteor.callAsync('analysis.getData', {
                    analysisId,
                    inputType,
                    keys: ['idTypes']
                });

                console.log('Current idTypes after upload:', currentData?.idTypes);

                if (!currentData?.idTypes || currentData.idTypes.length === 0) {
                    console.log('IdTypes not detected automatically, triggering manual detection...');
                    // Trigger detection by updating taxId again (this will run the else-if block on server)
                    await AnalysisUtils.updateAnalysis({
                        analysisId,
                        inputType,
                        data: {
                            taxId: state.selectedOrg
                        }
                    });
                    console.log('Manual idType detection triggered');
                }
            } else {
                // For group file, just update normally
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        [fileType]: storedFileName
                    }
                });
                console.log('Group file uploaded');
            }
            // if (res) {
            //     console.log('res', res)
            //     setState(prev => ({...prev, isUploading: false}));
            // }
            if (fileType === 'groupFile') {
                setState(prev => ({...prev, isUploading: false}));
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            notify.error("Error uploading file");
            setState(prev => ({...prev, isUploading: false}));
        }
    };

    const handleOrganismChange = async (value) => {
        Tracker.nonreactive(async () => {
            setState(prev => ({...prev, selectedOrg: value}));
            if (value && value !== '') {
                setDisableUpload(false);
                // Save taxId immediately when organism is selected
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        taxId: value
                    }
                });
                console.log('Organism selected, taxId saved:', value);
            } else {
                setDisableUpload(true);
            }
        });
    };

    const expressionMenu = (
        <Menu>
            {exampleFiles.expression.map(file => (
                <Menu.Item key={file} onClick={() => handleUseExampleFile(file, 'expression')}>
                    {file}
                </Menu.Item>
            ))}
        </Menu>
    );

    const groupMenu = (
        <Menu>
            {exampleFiles.group.map(file => (
                <Menu.Item key={file} onClick={() => handleUseExampleFile(file, 'group')}>
                    {file}
                </Menu.Item>
            ))}
        </Menu>
    );

    return (
        <Spin spinning={state.isUploading || isValidating} tip={isValidating ? "Validating..." : "Uploading..."}>
            <Space direction="vertical" size={24} style={{width: '100%', display: 'flex'}}>
                <Alert
                    message="Step 1: Select Organism (Required)"
                    description="Please select the organism for your expression data before uploading files. This is required for gene ID type detection."
                    type={state.selectedOrg ? "success" : "info"}
                    showIcon
                    icon={state.selectedOrg ? <span>✓</span> : undefined}
                />
                <Space direction="horizontal">
                    <Text strong>Select organism:</Text>
                    <Select
                        showSearch
                        placeholder="Search for organisms"
                        filterOption={filterOption}
                        style={{width: 300}}
                        onChange={handleOrganismChange}
                        value={state.selectedOrg}
                    >
                        {state.organisms.map((organism) => (
                            <Select.Option value={organism.taxId} key={organism._id}>
                                {organism.name}
                            </Select.Option>
                        ))}
                        <Select.Option key={null} value={null}>Other</Select.Option>
                    </Select>
                    {state.selectedOrg && (
                        <Text type="success" strong>✓ Organism selected</Text>
                    )}
                </Space>

                {state.selectedOrg && (
                    <Alert
                        message="Step 2: Upload Expression and Group Files"
                        description="Organism selected. Now you can upload your expression data and group assignment files."
                        type="info"
                        showIcon
                    />
                )}

                {validationResult.expression && (
                    <Alert
                        message={validationResult.expression.valid ? "✅ Expression File Format Valid" : "⚠️ Expression File Format Issues Detected"}
                        description={
                            <Space direction="vertical" style={{width: '100%'}}>
                                {validationResult.expression.detectedFormat && (
                                    <Text><strong>Detected Format:</strong> {validationResult.expression.detectedFormat}</Text>
                                )}
                                {validationResult.expression.errors && validationResult.expression.errors.length > 0 && (
                                    <div>
                                        <Text strong>Errors:</Text>
                                        <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                            {validationResult.expression.errors.map((error, i) => (
                                                <li key={i}><Text type="danger">{error}</Text></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {validationResult.expression.suggestions && validationResult.expression.suggestions.length > 0 && (
                                    <div>
                                        <Text strong>Suggestions:</Text>
                                        <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                            {validationResult.expression.suggestions.map((suggestion, i) => (
                                                <li key={i}><Text>{suggestion}</Text></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <Text type="secondary">Confidence: {validationResult.expression.confidence}</Text>
                            </Space>
                        }
                        type={validationResult.expression.valid ? "success" : "warning"}
                        closable={true}
                        onClose={() => setValidationResult(prev => ({ ...prev, expression: null }))}
                        style={{marginBottom: 16}}
                    />
                )}

                {validationResult.group && (
                    <Alert
                        message={validationResult.group.valid ? "✅ Group File Format Valid" : "⚠️ Group File Format Issues Detected"}
                        description={
                            <Space direction="vertical" style={{width: '100%'}}>
                                {validationResult.group.detectedFormat && (
                                    <Text><strong>Detected Format:</strong> {validationResult.group.detectedFormat}</Text>
                                )}
                                {validationResult.group.errors && validationResult.group.errors.length > 0 && (
                                    <div>
                                        <Text strong>Errors:</Text>
                                        <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                            {validationResult.group.errors.map((error, i) => (
                                                <li key={i}><Text type="danger">{error}</Text></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {validationResult.group.suggestions && validationResult.group.suggestions.length > 0 && (
                                    <div>
                                        <Text strong>Suggestions:</Text>
                                        <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                            {validationResult.group.suggestions.map((suggestion, i) => (
                                                <li key={i}><Text>{suggestion}</Text></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <Text type="secondary">Confidence: {validationResult.group.confidence}</Text>
                            </Space>
                        }
                        type={validationResult.group.valid ? "success" : "warning"}
                        closable={true}
                        onClose={() => setValidationResult(prev => ({ ...prev, group: null }))}
                        style={{marginBottom: 16}}
                    />
                )}

                <Space direction="horizontal" align="center" style={{width: '100%'}}>
                    <Tooltip
                        title={disableUpload ? "Please select an organism first" : ""}
                        placement={"bottom"}
                    >
                        <Upload
                            accept=".csv"
                            showUploadList={false}
                            beforeUpload={(file) => handleFileUpload(file, 'expressionFile')}
                        >
                            <Button disabled={disableUpload} icon={<UploadOutlined/>}>Select expression file</Button>
                        </Upload>
                    </Tooltip>
                    <Tooltip
                        title={disableUpload ? "Please select an organism first" : ""}
                        placement={"bottom"}
                    >
                        <Upload
                            accept=".csv"
                            showUploadList={false}
                            beforeUpload={(file) => handleFileUpload(file, 'groupFile')}
                        >
                            <Button disabled={disableUpload} icon={<UploadOutlined/>}>Select group file</Button>
                        </Upload>
                    </Tooltip>
                    <Divider type="vertical" style={{height: '24px', margin: '0 16px'}}/>
                    <Text strong>OR</Text>
                    <Divider type="vertical" style={{height: '24px', margin: '0 16px'}}/>
                    <Dropdown overlay={expressionMenu} placement="bottomCenter">
                        <Tooltip
                            title={disableUpload ? "Please select an organism first" : ""}
                            placement={"bottom"}
                        >
                            <Button disabled={disableUpload}>
                                Use our expression file <DownOutlined/>
                            </Button>
                        </Tooltip>
                    </Dropdown>
                    <Dropdown overlay={groupMenu} placement="bottomCenter">
                        <Tooltip
                            title={disableUpload ? "Please select an organism first" : ""}
                            placement={"bottom"}
                        >
                            <Button disabled={disableUpload}>
                                Use our group file <DownOutlined/>
                            </Button>
                        </Tooltip>
                    </Dropdown>
                </Space>

                {state.inputData && (
                    <Table
                        dataSource={state.inputData.data}
                        rowKey="id"
                        columns={[
                            {
                                title: "Id",
                                dataIndex: "id",
                                fixed: "left",
                                width: 125
                            },
                            ...(state.inputData?.samples?.map(column => ({
                                title: column,
                                dataIndex: column,
                                width: 125
                            })) || [])
                        ]}
                        size="small"
                        scroll={{x: 1500, y: 300}}
                        pagination={false}
                    />
                )}
            </Space>
        </Spin>
    );
};
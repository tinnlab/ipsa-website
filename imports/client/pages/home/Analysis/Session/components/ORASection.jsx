import React, {useEffect, useState} from "react";
import Text from "antd/lib/typography/Text";
import Row from "antd/lib/grid/row";
import Col from "antd/lib/grid/col";
import Input from "antd/lib/input/Input";
import Button from "antd/lib/button";
import Space from "antd/lib/space";
import Upload from "antd/lib/upload";
import UploadOutlined from "@ant-design/icons/UploadOutlined";
import example from "./example";
import _ from "lodash";
import Form from "antd/lib/form/Form";
import AnalysisUtils from "./AnalysisUtils";
import useMethod from "/imports/client/hooks/useMethod";
import Select from "antd/lib/select";
import useSubscription from "../../../../../hooks/useSubscription";
import {useTracker} from "meteor/react-meteor-data";
import {Alert} from "antd";
import {sortOrganismsByName} from "/imports/utils/organismSort";

export default ({ analysisId, inputType, exampleType }) => {
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState({ input: null, background: null });
    const [exampleLoaded, setExampleLoaded] = useState(false);
    const [form] = Form.useForm();
    const { isLoading, data, error } = useMethod("analysis.getData", { analysisId, inputType, keys: ['input', 'background', 'taxId'] }, [analysisId]);

    useSubscription("organism.user.all", {}, []);

    let organisms = useTracker(() => {
        let organisms = sortOrganismsByName(DBCollections.Organism.find({ isEnabled: true }).fetch())
        return organisms;
    }, []);

    const setFormFields = (data) => {
        form.setFieldsValue({
            ...data
        });
    }

    useEffect(() => {
        setSelectedOrg(data?.taxId);
    }, [data]);

    useEffect(() => {
        if (data) {
            form.resetFields();
            setFormFields(data);
        }
    }, [data]);

    // Auto-fill example if exampleType is 'ora'
    useEffect(() => {
        if (exampleType === 'ora' && !exampleLoaded && data) {
            const loadDemo = async () => {
                // Set input data
                form.setFieldsValue({
                    input: example.ORA
                });

                // Set organism to Homo sapiens (9606)
                setSelectedOrg('9606');

                await AnalysisUtils.updateAnalysis({
                    analysisId, inputType, data: {
                        input: example.ORA,
                        taxId: '9606'
                    }
                });

                // Pre-select KEGG, GO (all namespaces), and Reactome databases
                const databases = await Meteor.callAsync('database.getAll');
                console.log('Available databases:', databases);

                const keggDb = databases.find(db => db.name === 'KEGG');
                const goDbs = databases.filter(db => db.name === 'GO'); // All GO namespaces
                const reactomeDb = databases.find(db => db.name === 'Reactome');

                const selectedDatasets = [
                    keggDb?._id,
                    ...goDbs.map(db => db._id),
                    reactomeDb?._id
                ].filter(Boolean);

                console.log('Selected datasets:', selectedDatasets);

                if (selectedDatasets.length > 0) {
                    await AnalysisUtils.updateAnalysis({
                        analysisId, inputType, data: {
                            selectedDatasets
                        }
                    });
                }

                setExampleLoaded(true);
            };

            loadDemo();
        }
    }, [exampleType, exampleLoaded, data, analysisId, inputType, form]);

    if (isLoading) {
        return <Text>Loading...</Text>
    }
    if (error) {
        return <Text>{error.reason}</Text>
    }

    // Custom filter function for case-insensitive search
    const filterOption = (input, option) => {
        return option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0;
    };

    const validateFileContent = async (fileContent, fileName = '', fieldType = 'input') => {
        try {
            setIsValidating(true);
            setValidationResult(prev => ({ ...prev, [fieldType]: null }));

            const result = await Meteor.callAsync('data.validate', {
                inputType: 'ora',
                fileContent,
                fileName,
                useLLM: true
            });

            setValidationResult(prev => ({ ...prev, [fieldType]: result }));
            return result;
        } catch (error) {
            console.error('Validation error:', error);
            notify.error(`Validation failed: ${error.message}`);
            return { valid: false, errors: [error.message] };
        } finally {
            setIsValidating(false);
        }
    };

    const handleManualValidation = async (fieldType = 'input') => {
        const content = form.getFieldValue(fieldType);
        if (!content || content.trim().length === 0) {
            notify.warning('Please enter some data to validate');
            return;
        }
        await validateFileContent(content, `manual-${fieldType}`, fieldType);
    };

    const handleBlur = (fieldType) => _.debounce(async (e) => {
        const content = e.target.value;
        if (content && content.trim().length > 10) {
            await validateFileContent(content, `manual-${fieldType}`, fieldType);
        }
    }, 1000);

    const handlePaste = (fieldType) => async (e) => {
        setTimeout(async () => {
            const content = form.getFieldValue(fieldType);
            if (content && content.trim().length > 0) {
                await validateFileContent(content, `pasted-${fieldType}`, fieldType);
            }
        }, 100);
    };

    return (
        <>
            <Form form={form}
                  layout="vertical"
            >
                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        {validationResult.input && (
                            <Alert
                                message={validationResult.input.valid ? "✅ Input Gene List Format Valid" : "⚠️ Input Gene List Format Issues Detected"}
                                description={
                                    <Space direction="vertical" style={{width: '100%'}}>
                                        {validationResult.input.detectedFormat && (
                                            <Text><strong>Detected Format:</strong> {validationResult.input.detectedFormat}</Text>
                                        )}
                                        {validationResult.input.errors && validationResult.input.errors.length > 0 && (
                                            <div>
                                                <Text strong>Errors:</Text>
                                                <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                                    {validationResult.input.errors.map((error, i) => (
                                                        <li key={i}><Text type="danger">{error}</Text></li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {validationResult.input.suggestions && validationResult.input.suggestions.length > 0 && (
                                            <div>
                                                <Text strong>Suggestions:</Text>
                                                <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                                    {validationResult.input.suggestions.map((suggestion, i) => (
                                                        <li key={i}><Text>{suggestion}</Text></li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        <Text type="secondary">Confidence: {validationResult.input.confidence}</Text>
                                    </Space>
                                }
                                type={validationResult.input.valid ? "success" : "warning"}
                                closable={true}
                                onClose={() => setValidationResult(prev => ({ ...prev, input: null }))}
                                style={{marginBottom: 16}}
                            />
                        )}
                        <Form.Item
                            colon={false}
                            name="input"
                            label={
                                <Space direction="vertical" size="small">
                                    <Space direction="horizontal">
                                        <Text>Input gene list or</Text>
                                        <Upload accept={'.txt'}
                                                showUploadList={false}
                                                beforeUpload={async (file) => {
                                                    const session = await DBCollections.Session.findOneAsync(
                                                        { "analyses.id": analysisId }
                                                    );
                                                    if (session.editable) {
                                                        let fileContent = await AnalysisUtils.readFile(file);

                                                        // Validate file content with LLM
                                                        const validation = await validateFileContent(fileContent, file.name, 'input');

                                                        // Always set the content, but show validation result
                                                        form.setFieldsValue({
                                                            input: fileContent
                                                        });

                                                        if (validation.valid) {
                                                            notify.success('File format is valid!');
                                                            AnalysisUtils.updateAnalysis({
                                                                analysisId, inputType, data: {
                                                                    input: fileContent
                                                                }
                                                            });
                                                        } else {
                                                            notify.warning('File format issues detected - please review');
                                                        }
                                                    } else {
                                                        notify.error("Analysis is on read-only mode")
                                                    }
                                                }}>
                                            <Button icon={<UploadOutlined />} loading={isValidating}>
                                                {isValidating ? 'Validating...' : 'Select a file'}
                                            </Button>
                                        </Upload>
                                        <Text>or</Text>
                                        <Button onClick={async () => {
                                            const session = await DBCollections.Session.findOneAsync(
                                                { "analyses.id": analysisId }
                                            );
                                            if (session.editable) {
                                                // update db
                                                form.setFieldsValue({
                                                    input: example.ORA
                                                });
                                                AnalysisUtils.updateAnalysis({
                                                    analysisId, inputType, data: {
                                                        input: example.ORA
                                                    }
                                                });
                                                setValidationResult(prev => ({ ...prev, input: null }));
                                            } else {
                                                notify.error("Analysis is on read-only mode")
                                            }
                                        }}>Use our example</Button>
                                    </Space>
                                    <Button onClick={() => handleManualValidation('input')} loading={isValidating} type="default">
                                        Validate Input Data
                                    </Button>
                                </Space>
                            }
                        >
                            <Input.TextArea
                                rows={10}
                                onBlur={handleBlur('input')}
                                onPaste={handlePaste('input')}
                                onChange={async (e) => {
                                    AnalysisUtils.updateAnalysis({
                                        analysisId, inputType, data: {
                                            input: e.target.value,
                                        }
                                    });
                                }}
                            />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        {validationResult.background && (
                            <Alert
                                message={validationResult.background.valid ? "✅ Background Gene List Format Valid" : "⚠️ Background Gene List Format Issues Detected"}
                                description={
                                    <Space direction="vertical" style={{width: '100%'}}>
                                        {validationResult.background.detectedFormat && (
                                            <Text><strong>Detected Format:</strong> {validationResult.background.detectedFormat}</Text>
                                        )}
                                        {validationResult.background.errors && validationResult.background.errors.length > 0 && (
                                            <div>
                                                <Text strong>Errors:</Text>
                                                <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                                    {validationResult.background.errors.map((error, i) => (
                                                        <li key={i}><Text type="danger">{error}</Text></li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {validationResult.background.suggestions && validationResult.background.suggestions.length > 0 && (
                                            <div>
                                                <Text strong>Suggestions:</Text>
                                                <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                                    {validationResult.background.suggestions.map((suggestion, i) => (
                                                        <li key={i}><Text>{suggestion}</Text></li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        <Text type="secondary">Confidence: {validationResult.background.confidence}</Text>
                                    </Space>
                                }
                                type={validationResult.background.valid ? "success" : "warning"}
                                closable={true}
                                onClose={() => setValidationResult(prev => ({ ...prev, background: null }))}
                                style={{marginBottom: 16}}
                            />
                        )}
                        <Form.Item
                            name="background"
                            colon={false}
                            label={
                                <Space direction="vertical" size="small">
                                    <Space direction="horizontal">
                                        <Text>Input background or</Text>
                                        <Upload accept={'.txt'}
                                                showUploadList={false}
                                                beforeUpload={async (file) => {
                                                    const session = await DBCollections.Session.findOneAsync(
                                                        { "analyses.id": analysisId }
                                                    );
                                                    if (session.editable) {
                                                        let fileContent = await AnalysisUtils.readFile(file);

                                                        // Validate file content with LLM
                                                        const validation = await validateFileContent(fileContent, file.name, 'background');

                                                        // Always set the content, but show validation result
                                                        form.setFieldsValue({
                                                            background: fileContent
                                                        });

                                                        if (validation.valid) {
                                                            notify.success('Background file format is valid!');
                                                            AnalysisUtils.updateAnalysis({
                                                                analysisId, inputType, data: {
                                                                    background: fileContent
                                                                }
                                                            });
                                                        } else {
                                                            notify.warning('Background file format issues detected - please review');
                                                        }
                                                    } else {
                                                        notify.error("Analysis is on read-only mode")
                                                    }
                                                }}>
                                            <Button icon={<UploadOutlined />} loading={isValidating}>
                                                {isValidating ? 'Validating...' : 'Select a file'}
                                            </Button>
                                        </Upload>
                                        <Text>or</Text>
                                        <Button onClick={async () => {
                                            const session = await DBCollections.Session.findOneAsync(
                                                { "analyses.id": analysisId }
                                            );
                                            if (session.editable) {
                                                form.setFieldsValue({
                                                    background: example.ORABackground
                                                });
                                                AnalysisUtils.updateAnalysis({
                                                    analysisId, inputType, data: {
                                                        background: example.ORABackground
                                                    }
                                                });
                                                setValidationResult(prev => ({ ...prev, background: null }));
                                            } else {
                                                notify.error("Analysis is on read-only mode")
                                            }
                                        }}>Use our example</Button>
                                    </Space>
                                    <Button onClick={() => handleManualValidation('background')} loading={isValidating} type="default">
                                        Validate Background Data
                                    </Button>
                                </Space>
                            }
                        >
                            <Input.TextArea
                                placeholder={`Background gene list is optional. If no background is provided, all genes in selected pathways are used as background.`}
                                rows={10}
                                onBlur={handleBlur('background')}
                                onPaste={handlePaste('background')}
                                onChange={async (e) => {
                                    AnalysisUtils.updateAnalysis({
                                        analysisId, inputType, data: {
                                            background: e.target.value,
                                        }
                                    });
                                }}
                            />
                        </Form.Item>
                    </Col>
                </Row >
            </Form >
            <Space direction="horizontal">
                <Text>Select organism:</Text>
                <Select showSearch
                        placeholder={"Search for organisms"}
                        filterOption={filterOption}
                        style={{ width: 300 }}
                        onChange={async (value) => {
                            setSelectedOrg(value);
                            let data = await AnalysisUtils.updateAnalysis({
                                analysisId, inputType, data: {
                                    taxId: value
                                }
                            })
                        }}
                        value={selectedOrg}
                >
                    {
                        organisms?.map((organism, index) => {
                            return <Select.Option value={organism.taxId} key={organism._id}>{organism.name}</Select.Option>
                        })
                    }
                    <Select.Option key={null} value={null}>Other</Select.Option>
                </Select>
            </Space>
        </>
    )
}
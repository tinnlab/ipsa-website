import React, {useEffect, useState} from "react";
import Text from "antd/lib/typography/Text";
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
import useSubscription from "../../../../../hooks/useSubscription";
import {useTracker} from "meteor/react-meteor-data";
import Select from "antd/lib/select";
import {Alert, Divider, Card} from "antd";
import {sortOrganismsByName} from "/imports/utils/organismSort";


export default ({analysisId, inputType, exampleType}) => {
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState(null);
    const [exampleLoaded, setExampleLoaded] = useState(false);
    const [form] = Form.useForm();
    const {isLoading, data, error} = useMethod("analysis.getData", {
        analysisId,
        inputType,
        keys: ['input', 'taxId']
    }, [analysisId, inputType]);

    useSubscription("organism.user.all", {}, []);

    let organisms = useTracker(() => {
        let organisms = sortOrganismsByName(DBCollections.Organism.find({isEnabled: true}).fetch())
        return organisms;
    }, []);

    const setFormFields = (data) => {
        form.setFieldsValue({
            ...data
        });
    }

    useEffect(() => {
        setSelectedOrg(data?.taxId);

        if (data) {
            form.resetFields();
            setFormFields(data);
        }
    }, [data]);

    // Auto-fill example if exampleType is 'pgsea'
    useEffect(() => {
        if (exampleType === 'pgsea' && !exampleLoaded && data) {
            const loadDemo = async () => {
                const exampleContent = example.PGSEA_2COL;

                // Set input data
                form.setFieldsValue({
                    input: exampleContent
                });

                // Set organism to Homo sapiens (9606)
                setSelectedOrg('9606');

                await AnalysisUtils.updateAnalysis({
                    analysisId, inputType, data: {
                        input: exampleContent,
                        taxId: '9606'
                    }
                });

                // Pre-select KEGG, GO (all namespaces), and Reactome databases
                const databases = await Meteor.callAsync('database.getAll');

                const keggDb = databases.find(db => db.name === 'KEGG');
                const goDbs = databases.filter(db => db.name === 'GO'); // All GO namespaces
                const reactomeDb = databases.find(db => db.name === 'Reactome');

                const selectedDatasets = [
                    keggDb?._id,
                    ...goDbs.map(db => db._id),
                    reactomeDb?._id
                ].filter(Boolean);

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

    const filterOption = (input, option) => {
        return option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0;
    };

    const validateFileContent = async (fileContent, fileName = '') => {
        try {
            setIsValidating(true);
            setValidationResult(null);

            const result = await Meteor.callAsync('data.validate', {
                inputType: 'pgsea',
                fileContent,
                fileName,
                useLLM: true
            });

            setValidationResult(result);
            return result;
        } catch (error) {
            console.error('Validation error:', error);
            notify.error(`Validation failed: ${error.message}`);
            return { valid: false, errors: [error.message] };
        } finally {
            setIsValidating(false);
        }
    };

    const handleUseExample = async () => {
        const session = await DBCollections.Session.findOneAsync(
            {"analyses.id": analysisId}
        );
        if (session.editable) {
            const exampleContent = example.PGSEA_2COL;
            form.setFieldsValue({
                input: exampleContent
            });
            await AnalysisUtils.updateAnalysis({
                analysisId, inputType, data: {
                    input: exampleContent
                }
            });
            setValidationResult(null); // Clear validation when using example
        } else {
            notify.error("Analysis is on read-only mode")
        }
    };

    const handleManualValidation = async () => {
        const content = form.getFieldValue('input');
        if (!content || content.trim().length === 0) {
            notify.warning('Please enter some data to validate');
            return;
        }
        await validateFileContent(content, 'manual-input');
    };

    const handleBlur = _.debounce(async (e) => {
        const content = e.target.value;
        if (content && content.trim().length > 10) {
            await validateFileContent(content, 'manual-input');
        }
    }, 1000);

    const handlePaste = async (e) => {
        // Wait for paste to complete and form to update
        setTimeout(async () => {
            const content = form.getFieldValue('input');
            if (content && content.trim().length > 0) {
                await validateFileContent(content, 'pasted-data');
            }
        }, 100);
    };


    return (
        <Space direction={'vertical'} style={{width: '100%'}}>
            {/* STEP 1: Select Organism First */}
            <Card
                title={<Text strong style={{fontSize: 16}}>Step 1: Select Organism</Text>}
                size="small"
                style={{backgroundColor: '#f0f5ff'}}
            >
                <Space direction="vertical" size="small" style={{width: '100%'}}>
                    <Text type="secondary">
                        Select the organism for your gene data. This is required for gene ID mapping and analysis.
                    </Text>
                    <Space direction="horizontal" size="middle">
                        <Text strong>Organism:</Text>
                        <Select
                            showSearch
                            placeholder="Search for organisms"
                            filterOption={filterOption}
                            style={{width: 300}}
                            onChange={async (value) => {
                                setSelectedOrg(value);
                                await AnalysisUtils.updateAnalysis({
                                    analysisId, inputType, data: {
                                        taxId: value
                                    }
                                })
                            }}
                            value={selectedOrg}
                        >
                            {organisms?.map((organism, index) => (
                                <Select.Option value={organism.taxId} key={organism._id}>
                                    {organism.name}
                                </Select.Option>
                            ))}
                            <Select.Option key={null} value={null}>Other</Select.Option>
                        </Select>
                        {selectedOrg && (
                            <Text type="success" strong>✓ Selected</Text>
                        )}
                    </Space>
                </Space>
            </Card>

            <Divider style={{margin: '16px 0'}} />

            {/* STEP 2: Input Data */}
            <Text strong style={{fontSize: 16, display: 'block', marginBottom: 8}}>
                Step 2: Input Ranked Gene List
            </Text>
            <Alert
                message="Input file format"
                description="2 columns, tab-separated, NO header. First column: Gene identifier. Second column: Statistical value (fold-change, p-value, or any ranking metric)."
                type="info"
                closable={true}
            />
            {validationResult && (
                <Alert
                    message={validationResult.valid ? "✅ File Format Valid" : "⚠️ File Format Issues Detected"}
                    description={
                        <Space direction="vertical" style={{width: '100%'}}>
                            {validationResult.detectedFormat && (
                                <Text><strong>Detected Format:</strong> {validationResult.detectedFormat}</Text>
                            )}
                            {validationResult.errors && validationResult.errors.length > 0 && (
                                <div>
                                    <Text strong>Errors:</Text>
                                    <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                        {validationResult.errors.map((error, i) => (
                                            <li key={i}><Text type="danger">{error}</Text></li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {validationResult.suggestions && validationResult.suggestions.length > 0 && (
                                <div>
                                    <Text strong>Suggestions:</Text>
                                    <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                        {validationResult.suggestions.map((suggestion, i) => (
                                            <li key={i}><Text>{suggestion}</Text></li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <Text type="secondary">Confidence: {validationResult.confidence}</Text>
                        </Space>
                    }
                    type={validationResult.valid ? "success" : "warning"}
                    closable={true}
                    onClose={() => setValidationResult(null)}
                    style={{marginBottom: 16}}
                />
            )}
            <Form form={form}
                  layout="vertical"
                    onValuesChange={async (changedValues, allValues) => {
                        if (Object.keys(changedValues).includes('input')) {
                            await AnalysisUtils.updateAnalysis({
                                analysisId, inputType, data: {
                                    input: changedValues?.input
                                }
                            })
                        }
                    }}
            >
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
                                                {"analyses.id": analysisId}
                                            );
                                            if (session.editable) {
                                                let fileContent = await AnalysisUtils.readFile(file);

                                                // Validate file content with LLM
                                                const validation = await validateFileContent(fileContent, file.name);

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
                                    <Button icon={<UploadOutlined/>} loading={isValidating}>
                                        {isValidating ? 'Validating...' : 'Select a file'}
                                    </Button>
                                </Upload>
                                <Text>or</Text>
                                <Button onClick={handleUseExample}>
                                    Use example
                                </Button>
                            </Space>
                            <Button onClick={handleManualValidation} loading={isValidating} type="default">
                                Validate Data
                            </Button>
                        </Space>
                    }
                    rules={[
                        () => ({
                            validator(_, value) {
                                if (!value || value.trim().length === 0) {
                                    return Promise.reject('Please provide input data');
                                }

                                const lines = value.trim().split("\n").filter(line => line.trim().length > 0);
                                if (lines.length < 1) {
                                    return Promise.reject('Input must contain at least one gene');
                                }

                                // Check each line has exactly 2 columns
                                for (let i = 0; i < Math.min(lines.length, 5); i++) {
                                    const columns = lines[i].split("\t");
                                    if (columns.length !== 2) {
                                        return Promise.reject(`Line ${i + 1} must have exactly 2 tab-separated columns. Found ${columns.length} columns.`);
                                    }

                                    // Check second column is numeric
                                    const statValue = parseFloat(columns[1].trim());
                                    if (isNaN(statValue)) {
                                        return Promise.reject(`Line ${i + 1}: Second column must be a numeric value. Found: "${columns[1].trim()}"`);
                                    }
                                }

                                return Promise.resolve();
                            }
                        })
                    ]}
                >
                    <Input.TextArea
                        rows={10}
                        onBlur={handleBlur}
                        onPaste={handlePaste}
                        onChange={async (e) => {
                            AnalysisUtils.updateAnalysis({
                                analysisId, inputType, data: {
                                    input: e.target.value
                                }
                            });
                        }}
                    />
                </Form.Item>
            </Form>
        </Space>
    )
}
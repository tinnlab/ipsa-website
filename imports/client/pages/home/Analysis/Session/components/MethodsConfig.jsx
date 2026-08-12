import React, {useState, useEffect, useMemo, useCallback} from "react";
import _ from "lodash";
import useMethod from "../../../../../hooks/useMethod";
import {
    Layout,
    Collapse,
    Tabs,
    Space,
    Typography,
    Form,
    Checkbox,
    InputNumber,
    Tooltip,
    Select,
    Button
} from "antd";
import {QuestionCircleOutlined} from "@ant-design/icons";
import MethodSettings from "../../../../../../methods/settings";
import AnalysisUtils from "./AnalysisUtils";
import useSubscription from "/imports/client/hooks/useSubscription";
import {useTracker} from "meteor/react-meteor-data";
import ReactEcharts from "echarts-for-react";
import {Tracker} from "meteor/tracker";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";


const {Title, Paragraph, Text} = Typography;

const MethodConfig = ({analysisId, inputType}) => {
    // Get global settings
    const { globalSettings } = useGlobalSettings();

    const [methodSettings, setMethodSettings] = useState({});
    const [isUpdatingVolcano, setIsUpdatingVolcano] = useState(false);
    const supportedMethods = Object.entries(MethodSettings.getSupportedMethods(inputType));
    const [deParams, setDeParams] = useState({
        maxAdjustedPValue: globalSettings.pValueFDR,
        minLogFoldChange: globalSettings.foldChange,
    })

    useSubscription("analysis.config", {
        analysisId,
        inputType,
        keys: ["volcanoPlotData", "maxAdjustedPValue", "minLogFoldChange", "methodSettings"]
    }, [inputType, analysisId]);

    const {isLoading, data, error} = useMethod(
        "analysis.getData",
        {analysisId, inputType, keys: ['methodSettings']},
        [analysisId, inputType]
    );

    const volcanoPlotData = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: "volcanoPlotData"
        })?.value;
    }, [inputType, analysisId]);

    const methodSettingsData = useTracker(() => {
        const tmp = DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'methodSettings'
        })?.value ?? []

        return {
            methodSettings: tmp
        }
    }, [inputType, analysisId]);

    const checkMethodSettings = useCallback(async () => {
        const res = await Meteor.callAsync("analysis.getData", {
            analysisId,
            inputType,
            keys: ['methodSettings']
        })

        // If no method settings are found, initialize with default settings
        if (!res || !res.methodSettings) {
            const mSettings = {
                ...supportedMethods.reduce((acc, [methodName, method]) => {
                    acc[methodName] = Object.entries(method.parameters).reduce((acc, [parameterName, parameter]) => {
                        acc[parameterName] = parameter.value
                        return acc;
                    }, {});
                    return acc;
                }, {})
            }
            if (deParams) {
                mSettings.ora = {
                    ...mSettings.ora,
                    pThreshold: deParams.maxAdjustedPValue,
                    fcThreshold: deParams.minLogFoldChange
                }
            }
            setMethodSettings(mSettings);
            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {
                    methodSettings: mSettings
                }
            });
        }
    }, [analysisId, inputType])

    useEffect(() => {

    }, [inputType])

    useEffect(() => {
    }, [methodSettingsData]);

    useEffect(() => {
        const deParamsComputation = Tracker.autorun(() => {
            const newMaxAdjustedPValue = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "maxAdjustedPValue"
            })?.value
            const newMinLogFoldChange = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "minLogFoldChange"
            })?.value
            if (newMaxAdjustedPValue === undefined || newMinLogFoldChange === undefined) return;
            setDeParams({
                ...deParams,
                maxAdjustedPValue: newMaxAdjustedPValue ?? deParams.maxAdjustedPValue,
                minLogFoldChange: newMinLogFoldChange ?? deParams.minLogFoldChange
            })
        })

        return () => deParamsComputation.stop()
    }, [analysisId, inputType])

    useEffect(() => {
        checkMethodSettings()
    }, [analysisId, inputType]);

    useEffect(() => {
        if (!methodSettingsData || Object.keys(methodSettingsData.methodSettings).length < 1) return;
        // Remove gsea from saved settings
        const {gsea: _, ...rest} = methodSettingsData?.methodSettings ?? {};
        const mSettings = {
            ...supportedMethods.reduce((acc, [methodName, method]) => {
                acc[methodName] = Object.entries(method.parameters).reduce((acc, [parameterName, parameter]) => {
                    acc[parameterName] = parameter.value
                    return acc;
                }, {});
                return acc;
            }, {}),
            ...rest,
        }
        if (deParams) {
            mSettings.ora = {
                ...mSettings.ora,
                pThreshold: deParams.maxAdjustedPValue,
                fcThreshold: deParams.minLogFoldChange
            }
        }

        if (inputType !== 'ora') {
            if (Object.entries(mSettings).filter(([methodKey, method]) => methodKey !== 'consensus' && method.enabled).length < 2) {
                mSettings.consensus = {
                    ...mSettings.consensus,
                    enabled: false,
                    methods: []
                }
            } else {
                mSettings.consensus = {
                    ...mSettings.consensus,
                    enabled: mSettings.consensus.enabled || Object.keys(mSettings).filter(key => key !== 'consensus' && mSettings[key].enabled).length > 0 || false,
                    methods: methodSettingsData.methodSettings.consensus?.methods?.length > 0 ?
                        Object.keys(mSettings).filter(
                            key => key !== 'consensus' &&
                                methodSettingsData.methodSettings.consensus.methods.includes(key) &&
                                mSettings[key].enabled
                        ) :
                        Object.keys(mSettings).filter(key => key !== 'consensus' && mSettings[key].enabled)
                }
            }
        }
        setMethodSettings(mSettings);

        AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                methodSettings: mSettings
            }
        });
    }, [methodSettingsData, deParams]);

    const debounceUpdateMethodSettings = _.debounce(({methodKey, parameterName, value, newMethodSettings}) => {
        console.log("Debounced update", methodKey, parameterName, value);
        AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                methodSettings: newMethodSettings
            }
        });

        if (methodKey === "ora" && (parameterName === "pThreshold" || parameterName === "fcThreshold")) {
            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {
                    ...(parameterName === "pThreshold" ? {maxAdjustedPValue: value} : {}),
                    ...(parameterName === "fcThreshold" ? {minLogFoldChange: value} : {})
                }
            })
        }
    }, 1500)

    const updateMethodSettings = ({methodKey, parameterName, value}) => {
        methodSettings[methodKey][parameterName] = value;
        const newMethodSettings = {...methodSettings};
        if (inputType !== 'ora') {
            if (Object.entries(newMethodSettings).filter(([key, method]) => key !== 'consensus' && method.enabled).length < 2) {
                newMethodSettings.consensus.enabled = false;
                newMethodSettings.consensus.methods = [];
            } else {
                newMethodSettings.consensus.enabled = newMethodSettings.consensus.enabled || true;
                if (parameterName === 'enabled' && !value) {
                    if (newMethodSettings.consensus.methods.includes(methodKey)) {
                        newMethodSettings.consensus.methods = newMethodSettings.consensus.methods.filter(method => method !== methodKey)
                    }
                } else {
                    newMethodSettings.consensus.methods = Object.keys(newMethodSettings).filter(key => key !== 'consensus' && newMethodSettings[key].enabled);
                }
            }
        }
        setMethodSettings(newMethodSettings);
        AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                methodSettings: newMethodSettings
            }
        });

        if (methodKey === "ora" && (parameterName === "pThreshold" || parameterName === "fcThreshold")) {
            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {
                    ...(parameterName === "pThreshold" ? {maxAdjustedPValue: value} : {}),
                    ...(parameterName === "fcThreshold" ? {minLogFoldChange: value} : {})
                }
            })
        }
    };

    const tabItems = useMemo(() =>
            supportedMethods.map(([methodKey, method], index) => {
                if (methodSettings[methodKey] === undefined) return null;

                if (methodKey === 'consensus' && Object.keys(methodSettings).length > 0 && Object.entries(methodSettings).filter(([methodKey, method]) => methodKey !== 'consensus' && method.enabled).length < 2) {
                    return null
                }

                return {
                    key: `${index}-${methodKey}`,
                    label: (
                        <Text style={{
                            fontWeight: methodSettings[methodKey]?.enabled ? '#2b7a37' : undefined,
                            color: methodSettings[methodKey]?.enabled ? '#2b7a37' : undefined
                        }}>
                            <Checkbox
                                checked={methodSettings[methodKey]?.enabled}
                                onChange={() => {
                                    if (method.parameters.enabled.mutable) {
                                        updateMethodSettings({
                                            methodKey,
                                            parameterName: 'enabled',
                                            value: !methodSettings[methodKey]?.enabled
                                        });
                                    } else {
                                        notify.error(`${method.name} cannot be changed. It is immutable.`);
                                    }
                                }}
                            />
                            <span style={{paddingLeft: 5}}>{method.name}</span>
                        </Text>
                    ),
                    children: (
                        <>
                            <Paragraph>{method.description}</Paragraph>
                            <Space direction="vertical" style={{width: "100%"}}>
                                <Form name={`${method.name}-form`}>
                                    {Object.entries(method.parameters).map(([parameterName, parameter], indx) => {
                                        let value = methodSettings[methodKey][parameterName];
                                        return (
                                            <Form.Item
                                                label={(
                                                    <span>
                                                    {parameter.description ? (
                                                        <Tooltip title={parameter.description}>
                                                            {parameter.name}
                                                            <QuestionCircleOutlined style={{marginLeft: 5}}/>
                                                        </Tooltip>
                                                    ) : parameter.name}
                                                </span>
                                                )}
                                                key={`${indx}-${parameterName}`}
                                                hidden={parameter.visible === false}
                                            >
                                                {parameter.type === Boolean ? (
                                                    <Checkbox
                                                        checked={value}
                                                        onChange={() => {
                                                            if (parameter.mutable) {
                                                                updateMethodSettings({
                                                                    methodKey,
                                                                    parameterName,
                                                                    value: !value
                                                                });
                                                            } else {
                                                                notify.error(`${parameter.name} cannot be changed. It is immutable.`);
                                                            }
                                                        }}
                                                    />
                                                ) : parameter.type === Number ? (
                                                    <InputNumber
                                                        value={value}
                                                        min={parameter.min}
                                                        max={parameter.max}
                                                        onChange={(value) => {
                                                            if (parameter.mutable) {
                                                                methodSettings[methodKey][parameterName] = value;
                                                                setMethodSettings({...methodSettings});
                                                                debounceUpdateMethodSettings({
                                                                    methodKey,
                                                                    parameterName,
                                                                    value,
                                                                    newMethodSettings: {...methodSettings}
                                                                });
                                                            } else {
                                                                notify.error(`${parameter.name} cannot be changed. It is immutable.`);
                                                            }
                                                        }}
                                                    />
                                                ) : parameter.type === Array ? (
                                                    <Select
                                                        mode={'multiple'}
                                                        options={parameter.options.filter(key => Object.keys(methodSettings).includes(key) && methodSettings[key].enabled).map(option => {
                                                            const method = supportedMethods.filter(([key, method]) => key === option)[0];
                                                            return ({
                                                                label: method ? method[1].name : option,
                                                                value: option
                                                            })
                                                        })}
                                                        value={value}
                                                        onChange={(value) => {
                                                            if (parameter.mutable) {
                                                                methodSettings[methodKey][parameterName] = value
                                                                setMethodSettings({...methodSettings})
                                                                debounceUpdateMethodSettings({
                                                                    methodKey,
                                                                    parameterName,
                                                                    value,
                                                                    newMethodSettings: {...methodSettings}
                                                                })
                                                            }
                                                        }}
                                                    />
                                                ) : parameter.options ? (
                                                    <Select
                                                        value={value}
                                                        onChange={(value) => {
                                                            if (parameter.mutable) {
                                                                updateMethodSettings({
                                                                    methodKey,
                                                                    parameterName,
                                                                    value
                                                                });
                                                            } else {
                                                                notify.error(`${parameter.name} cannot be changed. It is immutable.`);
                                                            }
                                                        }}
                                                        style={{width: "100%"}}
                                                    >
                                                        {parameter.options.map((option, idx) => (
                                                            <Select.Option key={idx} value={option}>
                                                            {parameter.optionLabels?.[option] ?? option}
                                                            </Select.Option>
                                                        ))}
                                                    </Select>
                                                ) : null}
                                        </Form.Item>
                                        );
                                    })}
                                </Form>
                            </Space>
                        </>
                    )
                };
            }).filter(item => item),
        [methodSettings, supportedMethods]
    );

    const collapseItems = [
        {
            key: "1",
            label: <Title level={5} style={{margin: 0}}>Method Configuration</Title>,
            children: (
                <Tabs
                    defaultActiveKey="0"
                    tabPosition="left"
                    style={{height: '100%'}}
                    items={tabItems}
                />
            )
        }
    ];

    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    return (
        // <Layout style={{display: inputType === 'ora' ? 'none' : 'block'}}>
        <Layout>
            <Collapse
                items={collapseItems}
                bordered={false}
                defaultActiveKey={["1"]}
            />
        </Layout>
    );
};

export default MethodConfig;
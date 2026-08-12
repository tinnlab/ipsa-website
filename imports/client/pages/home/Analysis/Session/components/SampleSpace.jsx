import React, {useState, useEffect, useMemo, useRef} from "react";
import {Tracker} from "meteor/tracker";
import {
    Layout,
    Collapse,
    Typography,
    Space,
    Row,
    Col,
    Select, Input, Divider, Button, Spin, Form
} from "antd";
import useSubscription from "/imports/client/hooks/useSubscription";
import AnalysisUtils from "./AnalysisUtils";
import ReactEcharts from "echarts-for-react";
import EchartsWrapper from "../../Visualization/components/EchartsWrapper";
import _ from "lodash";
import {Meteor} from "meteor/meteor";

const {Title, Text} = Typography;

const getVolcanoOptions = (volcanoPlotData, deSettings) => {
    if (!volcanoPlotData) return {};
    const pThreshold = deSettings.maxAdjustedPValue;
    const fcThreshold = deSettings.minLogFoldChange;

    const upregulatedData = volcanoPlotData.filter(gene => gene.pValue <= pThreshold && gene.FC >= fcThreshold)
        .map(gene => [
            gene.FC,
            gene.pValue >= 1e-16 ? -Math.log10(gene.pValue) : -Math.log10(1e-16),
            `${gene.id}<br>pValue.FDR: ${gene.pValue}<br>log2FC: ${gene.FC}`
        ]);

    const downregulatedData = volcanoPlotData.filter(gene => gene.pValue <= pThreshold && gene.FC <= -fcThreshold)
        .map(gene => [
            gene.FC,
            gene.pValue >= 1e-16 ? -Math.log10(gene.pValue) : -Math.log10(1e-16),
            `${gene.id}<br>pValue.FDR: ${gene.pValue}<br>log2FC: ${gene.FC}`
        ]);

    const nonSignificantData = volcanoPlotData.filter(gene => gene.pValue > pThreshold || Math.abs(gene.FC) < fcThreshold)
        .map(gene => [
            gene.FC,
            gene.pValue >= 1e-16 ? -Math.log10(gene.pValue) : -Math.log10(1e-16),
            `${gene.id}<br>pValue.FDR: ${gene.pValue}<br>log2FC: ${gene.FC}`
        ]);

    return {
        xAxis: {
            type: 'value',
            name: 'Log2FC',
            nameTextStyle: {
                fontSize: 12,
                fontWeight: 'bold',
            },
            nameLocation: 'middle',
            nameGap: 30,
        },
        yAxis: {
            type: 'value',
            name: '-log10(pValue.FDR)',
            nameTextStyle: {
                fontSize: 12,
                fontWeight: 'bold',
            },
        },
        // legend: {
        //     show: true,
        //     data: ['Up-regulated', 'Down-regulated']
        // },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                return `<div style=";font-size: 18px; margin-bottom: 7px">` +
                    '<div style="font-size: 14px;">' + params.data.value[2] + '</div>' +
                    '</div>';
            },
            backgroundColor: 'rgba(255,255,255,0.85)',
        },
        series: [
            {
                // name: 'Up-regulated',
                type: 'scatterGL',
                data: volcanoPlotData.map(gene => ({
                    value: [
                        gene.FC,
                        gene.pValue >= 1e-16 ? -Math.log10(gene.pValue) : -Math.log10(1e-16),
                        `Gene name: ${gene.name}<br>pValue.FDR: ${gene.pValue?.toFixed(2)}<br>Log2FC: ${gene.FC?.toFixed(2)}`,
                        gene.pValue <= pThreshold && gene.FC >= fcThreshold ? 'Up-regulated' : (gene.pValue <= pThreshold && gene.FC <= -fcThreshold ? 'Down-regulated' : 'Non-significant'),
                        gene.pValue <= pThreshold && gene.FC >= fcThreshold ? 0 : (gene.pValue <= pThreshold && gene.FC <= -fcThreshold ? 1 : 2)
                    ]
                })),
                itemStyle: {
                    color: (params) => {
                        const data = params.data;
                        if (data.value[3] === 'Up-regulated') {
                            return '#FF0000'; // red for upregulated
                        } else if (data.value[3] === 'Down-regulated') {
                            return '#1312FF'; // blue for downregulated
                        } else if (data.value[3] === 'Non-significant') {
                            return '#AAAAAA'; // grey for non-significant
                        }
                    },
                },
                symbolSize: 12,
                z: 12,
                large: false,
                silent: true,
                animation: false,
                sampling: 'average',
                postEffect: {
                    enable: false,
                },
                showSymbol: false,
            },
            // {
            //     name: 'Down-regulated',
            //     type: 'scatterGL',
            //     data: downregulatedData,
            //     itemStyle: {
            //         color: '#1312FF', // blue for downregulated
            //     },
            //     symbolSize: 12,
            //     z: 2,
            //     large: false,
            //     silent: true,
            //     animation: false,
            //     sampling: 'average',
            //     postEffect: {
            //         enable: false,
            //     },
            // },
            // {
            //     name: 'Non-significant',
            //     type: 'scatterGL',
            //     data: nonSignificantData,
            //     itemStyle: {
            //         color: '#AAAAAA', // grey for non-significant
            //     },
            //     symbolSize: 12,
            //     z: 2,
            //     large: false,
            //     silent: true,
            //     animation: false,
            //     sampling: 'average',
            //     postEffect: {
            //         enable: false,
            //     },
            // }
        ],
        visualMap: {
            type: 'piecewise',
            show: true,
            dimension: 4,
            // categories: ['Up-regulated', 'Down-regulated', 'Non-significant'],
            pieces: [
                {
                    value: 0,
                    label: 'Up-regulated',
                    color: '#FF0000',
                },
                {
                    value: 1,
                    label: 'Down-regulated',
                    color: '#1312FF',
                },
                {
                    value: 2,
                    label: 'Non-significant',
                    color: '#AAAAAA',
                }
            ],
            // inRange: {
            //     color: ['#FF0000', '#1312FF', '#AAAAAA']
            // },
            orient: 'horizontal',
            left: 'center',
            top: 0,
            itemSymbol: 'circle',
            itemWidth: 12,
            formatter: function (value) {
                switch (value) {
                    case 0:
                        return 'Up-regulated';
                    case 1:
                        return 'Down-regulated';
                    case 2:
                        return 'Non-significant';
                    default:
                        return 'Unknown';
                }
            }
        },
        dataZoom: [
            {
                type: 'inside',
                xAxisIndex: [0],
                throttle: 0,
                filterMode: 'empty',
                orient: 'vertical',
            },
            {
                type: 'inside',
                yAxisIndex: [0],
                throttle: 0,
                filterMode: 'empty',
                orient: 'vertical',
            },
        ],
        grid: {
            left: 50,
            right: 50,
            bottom: 100,
            top: 50,
        },
    };
}

const SampleSpace = ({analysisId, inputType}) => {
    const [state, setState] = useState({
        controlGroup: "all",
        conditionGroup: undefined,
        controlSamples: [],
        conditionSamples: []
    });
    const [fcPValueData, setFcPValueData] = useState([]);
    const chartRef = useRef(null);
    const [volcanoFilteringParameters, setVolcanoFilteringParameters] = useState({
        maxAdjustedPValue: 0.05,
        minLogFoldChange: 0.5
    })
    const [volcanoOptionState, setVolcanoOptionState] = useState({});
    const [isRunningDE, setIsRunningDE] = useState(false);
    const [volcanoPlotDataState, setVolcanoPlotDataState] = useState({});
    const [deForm] = Form.useForm();
    const [nameToIdMap, setNameToIdMap] = useState({});

    const volcanoPlotData = useMemo(() => {
        return fcPValueData.map(e => ({
            FC: e.FC,
            pValue: inputType !== 'expression' ? e.pValue : e.pValueFDR,
            // pValue: e.pValue,
            id: e.id,
            name: nameToIdMap && nameToIdMap[e.id] ? nameToIdMap[e.id] : e.id
        }));
    }, [fcPValueData, nameToIdMap]);

    const volcanoPlotOptions = useMemo(() => getVolcanoOptions(volcanoPlotData, {
        maxAdjustedPValue: volcanoFilteringParameters.maxAdjustedPValue ?? 0.05,
        minLogFoldChange: volcanoFilteringParameters.minLogFoldChange ?? 0.5
    }), [volcanoPlotData, volcanoFilteringParameters]);

    useEffect(() => {
        if (!volcanoPlotData) return;

        setVolcanoPlotDataState({
            ...volcanoPlotData
        })
    }, [volcanoPlotData]);

    // Set up subscription
    useSubscription("analysis.config", {
        analysisId,
        inputType,
        keys: ["pcaData", "groupData", "selectedControlSamples", "selectedConditionSamples", "volcanoPlotData", "maxAdjustedPValue", "minLogFoldChange", "mappedGeneIds"]
    }, [inputType, analysisId]);

    useEffect(() => {
        setVolcanoOptionState({
            ...volcanoPlotOptions
        })
    }, [volcanoPlotOptions]);

    useEffect(() => {
        setState({
            controlGroup: "all",
            conditionGroup: undefined,
            controlSamples: [],
            conditionSamples: []
        })
    }, [analysisId])

    // Create reactive computations for our data dependencies
    useEffect(() => {
        const groupComputation = Tracker.autorun(() => {
            const groupData = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "groupData"
            })?.value;

            if (groupData && state.controlSamples.length === 0) {
                setState(prev => ({
                    ...prev,
                    controlSamples: Object.keys(groupData.data || {}),
                    controlGroup: "all"
                }));
            }
        });

        const samplesComputation = Tracker.autorun(() => {
            const selectedControlSamples = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "selectedControlSamples"
            })?.value;

            const selectedConditionSamples = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "selectedConditionSamples"
            })?.value;

            if (selectedControlSamples || selectedConditionSamples) {
                setState(prev => ({
                    ...prev,
                    controlSamples: selectedControlSamples || [],
                    conditionSamples: selectedConditionSamples || [],
                    // controlGroup: "c",
                    // conditionGroup: "d"
                }));
            }
        });

        return () => {
            groupComputation.stop();
            samplesComputation.stop();
        };
    }, [analysisId, inputType]);

    const [pcaData, setPcaData] = useState(null);
    const [groupData, setGroupData] = useState(null);

    useEffect(() => {
        const computation = Tracker.autorun(() => {
            const newPcaData = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "pcaData"
            })?.value;

            const newGroupData = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "groupData"
            })?.value;

            setPcaData(newPcaData);
            setGroupData(newGroupData);
        });

        const volcanoComputation = Tracker.autorun(() => {
            const newFcPValueData = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "volcanoPlotData"
            })?.value ?? [];

            setFcPValueData(newFcPValueData);
        })
        const volcanoParametersComputation = Tracker.autorun(() => {
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
            setVolcanoFilteringParameters({
                maxAdjustedPValue: newMaxAdjustedPValue ?? 0.05,
                minLogFoldChange: newMinLogFoldChange ?? 0.5
            })
            deForm.setFieldsValue({
                maxAdjustedPValue: newMaxAdjustedPValue ?? 0.05,
                minLogFoldChange: newMinLogFoldChange ?? 0.5
            })
        })
        const nameToIdComputation = Tracker.autorun(() => {
            const newNameToIdMap = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: "mappedGeneIds"
            })?.value ?? [];

            const tmpNameToIdMap = newNameToIdMap.reduce((acc, curr) => {
                acc[curr.from] = curr.to;
                return acc;
            }, {});
            setNameToIdMap(tmpNameToIdMap);
        })
        return () => {
            computation.stop();
            volcanoComputation.stop();
            volcanoParametersComputation.stop();
            nameToIdComputation.stop();
        }
    }, [analysisId, inputType]);

    useEffect(() => {
        if (state.controlSamples.length > 0) {
            setState(prev => ({
                ...prev,
                controlGroup: Object.keys(groupData?.data).length === state.controlSamples.length ?
                    'all' : groupData?.data[state.controlSamples[0]]
            }))
        } else {
            setState(prev => ({
                ...prev,
                controlGroup: undefined
            }))
        }
        if (state.conditionSamples.length > 0) {
            setState(prev => ({
                ...prev,
                conditionGroup: Object.keys(groupData?.data).length === state.conditionSamples.length ?
                    'all' : groupData?.data[state.conditionSamples[0]]
            }))
        } else {
            setState(prev => ({
                ...prev,
                conditionGroup: undefined
            }))
        }
    }, [state.controlSamples, state.conditionSamples, analysisId])

    const getOption = () => ({
        xAxis: {
            type: 'value',
            name: 'PC 1',
            nameTextStyle: {
                fontSize: 12,
                fontWeight: 'bold',
            },
            axisLabel: {
                show: false,
            },
        },
        yAxis: {
            type: 'value',
            name: 'PC 2',
            nameTextStyle: {
                fontSize: 12,
                fontWeight: 'bold',
            },
            axisLabel: {
                show: false,
            },
        },
        series: [
            {
                name: 'Control',
                type: 'scatter',
                data: pcaData?.filter((d) => state.controlSamples.indexOf(d._row) !== -1)
                    .map((d) => [d.PC1, d.PC2, d._row]) || [],
                itemStyle: {
                    color: 'red',
                },
            },
            {
                name: 'Condition',
                type: 'scatter',
                data: pcaData?.filter((d) => state.conditionSamples.indexOf(d._row) !== -1)
                    .map((d) => [d.PC1, d.PC2, d._row]) || [],
                itemStyle: {
                    color: 'blue',
                },
            },
        ],
        tooltip: {
            trigger: 'item',
            formatter: (params) => `${params.marker}${params.seriesName}<br/>${params.data[2]}`
        },
    });

    const handleControlGroupChange = (value) => {
        Tracker.nonreactive(() => {
            if (value === "all") {
                const allSamples = Object.keys(groupData?.data || {});
                setState(prev => ({
                    ...prev,
                    controlSamples: allSamples,
                    conditionSamples: [],
                    controlGroup: "all"
                }));

                AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        selectedControlSamples: allSamples,
                        selectedConditionSamples: []
                    }
                });
            } else {
                const samples = Object.keys(groupData?.data || {})
                    .filter(sample => sample !== '' && groupData?.data[sample] === value);
                const tmpConditionSamples = state.conditionSamples.length > 0 ?
                    state.conditionSamples.filter(sample => sample !== '' && samples.indexOf(sample) === -1) :
                    Object.keys(groupData?.data || {}).filter(sample => sample !== '' && groupData?.data[sample] !== value);

                setState(prev => ({
                    ...prev,
                    controlGroup: value,
                    controlSamples: samples,
                    conditionSamples: tmpConditionSamples,
                }));

                console.log('state', state.conditionSamples.length)
                AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        selectedControlSamples: samples,
                        selectedConditionSamples: tmpConditionSamples
                        // selectedConditionSamples: state.conditionSamples.filter(
                        //     sample => samples.indexOf(sample) === -1
                        // )
                    }
                });
            }
        });
    };

    const handleConditionGroupChange = (value) => {
        Tracker.nonreactive(() => {
            if (value === "all") {
                const allSamples = Object.keys(groupData?.data || {});
                setState(prev => ({
                    ...prev,
                    conditionGroup: "all",
                    controlSamples: [],
                    conditionSamples: allSamples,
                }));

                AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        selectedControlSamples: [],
                        selectedConditionSamples: allSamples
                    }
                });
            } else {
                const samples = Object.keys(groupData?.data || {})
                    .filter(sample => sample !== '' && groupData?.data[sample] === value);
                const tmpControlSamples = state.controlSamples.length > 0 ?
                    state.controlSamples.filter(sample => sample !== '' && samples.indexOf(sample) === -1) :
                    Object.keys(groupData?.data || {}).filter(sample => sample !== '' && groupData?.data[sample] !== value);

                setState(prev => ({
                    ...prev,
                    conditionGroup: value,
                    // controlSamples: prev.controlSamples.filter(sample =>
                    //     samples.indexOf(sample) === -1
                    // ),
                    controlSamples: tmpControlSamples,
                    conditionSamples: samples,
                }));

                AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        // selectedControlSamples: state.controlSamples.filter(
                        //     sample => samples.indexOf(sample) === -1
                        // ),
                        selectedControlSamples: tmpControlSamples,
                        selectedConditionSamples: samples
                    }
                });
            }
        });
    };

    const handleControlSamplesChange = (values) => {
        Tracker.nonreactive(() => {
            setState(prev => ({
                ...prev,
                controlSamples: values,
                conditionSamples: prev.conditionSamples.filter(
                    sample => values.indexOf(sample) === -1
                )
            }));

            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {
                    selectedConditionSamples: state.conditionSamples
                        .filter(sample => values.indexOf(sample) === -1),
                    selectedControlSamples: values
                }
            });
        });
    };

    const handleConditionSamplesChange = (values) => {
        Tracker.nonreactive(() => {
            setState(prev => ({
                ...prev,
                conditionSamples: values,
                controlSamples: prev.controlSamples.filter(
                    sample => values.indexOf(sample) === -1
                )
            }));

            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: {
                    selectedConditionSamples: values,
                    selectedControlSamples: state.controlSamples
                        .filter(sample => values.indexOf(sample) === -1)
                }
            });
        });
    };

    const updateVolcanoPlotFiltering = _.debounce((newFilteringParams) => {
        setVolcanoFilteringParameters({
            ...newFilteringParams
        })
        const newOptions = getVolcanoOptions(volcanoPlotData, {
            maxAdjustedPValue: newFilteringParams.maxAdjustedPValue,
            minLogFoldChange: newFilteringParams.minLogFoldChange
        })

        setVolcanoOptionState({
            ...newOptions
        })

        AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                maxAdjustedPValue: newFilteringParams.maxAdjustedPValue,
                minLogFoldChange: newFilteringParams.minLogFoldChange
            }
        })
    }, 1500)

    const collapseItems = [
            {
                key: "1",
                label: <Title level={5} style={{margin: 0}}>Grouping & Differential Analysis</Title>,
                children: (
                    <Row gutter={[16, 16]} style={{width: "100%"}}>
                        <Col span={12}>
                            <Space direction="vertical" style={{width: '100%'}}>
                                <Text>
                                    Select samples for each group before starting the comparative analysis.
                                </Text>
                                <Space direction="horizontal" style={{width: '100%'}}>
                                    <Text>Control: </Text>
                                    <Select
                                        style={{width: 200}}
                                        value={state.controlGroup}
                                        onChange={handleControlGroupChange}
                                    >
                                        <Select.Option value="all">All</Select.Option>
                                        {groupData?.annotations.map((annotation, index) => (
                                            <Select.Option value={annotation} key={index}>
                                                {annotation}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Space>
                                <Select
                                    style={{width: "100%"}}
                                    mode="multiple"
                                    value={state.controlSamples}
                                    onChange={handleControlSamplesChange}
                                >
                                    {groupData && Object.keys(groupData.data)
                                        .filter(sample =>
                                            !state.controlSamples.includes(sample) &&
                                            !state.conditionSamples.includes(sample)
                                        )
                                        .map((sample, index) => (
                                            <Select.Option value={sample} key={index}>
                                                {sample}
                                            </Select.Option>
                                        ))
                                    }
                                </Select>
                                <Space direction="horizontal" style={{width: '100%', marginTop: '10px'}}>
                                    <Text>Condition: </Text>
                                    <Select
                                        style={{width: 200}}
                                        value={state.conditionGroup}
                                        onChange={handleConditionGroupChange}
                                    >
                                        <Select.Option value="all">All</Select.Option>
                                        {groupData?.annotations.map((annotation, index) => (
                                            <Select.Option value={annotation} key={index}>
                                                {annotation}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Space>
                                <Select
                                    style={{width: "100%"}}
                                    mode="multiple"
                                    value={state.conditionSamples}
                                    onChange={handleConditionSamplesChange}
                                >
                                    {groupData && Object.keys(groupData.data)
                                        .filter(sample =>
                                            !state.conditionSamples.includes(sample) &&
                                            !state.controlSamples.includes(sample)
                                        )
                                        .map((sample, index) => (
                                            <Select.Option value={sample} key={index}>
                                                {sample}
                                            </Select.Option>
                                        ))
                                    }
                                </Select>
                                <Button
                                    style={{
                                        marginTop: '10px'
                                    }}
                                    onClick={async () => {
                                        setIsRunningDE(true)
                                        setVolcanoPlotDataState({})
                                        const done = await Meteor.callAsync('ora.run.volcano.plot', {
                                            analysisId,
                                            inputType
                                        });
                                        if (done) {
                                            setIsRunningDE(false)
                                            setVolcanoPlotDataState(volcanoPlotData)
                                        }
                                    }}
                                    type={'primary'}
                                    disabled={!(state.controlSamples.length > 0 && state.conditionSamples.length > 0)}
                                >
                                    Run Differential Analysis
                                </Button>
                            </Space>
                        </Col>
                        <Col span={12} style={{width: 'calc(100% - 20px)'}}>
                            {/*{pcaData && (*/}
                            {/*    <ReactEcharts*/}
                            {/*        option={getOption()}*/}
                            {/*        style={{height: '500px', width: '600px'}}*/}
                            {/*    />*/}
                            {/*)}*/}
                            <Spin spinning={isRunningDE} tip={'Running DE analysis...'}
                                  style={{width: '100%', height: '100%'}}>
                                {
                                    isRunningDE && (
                                        <div style={{width: '100%', height: '300px'}}></div>
                                    )
                                }
                                {
                                    volcanoPlotDataState && Object.keys(volcanoPlotDataState).length > 0 && (
                                        <Space direction={'vertical'} style={{width: '100%'}}>
                                            <Space direction={'horizontal'} style={{width: '100%'}}>
                                                <Form
                                                    form={deForm}
                                                >
                                                    <Space style={{width: '100%'}}>
                                                        <Form.Item
                                                            name={'maxAdjustedPValue'}
                                                            label={'pValue.FDR ≤'}
                                                            rules={[{required: true, message: 'Please input pValue.FDR'}]}
                                                        >
                                                            <Input
                                                                type={'number'}
                                                                defaultValue={volcanoFilteringParameters.maxAdjustedPValue}
                                                                onChange={(e) => {
                                                                    if (e.target.value && e.target.value !== '') {
                                                                        const tmpFilteringParameters = volcanoFilteringParameters
                                                                        tmpFilteringParameters.maxAdjustedPValue = e.target.value
                                                                        updateVolcanoPlotFiltering(tmpFilteringParameters)
                                                                    }
                                                                }}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item
                                                            name={'minLogFoldChange'}
                                                            label={'Absolute Log2FC ≥'}
                                                            rules={[{required: true, message: 'Please input Absolute Log2FC'}]}
                                                        >
                                                            <Input
                                                                type={'number'}
                                                                defaultValue={volcanoFilteringParameters.minLogFoldChange}
                                                                onChange={(e) => {
                                                                    if (e.target.value && e.target.value !== '') {
                                                                        const tmpFilteringParameters = volcanoFilteringParameters
                                                                        tmpFilteringParameters.minLogFoldChange = e.target.value
                                                                        updateVolcanoPlotFiltering(tmpFilteringParameters)
                                                                    }
                                                                }}
                                                            />
                                                        </Form.Item>
                                                    </Space>
                                                </Form>
                                            </Space>
                                            <EchartsWrapper>
                                                <ReactEcharts
                                                    option={volcanoOptionState}
                                                    style={{height: "700px"}}
                                                    ref={chartRef}
                                                />
                                            </EchartsWrapper>
                                        </Space>
                                    )
                                }
                            </Spin>
                        </Col>
                    </Row>
                )
            }
        ]
    ;

    return (
        <Layout>
            <Collapse
                items={collapseItems}
                bordered={false}
                defaultActiveKey={["1"]}
            />
        </Layout>
    );
};

export default SampleSpace;
import React, {useEffect, useRef, useState, useCallback} from "react";
import ReactEcharts from "echarts-for-react";
import quantileNormalDist from "../../../../../../utils/quantileNormalDist";
import EchartsWrapper from './EchartsWrapper';
import GeneLoading from "../../../../../components/GeneLoading";
import {Checkbox, Select, Space, Typography, Divider, Radio, InputNumber} from "antd";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";
import _ from "lodash";

const {Text} = Typography;
const {Option} = Select;

export default ({analysisResultsByDb, selectedAnalysisMethods, analysisNames, configs, dbId}) => {
    const chartRef = useRef(null);
    let [plotData, setPlotData] = useState({})
    let [pathwayNames, setPathwayNames] = useState([])

    // Get global settings
    const { globalSettings } = useGlobalSettings();

    // Filtering state - initialize from global settings
    const [enableSignificantFilter, setEnableSignificantFilter] = useState(true)
    const [fdrThreshold, setFdrThreshold] = useState(globalSettings.pValueFDR)
    const [scoreThreshold, setScoreThreshold] = useState(globalSettings.enrichmentScore)
    const [filterLogic, setFilterLogic] = useState('any')
    const [customFdrInput, setCustomFdrInput] = useState('')
    const [customScoreInput, setCustomScoreInput] = useState('')
    const [filteredPathwaysCount, setFilteredPathwaysCount] = useState(0)

    // Sync with global settings when they change
    useEffect(() => {
        setFdrThreshold(globalSettings.pValueFDR);
        setScoreThreshold(globalSettings.enrichmentScore);
    }, [globalSettings]);

    // Debounced handlers for custom input fields
    const debouncedSetFdrThreshold = useCallback(
        _.debounce((value) => setFdrThreshold(value), 500),
        []
    );

    const debouncedSetScoreThreshold = useCallback(
        _.debounce((value) => setScoreThreshold(value), 500),
        []
    );

    // Calculate number of valid datasets for dynamic chart width
    const datasetCount = React.useMemo(() => {
        if (Object.keys(plotData).length === 0) return 0;
        return Object.keys(plotData).filter(analysisId => {
            return analysisNames[analysisId] !== undefined
        }).length;
    }, [plotData, analysisNames]);

    useEffect(() => {
        let resultObject = {}
        if (analysisResultsByDb.length === 0) return

        let filteredAnalysisBySelectedMethods = analysisResultsByDb.filter(e => selectedAnalysisMethods.includes(e.analysisId + "_" + e.key))
        // group by analysisId
        let groupedAnalysisByAnalysisId = filteredAnalysisBySelectedMethods.reduce((acc, curr) => {
            if (!acc[curr.analysisId]) {
                acc[curr.analysisId] = []
            }
            acc[curr.analysisId].push(curr)
            return acc
        }, {})

        // Build pathway significance map across all analyses
        let pathwaySignificanceMap = {}

        Object.keys(groupedAnalysisByAnalysisId).forEach((analysisId) => {
            groupedAnalysisByAnalysisId[analysisId].forEach((pathwaySet) => {
                pathwaySet.value.forEach((pathway) => {
                    if (!pathwaySignificanceMap[pathway.pathway]) {
                        pathwaySignificanceMap[pathway.pathway] = []
                    }
                    pathwaySignificanceMap[pathway.pathway].push({
                        pValueFDR: pathway.pValueFDR,
                        score: pathway.score,
                        analysisId: analysisId
                    })
                })
            })
        })

        // Determine which pathways are significant based on filter logic
        let significantPathways = new Set()

        if (enableSignificantFilter) {
            Object.keys(pathwaySignificanceMap).forEach(pathwayId => {
                const pathwayData = pathwaySignificanceMap[pathwayId]

                if (filterLogic === 'any') {
                    // Pathway is significant if it meets criteria in ANY analysis
                    const isSignificant = pathwayData.some(data => {
                        const passesFdr = fdrThreshold === 0 || data.pValueFDR < fdrThreshold;
                        const passesScore = scoreThreshold === 0 || Math.abs(data.score) > scoreThreshold;
                        return passesFdr && passesScore;
                    })
                    if (isSignificant) {
                        significantPathways.add(pathwayId)
                    }
                } else if (filterLogic === 'all') {
                    // Pathway is significant if it meets criteria in ALL analyses
                    const isSignificant = pathwayData.every(data => {
                        const passesFdr = fdrThreshold === 0 || data.pValueFDR < fdrThreshold;
                        const passesScore = scoreThreshold === 0 || Math.abs(data.score) > scoreThreshold;
                        return passesFdr && passesScore;
                    })
                    if (isSignificant) {
                        significantPathways.add(pathwayId)
                    }
                }
            })
        } else {
            // If filter disabled, include all pathways
            Object.keys(pathwaySignificanceMap).forEach(pathwayId => {
                significantPathways.add(pathwayId)
            })
        }

        // Track enrichment score from meta-analysis for each pathway (for sorting)
        let pathwayMetaScore = new Map()

        plotData = {}
        // get pathway ids
        Object.keys(groupedAnalysisByAnalysisId).forEach((key, i) => {
            // get geneset
            // let geneSet = configs[0].geneSets.filter(e => e.id === dbId)[0].geneSets
            let geneSet = [];
            for (let config of configs) {
                if (config.geneSets && Array.isArray(config.geneSets)) {
                    let matchingGeneSetDb = config.geneSets.find(e => e.id === dbId);
                    if (matchingGeneSetDb && matchingGeneSetDb.geneSets) {
                        geneSet = matchingGeneSetDb.geneSets;
                        break;
                    }
                }
            }
            let genSetObj = geneSet.reduce((acc, curr) => {
                acc[curr.id] = curr
                return acc
            }, {})
            let analysisData = {}
            groupedAnalysisByAnalysisId[key].forEach((pathwaySet) => {
                let analysisMethodData = []
                // Check if this is meta-analysis
                const isMetaAnalysis = pathwaySet.key.toLowerCase().includes('meta')

                pathwaySet.value.forEach((pathway, j) => {
                    // Only include pathway if it's in the significant set
                    if (!significantPathways.has(pathway.pathway)) {
                        return
                    }

                    const pathwayName = genSetObj[pathway.pathway]?.name || pathway.pathway

                    // Track enrichment score from meta-analysis for sorting
                    if (isMetaAnalysis) {
                        pathwayMetaScore.set(pathwayName, pathway.score)
                    }

                    let negLog10pValue = pathway.pValue >= 1e-16 ? -Math.log10(pathway.pValue) : -Math.log10(1e-16);
                    let negLog10pValueFDR = pathway.pValueFDR >= 1e-16 ? -Math.log10(pathway.pValueFDR) : -Math.log10(1e-16);

                    let ciStart = 0;
                    let ciEnd = 0
                    if (quantileNormalDist(pathway.pValue) !== 0) {
                        ciStart = pathway.score + (-(pathway.score / quantileNormalDist(pathway.pValue)) * 1.5)
                        ciEnd = pathway.score + (pathway.score / quantileNormalDist(pathway.pValue)) * 1.5
                    }
                    // Clamp confidence interval values to -5 to 5 range
                    ciStart = Math.max(-5, Math.min(5, ciStart));
                    ciEnd = Math.max(-5, Math.min(5, ciEnd));

                    analysisMethodData.push([
                        pathwayName,
                        pathway.score,
                        ciEnd,
                        ciStart,
                        negLog10pValueFDR,
                        pathway.pathway
                    ])
                })
                analysisData[pathwaySet.key] = analysisMethodData
            })
            plotData[key] = analysisData
        })

        // construct pathway names by building union across all analyses
        let pathwayNamesSet = new Set()
        Object.keys(plotData).forEach((analysisId) => {
            Object.keys(plotData[analysisId]).forEach((method) => {
                plotData[analysisId][method].forEach((pathwayData) => {
                    pathwayNamesSet.add(pathwayData[0]) // pathway name
                })
            })
        })
        pathwayNames = Array.from(pathwayNamesSet)

        // Filter out pathways with zero or missing meta-analysis scores (e.g., Apoptosis)
        pathwayNames = pathwayNames.filter(pathwayName => {
            const metaScore = pathwayMetaScore.get(pathwayName)
            return metaScore !== undefined && metaScore !== 0
        })

        // Sort pathways by meta-analysis enrichment score (ascending for display, so highest appears at top)
        pathwayNames.sort((a, b) => {
            const scoreA = Math.abs(pathwayMetaScore.get(a) || 0)
            const scoreB = Math.abs(pathwayMetaScore.get(b) || 0)
            return scoreA - scoreB  // ascending order (reversed for y-axis display)
        })

        setFilteredPathwaysCount(significantPathways.size)
        setPathwayNames(pathwayNames)
        setPlotData(plotData)
    }, [analysisResultsByDb, selectedAnalysisMethods, enableSignificantFilter, fdrThreshold, scoreThreshold, filterLogic])

    const options = React.useMemo(() => {
        if (Object.keys(plotData).length === 0) {
            return null
        }

        // Check if pathwayNames is ready
        if (!pathwayNames || pathwayNames.length === 0) {
            return null
        }

        // Filter to only analyses that exist in both plotData AND analysisNames
        const validAnalysisIds = Object.keys(plotData).filter(analysisId => {
            return analysisNames[analysisId] !== undefined
        })

        if (validAnalysisIds.length === 0) {
            console.warn('No valid analysis IDs found - waiting for analysisNames to sync')
            return null
        }

        let totalSeriesDataAnalysis = [];
        let xAxisArray = []
        let yAxisArray = []

        let xAxisIndices = []
        let yAxisIndices = []
        let gridArray = []

        // Build gridArray, xAxisIndices, yAxisIndices from VALID analyses only
        // Use pixel-based positioning for > 5 datasets with dynamic width calculation
        const usePixels = validAnalysisIds.length > 5;

        // Calculate dynamic width based on dataset count
        let gridSpacing, gridWidth, leftStart;

        if (usePixels) {
            // Target total width ~800px, divide by dataset count
            const targetWidth = 800;
            const widthPerDataset = Math.max(40, Math.min(80, targetWidth / validAnalysisIds.length));

            gridWidth = Math.floor(widthPerDataset * 0.85);  // 85% for grid, 15% for spacing
            gridSpacing = widthPerDataset;
            leftStart = 180;  // Space for pathway names with ellipsis
        } else {
            // Original percentage-based for ≤5 datasets
            gridSpacing = 15;
            gridWidth = 133;
            leftStart = 30;
        }

        validAnalysisIds.forEach((analysisId, i) => {
            gridArray.push({
                left: usePixels ? `${leftStart + i * gridSpacing}px` : `${leftStart + i * gridSpacing}%`,
                width: gridWidth
            })
            xAxisIndices.push(i)
            yAxisIndices.push(i)
        })

    // gridArray[0].cotainLabel = true
    validAnalysisIds.forEach((analysisId, index) => {
        xAxisArray.push({
            gridIndex: index,
            name: analysisNames[analysisId].name,
            nameLocation: 'center',
            nameTextStyle: {
                fontSize: 12,
                padding: [30, 0, 0, 0],
                nameGap: 30
            },
            min: -5,
            max: 5,
            interval: 2,
            splitNumber: 5
        })
        if (yAxisArray.length === 0) {
            yAxisArray.push({
                gridIndex: index,
                type: 'category',
                data: pathwayNames,
                show: true,
                axisLabel: {
                    width: 80,
                    overflow: 'truncate',
                    ellipsis: '...',
                    interval: 0
                }
            })
        } else {
            yAxisArray.push({
                gridIndex: index,
                type: 'category',
                data: pathwayNames,
                show: false,
            })

        }

        Object.keys(plotData[analysisId]).forEach((method, idx) => {
            let methods = Object.keys(plotData[analysisId])
            // Check if this is meta-analysis (check both method name and analysis name)
            const isMetaAnalysis = method.toLowerCase().includes('meta') ||
                                   analysisNames[analysisId]?.name?.toLowerCase().includes('meta');

            let methodSeriesData = {
                type: 'custom',
                name: method,
                xAxisIndex: index,
                yAxisIndex: index,
                itemStyle: {
                    borderWidth: 1.5,
                    color: isMetaAnalysis ? '#2d7a4f' : undefined
                },
                renderItem: function (params, api) {
                    let index = methods.indexOf(params.seriesName)
                    let gap = index * 15
                    // let gap = 10
                    let encode = params.encode
                    var xValue = api.value(0)
                    var rightPoint = api.coord([api.value(encode['x'][1]), xValue])
                    var leftPoint = api.coord([api.value(encode['x'][0]), xValue])
                    var score = api.value(encode['x'][2])
                    var scorePoint = api.coord([score, xValue])
                    var halfWidth = 6
                    var ciColor = api.visual('color');
                    var style = api.style({
                        stroke: ciColor,
                        fill: undefined,
                        lineWidth: 2
                    });
                    var style2 = api.style({
                        fill: 'red'
                    });
                    return {
                        type: 'group',
                        children: [
                            {
                                type: 'line',
                                transition: ['shape'],
                                shape: {
                                    y1: leftPoint[1] - halfWidth + gap,
                                    x1: leftPoint[0],
                                    y2: leftPoint[1] + halfWidth + gap,
                                    x2: leftPoint[0]
                                },
                                style: style
                            },
                            {
                                type: 'line',
                                transition: ['shape'],
                                shape: {
                                    x1: leftPoint[0],
                                    y1: leftPoint[1] + gap,
                                    x2: rightPoint[0],
                                    y2: rightPoint[1] + gap
                                },
                                style: style
                            },
                            {
                                type: 'line',
                                transition: ['shape'],
                                shape: {
                                    y1: rightPoint[1] - halfWidth + gap,
                                    x1: rightPoint[0],
                                    y2: rightPoint[1] + halfWidth + gap,
                                    x2: rightPoint[0]
                                },
                                style: style
                            },
                            {
                                type: 'circle',
                                transition: ['shape'],
                                shape: {
                                    cx: scorePoint[0], cy: rightPoint[1] + gap, r: 3
                                },
                                style: style2
                            }
                        ]
                    };
                },
                encode: {
                    x: [3, 2, 1],
                    y: 0
                },
                data: plotData[analysisId][method],
                z: 100
            }

            // Add red vertical reference line at x=0 for first method of each analysis
            if (idx === 0) {
                methodSeriesData.markLine = {
                    silent: true,
                    symbol: 'none',
                    lineStyle: {
                        color: 'red',
                        width: 1.5,
                        type: 'solid'
                    },
                    data: [{
                        xAxis: 0
                    }],
                    z: 1
                }
            }

            totalSeriesDataAnalysis.push(methodSeriesData)
        })
    })

        // Validate array synchronization before returning
        if (xAxisArray.length !== yAxisArray.length || xAxisArray.length !== gridArray.length) {
            console.error('Array length mismatch in ForestChartMultiAnalysis:', {
                xAxis: xAxisArray.length,
                yAxis: yAxisArray.length,
                grid: gridArray.length,
                validAnalysisIds: validAnalysisIds.length
            })
            return null
        }

        // let zoomStart = methods.length > 3 ? 98 : 90
        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'shadow',
                },
                formatter: function (params) {
                    let resultString = ''
                    params.forEach((param) => {
                        let string = `<b>${param.seriesName}</b> <br /> Score: ${param.data[1]} <br />`
                        resultString += string
                    })
                    return resultString
                }
            },
            title: {
                text: 'Forest chart'
            },
            legend: {
                // data: analysisNames,
                itemStyle: {
                    decal: 'none'
                }
            },
            dataZoom: [
                {
                    type: 'slider',
                    yAxisIndex: yAxisIndices,
                    // zoomLock: true,
                    width: 10,
                    right: 10,
                    start: 0,
                    end: 100,
                    handleSize: 40,
                    showDetail: false
                },
                {
                    type: 'inside',
                    id: 'insideY',
                    yAxisIndex: yAxisIndices,
                    start: 0,
                    end: 100,
                    zoomOnMouseWheel: false,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: true
                },
                {
                    type: 'slider',
                    xAxisIndex: xAxisIndices,
                    // zoomLock: true,
                    width: 10,
                    left: 10,
                    start: 0,
                    end: 100,
                    handleSize: 40,
                    showDetail: false
                },
                {
                    type: 'inside',
                    id: 'insideX',
                    xAxisIndex: xAxisIndices,
                    start: 0,
                    end: 100,
                    zoomOnMouseWheel: false,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: true
                }
            ],
            grid: gridArray,
            xAxis: xAxisArray,
            yAxis: yAxisArray,
            series: totalSeriesDataAnalysis
        }
    }, [plotData, pathwayNames, analysisNames])

    if (!options) {
        return (
            <div>
                <h5>Multi-analysis forest chart</h5>
                <div style={{marginBottom: 16}}>
                    <Space direction="vertical" size="small" style={{width: '100%'}}>
                        <Space align="center" wrap>
                            <Checkbox
                                checked={enableSignificantFilter}
                                onChange={(e) => setEnableSignificantFilter(e.target.checked)}
                            >
                                Show only significant pathways
                            </Checkbox>
                            {enableSignificantFilter && (
                                <>
                                    <Text type="secondary">|</Text>
                                    <Text>FDR &lt;</Text>
                                    <Select
                                        value={fdrThreshold}
                                        onChange={setFdrThreshold}
                                        style={{width: 100}}
                                        size="small"
                                    >
                                        <Option value={0.01}>0.01</Option>
                                        <Option value={0.05}>0.05</Option>
                                        <Option value={0.1}>0.1</Option>
                                        <Option value={0.25}>0.25</Option>
                                        <Option value={0.5}>0.5</Option>
                                        <Option value={1.0}>1.0 (show all)</Option>
                                    </Select>
                                    <Text type="secondary">|</Text>
                                    <Text>|Score| &gt;</Text>
                                    <Select
                                        value={scoreThreshold}
                                        onChange={setScoreThreshold}
                                        style={{width: 100}}
                                        size="small"
                                    >
                                        <Option value={0}>0</Option>
                                        <Option value={0.5}>0.5</Option>
                                        <Option value={1.0}>1.0</Option>
                                        <Option value={1.5}>1.5</Option>
                                        <Option value={2.0}>2.0</Option>
                                    </Select>
                                </>
                            )}
                        </Space>
                        <Text type="secondary" style={{fontSize: '12px'}}>
                            {enableSignificantFilter
                                ? `No pathways meet the significance criteria (FDR < ${fdrThreshold} and |Score| > ${scoreThreshold}). Try adjusting the thresholds or unchecking the filter.`
                                : 'Loading pathway data...'}
                        </Text>
                    </Space>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h5>
                Multi-analysis forest chart
            </h5>

            {/* Filtering Controls */}
            <div style={{marginBottom: 16}}>
                <Space direction="vertical" size="small" style={{width: '100%'}}>
                    <Space align="center" wrap>
                        <Checkbox
                            checked={enableSignificantFilter}
                            onChange={(e) => setEnableSignificantFilter(e.target.checked)}
                        >
                            Show only significant pathways
                        </Checkbox>
                        {enableSignificantFilter && (
                            <>
                                <Text type="secondary">|</Text>
                                <Text>FDR &lt;</Text>
                                <Select
                                    value={fdrThreshold}
                                    onChange={setFdrThreshold}
                                    style={{width: 100}}
                                    size="small"
                                    dropdownRender={(menu) => (
                                        <>
                                            {menu}
                                            <Divider style={{margin: '8px 0'}} />
                                            <Space style={{padding: '0 8px 4px'}}>
                                                <InputNumber
                                                    placeholder="Custom"
                                                    value={customFdrInput}
                                                    onChange={(val) => {
                                                        if (val !== null && val >= 0 && val <= 1) {
                                                            setCustomFdrInput(val);
                                                            debouncedSetFdrThreshold(val);
                                                        }
                                                    }}
                                                    min={0}
                                                    max={1}
                                                    step={0.01}
                                                    size="small"
                                                    style={{width: 80}}
                                                />
                                            </Space>
                                        </>
                                    )}
                                >
                                    <Option value={0.01}>0.01</Option>
                                    <Option value={0.05}>0.05</Option>
                                    <Option value={0.1}>0.1</Option>
                                </Select>
                                <Text type="secondary">|</Text>
                                <Text>|Score| &gt;</Text>
                                <Select
                                    value={scoreThreshold}
                                    onChange={setScoreThreshold}
                                    style={{width: 100}}
                                    size="small"
                                    dropdownRender={(menu) => (
                                        <>
                                            {menu}
                                            <Divider style={{margin: '8px 0'}} />
                                            <Space style={{padding: '0 8px 4px'}}>
                                                <InputNumber
                                                    placeholder="Custom"
                                                    value={customScoreInput}
                                                    onChange={(val) => {
                                                        if (val !== null && val >= 0 && val <= 10) {
                                                            setCustomScoreInput(val);
                                                            debouncedSetScoreThreshold(val);
                                                        }
                                                    }}
                                                    min={0}
                                                    max={10}
                                                    step={0.1}
                                                    size="small"
                                                    style={{width: 80}}
                                                />
                                            </Space>
                                        </>
                                    )}
                                >
                                    <Option value={0}>0</Option>
                                    <Option value={0.5}>0.5</Option>
                                    <Option value={1.0}>1.0</Option>
                                    <Option value={1.5}>1.5</Option>
                                    <Option value={2.0}>2.0</Option>
                                </Select>
                                <Text type="secondary">|</Text>
                                <Radio.Group
                                    value={filterLogic}
                                    onChange={(e) => setFilterLogic(e.target.value)}
                                    size="small"
                                >
                                    <Radio.Button value="any">Significant in ANY analysis</Radio.Button>
                                    <Radio.Button value="all">Significant in ALL analyses</Radio.Button>
                                </Radio.Group>
                            </>
                        )}
                    </Space>
                    {enableSignificantFilter && (
                        <Text type="secondary" style={{fontSize: '12px'}}>
                            Showing {filteredPathwaysCount} significant pathways
                        </Text>
                    )}
                </Space>
            </div>

            <Divider style={{margin: '12px 0'}} />

            <div style={{ overflowX: 'auto', width: '100%' }}>
                <EchartsWrapper>
                    <ReactEcharts
                        option={options}
                        style={{
                            height: "800px",
                            width: datasetCount > 5
                                ? `${100 + datasetCount * Math.max(40, Math.min(80, 800 / datasetCount))}px`
                                : '100%',
                            minWidth: '100%'
                        }}
                    ></ReactEcharts>
                </EchartsWrapper>
            </div>
        </div>
    )

}


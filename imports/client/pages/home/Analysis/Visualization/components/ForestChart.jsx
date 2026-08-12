import React, {useEffect, useRef, useState} from "react";
import ReactEcharts from "echarts-for-react";
import quantileNormalDist from "../../../../../../utils/quantileNormalDist";
import EchartsWrapper from './EchartsWrapper';
import GeneLoading from "../../../../../components/GeneLoading";

export default ({result, geneSet, selectedPathways, selectedMethods, onPointClick}) => {
    let {name: geneSetName, id: geneSetId, geneSets: geneSetList} = geneSet
    let [plotData, setPlotData] = useState({})
    let [pathwayNames, setPathwayNames] = useState([])
    const chartRef = useRef(null);

    useEffect(() => {
        let filteredGeneSetList = []
        let filteredResultValues = []
        if (result.length === 0 || selectedPathways.length === 0) return
        let filteredResult = Object.fromEntries(
            Object.entries(result).filter(([key, value]) => selectedMethods.map(e => e.split("_")[1]).includes(key))
        );
        let intersectPathway = Array.from(
            new Set(
                Object.keys(filteredResult).map(method => {
                    return {
                        ID: filteredResult[method].ID,
                        pathway: filteredResult[method].pathway,
                        name: filteredResult[method].name
                    }
                }).flat()
            )
        )
        let updatedResults = []
        if (selectedPathways.length > 0) {
            let inputSelectedPathwaysSet = new Set(selectedPathways)
            updatedResults = Object.entries(filteredResult).map(([key, value]) => {
                let filteredPathways = value.filter(e => inputSelectedPathwaysSet.has(e.pathway))
                if (filteredPathways.length < selectedPathways.length) {
                    // Case where some methods have less pathway results than others
                    let missingPathways = selectedPathways.filter(pathway => !filteredPathways.some(e => e.pathway === pathway))
                    for (let pathway of missingPathways) {
                        filteredPathways.push({
                            ID: pathway,
                            name: intersectPathway.filter(pathway => pathway.ID === pathway)[0]?.name,
                            pValue: 1,
                            pValueFDR: 1,
                            pathway: pathway,
                            score: 0
                        })
                    }
                }
                return {
                    key,
                    value: filteredPathways
                }
            })
        }
        let currentPlotData = {}
        for (let result of updatedResults) {
            let mapTable = new Map()
            if (selectedPathways.length >= 0) {
                let inputSelectedPathwaysSet = new Set(selectedPathways)
                filteredGeneSetList = geneSetList.filter(e => inputSelectedPathwaysSet.has(e.id))
                filteredResultValues = result.value.filter(e => inputSelectedPathwaysSet.has(e.pathway))
                mapTable.clear()
            }
            for (let gs of filteredGeneSetList) {
                mapTable.set(gs.id, Object.assign([], {
                    id: gs.id,
                    name: gs.name,
                    genes: gs.genes,
                    0: gs.name,
                    5: gs.id
                }))
            }

            for (let res of filteredResultValues) {
                let negLog10pValue = res.pValue >= 1e-16 ? -Math.log10(res.pValue) : -Math.log10(1e-16);
                let negLog10pValueFDR = res.pValueFDR >= 1e-16 ? -Math.log10(res.pValueFDR) : -Math.log10(1e-16);

                let ciStart = 0;
                let ciEnd = 0

                const z = quantileNormalDist(res.pValue);
                const se = Math.abs(res.score / z);  // Calculate SE from enrichment score and Z-score
                ciStart = res.score - 1.96 * se;
                ciEnd = res.score + 1.96 * se;

                if (ciStart < 0 && ciEnd > 0) {
                    if (ciStart < -8) {
                        ciStart = -8
                        ciEnd = res.score + Math.abs(res.score - ciStart)
                    }
                }
                mapTable.set(res.pathway, Object.assign(mapTable.get(res.pathway) || [], {
                    pValue: res.pValue,
                    pValueFDR: res.pValueFDR,
                    score: res.score ?? 0,
                    negLog10pValue,
                    negLog10pValueFDR,
                    1: res.score ?? 0,
                    2: isNaN(ciStart) ? 0 : ciStart,
                    3: isNaN(ciEnd) ? 0 : ciEnd,
                    4: negLog10pValueFDR,
                    length: 6
                }))
            }
            currentPlotData[result.key] = Array.from(mapTable.values()).filter(e => Number.isFinite(e.score))
        }
        currentPlotData = Object.fromEntries(
            Object.entries(currentPlotData).map(([key, value]) => {
                let valueMap = new Map(value.map(e => [e.id, e]));
                let filteredValue = selectedPathways.map(id => valueMap.get(id) || null);
                return [key, filteredValue];
            })
        );

        // remove null values from currentPlotData[key]
        for (let key in currentPlotData) {
            currentPlotData[key] = currentPlotData[key].filter(e => e !== null)
        }
        let firstObject = Object.values(currentPlotData)[0];
        let pathwayNames = firstObject?.map(e => e ? e.name : null).reverse();
        setPlotData(currentPlotData);
        setPathwayNames(pathwayNames);

    }, [geneSetId, result, selectedPathways, selectedMethods])

    if (Object.keys(plotData).length === 0) {
        return <GeneLoading />
    }
    let totalSeriesData = [];
    let methods = Object.keys(plotData)

    for (let method in plotData) {
        let methodSeriesData = {}
        methodSeriesData = {
            type: 'custom',
            name: method,
            itemStyle: {
                borderWidth: 1.5
            },
            renderItem: function (params, api) {
                let index = methods.indexOf(params.seriesName)
                let gap = index * 15
                let encode = params.encode
                var xValue = api.value(0)
                var rightPoint = api.coord([api.value(encode['x'][1]), xValue])
                var leftPoint = api.coord([api.value(encode['x'][0]), xValue])
                var score = api.value(encode['x'][2])
                var scorePoint = api.coord([score, xValue])
                var halfWidth = 4
                var style = api.style({
                    stroke: api.visual('color'),
                    fill: undefined
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
            data: plotData[method],
            z: 100
        }
        totalSeriesData.push(methodSeriesData)
    }

    // let zoomStart = methods.length > 2 ? 98 : 90
    let zoomStart = 99
    let options = {}
    options = {
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow',
            },
            formatter: function (params) {
                let resultString = `<b>Pathway: ${params[0].axisValueLabel}</b> <br />`
                params.forEach((param) => {
                    let string = `Method: <b>${param.seriesName}</b> <br /> Score: ${param.data[1]}, CI Start: ${param.data[2].toFixed(2)}, CI End: ${param.data[3].toFixed(2)} <br />`
                    resultString += string
                })
                return resultString
            }
        },
        legend: {
            data: methods,
            itemStyle: {
                decal: 'none'
            }
        },
        dataZoom: [
            {
                type: 'slider',
                yAxisIndex: 0,
                // zoomLock: true,
                width: 10,
                right: 10,
                start: zoomStart,
                end: 100,
                handleSize: 40,
                showDetail: false
            },
            {
                type: 'inside',
                id: 'insideY',
                yAxisIndex: 0,
                start: zoomStart,
                end: 100,
                zoomOnMouseWheel: false,
                moveOnMouseMove: true,
                moveOnMouseWheel: true
            }
        ],
        grid: {containLabel: false, left: "25%"},
        xAxis: {
            min: -10,
            max: 10,
            axisLine: {
                show: false,
                onZero: false
            }
        },
        yAxis: {
            type: 'category',
            data: pathwayNames,
            axisLine: {
                show: false,
                onZero: false
            },
            axisLabel: {
                formatter: function (value, index) {
                    return `{label|${value}}{icon|\u24D8}`;
                },
                rich: {
                    label: {
                        align: 'left'
                    },
                    icon: {
                        fontSize: 14,
                        align: 'right',
                        padding: [0, 0, 0, 4],
                        className: 'info-icon'
                    }
                }
            },
            triggerEvent: true
        },
        series: [
            ...totalSeriesData,
            {
                type: 'line',
                markLine: {
                    symbol: ['none', 'none'],
                    data: [
                        {
                            xAxis: 0,
                            lineStyle: {
                                type: 'dashed',
                                color: 'red',
                                dashOffset: 2,
                                width: 1
                            }
                        }
                    ]
                }
            }
        ]
    };

    return (
        <div>
            <EchartsWrapper>
                <ReactEcharts
                    key={`${selectedPathways.join(',')}-${selectedMethods.join(',')}`}
                    option={options}
                    style={{height: "700px"}}
                    ref={chartRef}
                    onEvents={{
                        click: (params) => {
                            if (params.componentType === 'yAxis') {
                                const clickedElementText = params.event.target.style.text;
                                if (clickedElementText === '\u24D8') {
                                    const pathwayName = params.value;
                                    onPointClick(pathwayName);
                                }
                            }
                        }
                    }}
                ></ReactEcharts>
            </EchartsWrapper>
        </div>
    )
}


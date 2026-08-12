import React, {useEffect, useRef, useState} from "react";
import ReactEcharts from "echarts-for-react";
import Input from "antd/lib/input";
import EchartsWrapper from './EchartsWrapper';
import {Space} from "antd";
import Typography from "antd/lib/typography";
import GeneLoading from "../../../../../components/GeneLoading";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";

export default ({result, geneSet, selectedPathways, selectedMethods, onPointClick}) => {
    let {name: geneSetName, id: geneSetId, geneSets: geneSetList} = geneSet

    // Get global settings
    const { globalSettings } = useGlobalSettings();

    const [pValueThreshold, setPValueThreshold] = useState(globalSettings.pValueFDR)
    const chartRef = useRef(null);
    let [plotData, setPlotData] = useState({})
    let [pathwayNames, setPathwayNames] = useState([])

    // Sync with global settings when they change
    useEffect(() => {
        setPValueThreshold(globalSettings.pValueFDR);
    }, [globalSettings]);

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
                    3: gs.id,
                }))
            }

            for (let res of filteredResultValues) {
                let isSignificant = false
                if (res.pValueFDR < pValueThreshold) isSignificant = true
                mapTable.set(res.pathway, Object.assign(mapTable.get(res.pathway) || [], {
                    pValue: res.pValue,
                    pValueFDR: res.pValueFDR,
                    score: res.score ?? 0,
                    1: res.score ?? 0,
                    2: isSignificant,
                    length: 4
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
        let pathwayNames = firstObject.map(e => e ? e.name : null);
        setPlotData(currentPlotData);
        setPathwayNames(pathwayNames);
    }, [geneSetId, result, selectedPathways, selectedMethods, pValueThreshold])


    if (Object.keys(plotData).length === 0) {
        return <GeneLoading />
    }
    let totalSeriesData = [];
    let methods = Object.keys(plotData)
    for (let method in plotData) {
        let seriesData = plotData[method].map((item, index) => {
            if (!item[2])
                return {
                    value: item[1],
                    itemStyle: {
                        decal: {
                            symbol: 'none'
                        }
                    }
                }
            else {
                return {
                    value: item[1],
                    itemStyle: {
                        decal: {
                            dashArrayX: [1, 0],
                            dashArrayY: [4, 3],
                            rotation: -Math.PI / 4,
                            color: 'rgba(255, 255, 255)'
                        }
                    }
                }
            }
        });
        let methodSeriesData = {
            name: method,
            type: 'bar',
            data: seriesData
        }
        totalSeriesData.push(methodSeriesData)
    }

    const options = {
        title: {
            text: 'Bar Chart with Negative Value'
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow'
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
                start: 98,
                end: 100,
                handleSize: 40,
                showDetail: false
            },
            {
                type: 'inside',
                id: 'insideY',
                yAxisIndex: 0,
                start: 98,
                end: 100,
                zoomOnMouseWheel: false,
                moveOnMouseMove: true,
                moveOnMouseWheel: true
            }
        ],
        grid: {containLabel: true, left: 0},
        xAxis: {
            type: 'value',
            position: 'top',
            splitLine: {
                lineStyle: {
                    type: 'dashed'
                }
            },
            min: -10,
            max: 10
        },
        yAxis: {
            type: 'category',
            axisLine: {show: false},
            axisTick: {show: false},
            splitLine: {show: false},
            data: pathwayNames,
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
        series: totalSeriesData,
        aria: {
            enabled: true,
            decal: {
                show: true
            }
        }
    };

    const onChange = (e) => {
        setPValueThreshold(e.target.value);
    };

    return (
        <div>
            <h5>
                {geneSetName}
            </h5>
            <Space>
                <Typography.Text>{'pValue.FDR ≤'}</Typography.Text>
                <Input type={'number'} onChange={onChange} value={pValueThreshold}></Input>
            </Space>
            <EchartsWrapper>
                <ReactEcharts
                    option={options}
                    style={{height: "700px"}}
                    ref={chartRef}
                    onEvents={{
                        click: (params) => {
                            console.log({params})
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


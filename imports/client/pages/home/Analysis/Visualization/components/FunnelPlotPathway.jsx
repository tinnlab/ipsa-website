import React, {useEffect, useMemo, useRef, useState} from "react";
import ReactEcharts from "echarts-for-react";
import EchartsWrapper from './EchartsWrapper';
import {Empty} from "antd";
import {buildFunnelPoints, funnelEmptyStateMessage} from "/imports/utils/funnelPlotMeta";

export default ({configs, dbId, metaData}) => {
    const [plotData, setPlotData] = useState([])
    const chartRef = useRef(null);

    const options = useMemo(() => {
        if (plotData.length === 0) {
            return null
        }

        return {
            title: {
                text: 'Funnel Plot - Meta-Analysis Results',
                subtext: 'One point per pathway across all datasets. Asymmetry suggests publication bias.',
                left: 'center'
            },
            legend: {
                data: ['Pathways', 'Pseudo 95% CI'],
                top: 60,
                left: 'center'
            },
            tooltip: {
                trigger: 'item',
                formatter: (params) => {
                    const data = params.data
                    const fixed = (n) => (Number.isFinite(n) ? n.toFixed(3) : 'N/A')
                    const expo = (n) => (Number.isFinite(n) ? n.toExponential(3) : 'N/A')
                    return `<b>${data.pathwayName}</b><br/>` +
                           `Enrichment Score: ${fixed(data.score)}<br/>` +
                           `Standard Error: ${fixed(data.se)}<br/>` +
                           `p-value: ${expo(data.pValue)}<br/>` +
                           `FDR: ${expo(data.pValueFDR)}`
                },
                backgroundColor: 'rgba(255,255,255,0.9)',
                borderColor: '#ccc',
                borderWidth: 1
            },
            grid: {
                left: 80,
                right: 80,
                top: 100,
                bottom: 80,
                containLabel: true
            },
            xAxis: {
                type: 'value',
                name: 'Meta-Analysis Enrichment Score',
                nameLocation: 'middle',
                nameGap: 35,
                nameTextStyle: {
                    fontSize: 14,
                    fontWeight: 'bold'
                },
                axisLine: {
                    lineStyle: {
                        color: '#333'
                    }
                },
                splitLine: {
                    lineStyle: {
                        type: 'dashed',
                        color: '#ddd'
                    }
                }
            },
            yAxis: {
                type: 'value',
                name: 'Standard Error',
                nameLocation: 'middle',
                nameGap: 50,
                nameTextStyle: {
                    fontSize: 14,
                    fontWeight: 'bold'
                },
                inverse: true,  // Invert y-axis so small SE at top
                axisLine: {
                    lineStyle: {
                        color: '#333'
                    }
                },
                splitLine: {
                    lineStyle: {
                        type: 'dashed',
                        color: '#ddd'
                    }
                }
            },
            series: [
                // Funnel lines (pseudo 95% CI)
                {
                    name: 'Pseudo 95% CI',
                    type: 'line',
                    data: (() => {
                        // Create funnel boundaries: x = ±1.96 * SE
                        const maxSE = Math.max(...plotData.map(d => d.se))
                        const points = []
                        for (let se = 0; se <= maxSE; se += maxSE / 50) {
                            points.push([1.96 * se, se])
                        }
                        return points
                    })(),
                    lineStyle: {
                        color: '#ccc',
                        width: 2,
                        type: 'solid'
                    },
                    showSymbol: false,
                    silent: true,
                    z: 0
                },
                {
                    name: 'Pseudo 95% CI',
                    type: 'line',
                    data: (() => {
                        const maxSE = Math.max(...plotData.map(d => d.se))
                        const points = []
                        for (let se = 0; se <= maxSE; se += maxSE / 50) {
                            points.push([-1.96 * se, se])
                        }
                        return points
                    })(),
                    lineStyle: {
                        color: '#ccc',
                        width: 2,
                        type: 'solid'
                    },
                    showSymbol: false,
                    silent: true,
                    z: 0,
                    legendHoverLink: false
                },
                // Data points
                {
                    name: 'Pathways',
                    type: 'scatter',
                    data: plotData.map(d => ({
                        value: [d.score, d.se],
                        pathwayName: d.pathwayName,
                        score: d.score,
                        se: d.se,
                        pValue: d.pValue,
                        pValueFDR: d.pValueFDR
                    })),
                    symbolSize: 10,
                    itemStyle: {
                        color: '#5470c6',
                        opacity: 0.7
                    },
                    markLine: {
                        silent: true,
                        symbol: 'none',
                        lineStyle: {
                            color: '#d9534f',
                            width: 2,
                            type: 'solid'
                        },
                        data: [{
                            xAxis: 0,
                            label: {
                                show: true,
                                position: 'end',
                                formatter: 'No Effect'
                            }
                        }],
                        z: 1
                    }
                }
            ]
        }
    }, [plotData])

    useEffect(() => {
        // Filter meta-analysis results for the current database. Compute
        // unconditionally (no early return) so switching to a database/metaData
        // with no plottable points clears any stale funnel from a previous render.
        const metaResultsForDb = (metaData || []).filter(m => m && m.databaseId === dbId)

        // Get gene set info for pathway names
        let geneSet = []
        if (configs && configs.length > 0) {
            const firstConfig = configs[0]
            if (firstConfig && firstConfig.geneSets && Array.isArray(firstConfig.geneSets)) {
                let matchingGeneSetDb = firstConfig.geneSets.find(e => e.id === dbId)
                if (matchingGeneSetDb && matchingGeneSetDb.geneSets) {
                    geneSet = matchingGeneSetDb.geneSets
                }
            }
        }

        let genSetObj = geneSet.reduce((acc, curr) => {
            acc[curr.id] = curr
            return acc
        }, {})

        // Build plot data: ONE point per pathway from meta-analysis. Points
        // without a valid standard error (seTE) are dropped — only the REML
        // method produces one (see funnelPlotMeta.js).
        const plotDataArray = buildFunnelPoints(
            metaResultsForDb,
            (id) => genSetObj[id]?.name || id
        )

        setPlotData(plotDataArray)

    }, [metaData, configs, dbId])

    if (!options) {
        const emptyMessage = funnelEmptyStateMessage(
            (metaData || []).filter(m => m && m.databaseId === dbId)
        )
        return <div style={{padding: '20px', textAlign: 'center'}}>
            <Empty description={emptyMessage} />
        </div>
    }

    return (
        <EchartsWrapper>
            <ReactEcharts
                option={options}
                style={{height: "700px"}}
                ref={chartRef}
            />
        </EchartsWrapper>
    );
};

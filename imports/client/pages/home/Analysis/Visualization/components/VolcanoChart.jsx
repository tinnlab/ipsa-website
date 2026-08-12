import React, {useEffect, useState, useRef} from "react";
import ReactEcharts from "echarts-for-react";
import EchartsWrapper from './EchartsWrapper';

export default ({result, geneSet, selectedPathways, labeledPathwayIds, mode, threshold, onScatterPointClick}) => {
    let {name: geneSetName, id: geneSetId, geneSets: geneSetList} = geneSet;
    const [mapTable, setMapTable] = useState(new Map());
    // Live pixel width of the chart, captured from the ECharts `finished` event. Used by the
    // label layout to decide when a right-side label would run off the canvas and must flip left.
    const [chartWidth, setChartWidth] = useState(0);
    const chartRef = useRef(null);

    useEffect(() => {
        if (result.length === 0) return;

        let filteredGeneSetList = [];
        let filteredResultValues = [];

        if (selectedPathways.length >= 0) {
            let inputSelectedPathwaysSet = new Set(selectedPathways);
            filteredGeneSetList = geneSetList.filter((e) =>
                inputSelectedPathwaysSet.has(e.id)
            );
            filteredResultValues = result.filter((e) =>
                inputSelectedPathwaysSet.has(e.pathway)
            );
            mapTable.clear();
        }

        for (let gs of filteredGeneSetList) {
            mapTable.set(
                gs.id,
                Object.assign([], {
                    id: gs.id,
                    name: gs.name,
                    genes: gs.genes,
                    2: gs.name,
                    3: gs.genes,
                })
            );
        }

        for (let res of filteredResultValues) {
            let negLog10pValue = res.pValue >= 1e-16 ? -Math.log10(res.pValue) : -Math.log10(1e-16);
            let negLog10pValueFDR = res.pValueFDR >= 1e-16 ? -Math.log10(res.pValueFDR) : -Math.log10(1e-16);

            let yValue = mode === 'pValue' ? negLog10pValue : negLog10pValueFDR;

            let existing = mapTable.get(res.pathway) || [];
            mapTable.set(
                res.pathway,
                Object.assign(existing, {
                    // Ensure every plotted point carries an id + display name even when the pathway
                    // exists in the result set but not in geneSetList; otherwise the label-set
                    // membership test (labeledSet.has(e.id)) and the label text silently fail.
                    id: existing.id ?? res.pathway,
                    name: existing.name ?? res.pathway,
                    2: existing[2] ?? res.pathway,
                    pValue: res.pValue,
                    pValueFDR: res.pValueFDR,
                    score: res.score,
                    negLog10pValue,
                    negLog10pValueFDR,
                    0: res.score,
                    1: yValue,
                    length: 4,
                })
            );
        }

        setMapTable(new Map(mapTable));
    }, [geneSetId, result, selectedPathways]);

    let plotData = Array.from(mapTable.values())
        .filter(
            (e) => Number.isFinite(e.score) && Number.isFinite(e[1])
        )
        .sort((a, b) => b[1] - a[1]);
        // .sort((a, b) => a[0] - b[0]);
    if (plotData.length === 0) {
        return null;
    }

    // Split the plotted points into the labeled series (renders name labels) and the rest.
    // The labeled set is user-driven via labeledPathwayIds; when none is supplied we fall back to
    // the historical top-20-by-significance so existing behaviour is preserved. plotData is already
    // sorted by y (-log10 p) descending, so filtering keeps significance order for the rank numbers.
    let labeledData;
    let restData;
    if (labeledPathwayIds && labeledPathwayIds.length > 0) {
        const labeledSet = new Set(labeledPathwayIds);
        labeledData = plotData.filter((e) => labeledSet.has(e.id));
        restData = plotData.filter((e) => !labeledSet.has(e.id));
    } else if (labeledPathwayIds) {
        // Explicit empty selection: label nothing.
        labeledData = [];
        restData = plotData;
    } else {
        labeledData = plotData.slice(0, 20);
        restData = plotData.slice(20);
    }

    // Anchor a point's label to the right of the symbol, but flip it to the left when the label's
    // measured width would push it past the canvas right edge (this is what previously hid long
    // pathway names on far-right points). chartWidth is 0 until the first `finished` event, in which
    // case we keep the original right-side anchor.
    const labelLayout = function (params) {
        const rect = params.rect;
        const gap = 20;
        const margin = 4;
        const anchorX = rect.x + rect.width / 2;
        const labelW = params.labelRect ? params.labelRect.width : 0;
        const y = rect.y + rect.height / 2;
        // Default: anchor to the right of the symbol. Flip to the left only when the right-anchored
        // label would run past the canvas right edge. When flipping, clamp so the (right-aligned)
        // label never runs off the LEFT edge either — this keeps long names on far-right AND
        // mid-chart points fully visible instead of trading right-clipping for left-clipping.
        const flip = chartWidth > 0 && anchorX + gap + labelW > chartWidth - margin;
        if (flip) {
            return {
                x: Math.max(labelW + margin, rect.x - gap),
                y,
                verticalAlign: "middle",
                align: "right",
                moveOverlap: "shiftY",
            };
        }
        return {
            x: rect.x + gap,
            y,
            verticalAlign: "middle",
            align: "left",
            moveOverlap: "shiftY",
        };
    };

    const minScore = -Math.max(...plotData.map(d => d[0]));
    const maxScore = Math.max(...plotData.map(d => d[0]));

    const options = {
        xAxis: {
            splitLine: {show: false},
            name: "Normalized score",
            axisLabel: {
                fontSize: 14,
            },
        },
        yAxis: {
            splitLine: {show: false},
            scale: true,
            name: `-log10 ${mode === 'pValueFDR' ? 'pValue.FDR' : mode}`,
        },
        grid: {
            left: 40,
            right: 130,
        },
        visualMap: [
            {
                type: "continuous",
                dimension: 0,
                orient: "vertical",
                top: 30,
                right: 0,
                min: minScore, // Adjust min based on the score
                max: maxScore, // Adjust max based on the score
                // text: ["Up-regulated", "Down-regulated"],
                calculable: true,
                inRange: {
                    color: ["#4d69f7", "#cf363d"],
                },
                formatter: function (value) {
                    return value.toFixed(2);
                }
            },
        ],
        series: [
            {
                name: `${geneSetName} (Labeled)`,
                data: labeledData,
                type: "scatter",
                symbolSize: function (data) {
                    const minSize = 5; // Minimum size of the symbol
                    const maxSize = 30; // Maximum size of the symbol

                    const sizes = plotData.map((d) => d[3]);
                    const minValue = Math.min(...sizes);
                    const maxValue = Math.max(...sizes);

                    // Normalize the size to fit within the defined range
                    return ((data[3] - minValue) / (maxValue - minValue)) * (maxSize - minSize) +
                        minSize;
                },
                markLine: {
                    data: [
                        {
                            yAxis: Math.log10(threshold) * -1,
                            label: {
                                formatter: `Threshold (-log10 ${threshold === "pValueFDR" ? "pValue.FDR" : threshold})`,
                                position: 'end',
                            },
                            lineStyle: {
                                color: 'red',
                                type: 'dashed',
                            },
                        },
                    ],
                },
                emphasis: {
                    focus: "self",
                },
                labelLayout: labelLayout,
                labelLine: {
                    show: true,
                    length2: 5,
                    lineStyle: {
                        color: "#bbb",
                    },
                },
                label: {
                    show: true,
                    formatter: function (param) {
                        // Every point in this series is a labeled pathway; number by significance rank.
                        return `{c|\u24D8}{a|${param.data[2]}}{b|${param.dataIndex + 1}}`;
                    },
                    position: "right",
                    minMargin: 4,
                    rich: {
                        a: {
                            borderType: "solid",
                            borderWidth: 1,
                            borderColor: "#000000",
                            borderRadius: 4,
                            padding: [10, 10, 10, 10],
                        },
                        b: {
                            height: 15,
                            width: 15,
                            align: "center",
                            verticalAlign: "top",
                            // borderWidth: 2,
                            // borderRadius: 10,
                            // backgroundColor: "#fff",
                            // borderColor: "#999291",
                            color: "#000",
                            fontSize: 10,
                            padding: [0, 2, 8, 0],
                            lineHeight: 15,
                            className: 'number',
                        },
                        c: {
                            fontSize: 12,
                            fontFamily: 'Arial',
                            color: '#000',
                            align: "center",
                            verticalAlign: "middle",
                            padding: [2, 2, 2, 2],
                            className: 'info-icon',
                        },
                    },
                },
            },
            {
                name: `${geneSetName} (Rest)`,
                data: restData,
                type: "scatter",
                symbolSize: function (data) {
                    const minSize = 5; // Minimum size of the symbol
                    const maxSize = 30; // Maximum size of the symbol

                    const sizes = plotData.map((d) => d[3]);
                    const minValue = Math.min(...sizes);
                    const maxValue = Math.max(...sizes);

                    // Normalize the size to fit within the defined range
                    return ((data[3] - minValue) / (maxValue - minValue)) * (maxSize - minSize) +
                        minSize;
                },
                emphasis: {
                    focus: "self",
                    label: {
                        show: true,
                        formatter: function (param) {
                            return `{a|${param.data[2]}}`;
                        },
                        position: "right",
                        minMargin: 4,
                        rich: {
                            a: {
                                borderType: "solid",
                                borderWidth: 1,
                                borderColor: "#000000",
                                borderRadius: 4,
                                padding: [10, 10, 10, 10],
                            }
                        },
                    },
                },
                labelLayout: labelLayout,
                labelLine: {
                    show: false,
                },
                label: {
                    show: false,
                },
            },
        ],
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
            }
        ]
    };

    return (
        <EchartsWrapper>
            <ReactEcharts
                option={options}
                style={{height: "700px"}}
                ref={chartRef}
                onEvents={{
                    click: (params) => {
                        // seriesIndex 0 is the labeled series \u2014 only its points carry the clickable
                        // \u24D8 label, regardless of how many pathways the user chose to label.
                        if (params.componentType === 'series' && params.seriesIndex === 0) {
                            const infoIcon = '\u24D8';
                            const clickedElementText = params.event.target.style.text;
                            if (clickedElementText === infoIcon) {
                                const label = params.data[2];
                                onScatterPointClick(label);
                            } else if (!isNaN(parseInt(clickedElementText))) {
                                // Handle click event on the number
                            }
                        }
                    },
                    finished: () => {
                        const inst = chartRef.current && chartRef.current.getEchartsInstance
                            ? chartRef.current.getEchartsInstance()
                            : null;
                        if (!inst) return;
                        const w = inst.getWidth();
                        setChartWidth((prev) => (prev !== w ? w : prev));
                    },
                }}
            />
        </EchartsWrapper>
    );
};

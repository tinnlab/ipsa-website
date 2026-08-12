import React, {useEffect, useMemo, useRef, useState} from "react";
import ReactEcharts from "echarts-for-react";
import * as echarts from 'echarts';
import EchartsWrapper from './EchartsWrapper';
import fetch2 from "../../../../../utils/fetch";

export default ({ analysisId, sessionId }) => {
    const chartRef = useRef(null);
    const [fcPValueData, setFcPValueData] = useState([]);

    const plotData = fcPValueData.map(e => [e.avgExp, e.FC]);

    // Sort the data based on avgExp
    const sortedData = [...fcPValueData].sort((a, b) => a.avgExp - b.avgExp);

    // Create the fittedLineData from the sorted data as a single array of coordinates
    const fittedLineData = sortedData.map(e => [e.avgExp, e.fitted]);

    useEffect(() => {
        async function fetchData() {
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                setFcPValueData(resJson);
            } catch (error) {
                console.error("Error fetching data:", error);
                // Handle the error appropriately, e.g., set an error state
            }
        }

        fetchData();
    }, []);

    const option = {
        progressiveStep: 5000,
        animation: false,
        xAxis: {
            type: 'value',
            name: 'Average Expression'
        },
        yAxis: {
            type: 'value',
            name: 'Log2FC'
        },
        tooltip: {},
        visualMap: [{
            seriesIndex: 0,
            pieces: [
                {
                    min: 1,
                    label: "Up-regulated",
                    color: "#F40100"
                },
                {
                    max: -1,
                    label: "Down-regulated",
                    color: "#1312FF"
                },
                {
                    min: -1,
                    max: 1,
                    label: "Non-significant",
                    color: "#808080"
                }
            ],
            bottom: 20,
            left: 'center',
            orient: 'horizontal'
        }],
        series: [
            {
                symbolSize: 3,
                data: plotData,
                type: 'scatterGL',
                silent: true,
                animation: false,
                sampling: 'average',
                postEffect: {
                    enable: false,
                },
            },
            {
                symbolSize: 3,
                data: fittedLineData,
                type: 'scatterGL',
                silent: true,
                animation: false,
                sampling: 'average',
                postEffect: {
                    enable: false,
                },
                itemStyle: {
                    color: '#066105'
                }
            },
            {
                type: 'line',
                markLine: {
                    data: [
                        {yAxis: 1},
                        {yAxis: -1},
                    ],
                    lineStyle: {
                        color: '#000000'
                    }
                }
            }
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
            },
        ],
    };
    return (
        <EchartsWrapper>
            <ReactEcharts
                option={option}
                style={{height: "700px"}}
            ></ReactEcharts>
        </EchartsWrapper>
    )
};
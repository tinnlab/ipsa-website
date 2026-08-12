import React, { useEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";
import {
    VennDiagramChart,
    extractSets,
    VennDiagramController,
} from "chartjs-chart-venn";
import { Table, Input, Space, Button } from "antd";
import { SearchOutlined, DownloadOutlined } from "@ant-design/icons";
import Typography from "antd/lib/typography";
import GeneLoading from "../../../../../components/GeneLoading";
import AnalysisUtils from "../../Session/components/AnalysisUtils";

export default ({inputData, selectedDatasets}) => {
    const [chartInstance, setChartInstance] = useState(null);
    const [genesIdList, setGenesIdList] = useState([])
    const [genesDetails, setGenesDetails] = useState([])
    const [intersectLabel, setIntersectLabel] = useState([])
    const [intersectValue, setIntersectValue] = useState([])

    Chart.register(...registerables);

    VennDiagramController.prototype.drawLabels = function (ctx) {
        const meta = this._cachedMeta;
        ctx.save();

        const l = meta._layout;
        const setLayoutScale = meta.xScale;
        const setLayoutFont = meta._setLayoutFont;
        const labelLayoutScale = meta.yScale;
        const labelLayoutFont = meta._labelLayoutFont;

        if (labelLayoutScale?.options.ticks.display) {
            // set labels
            ctx.font = labelLayoutFont.string;
            ctx.fillStyle = labelLayoutFont.color;
            ctx.textBaseline = "middle";

            const labels = this.chart.data.labels;
            l.sets.forEach((set, i) => {
                ctx.textAlign = set.align === "middle" ? "center" : set.align;
                ctx.textBaseline = set.verticalAlign;
                ctx.fillText(labels[i], set.text.x, set.text.y);
            });
        }

        if (setLayoutScale?.options.ticks.display) {
            ctx.font = setLayoutFont.string;
            ctx.fillStyle = setLayoutFont.color;
            ctx.textBaseline = "middle";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const values = this.getDataset().data;
            const totalElements = values.reduce((total, item) => total + item.value, 0);

            l.intersections.forEach((intersection, i) => {
                const percentage = ((values[i].value / totalElements) * 100).toFixed(2);
                ctx.fillText(
                    values[i].value.toLocaleString(),
                    intersection.text.x,
                    intersection.text.y - 10
                );
                ctx.fillText(`${percentage}%`, intersection.text.x, intersection.text.y);
            });
        }

        ctx.restore();
    };

    if (inputData.length === 0) {
        console.log('[VennDiagram] Showing GeneLoading - inputData.length:', inputData.length);
        return <GeneLoading />;
    }

    useEffect(() => {
        let filteredData = inputData.filter((data) => selectedDatasets.includes(data.analysisId));
        const handleClick = (event, elements) => {
            let geneLists = elements[0]?.element.$context.raw.values
            setIntersectLabel(elements[0]?.element.$context.raw.label)
            setIntersectValue(elements[0]?.element.$context.raw.value)

            setGenesIdList(geneLists)
        };

        const config = {
            type: "venn",
            data: extractSets(filteredData),
            options: {
                borderWidth: 1,
                backgroundColor: [
                    "rgba(255, 26, 104, 0.2)",
                    "rgba(54, 162, 235, 0.2)",
                    "rgba(255, 206, 86, 0.2)",
                    "rgba(75, 192, 192, 0.2)",
                    "rgba(153, 102, 255, 0.2)",
                    "rgba(255, 159, 64, 0.2)",
                ],
                borderColor: [
                    "rgba(255, 26, 104, 1)",
                    "rgba(54, 162, 235, 1)",
                    "rgba(255, 206, 86, 1)",
                    "rgba(75, 192, 192, 1)",
                    "rgba(153, 102, 255, 1)",
                    "rgba(255, 159, 64, 1)",
                ],
                scales: {
                    x: {
                        ticks: {
                            font: {
                                family: "Arial",
                                size: 10,
                            },
                            color: "green",
                        },
                    },
                },
                onClick: handleClick,
                plugins: {
                    legend: {
                        display: false,
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const setLabels = context.dataset.data[context.dataIndex].sets;
                                const value = context.dataset.data[context.dataIndex].value;
                                const totalValue = extractSets(filteredData).datasets[0].data.reduce(
                                    (total, item) => total + item.value,
                                    0
                                );
                                const percentage = ((value / totalValue) * 100).toFixed(2);
                                return `${setLabels.join(" ∩ ")}: ${percentage}%`;
                            },
                        },
                    },
                },
                layout: {
                    padding: {
                        top: 50,
                        right: 50,
                        bottom: 50,
                        left: 50,
                    },
                },
                maintainAspectRatio: false,
                responsive: true,
            },
        };

        if (chartInstance) {
            chartInstance.destroy();
        }

        let ctx = document.getElementById("canvasVenn").getContext("2d");
        let chartInstanceRes = new VennDiagramChart(ctx, config);
        setChartInstance(chartInstanceRes);

        // Auto-select the intersection with the most datasets (analyses)
        const vennSets = extractSets(filteredData);
        const intersections = vennSets.datasets[0].data;

        // Find intersection with maximum number of sets (most analyses)
        let maxIntersection = null;
        let maxSetsCount = 0;

        intersections.forEach(intersection => {
            const setsCount = intersection.sets.length;
            if (setsCount > maxSetsCount) {
                maxSetsCount = setsCount;
                maxIntersection = intersection;
            }
        });

        // If found an intersection with at least 2 analyses, auto-select it
        if (maxIntersection && maxSetsCount >= 2) {
            setIntersectLabel(maxIntersection.label);
            setIntersectValue(maxIntersection.value);
            setGenesIdList(maxIntersection.values);
        }
    }, [inputData, selectedDatasets]);

    useEffect(() => {
        Meteor.asyncCallWithNotification("visualization.getGeneInfo", genesIdList).then(async (data) => {
            //sort data by _id following the order of genesIdList
            let geneDetails = new Map()
            data.forEach(gene => {
                geneDetails.set(gene._id, gene)
            })
            let geneDetailsSorted = []
            genesIdList.forEach(geneId => {
                geneDetailsSorted.push(geneDetails.get(geneId))
            })
            // get the description list from geneDetailsSorted
            // filter out undefined from geneDetailsSorted
            geneDetailsSorted = geneDetailsSorted.filter(gene => gene !== undefined)
            setGenesDetails(geneDetailsSorted)
        })
    }, [genesIdList])

    const exportPNG = () => {
        const canvas = document.getElementById('canvasVenn');
        if (canvas) {
            // Create a temporary canvas to add white background
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');

            // Fill with white background
            tempCtx.fillStyle = 'white';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw the chart on top
            tempCtx.drawImage(canvas, 0, 0);

            // Export
            const url = tempCanvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = url;
            link.download = 'gene-venn-diagram.png';
            link.click();
        }
    };

    const columns = [
        {
            title: "Gene ID",
            dataIndex: "_id",
            key: "_id",
            sorter: (a, b) => a._id.localeCompare(b._id),
            sortDirections: ['ascend', 'descend', 'ascend'],
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Search Gene ID"
                        value={selectedKeys[0]}
                        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                        onPressEnter={() => confirm()}
                        style={{ width: 188, marginBottom: 8, display: "block" }}
                    />
                    <Space>
                        <Button
                            type="primary"
                            onClick={() => confirm()}
                            icon={<SearchOutlined />}
                            size="small"
                            style={{ width: 90 }}
                        >
                            Search
                        </Button>
                        <Button onClick={() => clearFilters()} size="small" style={{ width: 90 }}>
                            Reset
                        </Button>
                    </Space>
                </div>
            ),
            filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1890ff" : undefined }} />
            ),
            onFilter: (value, record) =>
                record._id.toString().toLowerCase().includes(value.toLowerCase()),
        },
        {
            title: "Symbol",
            dataIndex: "symbol",
            key: "symbol",
            sorter: (a, b) => a.symbol.localeCompare(b.symbol),
            sortDirections: ['ascend', 'descend', 'ascend'],
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Search Symbol"
                        value={selectedKeys[0]}
                        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                        onPressEnter={() => confirm()}
                        style={{ width: 188, marginBottom: 8, display: "block" }}
                    />
                    <Space>
                        <Button
                            type="primary"
                            onClick={() => confirm()}
                            icon={<SearchOutlined />}
                            size="small"
                            style={{ width: 90 }}
                        >
                            Search
                        </Button>
                        <Button onClick={() => clearFilters()} size="small" style={{ width: 90 }}>
                            Reset
                        </Button>
                    </Space>
                </div>
            ),
            filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1890ff" : undefined }} />
            ),
            onFilter: (value, record) =>
                record.symbol.toString().toLowerCase().includes(value.toLowerCase()),
        },
        {
            title: "Description",
            dataIndex: "description",
            key: "description",
            sorter: (a, b) => a.description.localeCompare(b.description),
            sortDirections: ['ascend', 'descend', 'ascend'],
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Search Description"
                        value={selectedKeys[0]}
                        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                        onPressEnter={() => confirm()}
                        style={{ width: 188, marginBottom: 8, display: "block" }}
                    />
                    <Space>
                        <Button
                            type="primary"
                            onClick={() => confirm()}
                            icon={<SearchOutlined />}
                            size="small"
                            style={{ width: 90 }}
                        >
                            Search
                        </Button>
                        <Button onClick={() => clearFilters()} size="small" style={{ width: 90 }}>
                            Reset
                        </Button>
                    </Space>
                </div>
            ),
            filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1890ff" : undefined }} />
            ),
            onFilter: (value, record) =>
                record.description.toString().toLowerCase().includes(value.toLowerCase()),
        },
    ];


    return (
        <>
            <div className="App" style={{ height: "500px" }}>
                <canvas id="canvasVenn"></canvas>
            </div>
            <div style={{ marginTop: "10px", marginBottom: "10px" }}>
                <Button icon={<DownloadOutlined/>} onClick={exportPNG}>
                    Export as PNG
                </Button>
            </div>
            {
                genesDetails.length > 0 &&
                <>
                    <Typography.Text level={4}>Intersection: {intersectLabel}</Typography.Text>
                    <Typography.Text level={4}>Number of Genes: {intersectValue}</Typography.Text>
                    <div style={{ marginTop: "10px", marginBottom: "10px" }}>
                        <Button
                            icon={<DownloadOutlined/>}
                            onClick={() => AnalysisUtils.exportTableCsv({
                                rows: genesDetails,
                                columns: [
                                    {header: 'Gene ID', field: '_id'},
                                    {header: 'Symbol', field: 'symbol'},
                                    {header: 'Description', field: 'description'},
                                ],
                                fileName: 'IntersectionGenes.csv',
                            })}
                        >
                            Download CSV
                        </Button>
                    </div>
                    <Table
                        columns={columns}
                        dataSource={genesDetails}
                        rowKey="_id"
                        pagination={false}
                        scroll={{ y: 600 }}
                        rowClassName={() => 'custom-row'}
                    />
                </>
            }
        </>
    );
};
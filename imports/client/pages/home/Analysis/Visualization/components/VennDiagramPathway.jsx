import React, { useEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";
import {
    VennDiagramChart,
    extractSets,
    VennDiagramController,
} from "chartjs-chart-venn";
import { Table, Input, Space, Button, Checkbox, Select, Typography, Divider, InputNumber } from "antd";
import { SearchOutlined, DownloadOutlined } from "@ant-design/icons";
import GeneLoading from "../../../../../components/GeneLoading";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";

const { Text } = Typography;
const { Option } = Select;

export default ({inputData, selectedDatasets, configs, dbId, dbName}) => {
    const [chartInstance, setChartInstance] = useState(null);
    const [pathwayIdList, setPathwayIdList] = useState([])
    const [pathwayDetails, setPathwayDetails] = useState([])
    const [intersectLabel, setIntersectLabel] = useState([])
    const [intersectValue, setIntersectValue] = useState([])

    // Get global settings
    const { globalSettings } = useGlobalSettings();

    // Filtering state - initialize from global settings
    const [enableSignificantFilter, setEnableSignificantFilter] = useState(true)
    const [fdrThreshold, setFdrThreshold] = useState(globalSettings.pValueFDR)
    const [scoreThreshold, setScoreThreshold] = useState(globalSettings.enrichmentScore)
    const [customFdrInput, setCustomFdrInput] = useState('')
    const [customScoreInput, setCustomScoreInput] = useState('')

    // Sync with global settings when they change
    useEffect(() => {
        setFdrThreshold(globalSettings.pValueFDR);
        setScoreThreshold(globalSettings.enrichmentScore);
    }, [globalSettings]);

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
        console.log('[VennDiagramPathway] Showing GeneLoading - inputData.length:', inputData.length);
        return <GeneLoading />;
    }

    useEffect(() => {
        let filteredData = inputData.filter((data) => selectedDatasets.includes(data.analysisId));
        const handleClick = (event, elements) => {
            let pathwayLists = elements[0]?.element.$context.raw.values
            setIntersectLabel(elements[0]?.element.$context.raw.label)
            setIntersectValue(elements[0]?.element.$context.raw.value)

            setPathwayIdList(pathwayLists)
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

        let ctx = document.getElementById("canvasVennPathway").getContext("2d");
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
            setPathwayIdList(maxIntersection.values);
        }
    }, [inputData, selectedDatasets, enableSignificantFilter, fdrThreshold, scoreThreshold]);

    useEffect(() => {
        // Get pathway information from configs
        if (pathwayIdList.length === 0 || !configs || configs.length === 0) {
            setPathwayDetails([])
            return
        }

        // Find geneSets for the current database
        let geneSet;
        for (let config of configs) {
            if (config.geneSets && config.geneSets.find(e => e.id === dbId)) {
                geneSet = config.geneSets.filter(e => e.id === dbId)[0].geneSets
                break;
            }
        }

        if (!geneSet) {
            setPathwayDetails([])
            return
        }

        let genSetObj = geneSet.reduce((acc, curr) => {
            acc[curr.id] = curr
            return acc
        }, {})

        // Map pathway IDs to pathway details
        let pathwayDetailsData = pathwayIdList
            .map(pathwayId => {
                const pathway = genSetObj[pathwayId]
                if (pathway) {
                    return {
                        id: pathway.id,
                        name: pathway.name,
                        database: dbName || dbId
                    }
                }
                return null
            })
            .filter(p => p !== null)

        setPathwayDetails(pathwayDetailsData)
    }, [pathwayIdList, configs, dbId, dbName])

    const exportPNG = () => {
        const canvas = document.getElementById('canvasVennPathway');
        if (canvas) {
            // Create a temporary canvas with 2x resolution for higher quality export
            const scale = 2;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width * scale;
            tempCanvas.height = canvas.height * scale;
            const tempCtx = tempCanvas.getContext('2d');

            // Scale the context
            tempCtx.scale(scale, scale);

            // Fill with white background
            tempCtx.fillStyle = 'white';
            tempCtx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw the chart on top
            tempCtx.drawImage(canvas, 0, 0);

            // Export
            const url = tempCanvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = url;
            link.download = 'pathway-venn-diagram.png';
            link.click();
        }
    };

    const columns = [
        {
            title: "Pathway ID",
            dataIndex: "id",
            key: "id",
            sorter: (a, b) => a.id.localeCompare(b.id),
            sortDirections: ['ascend', 'descend', 'ascend'],
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Search Pathway ID"
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
                record.id.toString().toLowerCase().includes(value.toLowerCase()),
        },
        {
            title: "Pathway Name",
            dataIndex: "name",
            key: "name",
            sorter: (a, b) => a.name.localeCompare(b.name),
            sortDirections: ['ascend', 'descend', 'ascend'],
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Search Pathway Name"
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
                record.name.toString().toLowerCase().includes(value.toLowerCase()),
        },
        {
            title: "Database",
            dataIndex: "database",
            key: "database",
            sorter: (a, b) => a.database.localeCompare(b.database),
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
    ];


    return (
        <>
            <h5>Pathway Venn Diagram</h5>

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
                                                            setFdrThreshold(val);
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
                                                            setScoreThreshold(val);
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
                            </>
                        )}
                    </Space>
                </Space>
            </div>

            <Divider style={{margin: '12px 0'}} />

            <div className="App" style={{ height: "500px" }}>
                <canvas id="canvasVennPathway"></canvas>
            </div>
            <div style={{ marginTop: "10px", marginBottom: "10px" }}>
                <Button icon={<DownloadOutlined/>} onClick={exportPNG}>
                    Export as PNG
                </Button>
            </div>
            {
                pathwayDetails.length > 0 &&
                <>
                    <Typography.Text level={4}>Intersection: {intersectLabel}</Typography.Text>
                    <br/>
                    <Typography.Text level={4}>Number of Pathways: {intersectValue}</Typography.Text>
                    <Table
                        columns={columns}
                        dataSource={pathwayDetails}
                        rowKey="id"
                        pagination={false}
                        scroll={{ y: 600 }}
                        rowClassName={() => 'custom-row'}
                    />
                </>
            }
        </>
    );
};

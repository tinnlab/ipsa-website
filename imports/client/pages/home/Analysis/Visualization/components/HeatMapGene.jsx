import React, {useEffect, useRef, useState} from "react";
import ReactEcharts from "echarts-for-react";
import EchartsWrapper from './EchartsWrapper';
import GeneLoading from "../../../../../components/GeneLoading";
import {agnes} from 'ml-hclust';
import {kmeans} from 'ml-kmeans';
import {Checkbox, Select, Space, Typography, Radio, Slider, Divider, Button} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";
import { buildDisplayOrder, buildPositionMap } from "../../../../../../utils/heatmapOrdering";
import AnalysisUtils from "../../Session/components/AnalysisUtils";

const {Text} = Typography;
const {Option} = Select;

export default ({inputData, genesIdList}) => {
    const [plotFDRpValueData, setPlotFDRpValueData] = useState([])
    const [plotLogFCData, setPlotLogFCData] = useState([])
    const [analysisNames, setAnalysisNames] = useState([])
    const [genesDescriptionList, setGenesDescriptionList] = useState([])
    // Gene list (id/symbol/description) for the displayed genes, used for CSV export.
    const [geneExportList, setGeneExportList] = useState([])
    const [enableClustering, setEnableClustering] = useState(false)
    const [clusteringMethod, setClusteringMethod] = useState('ward')
    const [distanceMetric, setDistanceMetric] = useState('euclidean')
    const [geneOrder, setGeneOrder] = useState([])
    const chartRef = useRef(null);

    // Get global settings
    const { globalSettings } = useGlobalSettings();

    // Analysis selection state
    const [selectedAnalyses, setSelectedAnalyses] = useState([])

    // DE filtering state - initialize from global settings
    const [enableDEFilter, setEnableDEFilter] = useState(true)
    const [fdrThreshold, setFdrThreshold] = useState(globalSettings.pValueFDR)
    const [fcThreshold, setFcThreshold] = useState(globalSettings.foldChange)
    const [filteredGenesCount, setFilteredGenesCount] = useState(0)

    const MAX_GENES_FOR_DIRECT_CLUSTERING = 200
    const TARGET_CLUSTERS_FOR_KMEANS = 150

    // Sync with global settings when they change
    useEffect(() => {
        setFdrThreshold(globalSettings.pValueFDR);
        setFcThreshold(globalSettings.foldChange);
    }, [globalSettings]);

    // Initialize selected analyses with all analyses when inputData changes
    useEffect(() => {
        if (inputData && inputData.length > 0) {
            const allAnalysisLabels = inputData.map(d => d.label)
            setSelectedAnalyses(allAnalysisLabels)
        }
    }, [inputData.length])

    // Filter inputData based on selected analyses
    const filteredInputData = React.useMemo(() => {
        if (selectedAnalyses.length === 0) return inputData
        return inputData.filter(d => selectedAnalyses.includes(d.label))
    }, [inputData, selectedAnalyses])

    // Filter DE genes based on criteria
    const filteredGenesIndices = React.useMemo(() => {
        if (!enableDEFilter || filteredInputData.length === 0) {
            setFilteredGenesCount(genesIdList.length)
            return genesIdList.map((_, i) => i)
        }

        const deGeneIndices = []
        const numGenes = filteredInputData[0]?.values?.length || 0

        for (let geneIdx = 0; geneIdx < numGenes; geneIdx++) {
            // Gene is DE if it meets criteria in ANY analysis
            const isDE = filteredInputData.some(analysis => {
                const gene = analysis.values[geneIdx]
                return gene &&
                       gene.pValueFDR < fdrThreshold &&
                       Math.abs(gene.FC) > fcThreshold
            })

            if (isDE) {
                deGeneIndices.push(geneIdx)
            }
        }

        setFilteredGenesCount(deGeneIndices.length)
        return deGeneIndices
    }, [filteredInputData, genesIdList, enableDEFilter, fdrThreshold, fcThreshold])

    useEffect(() => {
        Meteor.asyncCallWithNotification("visualization.getGeneInfo", genesIdList).then(async (data) => {
            const geneDetails = new Map()
            data.forEach(gene => {
                geneDetails.set(gene._id, gene)
            })
            // Build a details list ALIGNED to genesIdList (index i -> gene i). Keeping
            // it aligned (rather than compacting out genes with no GeneInfo doc) is
            // essential: filteredGenesIndices are positions in genesIdList / the
            // per-analysis `values` arrays, and the heatmap plots each gene at that
            // position. Genes with no GeneInfo doc fall back to their raw id for the
            // label so alignment is preserved.
            let alignedDetails = genesIdList.map(geneId => {
                const info = geneDetails.get(geneId)
                return {
                    id: geneId,
                    symbol: info?.symbol || geneId,
                    description: info?.description || '',
                }
            })

            // Filter down to the displayed genes based on DE filtering.
            if (enableDEFilter) {
                alignedDetails = filteredGenesIndices.map(idx => alignedDetails[idx]).filter(Boolean)
            }

            setGenesDescriptionList(alignedDetails.map(gene => gene.symbol))
            setGeneExportList(alignedDetails.map(gene => ({
                id: gene.id,
                symbol: gene.symbol,
                description: gene.description,
            })))
        })
    }, [inputData, genesIdList, enableDEFilter, filteredGenesIndices])

    useEffect(() => {
        let plotFDRpValueData = []
        let plotLogFCData = []

        filteredInputData.forEach((data, i) => {
            let {label, values} = data

            // Only process filtered genes
            const genesToProcess = enableDEFilter ? filteredGenesIndices : values.map((_, idx) => idx)

            genesToProcess.forEach((originalGeneIdx, newGeneIdx) => {
                const gene = values[originalGeneIdx]
                if (!gene) return

                let logPValueFDR = gene.pValueFDR >= 1e-16 ? -Math.log10(gene.pValueFDR) : -Math.log10(1e-16);
                plotFDRpValueData.push([
                    i,
                    newGeneIdx,
                    logPValueFDR
                ])
                plotLogFCData.push([
                    i,
                    newGeneIdx,
                    gene.FC
                ])
            })
        })
        setPlotFDRpValueData(plotFDRpValueData)
        setPlotLogFCData(plotLogFCData)
    }, [filteredInputData, genesIdList, enableDEFilter, filteredGenesIndices])

    useEffect(() => {
        let analysisNamesVar = filteredInputData.map((data, i) => {
            return data.label
        })
        setAnalysisNames(analysisNamesVar)
    }, [filteredInputData, genesIdList])

    // Perform hybrid k-means + hierarchical clustering on genes
    useEffect(() => {
        const effectiveGeneCount = enableDEFilter ? filteredGenesIndices.length : genesIdList.length

        if (!enableClustering || filteredInputData.length === 0 || effectiveGeneCount === 0) {
            // No clustering - use original order
            setGeneOrder(Array.from({length: effectiveGeneCount}, (_, i) => i))
            return
        }

        try {
            // Build gene vectors (rows) for filtered genes
            // Each gene is represented by its log2FC values across all analyses
            const geneVectors = []
            const genesToCluster = enableDEFilter ? filteredGenesIndices : Array.from({length: genesIdList.length}, (_, i) => i)

            genesToCluster.forEach(originalGeneIdx => {
                const vector = filteredInputData.map(analysis => analysis.values[originalGeneIdx]?.FC || 0)
                geneVectors.push(vector)
            })

            if (geneVectors.length === 0) {
                setGeneOrder(Array.from({length: effectiveGeneCount}, (_, i) => i))
                return
            }

            const numGenes = geneVectors.length
            let clusterCentroids = []
            let geneToCluster = [] // Maps gene index to cluster index

            // Strategy: If too many genes, use k-means first to reduce dimensionality
            if (numGenes > MAX_GENES_FOR_DIRECT_CLUSTERING) {
                console.log(`Using hybrid k-means + hierarchical clustering for ${numGenes} genes`)

                // Step 1: K-means clustering to reduce to ~150 clusters
                const numClusters = Math.min(TARGET_CLUSTERS_FOR_KMEANS, Math.floor(numGenes / 2))
                const kmeansResult = kmeans(geneVectors, numClusters, {
                    initialization: 'kmeans++',
                    seed: 42
                })

                // Store cluster assignments
                geneToCluster = kmeansResult.clusters

                // Step 2: Calculate centroids for each cluster
                clusterCentroids = kmeansResult.centroids

            } else {
                // Small dataset: treat each gene as its own cluster
                console.log(`Using direct hierarchical clustering for ${numGenes} genes`)
                clusterCentroids = geneVectors
                geneToCluster = geneVectors.map((_, i) => i)
            }

            // Step 3: Compute distance matrix for centroids
            const numCentroids = clusterCentroids.length
            const distanceMatrix = []

            for (let i = 0; i < numCentroids; i++) {
                const row = []
                for (let j = 0; j < numCentroids; j++) {
                    if (i === j) {
                        row.push(0)
                    } else {
                        let dist
                        if (distanceMetric === 'euclidean') {
                            dist = Math.sqrt(
                                clusterCentroids[i].reduce((sum, val, k) => {
                                    return sum + Math.pow(val - clusterCentroids[j][k], 2)
                                }, 0)
                            )
                        } else if (distanceMetric === 'manhattan') {
                            dist = clusterCentroids[i].reduce((sum, val, k) => {
                                return sum + Math.abs(val - clusterCentroids[j][k])
                            }, 0)
                        }
                        row.push(dist)
                    }
                }
                distanceMatrix.push(row)
            }

            // Step 4: Perform hierarchical clustering on centroids
            const tree = agnes(distanceMatrix, {
                method: clusteringMethod,
                isDistanceMatrix: true
            })

            // Step 5: Extract cluster order from dendrogram
            const clusterOrder = []
            const traverse = (node) => {
                if (node.isLeaf) {
                    clusterOrder.push(node.index)
                } else {
                    if (node.children) {
                        node.children.forEach(child => traverse(child))
                    }
                }
            }
            traverse(tree)

            // Step 6: Map back to gene order
            // For each cluster in order, add all genes belonging to that cluster
            const finalGeneOrder = []
            clusterOrder.forEach(clusterIdx => {
                // Find all genes in this cluster
                const genesInCluster = []
                geneToCluster.forEach((assignedCluster, geneIdx) => {
                    if (assignedCluster === clusterIdx) {
                        genesInCluster.push(geneIdx)
                    }
                })

                // Sort genes within cluster by distance to centroid
                if (numGenes > MAX_GENES_FOR_DIRECT_CLUSTERING) {
                    const centroid = clusterCentroids[clusterIdx]
                    genesInCluster.sort((a, b) => {
                        const distA = Math.sqrt(
                            geneVectors[a].reduce((sum, val, k) => {
                                return sum + Math.pow(val - centroid[k], 2)
                            }, 0)
                        )
                        const distB = Math.sqrt(
                            geneVectors[b].reduce((sum, val, k) => {
                                return sum + Math.pow(val - centroid[k], 2)
                            }, 0)
                        )
                        return distA - distB
                    })
                }

                finalGeneOrder.push(...genesInCluster)
            })

            setGeneOrder(finalGeneOrder)
            console.log(`Clustering complete: ${numGenes} genes ordered into ${numCentroids} clusters`)

        } catch (error) {
            console.error('Clustering error:', error)
            const effectiveGeneCount = enableDEFilter ? filteredGenesIndices.length : genesIdList.length
            setGeneOrder(Array.from({length: effectiveGeneCount}, (_, i) => i))
        }
    }, [filteredInputData, genesIdList, enableClustering, clusteringMethod, distanceMetric, enableDEFilter, filteredGenesIndices])

    if (plotFDRpValueData.length === 0 || plotLogFCData.length === 0 || genesDescriptionList.length === 0) {
        console.log('[HeatMapGene] Showing GeneLoading - plotFDRpValueData:', plotFDRpValueData.length, 'plotLogFCData:', plotLogFCData.length, 'genesDescriptionList:', genesDescriptionList.length);
        return <GeneLoading />;
    }

    // Apply clustering order to genes via the shared ordering helpers (imports/utils/heatmapOrdering.js).
    // buildDisplayOrder guards against a stale/length-mismatched geneOrder (identity fallback), and
    // buildPositionMap gives O(1) remaps instead of geneOrder.indexOf() inside a .map() (O(n^2)).
    const geneRowOrder = buildDisplayOrder(genesDescriptionList.length, geneOrder)
    const geneRowPosMap = buildPositionMap(geneRowOrder)
    const orderedGenesDescriptionList = geneRowOrder.map(i => genesDescriptionList[i])

    // Reorder heatmap data according to clustering. A point whose gene index has no display
    // position is dropped rather than mislocated (mirrors the pathway heatmap's guard).
    const remapGeneRow = (point) => {
        const [analysisIdx, geneIdx, value] = point
        const newGeneIdx = geneRowPosMap[geneIdx]
        if (newGeneIdx === undefined || newGeneIdx < 0) return null
        return [analysisIdx, newGeneIdx, value]
    }
    const orderedPlotFDRpValueData = plotFDRpValueData.map(remapGeneRow).filter(Boolean)
    const orderedPlotLogFCData = plotLogFCData.map(remapGeneRow).filter(Boolean)

    // Calculate dynamic min/max for -log10 pValueFDR with cap at 10
    const fdrValues = orderedPlotFDRpValueData.map(point => point[2])
    const maxFDR = fdrValues.length > 0 ? Math.max(...fdrValues) : 5
    const fdrScaleLimit = Math.min(10, Math.max(5, Math.ceil(maxFDR))) // Cap at 10, at least 5

    // Calculate dynamic min/max for log2FC color scale with cap to prevent extreme outliers
    const fcValues = orderedPlotLogFCData.map(point => point[2])
    const maxAbsFC = fcValues.length > 0 ? Math.max(...fcValues.map(v => Math.abs(v))) : 1
    const fcScaleLimit = Math.min(5, Math.max(1, Math.ceil(maxAbsFC))) // Cap at 5, at least 1

    // Calculate dynamic side-by-side layout based on number of analyses
    const numAnalyses = analysisNames.length
    const cellWidth = Math.max(30, Math.min(50, 300 / numAnalyses)) // Dynamic: 30-50px per column
    const gridWidth = Math.max(numAnalyses * cellWidth, 250)
    const leftMargin = 80 // Space for y-axis labels
    const gridGap = numAnalyses > 8 ? 40 : 100 // Reduce gap for many datasets
    const chartHeight = 800
    const totalChartWidth = leftMargin + gridWidth * 2 + gridGap + 80 // +80 for right margin

    const gridConfig = [
        {
            left: leftMargin,
            width: gridWidth,
            top: '10%',
            bottom: 200,
        },
        {
            left: leftMargin + gridWidth + gridGap,
            width: gridWidth,
            top: '10%',
            bottom: 200,
        }
    ]

    const graphicConfig = [
        {
            type: 'text',
            left: leftMargin,
            top: '5%',
            style: {
                text: '-log10 pValue.FDR',
                font: '14px sans-serif',
            },
        },
        {
            type: 'text',
            left: leftMargin + gridWidth + gridGap,
            top: '5%',
            style: {
                text: 'Log2FC',
                font: '14px sans-serif',
            },
        },
    ]

    const yAxisConfig = [
        {
            gridIndex: 0,
            type: 'category',
            data: orderedGenesDescriptionList,
            splitArea: { show: true },
            show: true,
            axisLabel: {
                width: 70,
                overflow: 'truncate',
                interval: 0
            }
        },
        {
            gridIndex: 1,
            type: 'category',
            data: orderedGenesDescriptionList,
            splitArea: { show: true },
            show: false
        }
    ]

    const dataZoomConfig = [
        {
            type: 'slider',
            yAxisIndex: [0, 1],
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
            yAxisIndex: [0, 1],
            start: 0,
            end: 100,
            zoomOnMouseWheel: false,
            moveOnMouseMove: true,
            moveOnMouseWheel: true
        },
        {
            type: 'slider',
            xAxisIndex: [0, 1],
            height: 20,
            bottom: 30,
            start: 0,
            end: 100,
            handleSize: 40,
            showDetail: false
        },
        {
            type: 'inside',
            id: 'insideX',
            xAxisIndex: [0, 1],
            start: 0,
            end: 100,
            zoomOnMouseWheel: true,
            moveOnMouseMove: false,
            moveOnMouseWheel: false
        }
    ]

    const visualMapConfig = [
        {
            min: 0,
            max: fdrScaleLimit,
            calculable: true,
            orient: 'vertical',
            right: 40,
            top: '30%',
            seriesIndex: 0,
            inRange: {
                color: ['#ffffff', '#B80F05'],
                symbolSize: [50, 50]
            },
        },
        {
            min: -fcScaleLimit,
            max: fcScaleLimit,
            calculable: true,
            orient: 'vertical',
            right: 40,
            top: '55%',
            seriesIndex: 1,
            inRange: {
                color: ['#024F98', '#ffffff', '#B80F05'],
                symbolSize: [50, 50]
            },
        }
    ]

    const options = {
        tooltip: {
            position: 'top',
            formatter: function (params) {
                if (!params.data || params.data.length < 3) return 'No data'
                return `${orderedGenesDescriptionList[params.data[1]]} <br /> ${params.seriesName}: ${params.data[2].toFixed(3)}`
            }
        },
        grid: gridConfig,
        graphic: graphicConfig,
        xAxis: [{
            gridIndex: 0,
            type: 'category',
            data: analysisNames,
            splitArea: {
                show: true
            },
            axisLabel: {
                rotate: 90,
                margin: 60,
                align: 'center',
                verticalAlign: 'top',
            }
        },
            {
                gridIndex: 1,
                type: 'category',
                data: analysisNames,
                splitArea: {
                    show: true
                },
                axisLabel: {
                    rotate: 90,
                    margin: 60,
                    align: 'center',
                    verticalAlign: 'top',
                }
            }
        ],
        yAxis: yAxisConfig,
        dataZoom: dataZoomConfig,
        visualMap: visualMapConfig,
        series: [
            {
                name: '-log10 pFDR',
                type: 'heatmap',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: orderedPlotFDRpValueData,
                label: {
                    show: false
                },
                labelLayout: {
                    hideOverlap: true,
                    hideOverlapLayout: 'truncate',
                    overlap: 'truncate',
                    align: 'center',
                    verticalAlign: 'middle'
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }
                },
                itemStyle: {
                    borderWidth: 1,
                    borderColor: 'white',
                    borderType: 'solid'
                }
            },
            {
                name: 'Log2FC',
                type: 'heatmap',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: orderedPlotLogFCData,
                label: {
                    show: false,
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }
                },
                itemStyle: {
                    borderWidth: 1,
                    borderColor: 'white',
                    borderType: 'solid'
                }
            }
        ]
    }

    return (
        <div>
            <div style={{marginBottom: 16}}>
                {/* Analysis Selection */}
                <Space direction="vertical" size="small" style={{width: '100%', marginBottom: 12}}>
                    <Text strong>Select Analyses:</Text>
                    <Select
                        mode="multiple"
                        placeholder="Select analyses to include"
                        value={selectedAnalyses}
                        onChange={setSelectedAnalyses}
                        style={{width: '100%'}}
                    >
                        {inputData.map(data => (
                            <Option key={data.label} value={data.label}>
                                {data.label}
                            </Option>
                        ))}
                    </Select>
                    <Text type="secondary" style={{fontSize: 12}}>
                        {selectedAnalyses.length} of {inputData.length} analyses selected
                    </Text>
                </Space>

                <Divider style={{margin: '12px 0'}} />

                {/* DE Filtering Controls */}
                <Space direction="vertical" size="small" style={{width: '100%'}}>
                    <Space align="center" wrap>
                        <Checkbox
                            checked={enableDEFilter}
                            onChange={(e) => setEnableDEFilter(e.target.checked)}
                        >
                            Show only DE genes
                        </Checkbox>
                        {enableDEFilter && (
                            <>
                                <Text type="secondary">|</Text>
                                <Text>FDR &lt;</Text>
                                <Select
                                    value={fdrThreshold}
                                    onChange={setFdrThreshold}
                                    style={{width: 80}}
                                    size="small"
                                >
                                    <Option value={0.01}>0.01</Option>
                                    <Option value={0.05}>0.05</Option>
                                    <Option value={0.1}>0.1</Option>
                                </Select>
                                <Text type="secondary">|</Text>
                                <Text>|log2FC| &gt;</Text>
                                <Select
                                    value={fcThreshold}
                                    onChange={setFcThreshold}
                                    style={{width: 80}}
                                    size="small"
                                >
                                    <Option value={0.58}>0.58 (1.5x)</Option>
                                    <Option value={1.0}>1.0 (2x)</Option>
                                    <Option value={1.5}>1.5 (2.8x)</Option>
                                </Select>
                            </>
                        )}
                    </Space>
                    {enableDEFilter && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            Showing {filteredGenesCount} of {genesIdList.length} genes (filtered by DE criteria)
                        </Text>
                    )}
                    <Button
                        icon={<DownloadOutlined/>}
                        size="small"
                        disabled={geneExportList.length === 0}
                        onClick={() => AnalysisUtils.exportTableCsv({
                            rows: geneExportList,
                            columns: [
                                {header: 'Gene ID', field: 'id'},
                                {header: 'Symbol', field: 'symbol'},
                                {header: 'Description', field: 'description'},
                            ],
                            fileName: 'HeatmapGenes.csv',
                        })}
                    >
                        Download genes CSV
                    </Button>
                </Space>

                <Divider style={{margin: '12px 0'}} />

                {/* Clustering Controls */}
                <Space align="center" wrap>
                    <Checkbox
                        checked={enableClustering}
                        onChange={(e) => setEnableClustering(e.target.checked)}
                    >
                        Enable Hierarchical Clustering
                    </Checkbox>
                    {enableClustering && (
                        <>
                            <Text type="secondary">|</Text>
                            <Text>Method:</Text>
                            <Select
                                value={clusteringMethod}
                                onChange={setClusteringMethod}
                                style={{width: 120}}
                                size="small"
                            >
                                <Option value="ward">Ward</Option>
                                <Option value="complete">Complete</Option>
                                <Option value="average">Average</Option>
                                <Option value="single">Single</Option>
                            </Select>
                            <Text type="secondary">|</Text>
                            <Text>Distance:</Text>
                            <Select
                                value={distanceMetric}
                                onChange={setDistanceMetric}
                                style={{width: 120}}
                                size="small"
                            >
                                <Option value="euclidean">Euclidean</Option>
                                <Option value="manhattan">Manhattan</Option>
                            </Select>
                        </>
                    )}
                </Space>
            </div>
            <div style={{ overflowX: 'auto', width: '100%' }}>
                <EchartsWrapper>
                    <ReactEcharts
                        option={options}
                        style={{
                            height: `${chartHeight}px`,
                            width: `${totalChartWidth}px`,
                            minWidth: '100%'
                        }}
                    />
                </EchartsWrapper>
            </div>
        </div>
    )
}
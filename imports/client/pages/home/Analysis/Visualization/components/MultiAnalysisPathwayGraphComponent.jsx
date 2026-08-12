import React, {useEffect, useRef, useState, useCallback, useMemo} from 'react';
import cytoscape from 'cytoscape';
import SelectableResult from "./SelectableResult";
import fcose from 'cytoscape-fcose';
import cytoscapeSvg from 'cytoscape-svg';
import gradientColor from "../../../../../utils/gradientColor";
import {Radio, Select, Typography, InputNumber, Button, Space, Checkbox, Input, Dropdown, Menu} from "antd";
import {DownloadOutlined} from "@ant-design/icons";
import rankPathways from "../../../../../utils/rankPathways";
import _ from "lodash";
import { useGlobalSettings } from "../../../../../contexts/GlobalSettingsContext";

cytoscape.use(fcose);
cytoscape.use(cytoscapeSvg);
const CytoscapeComponent =
    ({
         elements,
         layout,
         style,
         onTapNode,
         onTapEdge,
         onLayoutStop,
         selectedNodes,
         mode,
         selectedAnalyses,
         analyses,
         visualMode
     }) => {
        const containerRef = useRef(null);
        const cyRef = useRef(null);
        const [hoverHTML, setHoverHTML] = useState('');
        const hoverDivRef = useRef(null);
        const legendCanvasRef = useRef(null);
        const gradientCanvasRef = useRef(null);
        const colors = [
            "#1f77b4",
            "#ff7f0e",
            "#2ca02c",
            "#b0073f",
            "#d62728",
            "#9467bd",
            "#8c564b",
            "#e377c2",
            "#7f7f7f",
            "#bcbd22",
            "#17becf",
            "#ff0000",
            "#00ff00",
            "#0000ff",
            "#ffff00",
            "#ff00ff",
        ]

        let analysesObject = {}
        selectedAnalyses.forEach((e, index) => {
            analysesObject[e] = {}
            analysesObject[e]["color"] = colors[index]
            analysesObject[e]["index"] = index + 1
        })

        const initCytoscape = useCallback(() => {
            console.log('initCytoscape');
            if (!cyRef.current) {
                cyRef.current = cytoscape({
                    container: containerRef.current,
                    elements,
                    layout,
                    style,
                });

                // Validate positions after initial layout
                cyRef.current.ready(() => {
                    cyRef.current.nodes().forEach(node => {
                        const pos = node.position();
                        if (isNaN(pos.x) || isNaN(pos.y)) {
                            console.warn('Invalid node position after init, resetting:', node.id());
                            node.position({ x: Math.random() * 100, y: Math.random() * 100 });
                        }
                    });
                });

                if (onTapNode) {
                    cyRef.current.on('tap', 'node', (event) => onTapNode(event.target.id(), event.target.data(), event.target));
                }

                if (onTapEdge) {
                    cyRef.current.on('tap', 'edge', (event) => onTapEdge(event.target.id(), event.target.data(), event.target));
                }

                if (onLayoutStop) {
                    cyRef.current.on('layoutstop', () => onLayoutStop());
                }

                cyRef.current.on('mouseover', 'node', (event) => {
                    const hoverContent = event.target.data('hover');
                    if (hoverContent) {
                        setHoverHTML(hoverContent);
                        hoverDivRef.current.style.display = 'block';
                    } else {
                        setHoverHTML('');
                        hoverDivRef.current.style.display = 'none';
                    }
                });

                cyRef.current.on('mousemove', 'node', (event) => {
                    const position = event.renderedPosition;
                    if (hoverDivRef.current && position) {
                        // Guard against NaN positions from incomplete layout calculations
                        const x = isNaN(position.x) ? 0 : position.x;
                        const y = isNaN(position.y) ? 0 : position.y;

                        hoverDivRef.current.style.display = 'block';
                        hoverDivRef.current.style.left = `${x + 20}px`;
                        hoverDivRef.current.style.top = `${y}px`;
                    }
                });

                cyRef.current.on('mouseout', 'node', () => {
                    setHoverHTML('');
                    hoverDivRef.current.style.display = 'none';
                });
            } else {
                // check if the current nodes are different from the new nodes
                // if they are different, then update the nodes
                const currentNodes = cyRef.current.nodes().map((node) => node.id());
                const newNodes = elements.nodes.map((node) => node.data.id);
                const isNodesDifferent = currentNodes.length !== newNodes.length || currentNodes.some((node) => !newNodes.includes(node));
                const isEdgesDifferent = cyRef.current.edges().length !== elements.edges.length;
                if (isNodesDifferent || isEdgesDifferent) {
                    let newNodeIds = new Set(elements.nodes.map(e => e.data.id))
                    let newEdgeIds = new Set(elements.edges.map(e => e.data.id))
                    cyRef.current.nodes().filter(e => !newNodeIds.has(e.id())).remove()
                    cyRef.current.edges().filter(e => !newEdgeIds.has(e.id())).remove()

                    cyRef.current.add(elements);
                    cyRef.current.style(style);

                    // Run layout with error handling to prevent NaN positions
                    try {
                        const layoutInstance = cyRef.current.layout(layout);
                        layoutInstance.on('layoutstop', () => {
                            // Validate node positions after layout
                            cyRef.current.nodes().forEach(node => {
                                const pos = node.position();
                                if (isNaN(pos.x) || isNaN(pos.y)) {
                                    console.warn('Invalid node position after layout, resetting:', node.id());
                                    node.position({ x: 0, y: 0 });
                                }
                            });
                        });
                        layoutInstance.run();
                    } catch (error) {
                        console.error('Layout error:', error);
                    }
                } else {
                    cyRef.current.style(style);
                }
            }
        }, [elements, layout, style, onTapNode, onTapEdge, onLayoutStop]);

        useEffect(() => {
            initCytoscape();
        }, [initCytoscape]);

        useEffect(() => {
            if (cyRef.current) {
                cyRef.current.elements().unselect();
                const selectedNodesSet = new Set(selectedNodes);
                if (selectedNodesSet.size > 0) {
                    cyRef.current.elements().filter((node) => selectedNodesSet.has(node.id())).select();
                }
            }
        }, [selectedNodes]);

        useEffect(() => {
            return () => {
                if (!containerRef.current) {
                    cyRef.current.destroy();
                }
            };
        }, []);

        useEffect(() => {
            const valueArr = elements.nodes.map(e => {
                const keys = Object.keys(e.data).filter(k => k.includes('value'))
                return keys.map(k => e.data[k])
            }).flat()
            let minValue = valueArr.length > 0 ? Math.min(...valueArr) : -1;
            let maxValue = valueArr.length > 0 ? Math.max(...valueArr) : 1;
            if (Math.abs(minValue) >= Math.abs(maxValue)) {
                maxValue = Math.abs(minValue)
            } else {
                minValue = -Math.abs(maxValue)
            }

            drawLegendCircle(mode);
            drawGradientRectangle(minValue, maxValue);
        }, [mode, selectedAnalyses, elements])

        const drawLegendCircle = (mode) => {
            if (legendCanvasRef.current) {
                const ctx = legendCanvasRef.current.getContext('2d');
                const scale = window.devicePixelRatio || 1;
                const radius = 35 * scale;
                const fontSize = 16 * scale;
                const padding = 70 * scale;
                const boxSize = 10 * scale;
                const boxPadding = 5 * scale;

                if (mode === 'pValueFDR') {
                    const totalHeight = (boxSize + boxPadding) * Object.keys(colors).length + padding * 2;
                    legendCanvasRef.current.width = (radius * 2 + padding * 2 + 100);
                    legendCanvasRef.current.height = totalHeight;
                    legendCanvasRef.current.style.width = `${legendCanvasRef.current.width / scale}px`;
                    legendCanvasRef.current.style.height = `${legendCanvasRef.current.height / scale}px`;

                    ctx.scale(scale, scale);
                    ctx.font = `${fontSize / scale}px Arial`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';

                    // let yPos = padding;
                    let yPos = 0;
                    Object.keys(analysesObject).forEach((method, index) => {
                        ctx.fillStyle = analysesObject[method].color;
                        ctx.fillRect(padding, yPos, boxSize / scale, boxSize / scale);
                        ctx.fillStyle = 'black';
                        let method_name = visualMode === 'multiple' ? analyses[method.split('_')[0]]?.name + '_' + method.split('_')[1] : method.split('_')[1].toUpperCase()
                        ctx.fillText(method_name, padding - 20 + boxSize / scale + boxPadding / scale, yPos + boxSize / (2 * scale));
                        yPos += boxSize / scale + boxPadding / scale;
                    })
                } else if (mode === 'score' || mode === 'significant') {
                    const numMethods = selectedAnalyses.length;
                    const totalWidth = radius * 2 + padding * 2 + 5 * scale;
                    legendCanvasRef.current.width = totalWidth * scale + 150;
                    legendCanvasRef.current.height = (radius * 2 + padding * 2) * scale + 100;
                    legendCanvasRef.current.style.width = `${legendCanvasRef.current.width / scale}px`;
                    legendCanvasRef.current.style.height = `${legendCanvasRef.current.height / scale}px`;

                    ctx.scale(scale, scale);

                    const legendX = (legendCanvasRef.current.width / scale - radius * 2 + 100) / 2 + radius;
                    // const legendY = legendCanvasRef.current.height / (2 * scale) + 20;
                    // const legendY = legendCanvasRef.current.height / (4 * scale);
                    const legendY = 140

                    const anglePerMethod = (2 * Math.PI) / numMethods;

                    const startAngle = -Math.PI / 2;

                    for (let i = 0; i < numMethods; i++) {
                        const sliceStartAngle = startAngle + i * anglePerMethod;
                        const sliceEndAngle = sliceStartAngle + anglePerMethod;

                        ctx.beginPath();
                        ctx.moveTo(legendX, legendY);
                        ctx.arc(legendX, legendY, radius / scale, sliceStartAngle, sliceEndAngle);
                        ctx.closePath();

                        ctx.strokeStyle = 'black';
                        ctx.lineWidth = 1;
                        ctx.stroke();

                        const midAngle = (sliceStartAngle + sliceEndAngle) / 2;

                        const textX = legendX + Math.cos(midAngle) * (radius * 0.7) / scale;
                        const textY = legendY + Math.sin(midAngle) * (radius * 0.7) / scale;

                        ctx.font = `${fontSize / scale}px Arial`;
                        ctx.fillStyle = 'black';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(i + 1, textX, textY);
                    }

                    const indexRadius = 8 * scale;
                    const indexPadding = 3 * scale;

                    ctx.font = `${fontSize / scale}px Arial`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';

                    // let yPos = legendCanvasRef.current.height / (2 * scale) - ((numMethods - 1) * (indexRadius * 2 + indexPadding)) / 2 + 50;
                    let yPos = 120;
                    Object.keys(analysesObject).forEach((method, index) => {
                        ctx.beginPath();
                        ctx.arc(legendCanvasRef.current.width / scale - padding, yPos, indexRadius / scale - 2, 0, 2 * Math.PI);
                        ctx.fillStyle = 'white';
                        ctx.fill();
                        ctx.strokeStyle = 'black';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        ctx.fillStyle = 'black';
                        ctx.fillText(analysesObject[method].index, legendCanvasRef.current.width / scale - padding - 7 + 20, yPos);
                        let method_name = visualMode === 'multiple' ? analyses[method.split('_')[0]]?.name + '_' + method.split('_')[1] : method.split('_')[1].toUpperCase()
                        ctx.fillText(method_name, legendCanvasRef.current.width / scale - padding + 8 + 20, yPos);
                        yPos += indexRadius + indexPadding;
                    })
                }
            }
        };

        const drawGradientRectangle = (minValue = -1, maxValue = 1) => {
            if (gradientCanvasRef.current) {
                const ctx = gradientCanvasRef.current.getContext('2d');
                const scale = window.devicePixelRatio || 1;
                const gradientWidth = 200 * scale;
                const gradientHeight = 30 * scale;
                if (mode === 'score' || mode === 'significant') {
                    gradientCanvasRef.current.width = gradientWidth + 50;
                    gradientCanvasRef.current.height = gradientHeight + 200;
                    gradientCanvasRef.current.style.width = `${gradientWidth / scale}px`;
                    gradientCanvasRef.current.style.height = `${gradientHeight / scale + 90}px`;

                    const gradient = ctx.createLinearGradient(0, 0, gradientWidth, 0);
                    gradient.addColorStop(0, '#0000ff');
                    gradient.addColorStop(0.5, '#ffffff');
                    gradient.addColorStop(1, '#ff0000');

                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, gradientWidth, gradientHeight);

                    // ctx.font = `${10 * scale}px Arial`;
                    ctx.font = `${18 * scale}px Arial`;
                    ctx.fillStyle = 'black';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    ctx.fillText(minValue?.toFixed(2), 55, gradientHeight + 20 * scale);
                    ctx.fillText('0', gradientWidth / 2, gradientHeight + 20 * scale);
                    ctx.fillText(maxValue?.toFixed(2), gradientWidth, gradientHeight + 20 * scale);
                    ctx.fillText('Enrichment Score', gradientWidth / 2 + 5, gradientHeight + 40 * scale);
                } else if (mode === 'pValueFDR') {
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, gradientWidth + 20, gradientHeight + 100);
                }
            }
        };

        const exportPng = () => {
            if (cyRef.current && legendCanvasRef.current && gradientCanvasRef.current) {
                const container = cyRef.current.container();
                const cytoscapeCanvas = container.querySelector("[data-id='layer2-node']");
                const legendCanvas = legendCanvasRef.current;

                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = cytoscapeCanvas.width;
                exportCanvas.height = cytoscapeCanvas.height;
                const exportCtx = exportCanvas.getContext('2d');

                exportCtx.fillStyle = 'white';
                exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
                exportCtx.drawImage(cytoscapeCanvas, 0, 0);

                const legendWidth = legendCanvas.width;
                const legendHeight = legendCanvas.height;
                const legendX = exportCanvas.width - legendWidth;
                const legendY = exportCanvas.height - legendHeight - legendHeight/2 - 20;

                exportCtx.drawImage(legendCanvas, legendX, legendY, legendWidth, legendHeight);

                const gradientCanvas = gradientCanvasRef.current;
                const gradientWidth = gradientCanvas.width;
                const gradientHeight = gradientCanvas.height;
                const gradientX = exportCanvas.width - gradientWidth - 10;
                const gradientY = 20;

                exportCtx.drawImage(gradientCanvas, gradientX, gradientY, gradientWidth, gradientHeight);

                const url = exportCanvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = url;
                link.download = 'graph.png';
                link.click();
            }
        };

        const exportSVG = () => {
            if (cyRef.current && legendCanvasRef.current && gradientCanvasRef.current) {
                // Get SVG from cytoscape
                const svgContent = cyRef.current.svg({ full: true, bg: 'white' });

                // Convert canvases to data URLs
                const legendDataURL = legendCanvasRef.current.toDataURL('image/png');
                const gradientDataURL = gradientCanvasRef.current.toDataURL('image/png');

                // Parse the SVG content
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
                const svgElement = svgDoc.documentElement;

                // Get SVG dimensions
                const svgWidth = parseFloat(svgElement.getAttribute('width'));
                const svgHeight = parseFloat(svgElement.getAttribute('height'));

                // Create image elements for legend and gradient
                const legendImage = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'image');
                legendImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', legendDataURL);
                legendImage.setAttribute('width', legendCanvasRef.current.width / (window.devicePixelRatio || 1));
                legendImage.setAttribute('height', legendCanvasRef.current.height / (window.devicePixelRatio || 1));
                legendImage.setAttribute('x', svgWidth - legendCanvasRef.current.width / (window.devicePixelRatio || 1));
                legendImage.setAttribute('y', svgHeight - legendCanvasRef.current.height / (window.devicePixelRatio || 1) - legendCanvasRef.current.height / (2 * (window.devicePixelRatio || 1)) - 20);

                const gradientImage = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'image');
                gradientImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', gradientDataURL);
                gradientImage.setAttribute('width', gradientCanvasRef.current.width / (window.devicePixelRatio || 1));
                gradientImage.setAttribute('height', gradientCanvasRef.current.height / (window.devicePixelRatio || 1));
                gradientImage.setAttribute('x', svgWidth - gradientCanvasRef.current.width / (window.devicePixelRatio || 1) - 10);
                gradientImage.setAttribute('y', 20);

                // Append images to SVG
                svgElement.appendChild(legendImage);
                svgElement.appendChild(gradientImage);

                // Serialize and download
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgElement);
                const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'graph.svg';
                link.click();
                URL.revokeObjectURL(url);
            }
        };

        return (
            <div style={{position: "relative"}}>
                <div
                    style={{
                        position: "absolute",
                        bottom: "10px",
                        left: "10px",
                        zIndex: 1000,
                    }}
                >
                    <Dropdown
                        menu={{
                            items: [
                                {
                                    key: 'png',
                                    label: 'Export as PNG',
                                    onClick: exportPng
                                },
                                {
                                    key: 'svg',
                                    label: 'Export as SVG',
                                    onClick: exportSVG
                                }
                            ]
                        }}
                        trigger={['click']}
                    >
                        <Button icon={<DownloadOutlined/>}>
                            Export
                        </Button>
                    </Dropdown>
                </div>
                <div ref={containerRef} style={{width: "100%", height: "800px", position: "relative"}}>
                    <canvas
                        ref={legendCanvasRef}
                        style={{
                            position: "absolute",
                            right: "10px",
                            top: "0px",
                            zIndex: 1,
                            pointerEvents: "none",
                        }}
                    />
                    <canvas
                        ref={gradientCanvasRef}
                        style={{
                            position: "absolute",
                            right: "20px",
                            top: "0px",
                            zIndex: 1,
                            pointerEvents: "none",
                        }}
                    />
                </div>
                <div
                    ref={hoverDivRef}
                    style={{
                        display: 'none',
                        position: "absolute",
                        background: "rgba(255, 255, 255, 0.9)",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "5px",
                        fontSize: "12px",
                        lineHeight: "1.4",
                        zIndex: 9999,
                    }}
                    dangerouslySetInnerHTML={{__html: hoverHTML}}
                />
            </div>
        );
    };

const PathwayGraph = ({
                          geneSet,
                          selectedPathways,
                          organismId,
                          minEdgeWeight,
                          pathwaysData,
                          mode,
                          selectedAnalyses,
                          analyses,
                          isDisplayCommonGenes,
                          minCommonGenes,
                          pathwayPvalueFDR,
                          visualMode
                      }) => {
    const [cytoData, setCytoData] = useState({
        nodes: [],
        edges: []
    });
    const [pathwayNodes, setPathwayNodes] = useState([]);
    const [pathwayEdges, setPathwayEdges] = useState([]);

    const [nodeStyleByMethod, setNodeStyleByMethod] = useState({
        selector: 'node',
        style: {
            label: 'data(label)',
            shape: "ellipse",
            "font-family": "Helvetica",
            "font-size": 6,
            "min-zoomed-font-size": 6,
            "overlay-opacity": 0,
            width: function (ele) {
                const maxSize = 25; // Maximum node size
                const minSize = 8; // Minimum node size
                const maxGenes = Math.max(...geneSet.geneSets.map(e => e.genes));
                // Use logarithmic scaling to normalize node sizes and prevent excessively large nodes
                const logSize = Math.log(ele.data('size') + 1); // +1 to avoid log(0)
                const logMax = Math.log(maxGenes + 1);
                const size = (logSize / logMax) * (maxSize - minSize) + minSize;
                return size;
            },
            height: function (ele) {
                const maxSize = 25; // Maximum node size
                const minSize = 8; // Minimum node size
                const maxGenes = Math.max(...geneSet.geneSets.map(e => e.genes));
                // Use logarithmic scaling to normalize node sizes and prevent excessively large nodes
                const logSize = Math.log(ele.data('size') + 1); // +1 to avoid log(0)
                const logMax = Math.log(maxGenes + 1);
                const size = (logSize / logMax) * (maxSize - minSize) + minSize;
                return size;
            },
            'pie-size': '95%',
        },
    });
    // create array of 32 colors
    const colors = [
        "#1f77b4",
        "#ff7f0e",
        "#2ca02c",
        "#b0073f",
        "#d62728",
        "#9467bd",
        "#8c564b",
        "#e377c2",
        "#7f7f7f",
        "#bcbd22",
        "#17becf",
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#ffff00",
        "#ff00ff",
    ]

    let style = useMemo(() => {
        return [
            {
                selector: 'edge',
                style: {
                    'line-color': '#9dbaea',
                    'target-arrow-color': '#9dbaea',
                    'curve-style': 'bezier',
                    'width': function (ele) {
                        return ele.data('weight') > minEdgeWeight ? ele.data('weight') / 100 : 0
                    },
                    // 'label': 'data(weight)',
                    'label': function (ele) {
                        return isDisplayCommonGenes ? ele.data('weight') : ""
                    },
                    'text-outline-color': '#ffffff',
                    'text-outline-width': 1,
                    'font-size': 4,
                    'text-rotation': 'autorotate',
                },
            },
        ]
    }, [isDisplayCommonGenes]);

    useEffect(() => {
        console.log('[MultiPathwayNetwork] geneSet:', geneSet);
        console.log('[MultiPathwayNetwork] geneSet.geneSets length:', geneSet.geneSets?.length);
        if (geneSet.geneSets?.length > 0) {
            console.log('[MultiPathwayNetwork] First pathway:', geneSet.geneSets[0]);
        }

        let pathwayNodes = geneSet.geneSets.map(e => ({
            data: {
                id: e.id,
                label: e.name,
                size: Array.isArray(e.genes) ? e.genes.length : (e.genes || 0)
            }
        }))
        setPathwayNodes(pathwayNodes)

        // Check if this is a custom gene set with gene arrays
        // geneSet has isCustom flag, or check if pathways have gene arrays
        const isCustomGeneSet = geneSet.isCustom && geneSet.geneSets.length > 0 &&
            (Array.isArray(geneSet.geneSets[0].genes) || Array.isArray(geneSet.geneSets[0].mappedGenes));

        console.log('[MultiPathwayNetwork] geneSet.isCustom:', geneSet.isCustom);
        console.log('[MultiPathwayNetwork] First pathway genes is array:', Array.isArray(geneSet.geneSets[0]?.genes));
        console.log('[MultiPathwayNetwork] isCustomGeneSet:', isCustomGeneSet);

        if (isCustomGeneSet) {
            console.log('[MultiPathwayNetwork] Calculating edges for custom gene set');
            // Calculate edges based on shared genes
            const edges = [];
            const pathways = geneSet.geneSets;

            for (let i = 0; i < pathways.length; i++) {
                for (let j = i + 1; j < pathways.length; j++) {
                    const pathway1 = pathways[i];
                    const pathway2 = pathways[j];

                    // Use genes array (gene symbols) for calculating shared genes
                    const genes1 = new Set(pathway1.genes || []);
                    const genes2 = new Set(pathway2.genes || []);

                    // Calculate shared genes
                    const sharedGenes = [...genes1].filter(gene => genes2.has(gene));
                    const sharedCount = sharedGenes.length;

                    // Only create edge if there are shared genes
                    if (sharedCount > 0) {
                        edges.push({
                            data: {
                                id: `${pathway1.id}_${pathway2.id}`,
                                source: pathway1.id,
                                target: pathway2.id,
                                weight: sharedCount
                            }
                        });
                    }
                }
            }

            setPathwayEdges(edges);
        } else {
            // Use Meteor method for database gene sets
            Meteor.asyncCallWithNotification("visualization.getPathwayGraph", {
                databaseId: geneSet.id,
                organismId: organismId
            }).then((pathwayGraph) => {
                setPathwayEdges(pathwayGraph)
            })
        }

    }, [geneSet, organismId]);

    useEffect(() => {
        let analysesObject = {}
        selectedAnalyses.forEach((e, index) => {
            analysesObject[e] = {}
            analysesObject[e]["color"] = colors[index]
            analysesObject[e]["index"] = index + 1
        })
        let selectedPathwaySet = new Set(selectedPathways)
        let isNodeStyleByMethodSet = false;
        const validPathways = pathwayNodes.filter(e => selectedPathwaySet.has(e.data.id))
        // get min max pathway score for each database
        const validPathwaysData = validPathways.map(e => pathwaysData[e.data.id])
        const allScore = Object.entries(validPathwaysData).map(([key, value]) => {
            return Object.entries(value).map(([key2, value2]) => {
                return value2.score ?? 0
            })
        }).flat()
        let minScore = Number(allScore.length > 0 ? Math.min(...allScore)?.toFixed(2) : -1);
        minScore = !isNaN(minScore) ? minScore : -1;
        let maxScore = Number(allScore.length > 0 ? Math.max(...allScore)?.toFixed(2) : 1);
        maxScore = !isNaN(maxScore) ? maxScore : 1;
        if (Math.abs(minScore) >= Math.abs(maxScore)) {
            maxScore = Math.abs(minScore)
        } else {
            minScore = -Math.abs(maxScore)
        }

        // debugger
        let cytoNodes = validPathways.map(e => {
                let pathwayData = pathwaysData[e.data.id] ?? {}
                // filter out pathwayData that not in selectedAnalyses
                let pathwaysHasMethod = Object.keys(pathwayData).reduce((acc, curr) => {
                    if (selectedAnalyses.includes(curr)) {
                        acc[curr] = pathwayData[curr]
                    }
                    return acc
                }, {})

                let hoverContent = "";
                for (let [key, value] of Object.entries(pathwaysHasMethod)) {

                    e.data[key] = 100 / selectedAnalyses.length
                    if (mode === "pValueFDR") {
                        // e.data[`isSignificant_${key}`] = value.pValueFDR < 0.05;
                        e.data[`isSignificant_${key}`] = value.pValueFDR <= pathwayPvalueFDR;
                        if (!isNodeStyleByMethodSet) {
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-color`] = function (ele) {
                                return ele.data(`isSignificant_${key}`) ? analysesObject[key].color : "#ffffff"
                            }
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-size`] = function (ele) {
                                const val = ele.data(key);
                                if (val === undefined) return 0;
                                return Math.min(100, Math.max(0, val));
                            }
                            setNodeStyleByMethod(nodeStyleByMethod)
                        }
                        hoverContent += `<div><span style="display: inline-block; width: 10px; height: 10px; background-color: ${analysesObject[key].color}; margin-right: 5px;"></span>${analyses[key.split('_')[0]]?.name + '_' + key.split('_')[1]}: pValue.FDR = ${value.pValueFDR?.toExponential(2) ?? '1.00e+0'}</div>`;
                    } else if (mode === "score" || mode === "significant") {
                        e.data[`value${key}`] = value.score ?? 0
                        if (mode === "significant") {
                            e.data[`isSignificant_${key}`] = value.pValueFDR <= pathwayPvalueFDR;
                        }
                        if (!isNodeStyleByMethodSet) {
                            // nodeStyleByMethod.style[`pie-${index}-background-color`] = gradientColor.interpolate(value.score, -4, 4, "#0000ff", "#ff0000")
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-color`] = function (ele) {
                                return ele.data(`value${key}`) ? gradientColor.interpolate(ele.data(`value${key}`), minScore, maxScore, "#0000ff", "#ff0000") : "#ffffff"
                            }
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-size`] = function (ele) {
                                const val = ele.data(key);
                                if (val === undefined) return 0;
                                return Math.min(100, Math.max(0, val));
                            }
                            setNodeStyleByMethod(nodeStyleByMethod)
                        }
                        hoverContent += `<div><span style="display: inline-block; width: 10px; height: 10px; background-color: ${gradientColor.interpolate(value.score ?? 0, minScore, maxScore, "#0000ff", "#ff0000")}; margin-right: 5px;"></span>${analyses[key.split('_')[0]]?.name + '_' + key.split('_')[1]}: score = ${value.score?.toFixed(2) ?? '0.00'}</div>`;
                    }
                }
                // get the list of selectedAnalyses that not in the pathwaysHasMethod
                let notSelectedAnalyses = selectedAnalyses.filter(e => !Object.keys(pathwaysHasMethod).includes(e))
                for (let key of notSelectedAnalyses) {
                    e.data[key] = 100 / selectedAnalyses.length
                    if (mode === "pValueFDR") {
                        if (!isNodeStyleByMethodSet) {
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-color`] = function (ele) {
                                return ele.data(`isSignificant_${key}`) ? analysesObject[key].color : "#ffffff"
                            }
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-size`] = function (ele) {
                                const val = ele.data(key);
                                if (val === undefined) return 0;
                                return Math.min(100, Math.max(0, val));
                            }
                            setNodeStyleByMethod(nodeStyleByMethod)
                        }
                    } else if (mode === "score" || mode === "significant") {
                        if (!isNodeStyleByMethodSet) {
                            // nodeStyleByMethod.style[`pie-${index}-background-color`] = gradientColor.interpolate(value.score, -4, 4, "#0000ff", "#ff0000")
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-color`] = function (ele) {
                                return ele.data(`value${key}`) ? gradientColor.interpolate(ele.data(`value${key}`), minScore, maxScore, "#0000ff", "#ff0000") : "#ffffff"
                            }
                            nodeStyleByMethod.style[`pie-${analysesObject[key].index}-background-size`] = function (ele) {
                                const val = ele.data(key);
                                if (val === undefined) return 0;
                                return Math.min(100, Math.max(0, val));
                            }
                            setNodeStyleByMethod(nodeStyleByMethod)
                        }
                    }
                }
                e.data.hover = hoverContent;
                isNodeStyleByMethodSet = true;
                return e
            }
        )

        let cytoEdges = pathwayEdges.filter(e =>
            selectedPathwaySet.has(e.data.source) && selectedPathwaySet.has(e.data.target)
        )

        // Filter out edges with weight smaller than minEdgeWeight
        if (isDisplayCommonGenes) {
            cytoEdges = cytoEdges.filter(e => e.data.weight >= minCommonGenes)
        }

        // Filter out pathways with no significant methods and remove their edges
        if (mode === 'pValueFDR' || mode === 'significant') {
            cytoNodes = cytoNodes.filter(node => {
                return Object.keys(node.data).filter(key => key.includes("isSignificant_")).some(key => node.data[key])
            })

            const nodeIds = cytoNodes.map(node => node.data.id);
            cytoEdges = cytoEdges.filter(edge => {
                return nodeIds.includes(edge.data.source) && nodeIds.includes(edge.data.target)
            })
        }

        setCytoData({
            nodes: cytoNodes,
            edges: cytoEdges
        })

    }, [selectedPathways, pathwayEdges, pathwayNodes, mode, selectedAnalyses, isDisplayCommonGenes, minCommonGenes, pathwayPvalueFDR])

    // Memoize layout and style to prevent unnecessary re-renders
    // MUST be before early returns to follow Rules of Hooks
    const layout = useMemo(() => ({
        name: 'fcose',
    }), []);

    const finalStyle = useMemo(() => [...style, nodeStyleByMethod], [style, nodeStyleByMethod]);

    if ((mode === "score" || mode === "significant") && (cytoData.nodes.length === 0 && cytoData.edges.length === 0)) return <Typography.Text
        // style={{fontSize: '18px'}}>Loading...</Typography.Text>
        style={{fontSize: '18px'}}>No pathways found</Typography.Text>
    if (mode === "pValueFDR" && (cytoData.nodes.length === 0 && cytoData.edges.length === 0)) return <Typography.Text
        style={{fontSize: '18px'}}>No pathways found</Typography.Text>

    return (
        <CytoscapeComponent
            elements={cytoData}
            layout={layout}
            style={finalStyle}
            onTapNode={(target) => {
                console.log({target})
            }}
            mode={mode}
            selectedAnalyses={selectedAnalyses}
            analyses={analyses}
            visualMode={visualMode}
        />
    )
}


export default ({
                    geneSet,
                    organismId,
                    sessionId,
                    results,
                    selectedAnalysisMethods,
                    analyses,
                    dataSetAnalysisId,
                    dataSetInputType,
                    visualMode = 'multiple'
                }) => {
    // Get global settings
    const { globalSettings } = useGlobalSettings();

    let [selectedPathways, setSelectedPathways] = useState([]);
    let [pathwaysData, setPathwaysData] = useState({});

    let [mode, setMode] = useState("significant");
    const [analysisId, setAnalysisId] = useState("");
    const [inputType, setInputType] = useState("");
    const [analysisMethod, setAnalysisMethod] = useState("")
    const [topPathways, setTopPathways] = useState(15);
    const [topPathwaysDisplay, setTopPathwaysDisplay] = useState(15);
    const [sortingOptions, setSortingOptions] = useState([]);
    const [isDisplayCommonGenes, setIsDisplayCommonGenes] = useState(false);
    const [minCommonGenes, setMinCommonGenes] = useState(10);
    const [minCommonGenesDisplay, setMinCommonGenesDisplay] = useState(10);
    const [isDisplaySignificantPathways, setIsDisplaySignificantPathways] = useState(false);
    const [pathwayPvalueFDR, setPathwayPvalueFDR] = useState(globalSettings.pValueFDR);
    const [pathwayPvalueFDRDisplay, setPathwayPvalueFDRDisplay] = useState(globalSettings.pValueFDR);

    const options = [
        {
            label: "pValue.FDR",
            value: "pValueFDR"
        },
        {
            label: "score",
            value: "score"
        },
    ]

    // Sync with global settings when they change
    useEffect(() => {
        setPathwayPvalueFDR(globalSettings.pValueFDR);
        setPathwayPvalueFDRDisplay(globalSettings.pValueFDR);
    }, [globalSettings]);

    useEffect(() => {
        let resultObject = {}
        if (results.length === 0) return
        resultObject = results.reduce((acc, curr) => {
            const key = `${curr.analysisId}_${curr.key}`
            acc[key] = curr.value
            return acc
        }, {})
        let selectedAnalysisMethodsSet = new Set(selectedAnalysisMethods)
        let filteredResultObject = Object.keys(resultObject).reduce((acc, curr) => {
            if (selectedAnalysisMethodsSet.has(visualMode === 'multiple' ? `${curr}` : `${curr}_${inputType}`)) {
                acc[visualMode === 'multiple' ? `${curr}` : `${curr}_${inputType}`] = resultObject[curr]
            }
            return acc
        }, {})
        let pathwaysDataObject = {};
        Object.entries(filteredResultObject).forEach(entry => {
            entry[1].forEach(pathway => {
                const pathwayId = pathway.pathway;
                const {pValue, pValueFDR, score} = pathway;

                if (pathwaysDataObject[pathwayId] === undefined) {
                    pathwaysDataObject[pathwayId] = {};
                }

                pathwaysDataObject[pathwayId][entry[0]] = score ? {pValue, pValueFDR, score} : {pValue, pValueFDR};
            });
        });
        setPathwaysData(pathwaysDataObject);
    }, [results, selectedAnalysisMethods, inputType]);

    useEffect(() => {
        if (selectedAnalysisMethods.length > 0) {
            let sortingOptionsArr = [...selectedAnalysisMethods]; // Create a new array with the elements of selectedAnalysisMethods
            // sortingOptionsArr.unshift("rank_aggregation")
            setSortingOptions(sortingOptionsArr)
        }
    }, [selectedAnalysisMethods]);

    useEffect(() => {
        if (sortingOptions.length > 0) {
            let index = 0
            if (sortingOptions.some(e => e.includes("meta"))) {
                index = sortingOptions.findIndex(e => e.includes("meta"))
                setAnalysisId(sortingOptions[index].split('_')[0])
                setAnalysisMethod(sortingOptions[index].split('_')[1])
                setInputType(sortingOptions[index].split('_')[2])
            } else if (sortingOptions.includes("rank_aggregation")) {
                setAnalysisMethod("rank_aggregation")
                setAnalysisId(dataSetAnalysisId)
                setInputType(dataSetInputType)
            } else {
                setAnalysisId(sortingOptions[index].split('_')[0])
                setAnalysisMethod(sortingOptions[index].split('_')[1])
                setInputType(sortingOptions[index].split('_')[2])
            }
        }

    }, [sortingOptions]);

    useEffect(() => {
        if (sortingOptions.length === 0) return
        let resultObject = {}
        if (results.length === 0) return
        resultObject = results.reduce((acc, curr) => {
            const key = visualMode === 'multiple' ? `${curr.analysisId}_${curr.key}` : `${curr.analysisId}_${curr.key}_${inputType ?? curr.inputType}`
            acc[key] = curr.value
            return acc
        }, {})
        let selectedAnalysisMethodsSet = new Set(selectedAnalysisMethods)
        let filteredResultObject = Object.keys(resultObject).reduce((acc, curr) => {
            if (selectedAnalysisMethodsSet.has(curr)) {
                acc[curr] = resultObject[curr]
            }
            return acc
        }, {})
        let pathwaysDataObject = {};
        Object.entries(filteredResultObject).forEach(entry => {
            entry[1].forEach(pathway => {
                const pathwayId = pathway.pathway;
                const {pValue, pValueFDR, score} = pathway;

                if (pathwaysDataObject[pathwayId] === undefined) {
                    pathwaysDataObject[pathwayId] = {};
                }

                pathwaysDataObject[pathwayId][entry[0]] = score ? {pValue, pValueFDR, score} : {pValue, pValueFDR};
            });
        });

        let selectedPathways = []
        if (analysisMethod === "rank_aggregation") {
            selectedPathways = rankPathways.rankPathwaysObjectByCriteriaMultiAnalysis(filteredResultObject, "pValueFDR", topPathways)
        } else {
            let selectedAnalysisId = visualMode === 'multiple' ? analysisId + '_' + analysisMethod : analysisId + '_' + analysisMethod + '_' + inputType
            selectedPathways = filteredResultObject[selectedAnalysisId]?.sort((a, b) => a.pValueFDR - b.pValueFDR).slice(0, topPathways).map(e => e.pathway)
        }
        setSelectedPathways(selectedPathways)

    }, [analysisId, inputType, analysisMethod, topPathways, selectedAnalysisMethods]);

    const onModeChange = ({target: {value}}) => {
        setMode(value);
    };

    const debouncedOnMinCommonGenesChange = _.debounce((value) => {
        setMinCommonGenes(value);
    }, 1000)

    const debounceOnTopPathwaysChange = _.debounce((value) => {
        setTopPathways(value);
    }, 1000)

    const debouncePathwayPValueFDRChange = _.debounce((value) => {
        setPathwayPvalueFDR(value);
    }, 1000)

    // if (!analysisMethod) return "loading"
    if (!selectedPathways || selectedPathways.length === 0) return "No pathway selected"
    return (
        <div>
            {/*<Radio.Group options={options} onChange={onModeChange} value={mode} optionType="button"/>*/}
            <div style={{display: "flex", alignItems: "center", marginBottom: 8, marginTop: 8}}>
                <Space
                    style={{width: '100%'}}
                >
                    <Typography.Text>Select top</Typography.Text>
                    <InputNumber
                        value={topPathwaysDisplay}
                        onChange={(value) => {
                            setTopPathwaysDisplay(value)
                            debounceOnTopPathwaysChange(value)
                        }}
                        min={1}/>
                    <Typography.Text>pathways sorted by</Typography.Text>
                    <Select
                        value={(analysisMethod === "rank_aggregation") ? analysisMethod : (visualMode === 'multiple' ? analysisId + "_" + analysisMethod : analysisId + "_" + analysisMethod + "_" + inputType)}
                        style={{width: 240}}
                        onChange={(value) => {
                            if (value === "rank_aggregation") {
                                setAnalysisMethod("rank_aggregation");
                            } else {
                                setAnalysisId(value.split("_")[0]);
                                setAnalysisMethod(value.split("_")[1].toLowerCase());
                                setInputType(value.split("_")[2] ?? '');
                            }

                        }}
                        options={sortingOptions.map((e) => {
                            return (e === "rank_aggregation") ? {
                                label: "Rank aggregation",
                                value: e,
                            } : {
                                label: visualMode === 'multiple' ? analyses[e.split("_")[0]]?.name + "_" + e.split("_")[1].toUpperCase() : e.split("_")[1].toUpperCase(),
                                value: e,
                            };
                        })}
                    />
                    <Typography.Text>{'with pValue.FDR ≤'}</Typography.Text>
                    <Input
                        type={'number'}
                        value={pathwayPvalueFDRDisplay}
                        onChange={(e) => {
                            setPathwayPvalueFDRDisplay(e.target.value)
                            debouncePathwayPValueFDRChange(e.target.value)
                        }}
                    />
                </Space>
            </div>
            <Space
                style={{marginTop: '10px', marginBottom: '10px'}}
            >
                <Typography.Text>Display number of common genes?</Typography.Text>
                <Checkbox
                    checked={isDisplayCommonGenes}
                    onChange={(e) => {
                        // e.target.checked
                        setIsDisplayCommonGenes(e.target.checked)
                    }}
                />
                {
                    isDisplayCommonGenes && (
                        <>
                            <Typography.Text>{'Show edges with number of genes ≥'}</Typography.Text>
                            <Input
                                type={'number'}
                                value={minCommonGenesDisplay}
                                onChange={(e) => {
                                    setMinCommonGenesDisplay(e.target.value)
                                    debouncedOnMinCommonGenesChange(e.target.value)
                                }}
                            />
                        </>
                    )
                }
            </Space>
            <Space>
                {/*<Typography.Text>Show significant pathways only?</Typography.Text>*/}
                {/*<Checkbox*/}
                {/*    checked={isDisplaySignificantPathways}*/}
                {/*    onChange={(e) => {*/}
                {/*        setIsDisplaySignificantPathways(e.target.checked)*/}
                {/*        if (e.target.checked) {*/}
                {/*            setMode('significant')*/}
                {/*        } else {*/}
                {/*            setMode('score')*/}
                {/*        }*/}
                {/*    }}*/}
                {/*/>*/}
                {/*{*/}
                {/*    (mode === 'pValueFDR' || mode === "significant") && (*/}
                {/*        <>*/}
                {/*            <Typography.Text>{'pValue.FDR ≤'}</Typography.Text>*/}
                {/*            <Input*/}
                {/*                type={'number'}*/}
                {/*                value={pathwayPvalueFDRDisplay}*/}
                {/*                onChange={(e) => {*/}
                {/*                    setPathwayPvalueFDRDisplay(e.target.value)*/}
                {/*                    debouncePathwayPValueFDRChange(e.target.value)*/}
                {/*                }}*/}
                {/*            />*/}
                {/*        </>*/}
                {/*    )*/}
                {/*}*/}
            </Space>
            <div style={{position: "relative"}}>
                <PathwayGraph
                    geneSet={geneSet}
                    organismId={organismId}
                    selectedPathways={selectedPathways}
                    minEdgeWeight={10}
                    pathwaysData={pathwaysData}
                    mode={mode}
                    selectedAnalyses={selectedAnalysisMethods}
                    analyses={analyses}
                    isDisplayCommonGenes={isDisplayCommonGenes}
                    minCommonGenes={minCommonGenes}
                    pathwayPvalueFDR={pathwayPvalueFDR}
                    visualMode={visualMode}
                />
            </div>
            <SelectableResult
                analysisId={analysisId}
                inputType={inputType}
                sessionId={sessionId}
                isRunnable={false}
                selectType={"checkbox"}
                onRowSelectionChange={(record, selected, selectedRows) => {
                    setSelectedPathways(selectedRows.map((e) => e.pathway));
                }}
                onRowSelectAllChange={(selected, selectedRows, changeRows) => {
                    setSelectedPathways(selectedRows.map((e) => e.pathway));
                }}
                databaseIds={[geneSet.id]}
                selectedPathways={selectedPathways}
                selectedMethod={analysisMethod}
                // defaultActiveKey={["1"]}
            />
        </div>
    );
}
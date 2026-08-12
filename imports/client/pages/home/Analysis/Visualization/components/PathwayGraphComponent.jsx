import React, {useEffect, useRef, useState, useCallback} from 'react';
import cytoscape from 'cytoscape';
import SelectableResult from "./SelectableResult";
import useSubscription from "../../../../../hooks/useSubscription";
import {useTracker} from "meteor/react-meteor-data";
import fcose from 'cytoscape-fcose';
import cytoscapeSvg from 'cytoscape-svg';
import gradientColor from "../../../../../utils/gradientColor";
import {Radio, Button, Dropdown, Menu} from "antd";
import {DownloadOutlined} from "@ant-design/icons";
import rankPathways from "../../../../../utils/rankPathways";

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
         mode
     }) => {
        const containerRef = useRef(null);
        const cyRef = useRef(null);
        const [hoverHTML, setHoverHTML] = useState('');
        const hoverDivRef = useRef(null);
        const legendCanvasRef = useRef(null);
        const gradientCanvasRef = useRef(null);
        const colors = {
            "ks": "#1f77b4",
            "wilcox": "#ff7f0e",
            "fgsea": "#2ca02c",
            "ora": "#b0073f",
            "gsa": "#d62728",
            "gsea": "#9467bd",
            "padog": "#8c564b",
        }

        const initCytoscape = useCallback(() => {
            console.log('initCytoscape');
            if (!cyRef.current) {
                cyRef.current = cytoscape({
                    container: containerRef.current,
                    elements,
                    layout,
                    style,
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
                    if (hoverDivRef.current) {
                        hoverDivRef.current.style.display = 'block';
                        hoverDivRef.current.style.left = `${position.x + 20}px`;
                        hoverDivRef.current.style.top = `${position.y}px`;
                    }
                });

                cyRef.current.on('mouseout', 'node', () => {
                    setHoverHTML('');
                    hoverDivRef.current.style.display = 'none';
                });
            } else {
                // cyRef.current.elements().remove();
                let newNodeIds = new Set(elements.nodes.map(e => e.data.id))
                cyRef.current.nodes().filter(e => !newNodeIds.has(e.id())).remove()

                cyRef.current.add(elements);
                cyRef.current.style(style);
            }
        }, [elements, layout, style, onTapNode, onTapEdge, onLayoutStop]);

        useEffect(() => {
            initCytoscape();
        }, [elements, mode]);

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
            drawLegendCircle(mode);
            drawGradientRectangle();
        }, [mode]);

        const drawLegendCircle = (mode) => {
            if (legendCanvasRef.current) {
                const ctx = legendCanvasRef.current.getContext('2d');
                const scale = window.devicePixelRatio || 1;
                const radius = 35 * scale;
                const fontSize = 8 * scale;
                const padding = 15 * scale;
                const boxSize = 10 * scale;
                const boxPadding = 5 * scale;

                if (mode === 'pValue') {
                    const totalHeight = (boxSize + boxPadding) * Object.keys(colors).length + padding * 2;
                    legendCanvasRef.current.width = (radius * 2 + padding * 2);
                    legendCanvasRef.current.height = totalHeight;
                    legendCanvasRef.current.style.width = `${legendCanvasRef.current.width / scale}px`;
                    legendCanvasRef.current.style.height = `${legendCanvasRef.current.height / scale}px`;

                    ctx.scale(scale, scale);
                    ctx.font = `${fontSize / scale}px Arial`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';

                    let yPos = padding;
                    for (const [method, color] of Object.entries(colors)) {
                        ctx.fillStyle = color;
                        ctx.fillRect(padding, yPos, boxSize / scale, boxSize / scale);
                        ctx.fillStyle = 'black';
                        ctx.fillText(method, padding + boxSize / scale + boxPadding / scale, yPos + boxSize / (2 * scale));
                        yPos += boxSize / scale + boxPadding / scale;
                    }
                } else if (mode === 'score') {
                    const numMethods = Object.keys(colors).length;
                    const totalWidth = radius * 2 + padding * 2 + 5 * scale;
                    legendCanvasRef.current.width = totalWidth * scale;
                    legendCanvasRef.current.height = (radius * 2 + padding * 2) * scale;
                    legendCanvasRef.current.style.width = `${legendCanvasRef.current.width / scale}px`;
                    legendCanvasRef.current.style.height = `${legendCanvasRef.current.height / scale}px`;

                    ctx.scale(scale, scale);

                    const legendX = (legendCanvasRef.current.width / scale - radius * 2 - 40) / 2 + radius;
                    const legendY = legendCanvasRef.current.height / (2 * scale);

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

                    let yPos = legendCanvasRef.current.height / (2 * scale) - ((numMethods - 1) * (indexRadius * 2 + indexPadding)) / 2 + 50;
                    for (let i = 0; i < numMethods; i++) {
                        const method = Object.keys(colors)[i];
                        ctx.beginPath();
                        ctx.arc(legendCanvasRef.current.width / scale - padding - 20, yPos, indexRadius / scale - 2, 0, 2 * Math.PI);
                        ctx.fillStyle = 'white';
                        ctx.fill();
                        ctx.strokeStyle = 'black';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        ctx.fillStyle = 'black';
                        ctx.fillText(i + 1, legendCanvasRef.current.width / scale - padding - 22, yPos);
                        ctx.fillText(method, legendCanvasRef.current.width / scale - padding - 7, yPos);
                        yPos += indexRadius + indexPadding;
                    }
                }
            }
        };

        const drawGradientRectangle = () => {
            if (gradientCanvasRef.current) {
                if (mode === 'score') {
                    const ctx = gradientCanvasRef.current.getContext('2d');
                    const scale = window.devicePixelRatio || 1;
                    const gradientWidth = 200 * scale;
                    const gradientHeight = 30 * scale;

                    gradientCanvasRef.current.width = gradientWidth + 50;
                    gradientCanvasRef.current.height = gradientHeight + 50;
                    gradientCanvasRef.current.style.width = `${gradientWidth / scale}px`;
                    gradientCanvasRef.current.style.height = `${gradientHeight / scale}px`;

                    const gradient = ctx.createLinearGradient(0, 0, gradientWidth, 0);
                    gradient.addColorStop(0, '#0000ff');
                    gradient.addColorStop(0.5, '#ffffff');
                    gradient.addColorStop(1, '#ff0000');

                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, gradientWidth, gradientHeight);

                    ctx.font = `${10 * scale}px serif`;
                    ctx.fillStyle = 'black';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    ctx.fillText('-1', 5, gradientHeight + 8 * scale);
                    ctx.fillText('0', gradientWidth / 2, gradientHeight + 8 * scale);
                    ctx.fillText('1', gradientWidth, gradientHeight + 8 * scale);
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
                const legendX = exportCanvas.width - legendWidth - 10;
                const legendY = exportCanvas.height - legendHeight - 10;

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
                legendImage.setAttribute('x', svgWidth - legendCanvasRef.current.width / (window.devicePixelRatio || 1) - 10);
                legendImage.setAttribute('y', svgHeight - legendCanvasRef.current.height / (window.devicePixelRatio || 1) - 10);

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
            <div>
                <div ref={containerRef} style={{width: '100%', height: '600px', position: 'relative'}}>
                    <canvas
                        ref={legendCanvasRef}
                        style={{
                            position: 'absolute',
                            right: '10px',
                            bottom: '0px',
                            zIndex: 1,
                            pointerEvents: 'none',
                        }}
                    />
                    <canvas
                        ref={gradientCanvasRef}
                        style={{
                            position: 'absolute',
                            right: '20px',
                            top: '0px',
                            zIndex: 1,
                            pointerEvents: 'none',
                        }}
                    />
                </div>
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
                <div
                    ref={hoverDivRef}
                    style={{
                        display: 'none',
                        position: 'absolute',
                        background: 'rgba(255, 255, 255, 0.9)',
                        padding: '5px',
                        border: '1px solid #ccc',
                        borderRadius: '5px',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        zIndex: 2,
                    }}
                    dangerouslySetInnerHTML={{__html: hoverHTML}}
                />
            </div>
        );
    };

const PathwayGraph = ({geneSet, selectedPathways, organismId, minEdgeWeight, pathwaysData, mode}) => {
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

    const colors = {
        "ks": "#1f77b4",
        "wilcox": "#ff7f0e",
        "fgsea": "#2ca02c",
        "ora": "#b0073f",
        "gsa": "#d62728",
        "gsea": "#9467bd",
        "padog": "#8c564b",
    }

    useEffect(() => {
        let pathwayNodes = geneSet.geneSets.map(e => ({
            data: {
                id: e.id,
                label: e.name,
                size: Array.isArray(e.genes) ? e.genes.length : (e.genes || 0)
            }
        }))

        setPathwayNodes(pathwayNodes)

        // Check if this is a custom gene set with gene arrays
        const isCustomGeneSet = geneSet.geneSets.length > 0 &&
            (Array.isArray(geneSet.geneSets[0].genes) || Array.isArray(geneSet.geneSets[0].mappedGenes));

        if (isCustomGeneSet) {
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
        let selectedPathwaySet = new Set(selectedPathways)
        let isNodeStyleByMethodSet = false;
        let cytoNodes = pathwayNodes.filter(e => selectedPathwaySet.has(e.data.id)).map(e => {
                let pathwayData = pathwaysData[e.data.id]
                let pathwaysHasMethod = Object.entries(pathwayData)
                    .reduce((filteredPathways, [pathway, methods]) => {
                        for (const [key, value] of Object.entries(methods)) {
                            let methodData = {}
                            if (filteredPathways[pathway] !== undefined) {
                                methodData = filteredPathways[pathway]
                            }
                            if (key === mode) {
                                methodData[key] = value
                                filteredPathways[pathway] = methodData;
                            }
                        }
                        return filteredPathways
                    }, {})
                let totalMethods = Object.keys(pathwaysHasMethod).length
                let index = 1;

                let hoverContent = "";
                for (let [key, value] of Object.entries(pathwaysHasMethod)) {
                    e.data[key] = 100 / totalMethods
                    if (mode === "pValue") {
                        e.data[`isSignificant_${key}`] = value.pValue < 0.05;
                        if (!isNodeStyleByMethodSet) {
                            nodeStyleByMethod.style[`pie-${index}-background-color`] = function (ele) {
                                return ele.data(`isSignificant_${key}`) ? colors[key] : "#ffffff"
                            }
                            nodeStyleByMethod.style[`pie-${index}-background-size`] = function (ele) {
                                const val = ele.data(key);
                                if (val === undefined) return 0;
                                return Math.min(100, Math.max(0, val));
                            }
                            setNodeStyleByMethod(nodeStyleByMethod)
                            index++;
                        }
                        hoverContent += `<div><span style="display: inline-block; width: 10px; height: 10px; background-color: ${colors[key]}; margin-right: 5px;"></span>${key}: pValue = ${value.pValue.toExponential(2)}</div>`;
                    } else if (mode === "score") {
                        e.data[`value${key}`] = value.score
                        if (!isNodeStyleByMethodSet) {
                            // nodeStyleByMethod.style[`pie-${index}-background-color`] = gradientColor.interpolate(value.score, -4, 4, "#0000ff", "#ff0000")
                            nodeStyleByMethod.style[`pie-${index}-background-color`] = function (ele) {
                                return gradientColor.interpolate(ele.data(`value${key}`), -4, 4, "#0000ff", "#ff0000")
                            }
                            nodeStyleByMethod.style[`pie-${index}-background-size`] = function (ele) {
                                const val = ele.data(key);
                                if (val === undefined) return 0;
                                return Math.min(100, Math.max(0, val));
                            }
                            setNodeStyleByMethod(nodeStyleByMethod)
                            index++;
                        }
                        hoverContent += `<div><span style="display: inline-block; width: 10px; height: 10px; background-color: ${gradientColor.interpolate(value.score, -4, 4, "#0000ff", "#ff0000")}; margin-right: 5px;"></span>${key}: score = ${value.score.toFixed(2)}</div>`;
                    }
                }
                e.data.hover = hoverContent;
                isNodeStyleByMethodSet = true;
                return e
            }
        )

        console.log({pathwayEdges})
        let cytoEdges = pathwayEdges.filter(e => selectedPathwaySet.has(e.data.source) && selectedPathwaySet.has(e.data.target))

        setCytoData({
            nodes: cytoNodes,
            edges: cytoEdges
        })

    }, [selectedPathways, pathwayEdges, pathwayNodes, mode])

    if (cytoData.nodes.length === 0 || cytoData.edges.length === 0) return "loading"
    const layout = {
        name: 'fcose',
    };

    let style = [
        {
            selector: 'edge',
            style: {
                'line-color': '#9dbaea',
                'target-arrow-color': '#9dbaea',
                'curve-style': 'bezier',
                'width': function (ele) {
                    return ele.data('weight') > minEdgeWeight ? ele.data('weight') / 100 : 0
                },
                'label': 'data(weight)',
                'text-outline-color': '#ffffff',
                'text-outline-width': 1,
                'font-size': 3,
                'text-rotation': 'autorotate',
            },
        },
    ];

    style.push(nodeStyleByMethod)

    return (
        <CytoscapeComponent
            elements={cytoData}
            layout={layout}
            style={style}
            onTapNode={(target) => {
                console.log({target})
            }}
            mode={mode}
        />
    )
}


export default ({inputType, analysisId, geneSet, organismId, sessionId, results}) => {
    let [selectedPathways, setSelectedPathways] = useState([]);
    let [pathwaysData, setPathwaysData] = useState({});

    let [mode, setMode] = useState("pValue");

    const options = [
        {
            label: "pValue",
            value: "pValue"
        },
        {
            label: "score",
            value: "score"
        },
    ]
    useSubscription("analysisConfig.snapshot", {
        analysisId, inputType,
        keys: ["geneStats", "methodSettings"]
    }, [inputType, analysisId]);

    useEffect(() => {
        // filter results by analysisId and inputType
        let filteredResults = results.filter(e => e.analysisId === analysisId && e.inputType === inputType)

        let pathwaysDataObject = {};
        filteredResults?.forEach(entry => {
            entry.value.forEach(pathway => {
                const pathwayId = pathway.pathway;
                const {pValue, pValueFDR, score} = pathway;

                if (pathwaysDataObject[pathwayId] === undefined) {
                    pathwaysDataObject[pathwayId] = {};
                }

                pathwaysDataObject[pathwayId][entry.key] = score ? {pValue, pValueFDR, score} : {pValue, pValueFDR};
            });
        });

        setPathwaysData(pathwaysDataObject);
        selectedPathways = rankPathways.rankPathwaysByCriteria(filteredResults, "pValue", 30)
        setSelectedPathways(selectedPathways)

    }, [results]);

    const onModeChange = ({target: {value}}) => {
        setMode(value);
    };

    return (<div>
        <Radio.Group options={options} onChange={onModeChange} value={mode} optionType="button"/>
        <PathwayGraph analysisId={analysisId} inputType={inputType} geneSet={geneSet} organismId={organismId}
                      selectedPathways={selectedPathways} minEdgeWeight={30} pathwaysData={pathwaysData}
                      mode={mode}></PathwayGraph>
        <SelectableResult analysisId={analysisId} inputType={inputType}
                          sessionId={sessionId} isRunnable={false}
                          selectType={"checkbox"}
                          onRowSelectionChange={(record, selected, selectedRows) => {
                              setSelectedPathways(selectedRows.map(e => e.pathway))
                          }}
                          onRowSelectAllChange={(selected, selectedRows, changeRows) => {
                              setSelectedPathways(selectedRows.map(e => e.pathway))
                          }}
                          databaseIds={[geneSet.id]}
                          selectedPathways={selectedPathways}
        />
    </div>)
}
import React, {useEffect, useState, useRef, useMemo} from "react";
import {Image, Stage, Layer, Rect, Label, Group, Tag, Text, Line} from "react-konva";
import useImage from "use-image";
import {useResizeDetector} from 'react-resize-detector';
import gradientColor from "../../../../../utils/gradientColor";
import {DownloadOutlined} from "@ant-design/icons";
import {Button, Space} from "antd";
import {TransformWrapper, TransformComponent} from "react-zoom-pan-pinch";

export default ({
                    genesMappedInput,
                    genesMappedBackground,
                    pathwayId,
                    inputType,
                    inputData,
                    fcPValueData,
                    mode,
                    showSignificant,
                    threshold
                }) => {
    const [pathwayImageUrl, setPathwayImageUrl] = useState(null);
    const [imageResolution, setImageResolution] = useState(1);
    const [geneNode, setGeneNode] = useState(null);
    const [overlayGenes, setOverlayGenes] = useState([]);
    const [gradientColorStops, setGradientColorStops] = useState([]);
    const [numLabels, setNumLabels] = useState([]);
    const [genes, setGenes] = useState([]);

    const targetContainer = useRef();
    const stageRef = useRef(null);
    let {width: refWidth} = useResizeDetector({targetRef: targetContainer});
    let [width, setWidth] = useState(null);
    const [minMaxThreshod, setMinMaxThreshold] = useState({min: -1, max: 1});

    width = refWidth || width;

    useEffect(() => {
        Meteor.asyncCallWithNotification("kegg.kgml", pathwayId).then(async (kgml) => {
            let target = kgml.elements.filter(e => e.type === "element")[0];
            if (!target) throw new Error("No target element found");

            let {elements, attributes: pathwayAttr} = target;
            let genes = elements.filter(e => e.attributes.type === "gene");
            setGenes(genes);
            let url = `https://www.kegg.jp/kegg/pathway/map/map${String(pathwayId).match(/\d+/)[0]}.png`
            let {image, resolution} = await Meteor.asyncCallWithNotification("kegg.png", url);
            setPathwayImageUrl("data:image/png;base64," + image);
            setImageResolution(resolution);
        }).catch((e) => {
            console.log(e);
        });
    }, [pathwayId]);

    const memoizedOverlayGenes = useMemo(() => {
        if (inputType === "ora") {
            let genesMappedInputSet = new Set(genesMappedInput);
            let genesMappedBackgroundSet = new Set(genesMappedBackground);
            let inputGenes = genes.filter(e => genesMappedInputSet.has(e.attributes.id));
            let backgroundGenes = genes.filter(e => genesMappedBackgroundSet.has(e.attributes.id) && !genesMappedInputSet.has(e.attributes.id));

            return inputGenes.map(e => {
                e.type = "oraInput";
                e.borderColor = "red";
                return e;
            }).concat(
                backgroundGenes.map(e => {
                    e.type = "oraBackground";
                    e.borderColor = "blue";
                    return e;
                })
            );
        } else if (inputType === "pgsea" && (!fcPValueData || fcPValueData.length === 0)) {
            let parsedGeneData = inputData.split('\n').reduce((acc, line) => {
                let [gene, value] = line.split('\t');
                // trim trailing spaces for gene
                gene = gene.trim();
                acc[gene] = parseFloat(value);
                return acc;
            }, {});
            let genesMappedInputSet = new Set(Object.values(genesMappedInput));
            return genes.filter(entry => {
                const name = entry.attributes?.name;
                if (!name) return false;

                // Case 1: If name contains spaces, extract IDs from space-delimited format
                if (name.includes(' ')) {
                    let geneNames = name.split(' ');
                    let geneIdsFromNames = geneNames.map(e => e.split(':')[1]);
                    return geneIdsFromNames.length > 0 && genesMappedInputSet.has(geneIdsFromNames[0]);
                }
                // Case 2: Single ID format
                else {
                    let geneId = name.split(':')[1];
                    return geneId && genesMappedInputSet.has(geneId);
                }
            }).map(entry => {
                const {id} = entry.attributes;
                const geneNames = entry.elements?.[0]?.attributes?.name?.split(', ') || [];
                const stat_value = geneNames.reduce((sum, geneName) => sum + (parsedGeneData[geneName] || 0), 0);

                const borderColor = gradientColor.interpolate(stat_value, -1, 1, "#0000ff", "#ff0000");
                entry.type = "pgseaInput";
                entry.borderColor = borderColor;
                entry.stat_value = stat_value;
                return entry;
            });
        } else if (inputType === "expression" || (inputType === 'pgsea' && fcPValueData && fcPValueData.length > 0)) {
            let inputGeneIDs = fcPValueData.map(e => {
                return e.id;
            });

            let genData = fcPValueData.reduce((acc, e) => {
                acc[e.id] = e;
                return acc;
            }, {});
            let minFCThres = Math.min(...fcPValueData.map(e => e.FC));
            let maxFCThres = Math.max(...fcPValueData.map(e => e.FC));
            if (Math.abs(minFCThres) >= Math.abs(maxFCThres)) {
                maxFCThres = Math.abs(minFCThres);
            } else {
                minFCThres = -Math.abs(maxFCThres);
            }
            minFCThres = Number(minFCThres?.toFixed(2) || -1);
            maxFCThres = Number(maxFCThres?.toFixed(2) || 1);
            minFCThres = !isNaN(minFCThres) ? minFCThres : -1;
            maxFCThres = !isNaN(maxFCThres) ? maxFCThres : 1;
            setMinMaxThreshold({
                min: minFCThres,
                max: maxFCThres
            })

            let inputGeneIDsSet = new Set(inputGeneIDs);
            return genes.filter(entry => {
                const name = entry.attributes?.name;
                if (!name) return false;

                // Case 1: If name contains spaces, extract IDs from space-delimited format
                if (name.includes(' ')) {
                    let geneNames = name.split(' ');
                    let geneIdsFromNames = geneNames.map(e => e.split(':')[1]);
                    // return geneIdsFromNames.length > 0 && inputGeneIDsSet.has(geneIdsFromNames[0]);
                    return geneIdsFromNames.length > 0 && geneIdsFromNames.some(geneId => inputGeneIDsSet.has(geneId));
                }
                // Case 2: Single ID format
                else {
                    let geneId = name.split(':')[1];
                    return geneId && inputGeneIDsSet.has(geneId);
                }
            }).map(entry => {
                const {id} = entry.attributes;
                let geneNames = entry.attributes?.name?.split(' ') || [];
                let geneIdsFromNames = geneNames.map(e => {
                    return e.split(':')[1];
                });
                let isSignificant = geneIdsFromNames.some(geneId => {
                    return inputType !== 'pgsea' ? genData[geneId]?.pValueFDR <= threshold.maxAdjustedPValue && Math.abs(genData[geneId]?.FC) >= threshold.minLogFoldChange :
                        genData[geneId]?.pValue <= threshold.maxAdjustedPValue && Math.abs(genData[geneId]?.FC) >= threshold.minLogFoldChange;
                })
                let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.pValueFDR || 0), 0);
                let average_pvalue = sum / geneIdsFromNames.length;

                let borderColor = "";
                let stat_value = 0;
                let sumFC = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.FC || 0), 0);
                stat_value = sumFC / geneIdsFromNames.length
                // let maxFC = Math.max(...geneIdsFromNames.map(geneId => genData[geneId]?.FC || 0));
                // let minPValueFDR = Math.min(...geneIdsFromNames.map(geneId => genData[geneId]?.pValueFDR || 1));
                // First find the gene with the minimum p-value
                let minPValueFDR = Math.min(...geneIdsFromNames.map(geneId => (inputType !== 'pgsea' ? genData[geneId]?.pValueFDR : genData[geneId]?.pValue) || 1));
// Then get the fold change from that specific gene
                let geneWithMinPValue = geneIdsFromNames.find(geneId => inputType !== 'pgsea' ? (genData[geneId]?.pValueFDR === minPValueFDR) : (genData[geneId]?.pValue === minPValueFDR));
                let maxFC = geneWithMinPValue ? genData[geneWithMinPValue]?.FC || 0 : 0;
                borderColor = gradientColor.interpolate(maxFC, minFCThres, maxFCThres, "#0000ff", "#ff0000");
                // if (mode === "fc") {
                //     let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.FC || 0), 0);
                //     stat_value = sum / geneIdsFromNames.length;
                //     borderColor = gradientColor.interpolate(stat_value, -1, 1, "#0000ff", "#ff0000");
                // } else if (mode === "pValueFDR") {
                //     let sum = geneIdsFromNames.reduce((sum, geneId) => sum + genData[geneId]?.pValueFDR >= 1e-16 ? -Math.log10(genData[geneId]?.pValueFDR) : -Math.log10(1e-16), 0);
                //     stat_value = sum / geneIdsFromNames.length;
                //     borderColor = gradientColor.interpolate(stat_value, 0, 10, "#ffff00", "#ff0000");
                // }
                // If there is no significant genes in the pathway and the average values are not significant, hide the pathway
                if (!isSignificant && !(minPValueFDR <= threshold.maxAdjustedPValue && borderColor >= threshold.minLogFoldChange)) {
                    entry.type = "expressionInput";
                    entry.borderColor = "transparent";
                    entry.stat_value = maxFC;
                    entry.average_pvalue = minPValueFDR;
                    return entry;
                }

                entry.type = "expressionInput";
                entry.borderColor = borderColor;
                entry.stat_value = stat_value;
                entry.average_pvalue = average_pvalue;
                return entry;
            });
        }
        return [];
    }, [genes, genesMappedInput, genesMappedBackground, inputType, inputData, fcPValueData, mode, showSignificant, threshold]);

    const memoizedGradientColorStops = useMemo(() => {
        if (inputType === "pgsea") {
            return [
                0, 'blue',
                0.5, 'white',
                1, 'red',
            ];
        } else if (inputType === "expression" && mode === "fc") {
            return [
                0, 'blue',
                0.5, 'white',
                1, 'red',
            ];
        } else if (inputType === "expression" && mode === "pValueFDR") {
            return [
                0, '#ffff00',
                1, '#ff0000',
            ];
        }
        return [];
    }, [inputType, mode]);

    const memoizedNumLabels = useMemo(() => {
        if (inputType === "pgsea" && (!fcPValueData || fcPValueData.length === 0)) {
            return [-1, -0.5, 0, 0.5, 1];
          } else if ((inputType === "expression" || (inputType === "pgsea" && fcPValueData && fcPValueData.length > 0)) && mode === "fc") {
            // return [-1, -0.5, 0, 0.5, 1];
            return [
                minMaxThreshod.min,
                // Number((minMaxThreshod.min/2)?.toFixed(2)),
                0,
                // Number((minMaxThreshod.max/2)?.toFixed(2)),
                minMaxThreshod.max];
        } else if (inputType === "expression" && mode === "pValueFDR") {
            return [0, 5, 10];
        }
        return [];
    }, [inputType, mode, minMaxThreshod]);

    useEffect(() => {
        setOverlayGenes(memoizedOverlayGenes);
        setGradientColorStops(memoizedGradientColorStops);
        setNumLabels(memoizedNumLabels);
    }, [memoizedOverlayGenes, memoizedGradientColorStops, memoizedNumLabels]);

    const [image] = useImage(pathwayImageUrl);

    if (!image) {
        return "loading";
    }

    let scale = width / image.width
    let height = image.height * scale;

    const boxWidth = 200;
    const boxHeight = 15;
    const lineHeight = 10;

    // debugger
    const boxX = width - boxWidth - 10;
    // const boxY = height - boxHeight - lineHeight - 10;
    const boxY = 10;

    const coordinateTransform = ({x, y, width, height}) => {
        return {
            x: (x - width / 2) * scale * imageResolution,
            y: (y - height / 2) * scale * imageResolution,
        }
    }

    function tooltip() {
        if (geneNode === null) return null;
        if (!geneNode.show) return null;
        return (
            <Label x={geneNode.x} y={geneNode.y} opacity={0.75}>
                <Tag
                    fill={"black"}
                    pointerDirection={"down"}
                    pointerWidth={10}
                    pointerHeight={10}
                    lineJoin={"round"}
                    shadowColor={"black"}
                    shadowBlur={10}
                    shadowOffsetX={10}
                    shadowOffsetY={10}
                    shadowOpacity={0.2}
                />
                <Text text={geneNode.gene.elements[0].attributes.name} fill={"white"} fontSize={12} padding={5}/>
            </Label>
        );
    }

    function onMouseOver(evt) {
        let node = evt.target;
        if (node.getAttr('gene') !== undefined) {
            // update tooltip
            let mousePos = node.getStage().getPointerPosition();
            // Guard against NaN positions from mouse events during render/layout transitions
            if (mousePos && !isNaN(mousePos.x) && !isNaN(mousePos.y)) {
                setGeneNode({x: mousePos.x, y: mousePos.y, gene: node.getAttr('gene'), show: true});
            }
        }
    }

    const handleSaveCanvas = () => {
        const canvas = stageRef.current.toCanvas({
            pixelRatio: 2, // Set the pixel ratio to 2 for double resolution
        });

        // Create a temporary canvas with double the size
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width * 2;
        tempCanvas.height = canvas.height * 2;

        // Draw the original canvas onto the temporary canvas with double size
        const tempContext = tempCanvas.getContext('2d');
        tempContext.scale(2, 2);
        tempContext.drawImage(canvas, 0, 0);

        // Get the data URL from the temporary canvas
        const dataURL = tempCanvas.toDataURL('image/png');

        // Create a link to trigger the file download
        const link = document.createElement('a');
        link.download = 'canvas.png';
        link.href = dataURL;
        link.click();
    };

    return (
        <React.Fragment>
            <h2>Pathway chart</h2>
            <div className="App" ref={(ref) => {
                targetContainer.current = ref;
                setWidth(ref?.clientWidth || width)
            }}>
                <TransformWrapper
                    initialScale={0.45}
                    initialPositionX={0}
                    initialPositionY={0}
                    centerOnInit={true}
                >
                    {({zoomIn, zoomOut, resetTransform, centerView, ...rest}) => (
                        <React.Fragment>
                            <Space className={'tools'} style={{marginBottom: '10px'}}>
                                <Button onClick={() => zoomIn()}>ZOOM IN +</Button>
                                <Button onClick={() => zoomOut()}>ZOOM OUT-</Button>
                                <Button onClick={() => resetTransform()}>RESET</Button>
                                <Button onClick={() => centerView()}>CENTER</Button>
                            </Space>
                            <TransformComponent
                                wrapperStyle={{
                                    maxHeight: '700px'
                                }}
                            >
                                <Stage width={width} height={height}
                                       onMouseOver={onMouseOver}
                                       onMouseMove={onMouseOver}
                                       onDragMove={onMouseOver}
                                       onMouseOut={() => setGeneNode({show: false})}
                                       ref={stageRef}
                                >
                                    <Layer>
                                        <Image image={image} width={width} height={height}/>
                                        <Group>
                                            {
                                                overlayGenes.map((gene, index) => {
                                                    let attributes = gene.elements[0].attributes
                                                    return (
                                                        <Rect
                                                            id={gene.attributes.id}
                                                            gene={gene}
                                                            height={attributes.height * scale * imageResolution}
                                                            width={attributes.width * scale * imageResolution}
                                                            stroke={gene.borderColor}
                                                            strokeWidth={2 * imageResolution}
                                                            {...coordinateTransform(attributes)}
                                                            key={index}
                                                        />
                                                    )
                                                })
                                            }
                                        </Group>
                                    </Layer>
                                    <Layer>{tooltip()}</Layer>
                                    {
                                        (inputType === "pgsea" || inputType === "expression") ? (
                                            <Layer>
                                                {/* Draw the box with gradient fill */}
                                                <Rect
                                                    x={boxX}
                                                    y={boxY}
                                                    width={boxWidth}
                                                    height={boxHeight}
                                                    fillLinearGradientStartPoint={{x: 0, y: 0}}
                                                    fillLinearGradientEndPoint={{x: boxWidth, y: 0}}
                                                    fillLinearGradientColorStops={gradientColorStops}
                                                    stroke="black"
                                                    strokeWidth={1}
                                                />

                                                {/* Draw the vertical lines */}
                                                {numLabels.map((label, index) => (
                                                    <Line
                                                        key={index}
                                                        points={[
                                                            boxX + (boxWidth / (numLabels.length - 1)) * index,
                                                            boxY + boxHeight,
                                                            boxX + (boxWidth / (numLabels.length - 1)) * index,
                                                            boxY + boxHeight + 5,
                                                        ]}
                                                        stroke="black"
                                                        strokeWidth={1}
                                                    />
                                                ))}

                                                {/* Draw the number labels */}
                                                {numLabels.map((label, index) => (
                                                    <Text
                                                        key={index}
                                                        x={boxX + (boxWidth / (numLabels.length - 1)) * index - (index === numLabels.length - 1 ? 40 : 3)}
                                                        y={boxY + lineHeight + 10}
                                                        text={label.toString()}
                                                        fontSize={16}
                                                    />
                                                ))}
                                                <Text
                                                    key={"legend caption"}
                                                    x={boxX + (boxWidth - 60) / 2}
                                                    y={boxY + boxHeight + lineHeight + 15}
                                                    text={"Log2FC"}
                                                    fontSize={16}
                                                />
                                            </Layer>
                                        ) : null
                                    }
                                </Stage>
                            </TransformComponent>
                        </React.Fragment>
                    )}
                </TransformWrapper>
            </div>
            <Button style={{marginTop: '10px'}} onClick={handleSaveCanvas} icon={<DownloadOutlined/>}>
                Export as PNG
            </Button>
        </React.Fragment>
    );
};
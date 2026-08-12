import React, {useEffect, useState, useRef, useMemo, Fragment} from "react";
import {Image, Stage, Layer, Rect, Label, Group, Tag, Text, Line} from "react-konva";
import useImage from "use-image";
import {useResizeDetector} from 'react-resize-detector';
import gradientColor from "../../../../../utils/gradientColor";
import { v4 as uuidv4 } from 'uuid';
import confirmOkBtn from "../../../../../../node_modules_link/antd/es/modal/components/ConfirmOkBtn";
import {DownloadOutlined} from "@ant-design/icons";
import {Button} from "antd";

export default ({pathwayId, analysisData, selectedCase, mode, showSignificant, threshold}) => {
    const [pathwayImageUrl, setPathwayImageUrl] = useState(null);
    const [imageResolution, setImageResolution] = useState(1);
    const [geneNode, setGeneNode] = useState(null);
    const [overlayGenes, setOverlayGenes] = useState([]);
    const [gradientColorStops, setGradientColorStops] = useState([]);
    const [numLabels, setNumLabels] = useState([]);
    const [genes, setGenes] = useState([]);

    const targetContainer = useRef();
    const stageRef = useRef(null);
    let { width: refWidth } = useResizeDetector({ targetRef: targetContainer });
    let [width, setWidth] = useState(null);

    width = refWidth || width;

    useEffect(() => {
        if (genes.length > 0) return
        Meteor.asyncCallWithNotification("kegg.kgml", pathwayId).then(async (kgml) => {
            let target = kgml.elements.filter(e => e.type === "element")[0];
            if (!target) throw new Error("No target element found");

            let { elements, attributes: pathwayAttr } = target;
            let genes = elements.filter(e => e.attributes.type === "gene");
            setGenes(genes);

            let { image, resolution } = await Meteor.asyncCallWithNotification("kegg.png", pathwayAttr.image);
            setPathwayImageUrl("data:image/png;base64," + image);
            setImageResolution(resolution);
        }).catch((e) => {
            console.log(e);
        });
    }, [pathwayId]);



    const memoizedOverlayGenes = useMemo(() => {
        let all_genes = {}
        // convert genes to a dict with id as key and value has object contains array borderColors and barColors
        genes.forEach(gene => {
            all_genes[gene.attributes.id] = {
                fillColors: [],
                barColors: [],
                name: ""
            }
        })
        // predefine a list of 10 colors
        let colors = ["#FF6633", "#FFB399", "#FF33FF", "#FFFF99", "#00B3E6",
            "#E6B333", "#3366E6", "#999966", "#99FF99", "#B34D4D"]


        if (selectedCase === "multi_ora") {
            analysisData.forEach((e, index) => {
                if (e.inputType === "ora") {
                    let genesMappedInputSet = new Set(e.mappedInputGenes);
                    let genesMappedBackgroundSet = new Set(e.mappedBackgroundGenes);
                    let inputGenes = genes.filter(e => genesMappedInputSet.has(e.attributes.id));
                    let backgroundGenes = genes.filter(e => genesMappedBackgroundSet.has(e.attributes.id) && !genesMappedInputSet.has(e.attributes.id));
                    inputGenes.forEach((gene) => {
                        let geneNames = gene.elements[0]?.attributes.name.split(', ') || [];
                        all_genes[gene.attributes.id].fillColors.push({
                            "border": "red"
                        })
                        all_genes[gene.attributes.id].barColors.push(colors[index])
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                    backgroundGenes.forEach((gene) => {
                        let geneNames = gene.elements[0]?.attributes.name.split(', ') || [];
                        all_genes[gene.attributes.id].fillColors.push({
                            "border": "blue"
                        })
                        all_genes[gene.attributes.id].barColors.push(colors[index])
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                    // get genes not in input and background
                    let genesNotInInputAndBackground = genes.filter(e => !genesMappedInputSet.has(e.attributes.id) && !genesMappedBackgroundSet.has(e.attributes.id))
                    genesNotInInputAndBackground.forEach((gene) => {
                        let geneNames = gene.elements[0]?.attributes.name.split(', ') || [];
                        all_genes[gene.attributes.id].barColors.push("white")
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                } else if (e.inputType === "expression" || e.inputType === "metaDE") {
                    let genData = e.values.reduce((acc, e) => {
                        acc[e.id] = e;
                        return acc;
                    }, {});

                    // genes from express values
                    let genesFromExpression = e.values.map(e => e.id)
                    let genesFromExpressionSet = new Set(genesFromExpression)
                    let genesFromExpressionData = genes.filter(e => genesFromExpressionSet.has(e.attributes.id))
                    let genesNotFromExpressionData = genes.filter(e => !genesFromExpressionSet.has(e.attributes.id))
                    genesFromExpressionData.forEach((gene) => {
                        let geneNames = gene.attributes?.name?.split(' ') || [];
                        let geneNamesRes = gene.elements[0]?.attributes.name.split(', ') || [];
                        let geneIdsFromNames = geneNames.map(e => {
                            return e.split(':')[1];
                        });

                        let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.pValueFDR || 0), 0);
                        let average_pvalue = sum / geneIdsFromNames.length;

                        if (showSignificant && average_pvalue > threshold) {
                            all_genes[gene.attributes.id].barColors.push("transparent")
                        } else {
                            all_genes[gene.attributes.id].barColors.push(colors[index])
                        }
                        all_genes[gene.attributes.id].name = geneNamesRes[0]
                    })
                    genesNotFromExpressionData.forEach((gene) => {
                        let geneNames = gene.attributes?.name?.split(', ') || [];
                        all_genes[gene.attributes.id].barColors.push("white")
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                }
            })
            return all_genes
        } else if (selectedCase === "multi_pgsea") {
            analysisData.forEach((e, index) => {
                if (e.inputType === "pgsea") {
                    let parsedGeneData = e.inputStatsData.split('\n').reduce((acc, line) => {
                        let [gene, value] = line.split('\t');
                        acc[gene] = parseFloat(value);
                        return acc;
                    }, {});
                    let genesMappedInputSet = new Set(Object.keys(e.mappedInputGenes));
                    let genesMappedInput = genes.filter(e => genesMappedInputSet.has(e.attributes.id));
                    genesMappedInput.forEach((gene) => {
                        const geneNames = gene.elements?.[0]?.attributes?.name?.split(', ') || [];
                        const stat_value = geneNames.reduce((sum, geneName) => sum + (parsedGeneData[geneName] || 0), 0);
                        let stat_value_avg = stat_value / geneNames.length
                        all_genes[gene.attributes.id].barColors.push(gradientColor.interpolate(stat_value_avg, -1, 1, "#0000ff", "#ff0000"))
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                    // get genes not in input
                    let genesNotInInput = genes.filter(e => !genesMappedInputSet.has(e.attributes.id))
                    genesNotInInput.forEach((gene) => {
                        const geneNames = gene.elements?.[0]?.attributes?.name?.split(', ') || [];
                        all_genes[gene.attributes.id].barColors.push("white")
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                } else if (e.inputType === "expression" || e.inputType === "metaDE") {
                    let inputGeneIDs = e.values.map(e => {
                        return e.id;
                    });

                    let genData = e.values.reduce((acc, e) => {
                        acc[e.id] = e;
                        return acc;
                    }, {});

                    let inputGeneIDsSet = new Set(inputGeneIDs);
                    genes.filter(e => inputGeneIDsSet.has(e.attributes.id)).map(entry => {
                        let geneNames = entry.attributes?.name?.split(' ') || [];
                        let geneNamesRes = entry.elements[0]?.attributes.name.split(', ') || [];
                        let geneIdsFromNames = geneNames.map(e => {
                            return e.split(':')[1];
                        });

                        let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.pValueFDR || 0), 0);
                        let average_pvalue = sum / geneIdsFromNames.length;

                        if (showSignificant && average_pvalue > threshold) {
                            all_genes[entry.attributes.id].barColors.push("transparent")
                        } else {
                            let stat_value = 0;
                            let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.FC || 0), 0);
                            stat_value = sum / geneIdsFromNames.length;
                            let barColor = gradientColor.interpolate(stat_value, -1, 1, "#0000ff", "#ff0000");
                            all_genes[entry.attributes.id].barColors.push(barColor)
                        }
                        all_genes[entry.attributes.id].name = geneNamesRes[0]
                    });
                    // genes not in input
                    let genesNotInInput = genes.filter(e => !inputGeneIDsSet.has(e.attributes.id));
                    genesNotInInput.forEach((gene) => {
                        let geneNames = gene.elements[0]?.attributes.name.split(', ') || [];
                        all_genes[gene.attributes.id].barColors.push("white")
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                }
            })
            return all_genes
        } else if (selectedCase === "multi_expression") {
            analysisData.forEach((e, index) => {
                if (e.inputType === "expression" || e.inputType === "metaDE") {
                    let inputGeneIDs = e.values.map(e => {
                        return e.id;
                    });

                    let genData = e.values.reduce((acc, e) => {
                        acc[e.id] = e;
                        return acc;
                    }, {});

                    let inputGeneIDsSet = new Set(inputGeneIDs);
                    genes.filter(e => inputGeneIDsSet.has(e.attributes.id)).map(entry => {
                        let geneNames = entry.attributes?.name?.split(' ') || [];
                        let geneNamesRes = entry.elements[0]?.attributes.name.split(', ') || [];
                        let geneIdsFromNames = geneNames.map(e => {
                            return e.split(':')[1];
                        });

                        let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.pValueFDR || 0), 0);
                        let average_pvalue = sum / geneIdsFromNames.length;

                        let barColor = "";
                        if (showSignificant && average_pvalue > threshold) {
                            barColor = "transparent"
                        } else {
                            let stat_value = 0;

                            if (mode === "fc") {
                                let sum = geneIdsFromNames.reduce((sum, geneId) => sum + (genData[geneId]?.FC || 0), 0);
                                stat_value = sum / geneIdsFromNames.length;
                                barColor = gradientColor.interpolate(stat_value, -1, 1, "#0000ff", "#ff0000");
                            } else if (mode === "pValueFDR") {
                                let sum = geneIdsFromNames.reduce((sum, geneId) => sum + genData[geneId]?.pValueFDR >= 1e-16 ? -Math.log10(genData[geneId]?.pValueFDR) : -Math.log10(1e-16), 0);
                                stat_value = sum / geneIdsFromNames.length;
                                barColor = gradientColor.interpolate(stat_value, 0, 5, "#ffff00", "#ff0000");
                            }
                        }
                        all_genes[entry.attributes.id].barColors.push(barColor)
                        all_genes[entry.attributes.id].name = geneNamesRes[0]
                    });
                    // genes not in input
                    let genesNotInInput = genes.filter(e => !inputGeneIDsSet.has(e.attributes.id));
                    genesNotInInput.forEach((gene) => {
                        let geneNames = gene.elements[0]?.attributes.name.split(', ') || [];
                        all_genes[gene.attributes.id].barColors.push("white")
                        all_genes[gene.attributes.id].name = geneNames[0]
                    })
                }
            })
            return all_genes

        }
        return [];
    }, [genes, selectedCase, analysisData, mode, showSignificant, threshold]);

    const memoizedGradientColorStops = useMemo(() => {
        if (selectedCase === "multi_pgsea") {
            return [
                0, 'blue',
                0.5, 'white',
                1, 'red',
            ];
        } else if (selectedCase === "multi_expression" && mode === "fc") {
            return [
                0, 'blue',
                0.5, 'white',
                1, 'red',
            ];
        } else if (selectedCase === "multi_expression" && mode === "pValueFDR") {
            return [
                0, '#ffff00',
                5, '#ff0000',
            ];
        }
        return [];
    }, [selectedCase, mode]);

    const memoizedNumLabels = useMemo(() => {
        if (selectedCase === "multi_pgsea") {
            return [-1, -0.5, 0, 0.5, 1];
        } else if (selectedCase === "multi_expression" && mode === "fc") {
            return [-1, -0.5, 0, 0.5, 1];
        } else if (selectedCase === "multi_expression" && mode === "pValueFDR") {
            return [0, 2.5, 5];
        }
        return [];
    }, [selectedCase, mode]);

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

    const boxX = width - boxWidth - 10;
    const boxY = height - boxHeight - lineHeight - 10;

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
        <div className="App" ref={(ref) => {
            targetContainer.current = ref;
            setWidth(ref?.clientWidth || width)
        }}>
            <Stage width={width} height={height}
                   onMouseOver={onMouseOver}
                   onMouseMove={onMouseOver}
                   onDragMove={onMouseOver}
                   onMouseOut={() => setGeneNode({show: false})}
                   ref={stageRef}
            >
                <Layer>
                    <Image image={image} width={width} height={height}/>
                    <Group key={uuidv4()}>
                        {
                            Object.entries(overlayGenes).map(([geneId, geneData], index) => {
                                let gene = genes.find(e => e.attributes.id === geneId)
                                let attributes = gene.elements[0].attributes
                                return (
                                    <Fragment key={uuidv4()}>
                                        <Rect
                                            id={gene.attributes.id}
                                            height={attributes.height * scale * imageResolution}
                                            width={attributes.width * scale * imageResolution}
                                            fill={"#C0FFBF"}
                                            stroke={"black"}
                                            strokeWidth={1}
                                            x={coordinateTransform(attributes).x}
                                            y={coordinateTransform(attributes).y}
                                            key={uuidv4()}
                                        />
                                        <Group key={uuidv4()}>
                                            {
                                                geneData.barColors.every(color => color === 'white' || color === 'transparent') ? null :
                                                geneData.barColors.map((barColor, index) => {
                                                    // let gene = genes.find(e => e.attributes.id === geneId)
                                                    // let attributes = gene.elements[0].attributes
                                                    let itemWidth = attributes.width * scale * imageResolution / geneData.barColors.length
                                                    return (
                                                        <Rect
                                                            id={uuidv4()}
                                                            gene={gene}
                                                            height={5}
                                                            width={itemWidth}
                                                            fill={barColor}
                                                            stroke={"black"}
                                                            strokeWidth={1}
                                                            x={coordinateTransform(attributes).x + index * itemWidth + 0.5}
                                                            y={coordinateTransform(attributes).y + attributes.height * scale * imageResolution - 5}
                                                            key={uuidv4()}
                                                        />
                                                    )
                                                })
                                            }
                                        </Group>
                                        <Text
                                            x={coordinateTransform(attributes).x}
                                            y={coordinateTransform(attributes).y}
                                            text={geneData.name}
                                            fontSize={8}
                                            width={attributes.width * scale * imageResolution}
                                            height={attributes.height * scale * imageResolution}
                                            align="center"
                                            verticalAlign="middle"
                                            key={uuidv4()}
                                        />
                                        <Group key={uuidv4()}>
                                            {
                                                geneData.fillColors.map((fillColor, index) => {
                                                    // let gene = genes.find(e => e.attributes.id === geneId)
                                                    // let attributes = gene.elements[0].attributes
                                                    return (
                                                        <Group key={uuidv4()}>
                                                            <Rect
                                                                id={gene.attributes.id}
                                                                gene={gene}
                                                                height={attributes.height * scale * imageResolution}
                                                                width={attributes.width * scale * imageResolution}
                                                                stroke={fillColor.border}
                                                                strokeWidth={2}
                                                                {...coordinateTransform(attributes)}
                                                                key={uuidv4()}
                                                            />
                                                        </Group>
                                                    )
                                                })
                                            }
                                        </Group>
                                    </Fragment>
                                )
                            })
                        }
                    </Group>
                </Layer>
                <Layer>{tooltip()}</Layer>
                {
                    (selectedCase === "multi_pgsea" || selectedCase === "multi_expression") ? (
                        <Layer>
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

                            {numLabels.map((label, index) => (
                                <Text
                                    key={index}
                                    x={boxX + (boxWidth / (numLabels.length - 1)) * index - 3}
                                    y={boxY + lineHeight + 10}
                                    text={label.toString()}
                                    fontSize={12}
                                />
                            ))}
                        </Layer>
                    ) : null
                }
            </Stage>
            <Button onClick={handleSaveCanvas} icon={<DownloadOutlined/>}>
                Export as PNG
            </Button>
        </div>
    );
};
// /circos-d3/index.js

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Button, Space } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

const CircosD3 = ({ pathwayGenes, flows, chartId }) => {
    const chartRef = useRef(null);
    const svgRef = useRef(null);

    useEffect(() => {
        if (pathwayGenes && flows) {
            drawChart();
        }
    }, [pathwayGenes, flows]);

    const drawChart = () => {
        // Clear any existing SVG
        d3.select(chartRef.current).selectAll("*").remove();

        // Validate input data
        if (!pathwayGenes || pathwayGenes.length === 0) {
            console.warn('No pathway genes data available');
            return;
        }

        if (!flows || flows.length === 0) {
            console.warn('No flows data available');
            return;
        }

        // Chart dimensions
        var size = 800;
        var margin = { top: 50, right: 50, bottom: 50, left: 50 };
        var width = size - margin.left - margin.right;
        var height = size - margin.top - margin.bottom;
        var innerRadius = Math.min(width, height) * .39;
        var outerRadius = innerRadius * 1.08;

        // Initiate the SVG
        svgRef.current = d3.select(chartRef.current).append("svg")
            .attr("id", `circos-svg-${chartId}`)
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", "translate(" + (margin.left + width / 2) + "," + (margin.top + height / 2) + ")");

        // Create matrix from flows
        let matrix = [];
        pathwayGenes.forEach((_, i) => {
            matrix[i] = new Array(pathwayGenes.length).fill(0);
        });
        flows.forEach(flow => {
            matrix[flow.from][flow.to] = 1;
            matrix[flow.to][flow.from] = 1; // Make the matrix symmetric
        });

        var chord = customChordLayout()
            .padding(0.02)
            .sortChords(d3.ascending)
            .matrix(matrix);

        // Get groups and chords by calling the methods
        var chordGroups = chord.groups();
        var chordChords = chord.chords();

        // Validate chord layout output
        if (!chordGroups || !Array.isArray(chordGroups) ||
            !chordChords || !Array.isArray(chordChords)) {
            console.warn('Invalid chord layout data');
            return;
        }

        if (chordGroups.length === 0 || chordChords.length === 0) {
            console.warn('Empty chord layout - no data to display');
            return;
        }

        // Draw outer Arcs
        var arc = d3.arc()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius);

        var g = svgRef.current.selectAll("g.group")
            .data(chordGroups)
            .enter().append("g")
            .attr("class", function (d) { return "group " + pathwayGenes[d.index].id; });

        g.append("path")
            .attr("class", "arc")
            .style("stroke", function (d) {
                const item = pathwayGenes[d.index];
                if (item.type === "pathway") {
                    return d3.rgb(item.color).brighter();
                } else {
                    return getGeneColor(item.logFC);
                }
            })
            .style("fill", function (d) {
                const item = pathwayGenes[d.index];
                if (item.type === "pathway") {
                    return item.color;
                } else {
                    return getGeneColor(item.logFC);
                }
            })
            .attr("d", function(d) {
                // Guard against NaN values
                if (isNaN(d.startAngle) || isNaN(d.endAngle)) {
                    console.warn('Invalid arc angles:', d);
                    return '';
                }
                return arc(d);
            })
            .on("click", (event, d) => highlightChords(d.index));

        function getGeneColor(logFC) {
            const colorScale = d3.scaleLinear()
                .domain([-1.5, 0, 1.5])
                .range(["blue", "white", "red"]);
            return colorScale(logFC);
        }

        // Add labels for pathways and genes
        g.append("text")
            .each(function (d) { d.angle = (d.startAngle + d.endAngle) / 2; })
            .attr("dy", ".35em")
            .attr("class", "titles")
            .attr("text-anchor", function (d) { return d.angle > Math.PI ? "end" : null; })
            .attr("transform", function (d) {
                // Guard against NaN values
                if (isNaN(d.angle)) {
                    console.warn('Invalid text angle:', d);
                    return '';
                }
                return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")"
                    + "translate(" + (outerRadius + 10) + ")"
                    + (d.angle > Math.PI ? "rotate(180)" : "");
            })
            .text(function (d) { return pathwayGenes[d.index].name; })
            .style("font-size", "10px")
            .style("fill", "#333");

        // Initiate inner chords
        var chords = svgRef.current.selectAll("path.chord")
            .data(chordChords)
            .enter().append("path")
            .attr("class", function (d) {
                return "chord chord-source-" + d.source.index + " chord-target-" + d.target.index;
            })
            .style("fill-opacity", "0.7")
            .style("stroke-opacity", "1")
            .style("fill", function (d) {
                return `url(#chordGradient-${chartId}-${d.source.index}-${d.target.index})`;
            })
            .style("stroke", function (d) {
                return `url(#chordGradient-${chartId}-${d.source.index}-${d.target.index})`;
            })
            .attr("d", customChordPathGenerator().radius(innerRadius))
            .on("click", () => showAllChords());

        // Create gradient definitions
        var grads = svgRef.current.append("defs").selectAll("linearGradient")
            .data(chordChords.filter(d =>
                !isNaN(d.source.startAngle) && !isNaN(d.source.endAngle) &&
                !isNaN(d.target.startAngle) && !isNaN(d.target.endAngle)
            ))
            .enter().append("linearGradient")
            .attr("id", function (d) {
                return `chordGradient-${chartId}-${d.source.index}-${d.target.index}`;
            })
            .attr("gradientUnits", "userSpaceOnUse")
            .attr("x1", function (d) {
                return innerRadius * Math.cos((d.source.endAngle - d.source.startAngle) / 2 +
                    d.source.startAngle - Math.PI / 2);
            })
            .attr("y1", function (d) {
                return innerRadius * Math.sin((d.source.endAngle - d.source.startAngle) / 2 +
                    d.source.startAngle - Math.PI / 2);
            })
            .attr("x2", function (d) {
                return innerRadius * Math.cos((d.target.endAngle - d.target.startAngle) / 2 +
                    d.target.startAngle - Math.PI / 2);
            })
            .attr("y2", function (d) {
                return innerRadius * Math.sin((d.target.endAngle - d.target.startAngle) / 2 +
                    d.target.startAngle - Math.PI / 2);
            });

        grads.append("stop")
            .attr("offset", "0%")
            .attr("stop-color", function (d) { return pathwayGenes[d.source.index].color || getGeneColor(pathwayGenes[d.source.index].logFC); });

        grads.append("stop")
            .attr("offset", "100%")
            .attr("stop-color", function (d) { return pathwayGenes[d.target.index].color || getGeneColor(pathwayGenes[d.target.index].logFC); });
    };

    const highlightChords = (index) => {
        if (!svgRef.current) return;

        const chords = svgRef.current.selectAll("path.chord");

        if (chords.filter(`.chord-source-${index}, .chord-target-${index}`).size() === 0) {
            showAllChords();
            return;
        }

        chords
            .style("fill-opacity", function(d) {
                return (d.source.index === index || d.target.index === index) ? 0.7 : 0.01;
            })
            .style("stroke-opacity", function(d) {
                return (d.source.index === index || d.target.index === index) ? 1 : 0.01;
            });
    };

    const showAllChords = () => {
        if (!svgRef.current) return;

        svgRef.current.selectAll("path.chord")
            .style("fill-opacity", "0.7")
            .style("stroke-opacity", "1");
    };

    const exportSVG = () => {
        // Get the SVG element
        const svgElement = document.getElementById(`circos-svg-${chartId}`);
        if (!svgElement) {
            console.error('SVG element not found');
            return;
        }

        // Clone the SVG element to avoid modifying the original
        const clonedSvg = svgElement.cloneNode(true);

        // Serialize the SVG to a string
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clonedSvg);

        // Create a blob from the SVG string
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });

        // Create a download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `circos-plot-${chartId}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the URL object
        URL.revokeObjectURL(url);
    };

    const exportPNG = () => {
        // Get the SVG element
        const svgElement = document.getElementById(`circos-svg-${chartId}`);
        if (!svgElement) {
            console.error('SVG element not found');
            return;
        }

        // Clone the SVG element
        const clonedSvg = svgElement.cloneNode(true);

        // Get SVG dimensions
        const bbox = svgElement.getBoundingClientRect();
        const width = bbox.width;
        const height = bbox.height;

        // Serialize the SVG to a string
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clonedSvg);

        // Create a canvas element
        const canvas = document.createElement('canvas');
        canvas.width = width * 4; // Higher resolution (4x)
        canvas.height = height * 4;
        const ctx = canvas.getContext('2d');
        ctx.scale(4, 4); // Scale for higher resolution

        // Create an image from the SVG
        const img = new Image();
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
            // Draw the image on the canvas
            ctx.drawImage(img, 0, 0);

            // Convert canvas to PNG blob
            canvas.toBlob((blob) => {
                // Create download link
                const pngUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = pngUrl;
                link.download = `circos-plot-${chartId}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Clean up
                URL.revokeObjectURL(pngUrl);
                URL.revokeObjectURL(url);
            });
        };

        img.onerror = (error) => {
            console.error('Error loading SVG image:', error);
            URL.revokeObjectURL(url);
        };

        img.src = url;
    };

    function sortGenesByLogFC(a, b) {
        if (pathwayGenes[a].type === "pathway" || pathwayGenes[b].type === "pathway") {
            return 0; // Keep pathways in their original order
        }
        return pathwayGenes[a].logFC - pathwayGenes[b].logFC;
    }
    // Custom chord layout function
    function customChordLayout() {
        var ε = 1e-6, ε2 = ε * ε, π = Math.PI, τ = 2 * π, τε = τ - ε, halfπ = π / 2, d3_radians = π / 180, d3_degrees = 180 / π;
        var chord = {}, chords, groups, matrix, n, padding = 0, sortGroups, sortSubgroups, sortChords;
        function relayout() {
            // Sort pathwayGenes so that pathways come first, then genes sorted by logFC
            var sortedIndexes = d3.range(n).sort((a, b) => {
                if (pathwayGenes[a].type !== pathwayGenes[b].type) {
                    return pathwayGenes[a].type === "pathway" ? -1 : 1;
                }
                return sortGenesByLogFC(a, b);
            });

            // Use sortedIndexes to reorder the matrix
            matrix = sortedIndexes.map(i => sortedIndexes.map(j => matrix[i][j]));

            // Update pathwayGenes order
            pathwayGenes = sortedIndexes.map(i => pathwayGenes[i]);
            // Sort pathwayGenes so that pathways come first
            var sortedIndexes = d3.range(n).sort((a, b) => {
                if (pathwayGenes[a].type === pathwayGenes[b].type) return 0;
                return pathwayGenes[a].type === "pathway" ? -1 : 1;
            });

            // Use sortedIndexes to reorder the matrix
            matrix = sortedIndexes.map(i => sortedIndexes.map(j => matrix[i][j]));

            // Update pathwayGenes order
            pathwayGenes = sortedIndexes.map(i => pathwayGenes[i]);

            var subgroups = {}, groupSums = [], groupIndex = d3.range(n), subgroupIndex = [], k, x, x0, i, j;
            var numSeq;
            chords = [];
            groups = [];
            k = 0, i = -1;

            while (++i < n) {
                x = 0, j = -1, numSeq = [];
                while (++j < n) {
                    x += matrix[i][j];
                }
                groupSums.push(x);
                for (var m = 0; m < n; m++) {
                    numSeq[m] = (n + (i - 1) - m) % n;
                }
                subgroupIndex.push(numSeq);
                k += x;
            }

            k = (τ - padding * n) / k;
            x = 0, i = -1;
            while (++i < n) {
                x0 = x, j = -1;
                while (++j < n) {
                    var di = groupIndex[i], dj = subgroupIndex[di][j], v = matrix[di][dj], a0 = x, a1 = x += v * k;
                    subgroups[di + "-" + dj] = {
                        index: di,
                        subindex: dj,
                        startAngle: a0,
                        endAngle: a1,
                        value: v
                    };
                }
                groups[di] = {
                    index: di,
                    startAngle: x0,
                    endAngle: x,
                    value: (x - x0) / k
                };
                x += padding;
            }

            i = -1;
            while (++i < n) {
                j = i - 1;
                while (++j < n) {
                    var source = subgroups[i + "-" + j], target = subgroups[j + "-" + i];
                    if (source.value || target.value) {
                        chords.push(source.value < target.value ? {
                            source: target,
                            target: source
                        } : {
                            source: source,
                            target: target
                        });
                    }
                }
            }
            if (sortChords) resort();
        }

        function resort() {
            chords.sort(function (a, b) {
                return sortChords((a.source.value + a.target.value) / 2, (b.source.value + b.target.value) / 2);
            });
        }
        chord.matrix = function (x) {
            if (!arguments.length) return matrix;
            n = (matrix = x) && matrix.length;
            chords = groups = null;
            return chord;
        };
        chord.padding = function (x) {
            if (!arguments.length) return padding;
            padding = x;
            chords = groups = null;
            return chord;
        };
        chord.sortGroups = function (x) {
            if (!arguments.length) return sortGroups;
            sortGroups = x;
            chords = groups = null;
            return chord;
        };
        chord.sortSubgroups = function (x) {
            if (!arguments.length) return sortSubgroups;
            sortSubgroups = x;
            chords = null;
            return chord;
        };
        chord.sortChords = function (x) {
            if (!arguments.length) return sortChords;
            sortChords = x;
            if (chords) resort();
            return chord;
        };
        chord.chords = function () {
            if (!chords) relayout();
            return chords;
        };
        chord.groups = function () {
            if (!groups) relayout();
            return groups;
        };
        return chord;
    }

    // Custom chord path generator
    function customChordPathGenerator() {
        var source = function(d) { return d.source; };
        var target = function(d) { return d.target; };
        var radius = function(d) { return d.radius; };
        var startAngle = function(d) { return d.startAngle; };
        var endAngle = function(d) { return d.endAngle; };

        function chord(d, i) {
            var s = subgroup(this, source, d, i),
                t = subgroup(this, target, d, i);

            var path = "M" + s.p0
                + arc(s.r, s.p1, s.a1 - s.a0) + (equals(s, t)
                    ? curve(s.r, s.p1, s.a1, s.r, s.p0, s.a0)
                    : curve(s.r, s.p1, s.a1, t.r, t.p0, t.a0)
                    + arc(t.r, t.p1, t.a1 - t.a0)
                    + curve(t.r, t.p1, t.a1, s.r, s.p0, s.a0))
                + "Z";

            return path;
        }

        function subgroup(self, f, d, i) {
            var subgroup = f.call(self, d, i),
                r = radius.call(self, subgroup, i),
                a0 = startAngle.call(self, subgroup, i) - (Math.PI / 2),
                a1 = endAngle.call(self, subgroup, i) - (Math.PI / 2);

            return {
                r: r,
                a0: a0,
                a1: a1,
                p0: [r * Math.cos(a0), r * Math.sin(a0)],
                p1: [r * Math.cos(a1), r * Math.sin(a1)]
            };
        }

        function equals(a, b) {
            return a.a0 == b.a0 && a.a1 == b.a1;
        }

        function arc(r, p, a) {
            return "A" + r + "," + r + " 0 " + +(a > Math.PI) + ",1 " + p;
        }

        function curve(r0, p0, a0, r1, p1, a1) {
            //////////////////////////////////////
            ////////////// New part //////////////
            //////////////////////////////////////
            var deltaAngle = Math.abs(mod((a1 - a0 + Math.PI), (2 * Math.PI)) - Math.PI);
            var radialControlPointScale = Math.pow((Math.PI - deltaAngle) / Math.PI, 2) * 0.9;
            var controlPoint1 = [p0[0] * radialControlPointScale, p0[1] * radialControlPointScale];
            var controlPoint2 = [p1[0] * radialControlPointScale, p1[1] * radialControlPointScale];
            var cubicBezierSvg = "C " + controlPoint1[0] + " " + controlPoint1[1] + ", " + controlPoint2[0] + " " + controlPoint2[1] + ", " + p1[0] + " " + p1[1];
            return cubicBezierSvg;
            //////////////////////////////////////
            //////////  End new part /////////////
            //////////////////////////////////////
        }

        function mod(a, n) {
            return (a % n + n) % n;
        }

        chord.radius = function(v) {
            if (!arguments.length) return radius;
            radius = typeof v === "function" ? v : function() { return v; };
            return chord;
        };

        chord.source = function(v) {
            if (!arguments.length) return source;
            source = typeof v === "function" ? v : function() { return v; };
            return chord;
        };

        chord.target = function(v) {
            if (!arguments.length) return target;
            target = typeof v === "function" ? v : function() { return v; };
            return chord;
        };

        chord.startAngle = function(v) {
            if (!arguments.length) return startAngle;
            startAngle = typeof v === "function" ? v : function() { return v; };
            return chord;
        };

        chord.endAngle = function(v) {
            if (!arguments.length) return endAngle;
            endAngle = typeof v === "function" ? v : function() { return v; };
            return chord;
        };

        return chord;
    }

    return (
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <Space.Compact style={{ position: 'absolute', top: 0, right: 0, zIndex: 10 }}>
                <Button
                    icon={<DownloadOutlined />}
                    onClick={exportSVG}
                    type="primary"
                >
                    SVG
                </Button>
                <Button
                    icon={<DownloadOutlined />}
                    onClick={exportPNG}
                    type="primary"
                >
                    PNG
                </Button>
            </Space.Compact>
            <div ref={chartRef}></div>
        </div>
    );
};

export default CircosD3;
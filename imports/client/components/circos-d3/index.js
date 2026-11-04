// /circos-d3/index.js

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Button, Space } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

// Emphasis colour for a highlighted gene's arc outline and label. Deliberately applied to
// the OUTLINE and the label, never to the arc fill or to a node `color` field: gene fill
// encodes log2 fold change, and circos-d3's chord gradients read `node.color || getGeneColor(
// node.logFC)`, so a colour on a gene node would replace that reading in every chord it
// touches — the opposite of what highlighting should do.
const HIGHLIGHT_OUTLINE = "#111827";

const CircosD3 = ({ pathwayGenes, flows, chartId }) => {
    const chartRef = useRef(null);
    const svgRef = useRef(null);
    // The highlight-aware chord opacity baseline for the CURRENT draw, so showAllChords()
    // can restore it instead of the old hardcoded constants.
    const chordBaselineRef = useRef(null);
    // An IntersectionObserver waiting to size the canvas once the chart is actually
    // visible. Held so a redraw or an unmount can drop it — see fitWhenVisible.
    const pendingFitRef = useRef(null);

    const cancelPendingFit = () => {
        if (pendingFitRef.current) {
            pendingFitRef.current.disconnect();
            pendingFitRef.current = null;
        }
    };

    useEffect(() => {
        if (pathwayGenes && flows) {
            drawChart();
        }
    }, [pathwayGenes, flows]);

    useEffect(() => cancelPendingFit, []);

    const drawChart = () => {
        // Clear any existing SVG
        cancelPendingFit();
        d3.select(chartRef.current).selectAll("*").remove();
        // Drop the previous draw's baseline up front: every early return below leaves no
        // chords to restyle, but a stale closure over the old pathwayGenes should not outlive
        // the chart it described.
        chordBaselineRef.current = null;

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

        // Initiate the SVG. `size` is the drawing box for the ring itself; the labels
        // fan out past it and the canvas is grown to fit them once they are measured
        // (see fitToContent at the end of this function).
        const svgRoot = d3.select(chartRef.current).append("svg")
            .attr("id", `circos-svg-${chartId}`)
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            // Never let the drawing spill outside its own footprint on the page: the
            // canvas grows to fit the content, and this keeps it scaled to the panel.
            .style("max-width", "100%")
            .style("height", "auto")
            // Name the font explicitly instead of inheriting the page's. The canvas is
            // sized by measuring the drawn labels, but neither export renders with the
            // page's CSS — a standalone .svg has no document to inherit from, and the
            // raster path draws the SVG through an <img>, which is an isolated context.
            // Both would fall back to the UA default (typically a serif), laying the
            // text out in a different font from the one the box was fitted around and
            // clipping it again. Measuring and exporting must agree on the font.
            .attr("font-family", "Arial, Helvetica, sans-serif");
        svgRef.current = svgRoot
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

        // MUST be computed HERE, not earlier: chord.groups()/chord.chords() above triggered
        // relayout(), which REASSIGNED the `pathwayGenes` binding to a sorted copy. From this
        // point on `pathwayGenes[d.index]` is authoritative and node.id !== d.index, so the
        // highlight set has to be keyed by post-relayout POSITION. (Never key off the
        // `.group.<id>` class written below either — that is the pre-relayout id.)
        const highlightPositions = new Set();
        pathwayGenes.forEach((node, i) => {
            if (node && node.type !== "pathway" && node.highlighted) highlightPositions.add(i);
        });
        const hasHighlight = highlightPositions.size > 0;
        const isHighlighted = (i) => highlightPositions.has(i);
        const chordTouchesHighlight = (d) =>
            isHighlighted(d.source.index) || isHighlighted(d.target.index);

        // Highlight-aware opacity baseline for the chords. Non-highlighted chords drop to a
        // readable SECONDARY tier rather than becoming invisible: the Circos is a relationship
        // diagram, so the surrounding context has to stay legible.
        const chordFillOpacity = (d) => (!hasHighlight || chordTouchesHighlight(d)) ? 0.7 : 0.25;
        const chordStrokeOpacity = (d) => (!hasHighlight || chordTouchesHighlight(d)) ? 1 : 0.25;
        // Stashed so showAllChords() restores THIS baseline; resetting to the old hardcoded
        // 0.7/1 would silently wipe the highlighting on the first chord click.
        chordBaselineRef.current = {fill: chordFillOpacity, stroke: chordStrokeOpacity};

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
                }
                // A dark outline is the highlight emphasis that survives ANY fold-change
                // colour, including the near-white middle of the blue->white->red scale.
                if (item.highlighted) {
                    return HIGHLIGHT_OUTLINE;
                }
                return item.color || getGeneColor(item.logFC);
            })
            .style("stroke-width", function (d) {
                const item = pathwayGenes[d.index];
                return (item.type !== "pathway" && item.highlighted) ? 2.5 : 1;
            })
            .style("fill", function (d) {
                const item = pathwayGenes[d.index];
                if (item.type === "pathway") {
                    return item.color;
                }
                // `item.color ||` aligns the arcs with the chord gradients below, which have
                // always preferred an explicit colour. Highlighted genes deliberately keep
                // their fold-change fill: overwriting it would destroy the log2FC reading for
                // exactly the genes the user cares most about.
                return item.color || getGeneColor(item.logFC);
            })
            .style("opacity", function (d) {
                const item = pathwayGenes[d.index];
                if (!hasHighlight || item.type === "pathway") return 1;
                return isHighlighted(d.index) ? 1 : 0.4;
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
            // Font size stays 10px even when highlighted: enlarging it nudges the label into
            // its neighbours, which is the very crowding the gene target exists to relieve.
            // Weight and colour carry the emphasis instead.
            .style("font-size", "10px")
            .style("font-weight", function (d) {
                const item = pathwayGenes[d.index];
                return (item.type !== "pathway" && item.highlighted) ? 700 : 400;
            })
            .style("fill", function (d) {
                const item = pathwayGenes[d.index];
                if (item.type !== "pathway" && item.highlighted) return HIGHLIGHT_OUTLINE;
                if (!hasHighlight || item.type === "pathway") return "#333";
                return "#9a9a9a";
            });

        // Initiate inner chords
        var chords = svgRef.current.selectAll("path.chord")
            .data(chordChords)
            .enter().append("path")
            .attr("class", function (d) {
                return "chord chord-source-" + d.source.index + " chord-target-" + d.target.index;
            })
            .style("fill-opacity", chordFillOpacity)
            .style("stroke-opacity", chordStrokeOpacity)
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

        fitToContent(svgRoot);
    };

    // Grow the canvas to whatever was actually drawn.
    //
    // Pathway labels are placed at `outerRadius + 10` and run radially outward, so
    // their length is bounded by nothing: the median gene-set name is ~33 characters
    // (~170px at 10px) against the ~95px the fixed 800x800 box leaves outside the ring.
    // Almost every pathway label was therefore clipped by the SVG viewport — on screen
    // and, because both exports serialize this same node, in every exported file too.
    //
    // Measuring beats guessing a bigger margin: getBBox() reports the union of what was
    // rendered, text included, so the box fits the labels that exist rather than the
    // ones we assumed. Setting width/height to the content size keeps the exports at
    // full resolution, and the max-width style above scales the drawing down to the
    // panel on screen instead of overflowing the page.
    //
    // Nothing can be measured while the chart is not being RENDERED, and the section
    // redraws every mounted pane — including the ones antd's Tabs and Collapse keep
    // alive behind `display: none`. Waiting a frame does not help there: it is still
    // hidden a frame later, the fit would be abandoned, and the pane would go back on
    // screen at the old fixed size with every label clipped. So wait for VISIBILITY
    // instead, which also covers a layout that simply had not settled yet.
    //
    // Bounded, because an IntersectionObserver always delivers an initial observation:
    // a chart that is on screen yet somehow still measures empty would otherwise bounce
    // between observing and measuring forever.
    const MAX_FIT_ATTEMPTS = 3;

    const fitWhenVisible = (svgRoot, attempt) => {
        cancelPendingFit();
        const node = svgRoot.node();
        if (!node || attempt >= MAX_FIT_ATTEMPTS || typeof IntersectionObserver !== 'function') return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            cancelPendingFit();
            fitToContent(svgRoot, attempt + 1);
        }, { rootMargin: '600px' });
        observer.observe(node);
        pendingFitRef.current = observer;
    };

    const fitToContent = (svgRoot, attempt = 0) => {
        const node = svgRoot.node();
        // A redraw replaces the whole svg, so a deferred fit queued against the previous
        // one must not resize a node that is no longer on the page.
        if (!node || !node.isConnected) return;

        // getBBox reports zeros for a display:none subtree in Chrome and throws in
        // Firefox — same cause either way, so both defer rather than give up, which
        // would silently reinstate the clipping.
        let box = null;
        try {
            box = node.getBBox();
        } catch (err) {
            box = null;
        }
        if (!box || !(box.width > 0) || !(box.height > 0)) {
            fitWhenVisible(svgRoot, attempt);
            return;
        }

        // Whole pixels, rounded outward so the box only ever grows — a measured box is a
        // lower bound on what has to fit, never an upper one.
        const pad = 8;
        const x = Math.floor(box.x - pad);
        const y = Math.floor(box.y - pad);
        const w = Math.ceil(box.x + box.width + pad) - x;
        const h = Math.ceil(box.y + box.height + pad) - y;
        svgRoot
            .attr("viewBox", `${x} ${y} ${w} ${h}`)
            .attr("width", w)
            .attr("height", h);
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

        // Restore the highlight-aware baseline from the current draw, NOT a flat 0.7/1 —
        // otherwise a single chord click silently wipes the gene highlighting.
        const baseline = chordBaselineRef.current;
        svgRef.current.selectAll("path.chord")
            .style("fill-opacity", baseline ? baseline.fill : 0.7)
            .style("stroke-opacity", baseline ? baseline.stroke : 1);
    };

    // One clone path for both exports, so an SVG and a PNG of the same plot can never
    // disagree. The on-screen `max-width: 100%` / `height: auto` exists to keep a wide
    // plot inside its panel; carried into a standalone file those override the width and
    // height attributes and the drawing renders at whatever the viewer feels like, so
    // they are stripped and the measured size is left to speak for itself.
    const cloneForExport = (svgElement) => {
        const clone = svgElement.cloneNode(true);
        clone.style.maxWidth = '';
        clone.style.height = '';
        return clone;
    };

    const exportSVG = () => {
        // Get the SVG element
        const svgElement = document.getElementById(`circos-svg-${chartId}`);
        if (!svgElement) {
            console.error('SVG element not found');
            return;
        }

        const clonedSvg = cloneForExport(svgElement);

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

        const clonedSvg = cloneForExport(svgElement);

        // Size the raster from the SVG's OWN width/height, not getBoundingClientRect.
        // The rect reports the element's box on the page, which the `max-width: 100%`
        // above shrinks to the panel — so a wide plot would have been rasterized at
        // whatever happened to fit the screen while the SVG export kept full size. Both
        // exports now carry the same drawing at the same resolution.
        const width = Number(svgElement.getAttribute('width')) || svgElement.getBoundingClientRect().width;
        const height = Number(svgElement.getAttribute('height')) || svgElement.getBoundingClientRect().height;

        // Serialize the SVG to a string
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clonedSvg);

        // Higher resolution (4x), but back off for a plot whose labels made the canvas
        // large: browsers refuse to produce a blob past a total-pixel cap (Safari's is
        // ~16.7M) and hand back null instead. A 4x raster of a wide circos now clears
        // that on its own, so trade DPI for the export rather than losing it. The floor
        // at 1 means this is a soft cap — a drawing already past the budget at 1:1 is
        // never downscaled below its own size, and the null guard below catches it.
        const MAX_CANVAS_PIXELS = 16e6;
        const scale = Math.max(1, Math.min(4, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height))));

        // Ceil, not round: the destination rect below is width*scale, and a canvas
        // rounded down would crop the last fraction of a pixel off it.
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        // Create an image from the SVG
        const img = new Image();
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
            // Draw at the measured size explicitly rather than relying on the SVG's
            // intrinsic sizing, which browsers resolve inconsistently for a blob image.
            ctx.drawImage(img, 0, 0, width, height);

            // Convert canvas to PNG blob
            canvas.toBlob((blob) => {
                // A canvas the browser will not encode yields null here, and passing
                // that to createObjectURL throws inside this callback where nothing
                // catches it — leaving the user with a silently dead Export button.
                if (!blob) {
                    console.error('circos: the browser could not encode a PNG this large');
                    URL.revokeObjectURL(url);
                    return;
                }
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
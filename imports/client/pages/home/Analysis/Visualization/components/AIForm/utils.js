// utils.js - Utility functions and helper components

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Space, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { normalizeMermaidCode } from '/imports/utils/mermaidCode';

const { Text } = Typography;

// Helper function to create URL-friendly slugs from heading text
export const slugify = (text) => {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
};

// Helper function to extract headings from markdown content
export const extractMarkdownHeadings = (markdownContent) => {
    if (!markdownContent) return [];

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings = [];
    let match;

    while ((match = headingRegex.exec(markdownContent)) !== null) {
        const level = match[1].length; // Number of # characters
        const text = match[2].trim();
        const id = slugify(text);

        headings.push({
            level,
            text,
            id
        });
    }

    return headings;
};

// Helper function to build hierarchical TOC structure
export const buildTOCHierarchy = (headings) => {
    if (!headings || headings.length === 0) return [];

    const result = [];
    const stack = [];

    headings.forEach(heading => {
        const node = { ...heading, children: [] };

        // Find the parent for this heading
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }

        if (stack.length === 0) {
            // Top-level heading
            result.push(node);
        } else {
            // Nested heading
            stack[stack.length - 1].children.push(node);
        }

        stack.push(node);
    });

    return result;
};

// Helper functions for processing references
export const extractPaperIds = (text) => {
    const paperIdRegex = /\[([a-f0-9]{40})\]/g;
    const paperIds = [];
    const paperIdPositions = [];
    let match;

    while ((match = paperIdRegex.exec(text)) !== null) {
        const paperId = match[1];
        const position = match.index;
        paperIds.push(paperId);
        paperIdPositions.push({
            paperId,
            position,
            fullMatch: match[0]
        });
    }

    return { paperIds, paperIdPositions };
};

export const createReferenceMapping = (paperIds) => {
    const mapping = new Map();
    const orderedIds = [];
    let currentIndex = 1;

    paperIds.forEach(paperId => {
        if (!mapping.has(paperId)) {
            mapping.set(paperId, currentIndex);
            orderedIds.push(paperId);
            currentIndex++;
        }
    });

    return { mapping, orderedIds };
};

export const convertPaperIdsToNumbers = (text, referenceMapping) => {
    const paperIdRegex = /\[([a-f0-9]{40})\]/g;

    return text.replace(paperIdRegex, (match, paperId) => {
        const refNumber = referenceMapping.get(paperId);
        return refNumber ? `[${refNumber}]` : ''; // Remove unfound paper IDs entirely
    });
};

export const formatReference = (reference) => {
    const bibtex = reference?.bibtex_json;
    if (!bibtex || bibtex === null) {
        console.warn('Reference has null or missing bibtex_json:', reference?.paperId);
        return 'Reference not available';
    }

    const authors = bibtex.authors?.length > 0
        ? bibtex.authors.length > 3
            ? `${bibtex.authors.slice(0, 3).join(', ')} et al.`
            : bibtex.authors.join(', ')
        : bibtex.author || 'Unknown authors';

    const title = bibtex.title || 'Untitled';
    const year = bibtex.year || 'Unknown year';
    const journal = bibtex.journal || bibtex.booktitle || 'Unknown journal';

    return `${authors}. ${title}. ${journal}, ${year}.`;
};

// Initialize Mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
    }
});

// Mermaid Diagram Component
const MermaidDiagram = ({ chart }) => {
    const ref = useRef(null);
    const [svg, setSvg] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (chart) {
            try {
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                const normalizedChart = normalizeMermaidCode(chart);

                mermaid.render(id, normalizedChart)
                    .then(({ svg }) => {
                        setSvg(svg);
                        setError(null);
                    })
                    .catch(err => {
                        console.error('Mermaid render error:', err);
                        setError(err.message);
                        setSvg(null);
                    });
            } catch (error) {
                console.error('Mermaid error:', error);
                setError(error.message);
            }
        }
    }, [chart]);

    if (error) {
        return (
            <div style={{
                padding: '10px',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '4px',
                color: '#856404'
            }}>
                <strong>Mermaid Diagram Error:</strong> {error}
                <pre style={{ marginTop: '8px', fontSize: '12px' }}>{chart}</pre>
            </div>
        );
    }

    if (svg) {
        return <div ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />;
    }

    return (
        <div style={{ padding: '10px', backgroundColor: '#f8f9fa' }}>
            <pre><code>{chart}</code></pre>
        </div>
    );
};

export const MarkdownWithReferences = ({ content, references, referenceMapping, onReferenceClick, collapsible = true }) => {
    const [collapsedSections, setCollapsedSections] = useState({});

    // Split content into sections by H2 headings
    const sections = useMemo(() => {
        if (!content) return [];

        const lines = content.split('\n');
        const result = [];
        let currentSection = { title: null, content: [], id: 'intro' };

        lines.forEach((line) => {
            const h2Match = line.match(/^## (.+)$/);
            if (h2Match) {
                // Save previous section if it has content
                if (currentSection.content.length > 0 || currentSection.title) {
                    result.push(currentSection);
                }
                // Start new section
                const title = h2Match[1];
                currentSection = {
                    title,
                    content: [],
                    id: slugify(title)
                };
            } else {
                currentSection.content.push(line);
            }
        });

        // Don't forget the last section
        if (currentSection.content.length > 0 || currentSection.title) {
            result.push(currentSection);
        }

        return result;
    }, [content]);

    const toggleSection = (sectionId) => {
        setCollapsedSections(prev => ({
            ...prev,
            [sectionId]: !prev[sectionId]
        }));
    };

    // Custom component for handling references within markdown
    const ReferenceSpan = ({ children, ...props }) => {
        if (typeof children === 'string') {
            const referenceRegex = /\[(\d+)\]/g;
            const parts = [];
            let lastIndex = 0;
            let match;

            while ((match = referenceRegex.exec(children)) !== null) {
                // Add text before the match
                if (match.index > lastIndex) {
                    parts.push(children.slice(lastIndex, match.index));
                }

                // Add the clickable reference
                const refNumber = parseInt(match[1]);

                parts.push(
                    <span
                        key={`ref-${match.index}`}
                        style={{
                            color: '#1890ff',
                            cursor: 'pointer',
                            textDecoration: 'none',
                            fontWeight: 'normal'
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onReferenceClick && onReferenceClick(refNumber);
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.textDecoration = 'underline';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.textDecoration = 'none';
                        }}
                    >
                        [{match[1]}]
                    </span>
                );

                lastIndex = match.index + match[0].length;
            }

            // Add remaining text
            if (lastIndex < children.length) {
                parts.push(children.slice(lastIndex));
            }

            if (parts.length > 1) {
                return <span {...props}>{parts}</span>;
            }
        }

        return <span {...props}>{children}</span>;
    };

    const markdownComponents = useMemo(() => ({
        // Render each markdown element with its proper (block/inline) tag while still
        // processing [n] references inside. Previously these all mapped to ReferenceSpan,
        // which returns an inline <span> — that dropped list bullets/line breaks (every
        // <li> collapsed onto one line) and lost <p>/<strong>/<em> semantics.
        p: ({ children, ...props }) => <p {...props}><ReferenceSpan>{children}</ReferenceSpan></p>,
        li: ({ children, ...props }) => <li {...props}><ReferenceSpan>{children}</ReferenceSpan></li>,
        strong: ({ children, ...props }) => <strong {...props}><ReferenceSpan>{children}</ReferenceSpan></strong>,
        em: ({ children, ...props }) => <em {...props}><ReferenceSpan>{children}</ReferenceSpan></em>,
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            // Render Mermaid diagrams
            if (language === 'mermaid' && !inline) {
                return <MermaidDiagram chart={String(children).replace(/\n$/, '')} />;
            }

            // Handle references in inline code
            if (inline) {
                return <ReferenceSpan {...props}><code className={className}>{children}</code></ReferenceSpan>;
            }

            // Regular code blocks
            return <code className={className} {...props}>{children}</code>;
        },
        // Add IDs to headings for navigation
        h1: ({children, ...props}) => {
            const id = slugify(String(children));
            return <h1 id={id} style={{scrollMarginTop: '100px'}} {...props}>{children}</h1>;
        },
        h2: ({children, ...props}) => {
            const id = slugify(String(children));
            return <h2 id={id} style={{scrollMarginTop: '100px'}} {...props}>{children}</h2>;
        },
        h3: ({children, ...props}) => {
            const id = slugify(String(children));
            return <h3 id={id} style={{scrollMarginTop: '100px'}} {...props}>{children}</h3>;
        },
        h4: ({children, ...props}) => {
            const id = slugify(String(children));
            return <h4 id={id} style={{scrollMarginTop: '100px'}} {...props}>{children}</h4>;
        },
        h5: ({children, ...props}) => {
            const id = slugify(String(children));
            return <h5 id={id} style={{scrollMarginTop: '100px'}} {...props}>{children}</h5>;
        },
        h6: ({children, ...props}) => {
            const id = slugify(String(children));
            return <h6 id={id} style={{scrollMarginTop: '100px'}} {...props}>{children}</h6>;
        },
    }), [references, onReferenceClick]);

    if (!content) {
        return <div>No content available</div>;
    }

    return (
        <>
            <style>{`
                .markdown-with-refs p {
                    margin-bottom: 1em;
                    line-height: 1.6;
                }
                .markdown-with-refs table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1.5em 0;
                    font-size: 0.9em;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
                }
                .markdown-with-refs th {
                    background-color: #f9fafb;
                    border: 1px solid #e5e7eb;
                    padding: 12px;
                    text-align: left;
                    font-weight: 600;
                    color: #374151;
                }
                .markdown-with-refs td {
                    border: 1px solid #e5e7eb;
                    padding: 10px 12px;
                    text-align: left;
                    color: #1f2937;
                }
                .markdown-with-refs tbody tr:nth-child(even) {
                    background-color: #f9fafb;
                }
                .markdown-with-refs tbody tr:hover {
                    background-color: #f3f4f6;
                }
                .markdown-with-refs thead tr {
                    background-color: #f3f4f6;
                }
                .collapsible-section-header {
                    cursor: pointer;
                    user-select: none;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .collapsible-section-header:hover {
                    color: #1890ff;
                }
                .collapse-icon {
                    transition: transform 0.2s;
                    font-size: 12px;
                }
                .collapse-icon.collapsed {
                    transform: rotate(-90deg);
                }
            `}</style>
            <div className="prose max-w-none markdown-with-refs">
                {collapsible && sections.length > 1 ? (
                    // Render with collapsible H2 sections
                    sections.map((section, index) => (
                        <div key={section.id || index}>
                            {section.title ? (
                                <>
                                    <h2
                                        id={section.id}
                                        className="collapsible-section-header"
                                        style={{ scrollMarginTop: '100px' }}
                                        onClick={() => toggleSection(section.id)}
                                    >
                                        <span className={`collapse-icon ${collapsedSections[section.id] ? 'collapsed' : ''}`}>
                                            ▼
                                        </span>
                                        {section.title}
                                    </h2>
                                    {!collapsedSections[section.id] && (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={markdownComponents}
                                        >
                                            {section.content.join('\n')}
                                        </ReactMarkdown>
                                    )}
                                </>
                            ) : (
                                // Intro section without H2 title
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={markdownComponents}
                                >
                                    {section.content.join('\n')}
                                </ReactMarkdown>
                            )}
                        </div>
                    ))
                ) : (
                    // Render without collapsible sections
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                    >
                        {content}
                    </ReactMarkdown>
                )}
            </div>
        </>
    );
};

export const ReferenceDisplay = ({ references, activeReferenceId }) => {
    const referenceRefs = useRef({});

    console.log('ReferenceDisplay props:', {
        referencesCount: references?.length || 0,
        activeReferenceId,
        references: references?.map(r => r.paperId) || []
    });

    useEffect(() => {
        if (activeReferenceId && referenceRefs.current[activeReferenceId]) {
            referenceRefs.current[activeReferenceId].scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }, [activeReferenceId]);

    if (!references || references.length === 0) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                <div>No references available</div>
                <div style={{ fontSize: '12px', marginTop: '8px' }}>
                    References will appear here when you select a template with citations
                </div>
            </div>
        );
    }

    return (
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
                {references.length} reference{references.length !== 1 ? 's' : ''} found
            </div>
            {references.map((reference, index) => {
                const refNumber = index + 1;
                const isActive = activeReferenceId === refNumber;

                return (
                    <div
                        key={`ref-${index}`}
                        ref={el => referenceRefs.current[refNumber] = el}
                        style={{
                            padding: '12px',
                            fontSize: '14px',
                            borderRadius: '4px',
                            backgroundColor: isActive ? '#e6f7ff' : '#ffffff',
                            border: isActive ? '1px solid #1890ff' : '1px solid #f0f0f0',
                            lineHeight: '1.6',
                            transition: 'all 0.3s'
                        }}
                    >
                        <span style={{ fontWeight: 'bold', color: '#1890ff' }}>
                            [{refNumber}]
                        </span>
                        {' '}
                        {formatReference(reference)}
                    </div>
                );
            })}
        </Space>
    );
};

// Database and analysis utility functions
export const getDatabaseMapping = async () => {
    try {
        const dbList = await Meteor.callAsync('database.getAll');
        return dbList.reduce((acc, db) => {
            const dbKey = db.namespace ? `${db.name}-${db.namespace}` : db.name;
            acc[dbKey] = db._id;
            return acc;
        }, {});
    } catch (error) {
        console.error('Error getting database mapping:', error);
        throw error;
    }
};

export const buildPathwayMethodsData = async (results, databases, initialMethods) => {
    try {
        const dbMapping = await getDatabaseMapping();
        const pathwayMethodsData = databases.reduce((acc, dbName) => {
            const dbId = dbMapping[dbName];
            if (dbId) {
                acc[dbId] = initialMethods.reduce((methodsAcc, method) => {
                    methodsAcc[method.toLowerCase()] = [];
                    return methodsAcc;
                }, {});
            }
            return acc;
        }, {});

        databases.forEach(dbName => {
            const dbId = dbMapping[dbName];
            if (dbId && results[dbName] && results[dbName].methods[0]) {
                const dbResults = results[dbName].methods[0];

                initialMethods.forEach(method => {
                    const methodResults = dbResults[method.toLowerCase()] || [];
                    pathwayMethodsData[dbId][method.toLowerCase()] = methodResults.map(pathway => ({
                        pathway: pathway.pathway,
                        pValue: pathway.pValue,
                        pValueFDR: pathway.pValueFDR,
                        score: pathway.score,
                        _row: pathway.pathway,
                        name: pathway.name
                    }));
                });
            }
        });

        return pathwayMethodsData;
    } catch (error) {
        console.error('Error building pathway methods data:', error);
        throw error;
    }
};

// Template and prompt generation utilities
export const organizeAnalysesForPrompt = (selectedAnalyses, analyses) => {
    const actualAnalysisIds = selectedAnalyses.filter(id => !id.startsWith('group_'));
    const groups = {};
    const individuals = [];

    actualAnalysisIds.forEach(analysisId => {
        const analysis = analyses[analysisId];
        if (analysis && analysis.groupId && analysis.groupName && analysis.isMassAnalysis && !analysis.isUngrouped) {
            // This is part of a group
            if (!groups[analysis.groupId]) {
                groups[analysis.groupId] = {
                    groupName: analysis.groupName,
                    groupId: analysis.groupId,
                    analyses: []
                };
            }
            groups[analysis.groupId].analyses.push(analysisId);
        } else {
            // Individual analysis
            individuals.push(analysisId);
        }
    });

    return {
        groups: Object.values(groups),
        individuals,
        hasGroups: Object.keys(groups).length > 0,
        hasIndividuals: individuals.length > 0
    };
};

export const formatPathwayList = (pathways) => {
    const upRegulated = pathways
        .filter(p => p.score > 0)
        .map(p => `${p.name} (${p.originalId})`);
    const downRegulated = pathways
        .filter(p => p.score <= 0)
        .map(p => `${p.name} (${p.originalId})`);

    let pathwayText = '';
    if (upRegulated.length > 0) {
        pathwayText += `Upregulated pathways:\n${upRegulated.map(p => `- ${p}`).join('\n')}`;
    }
    if (downRegulated.length > 0) {
        pathwayText += `\n\nDownregulated pathways:\n${downRegulated.map(p => `- ${p}`).join('\n')}`;
    }
    return pathwayText;
};

export const getVirtualTableProps = (height = 400) => ({
    virtual: true,
    scroll: {
        y: height,
        scrollToFirstRowOnChange: true
    },
    pagination: false,
});


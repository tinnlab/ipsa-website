import React, {useEffect, useMemo, useState} from 'react';
import {
    Drawer,
    Input,
    Segmented,
    Tag,
    Tooltip,
    Button,
    Space,
    Typography,
    Spin,
    Empty,
    Alert,
} from 'antd';
import {DownloadOutlined} from '@ant-design/icons';
import {loadPathwayGeneRows} from '/imports/client/utils/geneSetGenesData';
import {
    filterGeneRows,
    buildPathwayGeneCsv,
    summarizeGeneRows,
} from '/imports/utils/geneSetMembership';

const {Text} = Typography;

// Highlight modes for the tag cloud.
const HIGHLIGHT_ALL = 'all-significant';
const HIGHLIGHT_DIRECTION = 'up-down';

// Tag colors — single source of truth shared by the gene tags and the legend below the toggle.
const COLOR_SIGNIFICANT = 'gold';
const COLOR_UP = 'red';
const COLOR_DOWN = 'blue';

// Legend entries per highlight mode (color = antd Tag color; undefined = plain/non-significant).
const legendFor = (mode) =>
    mode === HIGHLIGHT_DIRECTION
        ? [
            {color: COLOR_UP, label: 'Up-regulated'},
            {color: COLOR_DOWN, label: 'Down-regulated'},
            {color: undefined, label: 'Not significant'},
        ]
        : [
            {color: COLOR_SIGNIFICANT, label: 'Significant'},
            {color: undefined, label: 'Not significant'},
        ];

// Trigger a client-side CSV download (Blob + hidden anchor) — same pattern the result tables use.
const downloadCsv = (csv, fileName) => {
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const link = document.createElement('a');
    if (link.download === undefined) return;
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Pick the antd Tag color for a gene given the current highlight mode. Non-significant genes stay
// plain (undefined color). In "All significant" mode every DE gene shares one accent; in "Up / Down"
// mode up = red, down = blue (a significant gene with FC exactly 0 keeps the neutral accent).
const tagColor = (row, mode) => {
    if (!row.significant) return undefined;
    if (mode === HIGHLIGHT_DIRECTION) {
        if (row.up) return COLOR_UP;
        if (row.down) return COLOR_DOWN;
        return COLOR_SIGNIFICANT;
    }
    return COLOR_SIGNIFICANT;
};

const geneTooltip = (row) => {
    if (!row.significant) return `${row.symbol} — not a DE gene`;
    const parts = [];
    if (row.FC !== null && row.FC !== undefined) parts.push(`Log2FC ${Number(row.FC).toFixed(3)}`);
    if (row.pValue !== null && row.pValue !== undefined) parts.push(`p ${Number(row.pValue).toExponential(2)}`);
    if (row.pValueFDR !== null && row.pValueFDR !== undefined) parts.push(`FDR ${Number(row.pValueFDR).toExponential(2)}`);
    return `${row.symbol}${parts.length ? ' — ' + parts.join(' · ') : ''}`;
};

/**
 * Non-modal side drawer that lists a single GO/pathway category's member genes as tags.
 *
 * It is mounted ONCE per result table; changing `pathwayId` (while it stays open) re-fetches and
 * swaps the content rather than stacking another drawer. `mask={false}` keeps the results table
 * fully scrollable/interactive behind it. Organism + DE genes are resolved from
 * `sessionId`/`analysisId` (cached in geneSetGenesData).
 */
const GeneSetGenesView = ({
                              open,
                              onClose,
                              sessionId,
                              analysisId,
                              pathwayId,
                              pathwayName,
                              databaseId,
                              totalCount,
                          }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [highlightMode, setHighlightMode] = useState(HIGHLIGHT_ALL);
    const [query, setQuery] = useState('');

    // (Re)load whenever the drawer is open and points at a (new) pathway.
    useEffect(() => {
        if (!open || !pathwayId || !databaseId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setQuery('');
        loadPathwayGeneRows({sessionId, analysisId, databaseId, pathwayIds: [pathwayId]})
            .then(({byPathway}) => {
                if (cancelled) return;
                setRows(byPathway.get(pathwayId) || []);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err?.reason || err?.message || 'Failed to load genes');
                setRows([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, pathwayId, databaseId, sessionId, analysisId]);

    const summary = useMemo(() => summarizeGeneRows(rows), [rows]);
    const visibleRows = useMemo(() => filterGeneRows(rows, query), [rows, query]);

    const handleDownload = () => {
        const csv = buildPathwayGeneCsv(rows);
        const safeName = String(pathwayName || pathwayId || 'genes').replace(/[^\w.-]+/g, '_');
        downloadCsv(csv, `${safeName}_genes.csv`);
    };

    return (
        <Drawer
            title={pathwayName || pathwayId}
            placement="right"
            width={460}
            open={open}
            onClose={onClose}
            mask={false}
            maskClosable={false}
            styles={{body: {paddingTop: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}}
        >
            {/* Fixed header — counts, highlight toggle, download, and search stay put while the
                gene list scrolls, so they are always reachable no matter how many genes there are. */}
            <Space direction="vertical" size={12} style={{width: '100%', flex: '0 0 auto'}}>
                <Text type="secondary">
                    {summary.total} genes · {summary.significant} significant
                    {' '}· <Text style={{color: '#cf1322'}}>{summary.up} up</Text>
                    {' '}· <Text style={{color: '#096dd9'}}>{summary.down} down</Text>
                    {typeof totalCount === 'number' && totalCount !== summary.total && !loading && !error
                        ? ` (expected ${totalCount})`
                        : ''}
                </Text>

                <Space style={{width: '100%', justifyContent: 'space-between'}} wrap>
                    <Segmented
                        size="small"
                        value={highlightMode}
                        onChange={setHighlightMode}
                        options={[
                            {label: 'All significant', value: HIGHLIGHT_ALL},
                            {label: 'Up / Down', value: HIGHLIGHT_DIRECTION},
                        ]}
                    />
                    <Button
                        size="small"
                        icon={<DownloadOutlined/>}
                        onClick={handleDownload}
                        disabled={loading || !!error || rows.length === 0}
                    >
                        Download CSV
                    </Button>
                </Space>

                {/* Colour legend — mirrors the tag colors and updates with the highlight mode. */}
                <Space size={[6, 4]} wrap style={{width: '100%'}}>
                    {legendFor(highlightMode).map((item) => (
                        <Tag key={item.label} color={item.color} style={{marginInlineEnd: 0, cursor: 'default'}}>
                            {item.label}
                        </Tag>
                    ))}
                </Space>

                <Input.Search
                    allowClear
                    placeholder="Filter genes by symbol"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />

                {error && <Alert type="error" showIcon message={error}/>}
            </Space>

            {/* Scrollable region — ONLY the gene tags scroll. minHeight:0 lets this flex child
                shrink below its content height so overflow scrolls instead of pushing the header. */}
            <div style={{flex: '1 1 auto', overflowY: 'auto', minHeight: 0, marginTop: 12}}>
                {loading ? (
                    <div style={{textAlign: 'center', padding: '32px 0'}}>
                        <Spin/>
                    </div>
                ) : rows.length === 0 && !error ? (
                    <Empty description="No genes"/>
                ) : (
                    <div style={{lineHeight: 2.2}}>
                        {visibleRows.map((row) => (
                            <Tooltip key={row.id} title={geneTooltip(row)}>
                                <Tag
                                    color={tagColor(row, highlightMode)}
                                    style={{marginBottom: 4, cursor: 'default'}}
                                >
                                    {row.symbol}
                                </Tag>
                            </Tooltip>
                        ))}
                        {visibleRows.length === 0 && (
                            <Text type="secondary">No genes match “{query}”.</Text>
                        )}
                    </div>
                )}
            </div>
        </Drawer>
    );
};

export default GeneSetGenesView;

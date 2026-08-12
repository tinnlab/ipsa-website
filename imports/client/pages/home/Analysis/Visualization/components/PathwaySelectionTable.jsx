import React, { useMemo, useState } from "react";
import { Table, Input, Button, Space, Typography } from "antd";
import { makeNumericSorter } from "../../../../../../utils/resultTableSorters";

const { Text } = Typography;

// Reference-analysis metric formatting for the compact selection table (the full per-analysis
// matrix lives in the CSV export, not this table, to keep it scannable next to the heatmap).
const fmtP = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toExponential(2) : "—");
const fmtS = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—");

/**
 * Compact, searchable pathway picker for the Pathway Heat Map. Rows are ALL pathways in the
 * database; the checked set (seeded from "Top N by reference") drives exactly which pathways the
 * heatmap renders. Two export buttons dump the full result matrix (all) or the checked subset.
 *
 * Props:
 *  - pathways: [{ id, name, pValueFDR, score, ... }] (reference-analysis metrics for display)
 *  - selectedIds: Set<string> | null   currently-checked pathway ids
 *  - onSelectionChange: (ids: string[]) => void
 *  - onExportAll / onExportSelected: () => void
 */
export default function PathwaySelectionTable({
    pathways = [],
    selectedIds,
    onSelectionChange,
    onExportAll,
    onExportSelected,
}) {
    const [search, setSearch] = useState("");
    const selectedKeys = useMemo(() => (selectedIds ? Array.from(selectedIds) : []), [selectedIds]);

    const data = useMemo(() => {
        const q = search.trim().toLowerCase();
        const rows = pathways.map((p) => ({
            key: p.id,
            id: p.id,
            name: p.name,
            pValueFDR: p.pValueFDR,
            score: p.score,
        }));
        if (!q) return rows;
        return rows.filter(
            (r) => (r.id || "").toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)
        );
    }, [pathways, search]);

    const columns = useMemo(
        () => [
            {
                title: "ID", dataIndex: "id", key: "id", width: 150, ellipsis: true,
                sorter: (a, b) => (a.id || "").localeCompare(b.id || ""),
            },
            {
                title: "Name", dataIndex: "name", key: "name", ellipsis: true,
                sorter: (a, b) => (a.name || "").localeCompare(b.name || ""),
            },
            {
                title: "FDR (ref)", dataIndex: "pValueFDR", key: "pValueFDR", width: 110,
                sorter: makeNumericSorter("pValueFDR"), render: fmtP,
            },
            {
                title: "Score (ref)", dataIndex: "score", key: "score", width: 110,
                sorter: makeNumericSorter("score", { missing: 0 }), render: fmtS,
            },
        ],
        []
    );

    const rowSelection = {
        selectedRowKeys: selectedKeys,
        preserveSelectedRowKeys: true, // keep selections for rows hidden by search/pagination
        onChange: (keys) => onSelectionChange && onSelectionChange(keys),
    };

    return (
        <div style={{ marginBottom: 16 }}>
            <Space style={{ marginBottom: 8 }} wrap>
                <Input.Search
                    allowClear
                    placeholder="Search pathway ID or name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ width: 260 }}
                    size="small"
                />
                {onExportAll && (
                    <Button size="small" onClick={onExportAll}>
                        Export all (CSV)
                    </Button>
                )}
                {onExportSelected && (
                    <Button size="small" onClick={onExportSelected} disabled={selectedKeys.length === 0}>
                        Export selected (CSV)
                    </Button>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {selectedKeys.length} selected · {pathways.length} pathways
                </Text>
            </Space>
            {/* No fixed scroll height: the table auto-sizes to the current page so every row of a page
                is visible without an inner scrollbar. Pagination already caps the DOM to pageSize rows,
                so the height follows the page size (10 -> 10 rows, 20 -> 20, etc.) as it's changed via
                the size changer. */}
            <Table
                columns={columns}
                dataSource={data}
                rowKey="id"
                rowSelection={rowSelection}
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: true, size: "small" }}
            />
        </div>
    );
}

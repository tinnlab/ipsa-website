import React, {useState} from "react";
import {Button, Checkbox, Dropdown, InputNumber, Popover, Select, Space, Typography, Input, message} from "antd";
import {DownOutlined, HighlightOutlined, TagOutlined} from "@ant-design/icons";
import {
    parseGeneQuery,
    matchGenesToSelection,
    selectSignificantGeneIds,
    selectTopSignificantGeneIds,
} from "/imports/utils/volcanoGeneSelect";
import "./VolcanoGenePicker.style.less";

const {TextArea} = Input;

// Match a symbol OR the raw id as the user types, not just the display label.
const filterOption = (input, option) => {
    const q = input.toLowerCase();
    return (
        String(option.label).toLowerCase().includes(q) ||
        String(option.value).toLowerCase().includes(q)
    );
};

/**
 * Controls for the volcano plot's focus/isolate + labeling feature. Two INDEPENDENT
 * gene sets: `focus` (highlight/isolate) and `label` (a subset of focus whose names
 * are drawn). A display-mode toggle switches every gene name between symbol and id,
 * in both the pickers and on the plot. All selection is ephemeral (view-only).
 *
 * @param {'symbol'|'id'} displayMode
 * @param {(m:'symbol'|'id')=>void} onDisplayModeChange
 * @param {Array<{label:string,value:*}>} geneOptions   all genes (focus picker options)
 * @param {Array} focusGeneIds
 * @param {(ids:Array)=>void} onFocusChange
 * @param {Array<{label:string,value:*}>} labelOptions   focused genes (label picker options)
 * @param {Array} labelGeneIds
 * @param {(ids:Array)=>void} onLabelChange
 * @param {boolean} hideNonFocused   hide the non-focused cloud & rescale to the focus set
 * @param {(v:boolean)=>void} onHideNonFocusedChange
 * @param {Array<{id:*,name:string,FC:number,pValue:number}>} volcanoPlotData
 * @param {{maxAdjustedPValue:number,minLogFoldChange:number}} deSettings
 */
export default ({
                    displayMode,
                    onDisplayModeChange,
                    geneOptions,
                    focusGeneIds,
                    onFocusChange,
                    labelOptions,
                    labelGeneIds,
                    onLabelChange,
                    hideNonFocused,
                    onHideNonFocusedChange,
                    volcanoPlotData,
                    deSettings,
                }) => {
    const [pasteText, setPasteText] = useState("");
    const [pasteOpen, setPasteOpen] = useState(false);
    const [labelPasteText, setLabelPasteText] = useState("");
    const [labelPasteOpen, setLabelPasteOpen] = useState(false);
    const [topN, setTopN] = useState(10);

    const applyPaste = () => {
        const tokens = parseGeneQuery(pasteText);
        if (tokens.length === 0) {
            message.info("No genes to add.");
            return;
        }
        const {matchedIds, unmatched} = matchGenesToSelection(tokens, volcanoPlotData);
        // Merge into the FOCUS set (union, de-duplicated).
        const merged = Array.from(new Set([...(focusGeneIds || []), ...matchedIds]));
        onFocusChange(merged);

        if (matchedIds.length > 0) {
            message.success(`Focused ${matchedIds.length} gene${matchedIds.length === 1 ? "" : "s"}.`);
        }
        if (unmatched.length > 0) {
            const preview = unmatched.slice(0, 10).join(", ");
            message.warning(
                `${unmatched.length} of ${tokens.length} not found: ${preview}${unmatched.length > 10 ? "…" : ""}`,
                6
            );
        }
        setPasteText("");
        setPasteOpen(false);
    };

    // Paste a list of genes to LABEL. Labels must be a subset of the focus set, so
    // matched genes are added to BOTH the focus and label sets (they show up named
    // and highlighted regardless of whether they were focused before).
    const applyLabelPaste = () => {
        const tokens = parseGeneQuery(labelPasteText);
        if (tokens.length === 0) {
            message.info("No genes to add.");
            return;
        }
        const {matchedIds, unmatched} = matchGenesToSelection(tokens, volcanoPlotData);
        onFocusChange(Array.from(new Set([...(focusGeneIds || []), ...matchedIds])));
        onLabelChange(Array.from(new Set([...(labelGeneIds || []), ...matchedIds])));

        if (matchedIds.length > 0) {
            message.success(`Labeled ${matchedIds.length} gene${matchedIds.length === 1 ? "" : "s"}.`);
        }
        if (unmatched.length > 0) {
            const preview = unmatched.slice(0, 10).join(", ");
            message.warning(
                `${unmatched.length} of ${tokens.length} not found: ${preview}${unmatched.length > 10 ? "…" : ""}`,
                6
            );
        }
        setLabelPasteText("");
        setLabelPasteOpen(false);
    };

    const presetMenu = {
        items: [
            {key: "top", label: `Top ${topN} most significant`},
            {key: "up", label: "All significant up-regulated"},
            {key: "down", label: "All significant down-regulated"},
            {type: "divider"},
            {key: "clear", label: "Clear focus", disabled: !(focusGeneIds && focusGeneIds.length)},
        ],
        onClick: ({key}) => {
            if (key === "clear") {
                onFocusChange([]);
                return;
            }
            let ids = [];
            if (key === "top") ids = selectTopSignificantGeneIds(volcanoPlotData, deSettings, topN, "both");
            else if (key === "up") ids = selectSignificantGeneIds(volcanoPlotData, deSettings, "up");
            else if (key === "down") ids = selectSignificantGeneIds(volcanoPlotData, deSettings, "down");

            if (ids.length === 0) {
                message.info("No genes match this preset at the current thresholds.");
                return;
            }
            onFocusChange(ids);
        },
    };

    const pasteContent = (
        <div className="volcano-gene-paste">
            <Typography.Text type="secondary" style={{fontSize: 12}}>
                Paste gene symbols or ids (comma, space, or newline separated)
            </Typography.Text>
            <TextArea
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"TP53, EGFR, 7157\nMYC"}
            />
            <Space style={{justifyContent: "flex-end", width: "100%"}}>
                <Button size="small" onClick={() => setPasteOpen(false)}>Cancel</Button>
                <Button size="small" type="primary" onClick={applyPaste}>Focus genes</Button>
            </Space>
        </div>
    );

    const labelPasteContent = (
        <div className="volcano-gene-paste">
            <Typography.Text type="secondary" style={{fontSize: 12}}>
                Paste gene symbols or ids (comma, space, or newline separated) to label
            </Typography.Text>
            <TextArea
                rows={6}
                value={labelPasteText}
                onChange={(e) => setLabelPasteText(e.target.value)}
                placeholder={"TP53, EGFR, 7157\nMYC"}
            />
            <Space style={{justifyContent: "flex-end", width: "100%"}}>
                <Button size="small" onClick={() => setLabelPasteOpen(false)}>Cancel</Button>
                <Button size="small" type="primary" onClick={applyLabelPaste}>Label genes</Button>
            </Space>
        </div>
    );

    const focusCount = focusGeneIds ? focusGeneIds.length : 0;
    const labelCount = labelGeneIds ? labelGeneIds.length : 0;

    return (
        <Space direction="vertical" size={6} className="volcano-gene-picker">
            <Space wrap align="center">
                <Typography.Text>Display:</Typography.Text>
                <Select
                    value={displayMode}
                    onChange={onDisplayModeChange}
                    style={{width: 140}}
                    options={[
                        {label: "Gene symbol", value: "symbol"},
                        {label: "Gene ID", value: "id"},
                    ]}
                />
                <span className="volcano-gene-divider"/>
                <HighlightOutlined/>
                <Typography.Text>Focus genes:</Typography.Text>
                <Select
                    mode="multiple"
                    showSearch
                    allowClear
                    maxTagCount="responsive"
                    placeholder="Search a symbol or id…"
                    style={{minWidth: 240, maxWidth: 460}}
                    value={focusGeneIds}
                    onChange={onFocusChange}
                    options={geneOptions}
                    filterOption={filterOption}
                    listHeight={288}
                />
                <Popover
                    open={pasteOpen}
                    onOpenChange={setPasteOpen}
                    trigger="click"
                    placement="bottomLeft"
                    content={pasteContent}
                    title="Paste a gene list"
                >
                    <Button>Paste list</Button>
                </Popover>
                <Space size={4}>
                    <Typography.Text type="secondary">Top N:</Typography.Text>
                    <InputNumber min={1} max={2000} value={topN} onChange={(v) => setTopN(v || 1)} style={{width: 74}}/>
                </Space>
                <Dropdown menu={presetMenu} trigger={["click"]}>
                    <Button>
                        <Space>Quick focus<DownOutlined/></Space>
                    </Button>
                </Dropdown>
                {focusCount > 0 && (
                    <Typography.Text type="secondary">{focusCount} focused</Typography.Text>
                )}
                {focusCount > 0 && (
                    <Checkbox
                        checked={hideNonFocused}
                        onChange={(e) => onHideNonFocusedChange(e.target.checked)}
                    >
                        Hide non-focused genes
                    </Checkbox>
                )}
            </Space>
            <Space wrap align="center">
                <TagOutlined/>
                <Typography.Text>Label genes:</Typography.Text>
                <Select
                    mode="multiple"
                    showSearch
                    allowClear
                    maxTagCount="responsive"
                    placeholder={focusCount ? "Pick focused genes to name on the plot…" : "Focus genes first"}
                    disabled={focusCount === 0}
                    style={{minWidth: 240, maxWidth: 520}}
                    value={labelGeneIds}
                    onChange={onLabelChange}
                    options={labelOptions}
                    filterOption={filterOption}
                    listHeight={288}
                />
                <Popover
                    open={labelPasteOpen}
                    onOpenChange={setLabelPasteOpen}
                    trigger="click"
                    placement="bottomLeft"
                    content={labelPasteContent}
                    title="Paste a gene list to label"
                >
                    <Button>Paste list</Button>
                </Popover>
                {labelCount > 0 && (
                    <Typography.Text type="secondary">{labelCount} labeled</Typography.Text>
                )}
            </Space>
        </Space>
    );
};

import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Meteor} from "meteor/meteor";
import {
    Alert,
    Button,
    Empty,
    InputNumber,
    Modal,
    Radio,
    Select,
    Space,
    Table,
    Tag,
    Typography,
} from "antd";
import {CopyOutlined} from "@ant-design/icons";
import moment from "moment";
import {
    MAX_EXPIRY_DAYS,
    MIN_EXPIRY_DAYS,
    SHARE_STATUS,
    formatExpiresIn,
    shareStatus,
    shareUrl,
} from "/imports/utils/shareLink";
import {collectAnalysisIds} from "/imports/utils/ownership";
import {resolveShareSelection} from "/imports/utils/shareSelection";

const {Paragraph, Text} = Typography;

// Clipboard write for browsers without navigator.clipboard (any non-secure origin). Returns whether
// the copy succeeded. Off-screen rather than display:none — a hidden element cannot be selected —
// and readonly so mobile keyboards stay down.
//
// The textarea is appended to document.body, i.e. OUTSIDE the modal's portal, so selecting it moves
// focus out of the dialog. rc-dialog listens for Escape on its own wrapper via a React onKeyDown, and
// synthetic events only bubble UP the tree — once focus sits on body, Escape stops closing the modal.
// Hence the explicit save/restore around the selection.
const legacyCopyToClipboard = (text) => {
    const previouslyFocused = document.activeElement;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    try {
        area.select();
        // select() alone leaves an empty selection on iOS Safari for a readonly textarea.
        area.setSelectionRange(0, text.length);
        return document.execCommand("copy");
    } catch (error) {
        return false;
    } finally {
        document.body.removeChild(area);
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
            previouslyFocused.focus();
        }
    }
};

// Share a study's analyses with someone else.
//
// The link never grants access to THIS study — opening it clones the selected analyses into a copy
// owned by the recipient. That is why the two modes are framed as what the recipient ends up with
// rather than as a permission level.
const MODE_OPTIONS = [
    {
        value: "results",
        label: "Results only",
        hint: "They get a view-only copy: results and AI reports, no uploaded data, and they cannot re-run or edit it.",
    },
    {
        value: "full",
        label: "Everything",
        hint: "They get their own full copy, including the uploaded data, and can re-run and edit it freely.",
    },
];

export default ({study, onClose}) => {
    const [selectedIds, setSelectedIds] = useState([]);
    const [mode, setMode] = useState("results");
    const [expiryDays, setExpiryDays] = useState(7);
    const [shares, setShares] = useState([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newShareId, setNewShareId] = useState(null);

    const open = Boolean(study);

    // What the current selection actually hands over. A meta-analysis whose analyses are all selected
    // comes along even if it was not ticked; one that was ticked without them cannot travel, and is
    // reported here so it can be named rather than silently dropped at import.
    const resolved = useMemo(() => resolveShareSelection(study, selectedIds), [study, selectedIds]);

    // Analyses and meta-analyses are both shareable; meta ids fan out to the same per-analysis
    // collections, so the clone handles them identically. They are grouped rather than merged into one
    // flat list because a meta-analysis is not interchangeable with an analysis here — it only travels
    // when the analyses it was computed from travel too, which the alerts below explain.
    //
    // A meta-analysis that IS travelling is disabled: it rides on its analyses, so offering to untick it
    // would offer something the rule does not allow, and the tick would spring back. Unticking one of its
    // ANALYSES is the way to leave it out, and that path is still open.
    const analysisOptions = useMemo(() => {
        if (!study) return [];
        const travelling = new Set(resolved.metaIds);
        const toOption = (entry) => ({label: entry.name || entry.id, value: entry.id});
        const analyses = (study.analyses || []).filter((entry) => entry && entry.id).map(toOption);
        const metaAnalyses = (study.metaAnalyses || []).filter((entry) => entry && entry.id)
            .map((entry) => ({...toOption(entry), disabled: travelling.has(entry.id)}));
        if (metaAnalyses.length === 0) return analyses;
        return [
            {label: "Analyses", options: analyses},
            {label: "Meta-analyses", options: metaAnalyses},
        ];
    }, [study, resolved]);

    // What the field shows must be what the link will carry, or the modal contradicts itself: a meta
    // pulled in by its analyses has to appear ticked even though nobody ticked it. A meta that was ticked
    // but cannot travel stays ticked and enabled, so the warning below can be dismissed by unticking it.
    const selectionValue = useMemo(
        () => [...new Set([...selectedIds, ...resolved.metaIds])],
        [selectedIds, resolved]
    );

    // The field is shown the auto-included metas, so a change event hands them back. Writing that array
    // through verbatim would absorb them into `selectedIds` and make the notices history-dependent: the
    // "included too" alert would vanish on the next unrelated edit, and whether unticking one of a meta's
    // analyses later explains itself would depend on which edits came before. Keep only what the owner
    // genuinely ticked. A travelling meta cannot be ticked here anyway — its option is disabled.
    const handleSelectionChange = (ids) => {
        const autoIncluded = new Set(resolved.autoIncludedMeta.map((meta) => meta.id));
        setSelectedIds(ids.filter((id) => !autoIncluded.has(id)));
    };

    // Pull a dropped meta's missing analyses into the selection. Deliberately an explicit click: adding
    // them WIDENS what the recipient receives, so it is the owner's decision, not a silent repair.
    const addMissingSources = (missingSourceIds) => {
        setSelectedIds([...new Set([...selectedIds, ...missingSourceIds])]);
    };

    const refreshShares = useCallback(async (sessionId) => {
        setLoading(true);
        try {
            setShares(await Meteor.callAsync("share.list", {sessionId}));
        } catch (error) {
            notify.error(error.reason || "Could not load existing links.");
        } finally {
            setLoading(false);
        }
    }, []);

    // Reset per-study state each time the modal opens, so a previous study's selection or freshly
    // created link never leaks into the next one.
    useEffect(() => {
        if (!study) return;
        // Everything the study owns, meta-analyses included — accepting the default means "share this
        // study", and seeding from `analyses` alone quietly left every meta-analysis behind.
        setSelectedIds(collectAnalysisIds(study));
        setMode("results");
        setExpiryDays(7);
        setNewShareId(null);
        refreshShares(study._id);
    }, [study, refreshShares]);

    const handleCreate = async () => {
        setCreating(true);
        try {
            const shareId = await Meteor.callAsync("share.create", {
                sessionId: study._id,
                // The resolved list, not the raw ticks: the link then covers exactly what the alerts
                // above said it would.
                analysisIds: resolved.allIds,
                mode,
                expiryDays,
            });
            setNewShareId(shareId);
            notify.success("Share link created.");
            await refreshShares(study._id);
        } catch (error) {
            notify.error(error.reason || "Could not create the link.");
        } finally {
            setCreating(false);
        }
    };

    const runShareAction = async (method, params, successMessage) => {
        try {
            await Meteor.callAsync(method, params);
            notify.success(successMessage);
            await refreshShares(study._id);
        } catch (error) {
            notify.error(error.reason || "Action failed.");
        }
    };

    const linkFor = (shareId) => shareUrl(shareId, window.location.origin, window.urlPrefix);

    // Copying is the only thing anyone does with the URL, and it is far too long for a table cell,
    // so the affordance is a button in Actions rather than a column of its own.
    //
    // navigator.clipboard exists only in a SECURE CONTEXT, and the app is served over plain http on
    // deployments reached by hostname or LAN IP — there it is undefined, so clipboard-only copying
    // would fail for every existing link while the "Link ready" alert below (antd Paragraph
    // copyable) kept working on the same screen. Fall back to the same execCommand path antd's own
    // copyable uses, so both affordances behave identically wherever the app is served.
    const copyLink = async (shareId) => {
        const link = linkFor(shareId);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(link);
                notify.success("Link copied.");
                return;
            }
        } catch (error) {
            // Secure origin, but the write was refused — an unfocused document, or a permissions
            // policy in an embedded context. Fall through rather than give up: the legacy path is
            // driven by the click itself and is usually still allowed.
        }
        if (legacyCopyToClipboard(link)) {
            notify.success("Link copied.");
        } else {
            notify.error("Could not copy the link.");
        }
    };

    // The analyses a link covers: useful when deciding what to revoke, but too long to sit in a
    // column, so it lives in the row's expanded space.
    // The maxWidth is load-bearing, not cosmetic: scroll={{x: "max-content"}} sizes the table so
    // nothing soft-wraps, and an expanded row is a <tr> of that same table, so a long list of names
    // would otherwise stretch every column and add a wide scrollbar until the row is collapsed.
    // Clamping the descendant caps what it contributes to max-content, letting the names wrap.
    const expandedRowRender = (share) => (
        <div style={{maxWidth: 760}}>
            {/* Not "Analyses ...": the list can hold meta-analyses too. Phrased to match the other
                headings in this modal ("What they receive"), and the empty state widened with it. */}
            <Text strong>What this link shares</Text>
            <div style={{marginTop: 4}}>
                {share.analysisNames && share.analysisNames.length > 0 ? (
                    <Text type="secondary">{share.analysisNames.join(", ")}</Text>
                ) : (
                    <Text type="secondary">Nothing shared</Text>
                )}
            </div>
        </div>
    );

    const statusTag = (share) => {
        const status = shareStatus(share, Date.now());
        const color = status === SHARE_STATUS.ACTIVE ? "green"
            : status === SHARE_STATUS.REVOKED ? "red" : "default";
        return <Tag color={color}>{status}</Tag>;
    };

    const shareColumns = [
        {
            title: "Status",
            key: "status",
            width: 90,
            render: (_, share) => statusTag(share),
        },
        {
            // Which of the two modes this link hands out — the same choice as "What they receive"
            // above.
            title: "Scope",
            key: "mode",
            width: 130,
            render: (_, share) => (
                <Tag>{share.mode === "full" ? "Everything" : "Results only"}</Tag>
            ),
        },
        {
            title: "Expires",
            key: "expires",
            width: 140,
            render: (_, share) => {
                const status = shareStatus(share, Date.now());
                if (status !== SHARE_STATUS.ACTIVE) return <Text type="secondary">—</Text>;
                return (
                    <Text type="secondary" title={moment(share.expiresAt).format("YYYY-MM-DD HH:mm")}>
                        in {formatExpiresIn(share, Date.now())}
                    </Text>
                );
            },
        },
        {
            // How many copies this link has produced. Each open of the link creates one
            // independent copy, so this is a usage counter, not a number of people.
            title: "No. copies",
            key: "imports",
            width: 110,
            render: (_, share) => <Text type="secondary">{share.importCount || 0}</Text>,
        },
        {
            title: "Actions",
            key: "actions",
            width: 300,
            render: (_, share) => {
                const status = shareStatus(share, Date.now());
                const isActive = status === SHARE_STATUS.ACTIVE;
                return (
                    <Space size="small">
                        <Button
                            size="small"
                            icon={<CopyOutlined/>}
                            onClick={() => copyLink(share._id)}
                        >
                            Copy link
                        </Button>
                        <Button
                            size="small"
                            // Revoking is final, so extending a revoked link is not offered.
                            disabled={status === SHARE_STATUS.REVOKED}
                            onClick={() => runShareAction(
                                "share.extend",
                                {shareId: share._id, expiryDays: 7},
                                "Link extended by 7 days."
                            )}
                        >
                            Extend
                        </Button>
                        <Button
                            size="small"
                            disabled={!isActive}
                            onClick={() => runShareAction(
                                "share.revoke",
                                {shareId: share._id},
                                "Link disabled."
                            )}
                        >
                            Disable
                        </Button>
                        <Button
                            size="small"
                            danger
                            onClick={() => runShareAction(
                                "share.remove",
                                {shareId: share._id},
                                "Link deleted."
                            )}
                        >
                            Delete
                        </Button>
                    </Space>
                );
            },
        },
    ];

    return (
        <Modal
            title={study ? `Sharing "${study.name}"` : "Sharing"}
            open={open}
            onCancel={onClose}
            footer={null}
            // Widened with the links table: Actions now carries a fourth button, and the expandable
            // rows add a toggle column, so 820 left the table scrolling against itself by default.
            width={980}
            // Pinned near the top with its own scrollbar: as the links table grows the modal would
            // otherwise get taller than the viewport, pushing the page itself to scroll and dragging
            // the modal up and down with it. The body scrolls instead, so the modal stays put.
            style={{top: 20}}
            styles={{body: {maxHeight: "calc(100vh - 140px)", overflowY: "auto"}}}
            destroyOnClose
        >
            {!study ? null : (
                <Space direction="vertical" style={{width: "100%"}} size="middle">
                    <Alert
                        type="info"
                        showIcon
                        message="Opening the link makes them their own copy"
                        description="Anyone with the link gets a copy of the analyses you select. They never get access to this study, and later changes here are not reflected in their copy."
                    />

                    <div>
                        <Text strong>Analyses to share</Text>
                        {analysisOptions.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This study has no analyses yet"/>
                        ) : (
                            // A checkbox list grew one row per analysis and pushed the rest of the
                            // modal down; the select stays one row tall however many there are, and
                            // collapses the chosen ones to "+N" rather than wrapping.
                            <Select
                                mode="multiple"
                                allowClear
                                showSearch
                                // Not optionFilterProp="label": rc-select tests a GROUP's label first and
                                // returns the whole group unfiltered on a match, so searching "a" or
                                // "meta" against the "Analyses" / "Meta-analyses" headings matched
                                // everything and search silently did nothing. Returning false for a group
                                // makes rc-select fall through to filtering its children.
                                filterOption={(input, option) => !option.options
                                    && String(option.label).toLowerCase().includes(input.toLowerCase())}
                                placeholder="Select analyses to share"
                                style={{width: "100%", marginTop: 8}}
                                maxTagCount="responsive"
                                value={selectionValue}
                                onChange={handleSelectionChange}
                                options={analysisOptions}
                            />
                        )}

                        {resolved.autoIncludedMeta.length > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                style={{marginTop: 8}}
                                message={
                                    resolved.autoIncludedMeta.length === 1
                                        ? "A meta-analysis is included too"
                                        : "Meta-analyses are included too"
                                }
                                description={
                                    resolved.autoIncludedMeta.length === 1
                                        ? `${resolved.autoIncludedMeta[0].name} — every analysis it was computed from is in this link.`
                                        : `${resolved.autoIncludedMeta.map((meta) => meta.name).join(", ")} — every analysis they were computed from is in this link.`
                                }
                            />
                        )}

                        {/* One alert per dropped meta rather than a combined list: each names a different
                            set of missing analyses and carries its own button. */}
                        {resolved.droppedMeta.map((meta) => (
                            <Alert
                                key={meta.id}
                                type="warning"
                                showIcon
                                style={{marginTop: 8}}
                                message={`"${meta.name}" will not be shared`}
                                description={
                                    <Space direction="vertical" size="small">
                                        <Text type="secondary">
                                            {meta.unavailableSourceIds.length > 0
                                                ? "It was computed from an analysis that is no longer part of this study, so it can no longer be shared."
                                                : meta.missingSourceIds.length > 0
                                                    ? `A meta-analysis can only be shared together with every analysis it was computed from. This one also needs ${meta.missingSourceNames.join(", ")}.`
                                                    : "This meta-analysis has no record of which analyses it was computed from, so it cannot be shared."}
                                        </Text>
                                        {meta.unavailableSourceIds.length === 0 && meta.missingSourceIds.length > 0 && (
                                            <Button
                                                size="small"
                                                onClick={() => addMissingSources(meta.missingSourceIds)}
                                            >
                                                Add the missing analyses
                                            </Button>
                                        )}
                                    </Space>
                                }
                            />
                        ))}
                    </div>

                    <div>
                        <Text strong>What they receive</Text>
                        <Radio.Group
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            style={{display: "block", marginTop: 8}}
                        >
                            <Space direction="vertical" size="small">
                                {MODE_OPTIONS.map((option) => (
                                    // The Radio's label is ONLY the title, so the circle centres on
                                    // that single line. Putting the description inside the label
                                    // makes antd centre the circle against the whole two-line block
                                    // instead, which leaves it floating between the lines.
                                    // The description sits outside, indented to line up under the
                                    // title (16px control + 8px gap).
                                    <div key={option.value}>
                                        <Radio value={option.value}>{option.label}</Radio>
                                        <div style={{marginLeft: 24}}>
                                            <Text type="secondary">{option.hint}</Text>
                                        </div>
                                    </div>
                                ))}
                            </Space>
                        </Radio.Group>
                    </div>

                    {/* Flex row so the label sits on the field's vertical centre; as inline text it
                        aligned to the input's baseline and floated above the addon. */}
                    <div style={{display: "flex", alignItems: "center", gap: 8}}>
                        <Text strong>Link expires after</Text>
                        {/* antd passes null when the field is cleared; falling back keeps the value
                            valid so share.create's check() cannot fail with an opaque Match error. */}
                        <InputNumber
                            min={MIN_EXPIRY_DAYS}
                            max={MAX_EXPIRY_DAYS}
                            value={expiryDays}
                            onChange={(value) => setExpiryDays(value ?? MIN_EXPIRY_DAYS)}
                            addonAfter="days"
                        />
                    </div>

                    <Button
                        type="primary"
                        loading={creating}
                        // Gated on what would actually be shared: a selection of nothing but a
                        // meta-analysis that cannot travel would otherwise offer a link covering nothing.
                        disabled={resolved.allIds.length === 0}
                        onClick={handleCreate}
                    >
                        Create link
                    </Button>

                    {newShareId && (
                        <Alert
                            type="success"
                            message="Link ready — copy it and send it on"
                            description={
                                <Paragraph copyable={{text: linkFor(newShareId)}} style={{marginBottom: 0}}>
                                    {linkFor(newShareId)}
                                </Paragraph>
                            }
                        />
                    )}

                    <div>
                        <Text strong>Existing links</Text>
                        {/* Always rendered, even with no rows, so the section keeps its shape and
                            the empty state is explicit rather than the block vanishing. */}
                        <Table
                            size="small"
                            style={{marginTop: 8}}
                            rowKey="_id"
                            loading={loading}
                            dataSource={shares}
                            pagination={false}
                            locale={{emptyText: "No links yet"}}
                            columns={shareColumns}
                            expandable={{expandedRowRender}}
                            // The columns plus the expand column can outgrow the modal on a narrow
                            // viewport. Scrolling the TABLE keeps that contained: without it the
                            // body's overflowY:auto would compute overflow-x to auto as well and
                            // drag the analyses select, the radios and the expiry field with it.
                            scroll={{x: "max-content"}}
                        />
                    </div>
                </Space>
            )}
        </Modal>
    );
};

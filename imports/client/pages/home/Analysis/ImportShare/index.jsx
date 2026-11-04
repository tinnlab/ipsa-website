import React, {useEffect, useState} from "react";
import {Meteor} from "meteor/meteor";
import {Random} from "meteor/random";
import {useTracker} from "meteor/react-meteor-data";
import {Link, useNavigate, useParams} from "react-router-dom";
import {Helmet} from "react-helmet";
import {Alert, Button, Card, Layout, Progress, Result, Space, Spin, Table, Tag, Typography} from "antd";
import moment from "moment";
import {fullImportLostInputs} from "/imports/utils/shareLink";
import {formatDaysLeft, isSessionExpired, studyStatusLabel} from "/imports/utils/retention";

const {Paragraph, Text, Title} = Typography;

// The caller's earlier copies of the study being offered. Mirrors the Recent Studies table
// (RecentSessions/index.jsx) column for column and computes every cell with the same helpers, so one
// study cannot read one way there and another way here.
//
// Every renderer degrades rather than assuming. These rows can carry legacy or hand-edited data, and
// there is no React error boundary anywhere in this app, so a throw in a single cell blanks the
// whole page — on the page the homepage's "View Example" picker sends every visitor to.
// Epoch ms for a stored timestamp, or null when there is nothing usable.
//
// Parsed through Date rather than handed to moment as a string: moment falls back to `new
// Date(string)` for anything it does not recognise and logs a deprecation warning to the console for
// EVERY such row. The rows here can carry legacy or hand-edited values, so that fallback is reached
// in normal operation — and a console full of warnings is how a real error stops being noticed.
const timestampMs = (value) => {
    if (value === null || value === undefined) return null;
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
};

const priorImportColumns = [
    {
        title: "Study",
        dataIndex: "name",
        key: "name",
        render: (name) => name || "Untitled study",
    },
    {
        title: "Imported",
        dataIndex: "importedAt",
        key: "importedAt",
        render: (importedAt) => {
            // moment(undefined) is NOW, so an absent or unparseable stamp would render as "just
            // imported" — the most misleading value available on a table about what you already
            // have. Say nothing instead.
            //
            // Seconds, matching RecentSessions' "Created At" exactly. Not cosmetic: importing the
            // same study twice in a row is the ordinary case here, and at minute precision the two
            // copies render as identical rows on the one table whose job is to tell them apart.
            const ms = timestampMs(importedAt);
            return ms === null ? "—" : moment(ms).format("YYYY-MM-DD HH:mm:ss");
        },
    },
    {
        // Uncoloured, matching the owner's own link table (ShareModal.jsx "Scope"), so it does not
        // compete with the blue mode tag this page already shows for the incoming study.
        title: "Scope",
        dataIndex: "mode",
        key: "mode",
        render: (mode) => <Tag>{mode === "full" ? "Everything" : "Results only"}</Tag>,
    },
    {
        title: "Expires In",
        key: "expiresIn",
        render: (_, record) => {
            // The same three-way rule as RecentSessions: a permanent study has no expiry to count
            // down, an expired one shows nothing (the Status column says so), and the rest count
            // down in whole days, turning red inside the last five.
            if (record.permanent === true) return "Never";
            if (isSessionExpired({expiredAt: record.expiredAt, nowMs: Date.now()})) return "";
            const ms = timestampMs(record.expiredAt);
            if (ms === null) return "—";
            const expiredAt = moment(ms);
            const currentTime = moment();
            const style = expiredAt.diff(currentTime, "days") < 5 ? {color: "red"} : {};
            return <span style={style}>{formatDaysLeft(expiredAt.diff(currentTime))}</span>;
        },
    },
    {
        title: "Status",
        key: "status",
        render: (_, record) => studyStatusLabel(record, Date.now()),
    },
    {
        key: "actions",
        render: (_, record) => {
            const expired = isSessionExpired({expiredAt: record.expiredAt, nowMs: Date.now()});
            return (
                <Button size="small" disabled={expired}>
                    <Link
                        to={`${window.urlPrefix || ""}/analysis/visualization/${record.studyId}`}
                        disabled={expired}
                    >
                        Open
                    </Link>
                </Button>
            );
        },
    },
];

// Landing page for a share link.
//
// The recipient is shown what they are about to receive and has to confirm, because importing
// creates a study in THEIR account — it should not happen merely because a link was opened, e.g.
// by a link preview crawler or a mis-click.
export default () => {
    const shareId = useParams().shareId;
    const navigate = useNavigate();

    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    const [progressId, setProgressId] = useState(null);
    const [importing, setImporting] = useState(false);
    const [failure, setFailure] = useState(null);

    // Every visitor is auto-logged-in as a guest, but that happens asynchronously at startup — so a
    // first-time visitor arriving straight on this URL can render before a userId exists. Waiting
    // for it avoids calling the methods (which require a login) during that window.
    const userId = useTracker(() => Meteor.userId(), []);

    useEffect(() => {
        if (!shareId || !userId) return;
        let cancelled = false;
        (async () => {
            try {
                const result = await Meteor.callAsync("share.preview", {shareId});
                if (!cancelled) setPreview(result);
            } catch (error) {
                if (!cancelled) setPreviewError(error.reason || "This link is not available.");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [shareId, userId]);

    // Live progress for an import in flight. The document is published only to its own recipient.
    const progress = useTracker(() => {
        if (!progressId) return null;
        const handle = Meteor.subscribe("share.import.progress", progressId);
        if (!handle.ready()) return null;
        return DBCollections.ShareImportProgress.findOne({_id: progressId});
    }, [progressId]);

    useEffect(() => {
        if (progress?.status === "completed" && progress.newSessionId) {
            navigate(`${window.urlPrefix || ""}/analysis/visualization/${progress.newSessionId}`);
        }
        if (progress?.status === "failed") {
            setImporting(false);
            setFailure(progress.error || "Import failed.");
        }
    }, [progress, navigate]);

    const handleImport = async () => {
        setImporting(true);
        setFailure(null);
        // Mint the progress id here and subscribe to it BEFORE the call. share.import resolves only
        // once the whole clone has finished, so an id returned by the method would arrive too late
        // to report anything — the bar would sit at its initial value for the entire import.
        const id = Random.id();
        setProgressId(id);
        try {
            const {sessionId, counts} = await Meteor.callAsync("share.import", {shareId, progressId: id});
            // A full import that copied no input files still produced a perfectly viewable study —
            // results, plots and AI reports all came across — but it cannot be RE-RUN. The clone
            // reports success either way (copyUploadDir swallows an unreadable donor directory and
            // returns {copied: 0}), so without this the recipient discovers the gap only when a
            // re-run fails. Warn and continue rather than block: the study is worth opening, and it
            // already exists by the time we know.
            if (fullImportLostInputs(preview?.mode, counts)) {
                notify.warning(
                    "The copy opened, but its uploaded input data was not available — you can explore it, but not re-run it."
                );
            }
            // Navigate on the method's own result rather than waiting for the progress document:
            // it is authoritative and already resolved by this point.
            if (sessionId) {
                navigate(`${window.urlPrefix || ""}/analysis/visualization/${sessionId}`);
            }
        } catch (error) {
            setImporting(false);
            setFailure(error.reason || "Import failed.");
        }
    };

    const body = () => {
        // antd 5 renders Spin's `tip` only in the nested or fullscreen pattern; a bare
        // <Spin tip=.../> drops the text and warns. Wrap the message instead.
        if (!userId) return <Space><Spin/><Text type="secondary">Preparing…</Text></Space>;

        if (previewError) {
            return (
                <Result
                    status="warning"
                    title="This link is not available"
                    subTitle={previewError}
                    extra={
                        <Button type="primary" onClick={() => navigate(`${window.urlPrefix || ""}/analysis/recent-studies`)}>
                            Go to my studies
                        </Button>
                    }
                />
            );
        }

        if (!preview) return <Space><Spin/><Text type="secondary">Checking the link…</Text></Space>;

        const metaAnalysisNames = preview.metaAnalysisNames || [];
        const priorImports = preview.priorImports || [];
        const priorImportsTotal = preview.priorImportsTotal || 0;
        const alreadyImported = priorImports.length > 0;

        if (importing) {
            return (
                <Card>
                    <Space direction="vertical" style={{width: "100%"}}>
                        <Text strong>{progress?.stage || "Importing…"}</Text>
                        <Progress percent={progress?.percent ?? 5} status="active"/>
                        <Text type="secondary">
                            Copying the analyses into your own study. Large studies can take a minute.
                        </Text>
                    </Space>
                </Card>
            );
        }

        return (
            <Card>
                <Space direction="vertical" style={{width: "100%"}} size="middle">
                    <div>
                        <Title level={4} style={{marginBottom: 4}}>{preview.studyName}</Title>
                        <Space wrap>
                            <Tag color={preview.mode === "full" ? "blue" : "default"}>
                                {preview.mode === "full" ? "Everything" : "Results only"}
                            </Tag>
                            <Text type="secondary">
                                {preview.analysisNames.length} analys
                                {preview.analysisNames.length === 1 ? "is" : "es"}
                            </Text>
                            {/* Counted apart from the analyses rather than folded into one total: a
                                meta-analysis arrives WITH the analyses it was computed from, so one
                                combined number would overstate how much independent work is coming. */}
                            {metaAnalysisNames.length > 0 && (
                                <Text type="secondary">
                                    {metaAnalysisNames.length} meta-analys
                                    {metaAnalysisNames.length === 1 ? "is" : "es"}
                                </Text>
                            )}
                        </Space>
                    </div>

                    {/* Unlabelled when there is nothing to tell it apart from; once meta-analyses are
                        listed too, BOTH get a label rather than leaving one of the pair bare. */}
                    <Paragraph style={{marginBottom: 0}}>
                        {metaAnalysisNames.length > 0 && <Text strong>Analyses:</Text>}
                        {metaAnalysisNames.length > 0 ? ` ${preview.analysisNames.join(", ")}` : preview.analysisNames.join(", ")}
                    </Paragraph>

                    {metaAnalysisNames.length > 0 && (
                        <Paragraph style={{marginBottom: 0}}>
                            <Text strong>Meta-analyses:</Text>
                            {` ${metaAnalysisNames.join(", ")}`}
                        </Paragraph>
                    )}

                    <Alert
                        type="info"
                        showIcon
                        message="This creates your own copy"
                        description={
                            preview.mode === "full"
                                ? "You will get a full copy, including the uploaded data, which you can re-run and edit. Later changes to the original will not affect it."
                                : "You will get a view-only copy: results and biological interpretation reports, without the uploaded data. You can explore and export, but not re-run or edit it."
                        }
                    />

                    {/* ONE alert, not two. Both facts can be true at once — you can import your own
                        study, and you can have imported it before — and two stacked warnings would
                        say overlapping things about the same consequence. So the headline names
                        whichever case applies and the consequence is stated once, below it. */}
                    {(preview.isOwnStudy || alreadyImported) && (
                        <Alert
                            type="warning"
                            showIcon
                            message={
                                preview.isOwnStudy
                                    ? (alreadyImported
                                        ? "This is your own study, and you have imported it before"
                                        : "This is your own study")
                                    : "You have imported this study before"
                            }
                            description={
                                "Importing creates a separate, additional copy in your account. " +
                                "It does not update, merge with, or replace a copy you already have."
                            }
                        />
                    )}

                    {/* Nothing at all in the normal case: this is a landing page for a link, and a
                        "you have not imported this yet" banner would be noise on every first visit. */}
                    {alreadyImported && (
                        <div>
                            <Text strong>Studies you have already imported from this one</Text>
                            <Table
                                style={{marginTop: 8}}
                                size="small"
                                columns={priorImportColumns}
                                dataSource={priorImports}
                                rowKey="studyId"
                                pagination={priorImports.length > 5 ? {pageSize: 5} : false}
                                // Six columns do not fit the card's width on a narrow screen; scroll
                                // the table rather than letting the page scroll sideways.
                                scroll={{x: true}}
                            />
                            {/* The cap is stated, never silent: a table whose whole job is to say
                                "here is what you already have" must not present a truncated list as
                                a complete one. */}
                            {priorImportsTotal > priorImports.length && (
                                <Text type="secondary">
                                    {`Showing the ${priorImports.length} most recent of ${priorImportsTotal} copies — see all of them in your studies.`}
                                </Text>
                            )}
                        </div>
                    )}

                    {failure && <Alert type="error" showIcon message={failure}/>}

                    <Space>
                        <Button type="primary" onClick={handleImport}>
                            Add to my studies
                        </Button>
                        {/* Same destination and same label as the error branch above, so the page
                            has one name for the place your studies live. */}
                        <Button onClick={() => navigate(`${window.urlPrefix || ""}/analysis/recent-studies`)}>
                            Go to my studies
                        </Button>
                    </Space>
                </Space>
            </Card>
        );
    };

    return (
        <Layout style={{padding: 24, minHeight: "60vh"}}>
            <Helmet><title>Import shared study</title></Helmet>
            <div style={{maxWidth: 720, margin: "0 auto", width: "100%"}}>
                {body()}
            </div>
        </Layout>
    );
};

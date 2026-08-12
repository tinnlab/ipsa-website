import React, {useEffect, useState} from "react";
import {Meteor} from "meteor/meteor";
import {Random} from "meteor/random";
import {useTracker} from "meteor/react-meteor-data";
import {useNavigate, useParams} from "react-router-dom";
import {Helmet} from "react-helmet";
import {Alert, Button, Card, Layout, Progress, Result, Space, Spin, Tag, Typography} from "antd";

const {Paragraph, Text, Title} = Typography;

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
            const {sessionId} = await Meteor.callAsync("share.import", {shareId, progressId: id});
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
                                : "You will get a view-only copy: results and AI reports, without the uploaded data. You can explore and export, but not re-run or edit it."
                        }
                    />

                    {preview.isOwnStudy && (
                        <Alert
                            type="warning"
                            showIcon
                            message="This is your own study"
                            description="Importing will create a second copy in your account."
                        />
                    )}

                    {failure && <Alert type="error" showIcon message={failure}/>}

                    <Button type="primary" onClick={handleImport}>
                        Add to my studies
                    </Button>
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

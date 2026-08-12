import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, Button, Space, Typography, Alert, Progress, Spin, Divider, Form, Input } from 'antd';
import {
    PlayCircleOutlined,
    ReloadOutlined,
    EyeOutlined,
    BulbOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ThunderboltOutlined,
    EditOutlined
} from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { useNavigate } from 'react-router-dom';
import AnalysisResult from '../AnalysisResult';
import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import AnalysisUtils from '../AnalysisUtils';
import useSubscription from '../../../../../../hooks/useSubscription';
import { shouldAutoRunDE, extractErrorMessage, countDeGenes, isMissingInputError, INPUT_FILE_MISSING_ERROR } from '../../../../../../../utils/deAnalysisUtils';
import { getVolcanoOptions } from '../../../../../../../utils/volcanoPlotOptions';
import { shouldRunConsensusForConfigDoc } from '/imports/methods/consensusTrigger';
import VolcanoChartGene from '/imports/client/pages/home/Analysis/Visualization/components/VolcanoChartGene';
import inViewRender from '/imports/client/components/in-view-render/inViewRender';

const { Title, Text } = Typography;
const urlPrefix = Meteor.settings.public.urlPrefix || '';

// Lazy-mount the DE-gene volcano the same way the Visualization page does: it self-fetches
// its data and renders a WebGL scatter of the full gene cloud on mount, so defer that work
// until the card scrolls near the viewport (matches InViewVolcanoChartGeneMemo in Visualization).
const InViewVolcanoChartGene = inViewRender(VolcanoChartGene);

const Step5_RunAnalysis = ({ analysisId, inputType, sessionId, onReRunAnalysis, onEditAnalysis, onReuploadData }) => {
    const [isRunning, setIsRunning] = useState(false);
    const [analysisStatus, setAnalysisStatus] = useState('not_started'); // not_started, running, completed, failed
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    // True when the run failed because the uploaded data file is gone from the server
    // (wiped by an old redeploy, or auto-purged after long inactivity). Drives a dedicated
    // "please re-upload" banner instead of the generic error toast.
    const [missingInputFile, setMissingInputFile] = useState(false);
    const [isRunningDE, setIsRunningDE] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [volcanoFilteringParameters, setVolcanoFilteringParameters] = useState({
        maxAdjustedPValue: 0.05,
        minLogFoldChange: 1.0
    });
    const [deForm] = Form.useForm();
    const navigate = useNavigate();
    const [hasShownCompletionNotification, setHasShownCompletionNotification] = useState(false);
    const [hasShownStartNotification, setHasShownStartNotification] = useState(false);

    // Subscribe to analysis logs and results
    useSubscription('analysis.running.logs', { analysisId, inputType }, [analysisId, inputType]);
    useSubscription('analysis.results', { analysisId, inputType }, [analysisId, inputType]);

    // Track analysis status from database (using AnalysisLog instead of AnalysisProgress)
    const analysisLog = useTracker(() => {
        return DBCollections.AnalysisLog.findOne({ analysisId, inputType });
    }, [analysisId, inputType]);

    // Track if analysis has results
    const analysisResults = useTracker(() => {
        return DBCollections.AnalysisResult.find({ analysisId, inputType }).fetch();
    }, [analysisId, inputType]);

    // Track volcano plot data for expression type
    const volcanoPlotData = useTracker(() => {
        if (inputType !== 'expression') return null;
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'volcanoPlotData'
        })?.value;
    }, [analysisId, inputType]);

    // Track DE thresholds
    const maxAdjustedPValue = useTracker(() => {
        if (inputType !== 'expression') return null;
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'maxAdjustedPValue'
        })?.value || 0.05;
    }, [analysisId, inputType]);

    const minLogFoldChange = useTracker(() => {
        if (inputType !== 'expression') return null;
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'minLogFoldChange'
        })?.value || 1.0;
    }, [analysisId, inputType]);

    // Initialize volcano filtering parameters from database
    useEffect(() => {
        if (inputType === 'expression' && maxAdjustedPValue !== null && minLogFoldChange !== null) {
            setVolcanoFilteringParameters({
                maxAdjustedPValue,
                minLogFoldChange
            });
            // deForm only exists in the not-started preview; tuning the post-analysis
            // volcano also updates these trackers, so guard the Form write to avoid antd's
            // "not connected to any Form element" warning when the Form is unmounted.
            if (analysisStatus === 'not_started') {
                deForm.setFieldsValue({
                    maxAdjustedPValue,
                    minLogFoldChange
                });
            }
        }
    }, [maxAdjustedPValue, minLogFoldChange, inputType, analysisStatus]);

    // Stop DE spinner when volcano plot data is available
    useEffect(() => {
        if (inputType === 'expression' && volcanoPlotData && volcanoPlotData.length > 0 && isRunningDE) {
            setIsRunningDE(false);
        }
    }, [volcanoPlotData, inputType, isRunningDE]);

    // Check if results already exist on mount
    useEffect(() => {
        if (analysisResults.length > 0) {
            setAnalysisStatus('completed');
            setProgress(100);
            setIsRunning(false);
        }
    }, []);

    // Track analysis status from AnalysisLog
    useEffect(() => {
        if (analysisLog) {
            console.log('AnalysisLog update:', {
                isRunning: analysisLog.isRunning,
                status: analysisLog.status,
                progress: analysisLog.progress
            });

            if (analysisLog.isRunning) {
                setIsRunning(true);
                setAnalysisStatus('running');
                setProgress(analysisLog.progress || 0);
                // Show "started" notification once
                if (!hasShownStartNotification) {
                    notify.success('Analysis started successfully');
                    setHasShownStartNotification(true);
                }
            } else if (analysisLog.status === 'Done') {
                setIsRunning(false);
                setAnalysisStatus('completed');
                setProgress(100);
                // Only show notification once per analysis run
                if (!hasShownCompletionNotification) {
                    notify.success('Analysis completed successfully');
                    setHasShownCompletionNotification(true);
                }
            } else if (analysisLog.status && analysisLog.status.includes('failed')) {
                setIsRunning(false);
                setAnalysisStatus('failed');
                setError(analysisLog.status || 'Analysis failed');
                // Recognize a persisted "uploaded file missing" failure (e.g. user returns to
                // the session after a redeploy/purge) so the re-upload banner shows on remount,
                // not just immediately after clicking Run. Prefer the typed errorCode; fall back
                // to matching the message for logs written before errorCode existed.
                setMissingInputFile(
                    analysisLog.errorCode === INPUT_FILE_MISSING_ERROR ||
                    /no longer available|re-upload your data/i.test(analysisLog.status || '')
                );
            } else if (analysisLog.status && analysisLog.status.toLowerCase().includes('cancel')) {
                setIsRunning(false);
                setAnalysisStatus('cancelled');
                setProgress(analysisLog.progress || 0);
            }
        } else if (analysisResults.length > 0 && analysisStatus === 'not_started') {
            // Results exist but no log record - analysis was completed previously
            setAnalysisStatus('completed');
            setProgress(100);
        }
    }, [analysisLog, analysisResults, analysisStatus, hasShownCompletionNotification, hasShownStartNotification]);

    const handleStartAnalysis = async () => {
        setIsRunning(true);
        setAnalysisStatus('running');
        setProgress(0);
        setError(null);
        setMissingInputFile(false);

        try {
            // For expression data, pre-compute the DE volcano preview if it isn't ready.
            // This is OPTIONAL: pathway analysis recomputes DE from the raw expression file,
            // so a failure here must never block the run — warn and continue.
            if (shouldAutoRunDE({ inputType, volcanoPlotData })) {
                setIsRunningDE(true);
                notify.info('Computing DE genes for the volcano preview…');
                try {
                    await Meteor.callAsync('ora.run.volcano.plot', {
                        analysisId,
                        inputType
                    });
                    notify.success('Differential expression analysis completed');
                } catch (deErr) {
                    console.warn('DE preview pre-computation failed; continuing to analysis:', deErr);
                    notify.warning('Could not pre-compute the DE preview; continuing — it will be recomputed during analysis.');
                } finally {
                    setIsRunningDE(false);
                }
            }

            // Decide up front whether consensus will run (user enabled it AND
            // more than one method is selected). Passing this as deferCompletion
            // lets analysis.start keep the run in a "running" state instead of
            // flashing "completed" and then dropping back to 95% while consensus
            // runs — consensus.processAnalysis writes the final Done/100 itself.
            // The same gate runs server-side for mass analyses (processQueueItem).
            const methodSettingsDoc = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'methodSettings'
            });
            const willRunConsensus = shouldRunConsensusForConfigDoc(methodSettingsDoc, inputType);

            // Now run pathway enrichment analysis
            await Meteor.callAsync('analysis.start', {
                analysisId,
                inputType,
                sessionId,
                deferCompletion: willRunConsensus
            });

            if (willRunConsensus) {
                try {
                    await Meteor.callAsync('consensus.processAnalysis', {
                        analysisId,
                        sessionId,
                        inputType
                    });
                } catch (consensusErr) {
                    // Surface it, but don't fail the whole analysis — the
                    // per-method enrichment already succeeded. Previously a
                    // consensus failure was invisible and looked like all-1/0.
                    console.error('Consensus step failed:', consensusErr);
                    notify.error(`Consensus step failed: ${extractErrorMessage(consensusErr)}`);
                }
            }

            // Reset flags for new analysis run
            setHasShownStartNotification(false);
            setHasShownCompletionNotification(false);
        } catch (err) {
            console.error('Error starting analysis:', err);
            const message = extractErrorMessage(err);
            const fileMissing = isMissingInputError(err);
            setError(message);
            setMissingInputFile(fileMissing);
            setIsRunning(false);
            setIsRunningDE(false);
            setAnalysisStatus('failed');
            // A missing upload isn't a config error the user can "try again" past — guide them
            // to re-upload instead of showing a red failure toast.
            if (fileMissing) {
                notify.warning(message);
            } else {
                notify.error(message);
            }
        }
    };

    const handleCancel = async () => {
        setIsCancelling(true);
        try {
            await Meteor.callAsync('analysis.cancel', { analysisId, inputType });
            notify.info('Analysis cancelled');
            setIsRunning(false);
            setIsRunningDE(false);
            setAnalysisStatus('cancelled');
        } catch (err) {
            console.error('Error cancelling analysis:', err);
            notify.error('Failed to cancel analysis');
        } finally {
            setIsCancelling(false);
        }
    };

    const handleReRunAnalysis = async () => {
        // Re-run the analysis with the same configuration
        await handleStartAnalysis();
    };

    const handleVisualize = () => {
        // Carry the currently-viewed analysis so the visualization page opens on it
        // instead of always defaulting to the first analysis.
        const query = analysisId ? `?analysisId=${analysisId}` : '';
        window.location.href = `${urlPrefix}/analysis/visualization/${sessionId}${query}`;
    };

    const handleInterpret = () => {
        navigate(`${urlPrefix}/ai-interpretation?sessionId=${sessionId}&analysisId=${analysisId}`);
    };

    const handleRunDEAnalysis = async () => {
        setIsRunningDE(true);
        try {
            await Meteor.callAsync('ora.run.volcano.plot', {
                analysisId,
                inputType
            });
            notify.success('Differential expression analysis completed');
        } catch (err) {
            console.error('Error running DE analysis:', err);
            notify.error('Failed to run differential expression analysis');
        } finally {
            setIsRunningDE(false);
        }
    };

    const updateVolcanoPlotFiltering = _.debounce((newFilteringParams) => {
        setVolcanoFilteringParameters({
            ...newFilteringParams
        });

        AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                maxAdjustedPValue: newFilteringParams.maxAdjustedPValue,
                minLogFoldChange: newFilteringParams.minLogFoldChange
            }
        });
    }, 1500);

    // Ephemeral threshold state for the post-analysis DE-gene volcano (reused from the
    // Visualization page). Kept SEPARATE from volcanoFilteringParameters — which the
    // pre-analysis preview and its DB-tracker seed effect own — so tuning the completed-view
    // volcano never races the tracker→seed write-back. Seeded once from the tracked DB
    // thresholds; the user's edits take over from there.
    const [geneVolcanoThresholds, setGeneVolcanoThresholds] = useState(null);

    useEffect(() => {
        if (inputType === 'expression' && geneVolcanoThresholds === null &&
            maxAdjustedPValue !== null && minLogFoldChange !== null) {
            setGeneVolcanoThresholds({ maxAdjustedPValue, minLogFoldChange });
        }
    }, [inputType, maxAdjustedPValue, minLogFoldChange, geneVolcanoThresholds]);

    // config prop for VolcanoChartGene; its threshold inputs are controlled by
    // config.maxAdjustedPValue / config.minLogFoldChange.
    const volcanoConfig = useMemo(() => ({
        inputType,
        maxAdjustedPValue: geneVolcanoThresholds?.maxAdjustedPValue ?? maxAdjustedPValue ?? 0.05,
        minLogFoldChange: geneVolcanoThresholds?.minLogFoldChange ?? minLogFoldChange ?? 1.0
    }), [inputType, geneVolcanoThresholds, maxAdjustedPValue, minLogFoldChange]);

    // Persist tuned thresholds to live AnalysisConfig only (never the snapshot), debounced,
    // so the original DE definition is preserved. Mirrors the Visualization container.
    const persistDeThresholds = useRef(_.debounce((params) => {
        AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: {
                maxAdjustedPValue: params.maxAdjustedPValue,
                minLogFoldChange: params.minLogFoldChange
            }
        });
    }, 1500)).current;

    const handleVolcanoDESettingsChange = useCallback((key, value) => {
        const parsed = value === '' || value == null ? undefined : parseFloat(value);
        if (parsed === undefined || Number.isNaN(parsed)) return;
        // Compute the merged next value OUTSIDE the state updater (keep the updater pure),
        // then update local state immediately and schedule the debounced persist.
        const base = geneVolcanoThresholds ?? {
            maxAdjustedPValue: maxAdjustedPValue ?? 0.05,
            minLogFoldChange: minLogFoldChange ?? 1.0
        };
        const next = { ...base, [key]: parsed };
        setGeneVolcanoThresholds(next);
        persistDeThresholds(next);
    }, [geneVolcanoThresholds, maxAdjustedPValue, minLogFoldChange, persistDeThresholds]);

    const renderNotStarted = () => {
        // For expression data, optionally show volcano plot if DE already run
        if (inputType === 'expression' && volcanoPlotData && volcanoPlotData.length > 0) {
            const deGeneCount = countDeGenes(volcanoPlotData, volcanoFilteringParameters);

            return (
                <div style={{ padding: '20px' }}>
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                        <Alert
                            message="Differential Expression Analysis Complete"
                            description={`Found ${deGeneCount} differentially expressed genes. You can adjust the thresholds below before running pathway enrichment analysis.`}
                            type="success"
                            showIcon
                        />

                        {/* Volcano Plot */}
                        <Card title="Volcano Plot - Preview of DE Genes" size="small">
                            <Space direction="vertical" style={{ width: '100%' }} size="middle">
                                <Form form={deForm} layout="inline">
                                    <Form.Item
                                        name="maxAdjustedPValue"
                                        label="pValue.FDR ≤"
                                    >
                                        <Input
                                            type="number"
                                            style={{ width: 100 }}
                                            onChange={(e) => {
                                                if (e.target.value && e.target.value !== '') {
                                                    const tmpFilteringParameters = { ...volcanoFilteringParameters };
                                                    tmpFilteringParameters.maxAdjustedPValue = parseFloat(e.target.value);
                                                    updateVolcanoPlotFiltering(tmpFilteringParameters);
                                                }
                                            }}
                                        />
                                    </Form.Item>
                                    <Form.Item
                                        name="minLogFoldChange"
                                        label="Absolute Log2FC ≥"
                                    >
                                        <Input
                                            type="number"
                                            style={{ width: 100 }}
                                            onChange={(e) => {
                                                if (e.target.value && e.target.value !== '') {
                                                    const tmpFilteringParameters = { ...volcanoFilteringParameters };
                                                    tmpFilteringParameters.minLogFoldChange = parseFloat(e.target.value);
                                                    updateVolcanoPlotFiltering(tmpFilteringParameters);
                                                }
                                            }}
                                        />
                                    </Form.Item>
                                </Form>
                                <ReactEcharts
                                    option={getVolcanoOptions(volcanoPlotData, volcanoFilteringParameters)}
                                    style={{ height: '400px', width: '100%' }}
                                />
                            </Space>
                        </Card>

                        {/* Pathway Analysis Button */}
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                            <Space direction="vertical" size="large">
                                <div>
                                    <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
                                </div>
                                <div>
                                    <Title level={4}>Ready to Run Pathway Enrichment Analysis</Title>
                                    <Text type="secondary">
                                        Using the {deGeneCount} differentially expressed genes identified above.
                                    </Text>
                                </div>
                                <Button
                                    type="primary"
                                    size="large"
                                    icon={<PlayCircleOutlined />}
                                    onClick={handleStartAnalysis}
                                >
                                    Start Analysis
                                </Button>
                            </Space>
                        </div>
                    </Space>
                </div>
            );
        }

        // For all input types (including expression without DE data yet)
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
                    </div>
                    <div>
                        <Title level={4}>Ready to Run Analysis</Title>
                        <Text type="secondary">
                            {inputType === 'expression'
                                ? 'All configuration is complete. Click the button below to run differential expression analysis followed by pathway enrichment analysis.'
                                : 'All configuration is complete. Click the button below to start the pathway enrichment analysis.'}
                        </Text>
                    </div>
                    <Button
                        type="primary"
                        size="large"
                        icon={<PlayCircleOutlined />}
                        onClick={handleStartAnalysis}
                    >
                        Start Analysis
                    </Button>
                </Space>
            </div>
        );
    };

    const renderRunning = () => (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Spin size="large" />
                <div>
                    <Title level={4}>Analysis in Progress</Title>
                    <Text type="secondary">
                        Please wait while we analyze your data...
                    </Text>
                </div>
                <Progress
                    percent={progress}
                    status="active"
                    strokeColor={{
                        '0%': '#108ee9',
                        '100%': '#87d068',
                    }}
                    style={{ maxWidth: 500, margin: '0 auto' }}
                />
                {analysisLog?.status && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {analysisLog.status}
                    </Text>
                )}
                <Button
                    danger
                    icon={<CloseCircleOutlined />}
                    loading={isCancelling}
                    onClick={handleCancel}
                >
                    Cancel Analysis
                </Button>
            </Space>
        </div>
    );

    const renderCancelled = () => (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div>
                    <CloseCircleOutlined style={{ fontSize: 64, color: '#faad14' }} />
                </div>
                <div>
                    <Title level={4}>Analysis Cancelled</Title>
                    <Text type="secondary">
                        The analysis was cancelled. You can run it again when ready.
                    </Text>
                </div>
                <Space>
                    <Button
                        type="primary"
                        icon={<ReloadOutlined />}
                        onClick={handleReRunAnalysis}
                    >
                        Run Again
                    </Button>
                    {onEditAnalysis && (
                        <Button icon={<EditOutlined />} onClick={onEditAnalysis}>
                            Edit Analysis
                        </Button>
                    )}
                </Space>
            </Space>
        </div>
    );

    const renderCompleted = () => (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Alert
                message="Analysis Completed Successfully"
                description="Your pathway enrichment analysis has been completed. View the results below or proceed to visualization and interpretation."
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
            />

            {/* Action Buttons - Moved to top */}
            <Card size="small" title="Next Steps">
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Text>Choose what you'd like to do with these results:</Text>

                    <Space size="middle" wrap>
                        <Button
                            type="primary"
                            size="large"
                            icon={<EyeOutlined />}
                            onClick={handleVisualize}
                        >
                            Visualize Results
                        </Button>

                        <Button
                            size="large"
                            icon={<BulbOutlined />}
                            onClick={handleInterpret}
                        >
                            AI Interpretation
                        </Button>

                        <Button
                            icon={<ReloadOutlined />}
                            onClick={handleReRunAnalysis}
                        >
                            Re-run Analysis
                        </Button>

                        {onEditAnalysis && (
                            <Button
                                icon={<EditOutlined />}
                                onClick={onEditAnalysis}
                            >
                                Edit Analysis
                            </Button>
                        )}
                    </Space>
                </Space>
            </Card>

            {/* DE-gene volcano plot (post-analysis). Reuses the Visualization page's
                VolcanoChartGene so users can view + filter DE genes and use the
                focus/label/show-gene-names features without leaving Step 5. Only for
                expression input, and only when DE volcano data is present. */}
            {inputType === 'expression' && volcanoPlotData && volcanoPlotData.length > 0 && (
                <Card size="small" title="Volcano Plot - DE Genes">
                    <InViewVolcanoChartGene
                        analysisId={analysisId}
                        sessionId={sessionId}
                        config={volcanoConfig}
                        handleChangingDESettings={handleVolcanoDESettingsChange}
                    />
                </Card>
            )}

            {/* Results Table */}
            <div style={{ marginTop: '16px' }}>
                <Title level={4}>Analysis Results</Title>
                <AnalysisResult
                    analysisId={analysisId}
                    inputType={inputType}
                    sessionId={sessionId}
                />
            </div>
        </Space>
    );

    // A missing uploaded file can't be retried away — the data must be re-uploaded.
    // Show a distinct warning banner that routes the user back to the Data Input step.
    const renderMissingInputFile = () => (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div>
                    <CloseCircleOutlined style={{ fontSize: 64, color: '#faad14' }} />
                </div>
                <div>
                    <Title level={4}>Your data file is no longer available</Title>
                    <Text type="secondary">
                        Pathway analysis needs your original uploaded data, which is no longer on
                        the server. Please re-upload it to run the analysis again.
                    </Text>
                </div>
                <Alert
                    message="Uploaded data missing"
                    description="Your uploaded data file is no longer available (it may have been removed during maintenance or after long inactivity). Please re-upload your data to re-run this analysis."
                    type="warning"
                    showIcon
                    style={{ maxWidth: 600, margin: '0 auto', textAlign: 'left' }}
                />
                <Space>
                    {onReuploadData && (
                        <Button
                            type="primary"
                            icon={<ReloadOutlined />}
                            onClick={onReuploadData}
                        >
                            Re-upload Data
                        </Button>
                    )}
                </Space>
            </Space>
        </div>
    );

    const renderFailed = () => {
        if (missingInputFile) {
            return renderMissingInputFile();
        }
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <CloseCircleOutlined style={{ fontSize: 64, color: '#ff4d4f' }} />
                    </div>
                    <div>
                        <Title level={4}>Analysis Failed</Title>
                        <Text type="secondary">
                            An error occurred during analysis. Please check your configuration and try again.
                        </Text>
                    </div>
                    {error && (
                        <Alert
                            message="Error Details"
                            description={error}
                            type="error"
                            showIcon
                            style={{ maxWidth: 600, margin: '0 auto', textAlign: 'left' }}
                        />
                    )}
                    <Space>
                        <Button
                            type="primary"
                            icon={<ReloadOutlined />}
                            onClick={handleReRunAnalysis}
                        >
                            Try Again
                        </Button>
                    </Space>
                </Space>
            </div>
        );
    };

    return (
        <div>
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <Title level={3}>Step 5: Run Analysis</Title>
                <Text type="secondary">
                    Execute the pathway enrichment analysis and view results
                </Text>
            </div>

            <Card>
                {analysisStatus === 'not_started' && renderNotStarted()}
                {analysisStatus === 'running' && renderRunning()}
                {analysisStatus === 'completed' && renderCompleted()}
                {analysisStatus === 'failed' && renderFailed()}
                {analysisStatus === 'cancelled' && renderCancelled()}
            </Card>
        </div>
    );
};

export default Step5_RunAnalysis;

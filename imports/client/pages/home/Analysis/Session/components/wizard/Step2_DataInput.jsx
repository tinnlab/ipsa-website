import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, Space, Typography, Alert, Button, Select, Divider, Badge, Row, Col, Input, Upload, Spin, Tag, Modal, Radio } from 'antd';
import { CheckCircleOutlined, UploadOutlined, ThunderboltOutlined, EyeOutlined } from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import ReactEcharts from 'echarts-for-react';
import AnalysisUtils from '../AnalysisUtils';
import example from '../example';
import useMethod from '/imports/client/hooks/useMethod';
import useSubscription from '../../../../../../hooks/useSubscription';
import MetadataExtraction from './MetadataExtraction';
import _ from 'lodash';
import axios from 'axios';
import { countDeGenes } from '../../../../../../../utils/deAnalysisUtils';
import { getVolcanoOptions } from '../../../../../../../utils/volcanoPlotOptions';
import { derivePgseaPersistPayload, parsePgseaGeneStats, RANKING_OPTIONS } from '/imports/utils/pgseaInput';
import { sortOrganismsByName } from '/imports/utils/organismSort';

const { Title, Text } = Typography;

const Step2_DataInput = ({ analysisId, inputType, sessionId, onDataValidated }) => {
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState({ input: null, background: null, expression: null, group: null });
    const [detectedIdType, setDetectedIdType] = useState(null);
    const [selectedControlSamples, setSelectedControlSamples] = useState([]);
    const [selectedConditionSamples, setSelectedConditionSamples] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [showAllControlSamples, setShowAllControlSamples] = useState(false);
    const [showAllConditionSamples, setShowAllConditionSamples] = useState(false);
    const [isPreviewingDE, setIsPreviewingDE] = useState(false);
    const [showVolcanoModal, setShowVolcanoModal] = useState(false);
    // "Use Sample Data" has to stay busy until the sample groups are actually on screen.
    // isUploading covers the fetch, the uploads and the awaited analysis.update round-trip;
    // awaitingSampleGroups covers the short hop between that server write and groupData
    // reaching minimongo, which is what renders "4. Assign Sample Groups".
    const [awaitingSampleGroups, setAwaitingSampleGroups] = useState(false);
    const isBusy = isUploading || awaitingSampleGroups;

    useSubscription("organism.user.all", {}, []);

    const { isLoading, data } = useMethod("analysis.getData", {
        analysisId,
        inputType,
        keys: inputType === 'ora' ? ['input', 'background', 'taxId'] :
              inputType === 'pgsea' ? ['input', 'inputRaw', 'rankingBy', 'taxId'] :
              ['expressionFile', 'groupFile', 'taxId']
    }, [analysisId, inputType]);

    // Track input and background data reactively for ORA
    const inputData = useTracker(() => {
        if (inputType === 'ora' || inputType === 'pgsea') {
            const inputConfig = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'input'
            });
            const backgroundConfig = inputType === 'ora' ? DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'background'
            }) : null;

            // PGSEA also tracks the user's ORIGINAL upload (`inputRaw`, which may be 2-or-3
            // columns with a header) and the chosen ranking statistic. `input` stays the
            // canonical 2-column Gene<TAB>Statistic the backend consumes.
            const rawConfig = inputType === 'pgsea' ? DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'inputRaw'
            }) : null;
            const rankingConfig = inputType === 'pgsea' ? DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'rankingBy'
            }) : null;

            return {
                input: inputConfig?.value || '',
                background: backgroundConfig?.value || '',
                inputRaw: rawConfig?.value,
                rankingBy: rankingConfig?.value
            };
        }
        return { input: '', background: '' };
    }, [analysisId, inputType]);

    // Track uploaded expression/group file names reactively so re-uploading a
    // file updates the displayed name immediately (the one-shot useMethod fetch
    // above does not re-run on upload — see Bug 3).
    const uploadedFiles = useTracker(() => {
        if (inputType !== 'ora' && inputType !== 'pgsea') {
            const expressionConfig = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'expressionFile'
            });
            const groupConfig = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'groupFile'
            });
            return {
                expressionFile: expressionConfig?.value || '',
                groupFile: groupConfig?.value || ''
            };
        }
        return { expressionFile: '', groupFile: '' };
    }, [analysisId, inputType]);

    const organisms = useTracker(() => {
        return sortOrganismsByName(DBCollections.Organism.find({ isEnabled: true }).fetch());
    }, []);

    // Track detected ID type
    const idTypeConfig = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'idTypes'
        });
    }, [analysisId, inputType]);

    // Track group data for expression type
    const groupDataConfig = useTracker(() => {
        const config = DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'groupData'
        });
        console.log('Group data config:', config);
        return config;
    }, [analysisId, inputType]);

    // Track DE volcano preview result (expression only) so we can show a status line
    // with the number of DE genes after the user previews them.
    const volcanoPlotData = useTracker(() => {
        if (inputType !== 'expression') return null;
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'volcanoPlotData'
        })?.value;
    }, [analysisId, inputType]);

    const maxAdjustedPValue = useTracker(() => {
        if (inputType !== 'expression') return null;
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'maxAdjustedPValue'
        })?.value ?? 0.05;
    }, [analysisId, inputType]);

    const minLogFoldChange = useTracker(() => {
        if (inputType !== 'expression') return null;
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'minLogFoldChange'
        })?.value ?? 1.0;
    }, [analysisId, inputType]);

    // ---------------------------------------------------------------------------------
    // PGSEA input state
    //
    // The textarea is bound to LOCAL state, deliberately not to Minimongo. `input` in
    // Minimongo is the CANONICAL 2-column `Gene<TAB>Statistic` text we derive from what the
    // user supplied; `analysis.update` echoes `input` back and AnalysisUtils patches it
    // straight into Minimongo, so binding the textarea to it would visibly collapse a
    // 3-column paste to 2 columns while the user is still typing. `inputRaw` holds the
    // original text and is what we seed from and re-derive `input` from.
    // ---------------------------------------------------------------------------------
    const [pgseaText, setPgseaText] = useState('');
    const [pgseaMeta, setPgseaMeta] = useState({ available: [], error: null });
    const [pgseaSeeded, setPgseaSeeded] = useState(false);
    // Optimistic mirror of the stored `rankingBy`. `analysis.update` does not echo rankingBy
    // back, so Minimongo only catches up once the subscription delivers it; without this the
    // radio would visibly snap back to the old option for a round-trip after each click.
    const [pgseaRanking, setPgseaRanking] = useState(null);
    // What we last dispatched to the server, so change detection does not depend on Minimongo
    // catching up. Null until the first write of this mount.
    const lastSentPgseaRef = useRef(null);

    // Parse + collapse + persist. Shared by upload, textarea, example and the ranking radio
    // so they can never disagree about how the input is interpreted.
    const persistPgseaInput = async (rawText, { requestedRankingBy, taxId } = {}) => {
        const payload = derivePgseaPersistPayload(rawText, {
            storedRankingBy: pgseaRanking ?? inputData.rankingBy,
            requestedRankingBy
        });
        setPgseaMeta({ available: payload.available, error: payload.error });

        // Compare against what we LAST DISPATCHED, not against Minimongo. `analysis.update`
        // only echoes `input` back (and not until after gene-ID detection + updateStatistics),
        // while `rankingBy`/`inputRaw` arrive later still over the subscription. Diffing each
        // field independently against those lagging values let `input` and `rankingBy` be
        // written out of step — e.g. toggling pval then fc quickly persisted rankingBy:'fc'
        // against a p-value-ranked `input`, so FGSEA ranked by p-value while the UI (and the
        // stored metadata) claimed Fold Change, and it never self-healed.
        const baseline = lastSentPgseaRef.current ?? {
            inputRaw: inputData.inputRaw,
            input: inputData.input,
            rankingBy: inputData.rankingBy
        };
        if (!taxId
            && baseline.inputRaw === payload.inputRaw
            && baseline.input === payload.input
            && baseline.rankingBy === payload.rankingBy) {
            return payload; // genuinely nothing changed — skip the server recompute
        }

        // `input` and `rankingBy` ALWAYS travel together so they can never diverge.
        const update = { inputRaw: payload.inputRaw, input: payload.input };
        if (payload.rankingBy) update.rankingBy = payload.rankingBy;
        if (taxId) update.taxId = taxId;

        // Never relabel an analysis whose ranking we cannot re-derive. A mass-created analysis
        // stores rankingBy:'pval' with an already-collapsed `input` and no `inputRaw`, so
        // re-parsing it yields available:['fc'] — and simply blurring the textarea would have
        // rewritten rankingBy to 'fc' over a signed -log10(p) ranking, mislabelling it. The
        // stored `input` is unchanged in that case, so drop the ranking write and keep the
        // honest stored value.
        if (inputData.inputRaw == null
            && inputData.rankingBy
            && update.rankingBy !== inputData.rankingBy
            && update.input === inputData.input) {
            delete update.rankingBy;
        }

        // Mirror optimistically ONLY what we are actually persisting, so the radio can never
        // show a choice that was deliberately not written.
        if (update.rankingBy) setPgseaRanking(update.rankingBy);

        // Record what was actually SENT (rankingBy may have been withheld above), so the
        // no-op check on the next call compares against reality.
        lastSentPgseaRef.current = {
            inputRaw: payload.inputRaw,
            input: payload.input,
            rankingBy: update.rankingBy ?? inputData.rankingBy
        };
        await AnalysisUtils.updateAnalysis({ analysisId, inputType, data: update });
        return payload;
    };

    // Keep the debounced wrapper stable across renders (an inline _.debounce is rebuilt every
    // render and therefore never actually debounces) while still calling the latest closure.
    const persistPgseaInputRef = useRef(persistPgseaInput);
    persistPgseaInputRef.current = persistPgseaInput;
    const debouncedPersistPgseaInput = useMemo(
        () => _.debounce((text) => persistPgseaInputRef.current(text), 400),
        []
    );

    // UNMOUNT ONLY (the dep is the stable useMemo value): FLUSH rather than cancel, so the
    // last <400ms of typing still reaches the server when the user clicks Next. At unmount no
    // further render has happened, so the ref still targets the analysis being edited.
    useEffect(() => () => debouncedPersistPgseaInput.flush(), [debouncedPersistPgseaInput]);

    // Switching analysis or input type: CANCEL instead. By the time this runs the component
    // has re-rendered and the ref closes over the NEW analysisId, so flushing here would
    // attribute the previous analysis's text to the new one.
    useEffect(() => {
        debouncedPersistPgseaInput.cancel();
        lastSentPgseaRef.current = null;
        setPgseaText('');
        setPgseaMeta({ available: [], error: null });
        setPgseaRanking(null);
        setPgseaSeeded(false);
    }, [analysisId, inputType, debouncedPersistPgseaInput]);

    // Drop the optimistic ranking once the server's value agrees, so the stored value is
    // authoritative again. Without this the optimistic value would shadow `inputData.rankingBy`
    // for the rest of the mount, and a write that never landed (e.g. a read-only session, where
    // AnalysisUtils.updateAnalysis silently no-ops) would leave the radio showing a choice that
    // was never persisted.
    useEffect(() => {
        if (pgseaRanking && inputData.rankingBy === pgseaRanking) setPgseaRanking(null);
    }, [inputData.rankingBy, pgseaRanking]);

    // Seed once from what is already stored (inputRaw, or `input` for analyses saved before
    // inputRaw existed) so reopening an analysis shows the user's own text.
    useEffect(() => {
        if (inputType !== 'pgsea' || pgseaSeeded) return;
        const stored = inputData.inputRaw ?? inputData.input;
        if (!stored) return;
        setPgseaText(stored);
        const payload = derivePgseaPersistPayload(stored, { storedRankingBy: inputData.rankingBy });
        setPgseaMeta({ available: payload.available, error: payload.error });
        setPgseaSeeded(true);

        // Repair analyses saved before this change. The old wizard wrote whatever the user
        // pasted straight into `input`, so a 3-column table could be stored there — and
        // createPgseaParams drops every row that is not exactly 2 columns, meaning Run would
        // hand FGSEA an EMPTY ranking. Merely displaying it is not enough: the user can go
        // straight to Run without touching the textarea.
        //
        // Trigger on what the SERVER PARSER would actually receive, not on string inequality.
        // Rewriting a saved analysis that merely differs by CRLF or a trailing newline would
        // be silently editing stored data for no benefit. Only repair when the stored text
        // yields FEWER usable gene/statistic pairs than the collapsed text — i.e. it really is
        // losing genes today.
        if (inputData.inputRaw == null && !payload.error && payload.input !== inputData.input) {
            const storedUsable = Object.keys(parsePgseaGeneStats(inputData.input || '').geneData).length;
            const repairedUsable = Object.keys(parsePgseaGeneStats(payload.input).geneData).length;
            if (repairedUsable > storedUsable) persistPgseaInput(stored);
        }
    }, [inputType, pgseaSeeded, inputData.inputRaw, inputData.input, inputData.rankingBy]);

    useEffect(() => {
        if (data?.taxId) {
            setSelectedOrg(data.taxId);
        }
    }, [data]);

    useEffect(() => {
        if (idTypeConfig?.value && idTypeConfig.value.length > 0) {
            const firstIdType = idTypeConfig.value[0];
            setDetectedIdType(firstIdType);

            // Automatically set the first detected ID type in the database
            AnalysisUtils.updateAnalysis({
                analysisId,
                inputType,
                data: { idType: firstIdType }
            });
        }
    }, [idTypeConfig, analysisId, inputType]);

    // Auto-select all control and condition samples when group data is loaded
    useEffect(() => {
        if (groupDataConfig?.value?.data && inputType === 'expression') {
            const groupData = groupDataConfig.value.data;

            const controlSamples = Object.keys(groupData).filter(
                sample => groupData[sample] === 'c'
            );
            const conditionSamples = Object.keys(groupData).filter(
                sample => groupData[sample] === 'd'
            );

            console.log('Auto-selecting samples:', { controlSamples, conditionSamples });

            if (controlSamples.length > 0 && conditionSamples.length > 0) {
                setSelectedControlSamples(controlSamples);
                setSelectedConditionSamples(conditionSamples);

                // Save to database
                AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        selectedControlSamples: controlSamples,
                        selectedConditionSamples: conditionSamples
                    }
                });
            }
        }
    }, [groupDataConfig, inputType, analysisId]);

    // Release the post-write wait as soon as groupData reaches the client. The watchdog makes
    // hanging forever impossible (e.g. a dropped publication); it is armed only AFTER the server
    // method resolved, so it covers milliseconds and can never fire while real work is still in
    // progress. The dependency is deliberately a boolean: groupDataConfig is a fresh object on
    // every Tracker invalidation and would restart the timer endlessly.
    useEffect(() => {
        if (!awaitingSampleGroups) return;

        if (groupDataConfig?.value?.data) {
            setAwaitingSampleGroups(false);
            return;
        }

        const timer = setTimeout(() => {
            setAwaitingSampleGroups(false);
            notify.warning('Sample data was saved, but the sample groups have not arrived yet. Reload the page if the "Assign Sample Groups" table does not appear.');
        }, 15000);
        return () => clearTimeout(timer);
    }, [awaitingSampleGroups, Boolean(groupDataConfig?.value?.data)]);

    const validateFileContent = async (fileContent, fileName = '', fieldType = 'input') => {
        try {
            setIsValidating(true);
            setValidationResult(prev => ({ ...prev, [fieldType]: null }));

            const validationType = inputType === 'expression' ?
                (fieldType === 'expression' ? 'expression' : 'group') :
                inputType;

            const result = await Meteor.callAsync('data.validate', {
                inputType: validationType,
                fileContent,
                fileName,
                useLLM: true
            });

            setValidationResult(prev => ({ ...prev, [fieldType]: result }));
            return result;
        } catch (error) {
            console.error('Validation error:', error);
            notify.error(`Validation failed: ${error.message}`);
            return { valid: false, errors: [error.message] };
        } finally {
            setIsValidating(false);
        }
    };

    const handlePreviewDE = async () => {
        setIsPreviewingDE(true);
        try {
            notify.info('Running differential expression analysis...');
            await Meteor.callAsync('ora.run.volcano.plot', {
                analysisId,
                inputType
            });
            notify.success('Differential expression analysis completed! Click "View Volcano Plot" to see the result.');
        } catch (err) {
            console.error('Error running DE analysis:', err);
            notify.error('Failed to run differential expression analysis');
        } finally {
            setIsPreviewingDE(false);
        }
    };

    const handleOrganismChange = async (value) => {
        setSelectedOrg(value);
        await AnalysisUtils.updateAnalysis({
            analysisId,
            inputType,
            data: { taxId: value }
        });
    };

    // `variant` only applies to pgsea: '3col' (default) demonstrates the Gene/Fold-Change/
    // P-value table and the ranking selector; '2col' loads the legacy headerless example.
    const handleUseSampleData = async (variant = '3col') => {
        if (inputType === 'ora') {
            // These branches showed no loading state at all, yet they wait on the LLM-backed
            // data.validate call and on the server detecting the gene ID type, neither of which is
            // instant. As in the expression branch below, the write goes straight to the method:
            // the debounced helper would resolve before the server had started.
            setIsUploading(true);
            try {
                await Meteor.asyncCallWithNotification('analysis.update', {
                    analysisId,
                    inputType,
                    data: {
                        input: example.ORA,
                        taxId: '9606'
                    }
                });
                setSelectedOrg('9606');
                await validateFileContent(example.ORA, 'example', 'input');
            } catch (error) {
                console.error('Error loading sample data:', error);
                notify.error('Failed to load sample data');
            } finally {
                setIsUploading(false);
            }
        } else if (inputType === 'pgsea') {
            // #160's persist path is kept whole: it writes `inputRaw`/`input`/`rankingBy`
            // together (see persistPgseaInput), which #161's plain `analysis.update` on `input`
            // alone cannot do without desynchronising the ranking from the collapsed text.
            // #161's contribution here is the busy state and the failure report, both of which
            // are preserved — the awaits below already cover the slow work (the persist round
            // trip and the LLM-backed validate), so the button stays busy for the whole wait.
            const content = variant === '2col' ? example.PGSEA_2COL : example.PGSEA_3COL;
            debouncedPersistPgseaInput.cancel();
            setPgseaText(content);
            setPgseaSeeded(true);
            setSelectedOrg('9606');
            setIsUploading(true);
            try {
                await persistPgseaInput(content, { taxId: '9606' });
                await validateFileContent(content, 'example', 'input');
            } catch (error) {
                console.error('Error loading sample data:', error);
                notify.error('Failed to load sample data');
            } finally {
                setIsUploading(false);
            }
        } else if (inputType === 'expression') {
            // Upload expression example files
            setIsUploading(true);
            try {
                setSelectedOrg('9606');
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: { taxId: '9606' }
                });

                const response1 = await fetch('/files/GSE48350-expression.csv');
                const expressionContent = await response1.text();
                await Meteor.asyncCallWithNotification('file.upload', {
                    filename: 'GSE48350-expression.csv',
                    fileContent: expressionContent,
                    userId: Meteor.userId(),
                    sessionId
                });

                const response2 = await fetch('/files/GSE48350-group.csv');
                const groupContent = await response2.text();
                await Meteor.asyncCallWithNotification('file.upload', {
                    filename: 'GSE48350-group.csv',
                    fileContent: groupContent,
                    userId: Meteor.userId(),
                    sessionId
                });

                // Record both files in a single update. The server processes expressionFile
                // and groupFile independently, so one combined call sets both the expression
                // file (green name + matrix processing) and groupData (sample-selection table
                // + Preview DE button).
                //
                // Called directly rather than through AnalysisUtils.updateAnalysis: that helper is
                // debounced with no wait, so it resolves with the *previous* invocation's cached
                // value (undefined on the first call) and the await returned before the server had
                // written anything. That is why the button stopped spinning while "4. Assign Sample
                // Groups" was still missing. Awaiting the method itself makes the spinner cover the
                // server-side processing, which takes seconds on this dataset. taxId rides along so
                // id-type detection cannot race the debounced taxId write above.
                await Meteor.asyncCallWithNotification('analysis.update', {
                    analysisId,
                    inputType,
                    data: {
                        taxId: '9606',
                        expressionFile: 'GSE48350-expression.csv',
                        groupFile: 'GSE48350-group.csv'
                    }
                });

                // The write is committed; stay busy until it reaches the client.
                setAwaitingSampleGroups(true);
                notify.success('Sample data loaded successfully');
            } catch (error) {
                console.error('Error loading sample data:', error);
                notify.error('Failed to load sample data');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const renderValidationAlert = (result, title) => {
        if (!result) return null;

        return (
            <Alert
                message={result.valid ? `✅ ${title} Format Valid` : `⚠️ ${title} Format Issues Detected`}
                description={
                    <Space direction="vertical" style={{ width: '100%' }}>
                        {result.detectedFormat && (
                            <Text><strong>Detected Format:</strong> {result.detectedFormat}</Text>
                        )}
                        {result.errors && result.errors.length > 0 && (
                            <div>
                                <Text strong>Errors:</Text>
                                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                                    {result.errors.map((error, i) => (
                                        <li key={i}><Text type="danger">{error}</Text></li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {result.suggestions && result.suggestions.length > 0 && (
                            <div>
                                <Text strong>Suggestions:</Text>
                                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                                    {result.suggestions.map((suggestion, i) => (
                                        <li key={i}><Text>{suggestion}</Text></li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <Text type="secondary">Confidence: {result.confidence}</Text>
                    </Space>
                }
                type={result.valid ? "success" : "warning"}
                closable
                onClose={() => setValidationResult(prev => ({ ...prev, [title.toLowerCase()]: null }))}
                style={{ marginBottom: 16 }}
            />
        );
    };

    const renderORAInput = () => {
        const handleFileRead = async (file, fieldType) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target.result;
                // Include taxId if it's already set to trigger ID type detection
                const updateData = { [fieldType]: content };
                if (selectedOrg && fieldType === 'input') {
                    updateData.taxId = selectedOrg;
                }
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: updateData
                });
                await validateFileContent(content, file.name, fieldType);
            };
            reader.readAsText(file);
        };

        return (
            <Row gutter={[16, 16]}>
                <Col span={12}>
                    {renderValidationAlert(validationResult.input, 'Input')}
                    <Card title="Input Gene List" size="small">
                        <Space direction="vertical" style={{ width: '100%' }}>
                            <Upload
                                accept=".txt,.csv"
                                showUploadList={false}
                                disabled={!selectedOrg}
                                beforeUpload={(file) => {
                                    handleFileRead(file, 'input');
                                    return false;
                                }}
                            >
                                <Button icon={<UploadOutlined />} disabled={!selectedOrg}>
                                    Upload Gene List File
                                </Button>
                            </Upload>
                            {!selectedOrg && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    Please select an organism first to enable file upload
                                </Text>
                            )}
                            <Input.TextArea
                                rows={10}
                                placeholder="Enter gene identifiers, one per line..."
                                value={inputData.input}
                                onChange={async (e) => {
                                    await AnalysisUtils.updateAnalysis({
                                        analysisId,
                                        inputType,
                                        data: { input: e.target.value }
                                    });
                                }}
                                onBlur={_.debounce(async (e) => {
                                    if (e.target.value && e.target.value.trim().length > 10) {
                                        await validateFileContent(e.target.value, 'manual', 'input');
                                    }
                                }, 1000)}
                            />
                            <Button
                                onClick={async () => {
                                    const content = inputData.input;
                                    if (content) {
                                        await validateFileContent(content, 'manual', 'input');
                                    }
                                }}
                                loading={isValidating}
                            >
                                Validate Input
                            </Button>
                        </Space>
                    </Card>
                </Col>
                <Col span={12}>
                    {renderValidationAlert(validationResult.background, 'Background')}
                    <Card title="Background Gene List (Optional)" size="small">
                        <Space direction="vertical" style={{ width: '100%' }}>
                            <Upload
                                accept=".txt,.csv"
                                showUploadList={false}
                                beforeUpload={(file) => {
                                    handleFileRead(file, 'background');
                                    return false;
                                }}
                            >
                                <Button icon={<UploadOutlined />}>
                                    Upload Background File
                                </Button>
                            </Upload>
                            <Input.TextArea
                                rows={10}
                                placeholder="Enter background gene identifiers (optional)..."
                                value={inputData.background}
                                onChange={async (e) => {
                                    await AnalysisUtils.updateAnalysis({
                                        analysisId,
                                        inputType,
                                        data: { background: e.target.value }
                                    });
                                }}
                            />
                        </Space>
                    </Card>
                </Col>
            </Row>
        );
    };

    const renderPGSEAInput = () => {
        // The literal-\t rescue now lives inside derivePgseaPersistPayload, which only applies
        // it when a parse has already failed — the old unconditional check corrupted CSV files
        // that merely contained a literal \t.
        const handleFileRead = async (file) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target.result;
                debouncedPersistPgseaInput.cancel();
                setPgseaText(content);
                setPgseaSeeded(true);
                setIsUploading(true);
                try {
                    // Pass taxId when it is already set so the server runs ID type detection.
                    const payload = await persistPgseaInput(content, { taxId: selectedOrg || undefined });
                    // Only re-set when the literal-\t rescue actually rewrote the text, so the
                    // textarea does not flash the un-fixed version for a frame.
                    if (payload.inputRaw !== content) setPgseaText(payload.inputRaw);
                    await validateFileContent(payload.inputRaw, file.name, 'input');
                } finally {
                    setIsUploading(false);
                }
            };
            reader.readAsText(file);
        };

        const pvalAvailable = pgseaMeta.available.includes('pval');
        // Show the STORED value as-is rather than clamping it through resolvePgseaRankingBy: a
        // mass-created analysis stores rankingBy:'pval' with an already-collapsed `input` and
        // no inputRaw, so `available` re-derives as ['fc'] and clamping would misreport it as
        // Fold Change. antd renders a selected-but-disabled radio, which is the honest state —
        // the p-values are genuinely not recoverable from collapsed text.
        // Coerce to a value the Radio.Group actually offers. The dead `pgsea.rankGenes` method
        // writes this same config key with a different vocabulary ('foldChange'/'pValue'), and
        // an unrecognised value would render the group with NO option selected at all.
        const storedRanking = pgseaRanking ?? inputData.rankingBy;
        const selectedRanking = RANKING_OPTIONS.some(o => o.value === storedRanking)
            ? storedRanking
            : (storedRanking === 'pValue' ? 'pval' : 'fc');
        const hasPgseaInput = Boolean(pgseaText && pgseaText.trim());

        return (
            <div>
                {renderValidationAlert(validationResult.input, 'Input')}
                {pgseaMeta.error && (
                    // Deterministic parse failure from the shared normalizer. Shown alongside
                    // (not instead of) the LLM validator alert: this one is exact about why the
                    // file could not be read, and the raw text is stored unchanged when it fires.
                    <Alert
                        message="Could not read this gene list"
                        description={pgseaMeta.error}
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}
                <Alert
                    message="Format: 2 or 3 columns, tab- or comma-separated, header optional"
                    description="Column 1: Gene identifier | Column 2: Fold-Change | Column 3 (optional): P-value. A 2-column Gene + ranking metric file is still accepted."
                    type="info"
                    showIcon
                    closable
                    style={{ marginBottom: 16 }}
                />
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                        <Upload
                            accept=".txt,.tsv,.csv"
                            showUploadList={false}
                            disabled={!selectedOrg}
                            beforeUpload={(file) => {
                                handleFileRead(file);
                                return false;
                            }}
                        >
                            <Button icon={<UploadOutlined />} disabled={!selectedOrg}>
                                Upload Ranked Gene List File
                            </Button>
                        </Upload>
                        <Button size="small" type="link" onClick={() => handleUseSampleData('2col')}>
                            Use 2-column example
                        </Button>
                    </Space>
                    {!selectedOrg && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Please select an organism first to enable file upload
                        </Text>
                    )}
                    <Input.TextArea
                        rows={12}
                        placeholder={'Gene\tFold-Change\tP-value\nGENE1\t2.5\t0.01\nGENE2\t-1.8\t0.03\n...'}
                        value={pgseaText}
                        onChange={(e) => {
                            setPgseaText(e.target.value);
                            setPgseaSeeded(true);
                            debouncedPersistPgseaInput(e.target.value);
                        }}
                        onBlur={async (e) => {
                            const content = e.target.value;
                            debouncedPersistPgseaInput.cancel();
                            await persistPgseaInput(content);
                            if (content && content.trim().length > 10) {
                                await validateFileContent(content, 'manual', 'input');
                            }
                        }}
                    />
                    <div>
                        <Text strong>Calculate gene rankings by: </Text>
                        <Radio.Group
                            style={{ marginTop: 4 }}
                            value={selectedRanking}
                            onChange={async (e) => {
                                debouncedPersistPgseaInput.cancel();
                                await persistPgseaInput(pgseaText, { requestedRankingBy: e.target.value });
                            }}
                        >
                            {RANKING_OPTIONS.map(opt => (
                                <Radio
                                    key={opt.value}
                                    value={opt.value}
                                    disabled={opt.value === 'pval' && !pvalAvailable}
                                >
                                    {opt.label}
                                </Radio>
                            ))}
                        </Radio.Group>
                        {hasPgseaInput && !pvalAvailable && (
                            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                                P-value ranking needs a P-value column in your input.
                            </Text>
                        )}
                    </div>
                    <Button
                        onClick={async () => {
                            if (pgseaText) {
                                await validateFileContent(pgseaText, 'manual', 'input');
                            }
                        }}
                        loading={isValidating}
                    >
                        Validate Input
                    </Button>
                </Space>
            </div>
        );
    };

    const renderExpressionInput = () => {
        const handleFileUpload = async (file, fileType) => {
            setIsUploading(true);
            try {
                const formData = new FormData();
                formData.append('file', file);
                const uploaded = await axios.post(
                    `/api/upload?userId=${Meteor.userId()}&sessionId=${sessionId}&fileName=${encodeURIComponent(file.name)}`,
                    formData
                );

                // Record the name the SERVER wrote, not the local one. The upload handler
                // sanitises the filename, so a name containing separators or reserved characters
                // lands on disk under a different name — recording the raw one would store a
                // path that no later run can find.
                await AnalysisUtils.updateAnalysis({
                    analysisId,
                    inputType,
                    data: {
                        [fileType]: uploaded?.data?.fileName || file.name
                    }
                });

                notify.success(`${fileType === 'expressionFile' ? 'Expression' : 'Group'} file uploaded successfully`);
            } catch (error) {
                console.error('Error uploading file:', error);
                notify.error('Failed to upload file');
            } finally {
                setIsUploading(false);
            }
        };

        // The blocking overlay stays tied to the upload itself. The button keeps showing the busy
        // state through the shorter wait for the groups to arrive, so that wait never locks the
        // section.
        return (
            <Spin spinning={isUploading} tip="Uploading...">
                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        <Card title="Expression Matrix File" size="small">
                            <Space direction="vertical" style={{ width: '100%' }}>
                                <Alert
                                    message="CSV format: Genes as rows, Samples as columns"
                                    type="info"
                                    showIcon
                                />
                                <Upload
                                    accept=".csv"
                                    showUploadList={false}
                                    beforeUpload={(file) => {
                                        handleFileUpload(file, 'expressionFile');
                                        return false;
                                    }}
                                >
                                    <Button icon={<UploadOutlined />}>
                                        Upload Expression File
                                    </Button>
                                </Upload>
                                {(uploadedFiles.expressionFile || data?.expressionFile) && (
                                    <Text type="success">✓ {uploadedFiles.expressionFile || data.expressionFile}</Text>
                                )}
                            </Space>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title="Group Assignment File" size="small">
                            <Space direction="vertical" style={{ width: '100%' }}>
                                <Alert
                                    message="CSV format: Sample name, Group (c=control, d=disease)"
                                    type="info"
                                    showIcon
                                />
                                <Upload
                                    accept=".csv"
                                    showUploadList={false}
                                    beforeUpload={(file) => {
                                        handleFileUpload(file, 'groupFile');
                                        return false;
                                    }}
                                >
                                    <Button icon={<UploadOutlined />}>
                                        Upload Group File
                                    </Button>
                                </Upload>
                                {(uploadedFiles.groupFile || data?.groupFile) && (
                                    <Text type="success">✓ {uploadedFiles.groupFile || data.groupFile}</Text>
                                )}
                            </Space>
                        </Card>
                    </Col>
                </Row>

                {groupDataConfig?.value?.data && (
                    <Card
                        title={
                            <Space>
                                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                <Text strong>4. Assign Sample Groups</Text>
                            </Space>
                        }
                        size="small"
                        style={{ marginTop: 16 }}
                    >
                        <Space direction="vertical" style={{ width: '100%' }} size="large">
                            <Alert
                                message="Map Group Labels to Biological Conditions"
                                description={`Your group file contains these labels: ${groupDataConfig.value.annotations.join(', ')}. Please specify which label represents Control samples and which represents Condition/Disease samples.`}
                                type="info"
                                showIcon
                            />

                            {groupDataConfig.value.warnings?.duplicateSamples?.length > 0 && (
                                <Alert
                                    message={`Duplicate sample names detected (${groupDataConfig.value.warnings.duplicateSamples.length})`}
                                    description={
                                        <span>
                                            These sample names appear in more than one row of the group file and were
                                            merged into a single entry (the last value in the file was kept), so some
                                            samples may be missing or mislabeled.
                                            {groupDataConfig.value.warnings.conflictingLabels?.length > 0 &&
                                                ` ${groupDataConfig.value.warnings.conflictingLabels.length} of them had conflicting labels.`}
                                            {' '}If your expression matrix distinguishes these samples (e.g. with a
                                            "_1" suffix), update the group file to use the same unique names.
                                            <br />
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {groupDataConfig.value.warnings.duplicateSamples.slice(0, 20).join(', ')}
                                                {groupDataConfig.value.warnings.duplicateSamples.length > 20
                                                    ? `, … (+${groupDataConfig.value.warnings.duplicateSamples.length - 20} more)`
                                                    : ''}
                                            </Text>
                                        </span>
                                    }
                                    type="warning"
                                    showIcon
                                />
                            )}

                            <Row gutter={[16, 16]}>
                                <Col span={12}>
                                    <Card size="small" style={{ backgroundColor: '#f0f5ff' }}>
                                        <Space direction="vertical" style={{ width: '100%' }}>
                                            <Text strong>Control Group Label:</Text>
                                            <Select
                                                placeholder="Select label for control"
                                                style={{ width: '100%' }}
                                                value={groupDataConfig.value.annotations.includes('c') ? 'c' : undefined}
                                                onChange={(value) => {
                                                    const samples = Object.keys(groupDataConfig.value.data)
                                                        .filter(s => groupDataConfig.value.data[s] === value);
                                                    setSelectedControlSamples(samples);
                                                    AnalysisUtils.updateAnalysis({
                                                        analysisId,
                                                        inputType,
                                                        data: { selectedControlSamples: samples }
                                                    });
                                                }}
                                            >
                                                {groupDataConfig.value.annotations.map(annotation => (
                                                    <Select.Option key={annotation} value={annotation}>
                                                        {annotation} ({Object.keys(groupDataConfig.value.data)
                                                            .filter(s => groupDataConfig.value.data[s] === annotation).length} samples)
                                                    </Select.Option>
                                                ))}
                                            </Select>
                                            {selectedControlSamples.length > 0 && (
                                                <div style={{ marginTop: 12 }}>
                                                    <Divider style={{ margin: '8px 0' }} />
                                                    <Text strong style={{ fontSize: 12 }}>
                                                        Control Samples ({selectedControlSamples.length}):
                                                    </Text>
                                                    <div style={{
                                                        marginTop: 8,
                                                        maxHeight: showAllControlSamples ? 'none' : '200px',
                                                        overflowY: showAllControlSamples ? 'visible' : 'auto',
                                                        backgroundColor: '#fafafa',
                                                        padding: 8,
                                                        borderRadius: 4,
                                                        fontSize: 12
                                                    }}>
                                                        {(showAllControlSamples
                                                            ? selectedControlSamples
                                                            : selectedControlSamples.slice(0, 10)
                                                        ).map((sample, idx) => (
                                                            <div key={idx} style={{ padding: '2px 0' }}>
                                                                • {sample}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {selectedControlSamples.length > 10 && (
                                                        <Button
                                                            type="link"
                                                            size="small"
                                                            onClick={() => setShowAllControlSamples(!showAllControlSamples)}
                                                            style={{ padding: '4px 0', fontSize: 12 }}
                                                        >
                                                            {showAllControlSamples
                                                                ? 'Show less'
                                                                : `Show more (${selectedControlSamples.length - 10} more)`}
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </Space>
                                    </Card>
                                </Col>
                                <Col span={12}>
                                    <Card size="small" style={{ backgroundColor: '#fff7e6' }}>
                                        <Space direction="vertical" style={{ width: '100%' }}>
                                            <Text strong>Condition/Disease Group Label:</Text>
                                            <Select
                                                placeholder="Select label for condition"
                                                style={{ width: '100%' }}
                                                value={groupDataConfig.value.annotations.includes('d') ? 'd' : undefined}
                                                onChange={(value) => {
                                                    const samples = Object.keys(groupDataConfig.value.data)
                                                        .filter(s => groupDataConfig.value.data[s] === value);
                                                    setSelectedConditionSamples(samples);
                                                    AnalysisUtils.updateAnalysis({
                                                        analysisId,
                                                        inputType,
                                                        data: { selectedConditionSamples: samples }
                                                    });
                                                }}
                                            >
                                                {groupDataConfig.value.annotations.map(annotation => (
                                                    <Select.Option key={annotation} value={annotation}>
                                                        {annotation} ({Object.keys(groupDataConfig.value.data)
                                                            .filter(s => groupDataConfig.value.data[s] === annotation).length} samples)
                                                    </Select.Option>
                                                ))}
                                            </Select>
                                            {selectedConditionSamples.length > 0 && (
                                                <div style={{ marginTop: 12 }}>
                                                    <Divider style={{ margin: '8px 0' }} />
                                                    <Text strong style={{ fontSize: 12 }}>
                                                        Condition Samples ({selectedConditionSamples.length}):
                                                    </Text>
                                                    <div style={{
                                                        marginTop: 8,
                                                        maxHeight: showAllConditionSamples ? 'none' : '200px',
                                                        overflowY: showAllConditionSamples ? 'visible' : 'auto',
                                                        backgroundColor: '#fafafa',
                                                        padding: 8,
                                                        borderRadius: 4,
                                                        fontSize: 12
                                                    }}>
                                                        {(showAllConditionSamples
                                                            ? selectedConditionSamples
                                                            : selectedConditionSamples.slice(0, 10)
                                                        ).map((sample, idx) => (
                                                            <div key={idx} style={{ padding: '2px 0' }}>
                                                                • {sample}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {selectedConditionSamples.length > 10 && (
                                                        <Button
                                                            type="link"
                                                            size="small"
                                                            onClick={() => setShowAllConditionSamples(!showAllConditionSamples)}
                                                            style={{ padding: '4px 0', fontSize: 12 }}
                                                        >
                                                            {showAllConditionSamples
                                                                ? 'Show less'
                                                                : `Show more (${selectedConditionSamples.length - 10} more)`}
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </Space>
                                    </Card>
                                </Col>
                            </Row>

                            {/* Preview DE Button */}
                            {selectedControlSamples.length > 0 && selectedConditionSamples.length > 0 && (
                                <div style={{ textAlign: 'center', marginTop: 16 }}>
                                    <Space>
                                        <Button
                                            type="default"
                                            icon={isPreviewingDE || !(volcanoPlotData && volcanoPlotData.length > 0)
                                                ? <ThunderboltOutlined />
                                                : <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                                            loading={isPreviewingDE}
                                            disabled={isPreviewingDE}
                                            onClick={handlePreviewDE}
                                        >
                                            {(volcanoPlotData && volcanoPlotData.length > 0)
                                                ? 'Re-run DE Preview'
                                                : 'Preview DE Genes (Optional)'}
                                        </Button>
                                        {(!isPreviewingDE && volcanoPlotData && volcanoPlotData.length > 0) && (
                                            <Button
                                                type="primary"
                                                icon={<EyeOutlined />}
                                                onClick={() => setShowVolcanoModal(true)}
                                            >
                                                View Volcano Plot
                                            </Button>
                                        )}
                                    </Space>
                                    {/* Loading + status feedback below the button */}
                                    {isPreviewingDE ? (
                                        <div style={{ marginTop: 12 }}>
                                            <Spin size="small" />
                                            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                                                Running differential expression analysis…
                                            </Text>
                                        </div>
                                    ) : (volcanoPlotData && volcanoPlotData.length > 0) ? (
                                        <div style={{ marginTop: 8 }}>
                                            <Text type="success" style={{ fontSize: 12 }}>
                                                <CheckCircleOutlined style={{ marginRight: 4 }} />
                                                Differential expression analysis completed — {countDeGenes(volcanoPlotData, { maxAdjustedPValue, minLogFoldChange })} DE genes found.
                                            </Text>
                                        </div>
                                    ) : null}
                                    <div style={{ marginTop: 8 }}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            Optional: Run this now to preview differentially expressed genes, or skip and it will run automatically in Step 5.
                                        </Text>
                                    </div>
                                </div>
                            )}

                            {/* Volcano plot preview modal — view the DE result without leaving Step 2 */}
                            <Modal
                                title="Volcano Plot — Preview of DE Genes"
                                open={showVolcanoModal}
                                onCancel={() => setShowVolcanoModal(false)}
                                footer={null}
                                width={800}
                                destroyOnClose
                            >
                                {volcanoPlotData && volcanoPlotData.length > 0 ? (
                                    <>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {countDeGenes(volcanoPlotData, { maxAdjustedPValue, minLogFoldChange })} DE genes
                                            at FDR ≤ {maxAdjustedPValue} and |Log2FC| ≥ {minLogFoldChange}.
                                            Thresholds can be fine-tuned in Step 5.
                                        </Text>
                                        <ReactEcharts
                                            option={getVolcanoOptions(volcanoPlotData, { maxAdjustedPValue, minLogFoldChange })}
                                            style={{ height: '450px', width: '100%', marginTop: 8 }}
                                        />
                                    </>
                                ) : (
                                    <Text type="secondary">No DE preview data available yet.</Text>
                                )}
                            </Modal>
                        </Space>
                    </Card>
                )}
            </Spin>
        );
    };

    if (isLoading) {
        return <Spin />;
    }

    return (
        <div>
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <Title level={3}>Step 2: Configure Data & Organism</Title>
                <Text type="secondary">
                    Select organism, upload/enter your data, and optionally provide metadata
                </Text>
            </div>

            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                {/* Organism Selection */}
                <Card
                    title={
                        <Space>
                            <Text strong>1. Select Organism</Text>
                            {selectedOrg && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                        </Space>
                    }
                    size="small"
                >
                    <Space direction="horizontal" size="middle">
                        <Text>Organism:</Text>
                        <Select
                            showSearch
                            placeholder="Search for organisms"
                            style={{ width: 300 }}
                            onChange={handleOrganismChange}
                            value={selectedOrg}
                            filterOption={(input, option) =>
                                option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                            }
                        >
                            {organisms.map(org => (
                                <Select.Option key={org._id} value={org.taxId}>
                                    {org.name}
                                </Select.Option>
                            ))}
                            <Select.Option key={null} value={null}>Other</Select.Option>
                        </Select>
                        {selectedOrg && <Badge status="success" text="Selected" />}
                    </Space>
                </Card>

                {/* Data Input */}
                <Card
                    title={
                        <Space>
                            <Text strong>2. Upload or Enter Data</Text>
                            {/* onClick is wrapped because handleUseSampleData takes a `variant`;
                                a bare handler reference would pass the click event as it. */}
                            <Button
                                size="small"
                                type="primary"
                                icon={<ThunderboltOutlined />}
                                onClick={() => handleUseSampleData()}
                                loading={isBusy}
                            >
                                Use Sample Data
                            </Button>
                        </Space>
                    }
                    size="small"
                >
                    {inputType === 'ora' && renderORAInput()}
                    {inputType === 'pgsea' && renderPGSEAInput()}
                    {inputType === 'expression' && renderExpressionInput()}
                </Card>

                {/* Gene ID Type Selection */}
                {idTypeConfig?.value && idTypeConfig.value.length > 0 && (
                    <Card
                        title={
                            <Space>
                                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                <Text strong>3. Select Gene ID Type</Text>
                            </Space>
                        }
                        size="small"
                    >
                        <Space direction="vertical" style={{ width: '100%' }}>
                            <Text type="secondary">
                                Gene ID type has been automatically detected. You can change it if needed.
                            </Text>
                            <Space direction="horizontal" size="middle">
                                <Text>Gene ID Type:</Text>
                                <Select
                                    style={{ width: 300 }}
                                    value={detectedIdType}
                                    onChange={async (value) => {
                                        setDetectedIdType(value);
                                        await AnalysisUtils.updateAnalysis({
                                            analysisId,
                                            inputType,
                                            data: { idType: value }
                                        });
                                    }}
                                >
                                    {idTypeConfig.value.map(idType => (
                                        <Select.Option key={idType} value={idType}>
                                            {idType}
                                        </Select.Option>
                                    ))}
                                </Select>
                                <Badge status="success" text="Detected" />
                            </Space>
                        </Space>
                    </Card>
                )}

                {/* Metadata Extraction */}
                <MetadataExtraction
                    analysisId={analysisId}
                    inputType={inputType}
                    onMetadataExtracted={(metadata) => {
                        console.log('Metadata extracted:', metadata);
                    }}
                />
            </Space>
        </div>
    );
};

export default Step2_DataInput;

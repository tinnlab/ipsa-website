import {Meteor} from 'meteor/meteor';
import React, {useEffect, useState, useMemo, useRef, useCallback} from "react";
import Layout from "antd/lib/layout";
import Tabs from "antd/lib/tabs";
import './index.style.less'
import Space from "antd/lib/space";
import Collapse from "antd/lib/collapse";
import {Alert, Descriptions, Radio, Select, TreeSelect, Table, Spin, Progress, Input, Slider, Empty, Tooltip} from "antd";
import _ from "lodash";
import metaAnalysisUtils from "../../../../utils/metaAnalysisUtil";

const {SHOW_PARENT, SHOW_CHILD} = TreeSelect;
import Typography from "antd/lib/typography";
import Button from "antd/lib/button";
import {Link, useLocation, useNavigate, useParams} from "react-router-dom";
import {Helmet} from "react-helmet";
import VolcanoChart from "./components/VolcanoChart";
import ForestChart from "./components/ForestChart";
import NegBarChart from "./components/NegBarChart";
import KeggChart from "./components/KeggChart";
import SelectableResult from "./components/SelectableResult";
import useSubscription from "../../../../hooks/useSubscription";
import {useTracker} from "meteor/react-meteor-data";
import rankPathways from "../../../../utils/rankPathways";
import InputNumber from "antd/lib/input-number";
import Checkbox from "antd/lib/checkbox";
import {Modal} from 'antd';
import settings from "../../../../../methods/settings";
import HeatmapChart from "./components/HeatmapChart";
import FunnelPlotPathway from "./components/FunnelPlotPathway";
import ForestChartMultiAnalysis from "./components/ForestChartMultiAnalysis";
import MeanExpressionChart from "./components/MeanExpressionChart";
import VolcanoChartGene from "./components/VolcanoChartGene";
import VennDiagram from "./components/VennDiagram";
import VennDiagramPathway from "./components/VennDiagramPathway";
import {v4 as uuidv4} from 'uuid';
import HeatMapGene from "./components/HeatMapGene";
import {
    extractSets,
} from "chartjs-chart-venn";
import MetaAnalysisBuilder from "./components/MetaAnalysisBuilder";
import KeggChartMultiAnalysis from "./components/KeggChartMultiAnalysis";
import MultiAnalysisPathwayGraphComponent from "./components/MultiAnalysisPathwayGraphComponent";
import RankPathways from "../../../../utils/rankPathways";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CircosD3Chart from "./components/CircosD3Chart";
import {LoadingOutlined, GroupOutlined, BulbOutlined, QuestionCircleOutlined, HighlightOutlined} from '@ant-design/icons';
// import ChatWidget from "../../../../components/chat-box";
import inViewRender from "../../../../components/in-view-render/inViewRender";
import NavigationSidebar from "./components/NavigationSidebar";
import fetch2 from "/imports/client/utils/fetch";
import AnalysisWizard from "./components/AIForm/AnalysisWizard";
import { InsightDashboard } from "./components/AIForm/InsightComponents";
import useMethod from "../../../../hooks/useMethod";
import AnalysisUtils from "../Session/components/AnalysisUtils";
import GeneLoading from "../../../../components/GeneLoading";
import {resolveInitialAnalysisTab, sectionAnchorId} from "/imports/utils/vizNav";
import {analysisDisplayName} from "/imports/utils/metaAnalysisGeneLevel";
import {hasFunnelData, funnelEmptyStateMessage} from "/imports/utils/funnelPlotMeta";
import {
    computePlotDisplayState,
    computeFetchedPlotState,
    PLOT_STATE_MESSAGES,
} from "/imports/utils/plotDisplayState";
import {extractMethodResults} from "/imports/utils/methodResults";
import {selectConsensusPathwayIds} from "/imports/utils/pathwaySelection";
import {
    buildCircosGraph,
    mapPathwayGenesToSymbols,
    describeGeneSelection,
    DEFAULT_CIRCOS_GENE_TOP_N,
} from "/imports/utils/circosGeneSelect";
import GlobalSettingsPanel from "./components/GlobalSettingsPanel";
import { GlobalSettingsProvider, useGlobalSettings } from "../../../../contexts/GlobalSettingsContext";
import MetadataTable from "./components/MetadataTable";
import useStudyAccess from "../../../../hooks/useStudyAccess";
import StudyAccessDenied from "../../../../components/StudyAccessDenied";
import {isStudyAccessError} from "/imports/utils/ownership";
// Appended at the end of the import block deliberately: PR #184 is still open and edits line 61.
import {buildAIInterpretationLink} from "/imports/utils/aiInterpretationSelection";
import useInputTypePolicy from "/imports/client/hooks/useInputTypePolicy";
import {interpretationUnavailableReason} from "/imports/utils/inputTypePolicy";
import {passesSignificance} from "/imports/utils/significanceFilter";

const inputTypeNames = {
    ora: "ORA",
    pgsea: "Ranked gene list with statistics",
    expression: "Expression"
};

// Keeps a control's label on one line. antd Space lays its children out as flex items, so a
// label that runs out of room breaks INSIDE its own box ("Filter Significant" / "Pathways:")
// rather than pushing the row to wrap. Pair this with `wrap` on the surrounding Space: nowrap
// alone would just trade a broken phrase for a row that overflows horizontally.
const CONTROL_LABEL_STYLE = {whiteSpace: 'nowrap'};

// The study tabs that stay reachable however many analyses a study has. onChange already branched on
// these three literals; naming them once means the pinning and the branching cannot drift apart.
const PINNED_TAB_KEYS = ['meta-analysis', 'ai-powered', 'dataset-metadata'];

const VolcanoChartGeneMemo = React.memo(({
                                             analysis,
                                             sessionId,
                                             config,
                                             handleChangingDESettings
                                         }) => {
    return <VolcanoChartGene
        analysisId={analysis.id}
        sessionId={sessionId}
        config={config}
        handleChangingDESettings={handleChangingDESettings}
    />;
});

const InViewVolcanoChartGeneMemo = inViewRender(VolcanoChartGeneMemo)

const MeanExpressionMemo = React.memo(({analysis, sessionId}) => {
    return <MeanExpressionChart analysisId={analysis.id} sessionId={sessionId}/>;
});

const InViewMeanExpressionMemo = inViewRender(MeanExpressionMemo)

const debouncedUpdateDeSettings = _.debounce(async (settings, sessionId) => {
    if (!settings) return;
    try {
        // Persist the tuned thresholds as the WORKING/view values (live AnalysisConfig only).
        // We deliberately do NOT update AnalysisConfigSnapshot here: the snapshot is the immutable
        // original DE definition, so "Use all DE Genes" can always recover the original DE set no
        // matter how the user tunes the volcano plot. getConfigurations surfaces the live value as
        // config.maxAdjustedPValue (what the volcano shows) and the snapshot value as
        // config.originalMaxAdjustedPValue (what "Use all DE Genes" uses).
        await Meteor.callAsync('analysis.update', {
            analysisId: settings.analysisId,
            inputType: settings.inputType,
            data: {
                maxAdjustedPValue: settings.maxAdjustedPValue,
                minLogFoldChange: settings.minLogFoldChange
            }
        })

        // let args = {
        //     analysisId: settings.analysisId,
        //     sessionId: sessionId,
        // }
        //
        // const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
        // if (!response.ok) {
        //     throw new Error(`HTTP error! status: ${response.status}`);
        // }
        // let resJson = await response.json();
        //
        // if (resJson) {
        //     console.log("resJson", resJson);
        //     let newDEGenes = resJson.filter(
        //         gene => gene.pValueFDR <= settings.maxAdjustedPValue &&
        //             Math.abs(gene.FC) >= settings.minLogFoldChange
        //     );
        //
        //     await Meteor.asyncCallWithNotification('analysis.updateDEGenes', {
        //         analysisId: settings.analysisId,
        //         inputType: settings.inputType,
        //         newDEGenes
        //     })
        //
        //     notify.success('DE Genes updated successfully');
        // }
    } catch (e) {
        console.error("Error updating settings:", e);
    }
}, 2000)

export default (props) => {
    const sessionId = useParams().sessionId;
    const location = useLocation();
    const navigate = useNavigate();
    // Optional analysis the user came from (e.g. "Visualize Results" on analysis 3),
    // so we open its tab instead of always defaulting to the first analysis.
    const initialAnalysisId = useMemo(
        () => new URLSearchParams(location.search).get('analysisId'),
        [location.search]
    );
    // A study imported in "results only" mode is view-only. This component RENDERS the
    // GlobalSettingsProvider rather than living inside it, so it cannot use useGlobalSettings();
    // it reads the same flag straight off the session. Descendants use the context instead.
    // Declared up here because handleChangingDESettings lists it as a hook dependency below —
    // declaring it later would be a temporal-dead-zone reference at render time.
    const isReadOnly = useTracker(() => {
        if (!sessionId) return false;
        const handle = Meteor.subscribe('analysis.session', sessionId);
        if (!handle.ready()) return false;
        return DBCollections.Session.findOne({_id: sessionId})?.readOnly === true;
    }, [sessionId]);

    // For a non-owner the REST call behind resultGroupedDbAll answers 403, so fetchAnalyses
    // early-returns on its empty-keys guard and visualization.getConfigurations is never even
    // called — initialDataLoaded stays false and GeneLoading spins forever. One guarded method
    // gives the verdict directly.
    const {accessDenied} = useStudyAccess(sessionId);

    const [sessionName, setSessionName] = useState("");
    const [analyses, setAnalyses] = useState([]);
    const [results, setResults] = useState([]);
    const [configs, setConfigs] = useState([]);
    const [dbs, setDbs] = useState([]);
    const [DEMetaResults, setDEMetaResults] = useState([]);
    const [pathwayMetaResults, setPathwayMetaResults] = useState([]);
    const [metaAnalyses, setMetaAnalyses] = useState([]);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [initialDataLoaded, setInitialDataLoaded] = useState(false);
    const [resultGroupedDbAll, setResultGroupedDbAll] = useState([]);
    const [currentMethod, setCurrentMethod] = useState(new Map())
    const [currentAnalysisId, setCurrentAnalysisId] = useState('');
    const [selectedDatasets, setSelectedDatasets] = useState(new Map());
    const [circosDisplayPathways, setCircosDisplayPathways] = useState(5);
    // A TARGET, not a hard ceiling: the Circos selection raises it when needed so that every
    // displayed pathway with a DE gene keeps one, and so highlighted genes are never dropped.
    // The control is labelled and captioned accordingly (see the Circos tab below).
    //
    // Two pieces of state on purpose. `circosGeneInput` is what the field shows and may be
    // null mid-edit (antd fires onChange(null) when the box is cleared); `circosDisplayGenes`
    // is the committed value the charts read. Committing is debounced because antd Tabs keeps
    // every visited pane mounted, so an uncommitted keystroke would tear down and redraw the
    // d3 chart — reallocating a dense (P+G)² matrix — in every one of them.
    const [circosGeneInput, setCircosGeneInput] = useState(DEFAULT_CIRCOS_GENE_TOP_N);
    const [circosDisplayGenes, setCircosDisplayGenes] = useState(DEFAULT_CIRCOS_GENE_TOP_N);
    const commitCircosGeneTarget = useMemo(
        () => _.debounce((n) => setCircosDisplayGenes(n), 400),
        []
    );
    const [pathwayPValueFDRThres, setPathwayPValueFDRThres] = useState(0.05)

    // Add grouping state
    const [groupedAnalyses, setGroupedAnalyses] = useState([]);
    const [activeTabKey, setActiveTabKey] = useState(null);
    // Which pinned panes have ever been opened. antd no longer mounts them, so this is what keeps a
    // pane alive (hidden, not unmounted) after the user looks at something else — the same rule
    // TabPanelList applies, and the reason switching tabs does not reset the meta-analysis builder.
    const [mountedPinnedKeys, setMountedPinnedKeys] = useState([]);

    // 1. Handle tab change callback - always declared
    const handleGroupTabChange = useCallback((targetKey) => {
        setCurrentAnalysisId(targetKey);
    }, []);

    // 2. Handle scatter point click callback - always declared
    const handleScatterPointClick = useCallback(async (label) => {
        console.log('Clicked on scatter point with label in visualization:', label);
        const templateName = 'pathwayDetails';
        const textValue = label;

        // Queues an LLM job against the study, so it is a write — not available on a view-only
        // import. The server refuses it too.
        if (isReadOnly) return;

        try {
            // sessionId is required: the queued LlmQueue row is stamped with it, and the method
            // checks that the caller owns that study. It was previously omitted, so every row was
            // written with sessionId undefined and could not be attributed to any study.
            let msg = await Meteor.asyncCallWithNotification('llm.addJob', {
                templateName,
                textValue,
                sessionId
            })
            // notify.success("Insert Successfully.")
        } catch (e) {
            // do nothing
        }
    }, [sessionId, isReadOnly]);

    // 3. Handle changing DE settings callback - always declared
    const handleChangingDESettings = useCallback(async (key, value, analysisId) => {
        let tmpConfig = configs.filter(config => config.analysisId === analysisId)[0];
        const tmpSettings = {
            analysisId: analysisId,
            inputType: tmpConfig.inputType,
            maxAdjustedPValue: tmpConfig.maxAdjustedPValue,
            minLogFoldChange: tmpConfig.minLogFoldChange
        }

        tmpSettings[key] = value;
        setConfigs(configs.map((config, index) => {
            if (config.analysisId === analysisId) {
                return {
                    ...config,
                    [key]: value
                }
            }
            return config;
        }))

        // On a view-only imported study the retune stays in local state above: the charts and the
        // DE-gene filtering update exactly as they do for an owner, but nothing is persisted.
        // The gate lives here rather than inside debouncedUpdateDeSettings because that debounce is
        // a module-level singleton with no access to component state. The server rejects the write
        // too — this just avoids firing a call that is guaranteed to fail.
        if (!isReadOnly) {
            debouncedUpdateDeSettings(tmpSettings, sessionId);
        }
    }, [configs, sessionId, isReadOnly]);

    // 4. Analyses object memo - always declared
    const analysesObj = useMemo(() => {
        return analyses.reduce((acc, curr) => {
            acc[curr.id] = curr;
            return acc;
        }, {});
    }, [analyses]);

    // Biological Interpretation gating (imports/utils/inputTypePolicy.js). Each analysis that
    // cannot be interpreted is listed with its reason; the entry point is disabled only when
    // nothing in the study can be. The AI-interpretation page and the server apply the same rules.
    const {interpretationBlockedInputTypes} = useInputTypePolicy();
    const interpretationGate = useMemo(() => {
        const configById = new Map(configs.map(c => [c.analysisId, c]));
        const unavailable = analyses
            .map(a => ({
                name: a.name,
                reason: interpretationUnavailableReason({
                    inputType: a.input || configById.get(a.id)?.inputType,
                    hasGeneResults: configById.get(a.id)?.hasGeneResults
                }, interpretationBlockedInputTypes)
            }))
            .filter(a => a.reason);
        const nothingInterpretable = analyses.length > 0 && unavailable.length === analyses.length &&
            (metaAnalyses || []).length === 0;
        const reasons = _.uniq(unavailable.map(a => a.reason));
        return {
            unavailable,
            disabledReason: !nothingInterpretable ? null
                : reasons.length === 1 ? reasons[0]
                    : 'No analysis in this study has gene-level statistics, so hypotheses cannot be grounded.'
        };
    }, [analyses, configs, metaAnalyses, interpretationBlockedInputTypes]);

    // 4.5 Get session data for metadata - always declared
    const analysesTracking = useTracker(() => {
        const handle = Meteor.subscribe('analysis.session', sessionId);
        if (!handle.ready()) {
            return null;
        }

        return DBCollections.Session.find({_id: sessionId}).fetch();
    }, [sessionId]);

    // 4.6 Extract metadata from analyses - always declared
    const analysesMetadata = useMemo(() => {
        if (!analysesTracking || analysesTracking.length === 0) return {};

        const session = analysesTracking[0];
        const metadata = {};

        // Build metadata map from session analyses
        if (session.analyses) {
            session.analyses.forEach(analysis => {
                if (analysis.metadata && analysis.metadata.extracted) {
                    metadata[analysis.name] = analysis.metadata.extracted;
                }
            });
        }

        console.log('[Visualization] Extracted metadata for', Object.keys(metadata).length, 'analyses');
        return metadata;
    }, [analysesTracking]);

    // 5. Create stable grouping logic - always declared
    const groupingData = useMemo(() => {
        if (!analyses || analyses.length === 0) {
            return {
                massAnalyses: [],
                ungroupedMassAnalyses: [],
                regularAnalyses: [],
                groupedMassAnalysesForTabs: []
            };
        }

        const grouped = [];
        const ungrouped = [];
        const regular = [];

        analyses.forEach(analysis => {
            if (analysis.isMassAnalysis) {
                if (analysis.groupId && !analysis.isUngrouped) {
                    grouped.push(analysis);
                } else {
                    ungrouped.push(analysis);
                }
            } else {
                regular.push(analysis);
            }
        });

        // Group mass analyses by their groupId
        const groups = {};
        grouped.forEach(analysis => {
            const groupKey = analysis.groupId;
            if (!groups[groupKey]) {
                const groupInfo = groupedAnalyses.find(g => g.groupId === groupKey);
                groups[groupKey] = {
                    groupId: groupKey,
                    groupName: groupInfo?.groupName || analysis.groupName || 'Ungrouped',
                    inputType: analysis.input,
                    groupColor: analysis.groupColor,
                    analyses: []
                };
            }
            groups[groupKey].analyses.push(analysis);
        });

        return {
            massAnalyses: grouped,
            ungroupedMassAnalyses: ungrouped,
            regularAnalyses: [...regular, ...ungrouped],
            groupedMassAnalysesForTabs: Object.values(groups)
        };
    }, [analyses, groupedAnalyses]);

    // 6. Helper function to find which group an analysis belongs to - always declared
    const findAnalysisGroup = useCallback((analysisId) => {
        if (!analysisId) return null;

        const serverGroup = groupedAnalyses.find(group =>
            group.analyses && group.analyses.some(analysis => analysis.id === analysisId)
        );
        if (serverGroup) return serverGroup;

        return groupingData.groupedMassAnalysesForTabs.find(group =>
            group.analyses && group.analyses.some(analysis => analysis.id === analysisId)
        );
    }, [groupedAnalyses, groupingData.groupedMassAnalysesForTabs]);

    // 7. Check if current active analysis is in a group - always declared
    const currentAnalysisGroup = useMemo(() => {
        return findAnalysisGroup(currentAnalysisId);
    }, [currentAnalysisId, findAnalysisGroup]);

    // 8. Create collapse items helper - always declared
    const createCollapseItems = useCallback((analysis, config) => {
        if (!config || !analysis) return [];

        return [
            {
                key: "1",
                label: "Summary",
                children: (
                    <div id={sectionAnchorId('summary', analysis.id)} style={{scrollMarginTop: '100px'}}>
                        <Descriptions title="Summary of selected input" bordered
                                      size={"small"} layout={"vertical"} key={uuidv4()}>
                            <Descriptions.Item
                                label={"Input Type"}>{inputTypeNames[config.inputType]}</Descriptions.Item>
                            {config.inputType !== "expression" ? (
                                <Descriptions.Item
                                    label={"Number of input genes"}>{config.inputCount}</Descriptions.Item>
                            ) : null}
                            {config.inputType === "ora" ? (
                                <Descriptions.Item
                                    label={"Number of background genes"}>{config.backgroundCount}</Descriptions.Item>
                            ) : null}
                            {config.inputType === "expression" ? (
                                <Descriptions.Item
                                    label={"Selected expression file"}>{config.expressionFile}</Descriptions.Item>
                            ) : null}
                            {config.inputType === "expression" && config.groupFile ? (
                                <Descriptions.Item
                                    label={"Selected group file"}>{config.groupFile}</Descriptions.Item>
                            ) : null}
                            <Descriptions.Item
                                label={"Gene ID type"}>{config.idType}</Descriptions.Item>
                        </Descriptions>
                        {config.inputType === "expression" ? (
                            <Descriptions title="Sample Space" bordered size={"small"}
                                          layout={"vertical"} key={uuidv4()}>
                                <Descriptions.Item
                                    label={"Number of controls"}>{config.selectedControlSamplesCount}</Descriptions.Item>
                                {config.selectedConditionSamplesCount ? (
                                    <Descriptions.Item
                                        label={"Number of conditions"}>{config.selectedConditionSamplesCount}</Descriptions.Item>
                                ) : null}
                            </Descriptions>
                        ) : null}
                        <Descriptions title="Selected organism and pathways" bordered
                                      size={"small"} layout={"vertical"} key={uuidv4()}>
                            {
                                (selectedDatasets.get(analysis.id) ?? []).map(dbId => {
                                    const geneSet = config.geneSets?.filter(geneSet => geneSet.id === dbId)[0];
                                    if (!geneSet) return null;
                                    return (
                                        <Descriptions.Item
                                            label={`Database ${geneSet.namespace ? `${geneSet.name} (${geneSet.namespace})` : geneSet.name}`}
                                            key={uuidv4()}>
                                            Number of gene sets: {geneSet.geneSetsCount}
                                        </Descriptions.Item>
                                    )
                                })
                            }
                            <Descriptions.Item
                                label={"Organism"}>{config.organismName}</Descriptions.Item>
                        </Descriptions>
                        <Descriptions title="Selected methods" bordered size={"small"}
                                      layout={"vertical"} key={uuidv4()}>
                            {Object.entries(config.methods ?? {}).map(([key, value]) => (
                                <React.Fragment key={key}>
                                    {value.enabled && (
                                        <Descriptions.Item
                                            label={settings.getMethodName(key)}>
                                            {Object.entries(value).map(([k, v]) => {
                                                    if (k !== 'enabled') {
                                                        if (key === 'consensus' && k === 'methods') {
                                                            return (
                                                                <Typography.Text key={k}>
                                                                    {settings.getParamName(key, k)}: {v.map(i => i.toUpperCase()).join(', ')}
                                                                </Typography.Text>
                                                            )
                                                        } else {
                                                            // getOptionLabel maps enum values (e.g. consensus_method,
                                                            // rankBy) to friendly labels and safely falls back to the
                                                            // raw value for everything else.
                                                            return (
                                                                <Typography.Text
                                                                    key={k}>{settings.getParamName(key, k)}: {settings.getOptionLabel(key, k, v)}</Typography.Text>
                                                            )
                                                        }
                                                    } else {
                                                        return null
                                                    }
                                                }
                                            )}
                                        </Descriptions.Item>
                                    )}
                                </React.Fragment>
                            ))}
                        </Descriptions>
                    </div>
                )
            },
            // pgsea: only when analysis.start derived gene-level rows from a fold-change +
            // p-value upload (hasGeneResults = non-empty volcanoPlotData snapshot).
            config.inputType === "expression" ||
            (config.inputType === "pgsea" && config.hasGeneResults)
                ? {
                    key: "2",
                    label: "Gene Volcano Plot",
                    children: (
                        <div id={sectionAnchorId('gene-volcano', analysis.id)} style={{scrollMarginTop: '100px'}}>
                            <InViewVolcanoChartGeneMemo
                                analysis={analysis}
                                sessionId={sessionId}
                                config={config}
                                handleChangingDESettings={handleChangingDESettings}
                            />
                        </div>
                    ),
                }
                : null,
            config.inputType === "expression"
                ? {
                    key: "4",
                    label: "Circos Plot",
                    children: (
                        <div id={sectionAnchorId('circos', analysis.id)} style={{scrollMarginTop: '100px'}}>
                            <Space direction={'vertical'} style={{width: '100%'}}>
                            {/* Same treatment as the pathway row below. This row is not part of
                                the #180 regression — it has always held three groups — but it
                                fragments identically below ~1024px, and leaving it untreated
                                directly above a fixed row would look arbitrary. */}
                            <Space wrap style={{marginBottom: '10px'}}>
                                <Typography.Text strong style={CONTROL_LABEL_STYLE}>Filter DE Genes:</Typography.Text>
                                <Space>
                                    <Typography.Text style={CONTROL_LABEL_STYLE}>{'pValue.FDR ≤'}</Typography.Text>
                                    <Input
                                        type="number"
                                        onChange={async (e) => {
                                            await handleChangingDESettings('maxAdjustedPValue', e.target.value, config.analysisId)
                                        }}
                                        value={config.maxAdjustedPValue ?? 0.05}
                                    />
                                </Space>
                                <Space>
                                    <Typography.Text style={CONTROL_LABEL_STYLE}>{'Absolute Log2FC ≥'}</Typography.Text>
                                    <Input
                                        type="number"
                                        onChange={async (e) => {
                                            await handleChangingDESettings('minLogFoldChange', e.target.value, config.analysisId)
                                        }}
                                        value={config.minLogFoldChange ?? 0.5}
                                    />
                                </Space>
                            </Space>
                            {/* `wrap`: this row carries four control groups, so on a narrow
                                viewport it has to break BETWEEN groups. Without it the groups
                                compress instead and every label fragments mid-phrase. */}
                            <Space wrap>
                                <Typography.Text strong style={CONTROL_LABEL_STYLE}>Filter Significant Pathways:</Typography.Text>
                                <Space>
                                    <Typography.Text style={CONTROL_LABEL_STYLE}>{'pValue.FDR ≤'}</Typography.Text>
                                    <Input
                                        type={"number"}
                                        onChange={(e) => {
                                            setPathwayPValueFDRThres(e.target.value)
                                        }}
                                        value={pathwayPValueFDRThres}
                                    />
                                </Space>
                                <Space>
                                    <Typography.Text style={CONTROL_LABEL_STYLE}>Number of pathways to display:</Typography.Text>
                                    <Input
                                        type="number"
                                        onChange={(e) => {
                                            if (e.target.value <= 0) {
                                                setCircosDisplayPathways(1)
                                            } else {
                                                setCircosDisplayPathways(e.target.value)
                                            }
                                        }}
                                        value={circosDisplayPathways}
                                    />
                                </Space>
                                <Space>
                                    <Typography.Text style={CONTROL_LABEL_STYLE}>Target number of genes:</Typography.Text>
                                    {/* InputNumber, not the neighbouring `Input type="number"`:
                                        that one clamps with `e.target.value <= 0`, which is also
                                        true for the empty string, and lets "abc" through to
                                        `slice(0, "abc")`. Here min/max bound the committed value
                                        and normalizeGeneCap guards the util regardless.
                                        The field keeps whatever the user typed — including the
                                        empty box antd reports as null — and only a usable number
                                        is committed, so clearing to retype does not snap to 1. */}
                                    <InputNumber
                                        min={1}
                                        max={2000}
                                        value={circosGeneInput}
                                        onChange={(v) => {
                                            setCircosGeneInput(v);
                                            if (typeof v === 'number' && v >= 1) {
                                                commitCircosGeneTarget(Math.floor(v));
                                            }
                                        }}
                                        style={{width: 90}}
                                    />
                                    <Tooltip
                                        title={'A target, not a hard limit. Genes are ranked by pValue.FDR, but the plot will show more than the target when it needs to: highlighted genes are never dropped, and every displayed pathway that has a differentially expressed gene keeps at least one. The caption under each plot says when that happened.'}
                                    >
                                        {/* tabIndex so the explanation is reachable by keyboard —
                                            this control's correctness depends on it being read. */}
                                        <QuestionCircleOutlined style={{color: '#8c8c8c'}} tabIndex={0}/>
                                    </Tooltip>
                                </Space>
                            </Space>
                            <CircosTabs
                                sessionId={sessionId}
                                analysis={analysis}
                                selectedDatasets={selectedDatasets}
                                config={config}
                                currentMethod={currentMethod}
                                setCurrentMethod={setCurrentMethod}
                                handleChangingDESettings={handleChangingDESettings}
                                circosDisplayPathways={circosDisplayPathways}
                                circosDisplayGenes={circosDisplayGenes}
                                pathwayPValueFDRThres={pathwayPValueFDRThres}
                            />
                        </Space>
                        </div>
                    )
                }
                : null,
            {
                key: "5",
                label: "Pathway Volcano Plot",
                children: (
                    <div id={sectionAnchorId('pathway-volcano', analysis.id)} style={{scrollMarginTop: '100px'}}>
                        <VolcanoChartTabs
                            sessionId={sessionId}
                            analysis={analysis}
                            selectedDatasets={selectedDatasets}
                            config={config}
                            handleScatterPointClick={handleScatterPointClick}
                            currentMethod={currentMethod}
                            setCurrentMethod={setCurrentMethod}
                        />
                    </div>
                )
            },
            {
                key: "6",
                label: "Forest Plot",
                children: (
                    <div id={sectionAnchorId('forest', analysis.id)} style={{scrollMarginTop: '100px'}}>
                        <Tabs
                            defaultActiveKey="0"
                            type={"card"}
                            onChange={(activeKey) => {
                            }}
                            items={
                            (selectedDatasets.get(analysis.id) ?? []).map(key => {
                                const geneSet = config.geneSets?.filter(g => g.id === key)[0]
                                if (!geneSet) return null;
                                return {
                                    label: geneSet.name + (geneSet.namespace !== undefined ? ` (${geneSet.namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                    key: geneSet.id,
                                    children: (
                                        <InViewForestChartTable
                                            analysisId={analysis.id}
                                            inputType={config.inputType}
                                            geneSet={geneSet}
                                            key={geneSet.id}
                                            sessionId={sessionId}
                                            selectType='checkbox'
                                            onForestPointClick={handleScatterPointClick}
                                        ></InViewForestChartTable>
                                    )
                                }
                            }).filter(item => item !== null)
                        }
                    />
                    </div>
                )
            },
            {
                key: "7",
                label: "Bar Plot",
                children: (
                    <div id={sectionAnchorId('bar', analysis.id)} style={{scrollMarginTop: '100px'}}>
                        <Tabs
                            defaultActiveKey="0"
                            type={"card"}
                            onChange={(activeKey) => {
                            }}
                            items={
                            (selectedDatasets.get(analysis.id) ?? []).map(key => {
                                const geneSet = config.geneSets?.filter(g => g.id === key)[0]
                                if (!geneSet) return null;
                                return {
                                    label: geneSet.name + (geneSet.namespace !== undefined ? ` (${geneSet.namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                    key: geneSet.id,
                                    children: (
                                        <InViewNegBarChartTable
                                            analysisId={analysis.id}
                                            inputType={config.inputType}
                                            geneSet={geneSet}
                                            sessionId={sessionId}
                                            selectType='checkbox'
                                            onBarPointClick={handleScatterPointClick}
                                            key={uuidv4()}
                                        ></InViewNegBarChartTable>
                                    )
                                }
                            }).filter(item => item !== null)
                        }
                    />
                    </div>
                )
            },
            {
                key: "8",
                label: "KEGG Pathway Map",
                children: (
                    <div id={sectionAnchorId('kegg', analysis.id)} style={{scrollMarginTop: '100px'}}>
                        {(selectedDatasets.get(analysis.id) ?? []).map(key => {
                        const geneSet = config.geneSets?.filter(g => g.id === key)[0]
                        if (!geneSet) return null;
                        return (
                            <KEGGMap analysisId={analysis.id}
                                     inputType={config.inputType}
                                     sessionId={sessionId}
                                     genesMappedInput={config.genesMappedInput}
                                     genesMappedBackground={config.genesMappedBackground}
                                     selectType='radio'
                                     geneSet={geneSet}
                                     inputData={config.inputData}
                                     key={uuidv4()}
                                     config={config}
                            />
                        )
                    })}
                    </div>
                )
            },
            {
                key: "9",
                label: "Pathway Network",
                children: (
                    <div id={sectionAnchorId('pathway-network', analysis.id)} style={{scrollMarginTop: '100px'}}>
                        <Tabs
                            defaultActiveKey="0"
                            type={"card"}
                            onChange={(activeKey) => {
                            }}
                            items={
                            (selectedDatasets.get(analysis.id) ?? []).map(key => {
                                const geneSet = config.geneSets?.filter(g => g.id === key)[0]
                                if (!geneSet) return null;
                                return {
                                    label: geneSet.name + (geneSet.namespace !== undefined ? ` (${geneSet.namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                    key: geneSet.id,
                                    children: (
                                        <InViewPathwayGraphComponentTable
                                            analyses={analysesObj} configs={config}
                                            dbId={geneSet.id}
                                            sessionId={sessionId}
                                            analysisId={analysis.id}
                                            inputType={config.inputType}
                                        />
                                    )
                                }
                            }).filter(item => item !== null)
                        }
                    />
                    </div>
                )
            }
        ].filter(item => item !== null);
    }, [sessionId, selectedDatasets, handleScatterPointClick, currentMethod, setCurrentMethod, handleChangingDESettings, circosDisplayPathways, circosDisplayGenes, circosGeneInput, commitCircosGeneTarget, pathwayPValueFDRThres, analysesObj]);

    // 9. Create ALL tab items in one stable useMemo - always declared
    const allTabItems = useMemo(() => {
        if (analyses.length === 0 || configs.length === 0) {
            return [];
        }

        // Regular tab items (including ungrouped mass analyses)
        const regularItems = groupingData.regularAnalyses.map((analysis, index) => {
            const id = String(index + 1);
            const config = configs.find(config => config && config.analysisId === analysis.id);

            if (!config) {
                return null;
            }

            return {
                label: (
                    <span style={{
                        color: analysis.groupColor || 'inherit',
                        fontWeight: analysis.isMassAnalysis ? 'bold' : 'normal'
                    }}>
                        {analysis.isMassAnalysis && '📊 '}{analysis.name}
                    </span>
                ),
                key: id,
                children: (
                    <Collapse
                        defaultActiveKey={["1", "2", "3", "4", "5", "6", "7", "8", "9"]}
                        type={"card"}
                        items={createCollapseItems(analysis, config)}
                    />
                )
            };
        }).filter(item => item !== null);

        // Group tab items
        const groupItems = groupingData.groupedMassAnalysesForTabs.map(group => {
            const isGroupActive = group.analyses.some(analysis => analysis.id === currentAnalysisId);

            if (isGroupActive) {
                const groupTabItems = group.analyses.map(analysis => {
                    const config = configs.find(config => config && config.analysisId === analysis.id);
                    if (!config) return null;

                    return {
                        key: analysis.id,
                        label: (
                            <span style={{
                                color: group.groupColor || 'inherit',
                                fontWeight: 'bold'
                            }}>
                                📊 {analysis.name}
                            </span>
                        ),
                        children: (
                            <Collapse
                                defaultActiveKey={["1", "2", "3", "4", "5", "6", "7", "8", "9"]}
                                type={"card"}
                                items={createCollapseItems(analysis, config)}
                            />
                        )
                    };
                }).filter(item => item !== null);

                return {
                    key: `group_${group.groupId}`,
                    label: (
                        <span>
                            <GroupOutlined style={{marginRight: 4}}/>
                            {group.groupName}
                        </span>
                    ),
                    children: (
                        <div>
                            <Space direction="vertical" style={{width: '100%', marginBottom: 16}}>
                                <Typography.Text type="secondary">
                                    Group: {group.groupName} ({group.analyses.length} analyses)
                                </Typography.Text>
                            </Space>
                            <Tabs
                                type="card"
                                size="small"
                                onChange={handleGroupTabChange}
                                activeKey={currentAnalysisId}
                                items={groupTabItems}
                                tabBarGutter={4}
                            />
                        </div>
                    )
                };
            } else {
                return {
                    key: `group_${group.groupId}`,
                    label: (
                        <span>
                            <GroupOutlined style={{marginRight: 4}}/>
                            {group.groupName}
                            <span style={{
                                marginLeft: 8,
                                fontSize: '12px',
                                color: '#666',
                                fontWeight: 'normal'
                            }}>
                                ({group.analyses.length})
                            </span>
                        </span>
                    ),
                    children: (
                        <div style={{
                            padding: '40px',
                            textAlign: 'center',
                            color: '#666',
                            backgroundColor: '#fafafa',
                            border: '1px dashed #d9d9d9',
                            borderRadius: '6px'
                        }}>
                            <Typography.Text type="secondary">
                                Click to view analyses in this group
                            </Typography.Text>
                        </div>
                    )
                };
            }
        });

        return [...regularItems, ...groupItems];
    }, [groupingData.regularAnalyses, groupingData.groupedMassAnalysesForTabs, configs, currentAnalysisId, createCollapseItems, handleGroupTabChange]);

    // Add this effect after the allTabItems useMemo
    useEffect(() => {
        if (allTabItems.length > 0 && !activeTabKey) {
            // If we arrived from a specific regular analysis (e.g. "Visualize Results"
            // on analysis 3), open its tab instead of the first one.
            if (initialAnalysisId &&
                groupingData.regularAnalyses.some(a => a.id === initialAnalysisId)) {
                const {tabKey, analysisId} = resolveInitialAnalysisTab({
                    regularAnalyses: groupingData.regularAnalyses,
                    analysisId: initialAnalysisId,
                });
                setActiveTabKey(tabKey);
                setCurrentAnalysisId(analysisId);
                return;
            }

            const firstTabKey = allTabItems[0].key;
            setActiveTabKey(firstTabKey);

            // Also set the currentAnalysisId appropriately
            if (firstTabKey.startsWith('group_')) {
                const groupId = firstTabKey.replace('group_', '');
                const group = groupingData.groupedMassAnalysesForTabs.find(g => g.groupId === groupId);
                if (group && group.analyses.length > 0) {
                    setCurrentAnalysisId(group.analyses[0].id);
                }
            } else if (firstTabKey !== 'meta-analysis' && firstTabKey !== 'ai-powered') {
                // Regular analysis tab
                const analysisIndex = parseInt(firstTabKey) - 1;
                if (analysisIndex >= 0 && analysisIndex < groupingData.regularAnalyses.length) {
                    setCurrentAnalysisId(groupingData.regularAnalyses[analysisIndex].id);
                }
            }
        }
    }, [allTabItems, activeTabKey, groupingData, initialAnalysisId]);
    // END OF HOOKS SECTION

    const handleFetchResultGroupedByDbAll = async () => {
        console.log('[META-TAB] Fetching resultGroupedByDbAll...');
        let args = {
            sessionId,
            fetchTime: new Date().getTime()
        }
        try {
            const response = await fetch2(`/api/resultsGroupedByDbAll?args=${btoa(JSON.stringify(args))}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            let resJson = await response.json();
            console.log('[META-TAB] Result:', Object.keys(resJson).length, 'databases');
            setResultGroupedDbAll(resJson);
        } catch (error) {
            console.error("[META-TAB] Error fetching data:", error)
        }
    }

    // analysesTracking is already defined at line 218 - reuse it here
    const sessionMetaAnalyses = useMemo(() => {
        return analysesTracking?.[0]?.metaAnalyses || []
    }, [analysesTracking])

    useEffect(() => {
        handleFetchResultGroupedByDbAll();
    }, [sessionMetaAnalyses])

    // Get grouped analyses for mass analysis
    useEffect(() => {
        if (sessionId) {
            Meteor.callAsync('massAnalysis.getGroupedAnalyses', {sessionId})
                .then(setGroupedAnalyses)
                .catch(error => {
                    console.error('Error fetching grouped analyses:', error);
                    setGroupedAnalyses([]);
                });
        }
    }, [sessionId, analyses]);

    // useEffect(() => {
    //     console.log("resultGroupedDbAll", resultGroupedDbAll);
    // }, [resultGroupedDbAll]);
    // useEffect(() => {
    //     console.log("Changed Analyses")
    // }, [analyses])

    const metaAnalysisTypes = ["DE", "Pathway"]
    const metaAnalysisLabel = {
        "DE": "Gene-Level",
        "Pathway": "Pathway-Level"
    }

    const fetchAnalyses = useCallback(() => {
        console.log('[FETCH-ANALYSES] Called with resultGroupedDbAll keys:', Object.keys(resultGroupedDbAll).length);
        console.log('[FETCH-ANALYSES] Early return?', Object.keys(resultGroupedDbAll).length < 1);
        if (Object.keys(resultGroupedDbAll).length < 1) return;
        console.log('[FETCH-ANALYSES] Calling visualization.getConfigurations...');
        Meteor.callAsync("visualization.getConfigurations", {sessionId})
            .then(({analyses, allConfigs}) => {
                const configsRes = Object.values(allConfigs);
                console.log('[FETCH-ANALYSES] Received configs:', configsRes.length, 'analyses:', analyses.length);
                setConfigs(configsRes.filter(config => config.analysisId));
                if (resultGroupedDbAll && Object.keys(resultGroupedDbAll).length > 0) {
                    const availableAnalysisIds = new Set(Object.keys(resultGroupedDbAll).map(key => {
                        const tmpDb = resultGroupedDbAll[key]
                        return tmpDb.map(db => db.analysisId)
                    }).flat())
                    analyses = analyses.filter(analysis => Array.from(availableAnalysisIds).includes(analysis.id))
                }
                console.log('[FETCH-ANALYSES] Setting analyses:', analyses.length);
                setAnalyses(analyses);
                setInitialDataLoaded(true); // Mark that initial data has loaded
            })
            .catch(error => {
                console.error("[FETCH-ANALYSES] Error fetching configurations:", error);
            });
    }, [sessionId, resultGroupedDbAll])

    useEffect(() => {
        if (analyses.length > 0) {
            const target = initialAnalysisId && analyses.find(a => a.id === initialAnalysisId);
            setCurrentAnalysisId(target ? target.id : analyses[0].id)
        }
    }, [analyses, initialAnalysisId]);

    useEffect(() => {
        fetchAnalyses();
    }, [sessionId, sessionMetaAnalyses, resultGroupedDbAll]);

    useEffect(() => {
        Meteor.asyncCallWithNotification("visualization.getDatabases", {sessionId}).then((dbsData) => {
            setDbs(dbsData);
        });
    }, [sessionId]);

    // The three meta calls below are ownership-guarded, so a stranger who opens a copied URL would
    // otherwise get three red toasts stacked on top of the access-denied page — plus three unhandled
    // rejections, since asyncCallWithNotification notifies AND rethrows and none of them had a
    // .catch. Only the ownership codes are swallowed; every other failure still toasts its reason
    // exactly as before. Resolving to null on failure lets each .then short-circuit.
    // Deliberately not gated on the access probe: gating would delay these calls for legitimate
    // owners by a whole round-trip, serialising a load that is parallel today.
    const callGuardedViz = useCallback((method) => (
        Meteor.callAsync(method, {sessionId}).catch((error) => {
            if (!isStudyAccessError(error)) notify.error(error.reason);
            return null;
        })
    ), [sessionId]);

    useEffect(() => {
        let metaAnalysesLoaded = false;
        let deMetaResultsLoaded = false;
        let pathwayMetaResultsLoaded = false;

        callGuardedViz("visualization.getMetaAnalyses").then((analysesData) => {
            if (!analysesData) return;
            setMetaAnalyses(analysesData);
            metaAnalysesLoaded = true;
            checkAllLoaded();
        });

        callGuardedViz("visualization.getDEMetaResults").then((metaResultsData) => {
            if (!metaResultsData) return;
            setDEMetaResults(metaResultsData);
            deMetaResultsLoaded = true;
            checkAllLoaded();
        });

        callGuardedViz("visualization.getPathwayMetaResults").then((metaResultsData) => {
            if (!metaResultsData) return;
            setPathwayMetaResults(metaResultsData);
            pathwayMetaResultsLoaded = true;
            checkAllLoaded();
        });

        function checkAllLoaded() {
            console.log('[META-DATA-LOAD] Checking if all meta data loaded:', {metaAnalysesLoaded, deMetaResultsLoaded, pathwayMetaResultsLoaded});
            if (metaAnalysesLoaded && deMetaResultsLoaded && pathwayMetaResultsLoaded) {
                console.log('[META-DATA-LOAD] All meta data loaded, setting dataLoaded=true');
                setDataLoaded(true);
            }
        }
    }, [sessionId, sessionMetaAnalyses, callGuardedViz]);

    useEffect(() => {
        if (analyses.length > 0 && activeTabKey === "1") {
            const target = initialAnalysisId && analyses.find(a => a.id === initialAnalysisId);
            setCurrentAnalysisId(target ? target.id : analyses[0].id);
        }
    }, [analyses, initialAnalysisId]);

    const selectedDatasetsHandler = useTracker(() => {
        if (!analyses || analyses.length === 0) return [];
        const analysis = currentAnalysisId !== '' ? analyses.filter(a => a.id === currentAnalysisId)[0] : analyses[0];
        if (!analysis) return [];
        const handle = Meteor.subscribe('analysisConfig.snapshot', {
            analysisId: analysis.id,
            inputType: analysis.input,
            keys: ['selectedDatasets']
        })

        if (!handle.ready()) {
            return [];
        }

        const selectedDatasetMap = new Map()
        analyses.map(analysis => {
            const selectedDs = DBCollections.AnalysisConfigSnapshot.findOne({
                analysisId: analysis.id,
                inputType: analysis.input,
                key: "selectedDatasets"
            })?.value || [];

            selectedDatasetMap.set(analysis.id, selectedDs);
        })

        return selectedDatasetMap
    }, [analyses, currentAnalysisId]);

    useEffect(() => {
        if (selectedDatasetsHandler.size > 0) {
            setSelectedDatasets(selectedDatasetsHandler);
        }
    }, [selectedDatasetsHandler]);

    // Generate navigation sections based on active tab (must be before early returns)
    const navigationSections = useMemo(() => {
        const sections = [];

        // Only generate sections if we have data
        if (analyses.length === 0 || configs.length === 0) {
            return sections;
        }

        // Check if meta-analysis tab is active
        const isMetaAnalysisTab = activeTabKey === 'meta-analysis';

        if (isMetaAnalysisTab) {
            // Meta-analysis sections
            sections.push({id: 'meta-builder', title: 'Meta-analysis Builder'});
            // Gene-level sections (Gene Venn Diagram + Gene Heatmap) are only shown when there
            // are gene-level meta-analyses (DEMetaResults holds the metaDE gene-level results).
            if (DEMetaResults.length > 0) {
                sections.push(
                    {id: 'meta-venn', title: 'Gene Venn Diagram'},
                    {id: 'meta-gene-heatmap', title: 'Gene Heatmap'}
                );
            }
            sections.push(
                {id: 'meta-pathway-venn', title: 'Pathway Venn Diagram'},
                {id: 'meta-kegg', title: 'Multi Analysis KEGG Map'},
                {id: 'meta-pathway-heatmap', title: 'Pathway Heatmap'},
                {id: 'meta-funnel', title: 'Funnel Plot'},
                {id: 'meta-forest', title: 'Multi Analysis Forest Plot'},
                {id: 'meta-pathway-network', title: 'Multi Analysis Pathway Network'}
            );
        } else {
            // Individual analysis sections. Anchor ids are suffixed with the active
            // analysis id (via sectionAnchorId) so they match the per-analysis ids
            // rendered in createCollapseItems — otherwise the sidebar would always
            // resolve to the first opened analysis's (now hidden) sections.
            const anchor = (baseId) => sectionAnchorId(baseId, currentAnalysisId);
            sections.push({id: anchor('summary'), title: 'Summary'});

            // Get current analysis config to determine what sections are available
            const currentAnalysis = analyses.find(a => a.id === currentAnalysisId);
            const currentConfig = configs.find(c => c.analysisId === currentAnalysisId);

            if (currentConfig) {
                // Gene Volcano Plot (for expression, or pgsea whose upload carried gene-level statistics)
                if (currentConfig.inputType === "expression" ||
                    (currentConfig.inputType === "pgsea" && currentConfig.hasGeneResults)) {
                    sections.push({id: anchor('gene-volcano'), title: 'Gene Volcano Plot'});
                }

                // Circos Plot (for expression only)
                if (currentConfig.inputType === "expression") {
                    sections.push({id: anchor('circos'), title: 'Circos Plot'});
                }

                // Common sections for all analysis types
                sections.push(
                    {id: anchor('pathway-volcano'), title: 'Pathway Volcano Plot'},
                    {id: anchor('forest'), title: 'Forest Plot'},
                    {id: anchor('bar'), title: 'Bar Plot'},
                    {id: anchor('kegg'), title: 'KEGG Pathway Map'},
                    {id: anchor('pathway-network'), title: 'Pathway Network'}
                );
            }
        }

        return sections;
    }, [activeTabKey, currentAnalysisId, analyses, configs, DEMetaResults]);

    // Ahead of the loading return: a denied study can never satisfy it, so this must win.
    if (accessDenied) {
        return <StudyAccessDenied className="visualization-page-wrapper"/>;
    }

    console.log('[LOADING-CHECK] initialDataLoaded:', initialDataLoaded, 'analyses.length:', analyses.length, 'configs.length:', configs.length);
    if (!initialDataLoaded && (analyses.length === 0 || configs.length === 0)) {
        console.log('[LOADING-CHECK] Showing GeneLoading');
        return <GeneLoading />;
    }

    let resultData = {};

    let dbsObj = dbs.reduce((acc, curr) => {
        acc[curr._id] = curr;
        return acc;
    }, {});

    // For mass analysis PGSEA, add missing database entries from resultGroupedDbAll
    // These are custom gene sets uploaded during mass analysis
    // Deduplicate by detecting identical results across all analyses
    const processedDbIds = new Set();
    const duplicatesToRemove = new Set();

    const allDbIds = Object.keys(resultGroupedDbAll);

    // Check for duplicates by comparing results
    for (let i = 0; i < allDbIds.length; i++) {
        const dbId1 = allDbIds[i];
        if (duplicatesToRemove.has(dbId1)) continue;

        for (let j = i + 1; j < allDbIds.length; j++) {
            const dbId2 = allDbIds[j];
            if (duplicatesToRemove.has(dbId2)) continue;

            const results1 = resultGroupedDbAll[dbId1];
            const results2 = resultGroupedDbAll[dbId2];

            // Check if results are identical (same analyses, same pathways, same values)
            if (results1 && results2 && results1.length === results2.length) {
                const areIdentical = results1.every((r1, idx) => {
                    const r2 = results2[idx];
                    return r1.analysisId === r2.analysisId &&
                           r1.key === r2.key &&
                           r1.value.length === r2.value.length;
                });

                if (areIdentical) {
                    console.log(`[Dedupe] Found duplicate database IDs: ${dbId1} and ${dbId2} - keeping ${dbId1}`);
                    duplicatesToRemove.add(dbId2);
                }
            }
        }
    }

    // Remove duplicates from resultGroupedDbAll
    duplicatesToRemove.forEach(dbId => {
        console.log(`[Dedupe] Removing duplicate dbId: ${dbId}`);
        delete resultGroupedDbAll[dbId];
    });

    // Now add missing database entries to dbsObj
    Object.keys(resultGroupedDbAll).forEach(dbId => {
        if (!dbsObj[dbId]) {
            dbsObj[dbId] = {
                _id: dbId,
                name: `Custom Gene Set`,
                namespace: 'custom',
                isCustom: true
            };
        }
    });


    // One handler for both bars. Its body is the tab bar's previous inline onChange, unchanged:
    // it still branches on the three literal keys, on the `group_` prefix, and on a numeric key
    // parsed as `parseInt(key) - 1` into groupingData.regularAnalyses. Nothing here renumbers or
    // reorders anything, which is what would break analysis selection silently.
    // A plain function, deliberately not useCallback: this sits below the component's early returns
    // (accessDenied, and the not-yet-loaded guard), so a hook here would be a conditional hook and
    // React would throw "rendered more hooks than during the previous render" the moment the data
    // arrived. It was an inline arrow before this change, recreated on every render, so a plain
    // function is exactly the previous behaviour.
    const handleTabChange = async key => {
        console.log('[TAB-CHANGE] Switching to:', key);
        setActiveTabKey(key);
        // First activation mounts that pane; after that it is only ever shown or hidden. Analysis
        // tabs are not recorded — antd still owns their panes.
        if (PINNED_TAB_KEYS.includes(key)) {
            setMountedPinnedKeys(prev => (prev.includes(key) ? prev : [...prev, key]));
        }

        if (key === "meta-analysis") {
            console.log('[TAB-CHANGE] Meta-analysis tab clicked');
            // Only fetch if data hasn't been loaded yet
            if (Object.keys(resultGroupedDbAll).length === 0) {
                console.log('[TAB-CHANGE] Fetching data...');
                await handleFetchResultGroupedByDbAll();
                console.log('[TAB-CHANGE] Data fetch completed');
            } else {
                console.log('[TAB-CHANGE] Data already loaded, skipping fetch');
            }
        }
        if (key !== 'meta-analysis' && key !== 'ai-powered' && key !== 'dataset-metadata') {
            // Check if this is a group key
            if (key.startsWith('group_')) {
                const groupId = key.replace('group_', '');
                const group = groupingData.groupedMassAnalysesForTabs.find(g => g.groupId === groupId);
                if (group && group.analyses.length > 0) {
                    // Select the first analysis in the group
                    const firstAnalysis = group.analyses[0];
                    setCurrentAnalysisId(firstAnalysis.id);
                }
            } else {
                // Regular analysis selection (including ungrouped mass analyses)
                const analysisIndex = parseInt(key) - 1;
                if (analysisIndex >= 0 && analysisIndex < groupingData.regularAnalyses.length) {
                    setCurrentAnalysisId(groupingData.regularAnalyses[analysisIndex].id);
                }
            }
        }
    };

    // The three tabs that stay put. They are pinned by being taken OUT of the scrolling bar
    // entirely: rc-tabs derives its visible range from measured tab geometry, so a tab that is
    // hidden or unrendered while still listed in `items` reports zero width at offset zero, and once
    // the bar is scrolled that drives useVisibleRange to [0, -1] — every tab vanishes. Extracting
    // them here, unchanged, is what lets the bar below carry them as extra content instead.
    const pinnedTabItems = [
        hasMetaAnalysisCapability(configs, analyses) ?
            {
                // A meta-analysis combines datasets, so one analysis has nothing to combine.
                // Disabled rather than hidden, matching Dataset Metadata: the tab stays visible
                // so the capability is discoverable, it just cannot be opened. Safe to disable
                // even when it would otherwise be the landing tab, because pinned panes only
                // mount once their tab is clicked (see mountedPinnedKeys in handleTabChange).
                disabled: !(dataLoaded) || analyses.length < 2,
                icon: !(dataLoaded) ? <LoadingOutlined/> : null,
                label: `Meta-analysis${!(dataLoaded) ? ' (Loading...)' : ''}`,
                key: "meta-analysis",
                children: (
                    <Collapse
                        bordered={false}
                        defaultActiveKey={["1", "2", "3", "3.5", "4", "5", "6", "7", "8"]}
                        key={"meta-analysis"}
                        items={
                            [
                                {
                                    key: "1",
                                    label: "Meta-analysis",
                                    children: (
                                        <div id="meta-builder" style={{scrollMarginTop: '100px'}}>
                                            <MetaAnalysisBuilder
                                                configs={configs}
                                                analyses={analysesObj}
                                                sessionId={sessionId}
                                                resultGroupedDbAll={resultGroupedDbAll}
                                            />
                                        </div>
                                    )
                                },
                                // Gene Venn Diagram: gene-level, so only shown
                                // when there are gene-level meta-analyses.
                                ...(DEMetaResults.length > 0 ? [{
                                    key: "2",
                                    label: "Gene Venn Diagram",
                                    children: (
                                        <div id="meta-venn" style={{scrollMarginTop: '100px'}}>
                                            <InViewVennDiagramChart
                                                configs={configs}
                                                analyses={analysesObj}
                                                metaAnalysis={DEMetaResults}
                                                sessionId={sessionId}
                                            />
                                        </div>
                                    )
                                }] : []),
                                // Gene Heatmap: gene-level, so only shown when
                                // there are gene-level meta-analyses.
                                ...(DEMetaResults.length > 0 ? [{
                                    key: "3",
                                    label: "Gene Heatmap",
                                    children: (
                                        <div id="meta-gene-heatmap" style={{scrollMarginTop: '100px'}}>
                                            <InViewHeatmapGeneChart
                                                configs={configs}
                                                analyses={analysesObj}
                                                metaData={DEMetaResults}
                                                sessionId={sessionId}
                                            />
                                        </div>
                                    )
                                }] : []),
                                {
                                    key: "3.5",
                                    label: "Pathway Venn Diagram",
                                    children: (
                                        <div id="meta-pathway-venn" style={{scrollMarginTop: '100px'}}>
                                            <Tabs
                                                defaultActiveKey="0"
                                                type={"card"}
                                                onChange={(activeKey) => {
                                                }}
                                                items={
                                                    Object.keys(dbsObj)
                                                        .filter(key => resultGroupedDbAll[key] && resultGroupedDbAll[key].length > 0)
                                                        .map((key) => {
                                                            return {
                                                                label: dbsObj[key].name + (dbsObj[key].namespace !== undefined ? ` (${dbsObj[key].namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                                                key: key,
                                                                children: (
                                                                    <InViewVennDiagramPathwayChart
                                                                        configs={configs}
                                                                        analyses={analysesObj}
                                                                        analysisResultsByDb={resultGroupedDbAll[key] || []}
                                                                        dbId={key}
                                                                        dbName={dbsObj[key].name + (dbsObj[key].namespace !== undefined ? ` (${dbsObj[key].namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : "")}
                                                                        metaData={pathwayMetaResults}
                                                                        metaAnalyses={metaAnalyses}
                                                                    />
                                                                )
                                                            }
                                                        })
                                                }
                                            />
                                        </div>
                                    )
                                },
                                {
                                    key: "4",
                                    label: "Multi Analysis KEGG Map",
                                    children: (
                                        <div id="meta-kegg" style={{scrollMarginTop: '100px'}}>
                                            <InViewKEGGMapMultiAnalysis
                                                configs={configs}
                                                analyses={analysesObj}
                                                metaData={DEMetaResults}
                                                sessionId={sessionId}
                                            />
                                        </div>
                                    )
                                },
                                {
                                    key: "5",
                                    label: "Pathway Heatmap",
                                    children: (
                                        <div id="meta-pathway-heatmap" style={{scrollMarginTop: '100px'}}>
                                            <Tabs
                                                defaultActiveKey="0"
                                                type={"card"}
                                                onChange={(activeKey) => {
                                                }}
                                                items={
                                                (() => {
                                                    const allDbKeys = Object.keys(dbsObj);
                                                    const filtered = allDbKeys.filter(key => resultGroupedDbAll[key] && resultGroupedDbAll[key].length > 0);
                                                    console.log("[DEBUG Pathway Heatmap] All db keys:", allDbKeys, "Filtered db keys:", filtered);
                                                    return filtered;
                                                })()
                                                    .map((key) => {
                                                    return {
                                                        label: dbsObj[key].name + (dbsObj[key].namespace !== undefined ? ` (${dbsObj[key].namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                                        key: key,
                                                        children: (
                                                            <InViewHeatMapChartTable
                                                                analyses={analysesObj}
                                                                configs={configs}
                                                                dbId={key}
                                                                metaData={pathwayMetaResults}
                                                                metaAnalyses={metaAnalyses}
                                                                sessionId={sessionId}
                                                                analysisResultsByDb={resultGroupedDbAll[key] || []}
                                                                setAnalyses={setAnalyses}
                                                            >
                                                            </InViewHeatMapChartTable>
                                                        )
                                                    }
                                                })
                                            }
                                        />
                                        </div>
                                    )
                                },
                                {
                                    key: "6",
                                    label: "Funnel Plot",
                                    children: (() => {
                                        // A funnel plot needs a standard error, which only REML produces.
                                        // Show a tab only for databases that actually have plottable funnel
                                        // data; if none do, show the explanatory hint once instead of
                                        // empty tabs (see funnelPlotMeta.js).
                                        const funnelDbKeys = Object.keys(dbsObj)
                                            .filter(key => resultGroupedDbAll[key] && resultGroupedDbAll[key].length > 0)
                                            .filter(key => hasFunnelData((pathwayMetaResults || []).filter(m => m && m.databaseId === key)))
                                        return (
                                            <div id="meta-funnel" style={{scrollMarginTop: '100px'}}>
                                                {funnelDbKeys.length === 0 ? (
                                                    <div style={{padding: '20px', textAlign: 'center'}}>
                                                        <Empty description={funnelEmptyStateMessage(pathwayMetaResults || [])} />
                                                    </div>
                                                ) : (
                                                    <Tabs
                                                        defaultActiveKey="0"
                                                        type={"card"}
                                                        onChange={(activeKey) => {
                                                        }}
                                                        items={
                                                        funnelDbKeys.map((key) => {
                                                            return {
                                                                label: dbsObj[key].name + (dbsObj[key].namespace !== undefined ? ` (${dbsObj[key].namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                                                key: key,
                                                                children: (
                                                                    <InViewFunnelPlotChartTable
                                                                        analyses={analysesObj}
                                                                        configs={configs}
                                                                        dbId={key}
                                                                        metaData={pathwayMetaResults}
                                                                        metaAnalyses={metaAnalyses}
                                                                        sessionId={sessionId}
                                                                        analysisResultsByDb={resultGroupedDbAll[key] || []}
                                                                    ></InViewFunnelPlotChartTable>
                                                                )
                                                            }
                                                        })
                                                    }
                                                    />
                                                )}
                                            </div>
                                        )
                                    })()
                                },
                                {
                                    key: "7",
                                    label: "Multi Analysis Forest Plot",
                                    children: (
                                        <div id="meta-forest" style={{scrollMarginTop: '100px'}}>
                                            <Tabs
                                                defaultActiveKey="0"
                                                type={"card"}
                                                onChange={(activeKey) => {
                                                }}
                                                items={
                                                Object.keys(dbsObj)
                                                    .filter(key => resultGroupedDbAll[key] && resultGroupedDbAll[key].length > 0)
                                                    .map((key) => {
                                                    return {
                                                        label: dbsObj[key].name + (dbsObj[key].namespace !== undefined ? ` (${dbsObj[key].namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                                        key: key,
                                                        children: (
                                                            <InViewMultiForestChart
                                                                analyses={analysesObj}
                                                                configs={configs}
                                                                dbId={key}
                                                                metaData={pathwayMetaResults}
                                                                metaAnalyses={metaAnalyses}
                                                                sessionId={sessionId}
                                                                analysisResultsByDb={resultGroupedDbAll[key] || []}
                                                            ></InViewMultiForestChart>
                                                        )
                                                    }
                                                })
                                            }
                                        />
                                        </div>
                                    )
                                },
                                {
                                    key: "8",
                                    label: "Multi Analysis Pathway Network",
                                    children: (
                                        <div id="meta-pathway-network" style={{scrollMarginTop: '100px'}}>
                                            <Tabs
                                                defaultActiveKey="0"
                                                type={"card"}
                                                onChange={(activeKey) => {
                                                }}
                                                items={
                                                Object.keys(dbsObj)
                                                    .filter(key => resultGroupedDbAll[key] && resultGroupedDbAll[key].length > 0)
                                                    .map((key) => {
                                                    return {
                                                        label: dbsObj[key].name + (dbsObj[key].namespace !== undefined ? ` (${dbsObj[key].namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                                                        key: key,
                                                        children: (
                                                            <InViewMultiAnalysisPathwayGraphComponentTable
                                                                analyses={analysesObj}
                                                                configs={configs}
                                                                dbId={key}
                                                                metaData={pathwayMetaResults}
                                                                metaAnalyses={metaAnalyses}
                                                                sessionId={sessionId}
                                                                analysisResultsByDb={resultGroupedDbAll[key] || []}
                                                            />
                                                        )
                                                    }
                                                })
                                            }
                                        />
                                        </div>
                                    )
                                },
                            ]
                        }
                    />
                )
            } : null,
        {
            label: "Biological Interpretation",
            key: "ai-powered",
            disabled: analyses.length === 0,
            icon: !(dataLoaded) ? <LoadingOutlined/> : null,
            children: (
                <Space direction="vertical" size="middle" style={{width: '100%'}}>
                    <Space size="middle" wrap>
                        <Tooltip title={interpretationGate.disabledReason || ''}>
                        <Button
                            type="primary"
                            icon={<BulbOutlined/>}
                            disabled={Boolean(interpretationGate.disabledReason)}
                            onClick={() => {
                                // The generation wizard lives on the
                                // AI-interpretation page, so carry the study
                                // across and let the user pick which analysis
                                // to interpret there. urlPrefix matters: the
                                // route is registered as `${urlPrefix}/ai-interpretation`.
                                navigate(`${urlPrefix}/ai-interpretation${buildAIInterpretationLink({sessionId})}`);
                            }}
                        >
                            Generate Insight
                        </Button>
                        </Tooltip>
                        <Typography.Text type="secondary">
                            Opens the Biological Interpretation page to configure and run a new report.
                        </Typography.Text>
                    </Space>
                    {(interpretationGate.disabledReason || interpretationGate.unavailable.length > 0) && (
                        <Alert
                            type={interpretationGate.disabledReason ? "warning" : "info"}
                            showIcon
                            message={interpretationGate.disabledReason
                                ? "Biological Interpretation is not available for this study"
                                : "Some analyses in this study cannot be interpreted"}
                            description={
                                <ul style={{margin: 0, paddingLeft: 20}}>
                                    {interpretationGate.unavailable.map(({name, reason}) => (
                                        <li key={name}><strong>{name}</strong>: {reason}</li>
                                    ))}
                                </ul>
                            }
                        />
                    )}
                    <Collapse
                        bordered={false}
                        defaultActiveKey={["1"]}
                        key={"ai-powered"}
                        items={
                            [
                                {
                                    key: "1",
                                    label: "Generated Reports",
                                    children: (
                                        <InsightDashboard
                                            userId={Meteor.userId()}
                                            sessionId={sessionId}
                                            onViewInsight={(batchId) => {
                                                // The report has an address now,
                                                // so this lands on the report
                                                // itself. It used to receive the
                                                // batchId, discard it, and
                                                // full-reload the whole app onto
                                                // the bare list, leaving the user
                                                // to find the report again by
                                                // hand. navigate, not
                                                // window.location.href: the rest
                                                // of the app routes in-place.
                                                // The study id rides along so the
                                                // target page can scope itself
                                                // without a second lookup. No
                                                // fromList state — the entry
                                                // underneath is THIS page, which
                                                // is exactly where Back belongs.
                                                navigate(`${urlPrefix}/ai-interpretation${buildAIInterpretationLink({sessionId, reportId: batchId})}`);
                                            }}
                                            analyses={analysesObj}
                                            metaAnalyses={metaAnalyses}
                                        />
                                    )
                                }
                            ]
                        }
                    />
                </Space>
            )
        },
        {
            label: "Dataset Metadata",
            key: "dataset-metadata",
            disabled: Object.keys(analysesMetadata).length === 0,
            children: (
                <MetadataTable
                    analysesMetadata={analysesMetadata}
                    sessionId={sessionId}
                />
            )
        }
    ].filter(item => item !== null);

    // The same three as bar entries only: no `children`, because their panes are rendered below the
    // Tabs rather than by it.
    const pinnedBarItems = pinnedTabItems.map(({key, label, disabled, icon}) => ({key, label, disabled, icon}));


    return (
        <GlobalSettingsProvider sessionId={sessionId}>
            <Layout className={'visualization-page-wrapper'}>
                <Helmet title={`Analysis Result: ${sessionName}`}/>
                <Layout>
                    {/* Hide Quick Navigation only for AI-Powered tab (it has its own TOC) */}
                    {activeTabKey !== 'ai-powered' && (
                        <Layout.Sider
                            width={250}
                            style={{
                                background: '#fff',
                                padding: '16px 8px',
                                borderRight: '1px solid #f0f0f0'
                            }}
                            breakpoint="lg"
                            collapsedWidth="0"
                        >
                            <NavigationSidebar sections={navigationSections} activeTab={activeTabKey}/>
                        </Layout.Sider>
                    )}
                    <Layout.Content style={{padding: '0 16px', minHeight: '100vh'}}>
                        <Space direction="vertical" style={{width: '100%', background: 'white'}}>
                            {/* Back leads to the analysis-editing wizard, which a view-only
                                imported study has no inputs for and may not write to. */}
                            {!isReadOnly && (
                                <Link to={`${window.urlPrefix || ''}/analysis/session/${sessionId}/${analyses[0].id}`}>
                                    <Button type={"primary"}>Back</Button>
                                </Link>
                            )}
                            <span> Analysis Result: {sessionName}</span>
                            {isReadOnly && (
                                <Alert
                                    type="info"
                                    showIcon
                                    message="View only"
                                    description="This study was shared with you. You can explore the results, retune the DE thresholds and export, but changes are not saved."
                                />
                            )}
                            <GlobalSettingsPanel />
                            <Tabs
                        defaultActiveKey={null}
                        type={"card"}
                        renderTabBar={(props, DefaultTabBar) => (
                            <DefaultTabBar {...props}>
                                {node => {
                                    const {tabKey, ...restProps} = node.props;
                                    return <span key={tabKey} {...restProps} />;
                                }}
                            </DefaultTabBar>
                        )}
                        onChange={handleTabChange}
                        tabBarExtraContent={{
                            // Pinned by construction: rc-tabs measures the extra holders and
                            // SUBTRACTS them from the scrollable width, so this bar is never part of
                            // the overflow calculation no matter how many analyses the study has.
                            // Still an antd Tabs, so the card styling, the aria roles and arrow-key
                            // navigation all come from antd rather than from hand-rolled divs.
                            right: (
                                <Tabs
                                    type={"card"}
                                    className={"viz-pinned-tabs"}
                                    activeKey={activeTabKey}
                                    onChange={handleTabChange}
                                    items={pinnedBarItems}
                                />
                            )
                        }}
                        activeKey={activeTabKey}
                        items={allTabItems}
                    />
                    {/* The pinned panes. antd is no longer mounting them, so its one useful pane
                        behaviour has to be reproduced: a pane stays mounted once opened and is
                        merely hidden, exactly as TabPanelList does. Unmounting instead would reset
                        MetaAnalysisBuilder's state every time the user looked at another tab.
                        Rendering only what has been opened also makes these LAZIER than before,
                        when all three pane trees were built inline on every render of this page. */}
                    {pinnedTabItems
                        .filter(item => mountedPinnedKeys.includes(item.key))
                        .map(item => (
                            <div
                                key={item.key}
                                style={{display: activeTabKey === item.key ? 'block' : 'none'}}
                            >
                                {item.children}
                            </div>
                        ))}
                </Space>
                    </Layout.Content>
                </Layout>
                <TaskResult/>
                {/*<ChatWidget/>*/}
            </Layout>
        </GlobalSettingsProvider>
    );
};

// Inline loading indicator for an individual plot panel. Unlike GeneLoading
// (a full-screen fixed overlay), this stays within the plot's own card so it
// can clearly mark "this plot is loading" without covering the whole page.
const PlotLoading = ({text = 'Loading plot...'}) => (
    <div style={{padding: '40px', textAlign: 'center'}}>
        <Spin size="large"/>
        <div style={{marginTop: 12, color: '#666'}}>{text}</div>
    </div>
);

const VolcanoChartTable = ({
                               analysisId,
                               inputType,
                               geneSet,
                               sessionId,
                               selectType,
                               method,
                               onScatterPointClick,
                               dbId,
                               selectedPathways,
                               setSelectedPathways,
                               currentMethod,
                               // Label-set control lifted to VolcanoChartTabs (per database). This table only
                               // seeds the default top-20 (it owns this method's result data) and renders the
                               // parent-supplied effective labeled set on the plot.
                               labeledPathwayIds,
                               labelsCustomizedForDb,
                               isActiveMethod,
                               onSeedLabels
                           }) => {
    // let [selectedPathways, setSelectedPathways] = useState([]);
    let [mode, setMode] = useState("pValueFDR");
    const [pValueThreshold, setPValueThreshold] = useState(0.05);
    let [result, setResult] = useState([]);
    // Start in the loading state so the genuine "no result" message never flashes
    // before the first fetch has had a chance to run.
    const [isLoadingData, setIsLoadingData] = useState(true);
    const [selectedPathwaysState, setSelectedPathwaysState] = useState([]);

    const options = [
        {
            label: "pValue.FDR",
            value: "pValueFDR"
        },
        {
            label: "pValue",
            value: "pValue"
        }
    ];

    useEffect(() => {
        async function fetchData() {
            // Fetch this tab's OWN method (not the shared currentMethod) and reset
            // on empty/error so switching back to a method with no results clears
            // the figure instead of showing the previous method's plot.
            setIsLoadingData(true);
            let args = {
                resultId: analysisId,
                databaseId: geneSet.id,
                method
            };
            try {
                const response = await fetch2(`/api/methodResults?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    setResult([]);
                    return;
                }
                let resJson = await response.json();
                setResult(Array.isArray(resJson) ? resJson : []);
            } catch (error) {
                console.error("Error fetching data:", error);
                setResult([]);
            } finally {
                setIsLoadingData(false);
            }
        }

        fetchData();
    }, [analysisId, geneSet.id, method]);

    useEffect(() => {
        if (result.length === 0) return;
        // sort results by pValue in ascending order
        let pathways = result.sort((a, b) => a[mode] - b[mode]).slice(0, 300).map(e => e.pathway);
        setSelectedPathways(new Map([...selectedPathways, [dbId, pathways]]));
        setSelectedPathwaysState(pathways);
    }, [result, mode]);

    useEffect(() => {
        setSelectedPathwaysState(selectedPathways.get(dbId) ?? [])
    }, [selectedPathways]);

    // Candidate pathways for the default label set: plotted (selected ≤300) AND plottable
    // (finite score) — mirrors the chart's own plotData filter so the seeded top-20 never offers a
    // pathway that the chart then drops.
    const seedCandidates = useMemo(() => {
        const plotted = new Set(selectedPathwaysState);
        return result
            .filter((r) => plotted.has(r.pathway) && Number.isFinite(r.score))
            .map((r) => ({id: r.pathway, pValue: r.pValue, pValueFDR: r.pValueFDR}));
    }, [result, selectedPathwaysState]);

    // Seed the default labeled set to the top-20 most significant plotted pathways for the active
    // mode (the "top 20 pathway names" default). This table owns the method's result/ordering, so it
    // reports the seed up to VolcanoChartTabs, which holds the shared per-database labeled set. Once
    // the user customizes the selection (labelsCustomizedForDb) we stop reseeding.
    useEffect(() => {
        // Only the active method seeds, so two mounted method tabs can't fight over the shared
        // per-database default with their different top-20 rankings.
        if (!isActiveMethod || labelsCustomizedForDb || seedCandidates.length === 0 || !onSeedLabels) return;
        const top20 = [...seedCandidates]
            .sort((a, b) => (a[mode] ?? Infinity) - (b[mode] ?? Infinity))
            .slice(0, 20)
            .map((p) => p.id);
        onSeedLabels(dbId, top20);
    }, [seedCandidates, mode, labelsCustomizedForDb, isActiveMethod, onSeedLabels, dbId]);

    const onModeChange = ({target: {value}}) => {
        setMode(value);
    };

    const handlePValueChange = (value) => {
        setPValueThreshold(value);
    };

    const handleScatterPointClick = (label) => {
        console.log('Clicked on scatter point with label:', label);
        onScatterPointClick(label);
    };

    if (isLoadingData) {
        return <PlotLoading/>;
    }
    if (result.length === 0) {
        return "No result found for this method.";
    }
    return (
        <>
            <Radio.Group style={{display: 'block'}} options={options} onChange={onModeChange} value={mode}
                         optionType="button"/>
            <div style={{marginTop: 8, display: "inline-block"}}>
                Threshold:
                <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={pValueThreshold}
                    onChange={handlePValueChange}
                />
            </div>
            <VolcanoChart result={result} geneSet={geneSet} selectedPathways={selectedPathwaysState}
                          labeledPathwayIds={labeledPathwayIds} mode={mode}
                          threshold={pValueThreshold} onScatterPointClick={handleScatterPointClick}></VolcanoChart>
            {/* Label selection now lives in the result table (SelectableResult) below, managed at the
                VolcanoChartTabs level so it is shared across this database's method sub-tabs. */}
            <Typography.Text type="secondary" style={{display: 'block', marginTop: 8}}>
                Tip: choose which pathways are labeled on the plot in the Result table below.
            </Typography.Text>
            {/*<Button onClick={handleAddJob}>Add Job</Button>*/}
        </>
    );
};

const InViewVolcanoChartTable = inViewRender(VolcanoChartTable);
const VolcanoChartTabs = ({
                              sessionId,
                              analysis,
                              selectedDatasets,
                              config,
                              handleScatterPointClick,
                              currentMethod,
                              setCurrentMethod
                          }) => {
    const [selectedPathways, setSelectedPathways] = useState(new Map());
    // Per-database set of pathways whose names are shown on the plot (ordered newest-first). Shared
    // across this database's method sub-tabs and managed from the result table below. Seeded to the
    // top-20 by the active method until the user customizes it (tracked in labelsCustomizedByDb).
    const [labeledByDb, setLabeledByDb] = useState(new Map());
    const [labelsCustomizedByDb, setLabelsCustomizedByDb] = useState(new Map());

    // Set the default labeled set for a database (only the active method table calls this, and only
    // while the set is not user-customized — so it never fights a manual selection).
    const handleSeedLabels = useCallback((dbId, ids) => {
        setLabeledByDb(prev => new Map(prev).set(dbId, ids));
    }, []);

    // Apply a user edit from the result-table selector. The selector only ever shows/returns the
    // currently-plotted ids, so we reconcile against `plottedIds`: newest additions first, then the
    // still-selected plotted ids in their prior order, then any previously-labeled ids that are just
    // temporarily unplotted ("ghosts") — preserved so unchecking a pathway in the table and editing
    // the selector never silently discards a label (re-plotting restores it).
    const handleChangeLabels = useCallback((dbId, nextIds, plottedIds) => {
        setLabeledByDb(prev => {
            const prevIds = prev.get(dbId) ?? [];
            const prevSet = new Set(prevIds);
            const nextSet = new Set(nextIds);
            const plottedSet = new Set(plottedIds);
            const added = nextIds.filter(id => !prevSet.has(id));
            const kept = prevIds.filter(id => plottedSet.has(id) && nextSet.has(id));
            const ghosts = prevIds.filter(id => !plottedSet.has(id));
            return new Map(prev).set(dbId, [...added, ...kept, ...ghosts]);
        });
        setLabelsCustomizedByDb(prev => new Map(prev).set(dbId, true));
    }, []);

    // "Reset to top 20": drop the customization + current set so the active method table reseeds.
    const handleResetLabels = useCallback((dbId) => {
        setLabelsCustomizedByDb(prev => {
            const next = new Map(prev);
            next.delete(dbId);
            return next;
        });
        setLabeledByDb(prev => {
            const next = new Map(prev);
            next.delete(dbId);
            return next;
        });
    }, []);

    const sortedMethods = Object.keys(config.methods)
        .filter(method => config.methods[method].enabled)
        .sort((a, b) => {
            if (a === "consensus") return -1;
            if (b === "consensus") return 1;
            return 0;
        })
    const activeMethod = currentMethod.get('pathwayVolcano') ?? sortedMethods[0];
    return (
        <Tabs
            defaultActiveKey="0"
            type={"card"}
            onChange={(activeKey) => {
            }}
            items={
                (selectedDatasets.get(analysis.id) ?? []).map(key => {
                    const geneSet = config.geneSets.filter(g => g.id === key)[0]
                    // Per-database label wiring. Options are the currently-plotted pathways (only
                    // plotted points can carry a label); the effective labeled set is the stored
                    // selection intersected with what is plotted, so the tags and the plot stay in
                    // step when a labeled pathway is later unchecked in the result table.
                    const plottedIds = selectedPathways.get(key) ?? [];
                    const plottedSet = new Set(plottedIds);
                    const nameById = new Map((geneSet.geneSets ?? []).map(g => [g.id, g.name]));
                    const labelOptions = plottedIds.map(id => ({value: id, label: nameById.get(id) ?? id}));
                    const rawLabeled = labeledByDb.get(key);
                    const effectiveLabeled = rawLabeled ? rawLabeled.filter(id => plottedSet.has(id)) : undefined;
                    const isLabelsCustomized = !!labelsCustomizedByDb.get(key);
                    return {
                        label: geneSet.name + (geneSet.namespace !== undefined ? ` (${geneSet.namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                        key: geneSet.id,
                        children: (
                            <Space direction={'vertical'} style={{width: '100%'}}>
                                <Tabs
                                    tabPosition={"left"}
                                    defaultActiveKey="0"
                                    activeKey={currentMethod.get('pathwayVolcano') ?? sortedMethods[0]}
                                    type={"card"}
                                    onChange={(activeKey) => {
                                        setCurrentMethod(new Map([...currentMethod, ['pathwayVolcano', activeKey]]))
                                    }}
                                    items={
                                        sortedMethods
                                            .map((method) => {
                                                return {
                                                    label: method.toUpperCase(),
                                                    key: method,
                                                    children: (
                                                        <InViewVolcanoChartTable
                                                            analysisId={analysis.id}
                                                            inputType={config.inputType}
                                                            geneSet={geneSet}
                                                            // geneSetId={geneSet.id}
                                                            key={geneSet.id}
                                                            sessionId={sessionId}
                                                            selectType='checkbox'
                                                            method={method}
                                                            onScatterPointClick={handleScatterPointClick}
                                                            dbId={key}
                                                            selectedPathways={selectedPathways}
                                                            setSelectedPathways={setSelectedPathways}
                                                            currentMethod={currentMethod}
                                                            labeledPathwayIds={effectiveLabeled}
                                                            labelsCustomizedForDb={isLabelsCustomized}
                                                            isActiveMethod={activeMethod === method}
                                                            onSeedLabels={handleSeedLabels}
                                                        ></InViewVolcanoChartTable>
                                                    )
                                                }
                                            })
                                    }
                                />
                                <SelectableResult
                                    analysisId={analysis.id}
                                    inputType={config.inputType}
                                    sessionId={sessionId}
                                    isRunnable={false}
                                    selectType={'checkbox'}
                                    onRowSelectionChange={(record, selected, selectedRows) => {
                                        // setSelectedPathways(selectedRows.map(e => e.pathway));
                                        setSelectedPathways(new Map([...selectedPathways, [key, selectedRows.map(e => e.pathway)]]));
                                    }}
                                    onRowSelectAllChange={(selected, selectedRows, changeRows) => {
                                        // setSelectedPathways(selectedRows.map(e => e.pathway));
                                        setSelectedPathways(new Map([...selectedPathways, [key, selectedRows.map(e => e.pathway)]]));
                                    }}
                                    databaseIds={[geneSet.id]}
                                    selectedPathways={selectedPathways.get(key) ?? []}
                                    selectedMethod={currentMethod.get('pathwayVolcano') ?? sortedMethods[0]}
                                    labelControl={{
                                        options: labelOptions,
                                        value: effectiveLabeled ?? [],
                                        onChange: (ids) => handleChangeLabels(key, ids, plottedIds),
                                        onReset: () => handleResetLabels(key),
                                        maxTags: 20,
                                    }}
                                />
                            </Space>
                        )
                    }
                })
            }
        />
    )
}

const COLORS = [
    "#FFA500", "#33FF57", "#5733FF", "#FF33A1", "#33FFF6",
    "#4A0E4E", "#81C784", "#FF4081", "#3F51B5", "#795548",
    "#607D8B", "#FF9800", "#009688", "#E91E63", "#2196F3",
    "#FFEB3B", "#673AB7", "#00BCD4", "#8BC34A", "#FF5722"
];

// Case-insensitive symbol search for the Circos highlight picker. Deliberately NOT the
// dual label-or-value matcher from VolcanoGenePicker: there the label is a symbol and the
// value an Entrez id, so it must try both. Here both are the symbol, so one test is enough.
const circosGeneFilterOption = (input, option) =>
    String(option.value).toLowerCase().includes(String(input).toLowerCase());

const CircosChartTable = ({
                              analysisId,
                              inputType,
                              geneSet,
                              sessionId,
                              selectType,
                              method,
                              organismId,
                              config,
                              handleChangingDESettings,
                              circosDisplayPathways,
                              circosDisplayGenes,
                              maxAdjustedPValue,
                              minLogFoldChange,
                              pathwayPValueFDRThres,
                              dbId,
                              selectedPathways,
                              setSelectedPathways,
                              currentMethod
                              // deGenes
                          }) => {
    // const [selectedPathways, setSelectedPathways] = useState([]);
    // Raw pathway docs from geneSet.getInfo. The rendered chart is a pure, synchronous
    // derivation of these (below) — deliberately NOT rebuilt by the fetch effect, so
    // changing the gene target or the highlight set never re-issues a Meteor call.
    const [pathwayInfo, setPathwayInfo] = useState([]);
    // Ephemeral, view-only (nothing persists), mirroring the gene volcano. Values are gene
    // SYMBOLS: after the id->symbol mapping the symbol is the graph's only join key.
    const [highlightedGenes, setHighlightedGenes] = useState([]);
    let [result, setResult] = useState([]);
    let [DEGenes, setDEGenes] = useState([]);
    const [isLoadingData, setIsLoadingData] = useState(true);
    // Tracks the fold-change/p-value fetch + DE-gene derivation, which run in
    // separate async effects from `isLoadingData`. Without this flag the display
    // cascade falls through to a "no data" message while genes are still loading.
    const [loadingDEGenes, setLoadingDEGenes] = useState(true);
    // Whether the selected pathways have been computed for the current result.
    const [pathwaysResolved, setPathwaysResolved] = useState(false);
    const [displayPathways, setDisplayPathways] = useState(5)
    const [fcPValueData, setFcPValueData] = useState([]);
    const [selectedPathwaysState, setSelectedPathwaysState] = useState([]);

    const mode = "pValueFDR"; // Simplified from useState since it's not changing

    const key = useMemo(() => `${geneSet.id}-${method}`, [geneSet.id, method]);
    useEffect(() => {
        async function fetchData() {
            // Fetch this tab's OWN method (not the shared currentMethod), so each
            // method tab shows its own data and switching back to a method with no
            // results clears the figure instead of keeping the previous one.
            setIsLoadingData(true);
            // New method => its pathways/chart are not computed yet; force the
            // "loading" state until effect D recomputes them (avoids a stale flash).
            setPathwaysResolved(false);
            setPathwayInfo([]);
            let args = {
                resultId: analysisId,
                databaseId: geneSet.id,
                method
            };
            try {
                const response = await fetch2(`/api/methodResults?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    // No result for this method (e.g. 404) — reset so the stale
                    // figure from a previously viewed method is not shown.
                    setResult([]);
                    return;
                }
                let resJson = await response.json();
                setResult(Array.isArray(resJson) ? resJson : []);
            } catch (error) {
                console.error("Error fetching data:", error);
                setResult([]);
            } finally {
                setIsLoadingData(false);
            }
        }

        fetchData();
    }, [analysisId, geneSet.id, method]);

    useEffect(() => {
        const fetchFcPValueData = async () => {
            let args = {
                analysisId,
                sessionId
            }

            setLoadingDEGenes(true);
            try {
                const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const resJson = await response.json();
                const data = Array.isArray(resJson) ? resJson : [];
                setFcPValueData([...data]);
                // No genes at all -> derivation below will no-op, so finish here.
                // Otherwise the derive effect clears the flag once DE genes resolve.
                if (data.length === 0) {
                    setLoadingDEGenes(false);
                }
            } catch (error) {
                console.error("Error fetching fcPValueData:", error);
                setFcPValueData([]);
                setLoadingDEGenes(false);
            }
        }

        fetchFcPValueData()
    }, [sessionId, analysisId]);

    const updateNewDEGenes = useCallback(async (filteredGenes) => {
        const geneIds = filteredGenes.map(gene => gene.id);
        const geneInfoData = await Meteor.callAsync("visualization.getGeneInfo", geneIds)

        const newDEGenes = geneInfoData.map(gene => {
            return {
                FC: filteredGenes.filter(e => e.id === gene._id).map(e => e.FC)[0],
                pValueFDR: filteredGenes.filter(e => e.id === gene._id).map(e => e.pValueFDR)[0],
                ...gene
            }
        })

        setDEGenes(newDEGenes);
    }, [fcPValueData, maxAdjustedPValue, minLogFoldChange])

    useEffect(() => {
        // Empty fcPValueData is handled by the fetch effect (which clears the flag);
        // returning here keeps `loadingDEGenes` true until real data arrives.
        if (!fcPValueData || fcPValueData.length < 1) return;
        const newDEGenes = fcPValueData.filter(
            gene => gene.pValueFDR <= maxAdjustedPValue &&
                Math.abs(gene.FC) >= minLogFoldChange
        )
        setLoadingDEGenes(true);
        updateNewDEGenes(newDEGenes).finally(() => setLoadingDEGenes(false));
    }, [fcPValueData, maxAdjustedPValue, minLogFoldChange])

    // useEffect(() => {
    //     console.log("debugging: ", DEGenes)
    // }, [DEGenes]);

    useEffect(() => {
        updateDisplayPathways(circosDisplayPathways, pathwayPValueFDRThres)
    }, [circosDisplayPathways, pathwayPValueFDRThres]);

    useEffect(() => {
        setSelectedPathwaysState(selectedPathways.get(dbId) ?? [])
    }, [selectedPathways]);

    useEffect(() => {
        if (result.length === 0) return;
        const pathways = result
            //TODO Read this
            .filter(e => e[mode] <= pathwayPValueFDRThres)
            // .sort((a, b) => a[mode] - b[mode])
            .sort((a, b) => a['pValue'] - b['pValue']) // Only sort by pValue
            .slice(0, circosDisplayPathways)
            .map(e => e.pathway);
        setSelectedPathways(new Map([...selectedPathways, [dbId, pathways]]));
        setSelectedPathwaysState(pathways)
        // Pathways are now computed for this result; if there are none, the display
        // state can safely show "no significant pathways" (no longer "loading").
        setPathwaysResolved(true)
    }, [result, mode]);

    useEffect(() => {
        if (selectedPathwaysState.length === 0) return;
        // Guards against out-of-order completions: pathwayInfo is the sole input to the chart,
        // so a slow earlier fetch resolving after a faster later one would render a stale
        // pathway set, and its `finally` would un-gate the spinner while the current fetch is
        // still in flight.
        let cancelled = false;
        const fetchData = async () => {
            try {
                // const pathwayData = await Meteor.callAsync('pathway.extractAnalysisData',
                //     analysisId,
                //     sessionId,
                //     '2GwfEq5Xu7T5MqgZG',
                //     {
                //         maxAdjustedPValue,
                //         minLogFoldChange,
                //         pathwayPValueFDRThres,
                //         organismId,
                //         method
                //     }
                // );

                // const results = await Meteor.callAsync('pathway.runComprehensiveAnalysis',
                //     analysisId,  // analysisId
                //     sessionId,  // sessionId
                //     '2GwfEq5Xu7T5MqgZG', // databases
                //     {
                //         maxAdjustedPValue,
                //         minLogFoldChange,
                //         pathwayPValueFDRThres,
                //         includeVisualization: true,
                //         generateReport: true,
                //         organismId,
                //         method
                //     }
                // );
                //
                // console.log("Insight results", results)

                setIsLoadingData(true);
                const data = await Meteor.asyncCallWithNotification('geneSet.getInfo', {
                    pathwayIds: selectedPathwaysState ?? [],
                    genSetId: geneSet.id,
                    organismId
                });

                if (cancelled) return;
                setPathwayInfo(Array.isArray(data) ? data : []);
            } catch (error) {
                // Deliberately does NOT clear pathwayInfo: it is now the sole input to the
                // chart, so blanking it on a transient failure would replace an already
                // rendered plot with an empty one. Keeping the last good pathway set matches
                // the previous behaviour, where a throw simply left the old nodes in place.
                console.error("Error fetching data:", error);
            } finally {
                // In a finally so a throw cannot leave the pane spinning: this used to sit
                // inside the try, after the node/relation build, so any throw from that build
                // left isLoadingData true forever.
                if (!cancelled) setIsLoadingData(false);
            }
        };

        fetchData();
        return () => { cancelled = true; };
        // `DEGenes` is deliberately NOT a dependency: geneSet.getInfo returns pathway gene
        // MEMBERSHIP, which does not depend on the DE thresholds, and the id->symbol join
        // that did need DEGenes now lives in the pure memo below. Listing it here re-issued
        // the Meteor call on every nudge of the DE pValue.FDR / Log2FC inputs, for every
        // mounted pane.
    }, [selectedPathways, method, selectedPathwaysState]);

    // Displayed pathways with their gene ids resolved to the symbols of the DE genes they
    // contain. Shared by the graph build and the picker options so the mapping runs once.
    const symbolPathways = useMemo(
        () => mapPathwayGenesToSymbols(pathwayInfo, DEGenes),
        [pathwayInfo, DEGenes]
    );

    // The chart data, derived purely and synchronously. Node ids are positional and are used
    // as raw matrix indices by circos-d3, so they are assigned only after the gene selection
    // is final, and relations are pruned to surviving genes rather than resolved with a
    // `.find(...).id` that threw the moment a gene was dropped.
    const circosGraph = useMemo(() => buildCircosGraph(
        symbolPathways,
        DEGenes,
        {
            topN: circosDisplayGenes,
            highlightedSymbols: highlightedGenes,
            colors: COLORS,
        }
        // `highlightedGenes` is a useState array, so its identity is stable between renders
        // and only changes when the user edits the selection — exactly when a rebuild is
        // wanted. No content hashing needed.
    ), [symbolPathways, DEGenes, circosDisplayGenes, highlightedGenes]);

    const inputGenesPathways = circosGraph.nodes;
    const inputRelation = circosGraph.relations;

    // Options for the highlight picker: every gene of THIS pane's displayed pathways, taken
    // BEFORE the target is applied, so a gene can be highlighted precisely because the target
    // cut it. A previously-picked symbol that has since left the set stays selected — antd
    // renders the tag from its value, which is the symbol itself — and the caption reports it.
    const geneOptions = useMemo(() => {
        const symbolsInView = new Set();
        for (const pathway of symbolPathways) {
            for (const symbol of pathway.genes) symbolsInView.add(symbol);
        }
        return [...symbolsInView].sort().map(symbol => ({label: symbol, value: symbol}));
    }, [symbolPathways]);

    const geneSelectionCaption = describeGeneSelection(circosGraph.stats);

    // Single source of truth for what to render. The loading flags gate every
    // "no data" verdict so the genuine empty-states never flash while data loads.
    const displayState = useMemo(() => computePlotDisplayState({
        isLoadingData,
        loadingDEGenes,
        result,
        DEGenes,
        pathwaysResolved,
        selectedPathwaysForDb: selectedPathways.get(dbId) ?? [],
        inputGenesPathways,
    }), [isLoadingData, loadingDEGenes, result, DEGenes, pathwaysResolved, selectedPathways, dbId, inputGenesPathways])

    const updateDisplayPathways = _.debounce((value, pValueFDRThres) => {
        if (result.length === 0) return;
        const pathways = result
            .filter(e => e[mode] <= pValueFDRThres)
            // .sort((a, b) => a[mode] - b[mode])
            .sort((a, b) => a['pValue'] - b['pValue']) // Only sort by pValue
            .slice(0, value)
            .map(e => e.pathway);
        setSelectedPathways(new Map([...selectedPathways, [dbId, pathways]]));
        setSelectedPathwaysState(pathways)
    }, 2000);

    return (
        <>
            {displayState === 'loading' && (
                <PlotLoading/>
            )}
            {displayState !== 'loading' && displayState !== 'ready' && (
                <div>{PLOT_STATE_MESSAGES[displayState]}</div>
            )}
            {displayState === 'ready' && (
                <Space direction={'vertical'} style={{width: '100%'}}>
                    {/* Hidden when there is nothing to connect: geneOptions is necessarily
                        empty in that case, so the picker would be an empty control sitting
                        above a message explaining there are no genes. */}
                    {inputRelation.length > 0 && (
                    <Space wrap align="center">
                        <HighlightOutlined/>
                        <Typography.Text>Highlight genes:</Typography.Text>
                        <Select
                            mode="multiple"
                            showSearch
                            allowClear
                            maxTagCount="responsive"
                            placeholder="Search a gene symbol…"
                            style={{minWidth: 240, maxWidth: 460}}
                            value={highlightedGenes}
                            onChange={(values) => setHighlightedGenes(values || [])}
                            options={geneOptions}
                            filterOption={circosGeneFilterOption}
                            listHeight={288}
                        />
                    </Space>
                    )}
                    {geneSelectionCaption && (
                        <Typography.Text type="secondary">{geneSelectionCaption}</Typography.Text>
                    )}
                    {inputRelation.length === 0 ? (
                        // circos-d3 returns early on empty flows, drawing nothing at all. Say so
                        // rather than showing a blank canvas.
                        <Typography.Text type="secondary">
                            None of the displayed pathways contain a differentially expressed gene,
                            so there is nothing to connect. Try relaxing the DE gene filters or
                            displaying more pathways.
                        </Typography.Text>
                    ) : (
                        <CircosD3Chart
                            pathwayGenes={inputGenesPathways}
                            flows={inputRelation}
                            chartId={key}
                        />
                    )}
                </Space>
            )}
        </>
    );
};
const InViewCircosChartTable = inViewRender(CircosChartTable);
const CircosTabs = ({
                        sessionId,
                        analysis,
                        selectedDatasets,
                        config,
                        currentMethod,
                        setCurrentMethod,
                        handleChangingDESettings,
                        circosDisplayPathways,
                        circosDisplayGenes,
                        pathwayPValueFDRThres
                    }) => {
    const [selectedPathways, setSelectedPathways] = useState(new Map());

    useEffect(() => {
    }, [selectedPathways]);

    const sortedMethods = Object.keys(config.methods)
        .filter(method => config.methods[method].enabled)
        .sort((a, b) => {
            if (a === "consensus") return -1;
            if (b === "consensus") return 1;
            return 0;
        })
    return (
        <Tabs
            defaultActiveKey="0"
            type={"card"}
            onChange={(activeKey) => {
            }}
            items={
                (selectedDatasets.get(analysis.id) ?? []).map(key => {
                    const geneSet = config.geneSets.filter(g => g.id === key)[0]
                    return {
                        label: geneSet.name + (geneSet.namespace !== undefined ? ` (${geneSet.namespace.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")})` : ""),
                        key: geneSet.id,
                        children: (
                            <Space direction={'vertical'} style={{width: '100%'}}>
                                <Tabs
                                    tabPosition={"left"}
                                    defaultActiveKey="0"
                                    activeKey={currentMethod.get('circos') ?? sortedMethods[0]}
                                    type={"card"}
                                    onChange={(activeKey) => {
                                        setCurrentMethod(new Map([...currentMethod, ['circos', activeKey]]))
                                    }}
                                    items={
                                        sortedMethods.map((method, index) => {
                                            return {
                                                label: method.toUpperCase(),
                                                key: method,
                                                children: (
                                                    <InViewCircosChartTable
                                                        analysisId={analysis.id}
                                                        inputType={config.inputType}
                                                        geneSet={geneSet}
                                                        key={`${geneSet.id}-${method}-${index}`}
                                                        sessionId={sessionId}
                                                        selectType='checkbox'
                                                        method={method}
                                                        organismId={config.organismId}
                                                        config={config}
                                                        handleChangingDESettings={handleChangingDESettings}
                                                        circosDisplayPathways={circosDisplayPathways}
                                                        circosDisplayGenes={circosDisplayGenes}
                                                        maxAdjustedPValue={config.maxAdjustedPValue}
                                                        minLogFoldChange={config.minLogFoldChange}
                                                        pathwayPValueFDRThres={pathwayPValueFDRThres}
                                                        dbId={key}
                                                        selectedPathways={selectedPathways}
                                                        setSelectedPathways={setSelectedPathways}
                                                        currentMethod={currentMethod}
                                                        // deGenes={deGenes}
                                                    ></InViewCircosChartTable>
                                                )
                                            }
                                        })
                                    }
                                />
                                <SelectableResult
                                    analysisId={analysis.id}
                                    inputType={config.inputType}
                                    sessionId={sessionId}
                                    isRunnable={false}
                                    selectType={'checkbox'}
                                    onRowSelectionChange={(record, selected, selectedRows) => {
                                        setSelectedPathways(new Map([...selectedPathways, [key, selectedRows.map(e => e.pathway)]]));
                                    }}
                                    onRowSelectAllChange={(selected, selectedRows, changeRows) => {
                                        setSelectedPathways(new Map([...selectedPathways, [key, selectedRows.map(e => e.pathway)]]));
                                    }}
                                    databaseIds={[geneSet.id]}
                                    selectedPathways={selectedPathways.get(key) ?? []}
                                    selectedMethod={currentMethod.get('circos') ?? sortedMethods[0]}
                                />
                            </Space>
                        )
                    }
                })
            }
        />
    )
}

// /api/resultData for the two panes below, whose ranking effects use `result.length === 0` as
// their "no data yet" guard.
//
// "Nothing" is normalised to an empty ARRAY, not {}, and that is load-bearing rather than a
// stylistic choice: {} has no `.length`, so `result.length === 0` would be false and
// NegBarChartTable would fall through to `Object.keys(result)[0]` === undefined,
// setAnalysisMethod(undefined), and then `result[undefined].sort(...)` — an uncaught TypeError in
// an effect, with no error boundary anywhere in the client to contain it. Keeping the existing
// empty-array sentinel preserves both panes' behaviour exactly while removing the throw.
const methodResultsOrEmpty = (resJson, databaseId, analysisId) => {
    const methods = extractMethodResults(resJson, databaseId, analysisId);
    return methods && Object.keys(methods).length > 0 ? methods : [];
};

const ForestChartTable = ({
                              analysisId,
                              inputType,
                              geneSet,
                              sessionId,
                              selectType,
                              onForestPointClick
                          }) => {
    const [result, setResult] = useState([]);
    const [value, setValue] = useState([]);
    let [selectedPathways, setSelectedPathways] = useState([]);
    let [analysisMethod, setAnalysisMethod] = useState("");
    const [treeData, setTreeData] = useState([]);
    const [initialTreeData, setInitialTreeData] = useState([]);
    // Separate flags for the two async fetches so "loading" is distinct from a
    // genuinely empty result (which previously got stuck on "Loading" forever).
    const [loadingResult, setLoadingResult] = useState(true);
    const [loadingTree, setLoadingTree] = useState(true);
    // "We never got the data" and "there is genuinely nothing" rendered the same message before,
    // so a dropped request was indistinguishable from an empty result.
    const [resultFailed, setResultFailed] = useState(false);
    const [treeFailed, setTreeFailed] = useState(false);
    const [sortingOptions, setSortingOptions] = useState([])

    useEffect(() => {
        // Guards against out-of-order completions, as the Circos fetch does: this effect re-runs on
        // analysisId, and a superseded response must neither overwrite the newer result nor clear
        // the loading flag from its `finally` while the current request is still in flight — which
        // would un-gate the empty-state message mid-fetch.
        let cancelled = false;
        async function fetchData() {
            setLoadingResult(true);
            setResultFailed(false);
            let args = {
                analysisId
            };
            try {
                const response = await fetch2(`/api/resultData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                // Was `resJson[geneSet.id][analysisId]`. When this analysis had no rows for this
                // database that indexed undefined and threw INTO the catch below, which logged and
                // moved on, leaving `result` empty — so the pane reported "no significant pathways"
                // for a study that may well have had them.
                if (cancelled) return;
                setResult(methodResultsOrEmpty(resJson, geneSet.id, analysisId));
            } catch (error) {
                console.error("Error fetching data:", error);
                if (!cancelled) setResultFailed(true);
            } finally {
                if (!cancelled) setLoadingResult(false);
            }
        }

        fetchData();
        return () => { cancelled = true; };
    }, [analysisId]);

    useEffect(() => {
        if (result.length === 0) return;
        if (analysisMethod === "") return;

        let rankedPathwayIds = [];
        // console.log("analysisMethod: ", analysisMethod)
        // console.log("result: ", result)
        if (analysisMethod === "rank_aggregation") {
            if (initialTreeData.length > 1) {
                rankedPathwayIds = RankPathways.rankPathwaysObjectByCriteriaMultiAnalysis(result, "pValueFDR", 300);
            } else {
                let currentAnalysisMethod = Object.keys(result)[0];
                setAnalysisMethod(currentAnalysisMethod);
            }
        } else {
            rankedPathwayIds = result[analysisMethod].sort((a, b) => a.pValue - b.pValue).slice(0, 300).map(e => e.pathway);
        }
        // console.log("rankedPathwayIds: ", rankedPathwayIds);
        // rankedPathwayIds = rankedPathwayIds.reverse();
        // console.log("rankedPathwayIds revers: ", rankedPathwayIds);
        setSelectedPathways(rankedPathwayIds);
    }, [result, analysisMethod]);

    useEffect(() => {
        // Same out-of-order guard as the result fetch above; this effect re-runs on analysisId too.
        // Note it does NOT re-raise setLoadingTree(true) — that would be a behavioural change on an
        // analysis switch and belongs with the dep-array cleanup this commit deliberately leaves.
        let cancelled = false;
        async function fetchData() {
            setTreeFailed(false);
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/treeData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resultTree = await response.json();
                // Same unguarded two-level index as the result fetch above, and the same false
                // negative when this database is absent from the payload: the throw was caught and
                // the pane reported "no significant pathways".
                const treeForDb = resultTree?.treeData?.[geneSet.id];
                const initialForDb = resultTree?.initialTreeData?.[geneSet.id];
                let treeData = Array.isArray(treeForDb)
                    ? treeForDb.filter(e => e.key === analysisId)
                    : []
                let initialTreeData = Array.isArray(initialForDb)
                    ? initialForDb.filter(e => e.split("_")[0] === analysisId)
                    : []

                // Remove consensus here as it has no scores
                // treeData = treeData.map(data => {
                //     return {
                //         ...data,
                //         children: data.children.filter(c => !c.value.includes('consensus'))
                //     }
                // })
                // initialTreeData = initialTreeData.filter(node => !node.includes('consensus'))

                if (cancelled) return;
                setTreeData(treeData);
                setInitialTreeData(initialTreeData);
                setValue(initialTreeData);

            } catch (error) {
                console.error("Error fetching data:", error);
                if (!cancelled) setTreeFailed(true);
            } finally {
                if (!cancelled) setLoadingTree(false);
            }
        }

        fetchData();
        return () => { cancelled = true; };
    }, [analysisId]);

    useEffect(() => {
        const tmp = [...Object.keys(result)]
        setSortingOptions(tmp)
        if (tmp.length <= 0) return;
        setAnalysisMethod(tmp[0])
    }, [result]);

    const onChange = (newValue) => {
        setValue(newValue);
    };

    const tProps = {
        treeData: treeData.map(e => ({
            ...e,
            children: e.children.map(c => ({
                ...c,
                title: c.title.split('_')[c.title.split('_').length - 1],
            }))
        })),
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    const handlePointClick = (label) => {
        onForestPointClick(label);
    };

    // let sortingOptions = ["rank_aggregation", ...Object.keys(result)];

    // if (Object.keys(result).length === 0 || treeData.length === 0 || initialTreeData.length === 0 || selectedPathways.length === 0 || value.length === 0) {
    //     return "Loading";
    // }

    // Loading only while the fetches are in flight. Once both have settled, a
    // genuinely empty result shows a no-data message instead of looping forever —
    // and a fetch that FAILED now says so rather than borrowing the empty-result copy.
    //
    // `hasData` keeps this pane's own predicate. It is stricter than NegBarChartTable's, which
    // omits the initialTreeData clause; that divergence predates this change (the commented-out
    // guards above both panes show it) and treeData/initialTreeData are filtered from two
    // different arrays by two different predicates, so they can genuinely disagree. Not unified.
    const displayState = computeFetchedPlotState({
        loading: loadingResult || loadingTree,
        failed: resultFailed || treeFailed,
        hasData: Object.keys(result).length > 0 && treeData.length > 0 && initialTreeData.length > 0,
    });
    if (displayState === 'loading') {
        return <PlotLoading/>;
    }
    if (displayState !== 'ready') {
        return <div>{PLOT_STATE_MESSAGES[displayState]}</div>;
    }

    return (
        (
            <>
                <TreeSelect {...tProps} />
                <div style={{marginTop: '15px'}}>
                    <span>Sorted by: </span>
                    <Select
                        value={analysisMethod}
                        style={{width: 240}}
                        onChange={(value) => {
                            setAnalysisMethod(value);
                        }}
                        options={sortingOptions.map((e) => {
                            return (e === "rank_aggregation") ? {
                                label: "Rank aggregation",
                                value: e,
                            } : {
                                label: e.toUpperCase(),
                                value: e,
                            };
                        })}
                    />
                </div>
                <ForestChart result={result} geneSet={geneSet} selectedPathways={selectedPathways}
                             selectedMethods={value} onPointClick={handlePointClick}></ForestChart>
                <SelectableResult
                    analysisId={analysisId}
                    inputType={inputType}
                    sessionId={sessionId}
                    isRunnable={false}
                    selectType={selectType}
                    onRowSelectionChange={(record, selected, selectedRows) => {
                        setSelectedPathways(selectedRows.map(e => e.pathway));
                    }}
                    onRowSelectAllChange={(selected, selectedRows, changeRows) => {
                        setSelectedPathways(selectedRows.map(e => e.pathway));
                    }}
                    databaseIds={[geneSet.id]}
                    selectedPathways={selectedPathways}
                    selectedMethod={analysisMethod}
                />
            </>
        )
    );
};
const InViewForestChartTable = inViewRender(ForestChartTable);

const NegBarChartTable = ({
                              analysisId,
                              inputType,
                              geneSet,
                              sessionId,
                              selectType,
                              onBarPointClick
                          }) => {
    const [result, setResult] = useState([]);
    const [value, setValue] = useState([]);
    let [selectedPathways, setSelectedPathways] = useState([]);
    let [analysisMethod, setAnalysisMethod] = useState("rank_aggregation");
    const [treeData, setTreeData] = useState([]);
    const [initialTreeData, setInitialTreeData] = useState([]);
    // Separate flags for the two async fetches so "loading" is distinct from a
    // genuinely empty result (which previously got stuck on "Loading" forever).
    const [loadingResult, setLoadingResult] = useState(true);
    const [loadingTree, setLoadingTree] = useState(true);
    // "We never got the data" and "there is genuinely nothing" rendered the same message before,
    // so a dropped request was indistinguishable from an empty result.
    const [resultFailed, setResultFailed] = useState(false);
    const [treeFailed, setTreeFailed] = useState(false);
    const [sortingOptions, setSortingOptions] = useState([])

    useEffect(() => {
        // Cancellation guard, as on the Circos fetch. This effect does not currently re-run (see
        // the dep-array note below), but the flag still stops a resolution after unmount writing
        // state, and keeps the idiom identical across all four fetches in these two panes.
        let cancelled = false;
        async function fetchData() {
            setLoadingTree(true);
            setTreeFailed(false);
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/treeData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resultTree = await response.json();
                // Same unguarded two-level index as the result fetch below, and the same false
                // negative when this database is absent from the payload: the throw was caught and
                // the pane reported "no significant pathways".
                const treeForDb = resultTree?.treeData?.[geneSet.id];
                const initialForDb = resultTree?.initialTreeData?.[geneSet.id];
                let treeData = Array.isArray(treeForDb)
                    ? treeForDb.filter(e => e.key === analysisId)
                    : []
                let initialTreeData = Array.isArray(initialForDb)
                    ? initialForDb.filter(e => e.split("_")[0] === analysisId)
                    : []

                // Remove consensus here as it has no scores
                // treeData = treeData.map(data => {
                //     return {
                //         ...data,
                //         children: data.children.filter(c => !c.value.includes('consensus'))
                //     }
                // })
                // initialTreeData = initialTreeData.filter(node => !node.includes('consensus'))

                if (cancelled) return;
                setTreeData(treeData);
                setInitialTreeData(initialTreeData);
                setValue(initialTreeData);
            } catch (error) {
                console.error("Error fetching data:", error);
                if (!cancelled) setTreeFailed(true);
            } finally {
                if (!cancelled) setLoadingTree(false);
            }
        }

        fetchData();
        return () => { cancelled = true; };
        // NOTE the empty dep array, unlike ForestChartTable's `[analysisId]` on the same fetch:
        // this pane keeps the tree of whatever analysis it first mounted with. That divergence is
        // pre-existing and is left alone here — changing it alters what the pane shows after an
        // analysis switch, which is a behavioural change and not this commit's subject.
    }, []);

    useEffect(() => {
        // Guards against out-of-order completions, as the Circos fetch does: this effect re-runs on
        // analysisId, and a superseded response must neither overwrite the newer result nor clear
        // the loading flag from its `finally` while the current request is still in flight — which
        // would un-gate the empty-state message mid-fetch.
        let cancelled = false;
        async function fetchData() {
            setLoadingResult(true);
            setResultFailed(false);
            let args = {
                analysisId
            };
            try {
                const response = await fetch2(`/api/resultData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                // Was `resJson[geneSet.id][analysisId]`. When this analysis had no rows for this
                // database that indexed undefined and threw INTO the catch below, which logged and
                // moved on, leaving `result` empty — so the pane reported "no significant pathways"
                // for a study that may well have had them.
                if (cancelled) return;
                setResult(methodResultsOrEmpty(resJson, geneSet.id, analysisId));
            } catch (error) {
                console.error("Error fetching data:", error);
                if (!cancelled) setResultFailed(true);
            } finally {
                if (!cancelled) setLoadingResult(false);
            }
        }

        fetchData();
        return () => { cancelled = true; };
    }, [analysisId]);

    useEffect(() => {
        if (result.length === 0) return;

        let rankedPathwayIds = [];
        if (analysisMethod === "rank_aggregation") {
            if (initialTreeData.length > 1) {
                rankedPathwayIds = RankPathways.rankPathwaysObjectByCriteriaMultiAnalysis(result, "pValueFDR", 300);
            } else {
                let currentAnalysisMethod = Object.keys(result)[0];
                setAnalysisMethod(currentAnalysisMethod);
            }
        } else {
            // Because bar plot draw from top to bottom, need to reverse the order
            rankedPathwayIds = result[analysisMethod].sort((a, b) => a.pValue - b.pValue).slice(0, 300).map(e => e.pathway).reverse();
        }
        // rankedPathwayIds = rankedPathwayIds.reverse();
        setSelectedPathways(rankedPathwayIds);
    }, [result, analysisMethod]);

    useEffect(() => {
        const tmp = [...Object.keys(result)]
        setSortingOptions(tmp)
        if (tmp.length <= 0) return;
        setAnalysisMethod(tmp[0])
    }, [result])

    const onChange = (newValue) => {
        setValue(newValue);
    };

    const handlePointClick = (label) => {
        // console.log('Clicked on point with label:', label);
        onBarPointClick(label);
    };

    const tProps = {
        treeData: treeData.map(e => ({
            ...e,
            children: e.children.map(c => ({
                ...c,
                title: c.title.split('_')[c.title.split('_').length - 1]
            }))
        })),
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    // let sortingOptions = ["rank_aggregation", ...Object.keys(result)];

    // if (Object.keys(result).length === 0 || treeData.length === 0 || value.length === 0) {
    //     return "Loading";
    // }

    // Loading only while the fetches are in flight. Once both have settled, a
    // genuinely empty result shows a no-data message instead of looping forever —
    // and a fetch that FAILED now says so rather than borrowing the empty-result copy.
    //
    // `hasData` keeps this pane's own predicate: unlike ForestChartTable it does NOT require
    // initialTreeData. That divergence predates this change (see the commented-out guards above
    // both panes) and is left alone rather than unified.
    const displayState = computeFetchedPlotState({
        loading: loadingResult || loadingTree,
        failed: resultFailed || treeFailed,
        hasData: Object.keys(result).length > 0 && treeData.length > 0,
    });
    if (displayState === 'loading') {
        return <PlotLoading/>;
    }
    if (displayState !== 'ready') {
        return <div>{PLOT_STATE_MESSAGES[displayState]}</div>;
    }

    return (
        (
            <>
                <TreeSelect {...tProps} />
                <div style={{marginTop: '15px'}}>
                    <span>Sorted by: </span>
                    <Select
                        value={analysisMethod}
                        style={{width: 240}}
                        onChange={(value) => {
                            setAnalysisMethod(value);
                        }}
                        options={sortingOptions.map((e) => {
                            return (e === "rank_aggregation") ? {
                                label: "Rank aggregation",
                                value: e,
                            } : {
                                label: e.toUpperCase(),
                                value: e,
                            };
                        })}
                    />
                </div>
                <NegBarChart result={result} geneSet={geneSet} selectedPathways={selectedPathways}
                             selectedMethods={value} onPointClick={handlePointClick}></NegBarChart>
                <SelectableResult
                    analysisId={analysisId}
                    inputType={inputType}
                    sessionId={sessionId}
                    isRunnable={false}
                    selectType={selectType}
                    onRowSelectionChange={(record, selected, selectedRows) => {
                        setSelectedPathways(selectedRows.map(e => e.pathway));
                    }}
                    onRowSelectAllChange={(selected, selectedRows, changeRows) => {
                        setSelectedPathways(selectedRows.map(e => e.pathway));
                    }}
                    databaseIds={[geneSet.id]}
                    selectedPathways={selectedPathways}
                    selectedMethod={analysisMethod}
                />
            </>
        )
    );
};

const InViewNegBarChartTable = inViewRender(NegBarChartTable);

const KEGGMap = ({
                     analysisId,
                     inputType,
                     sessionId,
                     genesMappedInput,
                     genesMappedBackground,
                     selectType,
                     geneSet,
                     inputData,
                     config
                 }) => {
    let [pathwayId, setPathwayId] = useState([])
    let [mode, setMode] = useState("fc");
    const [isChecked, setIsChecked] = useState(false);
    const [pValueThreshold, setPValueThreshold] = useState(0.05);
    // null, not [], so "not fetched yet" is representable. As an empty ARRAY this passed the
    // consensus fallback's `typeof results === 'object'` guard while `Object.keys([])` came back
    // empty, so the very first effect run concluded "no pathways" from data that had not arrived.
    const [results, setResults] = useState(null);
    // Distinguish "still fetching consensus pathways" from "genuinely none found".
    const [loadingConsensus, setLoadingConsensus] = useState(true);
    // The consensus fallback reads `results`; keep the loader up until that fetch
    // resolves too, so we never flash "no pathways" before results are in.
    const [loadingResults, setLoadingResults] = useState(true);
    // "We never got the data" is a different fact from "there is genuinely nothing", and rendering
    // the second for the first is what let this bug hide. Both fetches report their own failure.
    const [resultsFailed, setResultsFailed] = useState(false);
    const [consensusFailed, setConsensusFailed] = useState(false);
    const [fcPValueData, setFcPValueData] = useState([])
    const [actualMethod, setActualMethod] = useState('consensus');
    const [threshold, setThreshold] = useState({
        maxAdjustedPValue: 0.05,
        minLogFoldChange: 0.5
    })
    const [displayThreshold, setDisplayThreshold] = useState({
        maxAdjustedPValue: 0.05,
        minLogFoldChange: 0.5
    })

    if (geneSet.name !== "KEGG") {
        return null
    }

    const options = [
        {
            label: "Log2FC",
            value: "fc"
        },
        {
            label: "pValue.FDR",
            value: "pValueFDR"
        },
    ]

    useEffect(() => {
        setThreshold({
            maxAdjustedPValue: config.maxAdjustedPValue,
            minLogFoldChange: config.minLogFoldChange
        })
        setDisplayThreshold({
            maxAdjustedPValue: config.maxAdjustedPValue,
            minLogFoldChange: config.minLogFoldChange
        })
    }, [config]);

    useEffect(() => {
        // Same out-of-order guard as the Circos fetch above: this effect re-runs on analysisId, and
        // a slow earlier response must neither overwrite newer results nor clear the loading flag
        // from its `finally` while the current request is still in flight.
        let cancelled = false;
        async function fetchData() {
            setLoadingResults(true);
            setResultsFailed(false);
            let args = {
                analysisId
            };
            try {
                const response = await fetch2(`/api/resultData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                if (cancelled) return;
                // Was `resJson[geneSet.id][analysisId]`, which THREW into the catch below whenever
                // this analysis had no rows for this database — leaving `results` at its initial
                // value and the pane claiming there were no significant pathways. A null here is a
                // successful "nothing for this database", NOT a failure, so it does not set
                // resultsFailed: the consensus branch may still have pathways to show.
                setResults(extractMethodResults(resJson, geneSet.id, analysisId));
            } catch (error) {
                console.error("Error fetching data:", error);
                if (!cancelled) {
                    setResults(null);
                    setResultsFailed(true);
                }
            } finally {
                if (!cancelled) setLoadingResults(false);
            }
        }

        fetchData();
        return () => { cancelled = true; };
    }, [analysisId, geneSet.id]);

    useEffect(() => {
        async function fetchData() {
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                setFcPValueData(resJson);
            } catch (error) {
                console.error("Error fetching data:", error);
            }
        }

        fetchData();
    }, []);

    useEffect(() => {
        // THE ORDERING FIX. This effect re-runs when `results` arrives, so it issues the SAME
        // Meteor call twice per mount: once with no fallback data, once with it. That method calls
        // this.unblock() (server/api/methods/visualization.js), which drops DDP's per-connection
        // ordering guarantee, so the two invocations run concurrently on the server and can return
        // out of order — and the first one, computed with no results, would then overwrite the
        // second one's good selection. React runs this cleanup before the next run's body, so the
        // superseded call can no longer write state or clear the loading flag.
        let cancelled = false;
        async function fetchConsensusData() {
          // Re-raise the loader for THIS run. Without it the first run's `finally` leaves the pane
          // un-gated while the second is still in flight, which is a visible flash of the empty
          // state rather than a wrong final answer.
          setLoadingConsensus(true);
          setConsensusFailed(false);
          try {
            const consensusResults = await Meteor.callAsync('visualization.getConsensusAnalysisResult', {
                // enrichmentMethods: initialMethods,
                analysisId: analysisId,
                databaseId: geneSet.id
            });

            if (cancelled) return;

            // Consensus first, else the first non-empty per-method result. Extracted so the
            // "[undefined] is a length-1 array no length check catches" trap is unrepresentable
            // and unit-testable; see imports/utils/pathwaySelection.js.
            const {pathwayIds, methodUsed} = selectConsensusPathwayIds(consensusResults, results);
            setActualMethod(methodUsed);
            // ONE pathway, matching the previous behaviour exactly. The old code ranked the top 300
            // and then kept only `selectedPathways[0]`; this pane is a single-pathway view
            // (selectType='radio', and KeggChart resolves its map with
            // `String(pathwayId).match(/\d+/)`), so handing it the whole ranked list would break it.
            // The full ranking is still computed so the preselected pathway is the table's own top
            // row rather than whatever happened to arrive first.
            setPathwayId(pathwayIds.slice(0, 1));
          } catch (error) {
              console.error("Error fetching consensus data:", error);
              if (!cancelled) setConsensusFailed(true);
          } finally {
              if (!cancelled) setLoadingConsensus(false);
          }
        }

        fetchConsensusData();
        return () => { cancelled = true; };
    }, [analysisId, geneSet.id, results]);

    const onModeChange = ({target: {value}}) => {
        setMode(value);
    };

    const handleCheckboxChange = (e) => {
        setIsChecked(e.target.checked);
    };

    const handlePValueChange = (value) => {
        setPValueThreshold(value);
    };


    // `pathwayId.includes(undefined)` used to sit here. It was a patch for the producer storing
    // [undefined]; selectConsensusPathwayIds now makes that unrepresentable, so the test is gone
    // rather than kept "just in case" — leaving it would hide a regression instead of failing on it.
    const displayState = computeFetchedPlotState({
        loading: loadingConsensus || loadingResults,
        failed: consensusFailed || resultsFailed,
        hasData: pathwayId.length > 0,
    });
    if (displayState === 'loading') {
        return <PlotLoading/>;
    }
    if (displayState !== 'ready') {
        return <div>{PLOT_STATE_MESSAGES[displayState]}</div>;
    }

    const debounceChangeThreshold = _.debounce((value) => {
        setThreshold({...value});
    }, 1500)

    return (
        <>
            {/*{*/}
            {/*    (inputType === "expression") ? (*/}
            {/*        <>*/}
            {/*            /!*<Radio.Group style={{display: 'block'}} options={options} onChange={onModeChange} value={mode}*!/*/}
            {/*            /!*             optionType="button"/>*!/*/}
            {/*            <Checkbox checked={isChecked} onChange={handleCheckboxChange}>*/}
            {/*                Show only significant genes?*/}
            {/*            </Checkbox>*/}
            {/*        </>*/}
            {/*    ) : null*/}
            {/*}*/}
            {/*{isChecked && (*/}
            {/*    <div style={{marginTop: 8, display: "inline-block"}}>*/}
            {/*        <InputNumber*/}
            {/*            min={0}*/}
            {/*            max={1}*/}
            {/*            step={0.01}*/}
            {/*            defaultValue={pValueThreshold}*/}
            {/*            onChange={handlePValueChange}*/}
            {/*        />*/}
            {/*    </div>*/}
            {/*)}*/}
            <SelectableResult analysisId={analysisId} inputType={inputType}
                              sessionId={sessionId} isRunnable={false}
                              selectType={selectType}
                              onRowSelectionChange={(record, selected, selectedRows) => {
                                  setPathwayId(selectedRows.map(e => e.pathway))
                              }}
                              databaseIds={[geneSet.id]}
                              selectedPathways={pathwayId}
                              defaultActiveKey={["1"]}
                              selectedMethod={actualMethod}
            />

            <Space style={{marginTop: '10px'}}>
                <Space>
                    <Typography.Text>{'pValue.FDR ≤'}</Typography.Text>
                    <Input
                        type="number"
                        onChange={(e) => {
                            const tmpDisplayThreshold = {
                                ...displayThreshold,
                                maxAdjustedPValue: e.target.value
                            };
                            setDisplayThreshold(tmpDisplayThreshold)
                            debounceChangeThreshold(tmpDisplayThreshold)
                        }}
                        value={displayThreshold.maxAdjustedPValue}
                    />
                </Space>
                <Space>
                    <Typography.Text>{'Absolute Log2FC ≥'}</Typography.Text>
                    <Input
                        type="number"
                        onChange={(e) => {
                            const tmpDisplayThreshold = {
                                ...displayThreshold,
                                minLogFoldChange: e.target.value
                            }
                            setDisplayThreshold(tmpDisplayThreshold)
                            debounceChangeThreshold(tmpDisplayThreshold)
                        }}
                        value={displayThreshold.minLogFoldChange}
                    />
                </Space>
            </Space>

            <KeggChart
                analysisId={analysisId}
                genesMappedInput={genesMappedInput}
                genesMappedBackground={genesMappedBackground}
                pathwayId={pathwayId}
                inputType={inputType}
                inputData={inputData}
                fcPValueData={fcPValueData}
                mode={mode}
                showSignificant={isChecked}
                // threshold={pValueThreshold}
                threshold={threshold}
            ></KeggChart>
        </>
    )
}

const PathwayGraphComponentTable = ({
                                        analyses,
                                        configs,
                                        dbId,
                                        sessionId,
                                        analysisId,
                                        inputType,
                                    }) => {
    const [value, setValue] = useState([]);
    const [analysisData, setAnalysisData] = useState([]);
    const [treeData, setTreeData] = useState([]);
    const [geneSetWithGenes, setGeneSetWithGenes] = useState(null);

    // Fetch full custom gene set data for pathway network
    useEffect(() => {
        async function fetchGeneSet() {
            const geneSetSummary = configs.geneSets.find(e => e.id === dbId);
            console.log('[PathwayGraphTable] geneSetSummary:', geneSetSummary);

            // Check if this is a custom gene set using isCustom flag
            if (geneSetSummary && geneSetSummary.isCustom) {
                console.log('[PathwayGraphTable] Fetching full custom gene set');
                try {
                    let args = {analysisId, sessionId};
                    const response = await fetch2(`/api/customGeneSetsFull?args=${btoa(JSON.stringify(args))}`);
                    let resJson = await response.json();
                    console.log('[PathwayGraphTable] Fetched custom gene sets:', resJson);
                    const fullGeneSet = resJson.find(gs => gs.id === dbId);
                    console.log('[PathwayGraphTable] Matched fullGeneSet:', fullGeneSet);
                    if (fullGeneSet) {
                        setGeneSetWithGenes(fullGeneSet);
                    } else {
                        setGeneSetWithGenes(geneSetSummary);
                    }
                } catch (error) {
                    console.error("Error fetching full custom gene set:", error);
                    setGeneSetWithGenes(geneSetSummary);
                }
            } else {
                console.log('[PathwayGraphTable] Not a custom gene set, using summary');
                setGeneSetWithGenes(geneSetSummary);
            }
        }

        fetchGeneSet();
    }, [analysisId, dbId, sessionId]);

    useEffect(() => {
        async function fetchData() {
            let args = {
                analysisId
            };
            try {
                const response = await fetch2(`/api/resultsGroupedByDb?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resJson = await response.json();
                setAnalysisData(resJson[dbId].filter(e => e.analysisId === analysisId));
            } catch (error) {
                console.error("Error fetching data:", error);
            }
        }

        fetchData();
    }, [analysisId]);

    useEffect(() => {
        async function fetchData() {
            let args = {
                analysisId,
                sessionId
            };
            try {
                const response = await fetch2(`/api/treeData?args=${btoa(JSON.stringify(args))}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                let resultTree = await response.json();
                let treeData = resultTree.treeData[dbId].filter(e => e.key === analysisId)
                treeData = treeData.map(data => {
                    return {
                        ...data,
                        children: data.children.map(c => ({
                            ...c,
                            title: c.title.split('_')[c.title.split('_').length - 1],
                        }))
                    }
                })
                let initialTreeData = resultTree.initialTreeData[dbId].filter(e => e.split("_")[0] === analysisId)
                // Remove consensus here as it does not contain enrichment score
                // treeData = treeData.map(tree => ({
                //     ...tree,
                //     children: tree.children.filter(c => c.key.split("_")[1] !== 'consensus')
                // }))
                // initialTreeData = initialTreeData.filter(e => e.split("_")[1] !== 'consensus')
                setTreeData(treeData);
                setValue(initialTreeData);
            } catch (error) {
                console.error("Error fetching data:", error);
            }
        }

        fetchData();
    }, [analysisId, dbId]);

    const onChange = (newValue) => {
        setValue(newValue);
    };

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    let organismId = configs.organismId;

    if (!geneSetWithGenes || value.length === 0 || analysisData.length === 0) {
        // return "Loading"
        return "No Significant Pathways Found"
    }
    return (
        <>
            <TreeSelect {...tProps} />
            <MultiAnalysisPathwayGraphComponent
                geneSet={geneSetWithGenes}
                organismId={organismId}
                sessionId={sessionId}
                results={analysisData}
                selectedAnalysisMethods={value}
                analyses={analyses}
                dataSetAnalysisId={analysisId}
                dataSetInputType={inputType}
                visualMode={'single'}
            />
        </>
    );
};
const InViewPathwayGraphComponentTable = inViewRender(PathwayGraphComponentTable);

const HeatMapChartTable = ({
                               analyses,
                               configs,
                               dbId,
                               metaData,
                               metaAnalyses,
                               sessionId,
                               analysisResultsByDb,
                               setAnalyses
                           }) => {
    console.log("[PathwayHeatmap] Component rendered - dbId:", dbId, "configs:", configs.length, "analysisResultsByDb:", analysisResultsByDb?.length);
    const [value, setValue] = useState([]);
    const [treeData, setTreeData] = useState([]);
    const [allAnalysisData, setAllAnalysisData] = useState([])
    const [configsWithGeneSets, setConfigsWithGeneSets] = useState([])
    // const [analysisResultsByDb, setAnalysisResultsByDb] = useState([])
    const [isConfigUpdated, setIsConfigUpdated] = useState(false)

    // Get session data for metadata
    const analysesTracking = useTracker(() => {
        const handle = Meteor.subscribe('analysis.session', sessionId);
        if (!handle.ready()) {
            return null;
        }

        return DBCollections.Session.find({_id: sessionId}).fetch();
    }, [sessionId])

    // Extract metadata from analyses
    const analysesMetadata = useMemo(() => {
        if (!analysesTracking || analysesTracking.length === 0) return {};

        const session = analysesTracking[0];
        const metadata = {};

        // Build metadata map from session analyses
        if (session.analyses) {
            session.analyses.forEach(analysis => {
                if (analysis.metadata && analysis.metadata.extracted) {
                    metadata[analysis.name] = analysis.metadata.extracted;
                }
            });
        }

        console.log('[HeatMapChartTable] Extracted metadata for', Object.keys(metadata).length, 'analyses');
        return metadata;
    }, [analysesTracking])
    //
    // useEffect(() => {
    //     // Listen to changes in metaData and update treeData accordingly
    //     async function fetchData() {
    //         let args = {
    //             sessionId
    //         };
    //         try {
    //             const response = await fetch2(`/api/resultsGroupedByDbAll?args=${btoa(JSON.stringify(args))}`);
    //             if (!response.ok) {
    //                 throw new Error(`HTTP error! status: ${response.status}`);
    //             }
    //             let resJson = await response.json();
    //             console.log("right here:", resJson[dbId])
    //             setAnalysisResultsByDb(resJson[dbId]);
    //         } catch (error) {
    //             console.error("Error fetching data:", error);
    //         }
    //     }
    //
    //     fetchData()
    // }, [sessionId, sessionMetaAnalyses]);

    useEffect(() => {
        console.log("[PathwayHeatmap] analysisResultsByDb length:", analysisResultsByDb.length, "dbId:", dbId);
        if (analysisResultsByDb.length === 0) {
            console.log("[PathwayHeatmap] No pathway results available for database", dbId);
            return;
        }
        analyses = metaAnalysisUtils.combineNormalWithMetaAnalyses(analyses, metaAnalyses)

        let allAnalysisData = metaAnalysisUtils.combineNormalAnalysisResultsWithMetaAnalysisResults(analysisResultsByDb, metaData, dbId)
        console.log("[PathwayHeatmap] allAnalysisData length:", allAnalysisData.length);
        setAllAnalysisData(allAnalysisData)
        let {treeData, initialTreeData} = metaAnalysisUtils.createTreeDataForAnalyses(allAnalysisData, analyses)
        console.log("[PathwayHeatmap] treeData length:", treeData.length, "initialTreeData length:", initialTreeData.length);
        setTreeData(treeData)
        setValue(initialTreeData)
    }, [analysisResultsByDb, analyses]);

    useEffect(() => {
        async function fetchData2() {
            console.log("[PathwayHeatmap] Starting to fetch gene sets for", configs.length, "configs");
            const fetchPromises = configs.map(async (config) => {
                let args = {
                    sessionId,
                    analysisId: config.analysisId,
                };
                try {
                    const response = await fetch2(`/api/analysisGeneSetAll?args=${btoa(JSON.stringify(args))}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let resJson = await response.json();
                    console.log("[PathwayHeatmap] Fetched gene sets for", config.analysisId, "count:", resJson?.length || 0);
                    return {...config, geneSets: resJson || []};
                } catch (error) {
                    console.error("[PathwayHeatmap] Error fetching gene sets for", config.analysisId, error);
                    return {...config, geneSets: []}; // Always include geneSets property
                }
            });

            try {
                const updatedConfigs = await Promise.all(fetchPromises);
                setConfigsWithGeneSets(updatedConfigs);
                console.log("[PathwayHeatmap] All gene sets fetched, setting isConfigUpdated=true");
                setIsConfigUpdated(true);
            } catch (error) {
                console.error("[PathwayHeatmap] Error in Promise.all:", error);
            }
        }

        fetchData2();
    }, [sessionId]);
    const onChange = (newValue) => {
        setValue(newValue);
    };

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    if (value.length === 0 || isConfigUpdated === false) {
        console.log("[PathwayHeatmap] Showing Loading state - value.length:", value.length, "isConfigUpdated:", isConfigUpdated);
        return (
            <div style={{padding: '20px'}}>
                <Spin tip="Loading pathway data...">
                    <div style={{padding: '50px'}} />
                </Spin>
            </div>
        );
    }
    console.log("[PathwayHeatmap] Rendering heatmap with value.length:", value.length);
    return (
        <>
            <TreeSelect {...tProps} />
            <HeatmapChart
                analysisResultsByDb={allAnalysisData}
                selectedAnalysisMethods={value}
                analysisNames={analyses}
                configs={configsWithGeneSets}
                dbId={dbId}
                analysesMetadata={analysesMetadata}
            ></HeatmapChart>
        </>
    )
}
const InViewHeatMapChartTable = inViewRender(HeatMapChartTable);

const FunnelPlotChartTable = ({
                                  analyses,
                                  configs,
                                  dbId,
                                  metaData,
                                  metaAnalyses,
                                  sessionId,
                                  analysisResultsByDb
                              }) => {
    const [value, setValue] = useState([]);
    const [treeData, setTreeData] = useState([]);
    const [configsWithGeneSets, setConfigsWithGeneSets] = useState([])
    const [isConfigUpdated, setIsConfigUpdated] = useState(false)

    useEffect(() => {
        async function fetchData2() {
            const fetchPromises = configs.map(async (config) => {
                let args = {
                    sessionId,
                    analysisId: config.analysisId,
                };
                try {
                    const response = await fetch2(`/api/analysisGeneSetAll?args=${btoa(JSON.stringify(args))}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let resJson = await response.json();
                    return {...config, geneSets: resJson};
                } catch (error) {
                    console.error("Error fetching data:", error);
                    return config;
                }
            });

            try {
                const updatedConfigs = await Promise.all(fetchPromises);
                setConfigsWithGeneSets(updatedConfigs);
                setIsConfigUpdated(true);
            } catch (error) {
                console.error("Error in Promise.all:", error);
            }
        }

        fetchData2();
    }, [sessionId]);

    useEffect(() => {
        const processedData = analysisResultsByDb.map((result) => {
            return result
        })

        const combinedAnalyses = {...analyses, ...metaAnalyses.reduce((acc, curr) => {
                acc[curr.id] = curr;
                return acc;
            }, {})}

        const treeData = Object.keys(combinedAnalyses).map((analysisId) => {
            const analysis = combinedAnalyses[analysisId];
            let analysisData = processedData.filter(e => e.analysisId === analysisId)

            if (analysisData.length === 0) return null;

            const children = analysisData.map((e) => ({
                title: e.key,
                value: analysisId + '_' + e.key
            }));

            return {
                title: analysis.name,
                value: analysisId,
                children: children,
                selectable: false,
                disableCheckbox: true
            };
        }).filter(Boolean);

        setTreeData(treeData);

        // Auto-select all options
        const allValues = treeData.flatMap(node =>
            node.children ? node.children.map(child => child.value) : []
        );
        setValue(allValues);
    }, [analysisResultsByDb, metaData, metaAnalyses]);

    const onChange = (newValue) => {
        setValue(newValue);
    };

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    if (value.length === 0 || isConfigUpdated === false) {
        return (
            <div style={{padding: '20px'}}>
                <Spin tip="Loading pathway data...">
                    <div style={{padding: '50px'}} />
                </Spin>
            </div>
        );
    }

    return (
        <>
            <FunnelPlotPathway
                configs={configsWithGeneSets}
                dbId={dbId}
                metaData={metaData}
            />
        </>
    )
}
const InViewFunnelPlotChartTable = inViewRender(FunnelPlotChartTable);

const MultiForestChart = ({analyses, configs, dbId, metaData, metaAnalyses, sessionId, analysisResultsByDb}) => {
    const [value, setValue] = useState([]);
    const [treeData, setTreeData] = useState([]);
    const [allAnalysisData, setAllAnalysisData] = useState([])
    const [combinedAnalyses, setCombinedAnalyses] = useState(analyses)
    const [configsWithGeneSets, setConfigsWithGeneSets] = useState([])
    // const [analysisResultsByDb, setAnalysisResultsByDb] = useState([])
    const [isConfigUpdated, setIsConfigUpdated] = useState(false)

    // useEffect(() => {
    //     async function fetchData() {
    //         let args = {
    //             sessionId
    //         };
    //         try {
    //             const response = await fetch2(`/api/resultsGroupedByDbAll?args=${btoa(JSON.stringify(args))}`);
    //             if (!response.ok) {
    //                 throw new Error(`HTTP error! status: ${response.status}`);
    //             }
    //             let resJson = await response.json();
    //             setAnalysisResultsByDb(resJson[dbId]);
    //         } catch (error) {
    //             console.error("Error fetching data:", error);
    //         }
    //     }
    //
    //     fetchData()
    // }, [sessionId]);

    useEffect(() => {
        async function fetchData2() {
            const fetchPromises = configs.map(async (config) => {
                let args = {
                    sessionId,
                    analysisId: config.analysisId,
                };
                try {
                    const response = await fetch2(`/api/analysisGeneSetAll?args=${btoa(JSON.stringify(args))}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let resJson = await response.json();
                    return {...config, geneSets: resJson};
                } catch (error) {
                    console.error("Error fetching data:", error);
                    return config; // Return the original config if there's an error
                }
            });

            try {
                const updatedConfigs = await Promise.all(fetchPromises);
                setConfigsWithGeneSets(updatedConfigs);
                setIsConfigUpdated(true);
            } catch (error) {
                console.error("Error in Promise.all:", error);
            }
        }

        fetchData2();
    }, [sessionId]);

    useEffect(() => {
        if (analysisResultsByDb.length === 0) return;
        const combined = metaAnalysisUtils.combineNormalWithMetaAnalyses(analyses, metaAnalyses)
        setCombinedAnalyses(combined)

        let allAnalysisData = metaAnalysisUtils.combineNormalAnalysisResultsWithMetaAnalysisResults(analysisResultsByDb, metaData, dbId)
        setAllAnalysisData(allAnalysisData)
        let {treeData, initialTreeData} = metaAnalysisUtils.createTreeDataForAnalyses(allAnalysisData, combined)
        setTreeData(treeData)
        setValue(initialTreeData)
    }, [analysisResultsByDb, analyses, metaAnalyses]);

    const onChange = (newValue) => {
        setValue(newValue);
    };

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    if (value.length === 0 || isConfigUpdated === false) {
        return "Loading"
    }
    return (
        <>
            <TreeSelect {...tProps} />
            <ForestChartMultiAnalysis analysisResultsByDb={allAnalysisData} selectedAnalysisMethods={value}
                                      analysisNames={combinedAnalyses} configs={configsWithGeneSets} dbId={dbId}></ForestChartMultiAnalysis>
        </>
    )

}
const InViewMultiForestChart = inViewRender(MultiForestChart);

const VennDiagramChart = ({configs, analyses, metaAnalysis, sessionId}) => {
    const [vennData, setVennData] = useState([])
    const [treeData, setTreeData] = useState([]);
    const [value, setValue] = useState([]);
    const [pValueType, setPValueType] = useState('pValue'); // 'pValue' or 'pValueFDR'
    const [pValueThreshold, setPValueThreshold] = useState(0.05);

    useEffect(() => {
        async function fetchData() {
            if (Object.keys(configs).length > 0 && Object.keys(analyses).length > 0) {
                let expressionData = Object.values(configs).filter(e => e.inputType === "expression" || e.inputType === "pgsea")
                for (let i = 0; i < expressionData.length; i++) {
                    let args = {
                        analysisId: expressionData[i].analysisId,
                        sessionId
                    };
                    try {
                        const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        let resJson = await response.json();
                        expressionData[i].fcPValueData = resJson;
                    } catch (error) {
                        console.error("Error fetching data:", error);
                    }
                }
                // Filter genes based on selected p-value type and threshold
                let vennDataRes = expressionData.map(e => {
                    return {
                        label: analysisDisplayName(analyses, e.analysisId, e.name),
                        values: e.fcPValueData.filter(gene => gene[pValueType] < pValueThreshold).sort((a, b) => a[pValueType] - b[pValueType]).map(e => e.id),
                        analysisId: e.analysisId
                    }
                })
                if (metaAnalysis.length > 0) {
                    let metaAnalysisData = metaAnalysis.map(meta => {
                        return {
                            label: meta.name,
                            values: meta.value.filter(e => e[pValueType] < pValueThreshold).sort((a, b) => a[pValueType] - b[pValueType]).map(e => e.ID.toString()),
                            analysisId: meta.analysisId
                        }
                    })
                    vennDataRes = vennDataRes.concat(metaAnalysisData)
                }

                let treeDataRes = vennDataRes.map(e => {
                    return {
                        title: e.label,
                        value: e.analysisId,
                        key: e.analysisId
                    }
                })
                let initialTreeData = vennDataRes.map(e => e.analysisId)

                setValue(initialTreeData)
                setVennData(vennDataRes)
                setTreeData(treeDataRes)
            }
        }

        fetchData();
    }, [configs, analyses, metaAnalysis, pValueType, pValueThreshold]);

    if (vennData.length === 0) {
        return "Loading"
    }

    const onChange = (newValue) => {
        setValue(newValue);
    }

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_PARENT,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };


    return (
        <>
            <div style={{marginBottom: '16px', padding: '0 20px'}}>
                <Space size="large">
                    <Space>
                        <label>P-value type:</label>
                        <Radio.Group value={pValueType} onChange={(e) => setPValueType(e.target.value)}>
                            <Radio.Button value="pValue">Raw p-value</Radio.Button>
                            <Radio.Button value="pValueFDR">FDR (adjusted)</Radio.Button>
                        </Radio.Group>
                    </Space>
                    <Space>
                        <label>Threshold:</label>
                        <InputNumber
                            min={0}
                            max={1}
                            step={0.01}
                            value={pValueThreshold}
                            onChange={(val) => setPValueThreshold(val)}
                            style={{width: 100}}
                        />
                    </Space>
                </Space>
            </div>
            <TreeSelect {...tProps} />
            <VennDiagram inputData={vennData} selectedDatasets={value}></VennDiagram>
        </>
    )
}
const InViewVennDiagramChart = inViewRender(VennDiagramChart);

// The fdrThreshold = 0.05 / scoreThreshold = 1.5 prop defaults are gone: no caller ever passed them,
// so the filter silently ran at those constants while the controls drawn by VennDiagramPathway
// changed nothing. The thresholds are now state here, set by those controls.
// const VennDiagramPathwayChart = ({configs, analyses, analysisResultsByDb, dbId, dbName, metaData, metaAnalyses, fdrThreshold = 0.05, scoreThreshold = 1.5}) => {
const VennDiagramPathwayChart = ({configs, analyses, analysisResultsByDb, dbId, dbName, metaData, metaAnalyses}) => {
    const [vennData, setVennData] = useState([])
    const [treeData, setTreeData] = useState([]);
    const [value, setValue] = useState([]);
    // True once we've actually computed against ready inputs — lets us tell
    // "still loading" apart from "computed, no significant pathways".
    const [computed, setComputed] = useState(false);
    // Whether there is any pathway row at all before filtering, so "this database has no results"
    // can be told apart from "the thresholds exclude everything".
    const [hasAnyPathways, setHasAnyPathways] = useState(false);

    // Filter state lives here, not in VennDiagramPathway, because both the analysis picker below and
    // the diagram are built from the filtered sets: keeping one source means the picker can never
    // list an analysis the diagram doesn't draw.
    const { globalSettings } = useGlobalSettings();
    const [enableSignificantFilter, setEnableSignificantFilter] = useState(true);
    const [fdrThreshold, setFdrThreshold] = useState(globalSettings.pValueFDR);
    const [scoreThreshold, setScoreThreshold] = useState(globalSettings.enrichmentScore);

    useEffect(() => {
        setFdrThreshold(globalSettings.pValueFDR);
        setScoreThreshold(globalSettings.enrichmentScore);
    }, [globalSettings]);

    useEffect(() => {
        if (!analysisResultsByDb || !configs || Object.keys(configs).length === 0) {
            // Inputs not provided yet — keep showing the loader.
            return;
        }
        if (analysisResultsByDb.length === 0) {
            // Inputs provided but empty — resolved with no data.
            setVennData([]);
            setTreeData([]);
            setValue([]);
            setHasAnyPathways(false);
            setComputed(true);
            return;
        }

        // Combine normal analyses with meta-analyses (same approach as HeatMapChartTable)
        let combinedAnalyses = metaAnalysisUtils.combineNormalWithMetaAnalyses({...analyses}, metaAnalyses || []);
        let allAnalysisData = metaAnalysisUtils.combineNormalAnalysisResultsWithMetaAnalysisResults(
            analysisResultsByDb,
            metaData || [],
            dbId
        );

        // Group by analysisId
        let groupedByAnalysis = {};
        allAnalysisData.forEach(item => {
            if (!groupedByAnalysis[item.analysisId]) {
                groupedByAnalysis[item.analysisId] = [];
            }
            groupedByAnalysis[item.analysisId].push(...item.value);
        });

        // Filter pathways by significance criteria and create venn data
        let vennDataRes = Object.keys(groupedByAnalysis).map(analysisId => {
            const pathways = groupedByAnalysis[analysisId];
            // Was `p.pValueFDR < fdrThreshold && Math.abs(p.score) > scoreThreshold`. IPSA reads
            // "FDR <= x and |Score| >= y" everywhere, and the checkbox can now turn the filter off.
            const significantPathways = pathways
                .filter(p => !enableSignificantFilter
                    || passesSignificance(p, {fdr: fdrThreshold, score: scoreThreshold}))
                .map(p => p.pathway);

            return {
                label: combinedAnalyses[analysisId]?.name || analysisId,
                values: significantPathways,
                analysisId: analysisId
            };
        }).filter(item => item.values.length > 0); // Only include analyses with significant pathways

        let treeDataRes = vennDataRes.map(e => {
            return {
                title: e.label,
                value: e.analysisId,
                key: e.analysisId
            }
        })
        let initialTreeData = vennDataRes.map(e => e.analysisId)

        setValue(initialTreeData)
        setVennData(vennDataRes)
        setTreeData(treeDataRes)
        setHasAnyPathways(Object.values(groupedByAnalysis).some(list => list.length > 0))
        setComputed(true)
    }, [configs, analyses, analysisResultsByDb, dbId, metaData, metaAnalyses, enableSignificantFilter, fdrThreshold, scoreThreshold]);

    if (!computed) {
        return <PlotLoading/>
    }
    // Only when there is nothing to filter. When the thresholds exclude everything,
    // VennDiagramPathway still renders its controls (with a message) so the user can loosen them.
    if (!hasAnyPathways) {
        return <div>No pathway results for this database.</div>
    }

    const onChange = (newValue) => {
        setValue(newValue);
    }

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_PARENT,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };


    return (
        <>
            <TreeSelect {...tProps} />
            <VennDiagramPathway
                inputData={vennData}
                selectedDatasets={value}
                configs={Object.values(configs)}
                dbId={dbId}
                dbName={dbName}
                enableSignificantFilter={enableSignificantFilter}
                setEnableSignificantFilter={setEnableSignificantFilter}
                fdrThreshold={fdrThreshold}
                setFdrThreshold={setFdrThreshold}
                scoreThreshold={scoreThreshold}
                setScoreThreshold={setScoreThreshold}
            />
        </>
    )
}
const InViewVennDiagramPathwayChart = inViewRender(VennDiagramPathwayChart);

// metaDE rows come in two shapes: meta.analysis.DE.compute writes enriched rows with `pValueFDR`,
// older results hold the raw R rows with only `pFDR`. Read the FDR from whichever is present.
const metaGeneFdr = (row) => Number.isFinite(row?.pValueFDR) ? row.pValueFDR : row?.pFDR;

const HeatmapGeneChart = ({configs, analyses, metaData, sessionId}) => {
    const { globalSettings } = useGlobalSettings();
    const [sortedData, setSortedData] = useState([])
    const [sortedGenes, setSortedGenes] = useState([])
    const [geneSource, setGeneSource] = useState('meta') // 'meta', 'individual', or 'both'
    const [minDatasetsThreshold, setMinDatasetsThreshold] = useState(1) // Minimum datasets where gene must be significant
    const [topNGenes, setTopNGenes] = useState('all') // Top N genes to display
    const [consistencyPercent, setConsistencyPercent] = useState(0) // Minimum % of studies where gene must be significant
    const pValueType = 'pValueFDR'; // Always use FDR (adjusted)
    const pValueThreshold = globalSettings.pValueFDR; // Get from global settings

    useEffect(() => {
        async function fetchData() {
            if (metaData.length > 0) {
                let expressionData = Object.values(configs).filter(e => e.inputType === "expression" || e.inputType === "pgsea")

                for (let i = 0; i < expressionData.length; i++) {
                    let args = {
                        analysisId: expressionData[i].analysisId,
                        sessionId
                    };
                    try {
                        const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        let resJson = await response.json();
                        expressionData[i].fcPValueData = resJson;
                    } catch (error) {
                        console.error("Error fetching data:", error);
                    }
                }

                // Step 1: Determine gene list based on gene source selection
                let finalGeneList = []

                if (geneSource === 'meta' || geneSource === 'both') {
                    // Get genes from meta-analysis
                    let filteredMetaData = metaData.map(e => {
                        return {
                            ...e,
                            // Was `e[pValueType]` in the filter and `e.pFDR` in the map: each half only
                            // worked for one row shape (see metaGeneFdr).
                            value: e.value.filter(e => metaGeneFdr(e) <= pValueThreshold).map(e => {
                                return {
                                    id: e.ID.toString(),
                                    FC: e.logFC,
                                    pValueFDR: metaGeneFdr(e),
                                    pValue: e.pValue
                                }
                            })
                        }
                    })

                    let metaGenes = filteredMetaData[0].value.sort((a, b) => a[pValueType] - b[pValueType])

                    // Apply top N filter for meta genes
                    if (topNGenes !== 'all') {
                        const limit = parseInt(topNGenes)
                        metaGenes = metaGenes.slice(0, limit)
                    }

                    finalGeneList = metaGenes.map(e => e.id)
                }

                if (geneSource === 'individual' || geneSource === 'both') {
                    // Get genes from individual studies
                    const individualGenesSet = new Set()

                    expressionData.forEach((study, idx) => {
                        console.log(`Study ${idx}: fcPValueData exists?`, !!study.fcPValueData,
                                    `isArray?`, Array.isArray(study.fcPValueData),
                                    `length:`, study.fcPValueData?.length)
                        if (study.fcPValueData && Array.isArray(study.fcPValueData)) {
                            // Check first gene structure
                            if (idx === 0 && study.fcPValueData.length > 0) {
                                console.log('First gene structure:', study.fcPValueData[0])
                            }
                            const significantGenes = study.fcPValueData.filter(gene =>
                                gene && gene.pValueFDR <= pValueThreshold
                            )
                            console.log(`Study ${idx}: ${significantGenes.length} significant genes (pValueFDR <= ${pValueThreshold})`)
                            significantGenes.forEach(gene => individualGenesSet.add(gene.id))
                        }
                    })

                    let individualGenes = Array.from(individualGenesSet)

                    if (geneSource === 'individual') {
                        // Only individual genes
                        finalGeneList = individualGenes
                        console.log(`Individual genes found: ${individualGenes.length}`)
                    } else {
                        // Both: combine meta + individual (union)
                        const combinedSet = new Set([...finalGeneList, ...individualGenes])
                        finalGeneList = Array.from(combinedSet)
                        console.log(`Combined genes (meta + individual): ${finalGeneList.length}`)
                    }
                }

                console.log(`Final gene list before consistency filter: ${finalGeneList.length}`)
                let sortedGenesFromMetaAnalysisSet = new Set(finalGeneList)
                // filter only gene id from sortedGenesFromMetaAnalysisSet for each analysis of expressionData
                let analysesData = expressionData.map(e => {
                    return {
                        label: analysisDisplayName(analyses, e.analysisId, e.name),
                        values: e.fcPValueData.filter(e => sortedGenesFromMetaAnalysisSet.has(e.id))
                    }
                })

                // Step 2: Apply consistency filter (genes must be significant in X% of individual studies)
                if (consistencyPercent > 0) {
                    const numStudies = expressionData.length
                    const requiredStudies = Math.ceil(numStudies * (consistencyPercent / 100))

                    // Count how many studies each gene is significant in
                    const geneSignificanceCount = {}
                    finalGeneList.forEach(geneId => {
                        geneSignificanceCount[geneId] = 0
                        analysesData.forEach(study => {
                            const gene = study.values.find(g => g.id === geneId)
                            if (gene && gene.pValueFDR <= pValueThreshold) {
                                geneSignificanceCount[geneId]++
                            }
                        })
                    })

                    // Filter genes that appear in enough studies
                    finalGeneList = finalGeneList.filter(geneId => {
                        return geneSignificanceCount[geneId] >= requiredStudies
                    })
                    sortedGenesFromMetaAnalysisSet = new Set(finalGeneList)
                }

                // Step 3: Prepare data for meta-analysis results
                let filteredMetaData = metaData.map(e => {
                    return {
                        ...e,
                        // Same two-shape read as the gene-list block above (see metaGeneFdr).
                        value: e.value.filter(e => metaGeneFdr(e) <= pValueThreshold).map(e => {
                            return {
                                id: e.ID.toString(),
                                FC: e.logFC,
                                logFCSE: e.logFCSE,
                                pValueFDR: metaGeneFdr(e),
                                pValue: e.pValue
                            }
                        })
                    }
                })

                // sort the values field of each item of analysesData by finalGeneList
                let sortedAnalyseData = analysesData.map(e => {
                    return {
                        label: e.label,
                        values: finalGeneList.map(geneId => {
                            let gene = e.values.find(e => e.id === geneId)
                            return gene ? gene : {
                                id: geneId,
                                FC: 0,
                                logFCSE: 0,
                                pValueFDR: 1,
                                pValue: 1
                            }
                        })
                    }
                })
                // change the format of filteredMetaData to be the same as sortedAnalyseData
                let sortedMetaData = filteredMetaData.map(e => {
                    return {
                        label: e.name,
                        values: finalGeneList.map(geneId => {
                            let gene = e.value.find(e => e.id === geneId)
                            return gene ? gene : {
                                id: geneId,
                                FC: 0,
                                logFCSE: 0,
                                pValueFDR: 1,
                                pValue: 1
                            }
                        })
                    }
                })

                // concat sortedAnalyseData and sortedMetaData
                let sortedData = sortedAnalyseData.concat(sortedMetaData)
                setSortedData(sortedData)
                setSortedGenes(finalGeneList)
            } else {
                // filter only inputType === "expression" or "pgsea"
                let expressionData = Object.values(configs).filter(e => e.inputType === "expression" || e.inputType === "pgsea")

                // filter only significant genes with threshold is 0.05. Create data for venn diagram with label and values as array of gene ids.
                for (let i = 0; i < expressionData.length; i++) {
                    let args = {
                        analysisId: expressionData[i].analysisId,
                        sessionId
                    };
                    try {
                        const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        let resJson = await response.json();
                        expressionData[i].fcPValueData = resJson;
                    } catch (error) {
                        console.error("Error fetching data:", error);
                    }
                }
                let vennData = expressionData.map(e => {
                    return {
                        label: analysisDisplayName(analyses, e.analysisId, e.name),
                        values: e.fcPValueData.filter(gene => gene[pValueType] <= pValueThreshold).map(e => e.id)
                    }
                })
                // Filter genes that appear in at least minDatasetsThreshold datasets
                const effectiveThreshold = Math.min(minDatasetsThreshold, vennData.length);
                let intersectionGenes = extractSets(vennData).datasets[0].data
                    .filter(e => e.degree >= effectiveThreshold)
                    .map(e => e.values)
                    .flat()
                // Create set for filtering
                let intersectionGenesSet = new Set(intersectionGenes)
                // filter fcPValueData with intersectionGenesSet base on gene id for each analysis
                let filteredData = expressionData.map(e => {
                    return {
                        id: e.analysisId,
                        label: analysisDisplayName(analyses, e.analysisId, e.name),
                        values: e.fcPValueData.filter(e => intersectionGenesSet.has(e.id))
                    }
                })
                // convert filteredData to object with key as analysis name
                let filteredDataObj = filteredData.reduce((acc, curr) => {
                    acc[curr.id] = {
                        label: curr.label,
                        values: curr.values
                    }
                    return acc
                }, {})

                // Check if we have data to work with
                if (Object.keys(filteredDataObj).length > 0 && filteredDataObj[Object.keys(filteredDataObj)[0]]?.values) {
                    // first sort the genes of first analysis by pValue ascending order and then use it as reference to sort other analysis
                    let sortedGenes = filteredDataObj[Object.keys(filteredDataObj)[0]].values.sort((a, b) => b.pValue - a.pValue).map(e => e.id)
                    // sort other analysis based on sortedGenes
                    let sortedData = Object.keys(filteredDataObj).map(e => {
                        return {
                            label: filteredDataObj[e].label,
                            values: filteredDataObj[e].values.sort((a, b) => sortedGenes.indexOf(a.id) - sortedGenes.indexOf(b.id))
                        }
                    })
                    setSortedData(sortedData)
                    setSortedGenes(sortedGenes)
                } else {
                    // No intersection genes found
                    setSortedData([])
                    setSortedGenes([])
                }
            }
        }

        fetchData();

    }, [configs, analyses, metaData, minDatasetsThreshold, pValueType, pValueThreshold, topNGenes, consistencyPercent, geneSource]);

    // Calculate number of datasets for UI display
    const numDatasets = metaData.length > 0
        ? Object.values(configs).filter(e => e.inputType === "expression" || e.inputType === "pgsea").length
        : Object.values(configs).filter(e => e.inputType === "expression" || e.inputType === "pgsea").length;

    // Generate threshold options based on number of datasets
    const thresholdOptions = [];
    if (numDatasets >= 1) thresholdOptions.push({label: "At least 1 dataset", value: 1});
    if (numDatasets >= 2) thresholdOptions.push({label: "At least 2 datasets", value: 2});
    if (numDatasets >= 3) thresholdOptions.push({label: "At least 3 datasets", value: 3});
    if (numDatasets >= 4) thresholdOptions.push({label: `At least 50% (${Math.ceil(numDatasets * 0.5)}) datasets`, value: Math.ceil(numDatasets * 0.5)});
    if (numDatasets >= 4) thresholdOptions.push({label: `At least 75% (${Math.ceil(numDatasets * 0.75)}) datasets`, value: Math.ceil(numDatasets * 0.75)});
    if (numDatasets >= 2) thresholdOptions.push({label: `All (${numDatasets}) datasets`, value: numDatasets});

    if (sortedData.length === 0 || sortedGenes.length === 0) {
        if (numDatasets === 0) {
            return <Empty description="No expression or PGSEA analyses available for gene heatmap" />;
        }
        return (
            <div style={{padding: '20px'}}>
                <div style={{marginBottom: '16px'}}>
                    <Space size="large" wrap>
                        <Space>
                            <label>Show genes significant in at least:</label>
                            <Select
                                value={minDatasetsThreshold}
                                onChange={setMinDatasetsThreshold}
                                options={thresholdOptions}
                                style={{width: 200}}
                            />
                        </Space>
                    </Space>
                </div>
                <Empty
                    description={
                        <span>
                            No genes found significant (FDR &le; {pValueThreshold}) in at least {minDatasetsThreshold} dataset(s) out of {numDatasets}.<br/>
                            Try lowering the minimum datasets threshold or check that your analyses have overlapping significant genes.
                        </span>
                    }
                />
            </div>
        );
    }

    return (
        <div>
            <div style={{marginBottom: '16px', padding: '0 20px'}}>
                <Space size="large" wrap>
                    <Space>
                        <label>Gene source:</label>
                        <Select
                            value={geneSource}
                            onChange={setGeneSource}
                            style={{width: 180}}
                        >
                            <Select.Option value="meta">Meta-analysis</Select.Option>
                            <Select.Option value="individual">Individual studies</Select.Option>
                            <Select.Option value="both">Both (Union)</Select.Option>
                        </Select>
                    </Space>
                    {geneSource !== 'individual' && (
                        <Space>
                            <label>Top genes:</label>
                            <Select
                                value={topNGenes}
                                onChange={setTopNGenes}
                                style={{width: 120}}
                            >
                                <Select.Option value="50">Top 50</Select.Option>
                                <Select.Option value="100">Top 100</Select.Option>
                                <Select.Option value="200">Top 200</Select.Option>
                                <Select.Option value="500">Top 500</Select.Option>
                                <Select.Option value="all">All</Select.Option>
                            </Select>
                        </Space>
                    )}
                    <Space>
                        <label>Significant in:</label>
                        <Select
                            value={consistencyPercent}
                            onChange={setConsistencyPercent}
                            style={{width: 160}}
                        >
                            <Select.Option value={0}>Any study</Select.Option>
                            <Select.Option value={25}>≥25% of studies</Select.Option>
                            <Select.Option value={50}>≥50% of studies</Select.Option>
                            <Select.Option value={75}>≥75% of studies</Select.Option>
                            <Select.Option value={100}>All studies</Select.Option>
                        </Select>
                    </Space>
                    <Space>
                        <label>Show in at least:</label>
                        <Select
                            value={minDatasetsThreshold}
                            onChange={setMinDatasetsThreshold}
                            options={thresholdOptions}
                            style={{width: 200}}
                        />
                    </Space>
                    <span style={{color: '#888'}}>
                        ({sortedGenes.length} genes with FDR &le; {pValueThreshold})
                    </span>
                </Space>
            </div>
            <HeatMapGene inputData={sortedData} genesIdList={sortedGenes}></HeatMapGene>
        </div>
    )
}
const InViewHeatmapGeneChart = inViewRender(HeatmapGeneChart);

const MultiAnalysisPathwayGraphComponentTable = ({
                                                     analyses,
                                                     configs,
                                                     dbId,
                                                     metaData,
                                                     metaAnalyses,
                                                     sessionId,
                                                     analysisResultsByDb
                                                 }) => {
    const [value, setValue] = useState([]);
    const [treeData, setTreeData] = useState([]);
    const [allAnalysisData, setAllAnalysisData] = useState([])
    const [configsWithGeneSets, setConfigsWithGeneSets] = useState([])
    // const [analysisResultsByDb, setAnalysisResultsByDb] = useState([])
    const [isConfigUpdated, setIsConfigUpdated] = useState(false)

    // useEffect(() => {
    //     async function fetchData() {
    //         let args = {
    //             sessionId
    //         };
    //         try {
    //             const response = await fetch2(`/api/resultsGroupedByDbAll?args=${btoa(JSON.stringify(args))}`);
    //             if (!response.ok) {
    //                 throw new Error(`HTTP error! status: ${response.status}`);
    //             }
    //             let resJson = await response.json();
    //             setAnalysisResultsByDb(resJson[dbId]);
    //         } catch (error) {
    //             console.error("Error fetching data:", error);
    //         }
    //     }
    //
    //     fetchData()
    // }, [sessionId]);

    useEffect(() => {
        if (analysisResultsByDb.length === 0) return;
        analyses = metaAnalysisUtils.combineNormalWithMetaAnalyses(analyses, metaAnalyses)

        let allAnalysisData = metaAnalysisUtils.combineNormalAnalysisResultsWithMetaAnalysisResults(analysisResultsByDb, metaData, dbId)
        setAllAnalysisData(allAnalysisData)
        let {treeData, initialTreeData} = metaAnalysisUtils.createTreeDataForAnalyses(allAnalysisData, analyses)
        setTreeData(treeData)
        if (initialTreeData.length > 16) {
            setValue(initialTreeData.slice(0, 16))
        } else {
            setValue(initialTreeData)
        }
    }, [analysisResultsByDb]);

    useEffect(() => {
        async function fetchData2() {
            const fetchPromises = configs.map(async (config) => {
                let args = {
                    sessionId,
                    analysisId: config.analysisId,
                };
                try {
                    // For pathway network, fetch FULL custom gene sets with gene lists
                    const response = await fetch2(`/api/customGeneSetsFull?args=${btoa(JSON.stringify(args))}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let resJson = await response.json();
                    console.log('[PathwayNetwork] Fetched full custom gene sets for', config.analysisId, ':', resJson.length, 'sets');

                    // If custom gene sets are empty, try fetching database gene sets from geneStats
                    if (resJson.length === 0) {
                        console.log('[PathwayNetwork] No custom gene sets, fetching database gene sets from geneStats');
                        try {
                            const geneStatsData = await Meteor.callAsync('analysis.getData', {
                                analysisId: config.analysisId,
                                inputType: config.inputType,
                                keys: ['geneStats', 'selectedDatasets']
                            });

                            if (geneStatsData && geneStatsData.geneStats && Array.isArray(geneStatsData.geneStats) &&
                                geneStatsData.selectedDatasets && Array.isArray(geneStatsData.selectedDatasets)) {
                                // Transform geneStats format to match expected gene set format
                                // Use the selectedDatasets IDs to match with database IDs
                                const transformedGeneSets = geneStatsData.geneStats.map((dbStats, index) => {
                                    // Use the corresponding selectedDatasets ID if available
                                    const dbId = geneStatsData.selectedDatasets[index] || dbStats.name;
                                    return {
                                        id: dbId, // Use database ID from selectedDatasets
                                        name: dbStats.name,
                                        isCustom: false,
                                        geneSets: dbStats.geneSets || []
                                    };
                                });
                                console.log('[PathwayNetwork] Transformed database gene sets:', transformedGeneSets.length, 'databases');
                                return {...config, geneSets: transformedGeneSets};
                            }
                        } catch (geneStatsError) {
                            console.error('[PathwayNetwork] Error fetching geneStats:', geneStatsError);
                        }
                    }

                    return {...config, geneSets: resJson};
                } catch (error) {
                    console.error("Error fetching custom gene sets:", error);
                    return config; // Return the original config if there's an error
                }
            });

            try {
                const updatedConfigs = await Promise.all(fetchPromises);
                console.log('[PathwayNetwork] All configs updated with gene sets');
                setConfigsWithGeneSets(updatedConfigs);
                setIsConfigUpdated(true);
            } catch (error) {
                console.error("Error in Promise.all:", error);
            }
        }

        fetchData2();
    }, [sessionId]);

    const onChange = (newValue) => {
        setValue(newValue);
    };

    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    let organismId, geneSet, analysisId, inputType;

    if (isConfigUpdated === false) {
        return "Loading"
    }

    for (let config of configsWithGeneSets) {
        if (config.geneSets && config.geneSets.find(e => e.id === dbId)) {
            organismId = config.organismId;
            geneSet = config.geneSets.find(e => e.id === dbId);
            analysisId = config.analysisId;
            inputType = config.inputType;
            console.log('[PathwayNetwork] Found geneSet:', {
                dbId,
                geneSetName: geneSet?.name,
                hasGeneSets: !!geneSet?.geneSets,
                geneSetsCount: geneSet?.geneSets?.length,
                firstPathwayHasGenes: !!geneSet?.geneSets?.[0]?.genes,
                firstPathwayGenesCount: geneSet?.geneSets?.[0]?.genes?.length
            });
            break;
        }
    }

    // If geneSet not found, show loading message
    if (!geneSet) {
        console.log('[PathwayNetwork] No geneSet found for dbId:', dbId);
        console.log('[PathwayNetwork] Available configs:', configsWithGeneSets.map(c => ({
            analysisId: c.analysisId,
            geneSetsIds: c.geneSets?.map(gs => gs.id)
        })));
        return (
            <div style={{padding: '20px'}}>
                Loading pathway network data...
            </div>
        )
    }

    // Check if geneSet has the required structure
    if (!geneSet.geneSets || !Array.isArray(geneSet.geneSets)) {
        console.error('[PathwayNetwork] geneSet missing geneSets array:', geneSet);
        return (
            <div style={{padding: '20px', color: '#999'}}>
                Gene set structure is invalid. Expected geneSets array.
            </div>
        )
    }

    return (
        <>
            <TreeSelect {...tProps} />
            <MultiAnalysisPathwayGraphComponent
                geneSet={geneSet}
                organismId={organismId}
                sessionId={sessionId}
                results={allAnalysisData}
                selectedAnalysisMethods={value}
                analyses={analyses}
            />
        </>
    )
}
const InViewMultiAnalysisPathwayGraphComponentTable = inViewRender(MultiAnalysisPathwayGraphComponentTable);

const KEGGMapMultiAnalysis = ({configs, analyses, metaData, sessionId}) => {
    let [pathwayId, setPathwayId] = useState([])
    let [mode, setMode] = useState("fc");
    const [isChecked, setIsChecked] = useState(false);
    const [pValueThreshold, setPValueThreshold] = useState(0.05);
    const [allAnalysisData, setAllAnalysisData] = useState([])
    const [treeData, setTreeData] = useState([]);
    const [value, setValue] = useState([]);
    const [selectedCase, setSelectedCase] = useState("")
    const [selectedAnalysesData, setSelectedAnalysesData] = useState([])
    const [uniqueInputTypes, setUniqueInputTypes] = useState([])

    const options = [
        {
            label: "Log2FC",
            value: "fc"
        },
        {
            label: "pValue.FDR",
            value: "pValueFDR"
        },
    ]


    const cases = {
        "multi_ora": [["ora"], ["ora", "expression"], ["ora", "metaDE"], ["ora", "expression", "metaDE"]],
        "multi_pgsea": [["pgsea"], ["pgsea", "expression"], ["pgsea", "metaDE"], ["pgsea", "expression", "metaDE"]],
        "multi_expression": [["expression"], ["metaDE"], ["expression", "metaDE"]],
    }

    useEffect(() => {
        async function fetchData() {
            // hardcoded pathwayId for now
            setPathwayId("path:hsa04261")
            let analysesData = Object.values(configs).map(config => {
                return {
                    analysisId: config.analysisId,
                    inputType: config.inputType,
                    // values: config.fcPValueData,
                    mappedInputGenes: config.genesMappedInput,
                    mappedBackgroundGenes: config.genesMappedBackground,
                    inputStatsData: config.inputData ? config.inputData : [],
                    name: analysisDisplayName(analyses, config.analysisId, config.name)
                }
            })

            for (let i = 0; i < analysesData.length; i++) {
                let args = {
                    analysisId: analysesData[i].analysisId,
                    sessionId
                };
                try {
                    const response = await fetch2(`/api/fcPValueData?args=${btoa(JSON.stringify(args))}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let resJson = await response.json();
                    analysesData[i].values = resJson;
                } catch (error) {
                    console.error("Error fetching data:", error);
                }
            }

            let metaAnalysisData = metaData.map(meta => {
                return {
                    analysisId: meta.analysisId,
                    inputType: "metaDE",
                    values: meta.value.map(e => {
                        return {
                            id: e.ID.toString(),
                            FC: e.logFC,
                            logFCSE: e.logFCSE,
                            pValue: e.pValue,
                            pValueFDR: e.pFDR
                        }
                    }),
                    mappedInputGenes: [],
                    mappedBackgroundGenes: [],
                    name: meta.name
                }
            })

            let allData = analysesData.concat(metaAnalysisData)
            setAllAnalysisData(allData)
            // get values for treeData
            let treeData = allData.map(e => {
                return {
                    title: e.name,
                    value: e.analysisId,
                    key: e.analysisId,
                    type: e.inputType
                }
            })
            setTreeData(treeData)

            // Auto-select a valid combination to show the map by default
            let autoSelectedAnalyses = [];
            let selectedAnalysisData = [];

            // Try to find the best valid combination (priority order):
            // 1. All expression/pgsea analyses (most common case)
            let expressionAnalyses = allData.filter(e => e.inputType === "expression" || e.inputType === "pgsea");
            if (expressionAnalyses.length > 0) {
                autoSelectedAnalyses = expressionAnalyses.map(e => e.analysisId);
                selectedAnalysisData = expressionAnalyses;
            }
            // 2. If no expression/pgsea, try metaDE
            else {
                let metaDEAnalyses = allData.filter(e => e.inputType === "metaDE");
                if (metaDEAnalyses.length > 0) {
                    autoSelectedAnalyses = metaDEAnalyses.map(e => e.analysisId);
                    selectedAnalysisData = metaDEAnalyses;
                }
                // 3. If no expression/metaDE, try ORA
                else {
                    let oraAnalyses = allData.filter(e => e.inputType === "ora");
                    if (oraAnalyses.length > 0) {
                        autoSelectedAnalyses = oraAnalyses.map(e => e.analysisId);
                        selectedAnalysisData = oraAnalyses;
                    }
                    // 4. If no ORA, try PGSEA
                    else {
                        let pgseaAnalyses = allData.filter(e => e.inputType === "pgsea");
                        if (pgseaAnalyses.length > 0) {
                            autoSelectedAnalyses = pgseaAnalyses.map(e => e.analysisId);
                            selectedAnalysisData = pgseaAnalyses;
                        }
                    }
                }
            }

            // If we found a valid combination, set the states directly to avoid race condition
            if (autoSelectedAnalyses.length > 0) {
                // Determine what case we are in based on the selectedAnalysisData
                let inputTypes = selectedAnalysisData.map(e => e.inputType);
                let uniqueInputTypes = new Set(inputTypes);
                let selectedCaseRes = Object.keys(cases).find(key => {
                    return cases[key].find(subCase => {
                        let itemSet = new Set(subCase);
                        return _.isEqual(itemSet, uniqueInputTypes);
                    });
                });

                setValue(autoSelectedAnalyses);
                setSelectedAnalysesData(selectedAnalysisData);
                setUniqueInputTypes(inputTypes);
                if (selectedCaseRes !== undefined) {
                    setSelectedCase(selectedCaseRes);
                } else {
                    setSelectedCase("");
                }
            }
        }

        fetchData()
    }, [configs, analyses, metaData]);

    const onChange = (selectedAnalyses) => {
        // get the analysisData based on the selectedAnalyses
        let selectedAnalysisData = allAnalysisData.filter(e => selectedAnalyses.includes(e.analysisId))
        // determine what case we are in based on the selectedAnalysisData
        // get all input types form analysisData
        let inputTypes = selectedAnalysisData.map(e => e.inputType)
        // remove duplicates in inputTypes
        let uniqueInputTypes = new Set(inputTypes)
        let selectedCaseRes = Object.keys(cases).find(key => {
            return cases[key].find(subCase => {
                let itemSet = new Set(subCase)
                return _.isEqual(itemSet, uniqueInputTypes)
            })
        })
        setSelectedAnalysesData(selectedAnalysisData)
        if (selectedCaseRes !== undefined) {
            setSelectedCase(selectedCaseRes)
        } else {
            setSelectedCase("")
        }
        setValue(selectedAnalyses);
        setUniqueInputTypes(inputTypes)
    }

    const onModeChange = ({target: {value}}) => {
        setMode(value);
    };

    const handleCheckboxChange = (e) => {
        setIsChecked(e.target.checked);
    };

    const handlePValueChange = (value) => {
        setPValueThreshold(value);
    };


    const tProps = {
        treeData,
        value,
        onChange,
        treeCheckable: true,
        showCheckedStrategy: SHOW_PARENT,
        placeholder: 'Please select',
        style: {
            width: '100%',
        },
        treeDefaultExpandAll: true,
    };

    return (
        <>
            <TreeSelect {...tProps} />
            {
                (selectedCase === "multi_expression") ? (
                    <>
                        <Radio.Group style={{display: 'block'}} options={options} onChange={onModeChange} value={mode}
                                     optionType="button"/>
                    </>
                ) : null
            }
            {
                selectedCase && uniqueInputTypes.includes("expression") ? (
                    <Checkbox checked={isChecked} onChange={handleCheckboxChange}>
                        Show only significant genes?
                    </Checkbox>
                ) : null
            }

            {isChecked && (
                <div style={{marginTop: 8, display: "inline-block"}}>
                    <InputNumber
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={pValueThreshold}
                        onChange={handlePValueChange}
                    />
                </div>
            )}
            {
                selectedCase ? (
                    <KeggChartMultiAnalysis
                        pathwayId={pathwayId}
                        analysisData={selectedAnalysesData}
                        selectedCase={selectedCase}
                        mode={mode}
                        showSignificant={isChecked}
                        threshold={pValueThreshold}
                    ></KeggChartMultiAnalysis>
                ) : null
            }

            {/*<SelectableResult analysisId={analysisId} inputType={inputType}*/}
            {/*                  sessionId={sessionId} isRunnable={false}*/}
            {/*                  selectType={selectType}*/}
            {/*                  onRowSelectionChange={(record, selected, selectedRows) => {*/}
            {/*                      setPathwayId(selectedRows.map(e => e.pathway))*/}
            {/*                  }}*/}
            {/*                  databaseIds={[geneSet.id]}*/}
            {/*                  selectedPathways={pathwayId}*/}
            {/*/>*/}
        </>
    )
}
const InViewKEGGMapMultiAnalysis = inViewRender(KEGGMapMultiAnalysis);

const ModalContent = React.memo(({taskId}) => {
    const [content, setContent] = useState("");
    const contentRef = useRef(null);

    useTracker(() => {
        const task = DBCollections.LlmQueue.findOne({_id: taskId});
        if (task && (task.status === 'processing')) {
            setContent(task.result);
        }
    }, [taskId]);

    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [content]);

    return (
        <div ref={contentRef} style={{height: 800, overflowY: 'auto'}}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    );
});

const TaskResult = () => {
    const user = useTracker(() => Meteor.user());
    if (!user) return "Loading ...";
    useSubscription("llm.tasks", {idUser: user._id}, []);

    const tasks = useTracker(() => {
        return DBCollections.LlmQueue.find({userId: user._id}, {sort: {createdAt: -1}}).fetch();
    });

    const [open, setOpen] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState("");

    useEffect(() => {
        const checkCompletedTasks = () => {
            const completedTask = tasks.find(task => task.status === 'processing');
            if (completedTask) {
                setSelectedTaskId(completedTask._id);
                setOpen(true);
            }
        };

        checkCompletedTasks();
    }, [tasks]);

    return (
        <Modal
            // title={<p>Task Result</p>}
            footer={
                <Button type="primary" onClick={() => setOpen(false)}>
                    Close
                </Button>
            }
            open={open}
            onCancel={() => setOpen(false)}
            width={800}
        >
            <ModalContent taskId={selectedTaskId}/>
        </Modal>
    );
};

const hasMetaAnalysisCapability = (configs, analyses) => {
    // Show meta-analysis tab if there are expression/pgsea analyses (gene-level) OR
    // if there are 2+ analyses (for pathway-level meta-analysis)
    const hasGeneLevel = Object.values(configs).some(e => e.inputType === "expression" || e.inputType === "pgsea");
    const hasPathwayLevel = analyses.length >= 2;
    return hasGeneLevel || hasPathwayLevel;
}
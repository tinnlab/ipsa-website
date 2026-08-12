import React, { useState, useEffect } from 'react';
import { Steps, Button, Space, Card, message as antdMessage } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import Step1_InputTypeSelection from './Step1_InputTypeSelection';
import Step2_DataInput from './Step2_DataInput';
import Step5_RunAnalysis from './Step5_RunAnalysis';
import SelectOrgAndPath from '../SelectOrgAndPath';
import MethodsConfig from '../MethodsConfig';
import { useTracker } from 'meteor/react-meteor-data';
import useSubscription from '../../../../../../hooks/useSubscription';

const { Step } = Steps;

const AnalysisWizard = ({ analysisId, sessionId, form, sessionInfo, exampleType }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [inputType, setInputType] = useState(null);
    const [canProceed, setCanProceed] = useState(false);
    const [initialStepSet, setInitialStepSet] = useState(false);
    const [resultsReady, setResultsReady] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [hasNavigated, setHasNavigated] = useState(false);

    // Subscribe to analysis config data once inputType is known
    useSubscription(
        "analysis.config",
        {
            analysisId,
            inputType: inputType || 'ora',
            // NOTE: this array IS the publication whitelist ('analysis.config' filters on it),
            // so a key missing here is never delivered to Minimongo and every useTracker
            // reading it silently sees undefined. `inputRaw`/`rankingBy` back the PGSEA
            // ranking selector in Step 2.
            keys: ["idType", "idTypes", "taxId", "input", "inputRaw", "rankingBy", "expressionFile", "groupFile", "groupData", "selectedControlSamples", "selectedConditionSamples", "selectedDatasets", "methodSettings", "volcanoPlotData", "maxAdjustedPValue", "minLogFoldChange"]
        },
        [inputType, analysisId]
    );

    // Subscribe to analysis results with ready tracking
    useEffect(() => {
        if (!inputType) return;

        const handle = Meteor.subscribe("analysis.results", {
            analysisId,
            inputType
        });

        // Check when subscription is ready
        const checkReady = setInterval(() => {
            if (handle.ready()) {
                setResultsReady(true);
                clearInterval(checkReady);
            }
        }, 100);

        return () => {
            clearInterval(checkReady);
            // handle.stop(); // Keep subscription active
        };
    }, [inputType, analysisId]);

    // Get session and inputType from session (reactive)
    const sessionData = useTracker(() => {
        const session = DBCollections.Session.findOne({ _id: sessionId });
        console.log('Session lookup for sessionId:', sessionId, 'Found:', !!session);
        if (!session) return null;

        const analysis = session.analyses.find(a => a.id === analysisId);
        console.log('Analysis in session:', analysis);
        return {
            hasAnalysis: !!analysis,
            inputType: analysis?.input || null
        };
    }, [sessionId, analysisId]);

    // Set inputType and initialStepSet based on session data
    useEffect(() => {
        if (initialStepSet) return; // Only run once
        if (!sessionData) return; // Wait for session data to load

        const { hasAnalysis, inputType: sessionInputType } = sessionData;

        if (!hasAnalysis) {
            // Analysis not found in session
            console.log('Analysis not found in session');
            setInitialStepSet(true);
            return;
        }

        if (sessionInputType && sessionInputType !== 'ora') {
            // Has a specific inputType that's not the default
            console.log('Detected input type from session:', sessionInputType);
            setInputType(sessionInputType);
            setInitialStepSet(true);
        } else if (sessionInputType === 'ora') {
            // inputType is 'ora' - need to check if this is a real analysis or just default
            // Check if there's any config data by trying to subscribe and see if data arrives
            const checkForConfig = async () => {
                // Wait a bit for subscription to load
                await new Promise(resolve => setTimeout(resolve, 300));

                const config = DBCollections.AnalysisConfig.findOne({ analysisId, inputType: 'ora' });
                if (config) {
                    console.log('Found ORA config data');
                    setInputType('ora');
                    setInitialStepSet(true);
                } else {
                    // Check other types
                    const expressionConfig = DBCollections.AnalysisConfig.findOne({ analysisId, inputType: 'expression' });
                    const pgseaConfig = DBCollections.AnalysisConfig.findOne({ analysisId, inputType: 'pgsea' });

                    if (expressionConfig) {
                        console.log('Found expression config data');
                        setInputType('expression');
                        setInitialStepSet(true);
                    } else if (pgseaConfig) {
                        console.log('Found pgsea config data');
                        setInputType('pgsea');
                        setInitialStepSet(true);
                    } else {
                        console.log('No config data found, this is a new analysis - starting at Step 1');
                        setInitialStepSet(true);
                    }
                }
            };

            checkForConfig();
        } else {
            // No inputType at all
            console.log('No input type in session, starting fresh');
            setInitialStepSet(true);
        }
    }, [analysisId, initialStepSet, sessionData]);

    // Track analysis results to determine initial step
    const analysisResults = useTracker(() => {
        if (!inputType) return [];
        return DBCollections.AnalysisResult.find({
            analysisId,
            inputType
        }).fetch();
    }, [analysisId, inputType]);

    // Once inputType is detected, navigate to appropriate step based on results
    useEffect(() => {
        if (!inputType || !initialStepSet) return;
        if (hasNavigated) return; // Only navigate once on initial load
        if (!resultsReady) return; // Wait for subscription to be ready
        if (isEditing) return; // Don't auto-navigate when user is editing

        console.log('Checking results for navigation:', {
            analysisId,
            inputType,
            resultsCount: analysisResults.length,
            resultsReady,
            isEditing,
            hasNavigated
        });

        if (analysisResults && analysisResults.length > 0) {
            // Analysis is complete, go to Step 5 (results)
            console.log('Analysis already completed, going to Step 5');
            setCurrentStep(4); // Step 5 is index 4
            setHasNavigated(true);
        } else {
            // Skip to step 2 if inputType already set but no results
            console.log('No results found, going to Step 2');
            setCurrentStep(1);
            setHasNavigated(true);
        }
    }, [inputType, initialStepSet, analysisResults, analysisId, resultsReady, isEditing, hasNavigated]);

    // Track organism selection
    const organismConfig = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'taxId'
        });
    }, [analysisId, inputType]);

    // Track selected datasets
    const datasetsConfig = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'selectedDatasets'
        });
    }, [analysisId, inputType]);

    // Track methods config
    const methodsConfig = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'methodSettings'
        });
    }, [analysisId, inputType]);

    // Track gene statistics (pathway table data)
    const geneStatsConfig = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'geneStats'
        });
    }, [analysisId, inputType]);

    // Track gene stats processing status
    const geneStatsProcessingStatus = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'geneStatsProcessingStatus'
        });
    }, [analysisId, inputType]);

    // Track data entry based on input type
    const dataConfig = useTracker(() => {
        if (!inputType) return null;

        if (inputType === 'ora') {
            return DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'input'
            });
        } else if (inputType === 'pgsea') {
            return DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'input'
            });
        } else if (inputType === 'expression') {
            const expressionFile = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'expressionFile'
            });
            const groupFile = DBCollections.AnalysisConfig.findOne({
                analysisId,
                inputType,
                key: 'groupFile'
            });

            console.log('Expression file config:', expressionFile);
            console.log('Group file config:', groupFile);

            return expressionFile && groupFile ? { value: true } : null;
        }
        return null;
    }, [analysisId, inputType]);

    // Track gene ID type detection
    const idTypeConfig = useTracker(() => {
        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'idTypes'
        });
    }, [analysisId, inputType]);

    // Track sample groups for expression type
    const controlSamplesConfig = useTracker(() => {
        if (inputType !== 'expression') return { value: true }; // Not required for non-expression

        return DBCollections.AnalysisConfig.findOne({
            analysisId,
            inputType,
            key: 'selectedControlSamples'
        });
    }, [analysisId, inputType]);

    // Validation logic for each step
    useEffect(() => {
        let canProceedToNext = false;

        switch (currentStep) {
            case 0: // Step 1: Input Type Selection
                canProceedToNext = inputType !== null;
                break;

            case 1: // Step 2: Data Input & Organism
                const hasOrganism = organismConfig?.value !== undefined && organismConfig?.value !== null;
                const hasData = dataConfig?.value !== undefined && dataConfig?.value !== null;
                const hasIdType = idTypeConfig?.value !== undefined && idTypeConfig?.value?.length > 0;

                // Debug logging
                console.log('Step 2 Validation:', {
                    inputType,
                    hasOrganism,
                    hasData,
                    hasIdType,
                    idTypeValue: idTypeConfig?.value
                });

                if (inputType === 'expression') {
                    const hasSampleGroups = controlSamplesConfig?.value !== undefined &&
                                          controlSamplesConfig?.value?.length > 0;

                    console.log('Expression validation:', {
                        hasSampleGroups,
                        controlSamplesValue: controlSamplesConfig?.value
                    });

                    canProceedToNext = hasOrganism && hasData && hasIdType && hasSampleGroups;
                } else {
                    canProceedToNext = hasOrganism && hasData && hasIdType;
                }
                break;

            case 2: // Step 3: Pathway Databases
                const hasDatasets = datasetsConfig?.value !== undefined &&
                                   Array.isArray(datasetsConfig.value) &&
                                   datasetsConfig.value.length > 0;

                // Check if gene stats are loaded (pathway table with gene counts)
                const hasGeneStats = geneStatsConfig?.value !== undefined &&
                                    Array.isArray(geneStatsConfig.value) &&
                                    geneStatsConfig.value.length > 0;

                // Check if processing is complete (not "loading")
                const isNotProcessing = geneStatsProcessingStatus?.value !== 'loading';

                console.log('Step 3 Validation:', {
                    hasDatasets,
                    hasGeneStats,
                    isNotProcessing,
                    processingStatus: geneStatsProcessingStatus?.value,
                    geneStatsCount: geneStatsConfig?.value?.length
                });

                canProceedToNext = hasDatasets && hasGeneStats && isNotProcessing;
                break;

            case 3: // Step 4: Methods Configuration
                const hasMethods = methodsConfig?.value !== undefined &&
                                  Object.keys(methodsConfig.value || {}).some(method =>
                                      methodsConfig.value[method]?.enabled === true
                                  );
                canProceedToNext = hasMethods;
                break;

            case 4: // Step 5: Run Analysis
                canProceedToNext = true; // Always can proceed on last step (no next button anyway)
                break;

            default:
                canProceedToNext = false;
        }

        setCanProceed(canProceedToNext);
    }, [currentStep, inputType, organismConfig, dataConfig, idTypeConfig, controlSamplesConfig, datasetsConfig, methodsConfig, geneStatsConfig, geneStatsProcessingStatus]);

    const steps = [
        {
            title: 'Input Type',
            description: 'Select data type',
        },
        {
            title: 'Data & Organism',
            description: 'Upload data',
        },
        {
            title: 'Pathways',
            description: 'Select databases',
        },
        {
            title: 'Methods',
            description: 'Configure analysis',
        },
        {
            title: 'Run & Results',
            description: 'Execute analysis',
        },
    ];

    const handleNext = () => {
        if (!canProceed) {
            let errorMessage = 'Please complete all required fields before proceeding.';

            if (currentStep === 0) {
                errorMessage = 'Please select an input type.';
            } else if (currentStep === 1) {
                if (!organismConfig?.value) {
                    errorMessage = 'Please select an organism.';
                } else if (!dataConfig?.value) {
                    errorMessage = 'Please upload or enter your data.';
                } else if (!idTypeConfig?.value || idTypeConfig.value.length === 0) {
                    errorMessage = inputType === 'expression'
                        ? 'Please wait for gene ID type detection to complete. This may take a few seconds after uploading files.'
                        : 'Please wait for gene ID type detection to complete.';
                } else if (inputType === 'expression' && (!controlSamplesConfig?.value || controlSamplesConfig.value.length === 0)) {
                    errorMessage = 'Please select control and condition sample groups from the dropdown menus.';
                }
            } else if (currentStep === 2) {
                if (!datasetsConfig?.value || datasetsConfig.value.length === 0) {
                    errorMessage = 'Please select at least one pathway database.';
                } else if (geneStatsProcessingStatus?.value === 'loading') {
                    errorMessage = 'Please wait for pathway statistics to finish calculating...';
                } else if (!geneStatsConfig?.value || geneStatsConfig.value.length === 0) {
                    errorMessage = 'Please wait for pathway table to load. The gene statistics are being calculated.';
                } else {
                    errorMessage = 'Please complete pathway database selection.';
                }
            } else if (currentStep === 3) {
                errorMessage = 'Please enable at least one analysis method.';
            }

            antdMessage.warning(errorMessage);
            return;
        }

        setCurrentStep(currentStep + 1);
    };

    const handlePrevious = () => {
        setCurrentStep(currentStep - 1);
    };

    const handleStepChange = (step) => {
        // Allow jumping to previous steps, but validate before jumping forward
        if (step < currentStep) {
            setCurrentStep(step);
        } else if (step > currentStep && canProceed) {
            setCurrentStep(step);
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 0:
                return (
                    <Step1_InputTypeSelection
                        selectedInputType={inputType}
                        onSelectInputType={async (newInputType) => {
                            setInputType(newInputType);

                            // Update the session with the selected input type
                            try {
                                const session = await DBCollections.Session.findOneAsync({ _id: sessionId });
                                if (session) {
                                    const analysis = session.analyses.find(a => a.id === analysisId);
                                    if (analysis) {
                                        await Meteor.callAsync('session.updateAnalysis', {
                                            sessionId,
                                            analysisId,
                                            analysis: { ...analysis, input: newInputType }
                                        });
                                        console.log('Updated analysis input type to:', newInputType);
                                    }
                                }
                            } catch (error) {
                                console.error('Error updating analysis input type:', error);
                            }
                        }}
                    />
                );

            case 1:
                if (!inputType) {
                    return <div>Please select an input type first.</div>;
                }
                return (
                    <Step2_DataInput
                        analysisId={analysisId}
                        inputType={inputType}
                        sessionId={sessionId}
                        onDataValidated={() => {}}
                    />
                );

            case 2:
                if (!inputType) {
                    return <div>Please complete previous steps first.</div>;
                }
                return (
                    <SelectOrgAndPath
                        analysisId={analysisId}
                        inputType={inputType}
                        sessionId={sessionId}
                    />
                );

            case 3:
                if (!inputType) {
                    return <div>Please complete previous steps first.</div>;
                }
                return (
                    <MethodsConfig
                        analysisId={analysisId}
                        inputType={inputType}
                    />
                );

            case 4:
                if (!inputType) {
                    return <div>Please complete previous steps first.</div>;
                }
                return (
                    <Step5_RunAnalysis
                        analysisId={analysisId}
                        inputType={inputType}
                        sessionId={sessionId}
                        onReRunAnalysis={() => setCurrentStep(3)} // Go back to methods config
                        onEditAnalysis={() => {
                            setIsEditing(true);
                            setCurrentStep(0);
                        }} // Go back to step 1 for editing
                        onReuploadData={() => {
                            setIsEditing(true);
                            setCurrentStep(1);
                        }} // Go back to the Data Input step to re-upload a missing file
                    />
                );

            default:
                return <div>Unknown step</div>;
        }
    };

    return (
        <div style={{ padding: '24px' }}>
            {/* Progress Steps */}
            <Card style={{ marginBottom: 24 }}>
                <Steps
                    current={currentStep}
                    onChange={handleStepChange}
                    items={steps}
                />
            </Card>

            {/* Step Content */}
            <Card style={{ minHeight: 400 }}>
                {renderStepContent()}
            </Card>

            {/* Navigation Buttons */}
            <Card style={{ marginTop: 24 }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Button
                        icon={<LeftOutlined />}
                        onClick={handlePrevious}
                        disabled={currentStep === 0}
                    >
                        Previous
                    </Button>

                    <div>
                        Step {currentStep + 1} of {steps.length}
                    </div>

                    {currentStep < steps.length - 1 ? (
                        <Button
                            type="primary"
                            icon={<RightOutlined />}
                            onClick={handleNext}
                            disabled={!canProceed}
                        >
                            Next
                        </Button>
                    ) : (
                        <div style={{ width: '73px' }}></div>
                    )}
                </Space>
            </Card>
        </div>
    );
};

export default AnalysisWizard;

import React, {useState, useCallback, useEffect, useRef, useMemo} from 'react';
import {
    Modal, Button, Steps, Typography, Upload, Card, Table,
    Select, Collapse, Form, InputNumber, Checkbox, Space,
    Alert, Progress, Tag, Divider, Spin, Input, Transfer, Tooltip, Empty, Radio
} from 'antd';
import {
    InboxOutlined, FolderOpenOutlined, PlayCircleOutlined,
    CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
    PlusOutlined, EditOutlined, DeleteOutlined, GroupOutlined,
    UploadOutlined, SettingOutlined, DownloadOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import {useTracker} from 'meteor/react-meteor-data';
import {Random} from 'meteor/random';
import MethodSettings from '../../../../../../methods/settings';
import FileParser from './FileParser';
import AnalysisUtils from './AnalysisUtils';
import notification from "antd/lib/notification";
// RANKING_OPTIONS now lives in /imports/utils/pgseaInput so this modal and the
// single-analysis wizard cannot drift on wording (scripts/check-antd-imports.js fails the
// build if either file re-declares it locally).
import {buildPgseaContent, resolvePgseaRankingBy, RANKING_OPTIONS} from '/imports/utils/pgseaInput';
import {authHeaders} from '/imports/client/utils/authHeaders';
import {sortOrganismsByName} from '/imports/utils/organismSort';

const {Title, Text} = Typography;
const {Step} = Steps;
const {Dragger} = Upload;

// Helper function for input type colors - moved to top
const getInputTypeColor = (inputType) => {
    const colors = {
        ora: 'blue',
        pgsea: 'green',
        expression: 'orange',
        ambiguous: 'purple',
        unknown: 'default'
    };
    return colors[inputType] || 'default';
};

// Helper function to sort analyses by type
const sortAnalysesByType = (analyses) => {
    const typeOrder = { ora: 1, pgsea: 2, expression: 3, ambiguous: 4, unknown: 5 };

    return [...analyses].sort((a, b) => {
        const typeA = (a.llmDetection?.detectedType || a.inputType || 'unknown').toLowerCase();
        const typeB = (b.llmDetection?.detectedType || b.inputType || 'unknown').toLowerCase();

        const orderA = typeOrder[typeA] || 999;
        const orderB = typeOrder[typeB] || 999;

        // Primary sort: by type
        if (orderA !== orderB) {
            return orderA - orderB;
        }

        // Secondary sort: by name (alphabetically)
        return a.name.localeCompare(b.name);
    });
};

const MassAnalysisModal = ({open, onCancel, sessionId, onSuccess, onShowVisualization, onStepChange, onProgressChange, isPageMode = false}) => {
    const [currentStep, setCurrentStep] = useState(0);

    // Notify parent of step changes
    useEffect(() => {
        if (onStepChange) {
            onStepChange(currentStep);
        }
    }, [currentStep, onStepChange]);
    const [parsedAnalyses, setParsedAnalyses] = useState([]);
    const processingStartedRef = useRef(false); // Track if we've started processing to prevent duplicates
    const [selectedAnalyses, setSelectedAnalyses] = useState([]); // Track which analyses are selected
    const [groups, setGroups] = useState({}); // Group definitions
    const [groupConfigs, setGroupConfigs] = useState({}); // Configuration per group
    const [individualOverrides, setIndividualOverrides] = useState({}); // Individual analysis overrides
    const [isCreating, setIsCreating] = useState(false);
    const [progress, setProgress] = useState({current: 0, total: 0});
    const [massAnalysisId, setMassAnalysisId] = useState(null);
    const [newGroupName, setNewGroupName] = useState('');
    const [showGroupManagement, setShowGroupManagement] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({});

    // Add new state for global organism and custom gene sets
    const [globalOrganism, setGlobalOrganism] = useState(null);
    const [customGeneSets, setCustomGeneSets] = useState([]);
    const [isUploadingGMT, setIsUploadingGMT] = useState(false);

    // Add state for default configuration
    const [defaultConfig, setDefaultConfig] = useState({
        inputTypeConfigs: {}, // Will store config per input type: { ora: {organism, selectedDatasets, methodSettings}, pgsea: {...}, ... }
        methodSettings: {} // Legacy - keep for backward compatibility
    });

    const [pendingGMTFile, setPendingGMTFile] = useState(null);
    const [gmtNameModal, setGmtNameModal] = useState(false);
    const [customGeneSetName, setCustomGeneSetName] = useState('');
    const [gmtFormatDetection, setGmtFormatDetection] = useState(null);
    const [showGmtFormatConfig, setShowGmtFormatConfig] = useState(false);
    const [gmtFormatConfig, setGmtFormatConfig] = useState({
        pathwayNameColumn: 0,
        pathwayIdColumn: null,
        genesStartColumn: 2
    });
    const [showValidation, setShowValidation] = useState(false);
    const [useLLMDetection, setUseLLMDetection] = useState(true); // Enable LLM detection by default
    const [isProcessingFolder, setIsProcessingFolder] = useState(false);
    const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0, message: '' });
    const [folderStatuses, setFolderStatuses] = useState([]); // Track status of each folder: {name, status: 'pending'|'processing'|'complete', result}

    const [metadataModalVisible, setMetadataModalVisible] = useState(false);
    const [selectedMetadata, setSelectedMetadata] = useState(null);

    // Metadata editing state
    const [editMetadataModalVisible, setEditMetadataModalVisible] = useState(false);
    const [editingMetadata, setEditingMetadata] = useState(null); // {analysisName, metadata}
    const [editedFields, setEditedFields] = useState({}); // Store edited field values
    const [newGroupDescription, setNewGroupDescription] = useState('');

    // Metadata standardization state
    const [standardizeModalVisible, setStandardizeModalVisible] = useState(false);
    const [standardizationAnalysis, setStandardizationAnalysis] = useState(null);

    // Subscribe to organisms and databases
    useEffect(() => {
        const orgHandle = Meteor.subscribe('organism.all');
        const dbHandle = Meteor.subscribe('database.all');
        return () => {
            orgHandle.stop();
            dbHandle.stop();
        };
    }, []);

    // Subscribe to mass analysis queue for progress tracking
    useEffect(() => {
        if (sessionId) {
            const queueHandle = Meteor.subscribe('massAnalysisQueue', sessionId);
            return () => queueHandle.stop();
        }
    }, [sessionId]);

    // Track organisms and databases
    const organisms = useTracker(() => {
        return sortOrganismsByName(DBCollections.Organism.find({isEnabled: true}).fetch());
    }, []);

    const databases = useTracker(() => {
        const handle = Meteor.subscribe('database.all');
        const data = DBCollections.Database.find({}).fetch();
        return data;
    }, []);

    // Track custom gene sets from session configs
    const sessionCustomGeneSets = useTracker(() => {
        Meteor.subscribe('session.config', {sessionId, keys: ['customGeneSets']});
        return DBCollections.SessionConfig.find({
            sessionId,
            key: 'customGeneSets'
        }).fetch();
    }, [sessionId]);

    // Combine databases with custom gene sets for display
    const allDatabases = [...databases, ...sessionCustomGeneSets.map(config => ({
        _id: config._id, // ✅ This should be the session config ID
        name: config.value.name,
        isCustom: true,
        genesets: config.value.geneSets || config.value.genesets
    }))];

    // Update local custom gene sets state when session data changes
    useEffect(() => {
        const customSets = sessionCustomGeneSets.map(config => ({
            _id: config._id,
            name: config.value.name,
            genesets: config.value.geneSets || config.value.genesets,
            isCustom: true
        }));
        setCustomGeneSets(customSets);
    }, [sessionCustomGeneSets]);

    // Track queue progress
    const queueProgress = useTracker(() => {
        if (!massAnalysisId) return null;
        return DBCollections.MassAnalysisQueue.findOne(massAnalysisId);
    }, [massAnalysisId]);

    // Notify parent of progress changes
    useEffect(() => {
        if (onProgressChange && queueProgress) {
            onProgressChange(queueProgress);
        }
    }, [queueProgress, onProgressChange]);

    // Updated steps array (removed "Manage Groups")
    const steps = [
        {title: 'Upload Data', description: 'Select folder with analysis data'},
        {title: 'Review & Group', description: 'Review analyses and manage groups'},
        {title: 'Configure Settings', description: 'Configure settings for groups and ungrouped analyses'},
        {title: 'Fine-tune Individual', description: 'Override settings for specific analyses'},
        {title: 'Execute', description: 'Create and run analyses'}
    ];

    const handleReset = () => {
        setCurrentStep(0);
        setParsedAnalyses([]);
        setSelectedAnalyses([]); // Reset selections
        setGroups({});
        setGroupConfigs({});
        setIndividualOverrides({});
        setDefaultConfig({
            inputTypeConfigs: {},
            methodSettings: {}
        });
        setIsCreating(false);
        setProgress({current: 0, total: 0});
        setMassAnalysisId(null);
        setNewGroupName('');
        setShowGroupManagement(false);
        setUploadProgress({});
        setGlobalOrganism(null);
        setCustomGeneSets([]);
        setPendingGMTFile(null);
        setGmtNameModal(false);
        setCustomGeneSetName('');
        setGmtFormatDetection(null);
        setShowGmtFormatConfig(false);
        // ✅ ADD: Reset validation state
        setShowValidation(false);
        setIsProcessingFolder(false);
        setProcessingProgress({ current: 0, total: 0, message: '' });
        processingStartedRef.current = false; // Reset processing flag
    };

    const handleFolderUpload = useCallback(async (fileList) => {
        // Prevent multiple simultaneous uploads using ref (more reliable than state)
        if (processingStartedRef.current) {
            console.warn('⚠️ Processing already started, ignoring duplicate call');
            return;
        }

        if (isProcessingFolder) {
            console.warn('⚠️ Already processing folder (state check), ignoring duplicate upload request');
            return;
        }

        console.log(`🚀 Starting folder upload processing for ${fileList.length} files`);
        processingStartedRef.current = true;

        try {
            setIsProcessingFolder(true);
            setProcessingProgress({ current: 0, total: fileList.length, message: 'Reading files...' });

            // Pass progress callback to FileParser
            const progressCallback = (folderName, status, result = null) => {
                // Handle init status to set total
                if (status === 'init' && result?.total) {
                    setProcessingProgress(prev => ({
                        ...prev,
                        total: result.total,
                        message: `Preparing to analyze ${result.total} folders...`
                    }));
                    return;
                }

                // Update folder status
                if (folderName) {
                    setFolderStatuses(prev => {
                        const existing = prev.find(f => f.name === folderName);
                        if (existing) {
                            return prev.map(f => f.name === folderName ? { ...f, status, result } : f);
                        } else {
                            return [...prev, { name: folderName, status, result }];
                        }
                    });
                }

                // Update progress message
                if (status === 'processing' && folderName) {
                    setProcessingProgress(prev => ({
                        ...prev,
                        message: `Analyzing ${folderName}...`
                    }));
                } else if (status === 'complete' && folderName) {
                    setFolderStatuses(current => {
                        const completedCount = current.filter(f => f.status === 'complete').length;
                        setProcessingProgress(prev => ({
                            ...prev,
                            current: completedCount,
                            message: `Completed ${completedCount} of ${prev.total} folders`
                        }));
                        return current;
                    });
                }
            };

            const result = await FileParser.parseFolder(fileList, useLLMDetection, progressCallback);

            // Handle new return format - could be just analyses array (backward compatibility) or object with analyses and groups
            let analyses, autoGroups, groupFileName;
            if (Array.isArray(result)) {
                // Backward compatibility - just analyses array
                analyses = result;
                autoGroups = null;
                groupFileName = null;
            } else {
                // New format with groups
                analyses = result.analyses;
                autoGroups = result.groups;
                groupFileName = result.groupFileName;
            }

            // Sort analyses by type for better organization
            const sortedAnalyses = sortAnalysesByType(analyses);
            setParsedAnalyses(sortedAnalyses);

            // Auto-select only valid datasets (exclude errors, ambiguous, unknown)
            const validAnalysisNames = sortedAnalyses
                .filter(analysis => {
                    const detectedType = analysis.llmDetection?.detectedType || analysis.inputType;
                    const hasError = analysis.error;
                    const isAmbiguous = detectedType === 'ambiguous';
                    const isUnknown = detectedType === 'unknown';
                    const hasValidationIssues = analysis.llmDetection?.validation && !analysis.llmDetection.validation.valid;

                    // Select if: no error, not ambiguous, not unknown, and passes validation
                    return !hasError && !isAmbiguous && !isUnknown && !hasValidationIssues;
                })
                .map(analysis => analysis.name);

            setSelectedAnalyses(validAnalysisNames);
            console.log(`✅ Auto-selected ${validAnalysisNames.length} valid analyses out of ${sortedAnalyses.length} total`);

            // Set up groups - either from file or start empty
            if (autoGroups && Object.keys(autoGroups).length > 0) {
                setGroups(autoGroups);
                // Initialize group configs for auto-created groups
                const newGroupConfigs = {};
                Object.values(autoGroups).forEach(group => {
                    // Get supported methods for this input type
                    const supportedMethods = MethodSettings.getSupportedMethods(group.inputType);
                    const defaultMethodSettings = {};
                    Object.entries(supportedMethods).forEach(([methodKey, method]) => {
                        defaultMethodSettings[methodKey] = Object.entries(method.parameters).reduce((acc, [paramKey, param]) => {
                            acc[paramKey] = param.value;
                            return acc;
                        }, {});
                    });

                    newGroupConfigs[group.id] = {
                        organism: globalOrganism,
                        selectedDatasets: [],
                        methodSettings: defaultMethodSettings
                    };
                });
                setGroupConfigs(newGroupConfigs);

                notification.success({
                    message: 'Folder Analysis Complete',
                    description: `Found ${analyses.length} analyses${groupFileName ? ` and ${Object.keys(autoGroups || {}).length} auto-groups` : ''}. ${analyses.filter(a => a.metadata && a.metadata.trim() !== '').length} analyses have metadata.`
                });
            } else {
                // Start with empty groups
                setGroups({});
                setGroupConfigs({});
            }

            setCurrentStep(1);
        } catch (error) {
            console.error('Error parsing folder:', error);
            notification.error({
                message: 'Error parsing folder',
                description: error.message
            });
        } finally {
            console.log('✅ Folder upload processing complete, resetting state');
            setIsProcessingFolder(false);
            setProcessingProgress({ current: 0, total: 0, message: '' });
            setFolderStatuses([]);
            processingStartedRef.current = false; // Reset ref to allow future uploads
        }
    }, [globalOrganism, useLLMDetection, isProcessingFolder, folderStatuses]);

    // ADD these two new functions
    const showMetadataModal = (analysisName, metadata) => {
        setSelectedMetadata({
            name: analysisName,
            content: metadata
        });
        setMetadataModalVisible(true);
    };

    // Metadata editing handlers
    const handleEditMetadata = (record) => {
        setEditingMetadata({
            analysisName: record.name,
            metadata: record.metadata || { extracted: {}, raw: '', format: 'manual', confidence: 'manual' }
        });
        setEditedFields(record.metadata?.extracted || {});
        setEditMetadataModalVisible(true);
    };

    const handleSaveMetadata = () => {
        if (!editingMetadata) return;

        // Update the metadata in parsedAnalyses
        setParsedAnalyses(prev => prev.map(analysis => {
            if (analysis.name === editingMetadata.analysisName) {
                return {
                    ...analysis,
                    metadata: {
                        ...analysis.metadata,
                        extracted: { ...editedFields },
                        format: analysis.metadata?.format || 'manual',
                        confidence: 'manual', // Mark as manually edited
                        source: analysis.metadata?.source || 'manual'
                    }
                };
            }
            return analysis;
        }));

        setEditMetadataModalVisible(false);
        setEditingMetadata(null);
        setEditedFields({});

        notification.success({
            message: 'Metadata Updated',
            description: `Metadata for ${editingMetadata.analysisName} has been updated successfully.`
        });
    };

    const handleFieldChange = (fieldName, value) => {
        setEditedFields(prev => ({
            ...prev,
            [fieldName]: value
        }));
    };

    const handleDeleteField = (fieldName) => {
        setEditedFields(prev => {
            const newFields = { ...prev };
            delete newFields[fieldName];
            return newFields;
        });
    };

    const handleAddField = (fieldName) => {
        if (!fieldName || !fieldName.trim()) return;
        if (editedFields[fieldName] !== undefined) {
            notification.warning({
                message: 'Field Exists',
                description: 'This field already exists.'
            });
            return;
        }
        setEditedFields(prev => ({
            ...prev,
            [fieldName.trim()]: ''
        }));
    };

    // Standardization handlers
    const handleOpenStandardization = () => {
        const analysis = window.__metadataStandardization;
        if (!analysis) {
            notification.warning({
                message: 'No Analysis Available',
                description: 'Metadata standardization analysis is not available. Try re-uploading the data.'
            });
            return;
        }
        setStandardizationAnalysis(analysis);
        setStandardizeModalVisible(true);
    };

    const handleApplyStandardization = () => {
        if (!standardizationAnalysis) return;

        console.log('🔧 Standardization analysis:', standardizationAnalysis);

        const { datasetMappings, commonFields } = standardizationAnalysis;

        console.log('📋 Common fields:', commonFields);
        console.log('🗺️ Dataset mappings:', datasetMappings);
        console.log('📊 Number of datasets in mapping:', Object.keys(datasetMappings).length);

        // Count how many datasets will be affected
        let standardizedCount = 0;

        // Apply standardization to all parsed analyses
        setParsedAnalyses(prev => prev.map(analysis => {
            if (!analysis.metadata || !analysis.metadata.extracted) return analysis;

            const mapping = datasetMappings[analysis.name];
            if (!mapping) return analysis;

            standardizedCount++;

            // Apply field name mappings
            // mapping structure: { commonFieldName: originalFieldName }
            // Example: { "Age": "age", "Tissue": "Tissue type" }
            const originalFieldCount = Object.keys(analysis.metadata.extracted).length;
            const originalFields = Object.keys(analysis.metadata.extracted);
            const standardizedFields = {};

            console.log(`\n📊 Standardizing ${analysis.name}:`);
            console.log(`   Original fields (${originalFieldCount}):`, originalFields);
            console.log(`   Mapping for this dataset:`, mapping);

            // ONLY map common fields that exist in this dataset
            // Non-common fields are excluded from the standardized metadata
            Object.entries(mapping).forEach(([commonFieldName, originalFieldName]) => {
                if (analysis.metadata.extracted.hasOwnProperty(originalFieldName)) {
                    standardizedFields[commonFieldName] = analysis.metadata.extracted[originalFieldName];
                    console.log(`   ✓ Mapped: "${originalFieldName}" → "${commonFieldName}"`);
                }
            });

            // Log removed fields
            Object.keys(analysis.metadata.extracted).forEach(originalField => {
                const isMapped = Object.values(mapping).includes(originalField);
                if (!isMapped) {
                    console.log(`   ✗ Removed non-common field: "${originalField}"`);
                }
            });

            const newFieldCount = Object.keys(standardizedFields).length;
            const newFields = Object.keys(standardizedFields);
            console.log(`   Result: ${originalFieldCount} fields → ${newFieldCount} fields`);
            console.log(`   New fields (${newFieldCount}):`, newFields);

            if (originalFieldCount !== newFieldCount) {
                console.log(`   ✅ Reduced by ${originalFieldCount - newFieldCount} fields`);
            } else {
                console.log(`   ⚠️ No reduction (dataset had no duplicate variants)`);
            }

            return {
                ...analysis,
                metadata: {
                    ...analysis.metadata,
                    extracted: standardizedFields,
                    standardized: true
                }
            };
        }));

        setStandardizeModalVisible(false);

        notification.success({
            message: 'Standardization Applied',
            description: `Metadata fields have been standardized across ${Object.keys(datasetMappings).length} datasets. (${commonFields.length} common fields)`
        });
    };

    const addNewGroup = () => {
        if (!newGroupName.trim()) return;

        const groupId = `manual_${Date.now()}`;
        const newGroup = {
            id: groupId,
            name: newGroupName.trim(),
            description: newGroupDescription.trim(),
            inputType: null,
            analyses: [],
            isDefault: false,
            isAutoCreated: false
        };

        setGroups(prev => ({
            ...prev,
            [groupId]: newGroup
        }));

        setNewGroupName('');
        setNewGroupDescription('');

        notification.success({
            message: 'Group Created',
            description: `Group "${newGroup.name}" has been created successfully.`
        });
    };
    // GMT file parsing functions
    const readFile = async (file) => {
        return await new Promise(r => {
            let reader = new FileReader();
            reader.onload = function (event) {
                r(event.target.result)
            };
            reader.readAsText(file);
        })
    };

    const parseCSV = (text, d = ',') => {
        const lines = text.split('\n');
        const output = [];

        lines.forEach(line => {
            line = line.trim();

            if (line.length === 0) return;

            const skipIndexes = {};
            const columns = line.split(d);

            output.push(columns.reduce((result, item, index) => {
                if (skipIndexes[index]) return result;

                if (item.startsWith('"') && !item.endsWith('"')) {
                    while (!columns[index + 1].endsWith('"')) {
                        index++;
                        item += `,${columns[index]}`;
                        skipIndexes[index] = true;
                    }

                    index++;
                    skipIndexes[index] = true;
                    item += `,${columns[index]}`;
                }

                result.push(item);
                return result;
            }, []));
        });
        return output;
    };

    const handleGMTFileSelect = async (file) => {
        if (customGeneSets.length >= 3) {
            notification.error({
                message: 'Upload Limit Reached',
                description: 'Maximum 3 custom gene sets are supported'
            });
            return false;
        }

        if (!globalOrganism) {
            notification.error({
                message: 'Organism Required',
                description: 'Please select an organism before uploading custom gene sets'
            });
            return false;
        }

        // Detect format
        const detection = await AnalysisUtils.detectGMTFormat(file);
        console.log('GMT format detection (mass analysis):', detection);
        setGmtFormatDetection(detection);

        // Configure format settings
        if (detection.needsUserInput) {
            setShowGmtFormatConfig(true);
            if (detection.suggestion === 'custom') {
                setGmtFormatConfig({
                    pathwayNameColumn: 0,
                    pathwayIdColumn: null,
                    genesStartColumn: 2
                });
            }
        } else {
            setShowGmtFormatConfig(false);
            setGmtFormatConfig({
                pathwayNameColumn: 1,
                pathwayIdColumn: 0,
                genesStartColumn: 2
            });
        }

        // Set pending file and show naming modal
        setPendingGMTFile(file);
        setCustomGeneSetName(`Custom Gene Set ${customGeneSets.length + 1}`); // Default name
        setGmtNameModal(true);

        return false; // Prevent default upload behavior
    };

    const handleGMTUpload = async () => {
        if (!pendingGMTFile || !customGeneSetName.trim()) return;

        setIsUploadingGMT(true);

        try {
            const genesets = await AnalysisUtils.parseGMTFile(pendingGMTFile, gmtFormatConfig);

            await Meteor.callAsync("session.add.custom.geneSets", {
                sessionId,
                customGeneSet: genesets,
                name: customGeneSetName.trim(),
                taxId: globalOrganism
            });

            // Show success notification
            notification.success({
                message: 'GMT File Uploaded',
                description: `Successfully parsed and saved ${genesets.length} gene sets as "${customGeneSetName.trim()}"`
            });


        } catch (error) {
            console.error('Error in GMT upload:', error);
            notification.error({
                message: 'Upload Failed',
                description: error.message || 'Failed to parse GMT file. Please check the file format.'
            });
        }

        setPendingGMTFile(null);
        setCustomGeneSetName('');
        setIsUploadingGMT(false);
        setGmtNameModal(false);
        setGmtFormatDetection(null);
        setShowGmtFormatConfig(false);
    };

    const cancelGMTUpload = () => {
        console.log('Canceling GMT upload...'); // Debug log
        setPendingGMTFile(null);
        setCustomGeneSetName('');
        setGmtNameModal(false);
        setIsUploadingGMT(false); // Make sure loading state is reset on cancel too
        setGmtFormatDetection(null);
        setShowGmtFormatConfig(false);
    };

    const removeCustomGeneSet = async (geneSetId) => {
        try {
            // Call Meteor method to remove from session configs
            await Meteor.callAsync("session.remove.custom.geneSets", {
                sessionId,
                customGeneSetId: geneSetId
            });

            // Remove from local state
            setCustomGeneSets(prev => prev.filter(gs => gs._id !== geneSetId));

            // Also remove from any configurations that have it selected
            setDefaultConfig(prev => {
                const newConfig = {...prev};
                Object.keys(newConfig.inputTypeConfigs || {}).forEach(inputType => {
                    if (newConfig.inputTypeConfigs[inputType].selectedDatasets) {
                        newConfig.inputTypeConfigs[inputType].selectedDatasets =
                            newConfig.inputTypeConfigs[inputType].selectedDatasets.filter(id => id !== geneSetId);
                    }
                });
                return newConfig;
            });

            setGroupConfigs(prev => {
                const newConfigs = {...prev};
                Object.keys(newConfigs).forEach(groupId => {
                    if (newConfigs[groupId].selectedDatasets) {
                        newConfigs[groupId].selectedDatasets =
                            newConfigs[groupId].selectedDatasets.filter(id => id !== geneSetId);
                    }
                });
                return newConfigs;
            });

            notification.success({
                message: 'Custom Gene Set Removed',
                description: 'The custom gene set has been successfully removed'
            });
        } catch (error) {
            console.error('Error removing custom gene set:', error);
            notification.error({
                message: 'Removal Failed',
                description: error.message || 'Failed to remove custom gene set'
            });
        }
    };

    const createNewGroup = () => {
        if (!newGroupName.trim()) return;

        const groupId = `manual_${Date.now()}`;
        const newGroup = {
            id: groupId,
            name: newGroupName.trim(),
            description: newGroupDescription.trim(), // ADD this line
            inputType: null,
            analyses: [],
            isDefault: false,
            isAutoCreated: false
        };

        setGroups(prev => ({
            ...prev,
            [groupId]: newGroup
        }));

        setNewGroupName('');
        setNewGroupDescription(''); // ADD this line

        notification.success({
            message: 'Group Created',
            description: `Group "${newGroup.name}" has been created successfully.`
        });
    };

    const handleGroupFileUpload = useCallback(async (file) => {
        try {
            const newGroups = await FileParser.parseGroupFile(file, parsedAnalyses);

            if (newGroups && Object.keys(newGroups).length > 0) {
                // Merge with existing groups
                setGroups(prev => ({...prev, ...newGroups}));

                // Initialize group configs for new groups
                setGroupConfigs(prev => {
                    const newGroupConfigs = {...prev};
                    Object.values(newGroups).forEach(group => {
                        if (!newGroupConfigs[group.id]) {
                            newGroupConfigs[group.id] = {
                                organism: globalOrganism,
                                selectedDatasets: [],
                                methodSettings: MethodSettings.getDefaultSettingParams()[group.inputType] || {}
                            };
                        }
                    });
                    return newGroupConfigs;
                });

                notification.success({
                    message: 'Groups Imported',
                    description: `Successfully imported ${Object.keys(newGroups).length} groups from ${file.name}`
                });
            } else {
                notification.warning({
                    message: 'No Valid Groups Found',
                    description: 'The uploaded file did not contain any valid groups that match your analyses.'
                });
            }
        } catch (error) {
            console.error('Error parsing group file:', error);
            notification.error({
                message: 'Error Parsing Group File',
                description: error.message
            });
        }

        return false; // Prevent default upload behavior
    }, [parsedAnalyses, globalOrganism]);

    const handleDownloadGroups = useCallback(() => {
        if (Object.keys(groups).length === 0) {
            notification.warning({
                message: 'No Groups to Export',
                description: 'Create some groups first before downloading.'
            });
            return;
        }

        try {
            FileParser.downloadGroupFile(groups, parsedAnalyses);
            notification.success({
                message: 'Groups Downloaded',
                description: 'Groups file has been downloaded successfully.'
            });
        } catch (error) {
            console.error('Error downloading groups:', error);
            notification.error({
                message: 'Download Failed',
                description: error.message
            });
        }
    }, [groups, parsedAnalyses]);

    const deleteGroup = (groupId) => {
        const group = groups[groupId];
        if (group.isDefault) return; // Cannot delete default groups

        // Move analyses back to ungrouped
        group.analyses.forEach(analysisName => {
            // Analysis will become ungrouped
        });

        // Remove the group
        setGroups(prev => {
            const newGroups = {...prev};
            delete newGroups[groupId];
            return newGroups;
        });

        // Remove group config
        setGroupConfigs(prev => {
            const newConfigs = {...prev};
            delete newConfigs[groupId];
            return newConfigs;
        });
    };

    const moveAnalysisToGroup = (analysisName, fromGroupId, toGroupId) => {
        const analysis = parsedAnalyses.find(a => a.name === analysisName);
        if (!analysis) return;

        // If moving to a group, check input type compatibility
        if (toGroupId) {
            const targetGroup = groups[toGroupId];
            if (targetGroup.inputType && targetGroup.inputType !== analysis.inputType) {
                notification.error({
                    message: 'Cannot move analysis',
                    description: `Group "${targetGroup.name}" only accepts ${targetGroup.inputType.toUpperCase()} analyses`
                });
                return;
            }
        }

        setGroups(prev => {
            const newGroups = {...prev};

            // Remove from source group (if it was in a group)
            if (fromGroupId) {
                newGroups[fromGroupId] = {
                    ...newGroups[fromGroupId],
                    analyses: newGroups[fromGroupId].analyses.filter(name => name !== analysisName)
                };
            }

            // Add to target group (if moving to a group)
            if (toGroupId) {
                newGroups[toGroupId] = {
                    ...newGroups[toGroupId],
                    inputType: newGroups[toGroupId].inputType || analysis.inputType,
                    analyses: [...newGroups[toGroupId].analyses, analysisName]
                };

                // Initialize group config if needed
                if (!groupConfigs[toGroupId]) {
                    setGroupConfigs(prev => ({
                        ...prev,
                        [toGroupId]: (() => {
                            // Get supported methods for this input type
                            const supportedMethods = MethodSettings.getSupportedMethods(analysis.inputType);
                            const defaultMethodSettings = {};
                            Object.entries(supportedMethods).forEach(([methodKey, method]) => {
                                defaultMethodSettings[methodKey] = Object.entries(method.parameters).reduce((acc, [paramKey, param]) => {
                                    acc[paramKey] = param.value;
                                    return acc;
                                }, {});
                            });

                            return {
                                organism: globalOrganism, // Use global organism
                                selectedDatasets: [],
                                methodSettings: defaultMethodSettings
                            };
                        })()
                    }));
                }
            }

            return newGroups;
        });
    };

    const handleCreateAnalyses = async () => {
        setIsCreating(true);
        try {
            const massId = Random.id();
            setMassAnalysisId(massId);

            // Switch to progress view immediately so user can see real-time updates
            setCurrentStep(4);

            // Filter out analyses with errors
            const validAnalyses = parsedAnalyses.filter(analysis => !analysis.error);

            // Count expression analyses that need file uploads
            const expressionAnalyses = validAnalyses.filter(analysis => analysis.inputType === 'expression');

            if (expressionAnalyses.length > 0) {
                setProgress({
                    current: 0,
                    total: validAnalyses.length,
                    phase: 'uploading'
                });

                // Upload files for expression analyses BEFORE creating mass analysis
                const currentUser = Meteor.user();
                if (!currentUser) {
                    throw new Error('User not authenticated for file upload');
                }

                for (let i = 0; i < expressionAnalyses.length; i++) {
                    const analysis = expressionAnalyses[i];
                    setProgress({
                        current: i + 1,
                        total: expressionAnalyses.length,
                        phase: 'uploading',
                        currentFile: analysis.name
                    });

                    try {
                        // Upload expression file
                        const expressionFormData = new FormData();
                        expressionFormData.append('file', analysis.data.expressionFile);

                        // /api/upload now authenticates: the destination directory is derived from
                        // the session owner server-side, so the userId query param is ignored.
                        const expressionResponse = await fetch(`/api/upload?userId=${currentUser._id}&sessionId=${sessionId}&fileName=${encodeURIComponent(analysis.data.expressionFileName)}`, {
                            method: 'POST',
                            headers: authHeaders(),
                            body: expressionFormData
                        });

                        if (!expressionResponse.ok) {
                            throw new Error(`Failed to upload expression file: ${expressionResponse.statusText}`);
                        }

                        // Upload group file
                        const groupFormData = new FormData();
                        groupFormData.append('file', analysis.data.groupFile);

                        const groupResponse = await fetch(`/api/upload?userId=${currentUser._id}&sessionId=${sessionId}&fileName=${encodeURIComponent(analysis.data.groupFileName)}`, {
                            method: 'POST',
                            headers: authHeaders(),
                            body: groupFormData
                        });

                        if (!groupResponse.ok) {
                            throw new Error(`Failed to upload group file: ${groupResponse.statusText}`);
                        }

                        // Carry forward the names the SERVER wrote: the upload handler sanitises
                        // filenames, so recording the local name would point the analysis at a file
                        // that does not exist under that name.
                        const expressionStored = (await expressionResponse.json())?.fileName;
                        const groupStored = (await groupResponse.json())?.fileName;

                        // Update the analysis data to contain filenames instead of File objects
                        analysis.data = {
                            ...analysis.data,
                            expressionFileName: expressionStored || analysis.data.expressionFileName,
                            groupFileName: groupStored || analysis.data.groupFileName,
                            // Remove File objects to avoid serialization issues
                            expressionFile: undefined,
                            groupFile: undefined
                        };

                    } catch (error) {
                        console.error(`Error uploading files for analysis ${analysis.name}:`, error);
                        throw new Error(`Failed to upload files for ${analysis.name}: ${error.message}`);
                    }
                }
            }

            // Bake the chosen PGSEA ranking into each analysis's 2-column `content`.
            // The backend only reads `data.content` (createPgseaParams), so the ranking
            // column must be selected here. Precedence: individual override → group
            // config → per-input-type default → 'fc' (resolvePgseaRankingBy also clamps
            // to what the file supports). We build a fresh array (no state mutation) and
            // strip the bulky client-only fields (`rows`/`available`/`delimiter`, up to
            // ~17k rows/dataset) that the server never reads, to keep the DDP payload small.
            const analysesToSubmit = parsedAnalyses.map(analysis => {
                if (analysis.inputType !== 'pgsea' || !analysis.data?.rows) return analysis;
                const groupId = Object.keys(groups).find(gid => groups[gid]?.analyses?.includes(analysis.name));
                const rb = resolvePgseaRankingBy([
                    individualOverrides?.[analysis.name]?.rankingBy,
                    groupId ? groupConfigs[groupId]?.rankingBy : undefined,
                    defaultConfig?.inputTypeConfigs?.[analysis.inputType]?.rankingBy,
                ], analysis.data.available);
                const {rows, available, delimiter, ...restData} = analysis.data;
                return {
                    ...analysis,
                    data: {...restData, rankingBy: rb, content: buildPgseaContent(rows, rb)}
                };
            });

            // Create mass analysis record with updated analysis data
            await Meteor.callAsync('massAnalysis.create', {
                massAnalysisId: massId,
                sessionId,
                analyses: analysesToSubmit, // Now contains filenames for expression analyses
                groups,
                groupConfigs,
                individualOverrides,
                defaultConfig,
                globalOrganism // Pass global organism
            });

            console.log('Mass Analysis Creation - Group Configs:', groupConfigs);
            console.log('Mass Analysis Creation - Default Config:', defaultConfig);
            Object.values(groups).forEach(group => {
                const config = groupConfigs[group.id];
                console.log(`Group "${group.name}" config:`, config);
                if (config && config.methodSettings) {
                    const enabledMethods = Object.entries(config.methodSettings)
                        .filter(([method, settings]) => settings.enabled)
                        .map(([method]) => method);
                    console.log(`Group "${group.name}" enabled methods:`, enabledMethods);
                }
            });

            // Note: setCurrentStep(4) is called at the beginning of handleCreateAnalyses
            // so user can see real-time progress updates via reactive subscription

        } catch (error) {
            console.error('Error creating mass analysis:', error);
            notification.error({
                message: 'Error creating analyses',
                description: error.message
            });
        } finally {
            setIsCreating(false);
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 0:
                return (
                    <div style={{padding: '20px 0', position: 'relative'}}>
                        {/* Loading overlay with folder progress */}
                        {isProcessingFolder && (
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                                zIndex: 1000,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                                padding: '40px',
                                overflowY: 'auto'
                            }}>
                                <Spin size="large" />
                                <Title level={4} style={{marginTop: 24, marginBottom: 12}}>
                                    {useLLMDetection ? 'Analyzing Folders with AI...' : 'Processing Folders...'}
                                </Title>
                                {processingProgress.message && (
                                    <Text type="secondary" style={{marginBottom: 24}}>{processingProgress.message}</Text>
                                )}

                                {/* Folder status table */}
                                {folderStatuses.length > 0 && (
                                    <Card
                                        title="Folder Processing Status"
                                        size="small"
                                        style={{width: '100%', maxWidth: 800, marginTop: 16}}
                                    >
                                        <Table
                                            size="small"
                                            dataSource={folderStatuses}
                                            pagination={false}
                                            rowKey="name"
                                            columns={[
                                                {
                                                    title: 'Folder Name',
                                                    dataIndex: 'name',
                                                    key: 'name',
                                                    render: (name) => <Text strong>{name}</Text>
                                                },
                                                {
                                                    title: 'Status',
                                                    dataIndex: 'status',
                                                    key: 'status',
                                                    render: (status, record) => {
                                                        if (status === 'pending') {
                                                            return <Tag icon={<ClockCircleOutlined />} color="default">Pending</Tag>;
                                                        } else if (status === 'processing') {
                                                            return <Tag icon={<Spin size="small" />} color="processing">Processing...</Tag>;
                                                        } else if (status === 'complete') {
                                                            const isValid = record.result?.validation?.valid;
                                                            if (isValid === true) {
                                                                return <Tag icon={<CheckCircleOutlined />} color="success">Valid</Tag>;
                                                            } else if (isValid === false) {
                                                                return <Tag icon={<ExclamationCircleOutlined />} color="warning">Issues Detected</Tag>;
                                                            } else {
                                                                return <Tag icon={<CheckCircleOutlined />} color="success">Complete</Tag>;
                                                            }
                                                        }
                                                        return <Tag>Unknown</Tag>;
                                                    }
                                                },
                                                {
                                                    title: 'Type',
                                                    key: 'type',
                                                    render: (_, record) => {
                                                        if (record.result?.detectedType) {
                                                            return (
                                                                <Tag color={getInputTypeColor(record.result.detectedType)}>
                                                                    {record.result.detectedType.toUpperCase()}
                                                                </Tag>
                                                            );
                                                        }
                                                        return '-';
                                                    }
                                                }
                                            ]}
                                        />
                                    </Card>
                                )}

                                {useLLMDetection && folderStatuses.length === 0 && (
                                    <Alert
                                        message="AI is detecting input types and validating data formats"
                                        description="This may take a few moments depending on the number of folders"
                                        type="info"
                                        showIcon
                                        style={{marginTop: 16, maxWidth: 500}}
                                    />
                                )}
                            </div>
                        )}

                        <Alert
                            message="Folder Structure Requirements"
                            description={
                                <div>
                                    <p>Each subfolder represents one analysis.</p>
                                    <p><strong>Optional files:</strong></p>
                                    <ul>
                                        <li><code>metadata.txt</code> - Any text describing the dataset</li>
                                        <li><code>groups.txt</code> - Group definitions with optional descriptions</li>
                                    </ul>
                                    <p><strong>Group file format:</strong></p>
                                    <ul>
                                        <li>Basic: <code>Group Name: Analysis1, Analysis2</code></li>
                                        <li>With description: <code>Group Name [Description]: Analysis1,
                                            Analysis2</code></li>
                                    </ul>
                                </div>
                            }
                            type="info"
                            style={{marginBottom: 16}}
                        />

                        <div style={{marginBottom: 16}}>
                            <Checkbox
                                checked={useLLMDetection}
                                onChange={(e) => setUseLLMDetection(e.target.checked)}
                                disabled={isProcessingFolder}
                            >
                                Use AI to auto-detect input types and validate data formats (recommended)
                            </Checkbox>
                        </div>

                        <Dragger
                            multiple
                            directory
                            beforeUpload={() => false}
                            onChange={({fileList}) => {
                                // Only process when all files are fully loaded (not in 'uploading' state)
                                // This prevents multiple onChange triggers during file reading
                                const allLoaded = fileList.length > 0 && fileList.every(f => !f.status || f.status === 'done');
                                const statusCounts = fileList.reduce((acc, f) => {
                                    const status = f.status || 'no-status';
                                    acc[status] = (acc[status] || 0) + 1;
                                    return acc;
                                }, {});
                                console.log(`📂 Dragger onChange: ${fileList.length} files, allLoaded: ${allLoaded}, statuses:`, statusCounts);
                                if (allLoaded) {
                                    console.log('✅ All files loaded, starting processing...');
                                    handleFolderUpload(fileList);
                                } else {
                                    console.log('⏳ Files still loading, skipping processing...');
                                }
                            }}
                            style={{padding: '40px 20px'}}
                            disabled={isProcessingFolder}
                        >
                            <p className="ant-upload-drag-icon">
                                <InboxOutlined/>
                            </p>
                            <p className="ant-upload-text">
                                Click or drag folder to this area to upload
                            </p>
                            <p className="ant-upload-hint">
                                Select a folder containing subfolders with analysis data
                            </p>
                        </Dragger>
                    </div>
                );

            case 1:
                const analysisColumns = [
                    {
                        title: 'Analysis Name',
                        dataIndex: 'name',
                        key: 'name',
                        render: (name) => <Text strong>{name}</Text>
                    },
                    {
                        title: 'Type',
                        dataIndex: 'inputType',
                        key: 'inputType',
                        render: (inputType, record) => {
                            // Use LLM-detected type if available, otherwise use parsed inputType
                            const displayType = record.llmDetection?.detectedType || inputType;
                            return (
                                <Space direction="vertical" size={2}>
                                    <Tag color={getInputTypeColor(displayType)}>
                                        {displayType.toUpperCase()}
                                    </Tag>
                                    {record.llmDetection && (
                                        <Text type="secondary" style={{fontSize: '11px'}}>
                                            AI: {record.llmDetection.confidence} confidence
                                        </Text>
                                    )}
                                </Space>
                            );
                        }
                    },
                    {
                        title: 'Metadata',
                        key: 'metadata',
                        width: 250,
                        render: (_, record) => {
                            if (!record.metadata || !record.metadata.extracted || Object.keys(record.metadata.extracted).length === 0) {
                                return <Tag color="default">No metadata</Tag>;
                            }

                            const { extracted, confidence } = record.metadata;
                            const fieldCount = Object.keys(extracted).length;

                            // Show first few important fields
                            const displayFields = [];
                            if (extracted.datasetId) displayFields.push({ key: 'ID', value: extracted.datasetId });
                            if (extracted.tissue) displayFields.push({ key: 'Tissue', value: extracted.tissue });
                            if (extracted.disease) displayFields.push({ key: 'Disease', value: extracted.disease });

                            return (
                                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                    {displayFields.slice(0, 2).map(({ key, value }) => (
                                        <div key={key} style={{ fontSize: 11 }}>
                                            <Text strong style={{ fontSize: 11 }}>{key}:</Text> {value}
                                        </div>
                                    ))}
                                    <div>
                                        <Tag color="blue" style={{ fontSize: 10 }}>{fieldCount} fields</Tag>
                                        {confidence && (
                                            <Tag color={confidence === 'high' ? 'green' : confidence === 'medium' ? 'orange' : 'default'} style={{ fontSize: 10 }}>
                                                {confidence}
                                            </Tag>
                                        )}
                                        {record.metadata.standardized && (
                                            <Tag color="purple" style={{ fontSize: 10 }}>
                                                Standardized
                                            </Tag>
                                        )}
                                    </div>
                                </Space>
                            );
                        }
                    },
                    {
                        title: 'Files',
                        key: 'files',
                        width: 200,
                        ellipsis: {
                            showTitle: false,
                        },
                        render: (_, record) => {
                            const fileNames = record.files.map(f => f.name).join(', ');
                            return (
                                <Tooltip title={fileNames}>
                                    <span>{fileNames}</span>
                                </Tooltip>
                            );
                        }
                    },
                    {
                        title: 'Validation',
                        key: 'validation',
                        render: (_, record) => {
                            if (!record.llmDetection || !record.llmDetection.validation) {
                                return <Tag color="default">Not validated</Tag>;
                            }

                            const validation = record.llmDetection.validation;
                            if (validation.valid) {
                                return <Tag color="success" icon={<CheckCircleOutlined />}>Valid</Tag>;
                            } else {
                                return <Tag color="warning" icon={<ExclamationCircleOutlined />}>
                                    {validation.errors?.length || 0} issues
                                </Tag>;
                            }
                        }
                    },
                    {
                        title: 'Status',
                        key: 'status',
                        render: (_, record) => {
                            // Check for parsing errors first
                            if (record.error) {
                                return <Tag color="red">Error: {record.error}</Tag>;
                            }

                            // Check if detected type is ambiguous or unknown - these are errors
                            const detectedType = record.llmDetection?.detectedType || record.inputType;
                            if (detectedType === 'ambiguous') {
                                return <Tag color="red">Error: Ambiguous input type - multiple analysis types detected</Tag>;
                            }
                            if (detectedType === 'unknown') {
                                return <Tag color="red">Error: Unknown input type - cannot determine analysis type</Tag>;
                            }

                            // Check validation results
                            const validation = record.llmDetection?.validation;
                            if (validation && !validation.valid && validation.errors && validation.errors.length > 0) {
                                return <Tag color="orange">Warning: Data has {validation.errors.length} validation issue(s)</Tag>;
                            }

                            return <Tag color="green">Ready</Tag>;
                        }
                    }
                ];
                return (
                    <div>
                        <Title level={4}>Review Analyses ({parsedAnalyses.length})</Title>

                        <Alert
                            message={`${selectedAnalyses.length} of ${parsedAnalyses.length} analyses selected`}
                            description="Only selected analyses will proceed to the next step. Valid analyses are auto-selected by default."
                            type="info"
                            showIcon
                            style={{marginBottom: 16}}
                        />

                        {/* Metadata Management Buttons */}
                        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <Button
                                icon={<EditOutlined />}
                                onClick={() => setEditMetadataModalVisible(true)}
                                disabled={parsedAnalyses.filter(a => a.metadata?.extracted).length === 0}
                            >
                                Edit All Metadata
                            </Button>
                            <Button
                                icon={<InfoCircleOutlined />}
                                onClick={handleOpenStandardization}
                                disabled={!window.__metadataStandardization}
                            >
                                Standardize Metadata
                            </Button>
                        </div>

                        <Table
                            size="small"
                            dataSource={parsedAnalyses}
                            columns={analysisColumns}
                            pagination={false}
                            rowKey="name"
                            style={{marginBottom: 20}}
                            scroll={{ x: 'max-content' }}
                            rowSelection={{
                                selectedRowKeys: selectedAnalyses,
                                onChange: (selectedRowKeys) => {
                                    setSelectedAnalyses(selectedRowKeys);
                                    console.log(`Selected ${selectedRowKeys.length} analyses:`, selectedRowKeys);
                                },
                                getCheckboxProps: (record) => ({
                                    // Disable checkbox for error/ambiguous/unknown types
                                    disabled: record.error ||
                                             (record.llmDetection?.detectedType === 'ambiguous') ||
                                             (record.llmDetection?.detectedType === 'unknown'),
                                }),
                            }}
                            expandable={{
                                expandedRowRender: (record) => {
                                    if (!record.llmDetection) {
                                        return <Text type="secondary">No AI detection data available</Text>;
                                    }

                                    const { llmDetection } = record;
                                    const { validation, reasoning, detectedType, confidence } = llmDetection;

                                    return (
                                        <div style={{ padding: '12px 0' }}>
                                            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                                {/* Detection Info */}
                                                <Card size="small" title="AI Detection Results">
                                                    <Space direction="vertical" style={{ width: '100%' }}>
                                                        <div>
                                                            <Text strong>Detected Type: </Text>
                                                            <Tag color={getInputTypeColor(detectedType)}>{detectedType?.toUpperCase() || 'Unknown'}</Tag>
                                                        </div>
                                                        <div>
                                                            <Text strong>Confidence: </Text>
                                                            <Tag color={confidence === 'high' ? 'green' : confidence === 'medium' ? 'orange' : 'default'}>
                                                                {confidence?.toUpperCase() || 'UNKNOWN'}
                                                            </Tag>
                                                        </div>
                                                        {reasoning && (
                                                            <div>
                                                                <Text strong>Reasoning: </Text>
                                                                <Text type="secondary">{reasoning}</Text>
                                                            </div>
                                                        )}
                                                    </Space>
                                                </Card>

                                                {/* Validation Results */}
                                                {validation && (
                                                    <Card
                                                        size="small"
                                                        title={
                                                            <Space>
                                                                {validation.valid ?
                                                                    <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
                                                                    <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                                                                }
                                                                <span>Validation Results</span>
                                                            </Space>
                                                        }
                                                    >
                                                        <Space direction="vertical" style={{ width: '100%' }}>
                                                            <div>
                                                                <Text strong>Status: </Text>
                                                                <Tag color={validation.valid ? 'success' : 'warning'}>
                                                                    {validation.valid ? 'VALID' : 'ISSUES DETECTED'}
                                                                </Tag>
                                                            </div>

                                                            {validation.detectedFormat && (
                                                                <div>
                                                                    <Text strong>Detected Format: </Text>
                                                                    <Text type="secondary">{validation.detectedFormat}</Text>
                                                                </div>
                                                            )}

                                                            {validation.confidence && (
                                                                <div>
                                                                    <Text strong>Validation Confidence: </Text>
                                                                    <Tag color={validation.confidence === 'high' ? 'green' : validation.confidence === 'medium' ? 'orange' : 'default'}>
                                                                        {validation.confidence.toUpperCase()}
                                                                    </Tag>
                                                                </div>
                                                            )}

                                                            {validation.errors && validation.errors.length > 0 && (
                                                                <div>
                                                                    <Text strong>Errors:</Text>
                                                                    <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                                                                        {validation.errors.map((error, idx) => (
                                                                            <li key={idx}>
                                                                                <Text type="danger">{error}</Text>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}

                                                            {validation.suggestions && validation.suggestions.length > 0 && (
                                                                <div>
                                                                    <Text strong>Suggestions:</Text>
                                                                    <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                                                                        {validation.suggestions.map((suggestion, idx) => (
                                                                            <li key={idx}>
                                                                                <Text type="secondary">{suggestion}</Text>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                        </Space>
                                                    </Card>
                                                )}

                                                {/* Extracted Metadata */}
                                                {record.metadata && record.metadata.extracted && Object.keys(record.metadata.extracted).length > 0 && (
                                                    <Card size="small" title="Extracted Metadata">
                                                        <Space direction="vertical" style={{ width: '100%' }}>
                                                            <div>
                                                                <Text strong>Source: </Text>
                                                                <Tag color="blue">{record.metadata.source || 'Unknown'}</Tag>
                                                                <Text strong>Format: </Text>
                                                                <Tag color="cyan">{record.metadata.format || 'unknown'}</Tag>
                                                                {record.metadata.confidence && (
                                                                    <>
                                                                        <Text strong>Confidence: </Text>
                                                                        <Tag color={record.metadata.confidence === 'high' ? 'green' : record.metadata.confidence === 'medium' ? 'orange' : 'default'}>
                                                                            {record.metadata.confidence.toUpperCase()}
                                                                        </Tag>
                                                                    </>
                                                                )}
                                                            </div>

                                                            <Divider style={{ margin: '8px 0' }} />

                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                                                                gap: '12px',
                                                                maxHeight: '300px',
                                                                overflowY: 'auto'
                                                            }}>
                                                                {Object.entries(record.metadata.extracted).map(([key, value]) => (
                                                                    <div key={key} style={{
                                                                        padding: '8px',
                                                                        background: '#fafafa',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #f0f0f0'
                                                                    }}>
                                                                        <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>
                                                                            {key}
                                                                        </div>
                                                                        <div style={{ fontSize: 12, fontWeight: 500 }}>
                                                                            {Array.isArray(value) ? value.join(', ') : String(value)}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            {record.metadata.raw && (
                                                                <Collapse ghost style={{ marginTop: 12 }}>
                                                                    <Collapse.Panel header="View Raw Metadata" key="1">
                                                                        <pre style={{
                                                                            fontSize: 11,
                                                                            background: '#f5f5f5',
                                                                            padding: '12px',
                                                                            borderRadius: '4px',
                                                                            maxHeight: '200px',
                                                                            overflow: 'auto'
                                                                        }}>
                                                                            {record.metadata.raw}
                                                                        </pre>
                                                                    </Collapse.Panel>
                                                                </Collapse>
                                                            )}
                                                        </Space>
                                                    </Card>
                                                )}
                                            </Space>
                                        </div>
                                    );
                                },
                                rowExpandable: (record) => !!record.llmDetection || (record.metadata && Object.keys(record.metadata.extracted || {}).length > 0)
                            }}
                        />

                        <Space direction="vertical" style={{width: '100%'}}>
                            <Card
                                title={
                                    <Space>
                                        <GroupOutlined/>
                                        <span>Group Management (Optional)</span>
                                    </Space>
                                }
                                size="small"
                                extra={
                                    <Button
                                        icon={<SettingOutlined/>}
                                        onClick={() => setShowGroupManagement(!showGroupManagement)}
                                    >
                                        {showGroupManagement ? 'Hide' : 'Manage Groups'}
                                    </Button>
                                }
                            >
                                {!showGroupManagement && (
                                    <Text type="secondary">
                                        Click "Manage Groups" to organize analyses into groups. This is optional -
                                        analyses can run individually without grouping.
                                    </Text>
                                )}

                                {showGroupManagement && (
                                    <Space direction="vertical" style={{width: '100%'}}>
                                        <Card title="Group File Management" size="small">
                                            <Space direction="vertical" style={{width: '100%'}}>
                                                <Text type="secondary">
                                                    Upload a group file to automatically create groups, or download your
                                                    current groups.
                                                </Text>
                                                <Space>
                                                    <Upload
                                                        accept=".txt,.csv"
                                                        showUploadList={false}
                                                        beforeUpload={handleGroupFileUpload}
                                                    >
                                                        <Button icon={<UploadOutlined/>}>
                                                            Upload Group File
                                                        </Button>
                                                    </Upload>
                                                    <Button
                                                        icon={<DownloadOutlined/>}
                                                        onClick={handleDownloadGroups}
                                                        disabled={Object.keys(groups).length === 0}
                                                    >
                                                        Download Groups
                                                    </Button>
                                                </Space>
                                                <Alert
                                                    message="Group File Format"
                                                    description={
                                                        <div>
                                                            <Text>Expected format (one group per line):</Text>
                                                            <pre style={{
                                                                margin: '8px 0',
                                                                fontSize: '12px',
                                                                background: '#f5f5f5',
                                                                padding: '8px',
                                                                borderRadius: '4px'
                                                            }}>
                                                                {`Individual Analysis Specification:
                                                                Group 1: Analysis1, Analysis2, Analysis3
                                                                Group 2: Analysis4, Analysis5, Analysis6
                                                                
                                                                With descriptions:
                                                                Treatment Group [Samples treated with compound X]: Analysis1, Analysis2
                                                                Control Group [Untreated control samples]: Analysis3, Analysis4
                                                                
                                                                Folder-Based Grouping (NEW):
                                                                High Radiosensitivity [High dose treatment]: /high
                                                                Low Radiosensitivity [Low dose treatment]: /low
                                                                Control Group: /control
                                                                
                                                                Mixed Specification:
                                                                High Group: /high_folder
                                                                Low Group: /low_folder  
                                                                Special Cases [Manual selection]: Analysis7, Analysis8
                                                                Combined: /medium, Analysis9, Analysis10`}
                                                                            </pre>
                                                            <div style={{marginTop: '12px'}}>
                                                                <Text strong style={{color: '#1890ff'}}>New Feature:
                                                                    Folder-Based Grouping</Text>
                                                                <ul style={{margin: '4px 0 0 16px', fontSize: '12px'}}>
                                                                    <li>Use <code>/folder_name</code> to include all
                                                                        analyses in that folder
                                                                    </li>
                                                                    <li>Supports nested
                                                                        paths: <code>/treatment/high_dose</code></li>
                                                                    <li>Automatically discovers all analyses within the
                                                                        specified folder
                                                                    </li>
                                                                    <li>Can mix folder paths and individual analysis
                                                                        names in the same file
                                                                    </li>
                                                                </ul>
                                                            </div>
                                                            <Text type="secondary" style={{
                                                                fontSize: '12px',
                                                                display: 'block',
                                                                marginTop: '8px'
                                                            }}>
                                                                Analysis names must match your uploaded folder names
                                                                exactly.
                                                                Descriptions in [brackets] are optional.
                                                                Folder paths starting with "/" will automatically
                                                                include all analyses in that folder.
                                                            </Text>
                                                        </div>
                                                    }
                                                    type="info"
                                                    style={{marginBottom: 16}}
                                                />
                                            </Space>
                                        </Card>

                                        {/* ENHANCED: Create New Group with Description */}
                                        <Card title="Create New Group" size="small">
                                            <Space direction="vertical" style={{width: '100%'}}>
                                                <Input
                                                    placeholder="Group name"
                                                    value={newGroupName}
                                                    onChange={(e) => setNewGroupName(e.target.value)}
                                                />
                                                <Input.TextArea
                                                    placeholder="Group description (optional)"
                                                    value={newGroupDescription}
                                                    onChange={(e) => setNewGroupDescription(e.target.value)}
                                                    rows={2}
                                                />
                                                <Button
                                                    type="primary"
                                                    icon={<PlusOutlined/>}
                                                    onClick={createNewGroup}
                                                    disabled={!newGroupName.trim()}
                                                >
                                                    Create Group
                                                </Button>
                                            </Space>
                                        </Card>

                                        {/* Ungrouped Analyses Section */}
                                        <Card title="Ungrouped Analyses" size="small">
                                            <UngroupedAnalysesManager
                                                parsedAnalyses={parsedAnalyses}
                                                groups={groups}
                                                onAssignToGroup={(analysisName, groupId) => moveAnalysisToGroup(analysisName, null, groupId)}
                                            />
                                        </Card>

                                        {/* ENHANCED: Existing Groups with Descriptions */}
                                        {Object.values(groups).map(group => (
                                            <Card
                                                key={group.id}
                                                title={
                                                    <div>
                                                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                                            <GroupOutlined/>
                                                            <span style={{fontWeight: 'bold'}}>{group.name}</span>
                                                            {group.isAutoCreated && (
                                                                <Tag color="green" size="small">Auto-Created</Tag>
                                                            )}
                                                            {group.inputType && (
                                                                <Tag color={getInputTypeColor(group.inputType)}>
                                                                    {group.inputType.toUpperCase()}
                                                                </Tag>
                                                            )}
                                                            <Text
                                                                type="secondary">({group.analyses.length} analyses)</Text>
                                                        </div>
                                                        {/* ADD: Group Description Display */}
                                                        {group.description && (
                                                            <div style={{
                                                                fontSize: '12px',
                                                                color: '#666',
                                                                fontWeight: 'normal',
                                                                fontStyle: 'italic',
                                                                marginTop: 4,
                                                                marginLeft: 20
                                                            }}>
                                                                {group.description}
                                                            </div>
                                                        )}
                                                    </div>
                                                }
                                                extra={!group.isDefault && (
                                                    <Button
                                                        danger
                                                        size="small"
                                                        icon={<DeleteOutlined/>}
                                                        onClick={() => deleteGroup(group.id)}
                                                    />
                                                )}
                                                size="small"
                                                style={{
                                                    borderLeft: group.isAutoCreated ? '3px solid #52c41a' : undefined
                                                }}
                                            >
                                                <GroupAnalysisManager
                                                    group={group}
                                                    allGroups={groups}
                                                    parsedAnalyses={parsedAnalyses}
                                                    onMoveAnalysis={moveAnalysisToGroup}
                                                    onRemoveFromGroup={(analysisName) => moveAnalysisToGroup(analysisName, group.id, null)}
                                                />
                                            </Card>
                                        ))}
                                    </Space>
                                )}
                            </Card>
                        </Space>

                        {/* ADD: Metadata Modal */}
                        <Modal
                            title={`Metadata: ${selectedMetadata?.name}`}
                            open={metadataModalVisible}
                            onCancel={() => setMetadataModalVisible(false)}
                            footer={[
                                <Button key="close" onClick={() => setMetadataModalVisible(false)}>
                                    Close
                                </Button>
                            ]}
                            width={700}
                        >
                            {selectedMetadata && (
                                <div style={{
                                    whiteSpace: 'pre-wrap',
                                    backgroundColor: '#f5f5f5',
                                    padding: '16px',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    lineHeight: '1.6',
                                    maxHeight: '400px',
                                    overflow: 'auto',
                                    border: '1px solid #e0e0e0'
                                }}>
                                    {selectedMetadata.content || 'No metadata available for this analysis'}
                                </div>
                            )}
                        </Modal>

                        {/* Standardize Metadata Modal */}
                        <Modal
                            title="Standardize Metadata Fields"
                            open={standardizeModalVisible}
                            onCancel={() => setStandardizeModalVisible(false)}
                            onOk={handleApplyStandardization}
                            width={900}
                            okText="Apply Standardization"
                            cancelText="Cancel"
                        >
                            {standardizationAnalysis && (
                                <Space direction="vertical" style={{ width: '100%' }} size="large">
                                    {/* Summary */}
                                    <Alert
                                        message={`Found ${standardizationAnalysis.commonFields.length} common fields`}
                                        description={`These fields appear in multiple datasets and will be standardized to use consistent naming. Each dataset will be standardized based on the fields it contains.`}
                                        type="success"
                                        showIcon
                                    />

                                    {/* Common Fields */}
                                    <div>
                                        <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>
                                            Common Fields Detected (appearing in 60%+ of datasets):
                                        </Text>
                                        <Table
                                            size="small"
                                            dataSource={standardizationAnalysis.commonFields}
                                            columns={[
                                                {
                                                    title: 'Field Name',
                                                    dataIndex: 'name',
                                                    key: 'name',
                                                    render: (text) => <Text strong>{text}</Text>
                                                },
                                                {
                                                    title: 'Description',
                                                    dataIndex: 'description',
                                                    key: 'description'
                                                },
                                                {
                                                    title: 'Coverage',
                                                    dataIndex: 'coverage',
                                                    key: 'coverage',
                                                    width: 100,
                                                    render: (count) => (
                                                        <Tag color={count === parsedAnalyses.length ? 'green' : 'orange'}>
                                                            {count}/{parsedAnalyses.length}
                                                        </Tag>
                                                    )
                                                },
                                                {
                                                    title: 'Aliases',
                                                    dataIndex: 'aliases',
                                                    key: 'aliases',
                                                    render: (aliases) => (
                                                        <Space size={4} wrap>
                                                            {aliases.map(alias => (
                                                                <Tag key={alias} style={{ fontSize: 10 }}>{alias}</Tag>
                                                            ))}
                                                        </Space>
                                                    )
                                                }
                                            ]}
                                            pagination={false}
                                            rowKey="name"
                                        />
                                    </div>

                                    {/* Missing Fields Warning */}
                                    {Object.keys(standardizationAnalysis.missingFields).some(
                                        datasetId => standardizationAnalysis.missingFields[datasetId].length > 0
                                    ) && (
                                        <Alert
                                            message="Some datasets have missing fields"
                                            description={
                                                <div>
                                                    {Object.entries(standardizationAnalysis.missingFields)
                                                        .filter(([_, missing]) => missing.length > 0)
                                                        .map(([datasetId, missing]) => (
                                                            <div key={datasetId} style={{ marginTop: 4 }}>
                                                                <Text strong>{datasetId}:</Text> Missing {missing.join(', ')}
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            }
                                            type="warning"
                                            showIcon
                                        />
                                    )}

                                    <Divider />

                                    <Text type="secondary">
                                        Applying standardization will rename fields across all datasets to use common field names.
                                        This helps ensure consistency and makes comparison easier. You can still edit individual fields after standardization.
                                    </Text>
                                </Space>
                            )}
                        </Modal>

                        {/* Comprehensive Metadata Editor Modal */}
                        <MetadataEditorModal
                            visible={editMetadataModalVisible}
                            onCancel={() => setEditMetadataModalVisible(false)}
                            parsedAnalyses={parsedAnalyses}
                            onSave={(updatedAnalyses) => {
                                setParsedAnalyses(updatedAnalyses);
                                setEditMetadataModalVisible(false);
                                notification.success({
                                    message: 'Metadata Updated',
                                    description: 'All metadata changes have been saved.'
                                });
                            }}
                        />
                    </div>
                );

            case 2: // Configure Settings (was step 3)
                const activeGroups = Object.values(groups).filter(group => group.analyses.length > 0);
                const groupedAnalysisNames = new Set();
                activeGroups.forEach(group => {
                    group.analyses.forEach(name => groupedAnalysisNames.add(name));
                });
                const ungroupedAnalyses = parsedAnalyses.filter(analysis =>
                    !analysis.error && !groupedAnalysisNames.has(analysis.name)
                );

                // Group ungrouped analyses by input type
                const ungroupedByType = {};
                ungroupedAnalyses.forEach(analysis => {
                    if (!ungroupedByType[analysis.inputType]) {
                        ungroupedByType[analysis.inputType] = [];
                    }
                    ungroupedByType[analysis.inputType].push(analysis);
                });

                return (
                    <div>
                        <Title level={4}>Configure Settings</Title>

                        {/* Global Configuration Section */}
                        <Card title="Global Configuration" style={{marginBottom: 16}}>
                            <Space direction="vertical" style={{width: '100%'}}>
                                {/* Organism Selection */}
                                <div>
                                    <Text strong>Select Organism (applies to all analyses):</Text>
                                    <Select
                                        showSearch
                                        placeholder="Search and select organism"
                                        style={{width: '100%', marginTop: 8}}
                                        value={globalOrganism}
                                        onChange={setGlobalOrganism}
                                        filterOption={(input, option) =>
                                            option.children.toLowerCase().includes(input.toLowerCase())
                                        }
                                    >
                                        {organisms.map(org => (
                                            <Select.Option key={org._id} value={org.taxId}>
                                                {org.name}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                    {!globalOrganism && (
                                        <Text type="danger" style={{fontSize: '12px'}}>
                                            Please select an organism to continue
                                        </Text>
                                    )}
                                </div>

                                {/* Custom Gene Set Upload */}
                                <div>
                                    <Text strong>Upload Custom Gene Sets (Optional):</Text>
                                    {!globalOrganism && (
                                        <div style={{marginTop: 4, marginBottom: 8}}>
                                            <Text type="warning" style={{fontSize: '12px'}}>
                                                Please select an organism above before uploading custom gene sets
                                            </Text>
                                        </div>
                                    )}
                                    <div style={{marginTop: 8}}>
                                        <Upload
                                            accept=".gmt,.tmt"
                                            beforeUpload={handleGMTFileSelect} // Changed from handleGMTUpload
                                            showUploadList={false}
                                            disabled={isUploadingGMT || customGeneSets.length >= 3 || !globalOrganism}
                                        >
                                            <Button
                                                icon={<UploadOutlined/>}
                                                loading={isUploadingGMT}
                                                disabled={customGeneSets.length >= 3 || !globalOrganism}
                                            >
                                                {isUploadingGMT ? 'Uploading...' : 'Upload GMT File'}
                                            </Button>
                                        </Upload>
                                        <Text type="secondary" style={{marginLeft: 8, fontSize: '12px'}}>
                                            Maximum 3 custom gene sets allowed
                                        </Text>
                                    </div>

                                    {/* Display uploaded custom gene sets */}
                                    {customGeneSets.length > 0 && (
                                        <div style={{marginTop: 12}}>
                                            <Text strong>Uploaded Custom Gene Sets:</Text>
                                            <div style={{marginTop: 8}}>
                                                {customGeneSets.map(geneSet => (
                                                    <Tag
                                                        key={geneSet._id}
                                                        closable
                                                        onClose={() => removeCustomGeneSet(geneSet._id)}
                                                        style={{marginBottom: 4}}
                                                    >
                                                        {geneSet.name} ({geneSet.genesets?.length || 0} sets)
                                                    </Tag>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Space>
                        </Card>

                        {/* Default Configuration for Ungrouped Analyses by Type */}
                        {Object.keys(ungroupedByType).length > 0 && globalOrganism && (
                            <div style={{marginBottom: 16}}>
                                <Title level={5}>Default Configuration for Ungrouped Analyses</Title>

                                {Object.entries(ungroupedByType).map(([inputType, analyses]) => (
                                    <Card key={inputType} style={{marginBottom: 16}}>
                                        <Title level={6}>
                                            <Tag color={getInputTypeColor(inputType)} style={{marginRight: 8}}>
                                                {inputType.toUpperCase()}
                                            </Tag>
                                            Analyses ({analyses.length})
                                        </Title>
                                        <Alert
                                            message={`${inputType.toUpperCase()} Configuration`}
                                            description={`Settings for: ${analyses.map(a => a.name).join(', ')}`}
                                            type="info"
                                            showIcon
                                            style={{marginBottom: 16}}
                                        />

                                        <DefaultConfigForm
                                            inputType={inputType}
                                            analyses={analyses}
                                            config={defaultConfig}
                                            onChange={setDefaultConfig}
                                            databases={allDatabases}
                                            globalOrganism={globalOrganism}
                                            showValidation={showValidation}
                                        />
                                    </Card>
                                ))}
                            </div>
                        )}

                        {/* Group Configuration */}
                        {activeGroups.length > 0 && globalOrganism && (
                            <div>
                                <Title level={5}>Group Configuration</Title>
                                <Collapse>
                                    {activeGroups.map(group => (
                                        <Collapse.Panel
                                            key={group.id}
                                            header={
                                                <Space>
                                                    <GroupOutlined/>
                                                    {group.name}
                                                    <Tag color={getInputTypeColor(group.inputType)}>
                                                        {group.inputType.toUpperCase()}
                                                    </Tag>
                                                    <Text type="secondary">({group.analyses.length} analyses)</Text>
                                                </Space>
                                            }
                                        >
                                            <GroupConfigForm
                                                group={group}
                                                config={groupConfigs[group.id]}
                                                onChange={(newConfig) =>
                                                    setGroupConfigs(prev => ({
                                                        ...prev,
                                                        [group.id]: newConfig
                                                    }))
                                                }
                                                databases={allDatabases}
                                                globalOrganism={globalOrganism}
                                                pvalAvailable={
                                                    group.inputType === 'pgsea' &&
                                                    group.analyses.length > 0 &&
                                                    group.analyses.every(name => {
                                                        const a = parsedAnalyses.find(pa => pa.name === name);
                                                        return (a?.data?.available || []).includes('pval');
                                                    })
                                                }
                                            />
                                        </Collapse.Panel>
                                    ))}
                                </Collapse>
                            </div>
                        )}

                        {!globalOrganism && (
                            <Alert
                                message="Organism Required"
                                description="Please select an organism in the Global Configuration section before configuring analysis settings."
                                type="warning"
                                showIcon
                            />
                        )}
                    </div>
                );

            case 3: // Fine-tune Individual (was step 4)
                const activeGroupsForTuning = Object.values(groups).filter(group => group.analyses.length > 0);
                const groupedAnalysisNamesForTuning = new Set();
                activeGroupsForTuning.forEach(group => {
                    group.analyses.forEach(name => groupedAnalysisNamesForTuning.add(name));
                });
                const ungroupedAnalysesForTuning = parsedAnalyses.filter(analysis =>
                    !analysis.error && !groupedAnalysisNamesForTuning.has(analysis.name)
                );

                // Group ungrouped analyses by input type
                const ungroupedByTypeForTuning = {};
                ungroupedAnalysesForTuning.forEach(analysis => {
                    if (!ungroupedByTypeForTuning[analysis.inputType]) {
                        ungroupedByTypeForTuning[analysis.inputType] = [];
                    }
                    ungroupedByTypeForTuning[analysis.inputType].push(analysis);
                });

                return (
                    <div>
                        <Title level={4}>Fine-tune Individual Analyses</Title>
                        <Alert
                            message="Optional Configuration Override"
                            description="This step is optional. You can override specific settings for individual analyses. If no overrides are set, the default configurations from the previous step will be used."
                            type="info"
                            showIcon
                            style={{marginBottom: 16}}
                        />

                        <Space direction="vertical" style={{width: '100%'}}>
                            {/* Ungrouped Analyses Section */}
                            {Object.keys(ungroupedByTypeForTuning).length > 0 && (
                                <div>
                                    <Title level={5}>Ungrouped Analyses</Title>

                                    {Object.entries(ungroupedByTypeForTuning).map(([inputType, analyses]) => {
                                        const typeConfig = defaultConfig.inputTypeConfigs?.[inputType];

                                        return (
                                            <Collapse key={inputType} style={{marginBottom: 16}}>
                                                <Collapse.Panel
                                                    header={
                                                        <Space>
                                                            <Tag color={getInputTypeColor(inputType)}>
                                                                {inputType.toUpperCase()}
                                                            </Tag>
                                                            <span>Analyses ({analyses.length})</span>
                                                            <Text type="secondary">
                                                                - {analyses.map(a => a.name).join(', ')}
                                                            </Text>
                                                        </Space>
                                                    }
                                                >
                                                    {/* Show Current Default Configuration */}
                                                    <Card size="small"
                                                          style={{marginBottom: 16, backgroundColor: '#f9f9f9'}}>
                                                        <Title level={6}>
                                                            <SettingOutlined style={{marginRight: 8}}/>
                                                            Current Default Configuration for {inputType.toUpperCase()}
                                                        </Title>
                                                        <Space direction="vertical" style={{width: '100%'}}>
                                                            <div>
                                                                <Text strong>Organism: </Text>
                                                                <Text>
                                                                    {organisms.find(org => org.taxId === globalOrganism)?.name || 'Not selected'}
                                                                </Text>
                                                            </div>
                                                            <div>
                                                                <Text strong>Databases: </Text>
                                                                <div style={{marginTop: 4}}>
                                                                    {typeConfig?.selectedDatasets?.length > 0 ? (
                                                                        typeConfig.selectedDatasets.map(dbId => {
                                                                            const db = allDatabases.find(d => d._id === dbId);
                                                                            return (
                                                                                <Tag key={dbId} size="small">
                                                                                    {db?.isCustom ?
                                                                                        `${db.name} (Custom)` :
                                                                                        (db?.namespace ? `${db.name} (${db.namespace})` : db?.name)
                                                                                    }
                                                                                </Tag>
                                                                            );
                                                                        })
                                                                    ) : (
                                                                        <Text type="secondary">No databases
                                                                            selected</Text>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <Text strong>Selected Methods: </Text>
                                                                <div style={{marginTop: 4}}>
                                                                    {typeConfig?.methodSettings ? (
                                                                        Object.entries(typeConfig.methodSettings)
                                                                            .filter(([method, config]) => config?.enabled)
                                                                            .map(([method]) => (
                                                                                <Tag key={method} size="small"
                                                                                     color="blue">
                                                                                    {method.toUpperCase()}
                                                                                </Tag>
                                                                            ))
                                                                    ) : (
                                                                        <Text type="secondary">No methods
                                                                            selected</Text>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </Space>
                                                    </Card>

                                                    {/* Individual Analysis Overrides */}
                                                    <Space direction="vertical" style={{width: '100%'}}>
                                                        <Text strong>Individual Analysis Overrides:</Text>
                                                        {analyses.map(analysis => (
                                                            <Card key={analysis.name} size="small"
                                                                  title={analysis.name}>
                                                                <IndividualAnalysisOverride
                                                                    analysisName={analysis.name}
                                                                    groupConfig={typeConfig} // Use default config as base
                                                                    inputType={analysis.inputType}
                                                                    override={individualOverrides[analysis.name] || {}}
                                                                    onChange={(newOverride) =>
                                                                        setIndividualOverrides(prev => ({
                                                                            ...prev,
                                                                            [analysis.name]: newOverride
                                                                        }))
                                                                    }
                                                                    databases={allDatabases}
                                                                    globalOrganism={globalOrganism}
                                                                    isUngrouped={true}
                                                                    pvalAvailable={analysis.inputType === 'pgsea' && (analysis.data?.available || []).includes('pval')}
                                                                />
                                                            </Card>
                                                        ))}
                                                    </Space>
                                                </Collapse.Panel>
                                            </Collapse>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Grouped Analyses Section */}
                            {activeGroupsForTuning.length > 0 && (
                                <div>
                                    <Title level={5}>Grouped Analyses</Title>

                                    <Collapse>
                                        {activeGroupsForTuning.map(group => {
                                            const groupConfig = groupConfigs[group.id];

                                            return (
                                                <Collapse.Panel
                                                    key={group.id}
                                                    header={
                                                        <Space>
                                                            <GroupOutlined/>
                                                            {group.name}
                                                            <Tag color={getInputTypeColor(group.inputType)}>
                                                                {group.inputType.toUpperCase()}
                                                            </Tag>
                                                            <Text
                                                                type="secondary">({group.analyses.length} analyses)</Text>
                                                        </Space>
                                                    }
                                                >
                                                    {/* Show Current Group Configuration */}
                                                    <Card size="small"
                                                          style={{marginBottom: 16, backgroundColor: '#f9f9f9'}}>
                                                        <Title level={6}>
                                                            <SettingOutlined style={{marginRight: 8}}/>
                                                            Current Group Configuration for {group.name}
                                                        </Title>
                                                        <Space direction="vertical" style={{width: '100%'}}>
                                                            <div>
                                                                <Text strong>Organism: </Text>
                                                                <Text>
                                                                    {organisms.find(org => org.taxId === globalOrganism)?.name || 'Not selected'}
                                                                </Text>
                                                            </div>
                                                            <div>
                                                                <Text strong>Databases: </Text>
                                                                <div style={{marginTop: 4}}>
                                                                    {groupConfig?.selectedDatasets?.length > 0 ? (
                                                                        groupConfig.selectedDatasets.map(dbId => {
                                                                            const db = allDatabases.find(d => d._id === dbId);
                                                                            return (
                                                                                <Tag key={dbId} size="small">
                                                                                    {db?.isCustom ?
                                                                                        `${db.name} (Custom)` :
                                                                                        (db?.namespace ? `${db.name} (${db.namespace})` : db?.name)
                                                                                    }
                                                                                </Tag>
                                                                            );
                                                                        })
                                                                    ) : (
                                                                        <Text type="secondary">No databases
                                                                            selected</Text>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <Text strong>Selected Methods: </Text>
                                                                <div style={{marginTop: 4}}>
                                                                    {groupConfig?.methodSettings ? (
                                                                        Object.entries(groupConfig.methodSettings)
                                                                            .filter(([method, config]) => config?.enabled)
                                                                            .map(([method]) => (
                                                                                <Tag key={method} size="small"
                                                                                     color="blue">
                                                                                    {method.toUpperCase()}
                                                                                </Tag>
                                                                            ))
                                                                    ) : (
                                                                        <Text type="secondary">No methods
                                                                            selected</Text>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </Space>
                                                    </Card>

                                                    {/* Individual Analysis Overrides */}
                                                    <Space direction="vertical" style={{width: '100%'}}>
                                                        <Text strong>Individual Analysis Overrides:</Text>
                                                        {group.analyses.map(analysisName => (
                                                            <Card key={analysisName} size="small" title={analysisName}>
                                                                <IndividualAnalysisOverride
                                                                    analysisName={analysisName}
                                                                    groupConfig={groupConfig}
                                                                    inputType={group.inputType}
                                                                    override={individualOverrides[analysisName] || {}}
                                                                    onChange={(newOverride) =>
                                                                        setIndividualOverrides(prev => ({
                                                                            ...prev,
                                                                            [analysisName]: newOverride
                                                                        }))
                                                                    }
                                                                    databases={allDatabases}
                                                                    globalOrganism={globalOrganism}
                                                                    isUngrouped={false}
                                                                    pvalAvailable={group.inputType === 'pgsea' && (parsedAnalyses.find(pa => pa.name === analysisName)?.data?.available || []).includes('pval')}
                                                                />
                                                            </Card>
                                                        ))}
                                                    </Space>
                                                </Collapse.Panel>
                                            );
                                        })}
                                    </Collapse>
                                </div>
                            )}

                            {/* No analyses available */}
                            {Object.keys(ungroupedByTypeForTuning).length === 0 && activeGroupsForTuning.length === 0 && (
                                <Card>
                                    <Empty
                                        description="No analyses available for fine-tuning"
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    />
                                </Card>
                            )}
                        </Space>
                    </div>
                );

            case 4: // Execute (was step 5)
                return (
                    <div>
                        <Title level={4}>Mass Analysis Progress</Title>

                        {!queueProgress && (
                            <div style={{ textAlign: 'center', padding: '40px' }}>
                                <Spin size="large" />
                                <div style={{ marginTop: 16 }}>
                                    <Text>Creating analyses and preparing queue...</Text>
                                </div>
                            </div>
                        )}

                        {queueProgress && (
                            <div>
                                <Progress
                                    percent={Math.round((queueProgress.completed / queueProgress.total) * 100)}
                                    status={queueProgress.status}
                                    format={() => `${queueProgress.completed}/${queueProgress.total}`}
                                />

                                <div style={{marginTop: 16}}>
                                    <Text strong>Status: </Text>
                                    <Tag color={getStatusColor(queueProgress.status)}>
                                        {queueProgress.status}
                                    </Tag>
                                </div>

                                {queueProgress.currentAnalysis && (
                                    <div style={{marginTop: 8}}>
                                        <Text>Currently processing: {queueProgress.currentAnalysis}</Text>
                                    </div>
                                )}

                                {progress.phase === 'uploading' && (
                                    <div style={{marginTop: 16}}>
                                        <Alert
                                            message="Uploading Files"
                                            description={`Uploading files for ${progress.currentFile || 'analysis'}... (${progress.current}/${progress.total})`}
                                            type="info"
                                        />
                                        <Progress
                                            percent={Math.round((progress.current / progress.total) * 100)}
                                            format={() => `${progress.current}/${progress.total} files`}
                                        />
                                    </div>
                                )}

                                {queueProgress.status === 'completed' && (
                                    <Alert
                                        message="Mass Analysis Completed"
                                        description="All analyses have been created and queued for execution."
                                        type="success"
                                        style={{marginTop: 16}}
                                    />
                                )}

                                {queueProgress.error && (
                                    <Alert
                                        message="Error"
                                        description={queueProgress.error}
                                        type="error"
                                        style={{marginTop: 16}}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    const getStatusColor = (status) => {
        const colors = {
            pending: 'default',
            running: 'processing',
            completed: 'success',
            error: 'error'
        };
        return colors[status] || 'default';
    };

    const handleNextClick = () => {
        if (currentStep === 2) { // Configure Settings step
            setShowValidation(true); // Enable validation display
            if (canProceed()) {
                setCurrentStep(prev => prev + 1);
            }
        } else {
            setCurrentStep(prev => prev + 1);
        }
    };

    const canProceed = () => {
        switch (currentStep) {
            case 0:
                return false;
            case 1:
                return parsedAnalyses.length > 0;
            case 2: // Configure Settings (was step 3)
                // Must have global organism selected
                if (!globalOrganism) return false;

                const activeGroups = Object.values(groups).filter(group => group.analyses.length > 0);
                const groupedAnalysisNames = new Set();
                activeGroups.forEach(group => {
                    group.analyses.forEach(name => groupedAnalysisNames.add(name));
                });
                const ungroupedAnalyses = parsedAnalyses.filter(analysis =>
                    !analysis.error && !groupedAnalysisNames.has(analysis.name)
                );

                // If there are groups, they need proper configuration
                if (activeGroups.length > 0) {
                    const groupsConfigured = activeGroups.every(group => {
                        const config = groupConfigs[group.id];
                        return config && config.selectedDatasets && config.selectedDatasets.length > 0;
                    });
                    if (!groupsConfigured) return false;
                }

                // If there are ungrouped analyses, check each input type has proper config
                if (ungroupedAnalyses.length > 0) {
                    // Group by input type to check each type has configuration
                    const ungroupedByType = {};
                    ungroupedAnalyses.forEach(analysis => {
                        if (!ungroupedByType[analysis.inputType]) {
                            ungroupedByType[analysis.inputType] = [];
                        }
                        ungroupedByType[analysis.inputType].push(analysis);
                    });

                    // Check each input type has datasets configured
                    for (const inputType of Object.keys(ungroupedByType)) {
                        const typeConfig = defaultConfig.inputTypeConfigs?.[inputType];
                        if (!typeConfig || !typeConfig.selectedDatasets || typeConfig.selectedDatasets.length === 0) {
                            return false;
                        }
                    }
                }

                return true;
            case 3: // Fine-tune Individual (was step 4)
                return true; // Individual overrides are optional
            case 4: // Execute (was step 5)
                return false;
            default:
                return false;
        }
    };

    // Footer buttons (shared between modal and page mode)
    const footerButtons = (
        <Space>
            {!isPageMode && (
                <Button key="cancel" onClick={() => {
                    handleReset();
                    onCancel();
                }}>
                    Cancel
                </Button>
            )}
            {currentStep > 0 && currentStep < 4 && (
                <Button
                    key="back"
                    onClick={() => {
                        setCurrentStep(prev => prev - 1);
                        // Reset validation when going back
                        if (currentStep === 3) setShowValidation(false);
                    }}
                >
                    Back
                </Button>
            )}
            {currentStep < 3 && (
                <Button
                    key="next"
                    type="primary"
                    disabled={!canProceed()}
                    onClick={handleNextClick}
                >
                    Next
                </Button>
            )}
            {currentStep === 3 && (
                <Button
                    key="create"
                    type="primary"
                    loading={isCreating}
                    disabled={!canProceed()}
                    onClick={handleCreateAnalyses}
                    icon={<PlayCircleOutlined/>}
                >
                    Create & Run Analyses
                </Button>
            )}
            {currentStep === 4 && queueProgress?.status === 'completed' && (
                isPageMode ? (
                    <>
                        <Button
                            key="studies"
                            onClick={onSuccess}
                        >
                            Back to Studies
                        </Button>
                        <Button
                            key="visualization"
                            type="primary"
                            onClick={onShowVisualization}
                        >
                            Show Visualization
                        </Button>
                    </>
                ) : (
                    <Button
                        key="finish"
                        type="primary"
                        onClick={onSuccess}
                    >
                        Finish
                    </Button>
                )
            )}
        </Space>
    );

    // Main content
    const mainContent = (
        <>
            <Steps current={currentStep} size="small" style={{marginBottom: 24}}>
                {steps.map(step => (
                    <Step key={step.title} title={step.title} description={step.description}/>
                ))}
            </Steps>

            {renderStepContent()}

            {isPageMode && (
                <div style={{ marginTop: 24, textAlign: 'right' }}>
                    {footerButtons}
                </div>
            )}

            <Modal
                title="Configure Custom Gene Set"
                open={gmtNameModal}
                onOk={handleGMTUpload}
                onCancel={cancelGMTUpload}
                confirmLoading={isUploadingGMT}
                okText="Upload"
                cancelText="Cancel"
                okButtonProps={{
                    disabled: !customGeneSetName.trim()
                }}
                width={600}
            >
                <Space direction="vertical" style={{width: '100%'}} size="middle">
                    {/* Format Detection Alert */}
                    {gmtFormatDetection && (
                        <Alert
                            message={gmtFormatDetection.isStandard
                                ? "✓ Standard GMT format detected"
                                : "⚠ Non-standard format detected"}
                            description={gmtFormatDetection.isStandard
                                ? "File uses standard GMT format (ID, Name, Genes...)"
                                : "Please configure column mapping below"}
                            type={gmtFormatDetection.isStandard ? "success" : "warning"}
                            showIcon
                        />
                    )}

                    {/* Column Configuration (shown only for non-standard) */}
                    {showGmtFormatConfig && (
                        <Card
                            title="Configure Column Mapping"
                            size="small"
                            style={{ backgroundColor: '#fafafa' }}
                        >
                            <Space direction="vertical" style={{ width: '100%' }} size="small">
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    Sample: {gmtFormatDetection?.analysis?.sampleData?.row1?.slice(0, 4).join(' | ')}...
                                </Text>

                                <Divider style={{ margin: '8px 0' }} />

                                <Space align="baseline">
                                    <Text strong>Pathway Name is in column:</Text>
                                    <Select
                                        value={gmtFormatConfig.pathwayNameColumn}
                                        onChange={(val) => setGmtFormatConfig({...gmtFormatConfig, pathwayNameColumn: val})}
                                        style={{ width: 100 }}
                                    >
                                        <Select.Option value={0}>Column 1</Select.Option>
                                        <Select.Option value={1}>Column 2</Select.Option>
                                        <Select.Option value={2}>Column 3</Select.Option>
                                    </Select>
                                </Space>

                                <Space align="baseline">
                                    <Text strong>Genes start from column:</Text>
                                    <Select
                                        value={gmtFormatConfig.genesStartColumn}
                                        onChange={(val) => setGmtFormatConfig({...gmtFormatConfig, genesStartColumn: val})}
                                        style={{ width: 100 }}
                                    >
                                        <Select.Option value={1}>Column 2</Select.Option>
                                        <Select.Option value={2}>Column 3</Select.Option>
                                        <Select.Option value={3}>Column 4</Select.Option>
                                    </Select>
                                </Space>

                                <Checkbox
                                    checked={gmtFormatConfig.pathwayIdColumn === 0}
                                    onChange={(e) => setGmtFormatConfig({
                                        ...gmtFormatConfig,
                                        pathwayIdColumn: e.target.checked ? 0 : null
                                    })}
                                >
                                    Use separate column 1 as pathway ID (optional)
                                </Checkbox>
                            </Space>
                        </Card>
                    )}

                    {/* Gene Set Name Input */}
                    <div>
                        <Text>Gene set name:</Text>
                        <Input
                            placeholder="Enter gene set name"
                            value={customGeneSetName}
                            onChange={(e) => setCustomGeneSetName(e.target.value)}
                            onPressEnter={() => {
                                if (customGeneSetName.trim()) {
                                    handleGMTUpload();
                                }
                            }}
                            maxLength={50}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    {/* File Info */}
                    {pendingGMTFile && (
                        <Text type="secondary" style={{fontSize: '12px'}}>
                            File: {pendingGMTFile.name}
                        </Text>
                    )}
                </Space>
            </Modal>
        </>
    );

    // Page mode: render content directly
    if (isPageMode) {
        return mainContent;
    }

    // Modal mode: wrap in Modal
    return (
        <Modal
            title="Create Mass Analysis"
            open={open}
            onCancel={() => {
                handleReset();
                onCancel();
            }}
            width={1400}
            bodyStyle={{
                maxHeight: 'calc(100vh - 200px)',
                overflowY: 'auto',
                overflowX: 'auto'
            }}
            footer={footerButtons}
        >
            {mainContent}
        </Modal>
    );
};

// Comprehensive Metadata Editor Modal Component
const MetadataEditorModal = ({ visible, onCancel, parsedAnalyses, onSave }) => {
    const [editedData, setEditedData] = useState({});
    const [newFieldName, setNewFieldName] = useState('');
    const [selectedDatasets, setSelectedDatasets] = useState([]);

    // Initialize edited data when modal opens
    useEffect(() => {
        if (visible) {
            const initialData = {};
            parsedAnalyses.forEach(analysis => {
                if (analysis.metadata?.extracted) {
                    initialData[analysis.name] = { ...analysis.metadata.extracted };
                }
            });
            setEditedData(initialData);
            setSelectedDatasets([]);
        }
    }, [visible, parsedAnalyses]);

    // Get all unique field names across all datasets
    const allFieldNames = useMemo(() => {
        const fields = new Set();
        Object.values(editedData).forEach(metadata => {
            Object.keys(metadata).forEach(field => fields.add(field));
        });
        return Array.from(fields).sort();
    }, [editedData]);

    // Handle field value change
    const handleFieldChange = (datasetName, fieldName, value) => {
        setEditedData(prev => ({
            ...prev,
            [datasetName]: {
                ...prev[datasetName],
                [fieldName]: value
            }
        }));
    };

    // Add new field to selected datasets
    const handleAddField = () => {
        if (!newFieldName.trim()) return;

        const targets = selectedDatasets.length > 0 ? selectedDatasets : Object.keys(editedData);

        setEditedData(prev => {
            const updated = { ...prev };
            targets.forEach(datasetName => {
                if (updated[datasetName]) {
                    updated[datasetName][newFieldName.trim()] = '';
                }
            });
            return updated;
        });

        setNewFieldName('');
        notification.success({
            message: 'Field Added',
            description: `Added "${newFieldName}" to ${targets.length} dataset(s)`
        });
    };

    // Delete field from selected datasets or all
    const handleDeleteField = (fieldName) => {
        const targets = selectedDatasets.length > 0 ? selectedDatasets : Object.keys(editedData);

        setEditedData(prev => {
            const updated = { ...prev };
            targets.forEach(datasetName => {
                if (updated[datasetName] && updated[datasetName][fieldName] !== undefined) {
                    delete updated[datasetName][fieldName];
                }
            });
            return updated;
        });

        notification.success({
            message: 'Field Deleted',
            description: `Removed "${fieldName}" from ${targets.length} dataset(s)`
        });
    };

    // Save changes
    const handleSave = () => {
        const updatedAnalyses = parsedAnalyses.map(analysis => {
            if (editedData[analysis.name]) {
                return {
                    ...analysis,
                    metadata: {
                        ...analysis.metadata,
                        extracted: editedData[analysis.name]
                    }
                };
            }
            return analysis;
        });

        onSave(updatedAnalyses);
    };

    // Build table data
    const tableData = Object.keys(editedData).map(datasetName => ({
        key: datasetName,
        dataset: datasetName,
        ...editedData[datasetName]
    }));

    // Build dynamic columns
    const columns = [
        {
            title: 'Dataset',
            dataIndex: 'dataset',
            key: 'dataset',
            fixed: 'left',
            width: 150,
            render: (text) => <Text strong>{text}</Text>
        },
        ...allFieldNames.map(fieldName => ({
            title: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{fieldName}</span>
                    <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteField(fieldName)}
                        title="Delete this field from all selected datasets"
                    />
                </div>
            ),
            dataIndex: fieldName,
            key: fieldName,
            width: 200,
            render: (value, record) => (
                <Input
                    size="small"
                    value={value || ''}
                    onChange={(e) => handleFieldChange(record.dataset, fieldName, e.target.value)}
                    placeholder={`Enter ${fieldName}`}
                />
            )
        }))
    ];

    return (
        <Modal
            title="Edit All Metadata"
            open={visible}
            onCancel={onCancel}
            onOk={handleSave}
            width="90%"
            style={{ top: 20 }}
            bodyStyle={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}
            okText="Save All Changes"
            cancelText="Cancel"
        >
            <Space direction="vertical" style={{ width: '100%' }} size="large">
                <Alert
                    message="Metadata Editor"
                    description="Edit metadata fields for all datasets. Select datasets to add/remove fields to specific datasets, or leave empty to affect all datasets."
                    type="info"
                    showIcon
                />

                {/* Add New Field Section */}
                <Card size="small" title="Add New Field">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Input
                                placeholder="Field name (e.g., Treatment, Dose, Time Point)"
                                value={newFieldName}
                                onChange={(e) => setNewFieldName(e.target.value)}
                                onPressEnter={handleAddField}
                                style={{ flex: 1 }}
                            />
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={handleAddField}
                                disabled={!newFieldName.trim()}
                            >
                                Add Field
                            </Button>
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {selectedDatasets.length > 0
                                ? `Will add to ${selectedDatasets.length} selected dataset(s)`
                                : `Will add to all ${Object.keys(editedData).length} datasets`}
                        </Text>
                    </Space>
                </Card>

                {/* Metadata Table */}
                <Table
                    dataSource={tableData}
                    columns={columns}
                    scroll={{ x: 'max-content', y: 500 }}
                    pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        showTotal: (total) => `Total ${total} datasets`
                    }}
                    rowSelection={{
                        selectedRowKeys: selectedDatasets,
                        onChange: (selectedRowKeys) => setSelectedDatasets(selectedRowKeys),
                    }}
                    size="small"
                    bordered
                />

                <Alert
                    message={`${allFieldNames.length} unique fields across ${Object.keys(editedData).length} datasets`}
                    type="success"
                    showIcon
                />
            </Space>
        </Modal>
    );
};

// Component for configuring default settings per input type (same as before)
const DefaultConfigForm = ({inputType, analyses, config, onChange, databases, globalOrganism, showValidation}) => {
    const typeConfig = config.inputTypeConfigs?.[inputType] || {
        selectedDatasets: [],
        methodSettings: {}
    };

    // P-value ranking is only offered when every PGSEA dataset of this type actually
    // exposes a P-value column (see imports/utils/pgseaInput.js `available`).
    const pvalAvailable = inputType === 'pgsea' &&
        (analyses || []).length > 0 &&
        (analyses || []).every(a => (a.data?.available || []).includes('pval'));

    const updateTypeConfig = (updates) => {
        const newConfig = {...config};
        if (!newConfig.inputTypeConfigs) {
            newConfig.inputTypeConfigs = {};
        }

        let currentTypeConfig = newConfig.inputTypeConfigs[inputType] || {
            selectedDatasets: [],
            methodSettings: {}
        };

        if (!currentTypeConfig.methodSettings || Object.keys(currentTypeConfig.methodSettings).length === 0) {
            const defaultMethodSettings = {};
            Object.entries(supportedMethods).forEach(([methodKey, method]) => {
                defaultMethodSettings[methodKey] = Object.entries(method.parameters).reduce((acc, [paramKey, param]) => {
                    acc[paramKey] = param.value;
                    return acc;
                }, {});
            });
            currentTypeConfig.methodSettings = defaultMethodSettings;
        }

        newConfig.inputTypeConfigs[inputType] = {
            ...currentTypeConfig,
            organism: globalOrganism,
            ...updates
        };
        onChange(newConfig);
    };

    const handleMethodSettingsChange = (methodKey, paramKey, value) => {
        const currentMethodSettings = typeConfig.methodSettings || {};
        const newMethodSettings = {...currentMethodSettings};

        if (!newMethodSettings[methodKey]) {
            // Initialize with defaults if method doesn't exist
            const method = supportedMethods[methodKey];
            newMethodSettings[methodKey] = Object.entries(method.parameters).reduce((acc, [paramName, param]) => {
                acc[paramName] = param.value;
                return acc;
            }, {});
        }

        newMethodSettings[methodKey] = {
            ...newMethodSettings[methodKey],
            [paramKey]: value
        };

        updateTypeConfig({methodSettings: newMethodSettings});
    };

    const supportedMethods = MethodSettings.getSupportedMethods(inputType);

    return (
        <Form layout="vertical">
            <Form.Item
                label="Pathway Databases"
                required
                validateStatus={showValidation && (!typeConfig.selectedDatasets || typeConfig.selectedDatasets.length === 0) ? 'error' : ''}
                help={showValidation && (!typeConfig.selectedDatasets || typeConfig.selectedDatasets.length === 0) ? 'Please select at least one database' : ''}
            >
                <Select
                    mode="multiple"
                    placeholder="Select databases"
                    value={typeConfig.selectedDatasets || []}
                    onChange={(value) => updateTypeConfig({selectedDatasets: value})}
                >
                    {databases.map(db => (
                        <Select.Option key={db._id} value={db._id}>
                            {db.isCustom ?
                                `${db.name} (Custom - ${db.genesets?.length || 0} sets)` :
                                (db.namespace ? `${db.name} (${db.namespace})` : db.name)
                            }
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>

            {inputType === 'pgsea' && (
                <Form.Item label="Calculate gene rankings by">
                    <Radio.Group
                        value={typeConfig.rankingBy || 'fc'}
                        onChange={(e) => updateTypeConfig({rankingBy: e.target.value})}
                    >
                        {RANKING_OPTIONS.map(opt => (
                            <Radio key={opt.value} value={opt.value} disabled={opt.value === 'pval' && !pvalAvailable}>
                                {opt.label}
                            </Radio>
                        ))}
                    </Radio.Group>
                    {!pvalAvailable && (
                        <Text type="secondary" style={{display: 'block', fontSize: 12}}>
                            P-value ranking needs a P-value column in every dataset of this type.
                        </Text>
                    )}
                </Form.Item>
            )}

            <Divider>Statistical Methods</Divider>

            {Object.entries(supportedMethods).map(([methodKey, method]) => (
                <Card key={methodKey} size="small" style={{marginBottom: 8}}>
                    <Space direction="vertical" style={{width: '100%'}}>
                        <div>
                            <Checkbox
                                checked={typeConfig.methodSettings?.[methodKey]?.enabled || false}
                                onChange={(e) => {
                                    handleMethodSettingsChange(methodKey, 'enabled', e.target.checked);
                                }}
                            >
                                <Text strong>{method.name}</Text>
                            </Checkbox>
                        </div>

                        {typeConfig.methodSettings?.[methodKey]?.enabled && (
                            <div style={{paddingLeft: 24}}>
                                {Object.entries(method.parameters).map(([paramKey, param]) => {
                                    if (!param.visible || paramKey === 'enabled') return null;

                                    const currentValue = typeConfig.methodSettings?.[methodKey]?.[paramKey] ?? param.value;

                                    return (
                                        <div key={paramKey} style={{marginBottom: 8}}>
                                            <Text>{param.name}: </Text>
                                            {param.type === Number ? (
                                                <InputNumber
                                                    size="small"
                                                    min={param.min}
                                                    max={param.max}
                                                    value={currentValue}
                                                    onChange={(value) => {
                                                        handleMethodSettingsChange(methodKey, paramKey, value);
                                                    }}
                                                />
                                            ) : param.options ? (
                                                <Select
                                                    size="small"
                                                    style={{width: 120}}
                                                    value={currentValue}
                                                    onChange={(value) => {
                                                        handleMethodSettingsChange(methodKey, paramKey, value);
                                                    }}
                                                >
                                                    {param.options.map(option => (
                                                        <Select.Option key={option} value={option}>
                                                            {param.optionLabels?.[option] ?? option}
                                                        </Select.Option>
                                                    ))}
                                                </Select>
                                            ) : (
                                                <Checkbox
                                                    checked={currentValue || false}
                                                    onChange={(e) => {
                                                        handleMethodSettingsChange(methodKey, paramKey, e.target.checked);
                                                    }}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Space>
                </Card>
            ))}
        </Form>
    );
};

// UngroupedAnalysesManager component
const UngroupedAnalysesManager = ({parsedAnalyses, groups, onAssignToGroup}) => {
    const [selectedAnalyses, setSelectedAnalyses] = useState([]);
    const [targetGroupId, setTargetGroupId] = useState('');

    // Get analyses that are not in any group
    const groupedAnalysisNames = new Set();
    Object.values(groups).forEach(group => {
        group.analyses.forEach(name => groupedAnalysisNames.add(name));
    });

    const ungroupedAnalyses = parsedAnalyses.filter(analysis =>
        !analysis.error && !groupedAnalysisNames.has(analysis.name)
    );

    const assignSelectedAnalyses = () => {
        if (!targetGroupId || selectedAnalyses.length === 0) return;

        selectedAnalyses.forEach(analysisName => {
            onAssignToGroup(analysisName, targetGroupId);
        });

        setSelectedAnalyses([]);
        setTargetGroupId('');
    };

    const availableGroups = Object.values(groups);

    if (ungroupedAnalyses.length === 0) {
        return (
            <div style={{textAlign: 'center', padding: '20px', color: '#666'}}>
                <Text type="secondary">All analyses have been assigned to groups</Text>
            </div>
        );
    }

    return (
        <Space direction="vertical" style={{width: '100%'}}>
            <div>
                <Text strong>Available analyses ({ungroupedAnalyses.length}):</Text>
                <div style={{marginTop: 8}}>
                    <Checkbox.Group
                        value={selectedAnalyses}
                        onChange={setSelectedAnalyses}
                    >
                        <Space direction="vertical">
                            {ungroupedAnalyses.map(analysis => (
                                <Checkbox key={analysis.name} value={analysis.name}>
                                    <Space>
                                        {analysis.name}
                                        <Tag size="small" color={getInputTypeColor(analysis.inputType)}>
                                            {analysis.inputType.toUpperCase()}
                                        </Tag>
                                    </Space>
                                </Checkbox>
                            ))}
                        </Space>
                    </Checkbox.Group>
                </div>
            </div>

            {selectedAnalyses.length > 0 && availableGroups.length > 0 && (
                <div>
                    <Space>
                        <Text>Assign selected to:</Text>
                        <Select
                            style={{width: 200}}
                            placeholder="Select group"
                            value={targetGroupId}
                            onChange={setTargetGroupId}
                        >
                            {availableGroups.map(g => (
                                <Select.Option key={g.id} value={g.id}>
                                    {g.name}
                                    {g.inputType && (
                                        <Tag size="small" color={getInputTypeColor(g.inputType)}
                                             style={{marginLeft: 8}}>
                                            {g.inputType.toUpperCase()}
                                        </Tag>
                                    )}
                                </Select.Option>
                            ))}
                        </Select>
                        <Button
                            type="primary"
                            size="small"
                            disabled={!targetGroupId}
                            onClick={assignSelectedAnalyses}
                        >
                            Assign
                        </Button>
                    </Space>
                </div>
            )}

            {availableGroups.length === 0 && (
                <Alert
                    message="No groups available"
                    description="Create a group first, then you can assign analyses to it."
                    type="info"
                    showIcon
                />
            )}
        </Space>
    );
};

// GroupAnalysisManager component
const GroupAnalysisManager = ({group, allGroups, parsedAnalyses, onMoveAnalysis, onRemoveFromGroup}) => {
    const [targetGroupId, setTargetGroupId] = useState('');
    const [selectedAnalyses, setSelectedAnalyses] = useState([]);

    const moveSelectedAnalyses = () => {
        if (!targetGroupId || selectedAnalyses.length === 0) return;

        selectedAnalyses.forEach(analysisName => {
            onMoveAnalysis(analysisName, group.id, targetGroupId);
        });

        setSelectedAnalyses([]);
        setTargetGroupId('');
    };

    const removeSelectedAnalyses = () => {
        selectedAnalyses.forEach(analysisName => {
            onRemoveFromGroup(analysisName);
        });
        setSelectedAnalyses([]);
    };

    const availableGroups = Object.values(allGroups).filter(g =>
        g.id !== group.id &&
        (!g.inputType || g.inputType === group.inputType)
    );

    if (group.analyses.length === 0) {
        return (
            <div style={{textAlign: 'center', padding: '20px', color: '#666'}}>
                <Text type="secondary">No analyses in this group. Assign analyses from "Ungrouped Analyses" section
                    above.</Text>
            </div>
        );
    }

    return (
        <Space direction="vertical" style={{width: '100%'}}>
            <div>
                <Text strong>Analyses in this group:</Text>
                <div style={{marginTop: 8}}>
                    <Checkbox.Group
                        value={selectedAnalyses}
                        onChange={setSelectedAnalyses}
                    >
                        <Space direction="vertical">
                            {group.analyses.map(analysisName => (
                                <Checkbox key={analysisName} value={analysisName}>
                                    {analysisName}
                                </Checkbox>
                            ))}
                        </Space>
                    </Checkbox.Group>
                </div>
            </div>

            {selectedAnalyses.length > 0 && (
                <div>
                    <Space wrap>
                        <Button
                            size="small"
                            onClick={removeSelectedAnalyses}
                        >
                            Remove from Group
                        </Button>

                        {availableGroups.length > 0 && (
                            <>
                                <Select
                                    style={{width: 200}}
                                    placeholder="Move to another group"
                                    value={targetGroupId}
                                    onChange={setTargetGroupId}
                                >
                                    {availableGroups.map(g => (
                                        <Select.Option key={g.id} value={g.id}>
                                            {g.name}
                                        </Select.Option>
                                    ))}
                                </Select>
                                <Button
                                    type="primary"
                                    size="small"
                                    disabled={!targetGroupId}
                                    onClick={moveSelectedAnalyses}
                                >
                                    Move
                                </Button>
                            </>
                        )}
                    </Space>
                </div>
            )}
        </Space>
    );
};

const GroupConfigForm = ({group, config, onChange, databases, globalOrganism, pvalAvailable = false}) => {
    const [form] = Form.useForm();

    const supportedMethods = MethodSettings.getSupportedMethods(group.inputType);

    useEffect(() => {
        // Ensure config has proper method settings
        let configWithDefaults = {...config};

        if (!configWithDefaults.methodSettings || Object.keys(configWithDefaults.methodSettings).length === 0) {
            const defaultMethodSettings = {};
            Object.entries(supportedMethods).forEach(([methodKey, method]) => {
                defaultMethodSettings[methodKey] = Object.entries(method.parameters).reduce((acc, [paramKey, param]) => {
                    acc[paramKey] = param.value;
                    return acc;
                }, {});
            });
            configWithDefaults.methodSettings = defaultMethodSettings;
        }

        const configWithOrganism = {
            ...configWithDefaults,
            organism: globalOrganism,
            rankingBy: configWithDefaults.rankingBy || 'fc'
        };

        form.setFieldsValue(configWithOrganism);

        // Update parent with defaults if needed
        if (!config.methodSettings || Object.keys(config.methodSettings).length === 0) {
            onChange(configWithOrganism);
        }
    }, [config, form, globalOrganism, supportedMethods]);

    const handleFormChange = (changedFields, allFields) => {
        const newConfig = {...config};
        changedFields.forEach(field => {
            const [fieldName] = field.name;
            newConfig[fieldName] = field.value;
        });
        newConfig.organism = globalOrganism;
        onChange(newConfig);
    };

    const handleMethodSettingsChange = (methodKey, paramKey, value) => {
        const newConfig = {...config};
        if (!newConfig.methodSettings) newConfig.methodSettings = {};
        if (!newConfig.methodSettings[methodKey]) {
            // Initialize with defaults if method doesn't exist
            const method = supportedMethods[methodKey];
            newConfig.methodSettings[methodKey] = Object.entries(method.parameters).reduce((acc, [paramName, param]) => {
                acc[paramName] = param.value;
                return acc;
            }, {});
        }
        newConfig.methodSettings[methodKey][paramKey] = value;
        newConfig.organism = globalOrganism;
        onChange(newConfig);
    };

    return (
        <Form
            form={form}
            layout="vertical"
            onFieldsChange={handleFormChange}
            initialValues={{...config, organism: globalOrganism, rankingBy: config.rankingBy || 'fc'}}
        >
            <Alert
                message={`Configuration for ${group.name}`}
                description={`This configuration will apply to: ${group.analyses.join(', ')}`}
                type="info"
                showIcon
                style={{marginBottom: 16}}
            />

            {group.inputType === 'pgsea' && (
                <Form.Item label="Calculate gene rankings by" name="rankingBy">
                    <Radio.Group>
                        {RANKING_OPTIONS.map(opt => (
                            <Radio key={opt.value} value={opt.value} disabled={opt.value === 'pval' && !pvalAvailable}>
                                {opt.label}
                            </Radio>
                        ))}
                    </Radio.Group>
                </Form.Item>
            )}

            <Form.Item
                label="Pathway Databases"
                name="selectedDatasets"
                rules={[{required: true, message: 'Please select at least one database'}]}
            >
                <Select mode="multiple" placeholder="Select databases">
                    {databases.map(db => (
                        <Select.Option key={db._id} value={db._id}>
                            {db.isCustom ?
                                `${db.name} (Custom - ${db.genesets?.length || 0} sets)` :
                                (db.namespace ? `${db.name} (${db.namespace})` : db.name)
                            }
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>

            <Divider>Statistical Methods</Divider>

            {Object.entries(supportedMethods).map(([methodKey, method]) => (
                <Card key={methodKey} size="small" style={{marginBottom: 8}}>
                    <Space direction="vertical" style={{width: '100%'}}>
                        <div>
                            <Checkbox
                                checked={config.methodSettings?.[methodKey]?.enabled || false}
                                onChange={(e) => {
                                    handleMethodSettingsChange(methodKey, 'enabled', e.target.checked);
                                }}
                            >
                                <Text strong>{method.name}</Text>
                            </Checkbox>
                        </div>

                        {config.methodSettings?.[methodKey]?.enabled && (
                            <div style={{paddingLeft: 24}}>
                                {Object.entries(method.parameters).map(([paramKey, param]) => {
                                    if (!param.visible || paramKey === 'enabled') return null;

                                    const currentValue = config.methodSettings?.[methodKey]?.[paramKey] ?? param.value;

                                    return (
                                        <div key={paramKey} style={{marginBottom: 8}}>
                                            <Text>{param.name}: </Text>
                                            {param.type === Number ? (
                                                <InputNumber
                                                    size="small"
                                                    min={param.min}
                                                    max={param.max}
                                                    value={currentValue}
                                                    onChange={(value) => {
                                                        handleMethodSettingsChange(methodKey, paramKey, value);
                                                    }}
                                                />
                                            ) : param.options ? (
                                                <Select
                                                    size="small"
                                                    style={{width: 120}}
                                                    value={currentValue}
                                                    onChange={(value) => {
                                                        handleMethodSettingsChange(methodKey, paramKey, value);
                                                    }}
                                                >
                                                    {param.options.map(option => (
                                                        <Select.Option key={option} value={option}>
                                                            {param.optionLabels?.[option] ?? option}
                                                        </Select.Option>
                                                    ))}
                                                </Select>
                                            ) : (
                                                <Checkbox
                                                    checked={currentValue || false}
                                                    onChange={(e) => {
                                                        handleMethodSettingsChange(methodKey, paramKey, e.target.checked);
                                                    }}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Space>
                </Card>
            ))}
        </Form>
    );
};

const IndividualAnalysisOverride = ({
                                        analysisName,
                                        groupConfig,
                                        inputType,
                                        override,
                                        onChange,
                                        databases,
                                        globalOrganism,
                                        isUngrouped = false,
                                        pvalAvailable = false
                                    }) => {
    const [showOverride, setShowOverride] = useState(Object.keys(override).length > 0);

    // Get supported methods for this input type
    const supportedMethods = MethodSettings.getSupportedMethods(inputType);

    // Handle method settings change with consensus logic
    const handleMethodSettingsChange = (newMethodSettings) => {
        // Count enabled methods (excluding consensus)
        const enabledMethods = Object.entries(newMethodSettings)
            .filter(([method, config]) => method !== 'consensus' && config?.enabled);

        // Auto-enable/disable consensus based on method count
        if (enabledMethods.length > 1) {
            newMethodSettings.consensus = {
                ...newMethodSettings.consensus,
                enabled: true,
                methods: enabledMethods.map(([method]) => method)
            };
        } else {
            newMethodSettings.consensus = {
                ...newMethodSettings.consensus,
                enabled: false,
                methods: []
            };
        }

        onChange({
            ...override,
            methodSettings: newMethodSettings
        });
    };

    if (!showOverride) {
        return (
            <div>
                <Text type="secondary">
                    Using {isUngrouped ? 'default' : 'group'} configuration
                </Text>
                <Button
                    type="link"
                    size="small"
                    onClick={() => setShowOverride(true)}
                >
                    Add overrides
                </Button>
            </div>
        );
    }

    return (
        <Space direction="vertical" style={{width: '100%'}}>
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
                <Text strong>Individual Overrides</Text>
                <Button
                    size="small"
                    onClick={() => {
                        setShowOverride(false);
                        onChange({});
                    }}
                >
                    Clear overrides
                </Button>
            </div>

            <Space direction="vertical" style={{width: '100%'}}>
                {/* Database Selection */}
                <div>
                    <Text strong>Databases: </Text>
                    <Select
                        mode="multiple"
                        style={{width: '100%', marginTop: 4}}
                        placeholder={`Default: ${isUngrouped ? 'Default' : 'Group'} databases`}
                        value={override.selectedDatasets}
                        onChange={(value) => onChange({...override, selectedDatasets: value})}
                        allowClear
                    >
                        {databases.map(db => (
                            <Select.Option key={db._id} value={db._id}>
                                {db.isCustom ?
                                    `${db.name} (Custom - ${db.genesets?.length || 0} sets)` :
                                    (db.namespace ? `${db.name} (${db.namespace})` : db.name)
                                }
                            </Select.Option>
                        ))}
                    </Select>
                </div>

                {/* Gene-ranking override (PGSEA only). "Inherit" = use group/default ranking. */}
                {inputType === 'pgsea' && (
                    <div>
                        <Text strong>Calculate gene rankings by: </Text>
                        <Radio.Group
                            style={{marginTop: 4}}
                            value={override.rankingBy || 'inherit'}
                            onChange={(e) => {
                                const value = e.target.value;
                                const {rankingBy, ...rest} = override;
                                onChange(value === 'inherit' ? rest : {...override, rankingBy: value});
                            }}
                        >
                            <Radio value="inherit">Inherit</Radio>
                            {RANKING_OPTIONS.map(opt => (
                                <Radio key={opt.value} value={opt.value}
                                       disabled={opt.value === 'pval' && !pvalAvailable}>
                                    {opt.label}
                                </Radio>
                            ))}
                        </Radio.Group>
                    </div>
                )}

                <Divider style={{margin: '12px 0'}}/>

                {/* Statistical Methods Selection */}
                <div>
                    <Text strong>Statistical Methods: </Text>
                    <Text type="secondary" style={{fontSize: '12px', display: 'block', marginBottom: 8}}>
                        Select methods to override. Consensus is auto-enabled when 2+ methods are selected.
                    </Text>

                    <Space direction="vertical" style={{width: '100%'}}>
                        {Object.entries(supportedMethods).map(([methodKey, method]) => {
                            if (methodKey === 'consensus') return null; // Skip consensus, it's handled automatically

                            const currentMethodSettings = override.methodSettings || {};
                            const baseMethodSettings = groupConfig?.methodSettings || {};

                            // Use override if exists, otherwise use base config
                            const methodConfig = currentMethodSettings[methodKey] || baseMethodSettings[methodKey] || method.parameters;

                            return (
                                <div key={methodKey} style={{
                                    border: '1px solid #d9d9d9',
                                    borderRadius: '4px',
                                    padding: '12px',
                                    backgroundColor: methodConfig?.enabled ? '#f6ffed' : '#fafafa'
                                }}>
                                    <Checkbox
                                        checked={methodConfig?.enabled || false}
                                        onChange={(e) => {
                                            const newMethodSettings = {
                                                ...currentMethodSettings,
                                                [methodKey]: {
                                                    ...methodConfig,
                                                    enabled: e.target.checked
                                                }
                                            };
                                            handleMethodSettingsChange(newMethodSettings);
                                        }}
                                    >
                                        <Text strong>{method.name}</Text>
                                    </Checkbox>
                                </div>
                            );
                        })}

                        {/* Show consensus method status */}
                        {inputType !== 'ora' && (
                            <div style={{
                                border: '2px solid #1890ff',
                                borderRadius: '4px',
                                padding: '12px',
                                backgroundColor: '#f0f8ff'
                            }}>
                                <div style={{display: 'flex', alignItems: 'center', marginBottom: 4}}>
                                    <Text strong>Consensus Method</Text>
                                    <Tag
                                        size="small"
                                        color={(() => {
                                            const currentMethodSettings = override.methodSettings || {};
                                            const enabledCount = Object.entries(currentMethodSettings)
                                                .filter(([method, config]) => method !== 'consensus' && config?.enabled).length;
                                            return enabledCount > 1 ? 'green' : 'default';
                                        })()}
                                        style={{marginLeft: 8}}
                                    >
                                        {(() => {
                                            const currentMethodSettings = override.methodSettings || {};
                                            const enabledCount = Object.entries(currentMethodSettings)
                                                .filter(([method, config]) => method !== 'consensus' && config?.enabled).length;
                                            return enabledCount > 1 ? 'Auto-enabled' : 'Disabled';
                                        })()}
                                    </Tag>
                                </div>
                                <Text type="secondary" style={{fontSize: '12px'}}>
                                    Automatically enabled when 2 or more statistical methods are selected
                                </Text>
                            </div>
                        )}
                    </Space>
                </div>
            </Space>
        </Space>
    );
};

export default MassAnalysisModal;
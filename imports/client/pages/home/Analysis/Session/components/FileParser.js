import Papa from 'papaparse';
import { Meteor } from 'meteor/meteor';
import { normalizePgseaInput } from '/imports/utils/pgseaInput';

class FileParser {
    static async parseFolder(fileList, useLLMDetection = false, progressCallback = null) {
        const folderMap = new Map();
        let groupFileContent = null;
        let groupFileName = null;

        fileList.forEach(fileWrapper => {
            const originalFile = fileWrapper.originFileObj;

            if (!originalFile) {
                console.warn('File object missing originFileObj:', fileWrapper);
                return;
            }

            if (this.isSystemFile(originalFile.name)) {
                console.log(`Skipping system file: ${originalFile.name}`);
                return;
            }

            const relativePath = originalFile.webkitRelativePath;

            if (typeof relativePath !== 'string' || relativePath.trim() === "") {
                console.warn(`File object '${originalFile.name}' missing webkitRelativePath or path is empty. Skipping.`);
                return;
            }

            const pathParts = relativePath.split('/');

            // Check if this is a group file at the root level
            if (pathParts.length === 2 && this.isGroupFile(originalFile.name)) {
                groupFileName = originalFile.name;
                groupFileContent = originalFile;
                return;
            }

            if (pathParts.length < 2) {
                console.warn(`Skipping file at root or invalid path: ${relativePath}`);
                return;
            }

            const folderNameKey = pathParts[pathParts.length - 2];
            const fileNameInFolder = pathParts[pathParts.length - 1];

            // Preserve the full path for better folder matching
            const fullPath = pathParts.slice(0, -1).join('/');
            const analysisKey = fullPath;

            if (!folderMap.has(analysisKey)) {
                folderMap.set(analysisKey, {
                    displayName: folderNameKey,
                    files: [],
                    // Store additional path information for folder-based grouping
                    fullPath: fullPath,
                    parentPath: pathParts.slice(0, -2).join('/')
                });
            }

            folderMap.get(analysisKey).files.push({
                name: fileNameInFolder,
                file: originalFile,
                path: relativePath,
                // Store normalized path for easier matching
                normalizedPath: relativePath.replace(/\/+/g, '/')
            });
        });

        const analyses = [];

        console.log(`📊 Total folders detected in folderMap: ${folderMap.size}`);
        console.log(`📂 Folder names:`, Array.from(folderMap.keys()));

        // If LLM detection is enabled, prepare folder data and call LLM service
        if (useLLMDetection) {
            try {
                console.log('🔍 Using LLM detection for mass analysis...');

                // Prepare folder data for LLM detection
                const foldersData = [];
                for (const [analysisKey, folderData] of folderMap.entries()) {
                    const folderFiles = [];

                    for (const fileWrapper of folderData.files) {
                        try {
                            const content = await this.readFileContent(fileWrapper.file);
                            folderFiles.push({
                                name: fileWrapper.name,
                                content: content
                            });
                        } catch (error) {
                            console.error(`Error reading file ${fileWrapper.name}:`, error);
                        }
                    }

                    if (folderFiles.length > 0) {
                        foldersData.push({
                            name: folderData.displayName,
                            files: folderFiles
                        });

                        // Initialize folder as pending
                        if (progressCallback) {
                            progressCallback(folderData.displayName, 'pending');
                        }
                    }
                }

                // Update progress total
                if (progressCallback) {
                    progressCallback(null, 'init', { total: foldersData.length });
                }

                console.log(`🎯 Prepared ${foldersData.length} folders for LLM detection:`, foldersData.map(f => f.name));

                // Call LLM detection service with progress updates
                const detectionResults = await this.callLLMDetectionWithProgress(foldersData, progressCallback);

                // STEP 1: Extract metadata from metadata-only folders
                const externalMetadataMap = new Map();

                // First pass: Process metadata-only folders
                for (const result of detectionResults) {
                    if (result.detectedType === 'metadata-only') {
                        console.log(`📋 Found metadata-only folder: ${result.folderName} with ${result.files?.length || 0} files`);

                        // Get the actual file objects from folderMap to extract metadata from each file
                        const metadataFolderData = Array.from(folderMap.values()).find(
                            fd => fd.displayName === result.folderName
                        );

                        if (metadataFolderData) {
                            console.log(`  🔍 Processing ${metadataFolderData.files.length} individual metadata files...`);

                            // Process each metadata file separately
                            for (const fileObj of metadataFolderData.files) {
                                try {
                                    console.log(`    📄 Processing file: ${fileObj.name}`);

                                    // Read file content - fileObj has structure {name, file, path, normalizedPath}
                                    const content = await this.readFileContent(fileObj.file);
                                    console.log(`    📖 Read ${content.length} characters from ${fileObj.name}`);

                                    const fileName = fileObj.name;

                                    // Use LLM to detect if this is a combined file and split it by dataset
                                    const splitResult = await this.splitCombinedMetadataFile(content, fileName);

                                    if (splitResult.isCombined && splitResult.datasets.length > 1) {
                                        console.log(`    📦 LLM detected combined metadata file with ${splitResult.datasets.length} datasets in ${fileName}`);

                                        for (const dataset of splitResult.datasets) {
                                            console.log(`    🔑 Processing section for: "${dataset.id}"`);

                                            // Extract metadata from this section
                                            const extractedFields = this.extractMetadataFromText(dataset.content);
                                            console.log(`    📊 Extracted ${Object.keys(extractedFields).length} fields for ${dataset.id}:`, Object.keys(extractedFields));

                                            // Add dataset ID to extracted fields
                                            if (!extractedFields.datasetId) {
                                                extractedFields.datasetId = dataset.id;
                                            }

                                            const metadataEntry = {
                                                raw: dataset.content,
                                                source: `${fileName} (${dataset.id})`,
                                                format: 'text',
                                                extracted: extractedFields,
                                                confidence: 'high',
                                                fromFolder: result.folderName
                                            };

                                            externalMetadataMap.set(dataset.id, metadataEntry);
                                            console.log(`    ✅ Mapped "${dataset.id}" from combined file (${Object.keys(extractedFields).length} fields)`);
                                        }
                                    } else {
                                        // Single dataset file - original logic
                                        const fileNameWithoutExt = fileName.replace(/\.(txt|md|json)$/i, '');
                                        const match = fileNameWithoutExt.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)/i);

                                        if (match) {
                                            const datasetId = match[1];
                                            console.log(`    🔑 Extracted dataset ID: "${datasetId}" from filename: "${fileName}"`);

                                            // Try to extract metadata fields from content using simple patterns
                                            const extractedFields = this.extractMetadataFromText(content);
                                            console.log(`    📊 Extracted ${Object.keys(extractedFields).length} fields:`, Object.keys(extractedFields));

                                            // Add dataset ID to extracted fields
                                            if (!extractedFields.datasetId) {
                                                extractedFields.datasetId = datasetId;
                                            }

                                            const metadataEntry = {
                                                raw: content,
                                                source: fileName,
                                                format: 'text',
                                                extracted: extractedFields,
                                                confidence: 'medium',
                                                fromFolder: result.folderName
                                            };

                                            externalMetadataMap.set(datasetId, metadataEntry);
                                            console.log(`    ✅ Mapped "${datasetId}" → ${fileName} (${Object.keys(extractedFields).length} fields)`);
                                        } else {
                                            console.log(`    ⚠️  Could not extract dataset ID from filename: ${fileName}`);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`    ❌ Error processing metadata file ${fileObj.name}:`, error);
                                }
                            }
                        } else {
                            // Fallback: use LLM-extracted metadata if available
                            if (result.metadata?.found) {
                                const datasetId = result.metadata.extractedFields?.datasetId ||
                                                result.metadata.extractedFields?.dataset ||
                                                result.metadata.extractedFields?.id;

                                const metadataEntry = {
                                    raw: result.metadata.rawText,
                                    source: result.metadata.sourceFile,
                                    format: result.metadata.format,
                                    extracted: result.metadata.extractedFields,
                                    confidence: result.metadata.confidence,
                                    fromFolder: result.folderName
                                };

                                if (datasetId) {
                                    console.log(`  ✓ Using LLM-extracted metadata for dataset: ${datasetId}`);
                                    externalMetadataMap.set(datasetId, metadataEntry);
                                }
                            }
                        }
                    }
                }

                console.log(`📚 Built external metadata map with ${externalMetadataMap.size} entries:`);
                console.log(`   Keys:`, Array.from(externalMetadataMap.keys()));
                externalMetadataMap.forEach((value, key) => {
                    console.log(`   "${key}" → ${Object.keys(value.extracted || {}).length} fields from ${value.source}`);
                });

                // STEP 1.5: Deduplicate metadata fields using LLM
                if (externalMetadataMap.size > 0) {
                    console.log(`🔍 Deduplicating metadata fields across all datasets...`);
                    await this.deduplicateMetadataFields(externalMetadataMap);

                    console.log(`🔍 Identifying common metadata fields across all datasets...`);
                    const commonFieldsAnalysis = await this.identifyCommonMetadataFields(externalMetadataMap);

                    // Store analysis for later use (will be accessed in UI)
                    if (commonFieldsAnalysis) {
                        window.__metadataStandardization = commonFieldsAnalysis;
                        console.log(`✅ Found ${commonFieldsAnalysis.commonFields.length} common fields across datasets`);
                    }
                }

                // STEP 2: Parse each folder based on LLM detection results
                for (const [analysisKey, folderData] of folderMap.entries()) {
                    try {
                        const detectionResult = detectionResults.find(r => r.folderName === folderData.displayName);

                        console.log(`Parsing folder: ${folderData.displayName} (detected: ${detectionResult?.detectedType || 'unknown'})`);

                        // SKIP folders classified as "metadata-only" by LLM
                        if (detectionResult?.detectedType === 'metadata-only') {
                            console.log(`⏭️  Skipping metadata-only folder: ${folderData.displayName}`);
                            continue;
                        }

                        const analysis = await this.parseAnalysisFolder(
                            folderData.displayName,
                            folderData.files,
                            detectionResult
                        );

                        // Add path information and detection metadata
                        analysis.originalPath = folderData.fullPath;
                        analysis.parentPath = folderData.parentPath;
                        analysis.llmDetection = detectionResult;

                        // STEP 3: Try to match external metadata from metadata-only folders using LLM
                        if (externalMetadataMap.size > 0) {
                            console.log(`  🔍 Attempting to match metadata for: ${folderData.displayName}`);
                            console.log(`  📚 Available metadata keys:`, Array.from(externalMetadataMap.keys()));

                            const matchedMetadata = await this.matchMetadataWithLLM(
                                folderData.displayName,
                                Array.from(externalMetadataMap.keys()),
                                externalMetadataMap
                            );

                            // If external metadata found, merge it with existing metadata
                            if (matchedMetadata) {
                                if (!analysis.metadata) {
                                    analysis.metadata = matchedMetadata;
                                    console.log(`  ✅ Applied external metadata to ${folderData.displayName}`);
                                } else {
                                    // Merge: external metadata takes precedence if more complete
                                    const externalFieldCount = Object.keys(matchedMetadata.extracted || {}).length;
                                    const internalFieldCount = Object.keys(analysis.metadata.extracted || {}).length;

                                    if (externalFieldCount > internalFieldCount) {
                                        console.log(`  🔄 Replacing metadata with more complete external version (${externalFieldCount} vs ${internalFieldCount} fields)`);
                                        analysis.metadata = matchedMetadata;
                                    } else {
                                        console.log(`  ℹ️  Keeping internal metadata (${internalFieldCount} fields) over external (${externalFieldCount} fields)`);
                                    }
                                }
                            } else {
                                console.log(`  ⚠️  No metadata match found for ${folderData.displayName}`);
                            }
                        }

                        analyses.push(analysis);
                    } catch (error) {
                        console.error(`Error parsing folder ${folderData.displayName}:`, error);
                        const detectionResult = detectionResults.find(r => r.folderName === folderData.displayName);

                        // Try to preserve metadata even if data parsing failed
                        let metadata = null;
                        if (detectionResult?.metadata?.found) {
                            metadata = {
                                raw: detectionResult.metadata.rawText,
                                source: detectionResult.metadata.sourceFile,
                                format: detectionResult.metadata.format,
                                extracted: detectionResult.metadata.extractedFields || {},
                                confidence: detectionResult.metadata.confidence
                            };
                        }

                        // Try to match external metadata even on error using LLM
                        if (externalMetadataMap.size > 0) {
                            const matchedMetadata = await this.matchMetadataWithLLM(
                                folderData.displayName,
                                Array.from(externalMetadataMap.keys()),
                                externalMetadataMap
                            );

                            if (matchedMetadata) {
                                metadata = matchedMetadata;
                                console.log(`  ✅ Applied external metadata to failed dataset ${folderData.displayName}`);
                            }
                        }

                        analyses.push({
                            name: folderData.displayName,
                            inputType: detectionResult?.detectedType || 'unknown',
                            files: folderData.files,
                            error: `Failed to parse: ${error.message}`,
                            data: null,
                            metadata: metadata,
                            originalPath: folderData.fullPath,
                            parentPath: folderData.parentPath,
                            llmDetection: detectionResult
                        });
                    }
                }
            } catch (error) {
                console.error('❌ LLM detection failed, falling back to rule-based detection:', error);
                // Fallback to rule-based detection
                for (const [analysisKey, folderData] of folderMap.entries()) {
                    try {
                        console.log(`Parsing folder: ${folderData.displayName} with ${folderData.files.length} files`);
                        const analysis = await this.parseAnalysisFolder(folderData.displayName, folderData.files);

                        analysis.originalPath = folderData.fullPath;
                        analysis.parentPath = folderData.parentPath;

                        analyses.push(analysis);
                    } catch (error) {
                        console.error(`Error parsing folder ${folderData.displayName}:`, error);
                        analyses.push({
                            name: folderData.displayName,
                            inputType: 'unknown',
                            files: folderData.files,
                            error: `Failed to parse: ${error.message}`,
                            data: null,
                            metadata: null,
                            originalPath: folderData.fullPath,
                            parentPath: folderData.parentPath
                        });
                    }
                }
            }
        } else {
            // Original rule-based detection
            for (const [analysisKey, folderData] of folderMap.entries()) {
                try {
                    console.log(`Parsing folder: ${folderData.displayName} with ${folderData.files.length} files`);
                    const analysis = await this.parseAnalysisFolder(folderData.displayName, folderData.files);

                    // Add path information to the analysis for folder-based grouping
                    analysis.originalPath = folderData.fullPath;
                    analysis.parentPath = folderData.parentPath;

                    analyses.push(analysis);
                } catch (error) {
                    console.error(`Error parsing folder ${folderData.displayName}:`, error);
                    analyses.push({
                        name: folderData.displayName,
                        inputType: 'unknown',
                        files: folderData.files,
                        error: `Failed to parse: ${error.message}`,
                        data: null,
                        metadata: null,
                        originalPath: folderData.fullPath,
                        parentPath: folderData.parentPath
                    });
                }
            }
        }

        // Parse group file if found
        let groups = null;
        if (groupFileContent) {
            try {
                groups = await this.parseGroupFile(groupFileContent, analyses);
                console.log('Parsed groups from file:', groups);
            } catch (error) {
                console.error('Error parsing group file:', error);
                groups = null;
            }
        }

        // FINAL STEP: Run common field analysis on ALL analyses (including those with internal metadata)
        // This runs REGARDLESS of whether LLM detection is enabled
        console.log('🔍 Running final common metadata field analysis on all parsed datasets...');
        console.log(`📋 Total analyses to check: ${analyses.length}`);

        const allMetadataMap = new Map();
        analyses.forEach(analysis => {
            console.log(`  Checking ${analysis.name}:`, {
                hasMetadata: !!analysis.metadata,
                hasExtracted: !!(analysis.metadata?.extracted),
                extractedFieldCount: Object.keys(analysis.metadata?.extracted || {}).length
            });

            if (analysis.metadata && analysis.metadata.extracted && Object.keys(analysis.metadata.extracted).length > 0) {
                allMetadataMap.set(analysis.name, analysis.metadata);
                console.log(`  ✅ Added ${analysis.name} to metadata map (${Object.keys(analysis.metadata.extracted).length} fields)`);
            }
        });

        console.log(`📊 Total datasets with metadata: ${allMetadataMap.size}`);

        if (allMetadataMap.size > 0) {
            console.log(`🤖 Analyzing ${allMetadataMap.size} datasets for common metadata fields...`);
            let commonFieldsAnalysis = await this.identifyCommonMetadataFields(allMetadataMap);

            // Fallback: If LLM analysis fails, create a simple analysis manually
            if (!commonFieldsAnalysis) {
                console.log('⚠️  LLM analysis failed or returned null, using fallback analysis...');
                commonFieldsAnalysis = this.createFallbackCommonFieldsAnalysis(allMetadataMap);
            }

            if (commonFieldsAnalysis) {
                window.__metadataStandardization = commonFieldsAnalysis;
                console.log(`✅ Common field analysis complete: Found ${commonFieldsAnalysis.commonFields.length} common fields`);
                console.log('   Fields:', commonFieldsAnalysis.commonFields.map(f => f.name));
            } else {
                console.log('⚠️  Both LLM and fallback analysis failed');
                window.__metadataStandardization = null;
            }
        } else {
            console.log('⚠️  No metadata found across datasets - skipping common field analysis');
            window.__metadataStandardization = null;
        }

        return {
            analyses,
            groups,
            groupFileName
        };
    }

    // ADD: New method to identify system files
    static isSystemFile(fileName) {
        const name = fileName.toLowerCase();
        return name === '.ds_store' ||
            name === 'thumbs.db' ||
            name === 'desktop.ini' ||
            name.startsWith('.') && name !== '.txt' && name !== '.csv' && name !== '.tsv';
    }

    static isGroupFile(fileName) {
        const name = fileName.toLowerCase();
        return name === 'groups.txt' ||
            name === 'group.txt' ||
            name.includes('group') && (name.endsWith('.txt') || name.endsWith('.csv'));
    }

    // NEW: Identify metadata files with flexible naming
    static isMetadataFile(fileName) {
        const name = fileName.toLowerCase();
        // Match common metadata file names
        return name === 'metadata.txt' ||
            name === 'metadata.md' ||
            name === 'metadata.json' ||
            name === 'info.txt' ||
            name === 'info.md' ||
            name === 'readme.txt' ||
            name === 'readme.md' ||
            name === 'description.txt' ||
            name === 'description.md' ||
            name.includes('metadata') ||
            name.includes('info') && (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json'));
    }

    /**
     * Extract metadata fields from text content using pattern matching
     * Handles key-value pairs in various formats
     */
    static extractMetadataFromText(content) {
        const fields = {};
        const lines = content.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Try multiple patterns:
            // 1. "Key: Value" format
            let match = trimmed.match(/^([A-Za-z\s\/\(\)]+):\s*(.+)$/);
            if (match) {
                const key = match[1].trim(); // Keep original field name (no normalization)
                const value = match[2].trim();
                if (key && value) {
                    fields[key] = value;
                }
                continue;
            }

            // 2. "Key = Value" format
            match = trimmed.match(/^([A-Za-z\s\/\(\)]+)\s*=\s*(.+)$/);
            if (match) {
                const key = match[1].trim(); // Keep original field name (no normalization)
                const value = match[2].trim();
                if (key && value) {
                    fields[key] = value;
                }
                continue;
            }

            // 3. Extract from "Dataset: XYZ" at start of content
            if (trimmed.startsWith('Dataset:')) {
                const datasetMatch = trimmed.match(/^Dataset:\s*(.+)$/);
                if (datasetMatch && !fields.datasetId) {
                    fields.datasetId = datasetMatch[1].trim();
                }
            }
        }

        return fields;
    }

    /**
     * Normalize field names to camelCase
     */
    static normalizeFieldName(name) {
        // Convert to camelCase
        return name
            .toLowerCase()
            .replace(/[\/\(\)\s]+(.)/g, (_, char) => char.toUpperCase())
            .replace(/[\/\(\)\s]/g, '')
            .replace(/^(.)/, (_, char) => char.toLowerCase());
    }

    /**
     * Use LLM to detect and split combined metadata files
     * @param {String} content - File content
     * @param {String} fileName - Original filename
     * @returns {Promise<Object>} - {isCombined: boolean, datasets: [{id, content}]}
     */
    static async splitCombinedMetadataFile(content, fileName) {
        try {
            if (content.length < 200) {
                return { isCombined: false, datasets: [] };
            }

            console.log(`  🤖 Using LLM to analyze metadata file structure (${content.length} chars)...`);

            // Send full content to LLM (we have 128k tokens available)
            // 128k tokens ≈ 512k characters, so we can send large files
            const prompt = `Analyze this metadata file and find ALL dataset IDs/names.

FILE: ${fileName} (${content.length} characters)

FULL CONTENT:
${content}

TASK:
1. Scan the ENTIRE content above
2. Find ALL dataset identifiers (e.g., OSD-352, OSD-101, GSE12345, etc.)
3. For each dataset, identify where its section starts (the exact text that marks the beginning)

Return JSON with ALL datasets:
{
  "isCombined": true,
  "datasets": [
    {"id": "OSD-352", "startMarker": "Dataset: OSD-352"},
    {"id": "OSD-326", "startMarker": "Dataset: OSD-326"},
    {"id": "OSD-103", "startMarker": "Dataset: OSD-103"}
    ... include ALL datasets found
  ]
}

If only ONE dataset:
{"isCombined": false, "datasetId": "OSD-101"}

Return ONLY valid JSON.`;

            const response = await Meteor.callAsync('llm.chat', [
                { role: 'system', content: 'You are a metadata file analyzer. Scan the entire content carefully and find ALL datasets. Respond with only valid JSON.' },
                { role: 'user', content: prompt }
            ], {
                temperature: 0,
                maxTokens: 128000
            });

            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.log(`  ⚠️  LLM returned invalid JSON`);
                return { isCombined: false, datasets: [] };
            }

            const result = JSON.parse(jsonMatch[0]);
            console.log(`  📊 LLM result:`, result);

            if (!result.isCombined) {
                console.log(`  ✓ LLM confirmed: single dataset file`);
                return { isCombined: false, datasets: [] };
            }

            console.log(`  📋 LLM identified ${result.datasets.length} datasets:`, result.datasets.map(d => d.id));

            // Split content using LLM-identified markers
            const datasets = [];
            for (let i = 0; i < result.datasets.length; i++) {
                const dataset = result.datasets[i];
                const nextDataset = result.datasets[i + 1];

                let startIndex = content.indexOf(dataset.startMarker);
                let endIndex = nextDataset ? content.indexOf(nextDataset.startMarker) : content.length;

                console.log(`    Processing "${dataset.id}": startMarker="${dataset.startMarker}", found at ${startIndex}`);

                if (startIndex === -1) {
                    // Fallback: search for dataset ID anywhere
                    const idRegex = new RegExp(dataset.id.replace(/[-\/]/g, '\\$&'), 'i');
                    const match = content.search(idRegex);
                    if (match >= 0) {
                        startIndex = match;
                        console.log(`    Fallback found "${dataset.id}" at ${startIndex}`);
                    }
                }

                if (startIndex >= 0) {
                    const sectionContent = content.substring(startIndex, endIndex).trim();
                    console.log(`    ✓ Extracted ${sectionContent.length} chars for "${dataset.id}"`);
                    datasets.push({
                        id: dataset.id,
                        content: sectionContent
                    });
                } else {
                    console.log(`    ⚠️  Could not find section for "${dataset.id}"`);
                }
            }

            console.log(`  ✅ Successfully split into ${datasets.length} sections`);
            return { isCombined: true, datasets };

        } catch (error) {
            console.error(`  ❌ LLM splitting error:`, error.message);
            return { isCombined: false, datasets: [] };
        }
    }

    /**
     * Deduplicate and normalize metadata field names across all datasets using LLM
     * @param {Map} metadataMap - Map of dataset ID to metadata objects
     * @returns {Promise<void>}
     */
    static async deduplicateMetadataFields(metadataMap) {
        try {
            // Collect all unique field names across all metadata entries
            const allFieldNames = new Set();
            metadataMap.forEach(metadata => {
                if (metadata.extracted) {
                    Object.keys(metadata.extracted).forEach(field => allFieldNames.add(field));
                }
            });

            const fieldNamesArray = Array.from(allFieldNames);

            if (fieldNamesArray.length === 0) {
                console.log('  ⚠️  No fields to deduplicate');
                return;
            }

            console.log(`  📋 Found ${fieldNamesArray.length} unique field names:`, fieldNamesArray);

            // Use LLM to group similar field names
            const prompt = `You are analyzing metadata field names to identify duplicates and similar fields that should be merged.

Field names found across datasets:
${fieldNamesArray.map((name, i) => `${i + 1}. "${name}"`).join('\n')}

Task: Identify groups of field names that represent the same concept and should be merged.

Rules:
- Case variations are duplicates: "Age", "age" → merge to "Age"
- Different phrasings of same concept: "Tissue Type", "Tissue", "tissue" → merge to "Tissue"
- Keep the most descriptive and commonly used name as canonical
- Fields that are clearly different should not be merged
- Keep "Dataset" or "datasetId" as-is (special field)

Respond with JSON array of merge groups. Each group has a "canonical" name and "variants" array:

{
  "merges": [
    {
      "canonical": "Age",
      "variants": ["age", "Age (weeks)"]
    },
    {
      "canonical": "Tissue",
      "variants": ["tissue", "Tissue Type"]
    }
  ]
}

Only include groups that need merging. If a field has no duplicates, don't include it.`;

            const response = await Meteor.callAsync('llm.chat', [
                { role: 'system', content: 'You are a metadata normalization assistant. Respond with only valid JSON.' },
                { role: 'user', content: prompt }
            ], {
                temperature: 0,
                maxTokens: 128000 // Increased to 128k for local LLM
            });

            // Parse LLM response
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.log('  ⚠️  Could not parse LLM response for field deduplication');
                return;
            }

            const result = JSON.parse(jsonMatch[0]);
            const merges = result.merges || [];

            if (merges.length === 0) {
                console.log('  ✅ No duplicate fields found - all field names are unique');
                return;
            }

            console.log(`  🔄 Merging ${merges.length} field groups:`, merges);

            // Build field mapping (old name → canonical name)
            const fieldMapping = {};
            merges.forEach(merge => {
                merge.variants.forEach(variant => {
                    fieldMapping[variant] = merge.canonical;
                });
            });

            // Apply mapping to all metadata entries
            let totalRenamed = 0;
            metadataMap.forEach((metadata, datasetId) => {
                if (metadata.extracted) {
                    const newExtracted = {};
                    Object.entries(metadata.extracted).forEach(([key, value]) => {
                        const canonicalKey = fieldMapping[key] || key;
                        if (canonicalKey !== key) {
                            totalRenamed++;
                            console.log(`    📝 ${datasetId}: "${key}" → "${canonicalKey}"`);
                        }
                        newExtracted[canonicalKey] = value;
                    });
                    metadata.extracted = newExtracted;
                }
            });

            console.log(`  ✅ Deduplicated ${totalRenamed} field name(s) across all datasets`);

        } catch (error) {
            console.error('  ❌ Error in field deduplication:', error);
            // Continue without deduplication - don't block the flow
        }
    }

    /**
     * Create a fallback common fields analysis without LLM
     * This is used when the LLM service is unavailable
     * @param {Map} metadataMap - Map of dataset ID to metadata objects
     * @returns {Object|null} Common fields analysis or null
     */
    static createFallbackCommonFieldsAnalysis(metadataMap) {
        try {
            const totalDatasets = metadataMap.size;
            const minCoverage = Math.floor(totalDatasets * 0.6); // 60% coverage threshold

            // Count field occurrences across datasets (case-insensitive)
            const fieldOccurrences = new Map(); // lowercase field name -> {canonical: string, datasets: Set, variants: Set}

            metadataMap.forEach((metadata, datasetId) => {
                if (metadata.extracted) {
                    Object.keys(metadata.extracted).forEach(field => {
                        const lowerField = field.toLowerCase();
                        if (!fieldOccurrences.has(lowerField)) {
                            fieldOccurrences.set(lowerField, {
                                canonical: field, // Use first occurrence as canonical
                                datasets: new Set(),
                                variants: new Set()
                            });
                        }
                        const entry = fieldOccurrences.get(lowerField);
                        entry.datasets.add(datasetId);
                        entry.variants.add(field);
                    });
                }
            });

            // Find common fields (appear in >= 60% of datasets)
            const commonFields = [];
            const datasetMappings = {};
            const missingFields = {};

            // Initialize dataset mappings and missing fields
            metadataMap.forEach((metadata, datasetId) => {
                datasetMappings[datasetId] = {};
                missingFields[datasetId] = [];
            });

            fieldOccurrences.forEach((entry, lowerField) => {
                if (entry.datasets.size >= minCoverage) {
                    commonFields.push({
                        name: entry.canonical,
                        description: `Common field found in ${entry.datasets.size}/${totalDatasets} datasets`,
                        coverage: entry.datasets.size,
                        aliases: Array.from(entry.variants)
                    });

                    // Build dataset mappings
                    metadataMap.forEach((metadata, datasetId) => {
                        if (metadata.extracted) {
                            // Find which variant of this field this dataset has
                            const datasetField = Object.keys(metadata.extracted).find(
                                f => f.toLowerCase() === lowerField
                            );

                            if (datasetField) {
                                datasetMappings[datasetId][entry.canonical] = datasetField;
                            } else {
                                missingFields[datasetId].push(entry.canonical);
                            }
                        }
                    });
                }
            });

            console.log(`  📋 Fallback: Found ${commonFields.length} common fields (${minCoverage}+ coverage)`);

            if (commonFields.length === 0) {
                return null;
            }

            return {
                commonFields,
                datasetMappings,
                missingFields
            };

        } catch (error) {
            console.error('  ❌ Error in fallback analysis:', error);
            return null;
        }
    }

    /**
     * Identify common metadata fields across all datasets using LLM
     * @param {Map} metadataMap - Map of dataset ID to metadata objects
     * @returns {Promise<Object|null>} Common fields analysis or null
     */
    static async identifyCommonMetadataFields(metadataMap) {
        try {
            // Build dataset field summary
            const datasetSummary = [];
            metadataMap.forEach((metadata, datasetId) => {
                if (metadata.extracted) {
                    const fields = Object.keys(metadata.extracted);
                    datasetSummary.push({
                        dataset: datasetId,
                        fields: fields
                    });
                }
            });

            if (datasetSummary.length === 0) {
                console.log('  ⚠️  No metadata to analyze');
                return null;
            }

            console.log(`  📊 Analyzing ${datasetSummary.length} datasets for common fields...`);

            // TEMPORARY: Skip LLM entirely due to empty response issues
            // The fallback analysis works well and doesn't require LLM
            console.log(`  ⚠️  Using fallback analysis (LLM currently returning empty responses)`);
            return null; // Will trigger fallback

            // If there are too many datasets (>20), skip LLM and use fallback directly
            if (datasetSummary.length > 20) {
                console.log(`  ⚠️  Too many datasets (${datasetSummary.length}), skipping LLM and using fallback analysis`);
                return null; // Will trigger fallback
            }

            // Simplified prompt to avoid empty responses
            const prompt = `Analyze metadata fields from ${datasetSummary.length} datasets and identify common fields (60%+ coverage).

${datasetSummary.map((ds, i) => `${i + 1}. ${ds.dataset}: ${ds.fields.join(', ')}`).join('\n')}

Return JSON with commonFields array and datasetMappings object. Example:
{"commonFields":[{"name":"Age","description":"Age","coverage":15,"aliases":["Age"]}],"datasetMappings":{"${datasetSummary[0].dataset}":{"Age":"Age"}},"missingFields":{}}`;

            const response = await Meteor.callAsync('llm.chat', [
                { role: 'system', content: 'You are a metadata standardization assistant. Respond with only valid JSON.' },
                { role: 'user', content: prompt }
            ], {
                temperature: 0,
                maxTokens: 128000 // Increased to 128k for local LLM
            });

            // Parse LLM response
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.log('  ⚠️  Could not parse LLM response for common fields');
                return null;
            }

            const result = JSON.parse(jsonMatch[0]);

            console.log(`  ✅ Identified ${result.commonFields.length} common fields`);
            console.log(`     Common fields:`, result.commonFields.map(f => `${f.name} (${f.coverage}/${datasetSummary.length})`));

            return result;

        } catch (error) {
            console.error('  ❌ Error identifying common fields:', error);
            console.error('  ❌ Error type:', error.constructor.name);
            console.error('  ❌ Error message:', error.message);
            console.error('  ❌ Error details:', error);
            if (error.error) {
                console.error('  ❌ Meteor error code:', error.error);
                console.error('  ❌ Meteor error reason:', error.reason);
            }
            return null;
        }
    }

    /**
     * Use LLM to match dataset folder name with metadata file keys
     * @param {String} datasetName - Dataset folder name (e.g., "OSD-111-EDL")
     * @param {Array} metadataKeys - Array of metadata keys from filenames (e.g., ["OSD-111-S", "OSD-111-EDL"])
     * @param {Map} metadataMap - Map of metadata entries
     * @returns {Promise<Object|null>} Matched metadata entry or null
     */
    static async matchMetadataWithLLM(datasetName, metadataKeys, metadataMap) {
        try {
            // First try exact match (fast path)
            if (metadataMap.has(datasetName)) {
                console.log(`    ⚡ Exact match found: ${datasetName}`);
                return metadataMap.get(datasetName);
            }

            // If only a few keys, try simple substring matching
            if (metadataKeys.length <= 3) {
                for (const key of metadataKeys) {
                    if (datasetName.includes(key) || key.includes(datasetName)) {
                        console.log(`    ⚡ Substring match found: ${datasetName} ↔ ${key}`);
                        return metadataMap.get(key);
                    }
                }
            }

            // For larger sets or no simple match, use LLM
            console.log(`    🤖 Using LLM to match "${datasetName}" with ${metadataKeys.length} metadata files`);

            const prompt = `You are matching a dataset folder name with metadata file names.

Dataset folder name: "${datasetName}"

Available metadata files:
${metadataKeys.map((key, i) => `${i + 1}. ${key}`).join('\n')}

Task: Determine which metadata file corresponds to this dataset folder. Consider:
- Exact matches (e.g., "OSD-111-EDL" matches "OSD-111-EDL")
- Partial matches with tissue/sample suffixes (e.g., "OSD-111-EDL" matches "OSD-111" if EDL is a tissue type)
- Abbreviated names (e.g., "OSD-111-S" could match "OSD-111-Soleus" or vice versa)

Respond with ONLY the exact metadata file name that matches, or "NO_MATCH" if none match.

Examples:
- Dataset "OSD-111-EDL" → "OSD-111-EDL" (exact match)
- Dataset "OSD-111-Soleus" → "OSD-111-S" (abbreviated match)
- Dataset "OSD-135-Biceps" → "OSD-135-B" (abbreviated match)

Response (just the filename or NO_MATCH):`;

            const response = await Meteor.callAsync('llm.chat', [
                { role: 'system', content: 'You are a dataset matching assistant. Respond with only the matching filename or NO_MATCH.' },
                { role: 'user', content: prompt }
            ], {
                temperature: 0,
                maxTokens: 128000 // Increased to 128k for local LLM
            });

            const match = response.content.trim();

            if (match === 'NO_MATCH' || !metadataMap.has(match)) {
                console.log(`    ❌ LLM found no match for ${datasetName}`);
                return null;
            }

            console.log(`    ✅ LLM matched: ${datasetName} → ${match}`);
            return metadataMap.get(match);

        } catch (error) {
            console.error(`    ❌ Error in LLM matching for ${datasetName}:`, error);
            return null;
        }
    }

    static async parseGroupFile(groupFile, analyses) {
        const content = await this.readFileContent(groupFile);
        const lines = content.trim().split(/\r?\n/).filter(line => line.trim() !== '');

        const groups = {};
        const analysisNames = new Set(analyses.map(a => a.name));

        lines.forEach((line, index) => {
            try {
                // Enhanced format: "Group Name [Description]: Analysis1, Analysis2" or "/folder"
                // Fallback format: "Group Name: Analysis1, Analysis2" or "/folder"
                const descMatch = line.match(/^([^[]+)\[([^\]]+)\]:\s*(.+)$/);
                const simpleMatch = line.match(/^([^:]+):\s*(.+)$/);

                let groupName, description, analysisSpecification;

                if (descMatch) {
                    groupName = descMatch[1].trim();
                    description = descMatch[2].trim();
                    analysisSpecification = descMatch[3].trim();
                } else if (simpleMatch) {
                    groupName = simpleMatch[1].trim();
                    description = ''; // No description provided
                    analysisSpecification = simpleMatch[2].trim();
                } else {
                    console.warn(`Line ${index + 1} in group file doesn't match expected format: ${line}`);
                    return;
                }

                let analysisNamesInGroup = [];

                // Check if this is a folder-based specification (starts with "/")
                if (analysisSpecification.startsWith('/')) {
                    analysisNamesInGroup = this.getAnalysesFromFolderPath(analysisSpecification, analyses);
                    console.log(`Folder-based grouping for "${groupName}": found ${analysisNamesInGroup.length} analyses in "${analysisSpecification}"`);
                } else {
                    // Traditional comma-separated list of analysis names
                    analysisNamesInGroup = analysisSpecification
                        .split(',')
                        .map(name => name.trim())
                        .filter(name => name !== '');
                }

                // Validate that analyses exist
                const validAnalyses = analysisNamesInGroup.filter(name => {
                    if (!analysisNames.has(name)) {
                        console.warn(`Analysis "${name}" in group "${groupName}" not found in uploaded analyses`);
                        return false;
                    }
                    return true;
                });

                if (validAnalyses.length > 0) {
                    const firstAnalysis = analyses.find(a => a.name === validAnalyses[0]);
                    const inputType = firstAnalysis ? firstAnalysis.inputType : null;

                    const allSameInputType = validAnalyses.every(name => {
                        const analysis = analyses.find(a => a.name === name);
                        return analysis && analysis.inputType === inputType;
                    });

                    if (!allSameInputType) {
                        console.warn(`Group "${groupName}" contains analyses with different input types. Only same-type analyses can be grouped.`);
                        return;
                    }

                    const groupId = `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    groups[groupId] = {
                        id: groupId,
                        name: groupName,
                        description: description,
                        inputType: inputType,
                        analyses: validAnalyses,
                        isDefault: false,
                        isAutoCreated: true,
                        // Add metadata about how this group was created
                        groupingMethod: analysisSpecification.startsWith('/') ? 'folder' : 'explicit',
                        folderPath: analysisSpecification.startsWith('/') ? analysisSpecification : null
                    };

                    console.log(`Created group "${groupName}" with ${validAnalyses.length} analyses`);
                } else {
                    console.warn(`No valid analyses found for group "${groupName}"`);
                }
            } catch (error) {
                console.error(`Error parsing line ${index + 1} in group file:`, error);
            }
        });

        return groups;
    }

// New helper method to find analyses matching a folder path
    static getAnalysesFromFolderPath(folderPath, analyses) {
        // Remove leading slash and normalize the path
        const normalizedFolderPath = folderPath.replace(/^\/+/, '').replace(/\/+$/, '');

        if (!normalizedFolderPath) {
            console.warn('Empty folder path specified');
            return [];
        }

        console.log(`Looking for analyses in folder: "${normalizedFolderPath}"`);
        const matchingAnalyses = [];

        analyses.forEach(analysis => {
            let foundMatch = false;

            // Check multiple sources for path information
            const pathsToCheck = [];

            // Add parentPath if available
            if (analysis.parentPath) {
                pathsToCheck.push(analysis.parentPath);
            }

            // Add originalPath if available
            if (analysis.originalPath) {
                pathsToCheck.push(analysis.originalPath);
            }

            // Add paths from files
            if (analysis.files && analysis.files.length > 0) {
                analysis.files.forEach(file => {
                    if (file.path) {
                        pathsToCheck.push(file.path);
                    }
                });
            }

            console.log(`Analysis "${analysis.name}" - checking paths:`, pathsToCheck);

            // Check if any path contains the target folder
            for (const path of pathsToCheck) {
                const pathParts = path.split('/').filter(p => p.length > 0);
                if (pathParts.includes(normalizedFolderPath)) {
                    console.log(`✓ Found "${normalizedFolderPath}" in path: ${path}`);
                    foundMatch = true;
                    break;
                }
            }

            if (foundMatch) {
                matchingAnalyses.push(analysis.name);
            } else {
                console.log(`✗ Analysis "${analysis.name}" - no match for "${normalizedFolderPath}"`);
            }
        });

        console.log(`Found ${matchingAnalyses.length} analyses matching folder "${normalizedFolderPath}":`, matchingAnalyses);
        return matchingAnalyses;
    }

// Helper method to extract the original folder path from an analysis
    static getAnalysisOriginalPath(analysis) {
        // If the analysis has files with webkitRelativePath, extract the folder path
        if (analysis.files && analysis.files.length > 0) {
            const firstFile = analysis.files[0];
            if (firstFile.path) {
                // Extract the folder path from the file path
                // e.g., "high/OSD-21/data.txt" -> "high"
                const pathParts = firstFile.path.split('/');
                if (pathParts.length >= 2) {
                    // Return all parts except the filename and immediate parent
                    // This handles nested structures properly
                    return pathParts.slice(0, -2).join('/');
                }
            }
        }

        // Fallback: return empty string for root-level analyses
        return '';
    }

// Helper method to check if an analysis path matches the specified folder path
    static isPathMatch(analysisPath, targetFolderPath) {
        // Normalize both paths
        const normalizedAnalysisPath = analysisPath.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
        const normalizedTargetPath = targetFolderPath.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');

        // Exact match
        if (normalizedAnalysisPath === normalizedTargetPath) {
            return true;
        }

        // Check if analysis is in a subdirectory of the target folder
        // e.g., target "high" matches analysis path "high/subfolder"
        if (normalizedAnalysisPath.startsWith(normalizedTargetPath + '/')) {
            return true;
        }

        // Handle case where target folder is the immediate parent
        // e.g., target "high" matches analysis that was directly in "high" folder
        const analysisParentPath = normalizedAnalysisPath.split('/').slice(0, -1).join('/');
        if (analysisParentPath === normalizedTargetPath) {
            return true;
        }

        return false;
    }


    static generateGroupFileContent(groups, analyses) {
        const lines = [];

        Object.values(groups).forEach(group => {
            if (group.analyses && group.analyses.length > 0) {
                const analysisNames = group.analyses.join(', ');
                if (group.description && group.description.trim() !== '') {
                    lines.push(`${group.name} [${group.description}]: ${analysisNames}`);
                } else {
                    lines.push(`${group.name}: ${analysisNames}`);
                }
            }
        });

        return lines.join('\n');
    }

    static downloadGroupFile(groups, analyses, filename = 'groups.txt') {
        const content = this.generateGroupFileContent(groups, analyses);
        const blob = new Blob([content], {type: 'text/plain;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    static async parseMetadataFile(files) {
        const metadataFile = files.find(f => f.name.toLowerCase() === 'metadata.txt');

        if (!metadataFile) {
            return null; // Metadata is optional
        }

        try {
            // Just read the raw content, no parsing needed
            const content = await this.readFileContent(metadataFile.file);
            return content.trim(); // Return raw text content
        } catch (error) {
            console.warn('Error reading metadata file:', error);
            return null;
        }
    }

    static async parseAnalysisFolder(folderName, files, llmDetection = null) {
        const analysis = {
            name: folderName,
            files: files,
            inputType: null,
            data: null,
            error: null,
            metadata: null // Add metadata field
        };

        const fileNames = files.map(f => f.name.toLowerCase());

        // Get metadata from LLM detection if available
        if (llmDetection && llmDetection.metadata && llmDetection.metadata.found) {
            // Use LLM-extracted metadata
            analysis.metadata = {
                raw: llmDetection.metadata.rawText,
                source: llmDetection.metadata.sourceFile,
                format: llmDetection.metadata.format,
                extracted: llmDetection.metadata.extractedFields || {},
                confidence: llmDetection.metadata.confidence
            };
            console.log(`✅ Extracted metadata from ${llmDetection.metadata.sourceFile} (${Object.keys(llmDetection.metadata.extractedFields || {}).length} fields)`);
        } else {
            // Fallback: read raw metadata file if LLM didn't extract
            const rawMetadata = await this.parseMetadataFile(files);
            if (rawMetadata) {
                analysis.metadata = {
                    raw: rawMetadata,
                    source: 'metadata.txt',
                    format: 'unknown',
                    extracted: {},
                    confidence: 'none'
                };
                console.log('📄 Read raw metadata file (no LLM extraction)');
            }
        }

        // Use LLM detection if provided
        let detectedType = null;
        if (llmDetection && llmDetection.detectedType && llmDetection.detectedType !== 'unknown' && llmDetection.detectedType !== 'ambiguous') {
            detectedType = llmDetection.detectedType;
            console.log(`Using LLM-detected type: ${detectedType}`);
        }

        // Determine input type (use LLM detection if available, otherwise rule-based)
        console.log('here')
        if (detectedType === 'ora' || (!detectedType && this.isORAAnalysis(fileNames))) {
            analysis.inputType = 'ora';
            analysis.data = await this.parseORAFiles(files, llmDetection);
        } else if (detectedType === 'expression' || (!detectedType && this.isExpressionAnalysis(fileNames))) {
            analysis.inputType = 'expression';
            analysis.data = await this.parseExpressionFiles(files, llmDetection);
        } else if (detectedType === 'pgsea' || (!detectedType && this.isPGSEAAnalysis(fileNames, files))) {
            analysis.inputType = 'pgsea';
            console.log('Detected PGSEA analysis in folder');
            analysis.data = await this.parsePGSEAFiles(files, llmDetection);
        } else if (llmDetection && llmDetection.detectedType === 'ambiguous') {
            throw new Error('Ambiguous input type detected. Multiple file types found in folder. Please ensure each folder contains only one input type.');
        } else {
            throw new Error('Unable to determine analysis type. Ensure required files are present.');
        }

        return analysis;
    }

    static isORAAnalysis(fileNames) {
        return fileNames.includes('input.txt');
    }

    // UPDATED: isPGSEAAnalysis method - Exclude metadata.txt and system files
    static isPGSEAAnalysis(fileNames, files) {
        // Avoid conflict if it's an expression analysis with other .csv files
        if (this.isExpressionAnalysis(fileNames)) return false;

        const textFiles = files.filter(f => {
            const lowerName = f.name.toLowerCase();
            return (lowerName.endsWith('.txt') || lowerName.endsWith('.tsv') || lowerName.endsWith('.csv')) &&
                lowerName !== 'input.txt' &&           // ORA specific
                lowerName !== 'background.txt' &&      // ORA specific
                lowerName !== 'metadata.txt' &&        // Exclude metadata
                !this.isSystemFile(f.name);            // Exclude system files
        });
        return textFiles.length > 0;
    }

    static isExpressionAnalysis(fileNames) {
        const hasExpressionFile = fileNames.some(name =>
            name.includes('expression') && name.endsWith('.csv')
        );
        const hasGroupFile = fileNames.some(name =>
            name.includes('group') && name.endsWith('.csv')
        );
        return hasExpressionFile && hasGroupFile;
    }

    static async parseORAFiles(files, llmDetection = null) {
        // Use LLM-detected file name if available, otherwise fall back to hardcoded names
        const primaryFileName = llmDetection?.primaryFile || 'input.txt';
        const secondaryFileName = llmDetection?.secondaryFile || 'background.txt';

        console.log(`🔍 parseORAFiles - LLM detected primary: ${primaryFileName}, secondary: ${secondaryFileName}`);
        console.log(`📁 Available files:`, files.map(f => f.name));

        const inputFile = files.find(f => f.name === primaryFileName || f.name.toLowerCase() === 'input.txt');
        const backgroundFile = files.find(f => f.name === secondaryFileName || f.name.toLowerCase() === 'background.txt');

        console.log(`✅ Found inputFile: ${inputFile?.name}, backgroundFile: ${backgroundFile?.name}`);

        if (!inputFile) {
            console.error(`❌ Could not find input file. Looking for: "${primaryFileName}" or "input.txt"`);
            throw new Error(`ORA Analysis: Input gene list file is required. Expected "${primaryFileName}" or "input.txt".`);
        }

        const inputContent = await this.readFileContent(inputFile.file);
        const backgroundContent = backgroundFile ?
            await this.readFileContent(backgroundFile.file) : '';

        const inputGenes = inputContent.trim().split(/\r?\n/) // Handles Windows/Unix line endings
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (inputGenes.length === 0) {
            throw new Error('ORA Analysis: "input.txt" is empty or contains no valid gene identifiers.');
        }

        const backgroundGenes = backgroundContent ?
            backgroundContent.trim().split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0) : [];

        return {
            input: inputContent,
            background: backgroundContent,
            inputGenes,
            backgroundGenes
        };
    }

    // UPDATED: parsePGSEAFiles method - Exclude metadata.txt and system files
    static async parsePGSEAFiles(files, llmDetection = null) {
        // Use LLM-detected file name if available
        const primaryFileName = llmDetection?.primaryFile;

        let dataFile;

        if (primaryFileName) {
            // Use LLM-detected file name directly
            dataFile = files.find(f => f.name === primaryFileName);
        }

        // Fallback to pattern matching if LLM detection not available or file not found
        if (!dataFile) {
            dataFile = files.find(f => {
                const name = f.name.toLowerCase();
                // Exclude files typically associated with other types if not already caught
                const isExpressionRelated = name.includes('expression') || name.includes('group');
                const isMetadataFile = name === 'metadata.txt';  // Exclude metadata
                const isSystemFile = this.isSystemFile(f.name);   // Exclude system files

                return (name.endsWith('.txt') || name.endsWith('.tsv') || name.endsWith('.csv')) &&
                    name !== 'input.txt' &&
                    name !== 'background.txt' &&
                    !isExpressionRelated &&
                    !isMetadataFile &&          // Exclude metadata
                    !isSystemFile;             // Exclude system files
            });
        }

        if (!dataFile) {
            throw new Error(`PGSEA Analysis: No suitable data file found. Expected "${primaryFileName || 'ranked gene file'}" (.txt, .tsv, or .csv).`);
        }

        const content = await this.readFileContent(dataFile.file);

        // Accept the historical `Gene / Fold-Change / P-value` table (optional header,
        // 2 or 3 columns) and normalize to the canonical 2-column `Gene\tStatistic`
        // string the backend consumes (createPgseaParams). Ranking defaults to
        // Fold-Change at parse time — which makes the output identical to a plain
        // `Gene\tFoldChange` file — and the mass-analysis UI can recompute `content`
        // for the P-value ranking via buildPgseaContent(rows, rankingBy) without
        // re-reading the file. See imports/utils/pgseaInput.js.
        const rankingBy = llmDetection?.rankingBy || 'fc';
        const normalized = normalizePgseaInput(content, { rankingBy });

        return {
            fileName: dataFile.name,
            content: normalized.content,
            rows: normalized.rows,
            available: normalized.available,
            rankingBy: normalized.rankingBy,
            delimiter: normalized.delimiter
        };
    }

    static async parseExpressionFiles(files, llmDetection = null) {
        // Use LLM-detected file names if available
        const primaryFileName = llmDetection?.primaryFile;
        const secondaryFileName = llmDetection?.secondaryFile;

        console.log(`🔍 parseExpressionFiles - LLM detected primary: ${primaryFileName}, secondary: ${secondaryFileName}`);
        console.log(`📁 Available files:`, files.map(f => f.name));

        let expressionFile, groupFile;

        if (primaryFileName && secondaryFileName) {
            // Use LLM-detected file names
            expressionFile = files.find(f => f.name === primaryFileName);
            groupFile = files.find(f => f.name === secondaryFileName);
        }

        // Fallback to pattern matching if LLM detection not available or files not found
        if (!expressionFile) {
            expressionFile = files.find(f =>
                f.name.toLowerCase().includes('expression') && f.name.toLowerCase().endsWith('.csv')
            );
        }
        if (!groupFile) {
            groupFile = files.find(f =>
                f.name.toLowerCase().includes('group') && f.name.toLowerCase().endsWith('.csv')
            );
        }

        console.log(`✅ Found expressionFile: ${expressionFile?.name}, groupFile: ${groupFile?.name}`);

        if (!expressionFile) {
            console.error(`❌ Could not find expression file. Looking for: "${primaryFileName}" or pattern "expression*.csv"`);
            throw new Error(`Expression Analysis: An expression file is required. Expected "${primaryFileName || 'expression.csv'}".`);
        }
        if (!groupFile) {
            console.error(`❌ Could not find group file. Looking for: "${secondaryFileName}" or pattern "group*.csv"`);
            throw new Error(`Expression Analysis: A group file is required. Expected "${secondaryFileName || 'group.csv'}".`);
        }

        const expressionContent = await this.readFileContent(expressionFile.file);
        const groupContent = await this.readFileContent(groupFile.file);

        const expressionParsed = Papa.parse(expressionContent, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            comments: "#"
        });

        if (expressionParsed.errors.length > 0) {
            const firstError = expressionParsed.errors[0];
            throw new Error(`Expression Analysis: Parse error in expression file "${expressionFile.name}" - ${firstError.message} (Code: ${firstError.code}, Row: ${firstError.row}).`);
        }
        if (!expressionParsed.meta.fields || expressionParsed.meta.fields.length < 2) {
            throw new Error('Expression Analysis: Expression file must have a header with at least one gene ID column and one sample column.');
        }
        if (expressionParsed.data.length === 0) {
            throw new Error('Expression Analysis: Expression file contains no data rows.');
        }

        const groupParsed = Papa.parse(groupContent, {
            header: false, // Try to auto-detect header or assume no header
            skipEmptyLines: true,
            comments: "#"
        });

        if (groupParsed.errors.length > 0) {
            const firstError = groupParsed.errors[0];
            throw new Error(`Expression Analysis: Parse error in group file "${groupFile.name}" - ${firstError.message} (Code: ${firstError.code}, Row: ${firstError.row}).`);
        }

        const groupData = {};
        let groupRows = groupParsed.data;
        if (groupRows.length > 0) {
            const firstRow = groupRows[0].map(s => String(s).toLowerCase().trim());
            if ((firstRow.includes('sample') || firstRow.includes('id')) && firstRow.includes('group')) {
                groupRows = groupRows.slice(1); // Skip detected header
            }
        }

        // Track every label seen per sample name so we can warn about duplicate /
        // conflicting rows. `groupData` is keyed by sample name (last-write-wins), so a
        // sample listed twice silently collapses — e.g. an expression matrix whose
        // duplicate columns were de-duped with a `_1` suffix paired with a group file
        // that never got the suffix. Mirrors parseGroupData's `warnings` in imports/utils/groupDataUtils.js.
        const seenGroupLabels = new Map();
        groupRows.forEach((row, index) => {
            if (row.length >= 2 && String(row[0]).trim() !== "" && String(row[1]).trim() !== "") {
                const sample = String(row[0]).trim();
                const label = String(row[1]).trim();
                groupData[sample] = label;
                if (!seenGroupLabels.has(sample)) seenGroupLabels.set(sample, []);
                seenGroupLabels.get(sample).push(label);
            } else if (row.some(cell => String(cell).trim() !== "")) {
                console.warn(`Expression Analysis: Group file "${groupFile.name}" - malformed row ${index + 1} skipped: ${row}`);
            }
        });

        if (Object.keys(groupData).length === 0) {
            throw new Error('Expression Analysis: Group file is empty or no valid Sample-Group pairs found. Expected two columns (Sample, Group), optionally with a header.');
        }

        const groupWarnings = { duplicateSamples: [], conflictingLabels: [] };
        seenGroupLabels.forEach((labels, sample) => {
            if (labels.length > 1) {
                groupWarnings.duplicateSamples.push(sample);
                const distinct = [...new Set(labels)];
                if (distinct.length > 1) {
                    groupWarnings.conflictingLabels.push({ sample, labels: distinct, kept: groupData[sample] });
                }
            }
        });
        if (groupWarnings.duplicateSamples.length > 0) {
            console.warn(`Expression Analysis: Group file "${groupFile.name}" - ${groupWarnings.duplicateSamples.length} sample name(s) appear in multiple rows and were merged (last value kept); ${groupWarnings.conflictingLabels.length} had conflicting labels: ${groupWarnings.duplicateSamples.join(', ')}`);
        }

        const expressionSampleNames = expressionParsed.meta.fields.slice(1).map(s => String(s).trim());
        const groupSampleNames = Object.keys(groupData);

        const missingSamplesInExpr = groupSampleNames.filter(s => !expressionSampleNames.includes(s));
        if (missingSamplesInExpr.length > 0) {
            throw new Error(`Expression Analysis: Samples from group file not found in expression file headers: ${missingSamplesInExpr.join(', ')}. Check for typos or inconsistencies.`);
        }

        const samplesWithoutGroupInfo = expressionSampleNames.filter(s => !groupSampleNames.includes(s));
        if (samplesWithoutGroupInfo.length > 0) {
            console.warn(`Expression Analysis: Samples from expression file headers not found in group file: ${samplesWithoutGroupInfo.join(', ')}. These samples may be ignored.`);
        }

        const validSamples = expressionSampleNames.filter(s => groupSampleNames.includes(s));

        return {
            expressionFileName: expressionFile.name,
            groupFileName: groupFile.name,
            expressionData: expressionParsed.data,
            expressionHeaders: expressionParsed.meta.fields,
            groupData: groupData,
            samples: validSamples, // Samples present in both expression headers and group file
            genesCount: expressionParsed.data.length,
            groupWarnings // duplicate / conflicting-label samples detected in the group file
        };
    }

    static async readFileContent(fileInstance) {
        return new Promise((resolve, reject) => {
            if (!(fileInstance instanceof File)) {
                console.error("readFileContent received non-File object:", fileInstance);
                return reject(new Error('Invalid file object provided to readFileContent.'));
            }
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (err) => {
                console.error(`FileReader error for ${fileInstance.name}:`, reader.error);
                reject(new Error(`Failed to read file "${fileInstance.name}": ${reader.error?.message || 'Unknown error'}`));
            };
            reader.readAsText(fileInstance);
        });
    }

    /**
     * Call LLM detection with progress updates for each batch
     */
    static async callLLMDetectionWithProgress(foldersData, progressCallback) {
        const BATCH_SIZE = 3;
        const results = [];

        for (let i = 0; i < foldersData.length; i += BATCH_SIZE) {
            const batch = foldersData.slice(i, i + BATCH_SIZE);

            // Mark batch folders as processing
            if (progressCallback) {
                batch.forEach(folder => {
                    progressCallback(folder.name, 'processing');
                });
            }

            // Process batch (server will process these 3 in parallel)
            const batchPromises = batch.map(async folderData => {
                try {
                    const result = await Meteor.callAsync('massAnalysis.detectFolder', folderData);

                    // Mark as complete
                    if (progressCallback) {
                        progressCallback(folderData.name, 'complete', result);
                    }

                    return result;
                } catch (error) {
                    console.error(`Error detecting folder ${folderData.name}:`, error);
                    const errorResult = {
                        folderName: folderData.name,
                        detectedType: 'unknown',
                        confidence: 'low',
                        reasoning: `Error: ${error.message}`,
                        validation: null
                    };

                    if (progressCallback) {
                        progressCallback(folderData.name, 'complete', errorResult);
                    }

                    return errorResult;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        return results;
    }
}

export default FileParser;
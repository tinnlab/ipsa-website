// server/llm/validators/dataValidator.js
// LLM-powered data validation for pathway analysis inputs

import { getDefaultLLM } from '../config.js';
import { isNumericToken } from '/imports/utils/pgseaInput';

/**
 * Max OUTPUT tokens for validation/detection LLM calls.
 *
 * This caps the model's RESPONSE length, NOT the input file size (the prompt is
 * already truncated to a small sample before sending). vLLM enforces
 * `prompt_tokens + max_completion_tokens <= context (~131072 for gpt-oss-120b)`,
 * so an oversized value (the old 128000) leaves no room for the prompt and the
 * llm-router/vLLM backend rejects the request with a non-retryable HTTP 400 —
 * which is why data validation broke after the GPU-idling backend switch while
 * chat (2000) and metadata (8000) kept working. 64000 is generous headroom for a
 * small validation JSON and stays comfortably under the context window.
 */
export const VALIDATION_MAX_TOKENS = 64000;

/**
 * Format specifications for each input type
 */
const FORMAT_SPECS = {
  ora: {
    name: 'ORA (Over Representation Analysis)',
    description: 'Gene list only, one gene per line',
    requirements: [
      'Plain text file with gene symbols or IDs',
      'One gene per line',
      'No header row required',
      'No additional columns',
      'Example: BRCA1, TP53, EGFR (each on separate line)'
    ],
    examples: [
      'BRCA1\nTP53\nEGFR\nKRAS\nPTEN'
    ]
  },
  // NOTE (scope): this spec — and the pgsea branch of quickValidate below — backs the
  // single-analysis wizard's `data.validate` path. It deliberately mirrors the tolerant
  // contract that imports/utils/pgseaInput.js `normalizePgseaInput` implements and that the
  // mass-analysis folder flow describes in buildDetectionAndValidationPrompt: 2 or 3
  // columns, optional header, tab or comma. Both flows now share that one parser, so keep
  // the three in sync — tightening one without the others brings back the old asymmetry
  // where a file the wizard happily accepts gets reported as invalid.
  pgsea: {
    name: 'PGSEA (Parametric Gene Set Enrichment Analysis)',
    description: 'Delimited file with gene identifiers and one or two numeric ranking columns; header optional',
    requirements: [
      'Tab-separated (preferred) or comma-separated',
      'At least 2 columns: Gene, Fold-Change, and optionally P-value',
      'Extra columns are fine — a full limma topTable or DESeq2 results table is accepted; the fold-change/statistic and p-value columns are picked by name',
      'A header row IS allowed (e.g. "Gene", "Fold-Change", "P-value") but is not required',
      'First column: Gene identifier (symbol, ID, or name)',
      'Second column: Fold-change or another signed ranking statistic',
      'Third column (optional): P-value',
      'Value columns must be numeric (fold-change may be positive or negative)',
      'Both "GOLM1\\t0.377" (2 columns, no header) and "Gene\\tFold-Change\\tP-value" (3 columns, header) are valid'
    ],
    examples: [
      'GOLM1\t0.377\nPOLD4\t0.442\nPIGA\t1.615',
      'Gene\tFold-Change\tP-value\nGOLM1\t0.377\t0.025\nPOLD4\t0.442\t0.015',
      'BRCA1\t-2.5\nTP53\t1.8\nEGFR\t0.3'
    ]
  },
  expression: {
    name: 'Expression Matrix',
    description: 'CSV matrix with genes as rows and samples as columns',
    requirements: [
      'CSV format (comma-separated)',
      'MUST have header row with sample names',
      'First column: gene IDs or symbols (can be quoted or unquoted, can be empty header)',
      'Remaining columns: expression values for each sample',
      'At least 2 samples (columns) plus gene ID column',
      'Expression values should be numeric (can be positive or negative)',
      'NOTE: This file will be used with a separate group file, but do not check for the group file - validate only this file\'s structure'
    ],
    examples: [
      '"","Sample1","Sample2","Sample3"\n"GENE1",10.5,12.3,8.7\n"TP53",5.2,6.1,4.8',
      'Gene,Sample1,Sample2,Sample3\nBRCA1,10.5,12.3,8.7\nTP53,5.2,6.1,4.8'
    ]
  },
  group: {
    name: 'Group File (for Expression Matrix)',
    description: 'CSV file mapping samples to experimental groups/conditions',
    requirements: [
      'CSV format (comma-separated)',
      'NO header row - data starts from first line',
      'Two columns: sample_name, group_label',
      'Sample names should be unique identifiers (e.g., GSM119615, Sample1, patient_001)',
      'Group labels can be any strings (e.g., "control", "treated", "c", "d", "healthy", "disease")',
      'Each row represents one sample and its group assignment',
      'NOTE: Sample names will be matched with expression file during analysis, but do not check for expression file here - validate only this file\'s structure'
    ],
    examples: [
      'Sample1,control\nSample2,control\nSample3,treated\nSample4,treated',
      'GSM119615,c\nGSM119616,c\nGSM238763,d\nGSM238790,d'
    ]
  }
};

/**
 * Validate data format using LLM
 * @param {String} inputType - Type of input: 'ora', 'pgsea', or 'expression'
 * @param {String} fileContent - Content of uploaded file
 * @param {String} fileName - Name of the file (optional)
 * @returns {Promise<Object>} Validation result
 */
export async function validateDataFormat(inputType, fileContent, fileName = '') {
  try {
    const llm = getDefaultLLM();
    const spec = FORMAT_SPECS[inputType];

    if (!spec) {
      throw new Error(`Unknown input type: ${inputType}`);
    }

    // Take first 20 rows for analysis
    const lines = fileContent.trim().split('\n');
    const sample = lines.slice(0, 20).join('\n');

    const prompt = buildValidationPrompt(inputType, spec, sample, fileName);

    console.log('🔍 Validating data format with LLM...');

    const response = await llm.chat([
      { role: 'system', content: 'You are a data format validator for biological pathway analysis. Analyze data files and provide validation feedback in JSON format.' },
      { role: 'user', content: prompt }
    ], {
      temperature: 0,
      maxTokens: VALIDATION_MAX_TOKENS
    });

    // Parse LLM response
    const result = parseValidationResponse(response.content);

    console.log('✅ Validation complete:', {
      valid: result.valid,
      errors: result.errors?.length || 0,
      suggestions: result.suggestions?.length || 0
    });

    return result;

  } catch (error) {
    console.error('❌ Validation error:', error);
    return {
      valid: false,
      errors: [`Validation service error: ${error.message}`],
      suggestions: ['Please check your file format manually against the documentation'],
      confidence: 'low',
      llmError: true
    };
  }
}

/**
 * Build validation prompt for LLM
 */
function buildValidationPrompt(inputType, spec, sampleData, fileName) {
  let additionalInstructions = '';

  if (inputType === 'expression') {
    additionalInstructions = '\n\nIMPORTANT: Do NOT check for companion files (like group files). Only validate the structure of this expression matrix file itself.';
  } else if (inputType === 'group') {
    additionalInstructions = '\n\nIMPORTANT: Do NOT check if sample names match any expression file. The expression file may not exist yet. Only validate the structure of this group file itself (2 columns, no header, CSV format).';
  }

  return `You are validating a data file for ${spec.name}.

File Name: ${fileName || 'Unknown'}
Input Type: ${inputType.toUpperCase()}

EXPECTED FORMAT:
${spec.description}

REQUIREMENTS:
${spec.requirements.map((req, i) => `${i + 1}. ${req}`).join('\n')}

VALID EXAMPLES:
${spec.examples.map((ex, i) => `Example ${i + 1}:\n${ex}`).join('\n\n')}

FILE CONTENT (first 20 rows):
\`\`\`
${sampleData}
\`\`\`

TASK:
Analyze if this file matches the expected format for ${inputType.toUpperCase()}.${additionalInstructions}

Check for:
1. Correct file structure (columns, separators, headers)
2. Required headers present (if applicable)
3. Data types in each column
4. Common formatting errors

Return ONLY a JSON object with this exact structure:
{
  "valid": true or false,
  "errors": ["specific error 1", "specific error 2"],
  "suggestions": ["how to fix error 1", "how to fix error 2"],
  "confidence": "high" or "medium" or "low",
  "detectedFormat": "description of what you detected"
}

Be specific about errors. For example:
- "Missing header row - expected 'Gene', 'Fold-Change'"
- "Found 4 columns but expected 2-3 columns"
- "Header 'gene_name' should be 'Gene'"
- "Values in column 2 should be numeric but found text"

Return ONLY valid JSON, no additional text.`;
}

/**
 * Parse LLM response to extract validation result
 */
function parseValidationResponse(content) {
  try {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]);

    // Validate structure
    return {
      valid: result.valid === true,
      errors: Array.isArray(result.errors) ? result.errors : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      confidence: result.confidence || 'medium',
      detectedFormat: result.detectedFormat || 'Unknown'
    };

  } catch (error) {
    console.error('Failed to parse LLM response:', error);
    return {
      valid: false,
      errors: ['Failed to parse validation response'],
      suggestions: ['Please check file format manually'],
      confidence: 'low',
      detectedFormat: 'Parse error',
      parseError: true
    };
  }
}

/**
 * Quick validation without LLM (fallback)
 * Basic rule-based validation
 */
export function quickValidate(inputType, fileContent) {
  const lines = fileContent.trim().split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { valid: false, errors: ['File is empty'] };
  }

  switch (inputType) {
    case 'ora':
      // ORA: just genes, one per line
      return { valid: true, errors: [] };

    case 'pgsea': {
      // PGSEA: 2 or 3 columns, tab- or comma-separated, header optional. Mirrors the
      // contract of imports/utils/pgseaInput.js `normalizePgseaInput`, which is the parser
      // that actually consumes this file — so do not re-tighten this to "exactly 2 columns,
      // no header" without changing that parser too.
      // Skip `#` comment lines — normalizePgseaInput passes `comments: '#'` to papaparse, so
      // a file that opens with a comment parses fine and must not be reported invalid here.
      const pgseaLines = lines.filter(l => !l.trim().startsWith('#'));
      if (pgseaLines.length === 0) {
        return { valid: false, errors: ['File contains no data rows'] };
      }
      const pgseaDelimiter = (pgseaLines[0].match(/\t/g) || []).length >= (pgseaLines[0].match(/,/g) || []).length ? '\t' : ',';
      const firstLine = pgseaLines[0].split(pgseaDelimiter);
      // Lower bound ONLY — normalizePgseaInput enforces `>= 2` and nothing more, so it happily
      // ranks a full limma topTable (Gene/logFC/AveExpr/t/P.Value/adj.P.Val/B) or a DESeq2
      // results table. An upper bound here would reject files the parser handles correctly,
      // which is exactly the validator/parser mismatch this is supposed to prevent. It would
      // also mis-count any quoted field containing the delimiter, since this split is naive.
      if (firstLine.length < 2) {
        return {
          valid: false,
          errors: [`Expected at least 2 columns (Gene, Fold-Change[, P-value]) but found ${firstLine.length} columns`]
        };
      }
      // A header row is allowed, so row 0 may legitimately be non-numeric. Scan ALL data rows
      // rather than just one: DE exports carry NA for independently-filtered / low-count genes,
      // so a table can easily lead with them — a DESeq2 result sorted with filtered genes first
      // leads with hundreds — and checking a single row reported those as invalid while the
      // parser handles them fine. No row limit here on purpose: normalizePgseaInput's 20-row
      // window is only for column TYPING; its per-row loop accepts a usable row wherever it
      // appears, so any cap here would reintroduce the same disagreement further down the file.
      //
      // Uses the parser's OWN strict numeric test, not parseFloat — parseFloat happily accepts
      // "1.5x", "45%" and the European "3,14", so the validator used to call a file valid that
      // normalizePgseaInput then rejects.
      const pgseaHasValues = (cols) => cols.slice(1).some(c => isNumericToken(c));
      const pgseaDataRows = pgseaHasValues(firstLine) ? pgseaLines : pgseaLines.slice(1);
      if (pgseaDataRows.length === 0) {
        return {
          valid: false,
          errors: ['File appears to contain only a header row - no gene data rows found']
        };
      }
      if (!pgseaDataRows.some(line => pgseaHasValues(line.split(pgseaDelimiter)))) {
        return {
          valid: false,
          errors: ['Value columns should be numeric (fold-change and, optionally, p-value). No numeric ranking column was found.']
        };
      }
      return { valid: true, errors: [] };
    }

    case 'expression':
      // Expression: check for comma-separated
      const expHeader = lines[0].split(',');
      if (expHeader.length < 3) {
        return {
          valid: false,
          errors: [`Expected at least 3 columns (gene + 2 samples) but found ${expHeader.length}`]
        };
      }
      return { valid: true, errors: [] };

    case 'group':
      // Group: check for 2 columns, comma-separated
      const groupLine = lines[0].split(',');
      if (groupLine.length !== 2) {
        return {
          valid: false,
          errors: [`Expected 2 columns (sample_name, group_label) but found ${groupLine.length} columns`]
        };
      }
      return { valid: true, errors: [] };

    default:
      return { valid: false, errors: ['Unknown input type'] };
  }
}

/**
 * Detect input type for a folder containing multiple files
 * @param {Object} folderData - Object with folder info
 * @param {String} folderData.name - Folder name
 * @param {Array} folderData.files - Array of {name, content} objects
 * @returns {Promise<Object>} Detection result
 */
export async function detectFolderInputType(folderData) {
  try {
    const llm = getDefaultLLM();
    const { name: folderName, files } = folderData;

    // Prepare file summaries for LLM (include more content for validation)
    // Reduce preview size for folders with many files to avoid overwhelming the LLM
    const previewLines = files.length > 5 ? 5 : 10; // Use 5 lines if many files, 10 if few

    // For folders with many files (likely metadata), only send first 5 files in detail
    const maxDetailedFiles = 5;
    const filesToAnalyze = files.slice(0, maxDetailedFiles);
    const remainingFileCount = files.length - filesToAnalyze.length;

    const fileSummaries = filesToAnalyze.map(file => ({
      name: file.name,
      extension: file.name.split('.').pop(),
      lineCount: file.content.split('\n').length,
      preview: file.content.split('\n').slice(0, previewLines).join('\n')
    }));

    const prompt = buildDetectionAndValidationPrompt(
      folderName,
      fileSummaries,
      files.map(f => f.name), // Send all filenames
      remainingFileCount
    );

    console.log(`🔍 Detecting and validating folder: ${folderName}`);

    try {
      const response = await llm.chat([
        { role: 'system', content: 'You are a pathway analysis data classifier and validator. Analyze folder contents, detect the input type, and validate the data format. Return ONLY valid JSON with concise values.' },
        { role: 'user', content: prompt }
      ], {
        temperature: 0,
        maxTokens: VALIDATION_MAX_TOKENS,
        stop: ['```', '\n\n\n'] // Stop at code blocks or excessive newlines
      });

      const result = parseDetectionAndValidationResponse(response.content);

      console.log(`✅ Detection complete: ${result.detectedType} (confidence: ${result.confidence}), validation: ${result.validation?.valid ? 'valid' : 'invalid'}, metadata: ${result.metadata?.found ? 'found' : 'not found'}`);

      return {
        folderName,
        detectedType: result.detectedType,
        confidence: result.confidence,
        reasoning: result.reasoning,
        primaryFile: result.primaryFile,
        secondaryFile: result.secondaryFile,
        validation: result.validation,
        metadata: result.metadata,  // ADD: Include metadata in return object
        files: files.map(f => f.name)
      };
    } catch (error) {
      console.log(`⚠️  LLM detection unavailable for ${folderName}, using rule-based fallback`);

      // Fallback: Use simple rule-based detection
      const fileNames = files.map(f => f.name.toLowerCase());
      let detectedType = 'unknown';

      // Check if this is a metadata-only folder
      const hasOnlyMetadataFiles = files.every(f => {
        const name = f.name.toLowerCase();
        return name.includes('metadata') ||
               name.includes('info') ||
               name.match(/^[A-Z0-9]+-\d+/i) || // OSD-123 pattern
               name.endsWith('.txt') ||
               name.endsWith('.md');
      });

      const hasNoDataFiles = !fileNames.includes('input.txt') &&
                             !fileNames.some(name => name.includes('expression') && name.endsWith('.csv')) &&
                             !fileNames.some(name => name.includes('group'));

      if (hasOnlyMetadataFiles && hasNoDataFiles) {
        detectedType = 'metadata-only';
      } else if (fileNames.includes('input.txt')) {
        detectedType = 'ora';
      } else if (fileNames.some(name => name.includes('expression') && name.endsWith('.csv'))) {
        detectedType = 'expression';
      } else if (fileNames.some(name => (name.endsWith('.txt') || name.endsWith('.tsv') || name.endsWith('.csv'))
                                        && name !== 'metadata.txt' && name !== 'background.txt')) {
        detectedType = 'pgsea';
      }

      console.log(`✅ Detected ${detectedType} for ${folderName} (rule-based fallback)`);

      return {
        folderName,
        detectedType,
        confidence: 'medium',
        reasoning: 'Rule-based detection (LLM unavailable)',
        primaryFile: null,
        secondaryFile: null,
        validation: { valid: true, errors: [], warnings: [] },
        metadata: { found: false },
        files: files.map(f => f.name)
      };
    }

  } catch (error) {
    console.error('❌ Detection error:', error);
    return {
      folderName: folderData.name,
      detectedType: 'unknown',
      confidence: 'low',
      reasoning: `Error during detection: ${error.message}`,
      validation: null,
      files: folderData.files.map(f => f.name)
    };
  }
}

/**
 * Build combined detection and validation prompt for folder analysis
 */
export function buildDetectionAndValidationPrompt(folderName, fileSummaries, allFileNames = [], remainingFileCount = 0) {
  const fileListSection = remainingFileCount > 0
    ? `FILES IN FOLDER (${allFileNames.length} total, showing first ${fileSummaries.length} in detail):
All files: ${allFileNames.join(', ')}

Detailed analysis of first ${fileSummaries.length} files:`
    : `FILES IN FOLDER (${fileSummaries.length} total):`;

  return `Analyze folder for pathway analysis. Detect type AND validate format.

INPUT TYPES:
1. ORA: Single .txt file, gene list, one gene per line, no header
2. PGSEA: Single .txt/.tsv/.csv file. First column = gene identifiers; followed by one or
   MORE numeric ranking columns (e.g. Fold-Change, and optionally P-value). A header row
   IS ALLOWED (e.g. Gene / Fold-Change / P-value). So both a 2-column Gene\\tValue file and
   a 3-column Gene / Fold-Change / P-value file (with header) are valid PGSEA input.
3. Expression: expression.csv (with header) + groups.csv (no header)
4. metadata-only: ONLY descriptive files, no analysis data

FOLDER: ${folderName}

${fileListSection}
${fileSummaries.map((file, i) => `
File ${i + 1}: ${file.name} (.${file.extension}, ${file.lineCount} lines)
\`\`\`
${file.preview}
\`\`\`
`).join('\n')}

**METADATA EXTRACTION:**
Extract ALL key-value pairs from any metadata file. Do NOT limit to predefined fields - extract everything!

Common fields (not limited to): Dataset IDs (GEO, SRA, etc.), organism, tissue, cell type, disease, treatment, age, sex, strain, genotype, platform, sequencing type, experimental conditions, time points, etc.

Supported formats: JSON, YAML, key-value pairs, tables, markdown, unstructured text.

TASK: 1) Detect input type, 2) Validate format, 3) Extract metadata

Return JSON:
{
  "detectedType": "ora" | "pgsea" | "expression" | "ambiguous" | "unknown" | "metadata-only",
  "confidence": "high" | "medium" | "low",
  "reasoning": "why you chose this type",
  "primaryFile": "name of main data file",
  "secondaryFile": "companion file if applicable",
  "validation": {
    "valid": true or false,
    "errors": ["specific error 1", "specific error 2"],
    "suggestions": ["how to fix 1", "how to fix 2"],
    "confidence": "high" | "medium" | "low",
    "detectedFormat": "description of detected format"
  },
  "metadata": {
    "found": true or false,
    "sourceFile": "name of file containing metadata or null",
    "format": "json" | "key_value" | "table" | "unstructured" | "none",
    "extractedFields": {
      "anyFieldName1": "value1",
      "anyFieldName2": "value2",
      "organism": "Homo sapiens",
      "tissue": "liver",
      "radioSensitivity": "4",
      "mgyExposure": "5.082",
      "...": "extract ALL fields found, no predefined list"
    },
    "rawText": "full original text from metadata file",
    "confidence": "high" | "medium" | "low"
  }
}

Validation examples:
- PGSEA Gene/Fold-Change/P-value with header → {"valid": true, "errors": [], "detectedFormat": "3-column Gene/Fold-Change/P-value (header)"}
- PGSEA 2-column Gene\\tValue → {"valid": true, "errors": [], "detectedFormat": "2-column Gene/Value"}
- PGSEA non-numeric ranking column → {"valid": false, "errors": ["Ranking column contains non-numeric values"]}
- PGSEA no gene column → {"valid": false, "errors": ["Could not find a gene identifier column"]}
- ORA has extra columns → {"valid": false, "errors": ["Found 2 columns but ORA should have only gene names"]}
- Expression missing companion → {"valid": false, "errors": ["Missing companion group file"]}

Return ONLY valid JSON, no additional text.`;
}

/**
 * Parse combined detection and validation response from LLM
 */
export function parseDetectionAndValidationResponse(content) {
  try {
    // Try to extract JSON - look for the largest complete JSON object
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    let jsonStr = jsonMatch[0];

    // Try to parse - if it fails, attempt to fix common issues
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.warn('⚠️  Initial JSON parse failed, attempting to fix...');
      console.warn(`   Error at position ${parseError.message.match(/position (\d+)/)?.[1] || 'unknown'}`);

      // Strategy 1: Find the last complete key-value pair before the error
      try {
        // Try progressively truncating from common delimiters
        const truncatePoints = [
          jsonStr.lastIndexOf('"}'),           // Last complete string value
          jsonStr.lastIndexOf('},'),           // Last complete object in array
          jsonStr.lastIndexOf(']'),            // Last complete array
          jsonStr.lastIndexOf('}')             // Last complete object
        ];

        for (const point of truncatePoints) {
          if (point > 0) {
            // Try to close the JSON properly
            let attempt = jsonStr.substring(0, point + 1);

            // Count unclosed braces and brackets
            const openBraces = (attempt.match(/\{/g) || []).length;
            const closeBraces = (attempt.match(/\}/g) || []).length;
            const openBrackets = (attempt.match(/\[/g) || []).length;
            const closeBrackets = (attempt.match(/\]/g) || []).length;

            // Add missing closing characters
            attempt += ']'.repeat(openBrackets - closeBrackets);
            attempt += '}'.repeat(openBraces - closeBraces);

            try {
              result = JSON.parse(attempt);
              console.log('✅ Successfully recovered truncated JSON');
              break;
            } catch (e) {
              // Continue to next truncation point
              continue;
            }
          }
        }

        if (!result) {
          throw parseError;
        }
      } catch (e) {
        throw parseError; // Re-throw original error if recovery fails
      }
    }

    // Parse validation object
    let validation = null;
    if (result.validation) {
      validation = {
        valid: result.validation.valid === true,
        errors: Array.isArray(result.validation.errors) ? result.validation.errors : [],
        suggestions: Array.isArray(result.validation.suggestions) ? result.validation.suggestions : [],
        confidence: result.validation.confidence || 'medium',
        detectedFormat: result.validation.detectedFormat || 'Unknown'
      };
    }

    // Parse metadata object
    let metadata = null;
    if (result.metadata) {
      metadata = {
        found: result.metadata.found === true,
        sourceFile: result.metadata.sourceFile || null,
        format: result.metadata.format || 'none',
        extractedFields: result.metadata.extractedFields || {},
        rawText: result.metadata.rawText || '',
        confidence: result.metadata.confidence || 'low'
      };
    }

    return {
      detectedType: result.detectedType || 'unknown',
      confidence: result.confidence || 'low',
      reasoning: result.reasoning || 'No reasoning provided',
      primaryFile: result.primaryFile || null,
      secondaryFile: result.secondaryFile || null,
      validation: validation,
      metadata: metadata
    };

  } catch (error) {
    console.error('Failed to parse detection response:', error);
    return {
      detectedType: 'unknown',
      confidence: 'low',
      reasoning: 'Failed to parse LLM response',
      primaryFile: null,
      secondaryFile: null,
      validation: {
        valid: false,
        errors: ['Failed to parse validation response'],
        suggestions: ['Please check file format manually'],
        confidence: 'low',
        detectedFormat: 'Parse error'
      },
      metadata: null
    };
  }
}

export default {
  validateDataFormat,
  quickValidate,
  detectFolderInputType,
  FORMAT_SPECS
};

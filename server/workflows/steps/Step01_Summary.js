// Step 1: Generate Overall Summary
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step01_Summary extends BaseStep {
  constructor() {
    super(1, 'Overall Summary', []); // No dependencies - first step in streamlined workflow

    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: WorkflowConfig.llm.temperature,
      maxTokens: WorkflowConfig.llm.maxTokens
    });

    this.factChecker = new FactCheckingService();
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);

    const { pathways = [], genes = [], analyses = [] } = input;

    // Extract experimental context
    const experimentContext = this._extractExperimentContext(analyses);

    // Use all pathways provided (already filtered by user's Top N selection in UI)
    const topPathways = pathways
      .filter(p => p.pValue !== undefined && p.pValue !== null)
      .sort((a, b) => a.pValue - b.pValue);

    // Categorize genes by direction for adaptive limiting
    const upregulated = genes
      .filter(g => g.foldChange !== undefined && g.foldChange !== null && g.foldChange > 0)
      .sort((a, b) => b.foldChange - a.foldChange); // Highest fold change first

    const downregulated = genes
      .filter(g => g.foldChange !== undefined && g.foldChange !== null && g.foldChange < 0)
      .sort((a, b) => a.foldChange - b.foldChange); // Most negative fold change first

    // Adaptive limiting: only limit if we have many genes
    const MIN_GENES_THRESHOLD = 150;
    const MAX_GENES_PER_DIRECTION = 50;

    const shouldLimit = genes.length > MIN_GENES_THRESHOLD;

    const topUpregulated = shouldLimit
      ? upregulated.slice(0, MAX_GENES_PER_DIRECTION)
      : upregulated;

    const topDownregulated = shouldLimit
      ? downregulated.slice(0, MAX_GENES_PER_DIRECTION)
      : downregulated;

    console.log(`  Using ${topPathways.length} pathways (user's selection from UI)`);
    if (shouldLimit) {
      console.log(`  Using ${genes.length} genes (showing top ${topUpregulated.length + topDownregulated.length} in prompt for efficiency)`);
      console.log(`    - Upregulated: ${topUpregulated.length}/${upregulated.length}`);
      console.log(`    - Downregulated: ${topDownregulated.length}/${downregulated.length}`);
    } else {
      console.log(`  Using ${genes.length} genes (all genes shown in prompt)`);
    }

    const systemPrompt = `You are a molecular biology expert. Generate a concise summary of pathway enrichment analysis results.

${experimentContext ? `Contextualize findings for: ${experimentContext}

Consider tissue-specific pathway functions and disease-relevant biological processes.` : ''}

CRITICAL: Generate SPECIFIC, high-quality analysis:
- Use actual pathway names and biological mechanisms from the data
- Provide concrete biological interpretations, not vague statements
- Identify precise themes based on the enriched pathways
- Be scientifically accurate and detailed

IMPORTANT - Pathway interpretation principles:
1. **Pathway names don't indicate literal disease overlap** - Pathways are often named after the disease where they were first characterized
2. **Focus on molecular mechanisms, not pathway names** - Example:
   - If "Alzheimer disease" pathway is enriched, don't say "neurodegenerative processes"
   - Instead, look at which genes drive enrichment (e.g., OXPHOS genes → "mitochondrial dysfunction", protein aggregation genes → "proteostasis stress")
3. **Explain WHY unexpected pathways appear** - Shared molecular mechanisms across different diseases
   - "Alzheimer/Parkinson pathways enriched due to shared mitochondrial dysfunction, not actual neurodegeneration"
   - "Viral infection pathways enriched due to interferon response genes, indicating immune activation"
4. **Identify themes by biological PROCESS** - Base themes on what genes/pathways actually DO:
   - Mitochondrial function, Cell cycle control, Immune response, Metabolic reprogramming
   - NOT: "Neurodegenerative diseases", "Viral infections" (unless actually studying those)
5. **Use experimental context to interpret appropriately** - ${experimentContext || 'the biological system being studied'}

CRITICAL - QUANTITATIVE ACCURACY:
- Use EXACT fold change values from the gene list provided
- Use EXACT p-values from the pathway list provided
- DO NOT round, approximate, or make up numerical values
- DO NOT confuse upregulated (FC > 0) with downregulated (FC < 0)
- When citing a gene, copy its fold change EXACTLY as shown in the data
- When citing a pathway, copy its p-value EXACTLY as shown in the data

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Analyze this pathway enrichment data and generate a summary:

${experimentContext ? `**Experimental Context:**
${experimentContext}
` : ''}

**Top Enriched Pathways:**
${topPathways.map(p => `- ${p.name || p.pathwayName} (p=${p.pValue?.toExponential(2) || 'N/A'}, ${p.database || 'unknown'})`).join('\n')}

**Top Upregulated Genes:**
${topUpregulated.map(g => `- ${g.name || g.gene || g.geneName}: FC=${g.foldChange?.toFixed(2) || 'N/A'}, p=${g.pValue?.toExponential(2) || 'N/A'}`).join('\n')}

**Top Downregulated Genes:**
${topDownregulated.map(g => `- ${g.name || g.gene || g.geneName}: FC=${g.foldChange?.toFixed(2) || 'N/A'}, p=${g.pValue?.toExponential(2) || 'N/A'}`).join('\n')}

Generate a summary that includes:
1. Main biological themes${experimentContext ? ` relevant to ${experimentContext}` : ''} (e.g., "immune response", "cell cycle", "metabolism")
2. Key enriched pathway categories${experimentContext ? ` and their significance in this tissue/disease context` : ''}
3. Notable gene expression patterns (upregulated vs downregulated)${experimentContext ? ` with tissue/disease-specific relevance` : ''}
4. Overall interpretation${experimentContext ? ` specific to ${experimentContext}` : ''} (what biological processes are affected)

Return JSON with QUANTITATIVE data:
{
  "mainThemes": ["theme1 with brief description", "theme2 with brief description", "theme3 with brief description"],
  "keyPathways": [
    {
      "name": "pathway1",
      "pValue": COPY_EXACT_PVALUE_FROM_TOP_ENRICHED_PATHWAYS_SECTION,
      "significance": "Why this is significant for the context"
    }
  ],
  "genePatterns": {
    "upregulated": [
      {"gene": "gene1", "foldChange": COPY_EXACT_FC_FROM_TOP_UPREGULATED_GENES_SECTION, "role": "brief role"}
    ],
    "downregulated": [
      {"gene": "gene3", "foldChange": COPY_EXACT_FC_FROM_TOP_DOWNREGULATED_GENES_SECTION, "role": "brief role"}
    ]
  },
  "quantitativeStats": {
    "totalUpregulated": count,
    "totalDownregulated": count,
    "strongestUpregulated": {"gene": "FIND_HIGHEST_FC_FROM_UPREGULATED_LIST", "foldChange": EXACT_VALUE},
    "strongestDownregulated": {"gene": "FIND_LOWEST_FC_FROM_DOWNREGULATED_LIST", "foldChange": EXACT_VALUE},
    "mostSignificantPathway": {"name": "pathway", "pValue": EXACT_VALUE}
  },
  "interpretation": "Brief overall interpretation with specific genes and fold changes mentioned (3-4 sentences)",
  "summary": "Detailed summary paragraph citing specific pathways with p-values and genes with fold changes (5-6 sentences)"
}

IMPORTANT - Copy numbers EXACTLY from the data above:
- DO NOT place downregulated genes (FC < 0) in the upregulated list
- DO NOT place upregulated genes (FC > 0) in the downregulated list
- COPY fold change and p-value numbers EXACTLY as shown, do not round or approximate`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate and enrich with actual quantitative values (hallucination prevention)
      const enrichedResult = this._validateAndEnrichSummary(result, topPathways, topUpregulated, topDownregulated);

      console.log(`  Main Themes: ${enrichedResult.mainThemes?.length || 0}`);
      console.log(`  Key Pathways: ${enrichedResult.keyPathways?.length || 0}`);

      // Conditionally fact-check the summary based on config
      let finalResult = enrichedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying content...');
        const experimentContext = this._extractExperimentContext(analyses);

        // Manually construct context since Step 1 is first (no previous step outputs)
        const factCheckContext = {
          genes: genes.slice(0, 50).map(g => g.name || g.gene || g.geneName).filter(Boolean),
          pathways: topPathways.slice(0, 20).map(p => p.name || p.pathwayName).filter(Boolean),
          themes: enrichedResult.mainThemes || [],
          experimentalContext: experimentContext,
          organismId: analyses && analyses.length > 0 ? analyses[0].organismId : null,
          analysisId: analyses && analyses.length > 0 ? analyses[0].id : null
        };

        const factCheckResult = await this.factChecker.factCheckAndRevise(
          enrichedResult,
          factCheckContext,
          'Overall Summary'
        );

        finalResult = factCheckResult.revisedResult;
        references = factCheckResult.references;
        factCheckStats = factCheckResult.stats;
      } else {
        console.log('  Fact-checking disabled - skipping verification');
      }

      // Combine top up and down genes for output
      const combinedTopGenes = [
        ...upregulated.slice(0, 5),
        ...downregulated.slice(0, 5)
      ];

      // Generate report section for final report
      const reportSection = this._generateReportSection(finalResult);

      return {
        ...finalResult,
        topPathways: topPathways.slice(0, 10).map(p => ({
          name: p.name || p.pathwayName,
          pValue: p.pValue,
          database: p.database
        })),
        topGenes: combinedTopGenes.map(g => ({
          gene: g.name || g.gene || g.geneName,
          foldChange: g.foldChange,
          pValue: g.pValue
        })),
        references,
        factCheckStats,
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        mainThemes: ['Unable to generate themes'],
        keyPathways: topPathways.slice(0, 5).map(p => p.name || p.pathwayName),
        genePatterns: {
          upregulated: upregulated.slice(0, 3).map(g => g.name || g.gene || g.geneName),
          downregulated: downregulated.slice(0, 3).map(g => g.name || g.gene || g.geneName)
        },
        interpretation: 'Summary generation encountered an error.',
        summary: `Analysis identified ${topPathways.length} enriched pathways and ${genes.length} differentially expressed genes.`,
        error: error.message
      };
    }
  }

  /**
   * Validate and enrich summary with actual quantitative values from input
   * Prevents hallucination of fold changes, p-values, and direction misclassification
   */
  _validateAndEnrichSummary(result, topPathways, upregulated, downregulated) {
    // Create lookup maps for ground truth values
    const geneMap = new Map();
    const pathwayMap = new Map();

    // Build gene map with actual quantitative data
    [...upregulated, ...downregulated].forEach(gene => {
      const geneName = gene.name || gene.gene || gene.geneName;
      if (geneName && gene.foldChange !== undefined && gene.foldChange !== null) {
        geneMap.set(geneName, {
          foldChange: gene.foldChange,
          pValue: gene.pValue,
          direction: gene.foldChange > 0 ? 'up' : 'down'
        });
      }
    });

    // Build pathway map with actual p-values
    topPathways.forEach(pathway => {
      const name = pathway.name || pathway.pathwayName;
      if (name) {
        pathwayMap.set(name, {
          pValue: pathway.pValue,
          pValueFDR: pathway.pValueFDR,
          database: pathway.database
        });
      }
    });

    let correctedValues = 0;
    let directionErrors = 0;

    // Validate and enrich keyPathways with actual p-values
    const enrichedKeyPathways = (result.keyPathways || [])
      .filter(kp => {
        if (!pathwayMap.has(kp.name)) {
          console.warn(`    ⚠️ Removed hallucinated pathway in keyPathways: "${kp.name}"`);
          return false;
        }
        return true;
      })
      .map(kp => {
        const actual = pathwayMap.get(kp.name);

        // Check if p-value was hallucinated or incorrect
        if (kp.pValue !== undefined && kp.pValue !== null) {
          if (typeof kp.pValue === 'number' && typeof actual.pValue === 'number') {
            // Both are numbers - compare directly
            if (Math.abs(kp.pValue - actual.pValue) > 1e-10) {
              console.warn(`    ⚠️ Corrected p-value for ${kp.name}: LLM=${kp.pValue.toExponential(2)} → Actual=${actual.pValue.toExponential(2)}`);
              correctedValues++;
            }
          } else if (typeof kp.pValue !== 'number') {
            // LLM returned non-numeric value - try to parse it
            const parsedValue = parseFloat(kp.pValue);

            // Only warn if parsing failed OR parsed value differs from actual
            if (isNaN(parsedValue) || Math.abs(parsedValue - actual.pValue) > 1e-10) {
              console.warn(`    ⚠️ Corrected incorrect p-value for ${kp.name}: LLM="${kp.pValue}" → Actual=${actual.pValue.toExponential(2)}`);
              correctedValues++;
            }
            // Otherwise: value is correct, just wrong type - silently fix
          }
        }

        return {
          ...kp,
          pValue: actual.pValue,
          pValueFDR: actual.pValueFDR,
          database: actual.database
        };
      });

    // Validate and enrich upregulated genes
    const enrichedUpregulated = (result.genePatterns?.upregulated || [])
      .filter(g => {
        const geneData = geneMap.get(g.gene);
        if (!geneData) {
          console.warn(`    ⚠️ Removed hallucinated gene in upregulated: "${g.gene}"`);
          return false;
        }

        // Check direction - gene should be upregulated (FC > 0)
        if (geneData.direction !== 'up') {
          console.warn(`    ⚠️ Direction error: ${g.gene} is DOWNREGULATED (FC=${geneData.foldChange.toFixed(2)}) but LLM placed in upregulated list`);
          directionErrors++;
          return false;
        }
        return true;
      })
      .map(g => {
        const actual = geneMap.get(g.gene);

        // Check if fold change was hallucinated or incorrect
        if (g.foldChange !== undefined && g.foldChange !== null) {
          if (typeof g.foldChange === 'number' && typeof actual.foldChange === 'number') {
            // Both are numbers - compare directly
            if (Math.abs(g.foldChange - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected FC for ${g.gene}: LLM=${g.foldChange.toFixed(2)} → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
          } else if (typeof g.foldChange !== 'number') {
            // LLM returned non-numeric value - try to parse it
            const parsedValue = parseFloat(g.foldChange);

            // Only warn if parsing failed OR parsed value differs from actual
            if (isNaN(parsedValue) || Math.abs(parsedValue - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected incorrect FC for ${g.gene}: LLM="${g.foldChange}" → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
            // Otherwise: value is correct, just wrong type - silently fix
          }
        }

        return {
          ...g,
          foldChange: actual.foldChange,
          pValue: actual.pValue
        };
      });

    // Validate and enrich downregulated genes
    const enrichedDownregulated = (result.genePatterns?.downregulated || [])
      .filter(g => {
        const geneData = geneMap.get(g.gene);
        if (!geneData) {
          console.warn(`    ⚠️ Removed hallucinated gene in downregulated: "${g.gene}"`);
          return false;
        }

        // Check direction - gene should be downregulated (FC < 0)
        if (geneData.direction !== 'down') {
          console.warn(`    ⚠️ Direction error: ${g.gene} is UPREGULATED (FC=${geneData.foldChange.toFixed(2)}) but LLM placed in downregulated list`);
          directionErrors++;
          return false;
        }
        return true;
      })
      .map(g => {
        const actual = geneMap.get(g.gene);

        // Check if fold change was hallucinated or incorrect
        if (g.foldChange !== undefined && g.foldChange !== null) {
          if (typeof g.foldChange === 'number' && typeof actual.foldChange === 'number') {
            // Both are numbers - compare directly
            if (Math.abs(g.foldChange - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected FC for ${g.gene}: LLM=${g.foldChange.toFixed(2)} → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
          } else if (typeof g.foldChange !== 'number') {
            // LLM returned non-numeric value - try to parse it
            const parsedValue = parseFloat(g.foldChange);

            // Only warn if parsing failed OR parsed value differs from actual
            if (isNaN(parsedValue) || Math.abs(parsedValue - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected incorrect FC for ${g.gene}: LLM="${g.foldChange}" → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
            // Otherwise: value is correct, just wrong type - silently fix
          }
        }

        return {
          ...g,
          foldChange: actual.foldChange,
          pValue: actual.pValue
        };
      });

    // Calculate correct quantitativeStats from ground truth data
    const actualStrongestUp = upregulated.length > 0 ? upregulated[0] : null;
    const actualStrongestDown = downregulated.length > 0 ? downregulated[0] : null;
    const actualMostSignificantPathway = topPathways.length > 0 ? topPathways[0] : null;

    const correctedStats = {
      totalUpregulated: upregulated.length,
      totalDownregulated: downregulated.length,
      strongestUpregulated: actualStrongestUp ? {
        gene: actualStrongestUp.name || actualStrongestUp.gene || actualStrongestUp.geneName,
        foldChange: actualStrongestUp.foldChange
      } : null,
      strongestDownregulated: actualStrongestDown ? {
        gene: actualStrongestDown.name || actualStrongestDown.gene || actualStrongestDown.geneName,
        foldChange: actualStrongestDown.foldChange
      } : null,
      mostSignificantPathway: actualMostSignificantPathway ? {
        name: actualMostSignificantPathway.name || actualMostSignificantPathway.pathwayName,
        pValue: actualMostSignificantPathway.pValue
      } : null
    };

    if (correctedValues > 0 || directionErrors > 0) {
      console.warn(`  ⚠️ Quantitative validation: ${correctedValues} value correction(s), ${directionErrors} direction error(s)`);
    }

    return {
      ...result,
      keyPathways: enrichedKeyPathways,
      genePatterns: {
        upregulated: enrichedUpregulated,
        downregulated: enrichedDownregulated
      },
      quantitativeStats: correctedStats
    };
  }

  /**
   * Generate Executive Summary report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result) {
    let section = '## Executive Summary\n\n';

    // Use the fact-checked interpretation (has citations from fact-checking API)
    if (result.interpretation) {
      let cleanInterpretation = this._cleanSectionMarkers(result.interpretation);

      // Remove embedded "Key Biological Themes:" section (it's formatted separately below)
      cleanInterpretation = cleanInterpretation.replace(/Key Biological Themes:[\s\S]*?(?=\n\n|Quantitative Summary:|$)/i, '').trim();

      // Remove bullet-point lists that may have been added during fact-checking
      // Pattern: lines starting with "- " or standalone gene/pathway bullets
      cleanInterpretation = cleanInterpretation.replace(/^[\s\-\•]+[A-Z][^\n]*?(\[[\d,\s]+\])?\.?\s*$/gm, '').trim();

      // Remove redundant standalone sentences (e.g., "SLC2A4 glucose transporter is up-regulated...")
      // These are often repetitions of what's already in the main paragraph
      // Pattern: Short standalone sentences with citations at the end
      cleanInterpretation = cleanInterpretation.replace(/^[A-Z][A-Z0-9]+\s+[^\n]{10,80}\s+\[[\d,\s]+\]\.\s*$/gm, '').trim();

      // Remove leading ** artifacts
      cleanInterpretation = cleanInterpretation.replace(/^\*\*\s*\n/, '').trim();

      // Remove horizontal rules that may have been added as separators
      cleanInterpretation = cleanInterpretation.replace(/^[\-\*_]{3,}\s*$/gm, '').trim();

      // Clean up multiple blank lines
      cleanInterpretation = cleanInterpretation.replace(/\n\n\n+/g, '\n\n');

      // Remove redundant paragraphs by checking for semantic similarity
      // Keep only the first substantial paragraph (usually the most complete)
      const paragraphs = cleanInterpretation.split('\n\n').filter(p => p.trim().length > 50);
      if (paragraphs.length > 0) {
        // Take the first paragraph which is usually the most comprehensive with citations
        cleanInterpretation = paragraphs[0];
      }

      if (cleanInterpretation) {
        section += cleanInterpretation + '\n\n';
      }
    }

    // Add main themes as bullet points
    if (result.mainThemes && result.mainThemes.length > 0) {
      section += '**Key Biological Themes:**\n';
      result.mainThemes.forEach(theme => {
        section += `- ${theme}\n`;
      });
      section += '\n';
    }

    // Add quantitative highlights
    if (result.quantitativeStats) {
      const stats = result.quantitativeStats;
      section += '**Quantitative Summary:**\n';
      section += `- Total upregulated genes: ${stats.totalUpregulated}\n`;
      section += `- Total downregulated genes: ${stats.totalDownregulated}\n`;

      if (stats.strongestUpregulated) {
        section += `- Strongest upregulation: **${stats.strongestUpregulated.gene}** (FC = ${stats.strongestUpregulated.foldChange.toFixed(2)})\n`;
      }

      if (stats.strongestDownregulated) {
        section += `- Strongest downregulation: **${stats.strongestDownregulated.gene}** (FC = ${stats.strongestDownregulated.foldChange.toFixed(2)})\n`;
      }

      if (stats.mostSignificantPathway) {
        section += `- Most significant pathway: **${stats.mostSignificantPathway.name}** (p = ${stats.mostSignificantPathway.pValue.toExponential(2)})\n`;
      }

      section += '\n';
    }

    return section;
  }
}

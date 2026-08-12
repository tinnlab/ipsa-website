// Step 3: Gene-Level Analysis
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step03_GeneAnalysis extends BaseStep {
  constructor() {
    super(3, 'Gene-Level Analysis', [1, 2]);

    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: WorkflowConfig.llm.temperature,
      maxTokens: WorkflowConfig.llm.maxTokens
    });

    this.factChecker = new FactCheckingService();
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);

    const { genes = [] } = input;
    const themes = this.getPreviousStepOutput(context, 2);

    // Categorize genes by fold change (use all genes provided by user's selection)
    const upregulated = genes
      .filter(g => g.foldChange > 0)
      .sort((a, b) => b.foldChange - a.foldChange);

    const downregulated = genes
      .filter(g => g.foldChange < 0)
      .sort((a, b) => a.foldChange - b.foldChange);

    console.log(`  Using ${upregulated.length} upregulated and ${downregulated.length} downregulated genes (user's selection from UI)`);

    const systemPrompt = `You are a molecular biology expert analyzing gene expression data.

CRITICAL REQUIREMENTS:
- Use EXACT gene symbols from the data with their QUANTITATIVE values
- ALWAYS include fold changes: "GENE_NAME (+X.X-fold)" or "GENE_NAME (-X.X-fold)"
- Never use placeholder names like "GENE1", "GENE_SYMBOL", etc.
- Reference specific biological mechanisms and pathways
- Be publication-quality specific, not vague

CRITICAL - QUANTITATIVE ACCURACY:
- Use EXACT fold change values from the gene lists provided
- DO NOT round, approximate, or make up fold change values
- COPY the fold change number EXACTLY as shown in the input data
- Verify gene direction matches fold change sign (positive = up, negative = down)
- When citing a gene, copy its fold change EXACTLY as shown

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Analyze these differentially expressed genes in context of pathway themes:

**Pathway Themes:**
${themes?.themes?.map(t => `- ${t.name}: ${t.description}`).join('\n') || 'Not available'}

**Top Upregulated Genes:**
${upregulated.map(g => `- ${g.name || g.gene || g.geneName}: FC=${g.foldChange?.toFixed(2)}, p=${g.pValue?.toExponential(2)}`).join('\n')}

**Top Downregulated Genes:**
${downregulated.map(g => `- ${g.name || g.gene || g.geneName}: FC=${g.foldChange?.toFixed(2)}, p=${g.pValue?.toExponential(2)}`).join('\n')}

IMPORTANT: Select hub genes and regulators ONLY from the gene lists above. Use their EXACT symbols with fold changes as shown.

Identify from the genes listed above:
1. **Hub genes** (5-7 genes): Genes that likely play central roles in multiple pathways based on their known biology and expression changes
2. **Master regulators** (3-5 genes): Transcription factors or signaling molecules that likely control the pathway themes
3. **Novel candidates** (3-5 genes): Genes with strong expression changes that warrant further investigation

For each gene, provide:
- Biologically accurate descriptions based on established knowledge
- ALWAYS include the fold change value from the data above
- Explain specific molecular mechanisms, not generic statements

Return JSON (WITH FOLD CHANGES INCLUDED):
{
  "hubGenes": [
    {
      "gene": "ACTUAL_GENE_SYMBOL",
      "foldChange": COPY_EXACT_FC_FROM_UPREGULATED_OR_DOWNREGULATED_GENES_SECTION,
      "role": "Known biological role of this specific gene with molecular details (2-3 sentences)",
      "relatedThemes": ["theme1", "theme2"],
      "direction": "up|down",
      "pathwayCount": estimated_number_of_pathways_this_gene_affects
    }
  ],
  "masterRegulators": [
    {
      "gene": "ACTUAL_GENE_SYMBOL",
      "foldChange": COPY_EXACT_FC_FROM_GENE_LIST_ABOVE,
      "mechanism": "Specific regulatory mechanism with transcriptional targets (2-3 sentences)",
      "targets": ["known target genes or pathways"],
      "regulationType": "transcriptional activator" | "transcriptional repressor" | "signaling kinase" | "other"
    }
  ],
  "novelCandidates": [
    {
      "gene": "GENE_SYMBOL",
      "foldChange": COPY_EXACT_FC_FROM_GENE_LIST_ABOVE,
      "rationale": "Why interesting for this context"
    }
  ],
  "interpretation": "Overall gene-level interpretation with specific genes and fold changes mentioned (4-5 sentences, cite at least 3 specific genes with their fold changes)"
}

CRITICAL: Copy fold change values EXACTLY from the gene lists above. Do not make up numbers or round values.`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate gene names against input (hallucination prevention)
      const validatedResult = this._validateHubGenes(result, genes);

      console.log(`  Hub genes: ${validatedResult.hubGenes?.length || 0}`);
      console.log(`  Master regulators: ${validatedResult.masterRegulators?.length || 0}`);

      // Conditionally fact-check all factual fields (interpretation, hubGenes roles, masterRegulators mechanisms)
      let finalResult = validatedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying gene analysis...');
        const { analyses = [] } = input;
        const experimentContext = this._extractExperimentContext(analyses);

        const factCheckContext = this.factChecker.extractContext(
          validatedResult, // Use validated result (after hallucination prevention)
          themes,
          experimentContext,
          analyses && analyses.length > 0 ? analyses[0].organismId : null,
          analyses && analyses.length > 0 ? analyses[0].id : null,
          analyses && analyses.length > 0 ? analyses[0].contextFields : null
        );

        const factCheckResult = await this.factChecker.factCheckAndRevise(
          validatedResult,
          factCheckContext,
          'Gene Analysis'
        );

        finalResult = factCheckResult.revisedResult;
        references = factCheckResult.references;
        factCheckStats = factCheckResult.stats;
      } else {
        console.log('  Fact-checking disabled - skipping verification');
      }

      // Generate report section for final report
      const reportSection = this._generateReportSection(finalResult);

      return {
        ...finalResult, // Includes interpretation, hub genes, master regulators
        references,
        factCheckStats,
        geneStats: {
          totalUpregulated: upregulated.length,
          totalDownregulated: downregulated.length
        },
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        hubGenes: upregulated.slice(0, 5).map(g => ({
          gene: g.name || g.gene || g.geneName,
          role: 'Hub gene (automated)',
          relatedThemes: [],
          direction: 'up'
        })),
        masterRegulators: [],
        novelCandidates: [],
        interpretation: 'Gene analysis encountered an error.',
        error: error.message
      };
    }
  }

  /**
   * Validate hub genes and master regulators against input gene list
   * Removes hallucinated gene names and enriches with actual fold changes
   */
  _validateHubGenes(result, inputGenes) {
    // Create gene map with actual quantitative data
    const geneMap = new Map();
    inputGenes.forEach(gene => {
      const geneName = gene.name || gene.gene || gene.geneName;
      if (geneName && gene.foldChange !== undefined && gene.foldChange !== null) {
        geneMap.set(geneName, {
          foldChange: gene.foldChange,
          pValue: gene.pValue,
          direction: gene.foldChange > 0 ? 'up' : 'down'
        });
      }
    });

    let totalInput = 0;
    let totalValid = 0;
    let totalHallucinated = 0;
    let correctedValues = 0;

    // Validate and enrich hub genes
    const validHubGenes = (result.hubGenes || [])
      .filter(hubGene => {
        totalInput++;
        const geneName = hubGene.gene;

        if (!geneMap.has(geneName)) {
          totalHallucinated++;
          console.warn(`    ⚠️ Removed hallucinated hub gene: "${geneName}"`);
          return false;
        }

        totalValid++;
        return true;
      })
      .map(hubGene => {
        const actual = geneMap.get(hubGene.gene);

        // Check if fold change was hallucinated or incorrect
        if (hubGene.foldChange !== undefined && hubGene.foldChange !== null) {
          if (typeof hubGene.foldChange === 'number' && typeof actual.foldChange === 'number') {
            // Both are numbers - compare directly
            if (Math.abs(hubGene.foldChange - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected FC for ${hubGene.gene}: LLM=${hubGene.foldChange.toFixed(2)} → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
          } else if (typeof hubGene.foldChange !== 'number') {
            // LLM returned non-numeric value - try to parse it
            const parsedValue = parseFloat(hubGene.foldChange);

            // Only warn if parsing failed OR parsed value differs from actual
            if (isNaN(parsedValue) || Math.abs(parsedValue - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected incorrect FC for ${hubGene.gene}: LLM="${hubGene.foldChange}" → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
            // Otherwise: value is correct, just wrong type - silently fix
          }
        }

        return {
          ...hubGene,
          foldChange: actual.foldChange,
          pValue: actual.pValue,
          direction: actual.direction
        };
      });

    // Validate and enrich master regulators
    const validMasterRegulators = (result.masterRegulators || [])
      .filter(reg => {
        totalInput++;
        const geneName = reg.gene;

        if (!geneMap.has(geneName)) {
          totalHallucinated++;
          console.warn(`    ⚠️ Removed hallucinated master regulator: "${geneName}"`);
          return false;
        }

        totalValid++;
        return true;
      })
      .map(reg => {
        const actual = geneMap.get(reg.gene);

        // Check if fold change was hallucinated or incorrect
        if (reg.foldChange !== undefined && reg.foldChange !== null) {
          if (typeof reg.foldChange === 'number' && typeof actual.foldChange === 'number') {
            // Both are numbers - compare directly
            if (Math.abs(reg.foldChange - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected FC for ${reg.gene}: LLM=${reg.foldChange.toFixed(2)} → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
          } else if (typeof reg.foldChange !== 'number') {
            // LLM returned non-numeric value - try to parse it
            const parsedValue = parseFloat(reg.foldChange);

            // Only warn if parsing failed OR parsed value differs from actual
            if (isNaN(parsedValue) || Math.abs(parsedValue - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected incorrect FC for ${reg.gene}: LLM="${reg.foldChange}" → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
            // Otherwise: value is correct, just wrong type - silently fix
          }
        }

        return {
          ...reg,
          foldChange: actual.foldChange,
          pValue: actual.pValue
        };
      });

    // Validate and enrich novel candidates
    const validNovelCandidates = (result.novelCandidates || [])
      .filter(candidate => {
        totalInput++;
        const geneName = candidate.gene;

        if (!geneMap.has(geneName)) {
          totalHallucinated++;
          console.warn(`    ⚠️ Removed hallucinated novel candidate: "${geneName}"`);
          return false;
        }

        totalValid++;
        return true;
      })
      .map(candidate => {
        const actual = geneMap.get(candidate.gene);

        // Check if fold change was hallucinated or incorrect
        if (candidate.foldChange !== undefined && candidate.foldChange !== null) {
          if (typeof candidate.foldChange === 'number' && typeof actual.foldChange === 'number') {
            // Both are numbers - compare directly
            if (Math.abs(candidate.foldChange - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected FC for ${candidate.gene}: LLM=${candidate.foldChange.toFixed(2)} → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
          } else if (typeof candidate.foldChange !== 'number') {
            // LLM returned non-numeric value - try to parse it
            const parsedValue = parseFloat(candidate.foldChange);

            // Only warn if parsing failed OR parsed value differs from actual
            if (isNaN(parsedValue) || Math.abs(parsedValue - actual.foldChange) > 0.01) {
              console.warn(`    ⚠️ Corrected incorrect FC for ${candidate.gene}: LLM="${candidate.foldChange}" → Actual=${actual.foldChange.toFixed(2)}`);
              correctedValues++;
            }
            // Otherwise: value is correct, just wrong type - silently fix
          }
        }

        return {
          ...candidate,
          foldChange: actual.foldChange,
          pValue: actual.pValue
        };
      });

    console.log(`  Gene validation: ${totalValid}/${totalInput} valid`);
    if (totalHallucinated > 0) {
      console.warn(`  ⚠️ Removed ${totalHallucinated} hallucinated gene name(s)`);
    }
    if (correctedValues > 0) {
      console.warn(`  ⚠️ Corrected ${correctedValues} quantitative value(s)`);
    }

    return {
      ...result,
      hubGenes: validHubGenes,
      masterRegulators: validMasterRegulators,
      novelCandidates: validNovelCandidates,
      validation: {
        totalInput,
        totalValid,
        totalHallucinated,
        correctedValues,
        hallucinationRate: totalInput > 0 ? (totalHallucinated / totalInput * 100).toFixed(1) : 0
      }
    };
  }

  /**
   * Generate Hub Gene Analysis report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result) {
    let section = '## 3. Hub Gene Analysis\n\n';

    // Add interpretation if available (has citations from fact-checking)
    if (result.interpretation) {
      let cleanInterpretation = this._cleanSectionMarkers(result.interpretation);

      // Remove gene definition blocks (format: "GENE: description")
      // These are often added by fact-checker but are redundant with the tables below
      cleanInterpretation = cleanInterpretation.replace(/^[A-Z][A-Z0-9]+:\s+[^\n]+(\[[\d,\s]+\])?\s*$/gm, '').trim();

      // Remove leading ** artifacts
      cleanInterpretation = cleanInterpretation.replace(/^\*\*\s*\n/, '').trim();

      // Remove horizontal rules
      cleanInterpretation = cleanInterpretation.replace(/^[\-\*_]{3,}\s*$/gm, '').trim();

      // Clean up multiple blank lines
      cleanInterpretation = cleanInterpretation.replace(/\n\n\n+/g, '\n\n');

      // Keep only the first substantial paragraph
      const paragraphs = cleanInterpretation.split('\n\n').filter(p => p.trim().length > 50);
      if (paragraphs.length > 0) {
        cleanInterpretation = paragraphs[0];
      }

      if (cleanInterpretation) {
        section += cleanInterpretation + '\n\n';
      }
    }

    // Master Regulators table
    if (result.masterRegulators && result.masterRegulators.length > 0) {
      section += '### Master Regulators\n\n';
      section += '| Gene | Fold Change | Role/Mechanism | Direction |\n';
      section += '|------|-------------|----------------|-----------|\n';

      result.masterRegulators.forEach(m => {
        const fc = m.foldChange ? m.foldChange.toFixed(2) : 'N/A';
        const direction = m.foldChange > 0 ? '↑ Up' : '↓ Down';
        // Mechanism has citations from fact-checking
        section += `| **${m.gene}** | ${fc} | ${m.mechanism} | ${direction} |\n`;
      });

      section += '\n';
    }

    // Hub Genes table
    if (result.hubGenes && result.hubGenes.length > 0) {
      section += '### Hub Genes\n\n';
      section += '| Gene | Fold Change | Role | Pathways |\n';
      section += '|------|-------------|------|----------|\n';

      result.hubGenes.forEach(h => {
        const fc = h.foldChange ? h.foldChange.toFixed(2) : 'N/A';
        const pathways = h.relatedThemes ? h.relatedThemes.slice(0, 2).join(', ') : 'N/A';
        // Role has citations from fact-checking
        section += `| **${h.gene}** | ${fc} | ${h.role} | ${pathways} |\n`;
      });

      section += '\n';
    }

    // Novel Candidates
    if (result.novelCandidates && result.novelCandidates.length > 0) {
      section += '### Novel Candidate Genes\n\n';

      result.novelCandidates.forEach(n => {
        const fc = n.foldChange ? n.foldChange.toFixed(2) : 'N/A';
        section += `- **${n.gene}** (FC = ${fc}): ${n.rationale}\n`;
      });

      section += '\n';
    }

    return section;
  }
}

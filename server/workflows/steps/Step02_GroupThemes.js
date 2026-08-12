// Step 2: Group Pathways into Themes
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step02_GroupThemes extends BaseStep {
  constructor() {
    super(2, 'Group Pathways into Themes', [1]);

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
    const summary = this.getPreviousStepOutput(context, 1);

    // Extract experimental context
    const experimentContext = this._extractExperimentContext(analyses);

    // Filter to statistically significant pathways only (FDR < threshold)
    const significanceThreshold = WorkflowConfig.pathwayAnalysis?.significanceThreshold || 0.05;

    console.log(`  Input pathways from UI: ${pathways.length}`);

    const topPathways = pathways
      .filter(p => {
        // Must have valid pValue and pValueFDR
        if (p.pValue === undefined || p.pValue === null) return false;
        if (p.pValueFDR === undefined || p.pValueFDR === null) return false;

        // Must be statistically significant
        return p.pValueFDR < significanceThreshold;
      })
      .sort((a, b) => a.pValue - b.pValue);

    console.log(`  Significant pathways (FDR < ${significanceThreshold}): ${topPathways.length}`);

    if (pathways.length > topPathways.length) {
      const filtered = pathways.length - topPathways.length;
      console.log(`  ⚠️  Filtered out ${filtered} non-significant pathway${filtered > 1 ? 's' : ''}`);
    }

    if (topPathways.length === 0) {
      console.warn(`  ⚠️  No significant pathways available for theme grouping`);
      return {
        themes: [],
        ungrouped: [],
        themesSummary: 'No statistically significant pathways available for theme grouping.'
      };
    }

    const systemPrompt = `You are a bioinformatics expert. Group related pathways into coherent biological themes to reduce redundancy.

${experimentContext ? `Consider tissue/disease-specific biological processes relevant to: ${experimentContext}` : ''}

CRITICAL: Create MEANINGFUL pathway groupings:
- Group pathways based on actual biological relationships
- Use clear, specific theme names (not vague categories)
- Provide informative descriptions explaining the biological significance
- Consider molecular mechanisms and functional relationships

IMPORTANT - Theme naming based on BIOLOGICAL PROCESSES, not pathway names:
1. **Don't use disease names as themes** - Pathway databases name pathways after diseases, but that doesn't mean literal disease overlap
2. **Identify the underlying biological process** - What molecular mechanisms do these pathways share?
   - Examples: "Mitochondrial Dysfunction", "Protein Quality Control", "Cell Cycle Dysregulation", "Immune Activation"
   - NOT: "Neurodegenerative Diseases", "Viral Infections", "Bacterial Pathogenesis"
3. **Explain pathway name vs biological meaning**:

   - Good: "Mitochondrial Dysfunction & Oxidative Stress (includes 'Alzheimer disease', 'Parkinson disease' pathways due to shared OXPHOS defects)"
   - Bad: "Neurodegenerative Diseases (Alzheimer, Parkinson)"
4. **Use genes/enrichment to guide themes** - If pathways share many genes or biological functions, group them
5. **Context-appropriate interpretation** - Consider what makes sense for ${experimentContext || 'this biological system'}

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Group these pathways into biological themes:

${experimentContext ? `**Experimental Context:**
${experimentContext}

Group pathways based on their relevance to this tissue/disease context.
` : ''}

**Main Themes from Summary:**
${summary?.mainThemes?.join(', ') || 'Not available'}

**Pathways to Group (ONLY use these exact names in your response):**
${topPathways.map((p, idx) => `${idx + 1}. ${p.name || p.pathwayName}`).join('\n')}

CRITICAL INSTRUCTIONS:
- ONLY return pathway names from the list above
- DO NOT add pathway names that aren't in the list
- DO NOT modify pathway names
- Use the EXACT pathway name strings as shown above

Group pathways that represent:
- Similar biological processes${experimentContext ? ` relevant to ${experimentContext}` : ''}
- Related molecular mechanisms${experimentContext ? ` in this tissue/disease` : ''}
- Overlapping gene sets${experimentContext ? ` with context-specific functions` : ''}
- Hierarchical relationships (e.g., "immune response" contains "T-cell activation")${experimentContext ? ` prioritizing tissue/disease-specific themes` : ''}

Return JSON with pathway names ONLY (metadata will be added programmatically):
{
  "themes": [
    {
      "name": "Theme name (biological process, not disease name)",
      "description": "Brief description with biological significance (2-3 sentences)",
      "pathways": ["exact pathway name 1", "exact pathway name 2"],
      "significance": "high|medium|low",
      "keyGenes": ["mention a few driving genes if known from summary"]
    }
  ],
  "ungrouped": ["pathway name", "pathway name"],
  "themesSummary": "Brief summary of how themes relate to experimental context (2-3 sentences)"
}

Aim for 3-7 themes. DO NOT include pValue or database in pathways array - just the pathway name strings.`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      console.log(`  Themes identified (before validation): ${result.themes?.length || 0}`);

      // Validate and enrich LLM output with actual pathway metadata and keyGenes
      const validatedResult = this._validateAndEnrichThemes(result, topPathways, genes);

      console.log(`  Themes after validation: ${validatedResult.themes?.length || 0}`);

      // Conditionally fact-check theme-pathway groupings and keyGenes
      let finalResult = validatedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying themes...');
        console.log('  DEBUG Step02 - analyses[0]:', JSON.stringify(analyses && analyses.length > 0 ? analyses[0] : null, null, 2));

        const factCheckContext = this.factChecker.extractContext(
          null, // No gene analysis yet (Step 3 comes later)
          validatedResult, // The validated themes with pathways and keyGenes
          experimentContext,
          analyses && analyses.length > 0 ? analyses[0].organismId : null,
          analyses && analyses.length > 0 ? analyses[0].id : null,
          analyses && analyses.length > 0 ? analyses[0].contextFields : null
        );

        const factCheckResult = await this.factChecker.factCheckAndRevise(
          validatedResult,
          factCheckContext,
          'Group Themes'
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
        themes: finalResult.themes,
        ungrouped: finalResult.ungrouped,
        themesSummary: finalResult.themesSummary,
        validation: validatedResult.validation,
        references,
        factCheckStats,
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        themes: [{
          name: 'All Pathways',
          description: 'Unable to group pathways due to error',
          pathways: topPathways.slice(0, 10).map(p => ({
            name: p.name || p.pathwayName,
            pValue: p.pValue,
            pValueFDR: p.pValueFDR,
            database: p.database
          })),
          significance: 'medium'
        }],
        ungrouped: [],
        error: error.message
      };
    }
  }

  /**
   * Normalize pathway name by removing database suffixes
   * E.g., "MAPK signaling pathway (KEGG)" -> "MAPK signaling pathway"
   */
  _normalizePathwayName(pathwayName) {
    if (!pathwayName) return '';

    // Remove database suffixes: (KEGG), (Reactome), (WikiPathways), (BioCarta), (PID), etc.
    return pathwayName
      .replace(/\s*\([^)]*\)\s*$/g, '') // Remove anything in parentheses at the end
      .trim();
  }

  /**
   * Validate LLM output and enrich with actual pathway metadata
   * Removes hallucinated pathway names and keyGenes, adds correct pValue/database
   */
  _validateAndEnrichThemes(result, topPathways, genes) {
    // Create pathway lookup map for validation (with normalized names as keys)
    const pathwayMap = new Map();
    const normalizedToOriginal = new Map();

    topPathways.forEach(p => {
      const name = p.name || p.pathwayName;
      const normalized = this._normalizePathwayName(name);
      pathwayMap.set(normalized, p);
      normalizedToOriginal.set(normalized, name);
    });

    // Create DE gene set for keyGenes validation
    const deGeneSet = new Set();
    (genes || []).forEach(gene => {
      const geneName = gene.name || gene.gene || gene.geneName;
      if (geneName) {
        deGeneSet.add(geneName);
      }
    });

    let totalPathwaysInput = 0;
    let totalPathwaysValid = 0;
    let totalHallucinated = 0;

    // Validate and enrich each theme
    const validatedThemes = (result.themes || []).map(theme => {
      const inputPathways = theme.pathways || [];
      totalPathwaysInput += inputPathways.length;

      // Filter to only pathways that exist in input and enrich with metadata
      const validPathways = inputPathways
        .filter(pathwayName => {
          const normalized = this._normalizePathwayName(pathwayName);
          const exists = pathwayMap.has(normalized);
          if (!exists) {
            totalHallucinated++;
            console.warn(`    ⚠️ Removed hallucinated pathway: "${pathwayName}"`);
          }
          return exists;
        })
        .map(pathwayName => {
          const normalized = this._normalizePathwayName(pathwayName);
          const pathway = pathwayMap.get(normalized);
          totalPathwaysValid++;
          return {
            name: pathway.name || pathway.pathwayName,
            pValue: pathway.pValue,
            pValueFDR: pathway.pValueFDR,
            database: pathway.database
          };
        });

      // Validate keyGenes against DE genes
      const validKeyGenes = this._validateKeyGenes(theme.keyGenes, validPathways, deGeneSet);

      return {
        ...theme,
        pathways: validPathways,
        keyGenes: validKeyGenes
      };
    });

    // Filter out themes with no valid pathways
    const themesWithPathways = validatedThemes.filter(t => t.pathways.length > 0);

    // Validate ungrouped pathways
    const validUngrouped = (result.ungrouped || [])
      .filter(pathwayName => {
        const exists = pathwayMap.has(pathwayName);
        if (!exists) {
          totalHallucinated++;
          console.warn(`    ⚠️ Removed hallucinated ungrouped pathway: "${pathwayName}"`);
        }
        return exists;
      })
      .map(pathwayName => {
        const pathway = pathwayMap.get(pathwayName);
        return {
          name: pathway.name || pathway.pathwayName,
          pValue: pathway.pValue,
          pValueFDR: pathway.pValueFDR,
          database: pathway.database,
          reason: 'Ungrouped by LLM'
        };
      });

    // Log validation statistics
    console.log(`  Validation stats: ${totalPathwaysValid}/${totalPathwaysInput} pathways valid`);
    if (totalHallucinated > 0) {
      console.warn(`  ⚠️ Removed ${totalHallucinated} hallucinated pathway name${totalHallucinated > 1 ? 's' : ''}`);
    }

    return {
      themes: themesWithPathways,
      ungrouped: validUngrouped,
      themesSummary: result.themesSummary || '',
      validation: {
        totalInput: totalPathwaysInput,
        totalValid: totalPathwaysValid,
        totalHallucinated: totalHallucinated,
        hallucinationRate: totalPathwaysInput > 0 ? (totalHallucinated / totalPathwaysInput * 100).toFixed(1) : 0
      }
    };
  }

  /**
   * Validate keyGenes against DE genes and pathway membership
   * @param {Array<string>} keyGenes - LLM-suggested key genes
   * @param {Array<object>} themePathways - Pathways in this theme
   * @param {Set<string>} deGeneSet - Set of all DE gene names
   * @returns {Array<string>} Validated key genes
   */
  _validateKeyGenes(keyGenes, themePathways, deGeneSet) {
    if (!keyGenes || !Array.isArray(keyGenes)) {
      return [];
    }

    let totalInput = keyGenes.length;
    let totalValid = 0;
    let totalHallucinated = 0;

    const validGenes = keyGenes.filter(geneName => {
      const gene = geneName.trim();

      // Check 1: Gene must exist in DE gene list
      if (!deGeneSet.has(gene)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated keyGene: "${gene}" (not in DE genes)`);
        return false;
      }

      // Check 2: Gene should appear in at least one pathway in this theme
      // Note: This requires pathway objects to have gene membership data
      // If not available, skip this check
      const appearsInPathway = themePathways.some(pathway => {
        if (pathway.genes && Array.isArray(pathway.genes)) {
          return pathway.genes.some(pg => {
            const pgName = typeof pg === 'string' ? pg : (pg.name || pg.gene);
            return pgName === gene;
          });
        }
        return true; // If no gene data, allow it through Check 1
      });

      if (!appearsInPathway) {
        console.warn(`    ⚠️ Warning: keyGene "${gene}" not found in theme's pathways`);
        // Still allow it, but log warning
      }

      totalValid++;
      return true;
    });

    if (totalInput > 0) {
      console.log(`    KeyGenes validation: ${totalValid}/${totalInput} valid`);
    }

    return validGenes;
  }

  /**
   * Generate Major Biological Themes report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result) {
    let section = '## 1. Major Biological Themes\n\n';

    // Add themes summary if available (has citations from fact-checking)
    if (result.themesSummary) {
      // Clean section markers and remove intermediate theme formatting
      let cleanSummary = this._cleanSectionMarkers(result.themesSummary);

      // Remove intermediate theme blocks (they're formatted separately below)
      // These look like: "Theme: X\nDescription: Y\nPathways grouped together:"
      cleanSummary = cleanSummary.replace(/Theme:\s+[^\n]+\n(Description:[^\n]*\n)?Pathways grouped together:[^\n]*/g, '').trim();

      // Remove leading ** artifacts
      cleanSummary = cleanSummary.replace(/^\*\*\s*\n/, '').trim();

      // Remove horizontal rules
      cleanSummary = cleanSummary.replace(/^[\-\*_]{3,}\s*$/gm, '').trim();

      // Final cleanup of multiple blank lines
      cleanSummary = cleanSummary.replace(/\n\n\n+/g, '\n\n');

      if (cleanSummary) {
        section += cleanSummary + '\n\n';
      }
    }

    // Format each theme
    if (result.themes && result.themes.length > 0) {
      result.themes.forEach((theme, index) => {
        // Theme heading with significance indicator
        const priority = theme.significance === 'high' ? '⭐⭐⭐' :
                        theme.significance === 'medium' ? '⭐⭐' : '⭐';
        section += `### Theme ${index + 1}: ${theme.name} ${priority}\n\n`;

        // Description (has citations from fact-checking)
        if (theme.description) {
          section += `${this._cleanSectionMarkers(theme.description)}\n\n`;
        }

        // Pathway table
        if (theme.pathways && theme.pathways.length > 0) {
          section += '**Pathways:**\n\n';
          section += '| Pathway | FDR | Database |\n';
          section += '|---------|-----|----------|\n';

          theme.pathways.forEach(p => {
            const pathwayName = typeof p === 'string' ? p : (p.name || p.pathwayName);
            const fdr = p.pValueFDR ? p.pValueFDR.toExponential(2) : 'N/A';
            const database = p.database || 'Unknown';
            section += `| ${pathwayName} | ${fdr} | ${database} |\n`;
          });

          section += '\n';
        }

        // Key genes
        if (theme.keyGenes && theme.keyGenes.length > 0) {
          section += `**Key Driver Genes:** ${theme.keyGenes.join(', ')}\n\n`;
        }

        section += '---\n\n';
      });
    }

    return section;
  }
}

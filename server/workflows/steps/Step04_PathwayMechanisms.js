// Step 4: Explain Pathway Mechanisms and Interactions
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step04_PathwayMechanisms extends BaseStep {
  constructor() {
    super(4, 'Pathway Mechanisms and Interactions', [2, 3]);

    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: WorkflowConfig.llm.temperature,
      maxTokens: WorkflowConfig.llm.maxTokens
    });

    this.factChecker = new FactCheckingService();
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);

    const themes = this.getPreviousStepOutput(context, 2);
    const geneAnalysis = this.getPreviousStepOutput(context, 3);

    const { pathways = [], genes = [] } = input;

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
      console.warn(`  ⚠️  No significant pathways available for mechanism analysis`);
      return {
        pathwayMechanisms: [],
        keyInteractions: [],
        mechanisticSummary: 'No statistically significant pathways available for mechanism analysis.',
        pathwayOverlaps: []
      };
    }

    // Calculate pathway overlaps based on shared DE genes (weighted by fold change)
    const hubGenes = geneAnalysis?.hubGenes || [];
    const pathwayOverlaps = this._calculatePathwayOverlaps(topPathways, hubGenes, genes);

    const minSharedGenes = WorkflowConfig.pathwayAnalysis?.minSharedGenes || 3;
    console.log(`  Calculated ${pathwayOverlaps.length} pathway overlaps (≥${minSharedGenes} shared DE genes)`);
    if (pathwayOverlaps.length > 0) {
      const strongOverlaps = pathwayOverlaps.filter(o => o.overlapStrength === 'strong').length;
      const moderateOverlaps = pathwayOverlaps.filter(o => o.overlapStrength === 'moderate').length;
      console.log(`  - Strong overlaps: ${strongOverlaps}, Moderate: ${moderateOverlaps}`);
      console.log(`  - Top weighted score: ${pathwayOverlaps[0].weightedOverlapScore.toFixed(2)}`);
    }

    const systemPrompt = `You are a molecular biology expert explaining pathway mechanisms and their interactions in detail.

CRITICAL: Include SPECIFIC molecular details:
- Name specific proteins and their interactions
- Describe actual biochemical mechanisms
- Reference specific genes from the data with their roles
- USE THE PROVIDED PATHWAY GENE OVERLAPS DATA - this shows quantitative evidence of crosstalk
- When explaining crosstalk, cite the SPECIFIC SHARED GENES (especially hub genes) that connect pathways
- Explain quantitative crosstalk (e.g., "pathways share 8 genes including hub genes TP53, MYC")
- Be concrete and mechanistic, not vague

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Explain the biological mechanisms and interactions of these enriched pathways:

**Pathway Themes:**
${themes?.themes?.map(t => `- **${t.name}**: ${t.description}\n  Pathways: ${t.pathways?.slice(0, 5).join(', ')}`).join('\n\n') || 'Not available'}

**Hub Genes:**
${geneAnalysis?.hubGenes?.map(g => `- ${g.gene}: ${g.role}`).join('\n') || 'Not available'}

**Master Regulators:**
${geneAnalysis?.masterRegulators?.map(m => `- ${m.gene}: ${m.mechanism}`).join('\n') || 'Not available'}

**Top Enriched Pathways:**
${topPathways.map((p, i) => `${i+1}. ${p.name || p.pathwayName} (${p.database || 'unknown'})`).join('\n')}

**PATHWAY GENE OVERLAPS (Data-Driven Crosstalk Evidence - FILTERED TO DE GENES ONLY):**
${pathwayOverlaps.length > 0 ?
  pathwayOverlaps.slice(0, 15).map(overlap => {
    const hubGenesList = overlap.sharedHubGenes.length > 0
      ? ` [Hub genes: ${overlap.sharedHubGenes.slice(0, 5).join(', ')}${overlap.sharedHubGenes.length > 5 ? '...' : ''}]`
      : '';
    return `- **${overlap.pathway1}** ↔ **${overlap.pathway2}**: ${overlap.sharedGenesCount} shared DE genes (${overlap.overlapStrength} overlap, weighted score: ${overlap.weightedOverlapScore.toFixed(1)})${hubGenesList}`;
  }).join('\n')
  : 'No significant overlaps detected'}

**INTERPRETATION GUIDANCE:**
- These overlaps are based on DIFFERENTIALLY EXPRESSED genes only, not all pathway genes
- Weighted score = sum of absolute fold changes of shared genes (higher = more biologically important)
- Pathways sharing ≥10 DE genes OR ≥3 hub genes OR weighted score ≥15 have STRONG molecular crosstalk
- Pathways sharing 5-9 DE genes OR 2 hub genes OR weighted score 8-14 have MODERATE crosstalk
- Shared hub genes are especially important - they are convergence points between pathways
- High weighted scores indicate the overlap involves genes with large expression changes
- Use this quantitative overlap data to identify which pathways interact

For the top 5-7 most important pathways, provide:
1. **Biological function**: What does this pathway do?
2. **Crosstalk**: How does it interact with other enriched pathways? USE THE PATHWAY GENE OVERLAPS DATA ABOVE - cite specific shared genes (especially hub genes) when explaining crosstalk between pathways.
3. **Upstream regulators**: What activates/suppresses it?
4. **Downstream effects**: What are its biological consequences?
5. **Hub gene involvement**: How do hub genes participate?

Return JSON:
{
  "pathwayMechanisms": [
    {
      "pathway": "pathway name",
      "biologicalFunction": "What it does (2-3 sentences)",
      "crosstalk": ["interacts with pathway X through...", "regulated by pathway Y..."],
      "upstreamRegulators": ["regulator1", "regulator2"],
      "downstreamEffects": ["effect1", "effect2"],
      "hubGeneRoles": ["gene1 acts as...", "gene2 controls..."]
    }
  ],
  "keyInteractions": [
    {
      "pathway1": "name",
      "pathway2": "name",
      "interactionType": "activates" | "inhibits" | "regulates" | "crosstalk",
      "mechanism": "How they interact (1-2 sentences)"
    }
  ],
  "mechanisticSummary": "Overall mechanistic overview (4-5 sentences)"
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate pathway names against Step 2 themes (hallucination prevention)
      const validatedResult = this._validateMechanisms(result, themes);

      console.log(`  Pathway Mechanisms Explained: ${validatedResult.pathwayMechanisms?.length || 0}`);
      console.log(`  Interactions Identified: ${validatedResult.keyInteractions?.length || 0}`);

      // Conditionally fact-check all factual fields (mechanisticSummary, pathwayMechanisms details)
      let finalResult = validatedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying pathway mechanisms...');
        const { analyses = [] } = input;
        const experimentContext = this._extractExperimentContext(analyses);

        const factCheckContext = this.factChecker.extractContext(
          geneAnalysis,
          themes,
          experimentContext,
          analyses && analyses.length > 0 ? analyses[0].organismId : null,
          analyses && analyses.length > 0 ? analyses[0].id : null,
          analyses && analyses.length > 0 ? analyses[0].contextFields : null
        );

        const factCheckResult = await this.factChecker.factCheckAndRevise(
          validatedResult,
          factCheckContext,
          'Pathway Mechanisms'
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
        ...finalResult, // Includes mechanisticSummary and pathwayMechanisms
        references,
        factCheckStats,
        pathwayOverlaps: pathwayOverlaps, // Include calculated overlaps for downstream use
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        pathwayMechanisms: [],
        keyInteractions: [],
        mechanisticSummary: `Mechanism analysis could not be completed: ${error.message}`,
        pathwayOverlaps: pathwayOverlaps || []
      };
    }
  }

  _calculatePathwayOverlaps(pathways, hubGenes, deGenes) {
    // Create a set of hub gene names for fast lookup
    const hubGeneSet = new Set(hubGenes.map(hg => hg.gene));

    // Create Map of DE gene symbol → fold change for weighted scoring
    // Also create gene ID → symbol mapping for pathway gene conversion
    const deGeneMap = new Map();
    const deGeneSet = new Set();
    const geneIdToSymbol = new Map();

    deGenes.forEach(gene => {
      const symbol = gene.name || gene.gene || gene.geneName;
      if (symbol && gene.foldChange !== undefined) {
        deGeneMap.set(symbol, gene.foldChange);
        deGeneSet.add(symbol);

        // Map gene ID to symbol (for converting pathway gene IDs)
        if (gene.id) {
          geneIdToSymbol.set(String(gene.id), symbol);
        }
      }
    });

    console.log(`  DE genes available for overlap: ${deGeneSet.size}`);
    console.log(`  Gene ID→Symbol mappings created: ${geneIdToSymbol.size}`);

    const overlaps = [];

    // Compare each pair of pathways
    for (let i = 0; i < pathways.length; i++) {
      for (let j = i + 1; j < pathways.length; j++) {
        const pathway1 = pathways[i];
        const pathway2 = pathways[j];

        // Get gene lists (handle both array and non-array cases)
        const allGenes1Raw = Array.isArray(pathway1.genes) ? pathway1.genes : [];
        const allGenes2Raw = Array.isArray(pathway2.genes) ? pathway2.genes : [];

        if (allGenes1Raw.length === 0 || allGenes2Raw.length === 0) {
          continue;
        }

        // Convert gene IDs to symbols (pathway genes might be IDs, not symbols)
        const allGenes1 = allGenes1Raw.map(g => {
          const gStr = String(g);
          return geneIdToSymbol.get(gStr) || g;
        });
        const allGenes2 = allGenes2Raw.map(g => {
          const gStr = String(g);
          return geneIdToSymbol.get(gStr) || g;
        });

        // FILTER TO DE GENES ONLY
        const genes1 = allGenes1.filter(g => deGeneSet.has(g));
        const genes2 = allGenes2.filter(g => deGeneSet.has(g));

        if (genes1.length === 0 || genes2.length === 0) {
          continue;
        }

        // Find shared DE genes
        const sharedGenes = genes1.filter(g => genes2.includes(g));

        // Skip if insufficient overlap (use configured minimum)
        const minSharedGenes = WorkflowConfig.pathwayAnalysis?.minSharedGenes || 3;
        if (sharedGenes.length < minSharedGenes) continue;

        // Identify which shared genes are hub genes
        const sharedHubGenes = sharedGenes.filter(g => hubGeneSet.has(g));

        // Calculate weighted overlap score based on fold changes
        const weightedScore = this._calculateWeightedOverlap(sharedGenes, deGeneMap);

        // Calculate overlap score (Jaccard coefficient on DE genes only)
        const union = new Set([...genes1, ...genes2]);
        const jaccardScore = sharedGenes.length / union.size;

        overlaps.push({
          pathway1: pathway1.name || pathway1.pathwayName,
          pathway2: pathway2.name || pathway2.pathwayName,
          sharedGenes: sharedGenes,
          sharedGenesCount: sharedGenes.length,
          sharedHubGenes: sharedHubGenes,
          sharedHubGenesCount: sharedHubGenes.length,
          pathway1TotalGenes: allGenes1Raw.length,
          pathway2TotalGenes: allGenes2Raw.length,
          pathway1DEGeneCount: genes1.length,
          pathway2DEGeneCount: genes2.length,
          jaccardScore: jaccardScore,
          weightedOverlapScore: weightedScore,
          overlapStrength: this._classifyOverlapStrength(
            sharedGenes.length,
            sharedHubGenes.length,
            weightedScore
          )
        });
      }
    }

    // Sort by weighted overlap score descending (prioritizes high fold-change genes)
    overlaps.sort((a, b) => b.weightedOverlapScore - a.weightedOverlapScore);

    return overlaps;
  }

  _calculateWeightedOverlap(sharedGenes, deGeneMap) {
    // Calculate weighted overlap score based on absolute fold changes
    // Higher fold changes indicate more biologically important genes
    let weightedSum = 0;
    let geneCount = 0;

    sharedGenes.forEach(gene => {
      const foldChange = deGeneMap.get(gene);
      if (foldChange !== undefined) {
        // Use absolute fold change as weight (both up and down are important)
        weightedSum += Math.abs(foldChange);
        geneCount++;
      }
    });

    // Return total weighted score (not normalized to allow comparison)
    return weightedSum;
  }

  _classifyOverlapStrength(sharedCount, sharedHubCount, weightedScore) {
    // Strong overlap if:
    // - Many shared genes (≥10) OR
    // - Multiple hub genes (≥3) OR
    // - High weighted score (≥15, indicating high fold-change genes)
    if (sharedCount >= 10 || sharedHubCount >= 3 || weightedScore >= 15) {
      return 'strong';
    }

    // Moderate overlap if:
    // - Moderate shared genes (5-9) OR
    // - Some hub genes (2) OR
    // - Moderate weighted score (8-14)
    if (sharedCount >= 5 || sharedHubCount >= 2 || weightedScore >= 8) {
      return 'moderate';
    }

    return 'weak';
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
   * Validate pathway names in mechanisms and interactions against Step 2 themes
   * Removes hallucinated pathway references
   */
  _validateMechanisms(result, validatedThemes) {
    // Create valid pathway set from Step 2 themes with normalized names
    const validPathwaySet = new Set();
    const normalizedPathwayMap = new Map(); // Maps normalized name -> original name

    (validatedThemes?.themes || []).forEach(theme => {
      (theme.pathways || []).forEach(pathway => {
        const pathwayName = typeof pathway === 'string' ? pathway : pathway.name;
        if (pathwayName) {
          const normalized = this._normalizePathwayName(pathwayName);
          validPathwaySet.add(normalized);
          normalizedPathwayMap.set(normalized, pathwayName);
        }
      });
    });

    // Also add ungrouped pathways
    (validatedThemes?.ungrouped || []).forEach(pathway => {
      const pathwayName = typeof pathway === 'string' ? pathway : pathway.name;
      if (pathwayName) {
        const normalized = this._normalizePathwayName(pathwayName);
        validPathwaySet.add(normalized);
        normalizedPathwayMap.set(normalized, pathwayName);
      }
    });

    let totalHallucinated = 0;

    // Validate pathway mechanisms
    const validMechanisms = (result.pathwayMechanisms || []).filter(mechanism => {
      const pathwayName = mechanism.pathway;
      const normalized = this._normalizePathwayName(pathwayName);

      if (!validPathwaySet.has(normalized)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed mechanism for hallucinated pathway: "${pathwayName}"`);
        return false;
      }

      return true;
    });

    // Validate pathway interactions
    const validInteractions = (result.keyInteractions || []).filter(interaction => {
      const pathway1 = interaction.pathway1;
      const pathway2 = interaction.pathway2;
      const normalized1 = this._normalizePathwayName(pathway1);
      const normalized2 = this._normalizePathwayName(pathway2);

      if (!validPathwaySet.has(normalized1) || !validPathwaySet.has(normalized2)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed interaction with hallucinated pathway: "${pathway1}" <-> "${pathway2}"`);
        return false;
      }

      return true;
    });

    if (totalHallucinated > 0) {
      console.warn(`  ⚠️ Removed ${totalHallucinated} hallucinated pathway reference(s)`);
    }

    return {
      ...result,
      pathwayMechanisms: validMechanisms,
      keyInteractions: validInteractions,
      validation: {
        totalHallucinated,
        validMechanismsCount: validMechanisms.length,
        validInteractionsCount: validInteractions.length
      }
    };
  }

  /**
   * Generate Pathway Mechanisms report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result) {
    let section = '## 2. Pathway Mechanisms and Crosstalk\n\n';

    // Add mechanistic summary (has citations from fact-checking)
    if (result.mechanisticSummary) {
      let cleanSummary = this._cleanSectionMarkers(result.mechanisticSummary);

      // Remove leading ** artifacts
      cleanSummary = cleanSummary.replace(/^\*\*\s*\n/, '').trim();

      // Remove horizontal rules
      cleanSummary = cleanSummary.replace(/^[\-\*_]{3,}\s*$/gm, '').trim();

      // Clean up multiple blank lines
      cleanSummary = cleanSummary.replace(/\n\n\n+/g, '\n\n');

      if (cleanSummary) {
        section += cleanSummary + '\n\n';
      }
    }

    // Detailed pathway mechanisms
    if (result.pathwayMechanisms && result.pathwayMechanisms.length > 0) {
      section += '### Detailed Pathway Mechanisms\n\n';

      result.pathwayMechanisms.forEach(pm => {
        section += `#### ${pm.pathway}\n\n`;

        // Biological function (has citations from fact-checking)
        if (pm.biologicalFunction) {
          section += `**Function:** ${this._cleanSectionMarkers(pm.biologicalFunction)}\n\n`;
        }

        // Crosstalk
        if (pm.crosstalk && pm.crosstalk.length > 0) {
          section += `**Crosstalk:** ${pm.crosstalk.join('; ')}\n\n`;
        }

        // Upstream regulators
        if (pm.upstreamRegulators && pm.upstreamRegulators.length > 0) {
          section += `**Upstream:** ${pm.upstreamRegulators.join(', ')}\n\n`;
        }

        // Downstream effects
        if (pm.downstreamEffects && pm.downstreamEffects.length > 0) {
          section += `**Downstream:** ${pm.downstreamEffects.join(', ')}\n\n`;
        }

        section += '---\n\n';
      });
    }

    // Key pathway interactions table
    if (result.keyInteractions && result.keyInteractions.length > 0) {
      section += '### Key Pathway Interactions\n\n';
      section += '| Pathway 1 | Pathway 2 | Type | Mechanism |\n';
      section += '|-----------|-----------|------|------------|\n';

      result.keyInteractions.forEach(ki => {
        section += `| ${ki.pathway1} | ${ki.pathway2} | ${ki.interactionType} | ${ki.mechanism} |\n`;
      });

      section += '\n';
    }

    return section;
  }
}

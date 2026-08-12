// Step 5.5: Identify Novel & Unexpected Findings
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step055_NovelFindings extends BaseStep {
  constructor() {
    super(5.5, 'Novel Findings', [1, 2, 3, 4, 5]);

    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: WorkflowConfig.llm.temperature,
      maxTokens: WorkflowConfig.llm.maxTokens
    });

    this.factChecker = new FactCheckingService();
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);

    const summary = this.getPreviousStepOutput(context, 1);
    const themes = this.getPreviousStepOutput(context, 2);
    const geneAnalysis = this.getPreviousStepOutput(context, 3);
    const mechanisms = this.getPreviousStepOutput(context, 4);
    const directions = this.getPreviousStepOutput(context, 5);

    // Extract experimental context
    const { analyses = [] } = input;
    const experimentContext = this._extractExperimentContext(analyses);

    const systemPrompt = `You are a molecular biology expert identifying novel and unexpected findings from pathway analysis.

${experimentContext ? `Focus on findings relevant to: ${experimentContext}` : ''}

CRITICAL: Distinguish between EXPECTED and UNEXPECTED findings:
- Expected findings: Results that align with established knowledge about the biological system
- Unexpected findings: Results that challenge current understanding or reveal new connections
- Novel candidates: Genes/pathways not previously associated with this condition

IMPORTANT - Be SPECIFIC and EVIDENCE-BASED:
- Use EXACT gene symbols and pathway names from the data
- Explain WHY a finding is unexpected (what was the prior expectation?)
- Cite known biology to establish what is "expected"
- Avoid vague statements like "interesting pattern" - be precise

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Identify novel and unexpected findings from this pathway analysis:

${experimentContext ? `**Experimental Context:**
${experimentContext}

Identify findings that are surprising or novel for this specific tissue/disease context.
` : ''}
**Main Themes:**
${themes?.themes?.map(t => `- ${t.name}: ${t.description}`).join('\n') || 'Not available'}

**Hub Genes:**
${geneAnalysis?.hubGenes?.slice(0, 10).map(g => `- ${g.gene} (FC: ${g.foldChange?.toFixed(2)}): ${g.role}`).join('\n') || 'Not available'}

**Pathway Direction Patterns:**
Activated: ${directions?.activatedPathways?.map(p => p.pathway).join(', ') || 'None'}
Suppressed: ${directions?.suppressedPathways?.map(p => p.pathway).join(', ') || 'None'}
Mixed: ${directions?.mixedDirectionPathways?.map(p => p.pathway).join(', ') || 'None'}

**Key Mechanisms:**
${mechanisms?.pathwayMechanisms?.slice(0, 5).map(pm => `- ${pm.pathway}: ${pm.biologicalFunction}`).join('\n') || 'Not available'}

Analyze and identify:

1. **Expected Findings**: What results align with established knowledge?${experimentContext ? ` (for ${experimentContext})` : ''}
   - Which pathways/genes were predictable based on prior literature?
   - What confirms current understanding of this biological system?

2. **Unexpected Findings**: What results challenge or extend current knowledge?
   - Which pathways/genes are surprising given established biology?
   - What contradicts prior expectations?${experimentContext ? ` (for ${experimentContext})` : ''}
   - Are there unexpected pathway directions or crosstalk patterns?

3. **Novel Candidates**: Which genes/pathways deserve further investigation?
   - Genes with strong expression changes but limited prior literature${experimentContext ? ` in ${experimentContext}` : ''}
   - Pathways not previously linked to this condition
   - Unexpected pathway interactions or regulatory patterns

4. **Priority for Investigation**: Which findings are most important to follow up?

CRITICAL - EXPLAIN THE NOVELTY:
- For unexpected findings: Explain what was expected vs. what was observed
- For novel candidates: Explain why they lack prior association
- Use SPECIFIC gene/pathway names from the data above
- Cite biological reasoning, not just "interesting" or "surprising"

Return JSON:
{
  "expectedFindings": [
    {
      "category": "pathway" | "gene" | "mechanism",
      "name": "Specific pathway/gene name",
      "finding": "What was found (with quantitative data)",
      "alignment": "How this aligns with established knowledge (2-3 sentences with biological reasoning)"
    }
  ],
  "unexpectedFindings": [
    {
      "category": "pathway" | "gene" | "mechanism" | "direction" | "interaction",
      "name": "Specific pathway/gene name",
      "finding": "What was found (with quantitative data)",
      "surprise": "What makes this unexpected - what was the prior expectation? (3-4 sentences)",
      "implications": "What this means for understanding the biology",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "novelCandidates": [
    {
      "type": "gene" | "pathway" | "interaction",
      "name": "Specific name",
      "evidence": "What makes this a novel candidate (expression data, pathway membership)",
      "priorKnowledge": "What is/isn't known about this in the literature${experimentContext ? ` for ${experimentContext}` : ''}",
      "investigationPriority": "high" | "medium" | "low",
      "proposedExperiments": ["Specific experimental approaches to validate"]
    }
  ],
  "prioritizedFindings": [
    {
      "finding": "Specific finding with gene/pathway names",
      "priority": "Tier 1" | "Tier 2" | "Tier 3",
      "rationale": "Why this is high/medium/low priority for follow-up",
      "nextSteps": ["Specific actionable recommendations"]
    }
  ],
  "noveltyInterpretation": "Overall interpretation of expected vs. unexpected patterns (4-5 sentences, cite specific examples)",
  "knowledgeGaps": ["Specific questions raised by unexpected findings that warrant further research"]
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate gene/pathway names against input (hallucination prevention)
      const { genes = [], pathways = [] } = input;
      const validatedResult = this._validateNovelFindings(result, genes, pathways, themes);

      console.log(`  Expected Findings: ${validatedResult.expectedFindings?.length || 0}`);
      console.log(`  Unexpected Findings: ${validatedResult.unexpectedFindings?.length || 0}`);
      console.log(`  Novel Candidates: ${validatedResult.novelCandidates?.length || 0}`);

      // Conditionally fact-check all factual fields
      let finalResult = validatedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying novel findings...');

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
          'Novel Findings'
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
        ...finalResult,
        references,
        factCheckStats,
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        expectedFindings: [],
        unexpectedFindings: [],
        novelCandidates: [],
        prioritizedFindings: [],
        noveltyInterpretation: `Novel findings analysis could not be completed: ${error.message}`,
        knowledgeGaps: [],
        error: error.message
      };
    }
  }

  /**
   * Validate gene/pathway names in novel findings against input data
   * Removes hallucinated names and enriches with actual data
   */
  _validateNovelFindings(result, genes, pathways, themes) {
    // Create gene and pathway lookup sets
    const geneSet = new Set();
    genes.forEach(g => {
      const geneName = g.name || g.gene || g.geneName;
      if (geneName) geneSet.add(geneName);
    });

    const pathwaySet = new Set();
    pathways.forEach(p => {
      const pathwayName = p.name || p.pathwayName;
      if (pathwayName) pathwaySet.add(pathwayName);
    });

    // Also add pathways from themes
    (themes?.themes || []).forEach(theme => {
      (theme.pathways || []).forEach(p => {
        const pathwayName = typeof p === 'string' ? p : (p.name || p.pathwayName);
        if (pathwayName) pathwaySet.add(pathwayName);
      });
    });

    let totalHallucinated = 0;

    // Validate expected findings
    const validExpected = (result.expectedFindings || []).filter(item => {
      const name = item.name;

      if (item.category === 'gene' && !geneSet.has(name)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated expected gene: "${name}"`);
        return false;
      }

      if (item.category === 'pathway' && !pathwaySet.has(name)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated expected pathway: "${name}"`);
        return false;
      }

      return true;
    });

    // Validate unexpected findings
    const validUnexpected = (result.unexpectedFindings || []).filter(item => {
      const name = item.name;

      if (item.category === 'gene' && !geneSet.has(name)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated unexpected gene: "${name}"`);
        return false;
      }

      if (item.category === 'pathway' && !pathwaySet.has(name)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated unexpected pathway: "${name}"`);
        return false;
      }

      return true;
    });

    // Validate novel candidates
    const validNovel = (result.novelCandidates || []).filter(item => {
      const name = item.name;

      if (item.type === 'gene' && !geneSet.has(name)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated novel gene candidate: "${name}"`);
        return false;
      }

      if (item.type === 'pathway' && !pathwaySet.has(name)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated novel pathway candidate: "${name}"`);
        return false;
      }

      return true;
    });

    if (totalHallucinated > 0) {
      console.warn(`  ⚠️ Removed ${totalHallucinated} hallucinated finding(s)`);
    }

    return {
      ...result,
      expectedFindings: validExpected,
      unexpectedFindings: validUnexpected,
      novelCandidates: validNovel,
      validation: {
        totalHallucinated,
        validExpectedCount: validExpected.length,
        validUnexpectedCount: validUnexpected.length,
        validNovelCount: validNovel.length
      }
    };
  }

  /**
   * Generate Novel & Unexpected Findings report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result) {
    let section = '## 5. Novel & Unexpected Findings\n\n';

    // Add novelty interpretation (has citations from fact-checking)
    if (result.noveltyInterpretation) {
      let cleanInterpretation = this._cleanSectionMarkers(result.noveltyInterpretation);

      // Remove leading ** artifacts
      cleanInterpretation = cleanInterpretation.replace(/^\*\*\s*\n/, '').trim();

      // Remove horizontal rules
      cleanInterpretation = cleanInterpretation.replace(/^[\-\*_]{3,}\s*$/gm, '').trim();

      // Clean up multiple blank lines
      cleanInterpretation = cleanInterpretation.replace(/\n\n\n+/g, '\n\n');

      if (cleanInterpretation) {
        section += cleanInterpretation + '\n\n';
      }
    }

    // Unexpected Findings section
    if (result.unexpectedFindings && result.unexpectedFindings.length > 0) {
      section += '### Unexpected Findings\n\n';

      result.unexpectedFindings.forEach((uf, idx) => {
        const confidence = uf.confidence === 'high' ? '⭐⭐⭐' :
                          uf.confidence === 'medium' ? '⭐⭐' : '⭐';

        section += `#### ${idx + 1}. ${uf.name} (${uf.category}) ${confidence}\n\n`;
        section += `**Finding:** ${uf.finding}\n\n`;
        section += `**Why Unexpected:** ${uf.surprise}\n\n`;
        section += `**Implications:** ${uf.implications}\n\n`;
        section += '---\n\n';
      });
    }

    // Novel Candidates section
    if (result.novelCandidates && result.novelCandidates.length > 0) {
      section += '### Novel Candidates for Investigation\n\n';

      const highPriority = result.novelCandidates.filter(nc => nc.investigationPriority === 'high');
      const mediumPriority = result.novelCandidates.filter(nc => nc.investigationPriority === 'medium');
      const lowPriority = result.novelCandidates.filter(nc => nc.investigationPriority === 'low');

      if (highPriority.length > 0) {
        section += '**High Priority:**\n\n';
        highPriority.forEach(nc => {
          section += `- **${nc.name}** (${nc.type})\n`;
          section += `  - **Evidence:** ${nc.evidence}\n`;
          section += `  - **Prior Knowledge:** ${nc.priorKnowledge}\n`;
          if (nc.proposedExperiments && nc.proposedExperiments.length > 0) {
            section += `  - **Proposed Experiments:** ${nc.proposedExperiments.join('; ')}\n`;
          }
          section += '\n';
        });
      }

      if (mediumPriority.length > 0) {
        section += '**Medium Priority:**\n\n';
        mediumPriority.forEach(nc => {
          section += `- **${nc.name}** (${nc.type}): ${nc.evidence}\n`;
        });
        section += '\n';
      }

      if (lowPriority.length > 0) {
        section += '**Low Priority:**\n\n';
        section += lowPriority.map(nc => `- ${nc.name}`).join(', ') + '\n\n';
      }
    }

    // Expected Findings (brief summary)
    if (result.expectedFindings && result.expectedFindings.length > 0) {
      section += '### Expected Findings (Supporting Prior Knowledge)\n\n';

      result.expectedFindings.forEach(ef => {
        section += `- **${ef.name}** (${ef.category}): ${ef.alignment}\n`;
      });

      section += '\n';
    }

    // Knowledge Gaps
    if (result.knowledgeGaps && result.knowledgeGaps.length > 0) {
      section += '### Outstanding Questions\n\n';

      result.knowledgeGaps.forEach((gap, idx) => {
        section += `${idx + 1}. ${gap}\n`;
      });

      section += '\n';
    }

    return section;
  }
}

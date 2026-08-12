// Step 7: Identify Therapeutic Implications
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step07_TherapeuticImplications extends BaseStep {
  constructor() {
    super(7, 'Therapeutic Implications', [3, 6]); // Removed Step 5 dependency

    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: WorkflowConfig.llm.temperature,
      maxTokens: WorkflowConfig.llm.maxTokens
    });

    this.factChecker = new FactCheckingService();
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);

    const geneAnalysis = this.getPreviousStepOutput(context, 3);
    const hypotheses = this.getPreviousStepOutput(context, 6);

    // Extract experimental context
    const { analyses = [] } = input;
    const experimentContext = this._extractExperimentContext(analyses);

    const systemPrompt = `You are a translational medicine expert identifying therapeutic targets and drug opportunities from pathway analysis.

${experimentContext ? `Focus on therapies appropriate for: ${experimentContext}` : ''}

Consider tissue-specific drug targeting, delivery, and safety.

CRITICAL: Provide SPECIFIC therapeutic recommendations:
- Use REAL drug names (FDA-approved or in clinical trials)
- Provide SPECIFIC molecular targets with mechanisms
- Base recommendations on established pharmacology
- Include actual clinical evidence where available
- Be concrete and actionable, not vague or generic

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Identify therapeutic implications from this pathway analysis:

${experimentContext ? `**Experimental Context:**
${experimentContext}
` : ''}
**Hub Genes (Potential Targets):**
${geneAnalysis?.hubGenes?.map(g => `- ${g.gene}: ${g.role}`).join('\n') || 'Not available'}

**Master Regulators:**
${geneAnalysis?.masterRegulators?.map(m => `- ${m.gene}: ${m.mechanism}`).join('\n') || 'Not available'}

**Key Hypotheses:**
${hypotheses?.hypotheses?.slice(0, 5).map((h, i) => `${i+1}. ${h.hypothesis}`).join('\n') || 'Not available'}

Identify therapeutic opportunities considering the experimental context:
1. Which genes/pathways are druggable in this tissue/disease?
2. What SPECIFIC FDA-approved drugs target these pathways? Include drug names, approval years, mechanisms
3. Which targets are most promising for drug development in this context?
4. What are the therapeutic strategies (activation, inhibition, modulation)?
5. What are tissue-specific safety considerations and drug delivery challenges?
6. Are there approved drugs for this specific condition or related conditions?

CRITICAL - Use REAL drug information with mechanism-based selection:
- **Match drugs to pathways by MECHANISM, not just pathway name**:
  - If pathway is "Oxidative phosphorylation" → drugs affecting mitochondria (Metformin), NOT unrelated mechanisms
  - If pathway is "Cell cycle" → CDK inhibitors, NOT random kinase inhibitors
  - If pathway is "Angiogenesis" → VEGF/VEGFR inhibitors (Bevacizumab, Sunitinib)
- **Consider experimental context** (${experimentContext || 'this condition'}):
  - Look for FDA-approved drugs for this specific condition or related conditions
  - If cancer: check oncology drugs; if autoimmune: check immunosuppressants; etc.
- **Validate drug-target relationships**:
  - Explain molecular mechanism connecting drug to enriched pathway
  - Don't recommend drugs solely because pathway name sounds related
- For approved drugs: Include brand/generic name, FDA approval year, specific indication
- For clinical trials: Include phase (I/II/III), mechanism of action
- Cite specific resistance mechanisms when relevant

Return JSON with SPECIFIC drug details:
{
  "drugTargets": [
    {
      "target": "gene or pathway name with molecular detail",
      "druggability": "high" | "medium" | "low",
      "strategy": "inhibit" | "activate" | "modulate",
      "rationale": "Why this is a good target with molecular mechanism (2-3 sentences)",
      "existingDrugs": [
        {
          "drug": "Specific drug name (Brand/Generic)",
          "status": "FDA approved YEAR" | "Phase I/II/III clinical trial" | "preclinical",
          "indication": "Specific current FDA indication",
          "mechanism": "How it works molecularly",
          "clinicalData": "Key efficacy data if available"
        }
      ],
      "developmentPotential": "High/medium/low with specific reasoning",
      "safetyConcerns": "Specific side effects based on mechanism"
    }
  ],
  "repurposingOpportunities": [
    {
      "drug": "Specific existing drug name",
      "currentUse": "Current FDA-approved indication",
      "proposedUse": "How to use for this condition with rationale",
      "supportingEvidence": "Molecular/pathway basis for repurposing",
      "feasibility": "high" | "medium" | "low"
    }
  ],
  "combinationStrategies": [
    {
      "strategy": "Specific drug combination (Drug A + Drug B)",
      "drugs": ["Specific drug 1", "Specific drug 2"],
      "targets": ["molecular target1", "molecular target2"],
      "rationale": "Why combine these specific targets with mechanism (3-4 sentences)",
      "synergy": "Expected synergistic effect with biological basis"
    }
  ],
  "prioritizedTargets": [
    {"target": "name", "priority": "Tier 1 (FDA approved)" | "Tier 2 (Clinical trials)" | "Tier 3 (Experimental)", "justification": "specific reason with drug examples"}
  ],
  "therapeuticSummary": "Overall therapeutic landscape with SPECIFIC drugs and mechanisms mentioned (5-6 sentences, cite specific drug names)",
  "resistanceMechanisms": [
    {"mechanism": "Specific resistance mechanism", "targetedBy": "drug name", "overcomingStrategy": "How to address"}
  ],
  "nextSteps": ["Specific actionable recommendations with drug names"]
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate drug target gene names (hallucination prevention)
      const { genes = [] } = input;
      const validatedResult = this._validateTherapeutics(result, genes);

      console.log(`  Drug Targets Identified: ${validatedResult.drugTargets?.length || 0}`);
      console.log(`  Repurposing Opportunities: ${validatedResult.repurposingOpportunities?.length || 0}`);
      console.log(`  Combination Strategies: ${validatedResult.combinationStrategies?.length || 0}`);

      // Conditionally fact-check all factual fields (therapeuticSummary, drugTargets, repurposing)
      let finalResult = validatedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying therapeutic implications...');
        const { analyses = [] } = input;
        const experimentContext = this._extractExperimentContext(analyses);
        const themes = this.getPreviousStepOutput(context, 2);

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
          'Therapeutic Implications'
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
        ...finalResult, // Includes therapeuticSummary, drugTargets, repurposing
        references,
        factCheckStats,
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        drugTargets: [],
        repurposingOpportunities: [],
        combinationStrategies: [],
        prioritizedTargets: [],
        therapeuticSummary: `Therapeutic analysis could not be completed: ${error.message}`,
        nextSteps: []
      };
    }
  }

  /**
   * Validate drug target gene names against input gene list
   * Removes hallucinated gene references (drug names are from general knowledge, not validated)
   */
  _validateTherapeutics(result, inputGenes) {
    // Create valid gene set
    const validGeneSet = new Set();
    inputGenes.forEach(gene => {
      const geneName = gene.name || gene.gene || gene.geneName;
      if (geneName) {
        validGeneSet.add(geneName);
      }
    });

    let totalHallucinated = 0;

    // Validate drug targets - check if target is a gene name
    const validDrugTargets = (result.drugTargets || []).filter(target => {
      const targetName = target.target;

      // Check if target appears to be a gene name (all caps, 2+ chars)
      const possibleGeneMatch = targetName.match(/\b([A-Z][A-Z0-9]+)\b/);
      if (possibleGeneMatch) {
        const geneName = possibleGeneMatch[1];
        if (geneName.length > 2 && !validGeneSet.has(geneName)) {
          // Only filter if it looks like a gene name but isn't in our list
          // Allow pathway names and general biological terms
          const isLikelyGeneName = geneName === geneName.toUpperCase() && geneName.length < 10;
          if (isLikelyGeneName) {
            totalHallucinated++;
            console.warn(`    ⚠️ Removed drug target with hallucinated gene: "${geneName}"`);
            return false;
          }
        }
      }

      return true;
    });

    // Validate targets in combination strategies
    const validCombinations = (result.combinationStrategies || []).map(combo => {
      const validTargets = (combo.targets || []).filter(targetName => {
        const possibleGeneMatch = targetName.match(/\b([A-Z][A-Z0-9]+)\b/);
        if (possibleGeneMatch) {
          const geneName = possibleGeneMatch[1];
          if (geneName.length > 2 && !validGeneSet.has(geneName)) {
            const isLikelyGeneName = geneName === geneName.toUpperCase() && geneName.length < 10;
            if (isLikelyGeneName) {
              totalHallucinated++;
              console.warn(`    ⚠️ Removed hallucinated target "${geneName}" from combination strategy`);
              return false;
            }
          }
        }
        return true;
      });

      return {
        ...combo,
        targets: validTargets
      };
    }).filter(combo => combo.targets.length > 0); // Remove combos with no valid targets

    // Validate prioritized targets
    const validPrioritized = (result.prioritizedTargets || []).filter(target => {
      const targetName = target.target;

      const possibleGeneMatch = targetName.match(/\b([A-Z][A-Z0-9]+)\b/);
      if (possibleGeneMatch) {
        const geneName = possibleGeneMatch[1];
        if (geneName.length > 2 && !validGeneSet.has(geneName)) {
          const isLikelyGeneName = geneName === geneName.toUpperCase() && geneName.length < 10;
          if (isLikelyGeneName) {
            totalHallucinated++;
            console.warn(`    ⚠️ Removed hallucinated prioritized target: "${geneName}"`);
            return false;
          }
        }
      }

      return true;
    });

    if (totalHallucinated > 0) {
      console.warn(`  ⚠️ Removed ${totalHallucinated} hallucinated drug target(s)`);
    }

    return {
      ...result,
      drugTargets: validDrugTargets,
      combinationStrategies: validCombinations,
      prioritizedTargets: validPrioritized,
      validation: {
        totalHallucinated,
        validDrugTargetsCount: validDrugTargets.length,
        validCombinationsCount: validCombinations.length,
        validPrioritizedCount: validPrioritized.length
      }
    };
  }

  /**
   * Generate Therapeutic Implications report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result) {
    let section = '## 6. Therapeutic Implications\n\n';

    // Add therapeutic summary (has citations from fact-checking)
    if (result.therapeuticSummary) {
      let cleanSummary = this._cleanSectionMarkers(result.therapeuticSummary);

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

    // Drug Targets table
    if (result.drugTargets && result.drugTargets.length > 0) {
      section += '### Drug Targets\n\n';
      section += '| Target | Druggability | Strategy | Rationale | Existing Drugs |\n';
      section += '|--------|--------------|----------|-----------|----------------|\n';

      result.drugTargets.forEach(dt => {
        const drugs = dt.existingDrugs && dt.existingDrugs.length > 0
          ? dt.existingDrugs.slice(0, 2).map(d => `${d.drug} (${d.status})`).join('; ')
          : 'None identified';

        // Rationale has citations from fact-checking
        section += `| ${dt.target} | ${dt.druggability} | ${dt.strategy} | ${dt.rationale} | ${drugs} |\n`;
      });

      section += '\n';
    }

    // Repurposing Opportunities
    if (result.repurposingOpportunities && result.repurposingOpportunities.length > 0) {
      section += '### Drug Repurposing Opportunities\n\n';

      result.repurposingOpportunities.forEach(ro => {
        section += `#### ${ro.drug}\n\n`;
        section += `- **Current Use:** ${ro.currentUse}\n`;
        section += `- **Proposed Use:** ${ro.proposedUse}\n`;
        section += `- **Supporting Evidence:** ${ro.supportingEvidence}\n`;
        section += `- **Feasibility:** ${ro.feasibility}\n\n`;
      });
    }

    // Combination Strategies
    if (result.combinationStrategies && result.combinationStrategies.length > 0) {
      section += '### Combination Therapy Strategies\n\n';

      result.combinationStrategies.forEach((cs, idx) => {
        section += `${idx + 1}. **${cs.strategy}**\n`;
        section += `   - **Drugs:** ${cs.drugs.join(' + ')}\n`;
        section += `   - **Targets:** ${cs.targets.join(', ')}\n`;
        section += `   - **Rationale:** ${cs.rationale}\n`;
        if (cs.synergy) {
          section += `   - **Expected Synergy:** ${cs.synergy}\n`;
        }
        section += '\n';
      });
    }

    // Prioritized Targets summary
    if (result.prioritizedTargets && result.prioritizedTargets.length > 0) {
      section += '### Prioritized Targets\n\n';

      const tier1 = result.prioritizedTargets.filter(t => t.priority.includes('Tier 1'));
      const tier2 = result.prioritizedTargets.filter(t => t.priority.includes('Tier 2'));
      const tier3 = result.prioritizedTargets.filter(t => t.priority.includes('Tier 3'));

      if (tier1.length > 0) {
        section += '**Tier 1 (FDA Approved):**\n';
        tier1.forEach(t => {
          section += `- **${t.target}**: ${t.justification}\n`;
        });
        section += '\n';
      }

      if (tier2.length > 0) {
        section += '**Tier 2 (Clinical Trials):**\n';
        tier2.forEach(t => {
          section += `- **${t.target}**: ${t.justification}\n`;
        });
        section += '\n';
      }

      if (tier3.length > 0) {
        section += '**Tier 3 (Experimental):**\n';
        tier3.forEach(t => {
          section += `- **${t.target}**: ${t.justification}\n`;
        });
        section += '\n';
      }
    }

    return section;
  }
}

// Step 5: Compare Pathway Directions (Up vs. Down)
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';

export class Step05_PathwayDirections extends BaseStep {
  constructor() {
    super(5, 'Pathway Direction Analysis', [1, 2, 3]);

    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: WorkflowConfig.llm.temperature,
      maxTokens: WorkflowConfig.llm.maxTokens
    });
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);

    const summary = this.getPreviousStepOutput(context, 1);
    const themes = this.getPreviousStepOutput(context, 2);
    const geneAnalysis = this.getPreviousStepOutput(context, 3);

    const { pathways = [], genes = [] } = input;

    // Analyze pathway directions based on gene fold changes
    const pathwayDirections = this._analyzePathwayDirections(pathways, genes);

    const systemPrompt = `You are a molecular biology expert analyzing pathway regulation patterns (activation vs. suppression).`;

    const userPrompt = `Analyze the direction of pathway regulation based on gene expression:

**Gene Expression Patterns:**
Upregulated genes: ${summary?.genePatterns?.upregulated?.map(g => g.gene).join(', ') || 'N/A'}
Downregulated genes: ${summary?.genePatterns?.downregulated?.map(g => g.gene).join(', ') || 'N/A'}

**Pathway Direction Analysis:**
${pathwayDirections.map(pd =>
  `- ${pd.pathway}: ${pd.upGenes} up, ${pd.downGenes} down → ${pd.direction} (score: ${pd.score.toFixed(2)})`
).join('\n')}

**Pathway Themes:**
${themes?.themes?.map(t => `- ${t.name}: ${t.pathways?.slice(0, 3).join(', ')}`).join('\n') || 'Not available'}

Analyze:
1. Which pathways are activated (more upregulated genes)?
2. Which pathways are suppressed (more downregulated genes)?
3. Are certain themes consistently activated or suppressed?
4. What does this pattern tell us biologically?
5. Are there mixed-direction pathways? What does that mean?

Return JSON:
{
  "activatedPathways": [
    {"pathway": "name", "upregulatedGenes": ["gene1", "gene2"], "biologicalMeaning": "explanation"}
  ],
  "suppressedPathways": [
    {"pathway": "name", "downregulatedGenes": ["gene1", "gene2"], "biologicalMeaning": "explanation"}
  ],
  "mixedDirectionPathways": [
    {"pathway": "name", "interpretation": "why mixed direction matters"}
  ],
  "themeDirections": [
    {"theme": "theme name", "overallDirection": "activated" | "suppressed" | "mixed", "significance": "what it means"}
  ],
  "biologicalInterpretation": "What the overall direction pattern tells us (4-5 sentences)",
  "functionalConsequences": "Predicted biological outcomes based on these directions (3-4 sentences)"
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate pathway names against Step 2 themes (hallucination prevention)
      const validatedResult = this._validateDirections(result, themes);

      console.log(`  Activated Pathways: ${validatedResult.activatedPathways?.length || 0}`);
      console.log(`  Suppressed Pathways: ${validatedResult.suppressedPathways?.length || 0}`);
      console.log(`  Mixed Direction: ${validatedResult.mixedDirectionPathways?.length || 0}`);

      return {
        ...validatedResult,
        pathwayDirectionScores: pathwayDirections
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        activatedPathways: [],
        suppressedPathways: [],
        mixedDirectionPathways: [],
        themeDirections: [],
        biologicalInterpretation: `Direction analysis could not be completed: ${error.message}`,
        functionalConsequences: '',
        pathwayDirectionScores: pathwayDirections
      };
    }
  }

  _analyzePathwayDirections(pathways, genes) {
    // Create gene fold change lookup
    const geneFCMap = new Map();
    genes.forEach(g => {
      const geneName = g.name || g.gene || g.geneName;
      if (geneName && g.foldChange !== undefined && g.foldChange !== null) {
        geneFCMap.set(geneName, g.foldChange);
      }
    });

    // Analyze each pathway (use all pathways provided by user's selection)
    return pathways.map(pathway => {
      // Ensure pathway.genes is an array
      let pathwayGenes = pathway.genes || [];
      if (!Array.isArray(pathwayGenes)) {
        console.warn(`Pathway ${pathway.name || pathway.pathwayName} has non-array genes:`, typeof pathwayGenes);
        pathwayGenes = [];
      }

      const upGenes = [];
      const downGenes = [];
      let scoreSum = 0;

      pathwayGenes.forEach(geneName => {
        const fc = geneFCMap.get(geneName);
        if (fc !== undefined) {
          if (fc > 0) {
            upGenes.push(geneName);
            scoreSum += fc;
          } else {
            downGenes.push(geneName);
            scoreSum += fc;
          }
        }
      });

      const totalGenes = upGenes.length + downGenes.length;
      const avgScore = totalGenes > 0 ? scoreSum / totalGenes : 0;

      let direction;
      if (upGenes.length > downGenes.length * 2) {
        direction = 'activated';
      } else if (downGenes.length > upGenes.length * 2) {
        direction = 'suppressed';
      } else {
        direction = 'mixed';
      }

      return {
        pathway: pathway.name || pathway.pathwayName,
        upGenes: upGenes.length,
        downGenes: downGenes.length,
        score: avgScore,
        direction
      };
    }).filter(pd => pd.upGenes > 0 || pd.downGenes > 0);
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
   * Validate pathway names in directional analysis against Step 2 themes
   * Removes hallucinated pathway references
   */
  _validateDirections(result, validatedThemes) {
    // Create valid pathway set from Step 2 themes with normalized names
    const validPathwaySet = new Set();
    (validatedThemes?.themes || []).forEach(theme => {
      (theme.pathways || []).forEach(pathway => {
        const pathwayName = typeof pathway === 'string' ? pathway : pathway.name;
        if (pathwayName) {
          const normalized = this._normalizePathwayName(pathwayName);
          validPathwaySet.add(normalized);
        }
      });
    });

    // Also add ungrouped pathways
    (validatedThemes?.ungrouped || []).forEach(pathway => {
      const pathwayName = typeof pathway === 'string' ? pathway : pathway.name;
      if (pathwayName) {
        const normalized = this._normalizePathwayName(pathwayName);
        validPathwaySet.add(normalized);
      }
    });

    let totalHallucinated = 0;

    // Validate activated pathways
    const validActivated = (result.activatedPathways || []).filter(item => {
      const pathwayName = item.pathway;
      const normalized = this._normalizePathwayName(pathwayName);

      if (!validPathwaySet.has(normalized)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated activated pathway: "${pathwayName}"`);
        return false;
      }

      return true;
    });

    // Validate suppressed pathways
    const validSuppressed = (result.suppressedPathways || []).filter(item => {
      const pathwayName = item.pathway;
      const normalized = this._normalizePathwayName(pathwayName);

      if (!validPathwaySet.has(normalized)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated suppressed pathway: "${pathwayName}"`);
        return false;
      }

      return true;
    });

    // Validate mixed direction pathways
    const validMixed = (result.mixedDirectionPathways || []).filter(item => {
      const pathwayName = item.pathway;
      const normalized = this._normalizePathwayName(pathwayName);

      if (!validPathwaySet.has(normalized)) {
        totalHallucinated++;
        console.warn(`    ⚠️ Removed hallucinated mixed-direction pathway: "${pathwayName}"`);
        return false;
      }

      return true;
    });

    if (totalHallucinated > 0) {
      console.warn(`  ⚠️ Removed ${totalHallucinated} hallucinated pathway reference(s)`);
    }

    return {
      ...result,
      activatedPathways: validActivated,
      suppressedPathways: validSuppressed,
      mixedDirectionPathways: validMixed,
      validation: {
        totalHallucinated,
        validActivatedCount: validActivated.length,
        validSuppressedCount: validSuppressed.length,
        validMixedCount: validMixed.length
      }
    };
  }
}

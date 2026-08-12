// Step 6: Generate Mechanistic Hypotheses
import { BaseStep } from './BaseStep.js';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../config.js';
import { FactCheckingService } from '../services/FactCheckingService.js';

export class Step06_MechanisticHypotheses extends BaseStep {
  constructor() {
    super(6, 'Mechanistic Hypotheses', [2, 3, 4, 5]);

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
    const mechanisms = this.getPreviousStepOutput(context, 4);
    const directions = this.getPreviousStepOutput(context, 5);

    // Extract experimental context
    const { analyses = [] } = input;
    const experimentContext = this._extractExperimentContext(analyses);

    const systemPrompt = `You are a molecular biology expert generating testable mechanistic hypotheses from pathway analysis data.

${experimentContext ? `Focus on mechanisms specific to: ${experimentContext}

Consider tissue-specific pathway functions, disease-specific alterations, and context-appropriate molecular interactions.` : ''}

CRITICAL: Generate specific, detailed hypotheses with:
- Concrete molecular mechanisms (not vague statements)
- Use ACTUAL GENES from the data with their fold changes
- Clear cause-effect relationships with molecular details
- Biologically plausible mechanisms based on established knowledge

MECHANISTIC MODEL REQUIREMENTS:
- Build flowcharts using ≥5 specific genes from the analysis with their fold changes
- Every step should name specific genes/proteins, not generic processes
- BAD: "ROS production → Pathway activation → Stress response"
- GOOD: "HIF1A (+2.3-fold) → VEGFA (+2.5-fold) transcription → Angiogenesis"
- Connect genes through known molecular interactions (phosphorylation, transcription, protein-protein)
- Consider experimental context: ${experimentContext || 'this biological system'}

RESPONSE FORMAT:
- Return ONLY valid JSON
- NO markdown code blocks (no \`\`\`json)
- NO explanatory text before or after
- Just the raw JSON object`;

    const userPrompt = `Based on the comprehensive pathway analysis, generate mechanistic hypotheses:

${experimentContext ? `**Experimental Context:**
${experimentContext}
` : ''}

**Pathway Themes:**
${themes?.themes?.map(t => `- ${t.name}: ${t.description}`).join('\n') || 'Not available'}

**Hub Genes and Master Regulators:**
${geneAnalysis?.hubGenes?.map(g => `- ${g.gene}: ${g.role}`).join('\n') || 'Not available'}
${geneAnalysis?.masterRegulators?.map(m => `- ${m.gene}: ${m.mechanism}`).join('\n') || 'Not available'}

**Pathway Mechanisms:**
${mechanisms?.pathwayMechanisms?.map(pm => `- ${pm.pathway}: ${pm.biologicalFunction}`).join('\n') || 'Not available'}

**Key Interactions:**
${mechanisms?.keyInteractions?.map(ki => `- ${ki.pathway1} ${ki.interactionType} ${ki.pathway2}: ${ki.mechanism}`).join('\n') || 'Not available'}

**Direction Analysis:**
Activated: ${directions?.activatedPathways?.map(p => p.pathway).join(', ') || 'N/A'}
Suppressed: ${directions?.suppressedPathways?.map(p => p.pathway).join(', ') || 'N/A'}

Generate 5-7 mechanistic hypotheses${experimentContext ? ` specific to ${experimentContext}` : ''}:
1. Create mechanistic models connecting pathways and genes${experimentContext ? ` in this tissue/disease context` : ''}
2. Propose cause-effect relationships${experimentContext ? ` relevant to the experimental setting` : ''}
3. Explain WHY certain pathways are enriched${experimentContext ? ` in this specific tissue/disease` : ''}
4. Suggest how different pathways work together${experimentContext ? ` in this biological context` : ''}
5. Each hypothesis must be testable${experimentContext ? ` and appropriate for this experimental system` : ''}

Return JSON with SPECIFIC, testable hypotheses:
{
  "hypotheses": [
    {
      "hypothesis": "Clear, testable hypothesis statement with specific genes",
      "mechanisticModel": "Detailed molecular mechanism with specific interactions (3-4 sentences, include gene names and pathways)",
      "keyPlayers": ["specific gene/pathway1 with role", "specific gene/pathway2 with role"],
      "evidenceSupporting": [
        "Quantitative evidence from data (e.g., 'GENE_X overexpressed 3.2-fold')",
        "Pathway enrichment evidence (e.g., 'Cell cycle pathway p=1e-15')"
      ],
      "testability": {
        "approach1": "Specific experimental test (e.g., 'siRNA knockdown of GENE_X in CELL_LINE cells')",
        "approach2": "Alternative test method with expected outcome",
        "expectedOutcome": "QUANTITATIVE prediction (e.g., 'Expect 60% reduction in GENE_Y expression, p<0.01')"
      },
      "quantitativePrediction": "Specific numerical prediction if hypothesis is correct",
      "confidence": "high" | "medium" | "low",
      "confidenceRationale": "Why this confidence level (cite specific evidence)",
      "novelty": "novel" | "builds-on-known" | "confirmatory"
    }
  ],
  "centralMechanisticModel": "Overall unifying model integrating multiple pathways with specific molecular details (5-6 sentences, cite specific genes with fold changes)",
  "keyPredictions": [
    {
      "prediction": "What will happen if model is correct",
      "experiment": "How to test this prediction",
      "quantitativeOutcome": "Expected numerical result (e.g., '50% growth inhibition')"
    }
  ],
  "hypothesesSummary": "Summary of all hypotheses showing how they connect mechanistically, with specific genes and pathways mentioned (4-5 sentences)"
}

Focus on hypotheses that:
- Connect multiple pathways or genes${experimentContext ? ` within the context of ${experimentContext}` : ''}
- Explain unexpected findings${experimentContext ? ` for this tissue/disease` : ''}
- Have therapeutic implications${experimentContext ? ` relevant to this experimental setting` : ''}
- Can be validated experimentally${experimentContext ? ` in this biological system` : ''}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const result = this.parseJSONResponse(response);

      // Validate gene/pathway names in hypotheses (hallucination prevention)
      const { genes = [] } = input;
      const validatedResult = this._validateHypotheses(result, themes, genes);

      console.log(`  Hypotheses Generated: ${validatedResult.hypotheses?.length || 0}`);
      console.log(`  High Confidence: ${validatedResult.hypotheses?.filter(h => h.confidence === 'high').length || 0}`);
      console.log(`  Novel Hypotheses: ${validatedResult.hypotheses?.filter(h => h.novelty === 'novel').length || 0}`);

      // Conditionally fact-check all factual fields (centralMechanisticModel, hypotheses mechanistic models)
      let finalResult = validatedResult;
      let references = [];
      let factCheckStats = null;

      if (WorkflowConfig.factChecking.enabled) {
        console.log('  Fact-checking enabled - verifying mechanistic hypotheses...');
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
          'Mechanistic Hypotheses'
        );

        finalResult = factCheckResult.revisedResult;
        references = factCheckResult.references;
        factCheckStats = factCheckResult.stats;
      } else {
        console.log('  Fact-checking disabled - skipping verification');
      }

      // Generate Mermaid diagram for mechanistic model
      const mermaidDiagram = await this._generateMermaidDiagram(finalResult, geneAnalysis, themes);

      // Generate report section for final report
      const reportSection = this._generateReportSection(finalResult, mermaidDiagram);

      return {
        ...finalResult, // Includes centralMechanisticModel and hypotheses
        references,
        factCheckStats,
        mermaidDiagram,
        reportSection  // NEW: For Option A implementation
      };

    } catch (error) {
      console.error(`  Error in Step ${this.stepNumber}:`, error.message);

      return {
        hypotheses: [],
        centralMechanisticModel: `Hypothesis generation could not be completed: ${error.message}`,
        keyPredictions: [],
        hypothesesSummary: ''
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
   * Validate gene and pathway names in hypotheses against input data
   * Logs warnings for potentially hallucinated references
   */
  _validateHypotheses(result, validatedThemes, inputGenes) {
    // Create validation sets with normalized pathway names
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

    const validGeneSet = new Set();
    inputGenes.forEach(gene => {
      const geneName = gene.name || gene.gene || gene.geneName;
      if (geneName) {
        validGeneSet.add(geneName);
      }
    });

    let totalWarnings = 0;

    // Validate hypotheses - check keyPlayers for gene/pathway references
    const validatedHypotheses = (result.hypotheses || []).map(hypothesis => {
      // Validate keyPlayers
      const validKeyPlayers = (hypothesis.keyPlayers || []).filter(player => {
        // Extract gene/pathway name (simple heuristic: first word or uppercase sequence)
        const match = player.match(/\b([A-Z][A-Z0-9]+)\b/);
        if (match) {
          const name = match[1];
          const normalized = this._normalizePathwayName(name);
          if (name.length > 2 && !validGeneSet.has(name) && !validPathwaySet.has(normalized)) {
            totalWarnings++;
            console.warn(`    ⚠️ Hypothesis references potentially hallucinated entity: "${name}"`);
          }
        }
        return true; // Keep all keyPlayers, just warn
      });

      return {
        ...hypothesis,
        keyPlayers: validKeyPlayers
      };
    });

    if (totalWarnings > 0) {
      console.warn(`  ⚠️ Found ${totalWarnings} potentially hallucinated reference(s) in hypotheses`);
    }

    return {
      ...result,
      hypotheses: validatedHypotheses,
      validation: {
        totalWarnings
      }
    };
  }

  /**
   * Generate Mermaid flowchart diagram for mechanistic model
   * @param {object} result - The validated hypothesis result
   * @param {object} geneAnalysis - Gene analysis from Step 3
   * @param {object} themes - Pathway themes from Step 2
   * @returns {string} Mermaid diagram syntax
   */
  async _generateMermaidDiagram(result, geneAnalysis, themes) {
    console.log('  Generating Mermaid diagram for mechanistic model...');

    const systemPrompt = `You are an expert in creating Mermaid flowchart diagrams for biological mechanisms.

CRITICAL: Generate a clean, readable Mermaid flowchart:
- Use ACTUAL gene symbols from the data with fold changes
- Show gene/pathway interactions as directional arrows
- Use SIMPLE node shapes: [] for all nodes (most compatible)
- Label edges with interaction types (activates, inhibits, transcribes, phosphorylates)
- Keep diagram focused (8-12 nodes maximum)
- Ensure all gene names match the input data

MERMAID SYNTAX RULES (STRICT):
- Use "graph TD" for top-down flow (or "graph LR" for left-right)
- Node format: NODEID[Label text] - use ONLY alphanumeric IDs (A, B, C, GENE1, GENE2)
- Edge format: NODE1 -->|relationship| NODE2
- NO special characters in node IDs (no hyphens, underscores, etc.)
- NO special characters in labels (use "+" instead of arrows, "fold" instead of × )
- Keep labels SHORT (max 30 characters)

EXAMPLE VALID SYNTAX:
graph TD
    A[TP53 -3.2 fold] --> B[Checkpoint loss]
    B --> C[MYC +2.5 fold]
    C --> D[Proliferation]
    E[PI3K pathway] --> D

RESPONSE FORMAT:
- Return ONLY valid Mermaid syntax
- NO markdown code blocks (no \`\`\`mermaid)
- NO explanatory text before or after
- Just the raw Mermaid code starting with "graph TD" or "graph LR"`;

    const hubGenesStr = geneAnalysis?.hubGenes?.slice(0, 8)
      .map(g => `${g.gene} (FC: ${g.foldChange?.toFixed(2)})`)
      .join(', ') || 'N/A';

    const regulatorsStr = geneAnalysis?.masterRegulators?.slice(0, 5)
      .map(m => `${m.gene} (FC: ${m.foldChange?.toFixed(2)})`)
      .join(', ') || 'N/A';

    const themesStr = themes?.themes?.slice(0, 5)
      .map(t => t.name)
      .join(', ') || 'N/A';

    const userPrompt = `Create a Mermaid flowchart diagram for this mechanistic model:

**Central Model:**
${result.centralMechanisticModel || 'Not available'}

**Key Hub Genes:**
${hubGenesStr}

**Master Regulators:**
${regulatorsStr}

**Main Pathway Themes:**
${themesStr}

**Key Hypotheses:**
${result.hypotheses?.slice(0, 3).map((h, i) => `${i+1}. ${h.hypothesis}`).join('\n') || 'Not available'}

Create a Mermaid flowchart showing:
1. Master regulators at the top (transcription factors, signaling molecules)
2. Hub genes in the middle (key effectors)
3. Pathway outcomes at the bottom
4. Directional arrows showing regulatory relationships
5. Edge labels describing interaction types

CRITICAL - Use EXACT gene symbols from above:
- Hub genes: ${hubGenesStr}
- Regulators: ${regulatorsStr}

Example format:
graph TD
    GENE1[GENE1 +2.3] -->|activates| GENE2[GENE2 +1.8]
    GENE2 -->|phosphorylates| GENE3[GENE3 -1.5]
    GENE3 -.->|inhibits| PATHWAY{{Pathway Name}}
    PATHWAY --> OUTCOME[(Biological Outcome)]

Return ONLY the Mermaid diagram code (starting with "graph TD").`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      // Extract clean Mermaid code
      let mermaidCode = response.content.trim();

      // Remove markdown code blocks if present
      mermaidCode = mermaidCode.replace(/```mermaid\n?/g, '').replace(/```\n?/g, '').trim();

      // Ensure it starts with graph declaration
      if (!mermaidCode.startsWith('graph')) {
        console.warn('  ⚠️ Mermaid diagram does not start with graph declaration');
        return this._generateFallbackDiagram(geneAnalysis);
      }

      // Sanitize the Mermaid code to remove problematic characters
      mermaidCode = this._sanitizeMermaidCode(mermaidCode);

      // Validate basic syntax
      if (!this._validateMermaidSyntax(mermaidCode)) {
        console.warn('  ⚠️ Mermaid diagram failed validation, using fallback');
        return this._generateFallbackDiagram(geneAnalysis);
      }

      console.log('  ✓ Mermaid diagram generated and validated successfully');
      return mermaidCode;

    } catch (error) {
      console.error('  Error generating Mermaid diagram:', error.message);
      return this._generateFallbackDiagram(geneAnalysis);
    }
  }

  /**
   * Sanitize Mermaid code to remove problematic characters
   */
  _sanitizeMermaidCode(code) {
    // Remove or replace problematic Unicode characters
    let sanitized = code
      // Remove special arrows and symbols
      .replace(/[→←↑↓⟶⟵⇒⇐]/g, '->')
      // Remove special math symbols
      .replace(/[×·]/g, 'x')
      // Remove fancy quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Remove other problematic Unicode
      .replace(/[^\x00-\x7F]/g, (char) => {
        // Keep only basic ASCII, replace others
        const code = char.charCodeAt(0);
        if (code > 127) {
          return ''; // Remove non-ASCII
        }
        return char;
      });

    return sanitized;
  }

  /**
   * Validate basic Mermaid syntax
   */
  _validateMermaidSyntax(code) {
    // Check for basic structure
    if (!code.includes('graph TD') && !code.includes('graph LR')) {
      return false;
    }

    // Check for at least one node and one arrow
    const hasNodes = /[A-Z0-9]+\[.+?\]/.test(code);
    const hasArrows = /-->/.test(code);

    return hasNodes && hasArrows;
  }

  /**
   * Generate a simple fallback diagram when LLM fails
   */
  _generateFallbackDiagram(geneAnalysis) {
    const upGenes = geneAnalysis?.hubGenes?.filter(g => g.foldChange > 0).slice(0, 3) || [];
    const downGenes = geneAnalysis?.hubGenes?.filter(g => g.foldChange < 0).slice(0, 3) || [];

    let diagram = 'graph TD\n';

    if (upGenes.length > 0) {
      upGenes.forEach((g, i) => {
        const id = `UP${i + 1}`;
        const fc = g.foldChange.toFixed(2);
        diagram += `    ${id}[${g.gene} +${fc} fold]\n`;
      });
    }

    if (downGenes.length > 0) {
      downGenes.forEach((g, i) => {
        const id = `DOWN${i + 1}`;
        const fc = Math.abs(g.foldChange).toFixed(2);
        diagram += `    ${id}[${g.gene} -${fc} fold]\n`;
      });
    }

    // Add simple connections
    if (upGenes.length > 0 && downGenes.length > 0) {
      diagram += `    UP1 --> DOWN1\n`;
    }

    return diagram;
  }

  /**
   * Generate Mechanistic Hypotheses report section (with citations from fact-checking)
   * @param {object} result - The fact-checked step result
   * @param {string} mermaidDiagram - Mermaid diagram code
   * @returns {string} Markdown formatted section
   */
  _generateReportSection(result, mermaidDiagram) {
    let section = '## 4. Mechanistic Model\n\n';

    // Add central mechanistic model (has citations from fact-checking)
    if (result.centralMechanisticModel) {
      let cleanModel = this._cleanSectionMarkers(result.centralMechanisticModel);

      // Remove hypothesis disclaimer blocks that are added during fact-checking
      // The fact-checker adds "Hypothesis 1\nNo validated..." blocks after the main summary
      // These should be removed since detailed hypotheses are formatted separately below
      // Pattern: Keep text before first standalone "Hypothesis N", remove everything after
      cleanModel = cleanModel.replace(/\n\s*Hypothesis\s+\d+[\s\S]*/i, '').trim();

      // Remove leading ** artifacts
      cleanModel = cleanModel.replace(/^\*\*\s*\n/, '').trim();

      // Remove horizontal rules
      cleanModel = cleanModel.replace(/^[\-\*_]{3,}\s*$/gm, '').trim();

      // Clean up multiple blank lines
      cleanModel = cleanModel.replace(/\n\n\n+/g, '\n\n');

      if (cleanModel) {
        section += cleanModel + '\n\n';
      }
    }

    // Add Mermaid diagram
    if (mermaidDiagram) {
      section += '### Mechanistic Flowchart\n\n';
      section += '```mermaid\n';
      section += mermaidDiagram + '\n';
      section += '```\n\n';
    }

    // Add testable hypotheses section
    section += '## 7. Testable Hypotheses\n\n';

    // Add hypotheses summary (has citations from fact-checking)
    if (result.hypothesesSummary) {
      let cleanSummary = this._cleanSectionMarkers(result.hypothesesSummary);

      // Remove hypothesis disclaimer blocks (same as above)
      cleanSummary = cleanSummary.replace(/\n\s*Hypothesis\s+\d+[\s\S]*/i, '').trim();

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

    // Detailed hypotheses
    if (result.hypotheses && result.hypotheses.length > 0) {
      result.hypotheses.forEach((h, idx) => {
        const confidence = h.confidence === 'high' ? '⭐⭐⭐' :
                          h.confidence === 'medium' ? '⭐⭐' : '⭐';
        const noveltyBadge = h.novelty === 'novel' ? '🆕' :
                            h.novelty === 'builds-on-known' ? '🔨' : '✓';

        section += `### Hypothesis ${idx + 1}: ${h.hypothesis} ${confidence} ${noveltyBadge}\n\n`;

        // Mechanistic model (has citations from fact-checking)
        if (h.mechanisticModel) {
          section += `**Mechanistic Model:** ${this._cleanSectionMarkers(h.mechanisticModel)}\n\n`;
        }

        // Evidence supporting
        if (h.evidenceSupporting && h.evidenceSupporting.length > 0) {
          section += '**Supporting Evidence:**\n';
          h.evidenceSupporting.forEach(ev => {
            section += `- ${ev}\n`;
          });
          section += '\n';
        }

        // Testability
        if (h.testability) {
          section += '**Experimental Tests:**\n';
          section += `- **Approach 1:** ${h.testability.approach1}\n`;
          if (h.testability.approach2) {
            section += `- **Approach 2:** ${h.testability.approach2}\n`;
          }
          section += `- **Expected Outcome:** ${h.testability.expectedOutcome}\n\n`;
        }

        // Quantitative prediction
        if (h.quantitativePrediction) {
          section += `**Quantitative Prediction:** ${h.quantitativePrediction}\n\n`;
        }

        // Confidence rationale (has citations from fact-checking)
        if (h.confidenceRationale) {
          section += `**Confidence Rationale:** ${this._cleanSectionMarkers(h.confidenceRationale)}\n\n`;
        }

        section += '---\n\n';
      });
    }

    // Key predictions
    if (result.keyPredictions && result.keyPredictions.length > 0) {
      section += '### Key Testable Predictions\n\n';
      section += '| Prediction | Experimental Test | Expected Outcome |\n';
      section += '|------------|-------------------|------------------|\n';

      result.keyPredictions.forEach(kp => {
        section += `| ${kp.prediction} | ${kp.experiment} | ${kp.quantitativeOutcome} |\n`;
      });

      section += '\n';
    }

    return section;
  }
}

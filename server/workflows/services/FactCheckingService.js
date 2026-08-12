// Fact-Checking Service for Workflow Steps
import axios from 'axios';
import { WorkflowConfig } from '../config.js';
import { LLMFactory } from '../../llm/LLMFactory.js';

export class FactCheckingService {
  constructor() {
    this.config = WorkflowConfig.factChecking;
    this.llm = LLMFactory.create(WorkflowConfig.llm.provider, {
      model: WorkflowConfig.llm.model,
      temperature: 0.3, // Lower temperature for corrections
      maxTokens: 4096
    });
  }

  /**
   * Fact-check all factual fields in step result and revise if needed
   * @param {object} result - Step output object with factual fields
   * @param {object} context - Context (genes, pathways, themes, experimentalContext, organismId)
   * @param {string} stepName - Step name for logging
   * @returns {object} { revisedResult, references, stats, hasRefutedClaims }
   */
  async factCheckAndRevise(result, context, stepName) {
    console.log(`  📡 Fact-checking ${stepName}...`);
    console.log(`  DEBUG factCheckAndRevise - context received:`, JSON.stringify({
      hasContextFields: !!context.contextFields,
      contextFields: context.contextFields,
      experimentalContext: context.experimentalContext,
      analysisId: context.analysisId,
      organismId: context.organismId
    }, null, 2));

    try {
      // 1. Extract all factual sections from result
      const sections = this.extractFactualSections(result, stepName);

      if (sections.length === 0) {
        console.log(`  ℹ️ No factual content to check in ${stepName}`);
        return {
          revisedResult: result,
          references: [],
          stats: null,
          hasRefutedClaims: false,
          hasUnverifiedClaims: false,
          refutedClaims: [],
          removedClaims: []
        };
      }

      // 2. Concatenate all sections into one text
      const concatenatedText = this.concatenateSections(sections);
      console.log(`  📝 Extracted ${sections.length} sections (${concatenatedText.length} chars)`);

      // 3. Call fact-checking API once
      const factCheckResult = await this._callFactCheckAPI(concatenatedText, context);

      if (!factCheckResult.success) {
        console.warn(`  ⚠️ Fact-checking failed for ${stepName}, using original result`);
        return {
          revisedResult: result,
          references: [],
          stats: null,
          hasRefutedClaims: false,
          hasUnverifiedClaims: false,
          refutedClaims: [],
          removedClaims: [],
          error: factCheckResult.error
        };
      }

      // 4. Check for refuted and unverified claims
      const refutedClaims = factCheckResult.details?.filter(c => c.refuted === true) || [];
      const unverifiedClaims = factCheckResult.details?.filter(c =>
        !c.verified && !c.refuted
      ) || [];
      const hasRefutedClaims = refutedClaims.length > 0;
      const hasUnverifiedClaims = unverifiedClaims.length > 0;

      // Log detailed API response
      console.log(`\n  ✅ ========== FACT-CHECK RESPONSE ==========`);
      console.log(`  📊 Verification Summary:`);
      console.log(`     - Total Claims Extracted: ${factCheckResult.verification_summary.total_claims_extracted}`);
      console.log(`     - Claims Verified: ${factCheckResult.verification_summary.claims_verified}`);
      console.log(`     - Claims Refuted: ${factCheckResult.verification_summary.claims_refuted || 0}`);
      console.log(`     - Claims Unverified: ${factCheckResult.verification_summary.claims_unverified || 0}`);
      console.log(`     - Average Confidence: ${factCheckResult.verification_summary.average_confidence?.toFixed(2) || 'N/A'}`);
      console.log(`     - Total References: ${factCheckResult.references?.length || 0}`);
      console.log(`     - Processing Time: ${factCheckResult.verification_summary.processing_time_seconds?.toFixed(1) || 'N/A'}s`);

      // Log individual claims and their statuses
      if (factCheckResult.details && factCheckResult.details.length > 0) {
        console.log(`\n  📋 Individual Claims (${factCheckResult.details.length}):`);
        factCheckResult.details.forEach((claim, index) => {
          const status = claim.verified ? '✓ VERIFIED' : (claim.refuted ? '✗ REFUTED' : '⊘ UNVERIFIED');
          const confidence = claim.confidence ? ` (confidence: ${claim.confidence.toFixed(2)})` : '';
          console.log(`     ${index + 1}. [${status}]${confidence}`);
          console.log(`        Claim: "${claim.claim.substring(0, 100)}${claim.claim.length > 100 ? '...' : ''}"`);
          if (claim.reference_ids && claim.reference_ids.length > 0) {
            console.log(`        References: [${claim.reference_ids.join(', ')}]`);
          }
          if (claim.refuted && claim.correction) {
            console.log(`        ⚠️ Correction: "${claim.correction.corrected_fact?.substring(0, 100) || 'N/A'}"`);
          }
        });
      }

      console.log(`  ==========================================\n`);

      if (hasRefutedClaims) {
        console.log(`  ⚠️ Found ${refutedClaims.length} refuted claims - correcting...`);
      }
      if (hasUnverifiedClaims) {
        console.log(`  ⚠️ Found ${unverifiedClaims.length} unverified claims - removing...`);
      }

      // 5. Revise if needed
      let verifiedText = factCheckResult.verified_text;

      // DEBUG: Check if verified_text contains citations
      console.log(`\n  🔍 ========== VERIFIED TEXT CITATION CHECK ==========`);
      const citationPattern = /\[(\d+)\]/g;
      const citationsFound = verifiedText.match(citationPattern) || [];
      console.log(`  📝 Verified text length: ${verifiedText.length} chars`);
      console.log(`  🔢 Citations found in verified_text: ${citationsFound.length}`);
      if (citationsFound.length > 0) {
        console.log(`  ✅ Citation numbers: ${citationsFound.join(' ')}`);
        // Show first 800 chars with citations
        console.log(`  📄 Sample text with citations (first 800 chars):`);
        console.log(`  ${verifiedText.substring(0, 800)}${verifiedText.length > 800 ? '...' : ''}`);
      } else {
        console.log(`  ❌ NO CITATIONS found in verified_text from API!`);
        // Show first 500 chars anyway
        console.log(`  📄 Sample text (first 500 chars):`);
        console.log(`  ${verifiedText.substring(0, 500)}${verifiedText.length > 500 ? '...' : ''}`);
      }
      console.log(`  ====================================================\n`);

      if (hasRefutedClaims || hasUnverifiedClaims) {
        verifiedText = await this._reviseWithCorrections(
          concatenatedText,
          verifiedText,
          refutedClaims,
          unverifiedClaims,
          stepName
        );
        console.log(`  ✓ Text revised with corrections and removals`);

        // DEBUG: Check citations after LLM revision
        const citationsAfterRevision = verifiedText.match(citationPattern) || [];
        console.log(`\n  🔍 After LLM revision: ${citationsAfterRevision.length} citations`);
        if (citationsAfterRevision.length > 0) {
          console.log(`  ✅ Citations preserved/added: ${citationsAfterRevision.join(' ')}`);
        } else {
          console.log(`  ⚠️ No citations after revision (LLM may have removed them)`);
        }
      }

      // 6. Parse verified text back into sections
      const verifiedSections = this.parseVerifiedSections(verifiedText);

      // DEBUG: Check citations in parsed sections
      console.log(`\n  🔍 After parsing into sections:`);
      let totalCitationsInSections = 0;
      for (const [sectionId, sectionText] of Object.entries(verifiedSections)) {
        const sectionCitations = (sectionText.match(citationPattern) || []).length;
        totalCitationsInSections += sectionCitations;
        if (sectionCitations > 0) {
          console.log(`    ✅ Section "${sectionId}": ${sectionCitations} citations`);
          // Show first 200 chars of sections with citations
          console.log(`       Sample: ${sectionText.substring(0, 200)}${sectionText.length > 200 ? '...' : ''}`);
        }
      }
      console.log(`  📊 Total citations across all sections: ${totalCitationsInSections}`);

      // 7. Update result with verified sections
      const revisedResult = this.mergeVerifiedSections(result, verifiedSections, stepName);

      // DEBUG: Check citations in final merged result
      console.log(`\n  🔍 After merging back into result object:`);
      this._debugLogCitationsInResult(revisedResult, stepName);

      return {
        revisedResult,
        references: factCheckResult.references || [],
        stats: {
          claims_verified: factCheckResult.verification_summary.claims_verified,
          claims_refuted: factCheckResult.verification_summary.claims_refuted || 0,
          claims_unverified: factCheckResult.verification_summary.claims_unverified || 0,
          claims_removed: unverifiedClaims.length,
          total_claims: factCheckResult.verification_summary.total_claims_extracted,
          average_confidence: factCheckResult.verification_summary.average_confidence,
          total_references: factCheckResult.references?.length || 0,
          sections_checked: sections.length
        },
        hasRefutedClaims,
        hasUnverifiedClaims,
        refutedClaims: refutedClaims.map(rc => ({
          original: rc.claim,
          correction: rc.correction?.corrected_fact,
          explanation: rc.correction?.explanation
        })),
        removedClaims: unverifiedClaims.map(uc => uc.claim)
      };

    } catch (error) {
      console.error(`  ❌ Fact-checking error for ${stepName}:`, error.message);
      return {
        revisedResult: result,
        references: [],
        stats: null,
        hasRefutedClaims: false,
        hasUnverifiedClaims: false,
        refutedClaims: [],
        removedClaims: [],
        error: error.message
      };
    }
  }

  /**
   * Concatenate multiple text fields with section markers
   * @param {Array<{id: string, text: string}>} sections - Array of {id, text} objects
   * @returns {string} Concatenated text with delimiters
   */
  concatenateSections(sections) {
    return sections
      .filter(s => s.text && s.text.trim())
      .map(s => `===SECTION:${s.id}===\n${s.text}`)
      .join('\n\n');
  }

  /**
   * Parse verified text back into sections
   * @param {string} verifiedText - Text from API with section markers
   * @returns {Object} Map of section id to verified text
   */
  parseVerifiedSections(verifiedText) {
    const sections = {};
    const regex = /===SECTION:(\w+)===\s*([\s\S]*?)(?=\n===SECTION:|$)/g;

    let match;
    while ((match = regex.exec(verifiedText)) !== null) {
      const [, id, text] = match;
      sections[id] = text.trim();
    }

    return sections;
  }

  /**
   * Extract factual text from step output
   * @param {object} result - Step output with potentially factual fields
   * @param {string} stepName - Step name
   * @returns {Array<{id: string, text: string}>} Sections to fact-check
   */
  extractFactualSections(result, stepName) {
    const sections = [];

    switch (stepName) {
      case 'Overall Summary':
        if (result.interpretation) {
          sections.push({ id: 'interpretation', text: result.interpretation });
        }
        if (result.summary) {
          sections.push({ id: 'summary', text: result.summary });
        }
        if (result.mainThemes && result.mainThemes.length > 0) {
          sections.push({
            id: 'mainThemes',
            text: result.mainThemes.join('\n')
          });
        }
        break;

      case 'Gene Analysis':
        if (result.interpretation) {
          sections.push({ id: 'interpretation', text: result.interpretation });
        }
        if (result.hubGenes && result.hubGenes.length > 0) {
          sections.push({
            id: 'hubGenes',
            text: result.hubGenes.map(g => `**${g.gene}**: ${g.role}`).join('\n')
          });
        }
        if (result.masterRegulators && result.masterRegulators.length > 0) {
          sections.push({
            id: 'masterRegulators',
            text: result.masterRegulators.map(m => `**${m.gene}**: ${m.mechanism}`).join('\n')
          });
        }
        break;

      case 'Pathway Mechanisms':
        if (result.mechanisticSummary) {
          sections.push({ id: 'mechanisticSummary', text: result.mechanisticSummary });
        }
        if (result.pathwayMechanisms && result.pathwayMechanisms.length > 0) {
          sections.push({
            id: 'pathwayMechanisms',
            text: result.pathwayMechanisms.map(pm =>
              `**${pm.pathway}**:\nFunction: ${pm.biologicalFunction}\nCrosstalk: ${pm.crosstalk?.join('; ') || 'N/A'}\nUpstream: ${pm.upstreamRegulators?.join(', ') || 'N/A'}\nDownstream: ${pm.downstreamEffects?.join(', ') || 'N/A'}`
            ).join('\n\n')
          });
        }
        break;

      case 'Mechanistic Hypotheses':
        if (result.centralMechanisticModel) {
          sections.push({ id: 'centralMechanisticModel', text: result.centralMechanisticModel });
        }
        if (result.hypotheses && result.hypotheses.length > 0) {
          sections.push({
            id: 'hypotheses',
            text: result.hypotheses.map((h, i) =>
              `**Hypothesis ${i + 1}**: ${h.hypothesis}\n${h.mechanisticModel}`
            ).join('\n\n')
          });
        }
        break;

      case 'Therapeutic Implications':
        if (result.therapeuticSummary) {
          sections.push({ id: 'therapeuticSummary', text: result.therapeuticSummary });
        }
        if (result.drugTargets && result.drugTargets.length > 0) {
          sections.push({
            id: 'drugTargets',
            text: result.drugTargets.map(dt =>
              `**${dt.target}**: ${dt.rationale}\nDrugs: ${dt.existingDrugs?.map(d => `${d.drug} (${d.status}, ${d.mechanism})`).join('; ') || 'None'}`
            ).join('\n\n')
          });
        }
        if (result.repurposingOpportunities && result.repurposingOpportunities.length > 0) {
          sections.push({
            id: 'repurposing',
            text: result.repurposingOpportunities.map(ro =>
              `**${ro.drug}** (Current: ${ro.currentUse}): ${ro.supportingEvidence}`
            ).join('\n\n')
          });
        }
        break;

      case 'Group Themes':
        // Extract overall summary explaining theme-context relationships
        if (result.themesSummary) {
          sections.push({
            id: 'themesSummary',
            text: result.themesSummary
          });
        }

        // Extract each theme WITH pathways and keyGenes
        if (result.themes && result.themes.length > 0) {
          result.themes.forEach((theme, i) => {
            // Extract pathway names
            const pathwayNames = theme.pathways?.map(p =>
              typeof p === 'string' ? p : (p.name || p.pathwayName)
            ) || [];

            // Build factual claim text
            const themeText = [
              `**Theme: ${theme.name}**`,
              `Description: ${theme.description}`,
              `Pathways grouped together: ${pathwayNames.join('; ')}`,
              theme.keyGenes?.length > 0
                ? `Key driver genes in this theme: ${theme.keyGenes.join(', ')}`
                : ''
            ].filter(Boolean).join('\n');

            sections.push({
              id: `theme_${i}`,
              text: themeText
            });
          });
        }
        break;

      case 'Novel Findings':
        if (result.noveltyInterpretation) {
          sections.push({ id: 'noveltyInterpretation', text: result.noveltyInterpretation });
        }
        // Note: Could also fact-check individual finding descriptions,
        // but they're complex nested objects. For now, focus on main interpretation.
        break;

      case 'Literature Contextualization':
        if (result.literatureContext) {
          sections.push({ id: 'literatureContext', text: result.literatureContext });
        }
        break;
    }

    return sections;
  }

  /**
   * Clean section markers from text
   * @param {string} text - Text that may contain section markers
   * @returns {string} Cleaned text
   */
  _cleanSectionMarkers(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    return text.replace(/===SECTION:[^=]+===/g, '').trim();
  }

  /**
   * Merge verified sections back into result object
   * @param {object} result - Original step result
   * @param {object} verifiedSections - Map of section id to verified text
   * @param {string} stepName - Step name
   * @returns {object} Updated result with verified text
   */
  mergeVerifiedSections(result, verifiedSections, stepName) {
    const updated = { ...result };

    // Clean all section markers from verified sections before merging
    const cleanedSections = {};
    for (const [key, value] of Object.entries(verifiedSections)) {
      cleanedSections[key] = this._cleanSectionMarkers(value);
    }
    verifiedSections = cleanedSections;

    switch (stepName) {
      case 'Overall Summary':
        if (verifiedSections.interpretation) {
          updated.interpretation = verifiedSections.interpretation;
        }
        if (verifiedSections.summary) {
          updated.summary = verifiedSections.summary;
        }
        if (verifiedSections.mainThemes) {
          // Parse main themes back from verified text
          const themes = verifiedSections.mainThemes.split('\n').filter(t => t.trim());
          updated.mainThemes = themes;
        }
        break;

      case 'Gene Analysis':
        if (verifiedSections.interpretation) {
          updated.interpretation = verifiedSections.interpretation;
        }
        if (verifiedSections.hubGenes && updated.hubGenes) {
          // Parse hub genes back from verified text
          const lines = verifiedSections.hubGenes.split('\n').filter(l => l.trim());
          lines.forEach(line => {
            const match = line.match(/\*\*([^:]+)\*\*:\s*(.+)/);
            if (match) {
              const [, gene, role] = match;
              const hubGene = updated.hubGenes.find(g => g.gene === gene.trim());
              if (hubGene) {
                hubGene.role = role.trim();
              }
            }
          });
        }
        if (verifiedSections.masterRegulators && updated.masterRegulators) {
          const lines = verifiedSections.masterRegulators.split('\n').filter(l => l.trim());
          lines.forEach(line => {
            const match = line.match(/\*\*([^:]+)\*\*:\s*(.+)/);
            if (match) {
              const [, gene, mechanism] = match;
              const regulator = updated.masterRegulators.find(m => m.gene === gene.trim());
              if (regulator) {
                regulator.mechanism = mechanism.trim();
              }
            }
          });
        }
        break;

      case 'Pathway Mechanisms':
        if (verifiedSections.mechanisticSummary) {
          updated.mechanisticSummary = verifiedSections.mechanisticSummary;
        }
        if (verifiedSections.pathwayMechanisms && updated.pathwayMechanisms) {
          // Parse pathway mechanisms - match by pathway name
          const pathwayBlocks = verifiedSections.pathwayMechanisms.split('\n\n');
          pathwayBlocks.forEach(block => {
            const pathwayMatch = block.match(/\*\*([^*]+)\*\*/);
            if (pathwayMatch) {
              const pathwayName = pathwayMatch[1].trim();
              const pm = updated.pathwayMechanisms.find(p => p.pathway === pathwayName);
              if (pm) {
                const functionMatch = block.match(/Function:\s*(.+?)(?=\n|$)/);
                if (functionMatch) pm.biologicalFunction = functionMatch[1].trim();
              }
            }
          });
        }
        break;

      case 'Mechanistic Hypotheses':
        if (verifiedSections.centralMechanisticModel) {
          updated.centralMechanisticModel = verifiedSections.centralMechanisticModel;
        }
        if (verifiedSections.hypotheses && updated.hypotheses) {
          // Parse hypotheses back
          const hypothesisBlocks = verifiedSections.hypotheses.split('\n\n');
          hypothesisBlocks.forEach((block, i) => {
            if (updated.hypotheses[i]) {
              const lines = block.split('\n');
              const hypothesisLine = lines.find(l => l.includes('**Hypothesis'));
              if (hypothesisLine) {
                const match = hypothesisLine.match(/\*\*Hypothesis \d+\*\*:\s*(.+)/);
                if (match) updated.hypotheses[i].hypothesis = match[1].trim();
              }
              // Rest is mechanistic model
              const modelText = lines.slice(1).join('\n').trim();
              if (modelText) updated.hypotheses[i].mechanisticModel = modelText;
            }
          });
        }
        break;

      case 'Therapeutic Implications':
        if (verifiedSections.therapeuticSummary) {
          updated.therapeuticSummary = verifiedSections.therapeuticSummary;
        }
        if (verifiedSections.drugTargets && updated.drugTargets) {
          // Parse drug targets back
          const targetBlocks = verifiedSections.drugTargets.split('\n\n');
          targetBlocks.forEach(block => {
            const targetMatch = block.match(/\*\*([^:]+)\*\*:\s*(.+?)(?=\nDrugs:|$)/s);
            if (targetMatch) {
              const [, targetName, rationale] = targetMatch;
              const dt = updated.drugTargets.find(t => t.target === targetName.trim());
              if (dt) {
                dt.rationale = rationale.trim();
              }
            }
          });
        }
        if (verifiedSections.repurposing && updated.repurposingOpportunities) {
          // Parse repurposing opportunities
          const repurposingBlocks = verifiedSections.repurposing.split('\n\n');
          repurposingBlocks.forEach(block => {
            const drugMatch = block.match(/\*\*([^*]+)\*\*\s*\(Current:\s*([^)]+)\):\s*(.+)/);
            if (drugMatch) {
              const [, drugName, currentUse, evidence] = drugMatch;
              const ro = updated.repurposingOpportunities.find(r => r.drug === drugName.trim());
              if (ro) {
                ro.supportingEvidence = evidence.trim();
              }
            }
          });
        }
        break;

      case 'Group Themes':
        // Update overall themesSummary
        if (verifiedSections.themesSummary) {
          updated.themesSummary = verifiedSections.themesSummary;
        }

        // Update individual theme descriptions and keyGenes
        if (updated.themes) {
          const citationPattern = /\[(\d+)\]/g;
          updated.themes.forEach((theme, i) => {
            const verifiedText = verifiedSections[`theme_${i}`];
            if (verifiedText) {
              // DEBUG: Log raw verified text for this theme
              const citationsInRaw = (verifiedText.match(citationPattern) || []).length;
              console.log(`\n      🔍 DEBUG merging theme_${i}:`);
              console.log(`         Raw verified text (${verifiedText.length} chars, ${citationsInRaw} citations):`);
              console.log(`         ${verifiedText.substring(0, 300)}${verifiedText.length > 300 ? '...' : ''}`);

              const lines = verifiedText.split('\n').filter(l => l.trim());

              // Extract verified theme name
              const nameMatch = lines.find(l => l.startsWith('**Theme:'))
                ?.match(/\*\*Theme:\s*(.+?)\*\*/);
              if (nameMatch) {
                theme.name = nameMatch[1].trim();
              }

              // Extract verified description
              const descLine = lines.find(l => l.startsWith('Description:'));
              console.log(`         Description line found: ${descLine ? 'YES' : 'NO'}`);
              if (descLine) {
                console.log(`         Full description line: "${descLine}"`);
              }

              const descMatch = descLine?.replace('Description:', '').trim();
              if (descMatch) {
                const citationsInDesc = (descMatch.match(citationPattern) || []).length;
                console.log(`         Extracted description: ${descMatch.length} chars, ${citationsInDesc} citations`);
                console.log(`         Extracted text: "${descMatch}"`);
                theme.description = descMatch;
              }

              // Extract verified keyGenes
              const keyGenesLine = lines.find(l => l.startsWith('Key driver genes'));
              if (keyGenesLine) {
                const genes = keyGenesLine
                  .replace(/Key driver genes.*?:\s*/, '')
                  .split(',')
                  .map(g => g.trim())
                  .filter(g => g);
                theme.keyGenes = genes;
              }

              // NOTE: pathways array is NOT modified - only descriptions are fact-checked
            }
          });
        }
        break;

      case 'Novel Findings':
        if (verifiedSections.noveltyInterpretation) {
          updated.noveltyInterpretation = verifiedSections.noveltyInterpretation;
        }
        // Note: expectedFindings, unexpectedFindings, and novelCandidates arrays
        // have text fields that are fact-checked, but the merging is complex
        // For now, only the overall noveltyInterpretation is updated
        break;

      case 'Literature Contextualization':
        if (verifiedSections.literatureContext) {
          updated.literatureContext = verifiedSections.literatureContext;
        }
        break;
    }

    return updated;
  }

  async _reviseWithCorrections(originalText, verifiedText, refutedClaims, unverifiedClaims, stepName) {
    const systemPrompt = `You are a scientific editor correcting factual errors in ${stepName} output.

Your task:
1. Replace refuted claims with corrected facts
2. Remove unverified claims entirely (insufficient evidence)
3. Maintain the original structure with section markers (===SECTION:id===)
4. Keep all verified citations [1][2][3] from the verified text
5. Add new citations for corrected facts
6. Ensure smooth, natural language flow after removals

CRITICAL: Preserve all ===SECTION:xxx=== markers exactly as they appear!`;

    const userPrompt = `Revise this text by correcting refuted claims and removing unverified claims:

**Original Text:**
${originalText}

**Verified Text (with citations):**
${verifiedText}

${refutedClaims.length > 0 ? `**Refuted Claims to Correct:**
${refutedClaims.map((rc, i) => `
${i + 1}. REFUTED: "${rc.claim}"
   CORRECTION: "${rc.correction?.corrected_fact}"
   EXPLANATION: ${rc.correction?.explanation}
   REFERENCES: ${rc.correction?.references?.map(r => `[${r}]`).join('')}
`).join('\n')}` : ''}

${unverifiedClaims.length > 0 ? `**Unverified Claims to Remove:**
${unverifiedClaims.map((uc, i) => `
${i + 1}. UNVERIFIED: "${uc.claim}"
   REASON: Insufficient evidence in literature - remove this claim entirely
`).join('\n')}` : ''}

**Instructions:**
1. Replace each refuted claim with its correction
2. Remove each unverified claim completely
3. Keep all other verified content and citations from verified text
4. PRESERVE all ===SECTION:xxx=== markers exactly
5. Ensure corrected facts include their reference citations
6. Make the text read naturally with corrections and removals integrated
7. Adjust surrounding text flow after removals if needed

Output the fully revised text:`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      return response.content.trim();

    } catch (error) {
      console.error(`    Error revising text:`, error.message);
      // Fallback: return verified text without further revision
      return verifiedText;
    }
  }

  /**
   * Fetch organism name from organismId
   * @param {string} organismId - MongoDB ObjectId of organism
   * @returns {Promise<string|null>} Organism name (e.g., "Homo sapiens") or null
   */
  /**
   * Fetch organismId (taxId) from AnalysisConfig collection
   * @param {string} analysisId - Analysis ID
   * @returns {Promise<string|null>} Organism ID (taxId) or null
   */
  async _getOrganismIdFromAnalysis(analysisId) {
    if (!analysisId) return null;

    try {
      const config = await DBCollections.AnalysisConfig.findOneAsync({
        analysisId: analysisId,
        key: 'taxId'
      });
      return config?.value || null;
    } catch (error) {
      console.warn(`  ⚠️ Failed to fetch organismId from AnalysisConfig: ${error.message}`);
      return null;
    }
  }

  /**
   * Map scientific organism name to common name for fact-checking API
   * @param {string} scientificName - Scientific name (e.g., "Homo sapiens")
   * @returns {string} Common name (e.g., "human")
   */
  _mapOrganismToCommonName(scientificName) {
    if (!scientificName) return '';

    const mapping = {
      'Homo sapiens': 'human',
      'Mus musculus': 'mouse',
      'Rattus norvegicus': 'rat',
      'Danio rerio': 'zebrafish',
      'Drosophila melanogaster': 'fruit fly',
      'Caenorhabditis elegans': 'nematode',
      'Saccharomyces cerevisiae': 'yeast',
      'Arabidopsis thaliana': 'thale cress',
      'Gallus gallus': 'chicken',
      'Sus scrofa': 'pig',
      'Bos taurus': 'cattle',
      'Canis familiaris': 'dog',
      'Felis catus': 'cat',
      'Macaca mulatta': 'rhesus macaque'
    };

    return mapping[scientificName] || scientificName.toLowerCase();
  }

  /**
   * Fallback mapping for common taxIds when database query fails
   * @param {string|number} organismId - taxId or MongoDB _id
   * @returns {string|null} Common organism name or null
   */
  _getFallbackOrganismName(organismId) {
    const taxIdFallbacks = {
      '9606': 'human',
      '10090': 'mouse',
      '10116': 'rat',
      '7955': 'zebrafish',
      '7227': 'fruit fly',
      '6239': 'nematode',
      '4932': 'yeast',
      '3702': 'thale cress',
      '9031': 'chicken',
      '9823': 'pig',
      '9913': 'cattle',
      '9615': 'dog',
      '9685': 'cat'
    };

    const taxIdStr = String(organismId);
    if (taxIdFallbacks[taxIdStr]) {
      console.log(`     - Using fallback for taxId ${taxIdStr}: "${taxIdFallbacks[taxIdStr]}"`);
      return taxIdFallbacks[taxIdStr];
    }

    return null;
  }

  async _getOrganismName(organismId) {
    if (!organismId) {
      console.log(`     - No organismId provided, returning null`);
      return null;
    }

    try {
      // organismId can be either MongoDB _id or taxId (e.g., "9606" for human)
      // Try both queries
      console.log(`     - Trying to find organism by _id: ${organismId}`);
      let organism = await DBCollections.Organism.findOneAsync({ _id: organismId });
      console.log(`     - Query by _id result:`, organism ? JSON.stringify(organism) : 'NULL');

      if (!organism) {
        // If not found by _id, try taxId (common case from AnalysisConfig)
        const taxIdNum = parseInt(organismId);
        console.log(`     - Trying to find organism by taxId: ${taxIdNum}`);
        organism = await DBCollections.Organism.findOneAsync({ taxId: taxIdNum });
        console.log(`     - Query by taxId result:`, organism ? JSON.stringify(organism) : 'NULL');
      }

      if (!organism) {
        console.log(`     - Organism not found in database, trying fallback...`);
        const fallback = this._getFallbackOrganismName(organismId);
        if (fallback) {
          return fallback;
        }
        console.log(`     - No fallback available for organismId: ${organismId}`);
        return null;
      }

      // Map scientific name to common name for fact-checking API
      const scientificName = organism.name || organism.scientificName || organism.commonName || organism.species;
      if (!scientificName) {
        console.log(`     - Organism document has no name field, trying fallback...`);
        const fallback = this._getFallbackOrganismName(organismId);
        return fallback || null;
      }

      const commonName = this._mapOrganismToCommonName(scientificName);
      console.log(`     - Mapped "${scientificName}" → "${commonName}"`);
      return commonName;
    } catch (error) {
      console.warn(`  ⚠️ Failed to fetch organism: ${error.message}, trying fallback...`);
      const fallback = this._getFallbackOrganismName(organismId);
      return fallback || null;
    }
  }

  /**
   * Map TCGA cancer type to full disease name for fact-checking API
   * @param {string} cancerType - Cancer type from UI (e.g., "Kidney Chromophobe (KICH)")
   * @returns {string} Full disease name (e.g., "chromophobe renal cell carcinoma")
   */
  _mapCancerTypeToDiseaseName(cancerType) {
    if (!cancerType) return '';

    const mapping = {
      // Renal cancers
      'Kidney Chromophobe': 'chromophobe renal cell carcinoma',
      'Kidney Renal Clear Cell Carcinoma': 'clear cell renal cell carcinoma',
      'Kidney Renal Papillary Cell Carcinoma': 'papillary renal cell carcinoma',

      // Brain cancers
      'Glioblastoma Multiforme': 'glioblastoma',
      'Lower Grade Glioma': 'glioma',

      // Common cancers
      'Breast Invasive Carcinoma': 'breast cancer',
      'Lung Adenocarcinoma': 'lung adenocarcinoma',
      'Lung Squamous Cell Carcinoma': 'lung squamous cell carcinoma',
      'Prostate Adenocarcinoma': 'prostate cancer',
      'Colon Adenocarcinoma': 'colon adenocarcinoma',
      'Rectal Adenocarcinoma': 'rectal adenocarcinoma',
      'Liver Hepatocellular Carcinoma': 'hepatocellular carcinoma',
      'Bladder Urothelial Carcinoma': 'bladder cancer',
      'Thyroid Carcinoma': 'thyroid cancer',
      'Stomach Adenocarcinoma': 'gastric adenocarcinoma',
      'Pancreatic Adenocarcinoma': 'pancreatic adenocarcinoma',
      'Ovarian Serous Cystadenocarcinoma': 'ovarian cancer',
      'Skin Cutaneous Melanoma': 'melanoma',
      'Acute Myeloid Leukemia': 'acute myeloid leukemia'
    };

    return mapping[cancerType] || cancerType.toLowerCase();
  }

  /**
   * Extract structured biological context from UI contextFields
   * Preferred over string parsing when structured data is available
   *
   * @param {object} contextFields - Structured fields from UI {template, tissue, cancer_type, disease, etc.}
   * @returns {object} Structured context {disease, tissue, additional}
   */
  _extractStructuredContext(contextFields) {
    if (!contextFields || typeof contextFields !== 'object') {
      return { disease: '', tissue: '', additional: '' };
    }

    let tissue = '';
    let disease = '';
    let additional = '';

    // NEW SIMPLIFIED FORMAT (5 fields: tissueType, disease, condition, control, description)
    if (contextFields.tissueType) {
      tissue = contextFields.tissueType;
    }

    if (contextFields.disease) {
      disease = contextFields.disease;
    }

    // Add condition, control, and description to additional context
    if (contextFields.condition) {
      additional = contextFields.condition;
    }

    if (contextFields.control) {
      const controlInfo = `Control: ${contextFields.control}`;
      additional = additional ? `${additional}; ${controlInfo}` : controlInfo;
    }

    if (contextFields.description) {
      const descInfo = `Description: ${contextFields.description}`;
      additional = additional ? `${additional}; ${descInfo}` : descInfo;
    }

    // LEGACY FORMAT SUPPORT (for backward compatibility)
    // Extract tissue (old format)
    if (!tissue && contextFields.tissue) {
      tissue = contextFields.tissue;
    } else if (!tissue && (contextFields.tissue1 || contextFields.tissue2)) {
      tissue = [contextFields.tissue1, contextFields.tissue2].filter(Boolean).join(' vs ');
    }

    // Extract disease from cancer_type or disease field (old format)
    if (!disease && contextFields.cancer_type) {
      // Extract TCGA code if present: "Kidney Chromophobe (KICH)" -> disease="Kidney Chromophobe", additional="KICH"
      const tcgaMatch = contextFields.cancer_type.match(/^(.+?)\s*\(([A-Z]{3,5})\)\s*$/);
      let cancerType;
      if (tcgaMatch) {
        cancerType = tcgaMatch[1].trim();
        additional = tcgaMatch[2].trim();
      } else {
        cancerType = contextFields.cancer_type;
      }

      // Map to full disease name for better fact-checking
      disease = this._mapCancerTypeToDiseaseName(cancerType);
      console.log(`     - Mapped cancer type "${cancerType}" → disease "${disease}"`);
    }

    // Add treatment info to additional if present (old format)
    if (contextFields.treatment) {
      const treatmentInfo = contextFields.control
        ? `${contextFields.treatment} vs ${contextFields.control}`
        : contextFields.treatment;
      additional = additional ? `${additional}; ${treatmentInfo}` : treatmentInfo;
    }

    // Add timepoints to additional if present (old format)
    if (contextFields.timepoints) {
      const timepointInfo = `Time points: ${contextFields.timepoints}`;
      additional = additional ? `${additional}; ${timepointInfo}` : timepointInfo;
    }

    // Use custom field if template is custom (old format)
    if (contextFields.template === 'custom' && contextFields.custom) {
      return this._parseBiologicalContext(contextFields.custom);
    }

    return {
      tissue: tissue || '',
      disease: disease || '',
      additional: additional || ''
    };
  }

  /**
   * Parse experimental context string into structured biological context (LEGACY)
   * Used as fallback when structured contextFields are not available
   * Example: "kidney cortex chromophobe renal cell carcinoma KICH"
   * Returns: {tissue: "kidney cortex", disease: "chromophobe renal cell carcinoma", additional: "KICH"}
   *
   * @param {string} experimentalContext - Free-form experimental context string
   * @returns {object} Structured context with disease, tissue, and additional fields
   */
  _parseBiologicalContext(experimentalContext) {
    if (!experimentalContext || typeof experimentalContext !== 'string') {
      return { disease: '', tissue: '', additional: '' };
    }

    // Simple heuristic parsing - can be enhanced based on actual metadata format
    const context = experimentalContext.trim().toLowerCase();

    // Common tissue keywords
    const tissueKeywords = ['cortex', 'tissue', 'cell', 'blood', 'plasma', 'serum', 'brain', 'liver', 'kidney', 'heart', 'lung', 'skin', 'bone', 'muscle'];

    // Common disease keywords
    const diseaseKeywords = ['cancer', 'carcinoma', 'disease', 'syndrome', 'disorder', 'tumor', 'adenoma', 'sarcoma', 'lymphoma', 'leukemia'];

    let tissue = '';
    let disease = '';
    let additional = '';

    // Try to extract tissue
    const tissueMatch = tissueKeywords.find(keyword => context.includes(keyword));
    if (tissueMatch) {
      const tissueIndex = context.indexOf(tissueMatch);
      // Extract a few words around the tissue keyword
      const words = experimentalContext.split(' ');
      const tissueWordIndex = words.findIndex(w => w.toLowerCase().includes(tissueMatch));
      if (tissueWordIndex >= 0) {
        // Take 1-3 words including the tissue keyword
        tissue = words.slice(Math.max(0, tissueWordIndex - 1), tissueWordIndex + 2).join(' ');
      }
    }

    // Try to extract disease
    const diseaseMatch = diseaseKeywords.find(keyword => context.includes(keyword));
    if (diseaseMatch) {
      const words = experimentalContext.split(' ');
      const diseaseWordIndex = words.findIndex(w => w.toLowerCase().includes(diseaseMatch));
      if (diseaseWordIndex >= 0) {
        // Take 2-4 words including the disease keyword
        disease = words.slice(Math.max(0, diseaseWordIndex - 2), diseaseWordIndex + 3).join(' ');
      }
    }

    // Remaining text becomes additional
    const usedText = [tissue.toLowerCase(), disease.toLowerCase()].filter(Boolean).join(' ');
    additional = experimentalContext.split(' ')
      .filter(word => !usedText.includes(word.toLowerCase()))
      .join(' ')
      .trim();

    return {
      tissue: tissue || '',
      disease: disease || '',
      additional: additional || experimentalContext
    };
  }

  async _callFactCheckAPI(text, context) {
    // Fetch organism name
    // Try: 1) organismId from context, 2) fetch from AnalysisConfig using analysisId
    console.log(`  🔍 DEBUG - Organism Fetching:`);
    console.log(`     - context.analysisId: ${context.analysisId || 'NOT PROVIDED'}`);
    console.log(`     - context.organismId: ${context.organismId || 'NOT PROVIDED'}`);

    let organism = '';
    let organismId = context.organismId;

    if (!organismId && context.analysisId) {
      // Fetch organismId from AnalysisConfig if not provided
      console.log(`     - Fetching organismId from AnalysisConfig...`);
      organismId = await this._getOrganismIdFromAnalysis(context.analysisId);
      console.log(`     - Fetched organismId from AnalysisConfig: ${organismId || 'NULL'}`);
    }

    if (organismId) {
      console.log(`     - Fetching organism name from Organism collection...`);
      organism = await this._getOrganismName(organismId) || '';
      console.log(`     - Fetched organism name: "${organism}" (${organism ? 'SUCCESS' : 'EMPTY'})`);
    } else {
      console.log(`     - ⚠️ No organismId available, skipping organism name fetch`);
    }

    // Extract biological context - prefer structured fields over string parsing
    console.log(`     - DEBUG context.contextFields:`, JSON.stringify(context.contextFields));
    console.log(`     - DEBUG context.experimentalContext: "${context.experimentalContext}"`);

    let parsedContext;
    if (context.contextFields && Object.keys(context.contextFields).some(key => context.contextFields[key])) {
      // Use structured fields from UI (preferred)
      console.log(`     - ✓ Using structured contextFields from UI`);
      parsedContext = this._extractStructuredContext(context.contextFields);
      console.log(`     - Extracted from contextFields:`, JSON.stringify(parsedContext));
    } else {
      // Fallback to parsing experimental context string (legacy)
      console.log(`     - ⚠️ Using legacy string parsing for experimentalContext`);
      parsedContext = this._parseBiologicalContext(context.experimentalContext || '');
      console.log(`     - Parsed from string:`, JSON.stringify(parsedContext));
    }

    // Construct biological_context_text in new API format
    const biological_context_text = {
      organism: organism,
      disease: parsedContext.disease,
      tissue: parsedContext.tissue,
      additional: parsedContext.additional
    };

    const payload = {
      text,
      biological_context_text,
      options: {
        max_claims: this.config.maxClaims,
        max_references_per_claim: this.config.maxReferencesPerClaim,
        min_confidence: this.config.minConfidence,
        use_direct_verification: this.config.useDirectVerification,
        use_decomposition: this.config.useDecomposition,
        min_sjr: this.config.minSjr,
        max_workers: this.config.maxWorkers,
        citation_workers: this.config.citationWorkers
      }
    };

    console.log(`\n  📡 ========== FACT-CHECK REQUEST ==========`);
    console.log(`  🌐 API URL: ${this.config.apiUrl}`);
    console.log(`  📄 Text being fact-checked (${text.length} chars):`);
    console.log(`  ${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`);
    console.log(`\n  🧬 Biological Context:`);
    console.log(`     - Organism: "${organism}"`);
    console.log(`     - Disease: "${parsedContext.disease}"`);
    console.log(`     - Tissue: "${parsedContext.tissue}"`);
    console.log(`     - Additional: "${parsedContext.additional}"`);
    console.log(`  ⚙️ Options:`);
    console.log(`     - Max Claims: ${this.config.maxClaims}`);
    console.log(`     - Max References Per Claim: ${this.config.maxReferencesPerClaim}`);
    console.log(`     - Min Confidence: ${this.config.minConfidence}`);
    console.log(`     - Use Direct Verification: ${this.config.useDirectVerification}`);
    console.log(`     - Use Decomposition: ${this.config.useDecomposition}`);
    console.log(`     - Min SJR: ${this.config.minSjr}`);
    console.log(`     - Max Workers: ${this.config.maxWorkers}`);
    console.log(`     - Citation Workers: ${this.config.citationWorkers}`);
    console.log(`  ==========================================\n`);

    const maxRetries = this.config.maxRetries || 2;
    const retryDelay = this.config.retryDelay || 5000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`  🔄 Sending request to fact-check API...`);
        const response = await axios.post(this.config.apiUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.timeout
        });

        if (attempt > 0) {
          console.log(`  ✓ Succeeded on attempt ${attempt + 1}`);
        } else {
          console.log(`  ✓ API request successful`);
        }

        console.log(`  📦 Response received - Success: ${response.data.success}, ${response.data.verification_summary?.total_claims_extracted || 0} claims extracted`);

        return response.data;

      } catch (error) {
        const isLastAttempt = attempt === maxRetries;

        if (isLastAttempt) {
          console.error(`  ❌ All ${maxRetries + 1} attempts failed`);
          console.error(`  💥 Error details:`, error.response?.data || error.message);
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay = retryDelay * Math.pow(2, attempt);
        console.warn(`  ⚠️ Attempt ${attempt + 1} failed: ${error.message}`);
        if (error.response?.status) {
          console.warn(`  📛 HTTP Status: ${error.response.status}`);
        }
        console.warn(`  ⏳ Retrying in ${delay}ms... (${maxRetries - attempt} attempts remaining)`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Extract context for fact-checking from step outputs
   */
  extractContext(geneAnalysis, themes, experimentContext, organismId = null, analysisId = null, contextFields = null) {
    return {
      genes: this._extractGenes(geneAnalysis),
      pathways: this._extractPathways(themes),
      themes: this._extractThemes(themes),
      experimentalContext: experimentContext || undefined,
      contextFields: contextFields || undefined,  // NEW: Pass structured fields
      organismId: organismId,
      analysisId: analysisId
    };
  }

  /**
   * Debug helper to log citations in merged result object
   * @param {object} result - The merged result
   * @param {string} stepName - Step name
   */
  _debugLogCitationsInResult(result, stepName) {
    const citationPattern = /\[(\d+)\]/g;
    let totalCitations = 0;

    switch (stepName) {
      case 'Overall Summary':
        if (result.interpretation) {
          const citations = (result.interpretation.match(citationPattern) || []).length;
          totalCitations += citations;
          console.log(`    - interpretation: ${citations} citations`);
        }
        if (result.summary) {
          const citations = (result.summary.match(citationPattern) || []).length;
          totalCitations += citations;
          console.log(`    - summary: ${citations} citations`);
        }
        break;

      case 'Gene Analysis':
        if (result.hubGenes) {
          result.hubGenes.forEach((g, i) => {
            const citations = (g.role.match(citationPattern) || []).length;
            if (citations > 0) {
              totalCitations += citations;
              console.log(`    ✅ hubGenes[${i}] "${g.gene}": ${citations} citations`);
              console.log(`       Role: ${g.role.substring(0, 150)}${g.role.length > 150 ? '...' : ''}`);
            }
          });
        }
        if (result.masterRegulators) {
          result.masterRegulators.forEach((m, i) => {
            const citations = (m.mechanism.match(citationPattern) || []).length;
            if (citations > 0) {
              totalCitations += citations;
              console.log(`    ✅ masterRegulators[${i}] "${m.gene}": ${citations} citations`);
            }
          });
        }
        break;

      case 'Pathway Mechanisms':
        if (result.mechanisticSummary) {
          const citations = (result.mechanisticSummary.match(citationPattern) || []).length;
          totalCitations += citations;
          console.log(`    - mechanisticSummary: ${citations} citations`);
        }
        break;

      case 'Mechanistic Hypotheses':
        if (result.centralMechanisticModel) {
          const citations = (result.centralMechanisticModel.match(citationPattern) || []).length;
          totalCitations += citations;
          console.log(`    - centralMechanisticModel: ${citations} citations`);
        }
        break;

      case 'Therapeutic Implications':
        if (result.therapeuticSummary) {
          const citations = (result.therapeuticSummary.match(citationPattern) || []).length;
          totalCitations += citations;
          console.log(`    - therapeuticSummary: ${citations} citations`);
        }
        break;

      case 'Group Themes':
        if (result.themesSummary) {
          const citations = (result.themesSummary.match(citationPattern) || []).length;
          totalCitations += citations;
          console.log(`    - themesSummary: ${citations} citations`);
        }
        if (result.themes) {
          result.themes.forEach((theme, i) => {
            const descCitations = (theme.description.match(citationPattern) || []).length;
            if (descCitations > 0) {
              totalCitations += descCitations;
              console.log(`    ✅ themes[${i}] "${theme.name}": ${descCitations} citations in description`);
            }
          });
        }
        break;
    }

    console.log(`  📊 Total citations in merged result: ${totalCitations}`);
    if (totalCitations === 0) {
      console.log(`  ⚠️ WARNING: No citations found in merged result!`);
    }
  }

  _extractGenes(geneAnalysis) {
    const genes = [];

    if (geneAnalysis?.hubGenes) {
      genes.push(...geneAnalysis.hubGenes.map(g => g.gene).filter(g => g != null && g !== ''));
    }

    if (geneAnalysis?.masterRegulators) {
      genes.push(...geneAnalysis.masterRegulators.map(m => m.gene).filter(g => g != null && g !== ''));
    }

    if (geneAnalysis?.novelCandidates) {
      genes.push(...geneAnalysis.novelCandidates.map(n => n.gene).filter(g => g != null && g !== ''));
    }

    // Remove duplicates and ensure all are strings
    return [...new Set(genes)].filter(g => typeof g === 'string' && g.length > 0);
  }

  _extractPathways(themes) {
    const pathways = [];

    if (themes?.themes) {
      themes.themes.forEach(theme => {
        if (theme.pathways && Array.isArray(theme.pathways)) {
          // Handle both string and object formats
          pathways.push(...theme.pathways.map(p =>
            typeof p === 'string' ? p : (p.name || p.pathwayName)
          ).filter(p => p && p.trim()));
        }
      });
    }

    // Remove duplicates and ensure all are strings
    return [...new Set(pathways)].filter(p => typeof p === 'string' && p.length > 0);
  }

  _extractThemes(themes) {
    if (!themes?.themes || !Array.isArray(themes.themes)) {
      return [];
    }

    // Filter out null/undefined names and ensure all are strings
    return themes.themes
      .map(t => t?.name)
      .filter(name => name != null && typeof name === 'string' && name.length > 0);
  }
}

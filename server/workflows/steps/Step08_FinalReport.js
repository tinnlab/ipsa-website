// Step 8: Combine Final Report (Pure Text Combiner - No LLM)
import { BaseStep } from './BaseStep.js';
import { WorkflowConfig } from '../config.js';

export class Step08_FinalReport extends BaseStep {
  constructor() {
    super(8, 'Combine Final Report', [1, 2, 3, 4, 5, 5.5, 6, 7]);
    // NO LLM - this is now a pure text combiner
  }

  async execute(input, context) {
    console.log(`\n[Step ${this.stepNumber}] ${this.stepName}`);
    console.log('  Mode: Pure text combiner (NO LLM)');

    // Gather all previous results
    const summary = this.getPreviousStepOutput(context, 1);
    const themes = this.getPreviousStepOutput(context, 2);
    const geneAnalysis = this.getPreviousStepOutput(context, 3);
    const mechanisms = this.getPreviousStepOutput(context, 4);
    const directions = this.getPreviousStepOutput(context, 5);
    const novelFindings = this.getPreviousStepOutput(context, 5.5);
    const hypotheses = this.getPreviousStepOutput(context, 6);
    const therapeutic = this.getPreviousStepOutput(context, 7);

    // Extract experimental context for header
    const { analyses = [] } = input;
    const experimentContext = this._extractExperimentContext(analyses);

    // Collect all report sections from each step
    console.log('  Collecting report sections from all steps...');
    const reportSections = [];

    if (summary?.reportSection) {
      reportSections.push({ step: 1, name: 'Executive Summary', content: summary.reportSection });
      console.log('    ✓ Step 1: Executive Summary');
    }

    if (themes?.reportSection) {
      reportSections.push({ step: 2, name: 'Major Biological Themes', content: themes.reportSection });
      console.log('    ✓ Step 2: Major Biological Themes');
    }

    if (mechanisms?.reportSection) {
      reportSections.push({ step: 4, name: 'Pathway Mechanisms', content: mechanisms.reportSection });
      console.log('    ✓ Step 4: Pathway Mechanisms');
    }

    if (geneAnalysis?.reportSection) {
      reportSections.push({ step: 3, name: 'Hub Gene Analysis', content: geneAnalysis.reportSection });
      console.log('    ✓ Step 3: Hub Gene Analysis');
    }

    if (hypotheses?.reportSection) {
      reportSections.push({ step: 6, name: 'Mechanistic Model & Hypotheses', content: hypotheses.reportSection });
      console.log('    ✓ Step 6: Mechanistic Model & Hypotheses');
    }

    if (novelFindings?.reportSection) {
      reportSections.push({ step: 5.5, name: 'Novel Findings', content: novelFindings.reportSection });
      console.log('    ✓ Step 5.5: Novel Findings');
    }

    if (therapeutic?.reportSection) {
      reportSections.push({ step: 7, name: 'Therapeutic Implications', content: therapeutic.reportSection });
      console.log('    ✓ Step 7: Therapeutic Implications');
    }

    console.log(`  Total sections collected: ${reportSections.length}`);

    // Collect all references from fact-checked steps
    console.log('\n  Collecting references from all steps...');
    const sectionReferences = {
      summary: summary?.references || [],
      themes: themes?.references || [],
      geneAnalysis: geneAnalysis?.references || [],
      mechanisms: mechanisms?.references || [],
      novelFindings: novelFindings?.references || [],
      hypotheses: hypotheses?.references || [],
      therapeutic: therapeutic?.references || []
    };

    let totalRefsByStep = 0;
    for (const [step, refs] of Object.entries(sectionReferences)) {
      if (refs.length > 0) {
        console.log(`    ${step}: ${refs.length} references`);
        totalRefsByStep += refs.length;
      }
    }
    console.log(`  Total references (before deduplication): ${totalRefsByStep}`);

    // Collect all fact-checked texts for citation remapping
    const factCheckedTexts = {};

    // Add all report sections as fact-checked texts
    reportSections.forEach(section => {
      factCheckedTexts[`section${section.step}`] = section.content;
    });

    // Deduplicate references and remap citations globally
    console.log('\n  Deduplicating references and remapping citations...');
    const { references: allReferences, remappedTexts, mappings } =
      this._combineReferencesAndRemapCitations(sectionReferences, factCheckedTexts);

    console.log(`  ✓ Deduplicated references: ${allReferences.length}`);

    // Update report sections with remapped citations
    reportSections.forEach(section => {
      const remappedKey = `section${section.step}`;
      if (remappedTexts[remappedKey]) {
        section.content = remappedTexts[remappedKey];
      }
    });

    // Build final report
    console.log('\n  Building final report...');
    let finalReport = '';

    // Header
    finalReport += '# Pathway Analysis Report\n\n';
    if (experimentContext) {
      finalReport += `**Experimental Context:** ${experimentContext}\n\n`;
    }
    finalReport += `**Analysis Date:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;
    finalReport += '---\n\n';

    // Combine sections in order (by step number)
    reportSections
      .sort((a, b) => a.step - b.step)
      .forEach(section => {
        // Note: section.content already includes heading (e.g., "## Executive Summary")
        finalReport += section.content;
        finalReport += '\n'; // Add spacing between sections
      });

    // Generate Conclusions section (template-based, NO LLM)
    const conclusions = this._generateConclusions({
      summary,
      themes,
      geneAnalysis,
      mechanisms,
      novelFindings,
      hypotheses,
      therapeutic,
      experimentContext
    });

    finalReport += conclusions;
    finalReport += '\n';

    // Append References section
    if (allReferences.length > 0) {
      finalReport += '## References\n\n';
      finalReport += this._formatReferences(allReferences);
      finalReport += '\n';
    }

    // Validate citation coverage
    const validation = this._validateCitationCoverage(finalReport, allReferences);

    console.log(`\n  ✓ Final report generated (${finalReport.length} characters)`);
    console.log(`  ✓ Total references: ${allReferences.length}`);
    console.log(`  ✓ Citation validation:`);
    console.log(`    - Total citations: ${validation.stats.totalCitations} (${validation.stats.uniqueCitations} unique)`);
    console.log(`    - Citation density: ${validation.stats.citationDensity.toFixed(2)}% (citations per 100 words)`);
    console.log(`    - Uncited references: ${validation.stats.uncitedReferences}`);

    if (validation.issues.length > 0) {
      console.error(`  ❌ Citation issues found:`);
      validation.issues.forEach(issue => console.error(`    - ${issue}`));
    }

    if (validation.warnings.length > 0) {
      console.warn(`  ⚠️  Citation warnings:`);
      validation.warnings.forEach(warning => console.warn(`    - ${warning}`));
    }

    if (validation.valid && validation.warnings.length === 0) {
      console.log(`  ✓ All citation checks passed`);
    }

    return {
      report: finalReport,
      metadata: {
        mode: 'pure-text-combiner',
        llmUsed: false,
        sectionsCount: reportSections.length,
        themesCount: themes?.themes?.length || 0,
        hubGenesCount: geneAnalysis?.hubGenes?.length || 0,
        masterRegulatorsCount: geneAnalysis?.masterRegulators?.length || 0,
        pathwayInteractionsCount: mechanisms?.keyInteractions?.length || 0,
        activatedPathwaysCount: directions?.activatedPathways?.length || 0,
        suppressedPathwaysCount: directions?.suppressedPathways?.length || 0,
        referencesCount: allReferences.length,
        referencesBySection: {
          summary: sectionReferences.summary.length,
          themes: sectionReferences.themes.length,
          geneAnalysis: sectionReferences.geneAnalysis.length,
          mechanisms: sectionReferences.mechanisms.length,
          novelFindings: sectionReferences.novelFindings.length,
          hypotheses: sectionReferences.hypotheses.length,
          therapeutic: sectionReferences.therapeutic.length
        },
        hypothesesCount: hypotheses?.hypotheses?.length || 0,
        drugTargetsCount: therapeutic?.drugTargets?.length || 0,
        repurposingOpportunitiesCount: therapeutic?.repurposingOpportunities?.length || 0,
        citationValidation: {
          valid: validation.valid,
          totalCitations: validation.stats.totalCitations,
          uniqueCitations: validation.stats.uniqueCitations,
          citationDensity: validation.stats.citationDensity,
          uncitedReferences: validation.stats.uncitedReferences,
          issuesCount: validation.issues.length,
          warningsCount: validation.warnings.length,
          issues: validation.issues,
          warnings: validation.warnings
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Generate Conclusions section using template-based approach (NO LLM)
   * Extracts key findings from all steps and formats as bullet points
   */
  _generateConclusions(data) {
    const {
      summary,
      themes,
      geneAnalysis,
      mechanisms,
      novelFindings,
      hypotheses,
      therapeutic,
      experimentContext
    } = data;

    let section = '## 8. Conclusions\n\n';

    // Add introductory sentence
    section += 'This pathway analysis reveals key biological insights';
    if (experimentContext) {
      section += ` for ${experimentContext}`;
    }
    section += ':\n\n';

    // Key Takeaways
    section += '**Key Findings:**\n\n';

    // 1. Main pathway themes (from Step 2)
    if (themes?.themes && themes.themes.length > 0) {
      const topTheme = themes.themes[0]; // Highest priority theme
      const pathwayCount = topTheme.pathways?.length || 0;
      section += `1. **${topTheme.name}:** ${pathwayCount} enriched pathways reveal ${topTheme.description.split('.')[0].toLowerCase()}.\n\n`;
    }

    // 2. Hub genes and regulators (from Step 3)
    if (geneAnalysis?.hubGenes && geneAnalysis.hubGenes.length > 0) {
      const topGenes = geneAnalysis.hubGenes.slice(0, 3)
        .map(g => `${g.gene} (${g.foldChange > 0 ? '+' : ''}${g.foldChange?.toFixed(2)}-fold)`)
        .join(', ');
      section += `2. **Hub Genes:** ${topGenes} identified as central regulators appearing in multiple pathways.\n\n`;
    }

    // 3. Mechanistic insight (from Step 6)
    if (hypotheses?.hypotheses && hypotheses.hypotheses.length > 0) {
      const topHypothesis = hypotheses.hypotheses.find(h => h.confidence === 'high') || hypotheses.hypotheses[0];
      section += `3. **Mechanistic Model:** ${topHypothesis.hypothesis}\n\n`;
    }

    // 4. Novel/unexpected findings (from Step 5.5)
    if (novelFindings?.unexpectedFindings && novelFindings.unexpectedFindings.length > 0) {
      const topUnexpected = novelFindings.unexpectedFindings[0];
      section += `4. **Novel Finding:** ${topUnexpected.finding} - ${topUnexpected.surprise.split('.')[0]}.\n\n`;
    }

    // 5. Therapeutic opportunities (from Step 7)
    if (therapeutic?.drugTargets && therapeutic.drugTargets.length > 0) {
      const tier1Targets = therapeutic.drugTargets.filter(dt => dt.druggability === 'high');
      if (tier1Targets.length > 0) {
        const topTarget = tier1Targets[0];
        const drugNames = topTarget.existingDrugs?.slice(0, 2).map(d => d.drug).join(', ') || 'therapeutic agents';
        section += `5. **Therapeutic Potential:** ${topTarget.target} identified as high-priority druggable target. Existing therapies include ${drugNames}.\n\n`;
      }
    }

    // Closing statement
    section += '**Impact:**\n\n';
    section += 'This analysis provides a roadmap for mechanistic understanding and clinical translation';
    if (experimentContext) {
      section += ` in ${experimentContext}`;
    }
    section += '. The identified pathways, hub genes, and drug targets offer specific opportunities for:\n\n';
    section += '- **Further Research:** Testable hypotheses with quantitative predictions\n';
    section += '- **Therapeutic Development:** Prioritized drug targets with existing pharmacological tools\n';
    section += '- **Biomarker Discovery:** Key genes and pathways for diagnostic or prognostic applications\n';
    section += '- **Mechanistic Validation:** Specific experimental approaches outlined in Section 7\n\n';

    // Add summary statistics
    section += '**Analysis Summary:**\n\n';
    const stats = [];

    if (themes?.themes) {
      stats.push(`${themes.themes.length} major biological themes`);
    }

    if (geneAnalysis?.hubGenes) {
      stats.push(`${geneAnalysis.hubGenes.length} hub genes`);
    }

    if (hypotheses?.hypotheses) {
      stats.push(`${hypotheses.hypotheses.length} testable hypotheses`);
    }

    if (therapeutic?.drugTargets) {
      stats.push(`${therapeutic.drugTargets.length} therapeutic targets`);
    }

    if (stats.length > 0) {
      section += `This report integrates ${stats.join(', ')} to provide a comprehensive pathway-level analysis`;
      if (experimentContext) {
        section += ` tailored to ${experimentContext}`;
      }
      section += '.\n\n';
    }

    section += '---\n\n';
    section += `*Report generated using fact-checked analysis workflow (${Object.values(data).filter(d => d?.references?.length > 0).length} steps with literature validation).*\n\n`;

    return section;
  }

  /**
   * Combine references from all sections and remap citation numbers
   * Deduplicates by PMID, DOI, or title (case-insensitive)
   */
  _combineReferencesAndRemapCitations(sectionRefs, factCheckedTexts) {
    const allRefs = [];
    let currentId = 1;
    const pmidToId = new Map(); // Deduplicate by PMID (most reliable)
    const doiToId = new Map();  // Fallback to DOI
    const titleToId = new Map(); // Last resort: title (normalized for case-insensitive matching)
    const mappings = {}; // Track old→new citation number mappings per section

    let totalRefsInput = 0;
    let duplicatesRemoved = 0;

    // Build combined reference list + mappings
    for (const [sectionName, refs] of Object.entries(sectionRefs)) {
      if (!refs || !Array.isArray(refs)) continue;

      mappings[sectionName] = {};

      refs.forEach((ref, oldIndex) => {
        totalRefsInput++;

        // Use ref.id if available (from fact-checking service), otherwise use array index
        // This handles cases where references aren't returned in citation order
        const oldNum = ref.id || (oldIndex + 1);

        // Normalize title for case-insensitive matching
        const normalizedTitle = ref.title ? ref.title.toLowerCase().trim() : null;

        // Try to find existing reference
        let existingId = null;

        if (ref.pmid && pmidToId.has(ref.pmid)) {
          existingId = pmidToId.get(ref.pmid);
        } else if (ref.doi && doiToId.has(ref.doi)) {
          existingId = doiToId.get(ref.doi);
        } else if (normalizedTitle && titleToId.has(normalizedTitle)) {
          existingId = titleToId.get(normalizedTitle);
        }

        if (existingId) {
          // Reference already exists - map old number to existing ID
          mappings[sectionName][oldNum] = existingId;
          duplicatesRemoved++;
        } else {
          // New reference - add it
          const newRef = { ...ref, id: currentId };
          allRefs.push(newRef);

          // Index it with normalized title
          if (ref.pmid) pmidToId.set(ref.pmid, currentId);
          if (ref.doi) doiToId.set(ref.doi, currentId);
          if (normalizedTitle) titleToId.set(normalizedTitle, currentId);

          mappings[sectionName][oldNum] = currentId;
          currentId++;
        }
      });
    }

    // Remap citation numbers in all fact-checked texts
    const remappedTexts = {};

    for (const [textKey, text] of Object.entries(factCheckedTexts)) {
      if (!text || typeof text !== 'string') {
        remappedTexts[textKey] = text;
        continue;
      }

      // Determine which section this text belongs to
      let sectionName = null;
      if (textKey.startsWith('section')) {
        // For report sections, map step number to section name
        if (textKey === 'section1') sectionName = 'summary';
        else if (textKey === 'section2') sectionName = 'themes';
        else if (textKey === 'section3') sectionName = 'geneAnalysis';
        else if (textKey === 'section4') sectionName = 'mechanisms';
        else if (textKey === 'section5.5') sectionName = 'novelFindings';
        else if (textKey === 'section6') sectionName = 'hypotheses';
        else if (textKey === 'section7') sectionName = 'therapeutic';
      }

      if (!sectionName || !mappings[sectionName]) {
        remappedTexts[textKey] = text;
        continue;
      }

      let updatedText = text;
      const sectionMapping = mappings[sectionName];

      // Sort old numbers descending to avoid [1] matching [10], [11], etc.
      const sortedOldNums = Object.keys(sectionMapping)
        .map(n => parseInt(n))
        .sort((a, b) => b - a);

      // Replace citation numbers with temporary placeholders first
      const placeholders = {};
      for (const oldNum of sortedOldNums) {
        const newNum = sectionMapping[oldNum];
        const placeholder = `__CIT_${newNum}_PLACEHOLDER__`;
        placeholders[placeholder] = newNum;

        // Replace [oldNum] with placeholder
        updatedText = updatedText.replace(
          new RegExp(`\\[${oldNum}\\]`, 'g'),
          placeholder
        );
      }

      // Replace placeholders with final citation numbers
      for (const [placeholder, newNum] of Object.entries(placeholders)) {
        updatedText = updatedText.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          `[${newNum}]`
        );
      }

      remappedTexts[textKey] = updatedText;
    }

    // Logging
    console.log(`    Total references across sections: ${totalRefsInput}`);
    console.log(`    After deduplication: ${allRefs.length}`);
    console.log(`    Duplicates removed: ${duplicatesRemoved}`);
    if (duplicatesRemoved > 0) {
      const deduplicationRate = ((duplicatesRemoved / totalRefsInput) * 100).toFixed(1);
      console.log(`    Deduplication rate: ${deduplicationRate}%`);
    }

    return {
      references: allRefs,
      remappedTexts,
      mappings
    };
  }

  /**
   * Format references in markdown
   */
  _formatReferences(references) {
    return references.map(ref => {
      const parts = [];

      // Format as markdown paragraph with blank line separator
      parts.push(`**[${ref.id}]** ${ref.authors}`);
      parts.push(ref.title);
      parts.push(`*${ref.journal}*`);

      if (ref.year) {
        parts.push(`${ref.year}`);
      }

      if (ref.volume) {
        parts.push(`Vol. ${ref.volume}`);
      }

      if (ref.pages) {
        parts.push(`pp. ${ref.pages}`);
      }

      if (ref.doi) {
        parts.push(`DOI: ${ref.doi}`);
      }

      if (ref.pmid) {
        parts.push(`PMID: ${ref.pmid}`);
      }

      if (ref.url) {
        parts.push(ref.url);
      }

      return parts.join('. ') + '.';
    }).join('\n\n');
  }

  /**
   * Validate citation coverage in the report
   */
  _validateCitationCoverage(report, allReferences) {
    const issues = [];
    const warnings = [];

    // Extract all citation numbers from report
    const citationMatches = report.match(/\[(\d+)\]/g) || [];
    const citedNumbers = new Set(citationMatches.map(c => parseInt(c.match(/\d+/)[0])));

    // Check if all citations point to valid references
    const maxRefId = allReferences.length;
    for (const num of citedNumbers) {
      if (num > maxRefId || num < 1) {
        issues.push(`Citation [${num}] does not exist in reference list (max: ${maxRefId})`);
      }
    }

    // Check for uncited references (not critical, but good to know)
    const uncitedRefs = allReferences.filter(ref => !citedNumbers.has(ref.id));
    if (uncitedRefs.length > 0) {
      warnings.push(`${uncitedRefs.length} references not cited in report`);
    }

    // Calculate overall citation density
    const totalWords = report.split(/\s+/).length;
    const totalCitations = citationMatches.length;
    const citationDensity = (totalCitations / totalWords * 100);

    return {
      valid: issues.length === 0,
      issues,
      warnings,
      stats: {
        totalCitations: citationMatches.length,
        uniqueCitations: citedNumbers.size,
        totalReferences: allReferences.length,
        uncitedReferences: uncitedRefs.length,
        citationDensity: citationDensity
      }
    };
  }
}

// Base class for all workflow steps
export class BaseStep {
  constructor(stepNumber, stepName, dependencies = []) {
    this.stepNumber = stepNumber;
    this.stepName = stepName;
    this.dependencies = dependencies;
  }

  /**
   * Execute the step
   * @param {Object} input - Initial input data (pathways, genes, analyses)
   * @param {Object} context - Context containing previous step results
   * @returns {Promise<Object>} - Step output
   */
  async execute(input, context) {
    throw new Error(`execute() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Get step dependencies (which steps must run before this one)
   * @returns {Array<Number>} - Array of step numbers
   */
  getDependencies() {
    return this.dependencies;
  }

  /**
   * Get output from a previous step
   * @param {Object} context - Workflow context
   * @param {Number} stepNumber - Step number to retrieve
   * @returns {Object|null} - Step output or null
   */
  getPreviousStepOutput(context, stepNumber) {
    return context.steps?.[stepNumber]?.output || null;
  }

  /**
   * Validate input data
   * @param {Object} input - Input to validate
   * @throws {Error} - If validation fails
   */
  validateInput(input) {
    // Override in subclasses for specific validation
    return true;
  }

  /**
   * Extract experimental context from analyses
   * @param {Array} analyses - Array of analysis objects with metadata
   * @returns {String|null} - Experimental context string or null
   */
  _extractExperimentContext(analyses) {
    if (!analyses || !Array.isArray(analyses) || analyses.length === 0) {
      return null;
    }

    // Get context from first analysis with metadata
    for (const analysis of analyses) {
      if (analysis.metadata && typeof analysis.metadata === 'string' && analysis.metadata.trim()) {
        return analysis.metadata.trim();
      }
    }

    return null;
  }

  /**
   * Clean internal section markers from fact-checking service
   * Removes markers like ===SECTION:hubGenes=== that are used for parsing
   * @param {String} text - Text that may contain section markers
   * @returns {String} - Cleaned text
   */
  _cleanSectionMarkers(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    return text.replace(/===SECTION:[^=]+===/g, '').trim();
  }

  /**
   * Parse JSON response from LLM, handling think tags and code blocks
   * @param {Object} response - LLM response object with content property
   * @returns {Object} - Parsed JSON object
   * @throws {Error} - If JSON parsing fails
   */
  parseJSONResponse(response) {
    if (!response || !response.content) {
      throw new Error('Invalid response: missing content');
    }

    const content = response.content;

    // Primary: Use LLM's extractJSON method (handles code blocks, truncation, etc.)
    if (this.llm && typeof this.llm.extractJSON === 'function') {
      try {
        const jsonString = this.llm.extractJSON(content);
        const parsed = JSON.parse(jsonString);
        return parsed;
      } catch (error) {
        // extractJSON failed - provide helpful debug info
        console.error(`  ❌ Failed to extract/parse JSON: ${error.message}`);
        console.error(`  Content preview (first 300 chars):`);
        console.error(`  ${content.substring(0, 300)}`);

        // Check if it's a truncation issue
        if (content.length > 0 && !content.trim().endsWith('}') && !content.trim().endsWith(']')) {
          console.error(`  ⚠️  Response appears truncated (doesn't end with } or ])`);
          console.error(`  ⚠️  Consider increasing maxTokens for this step`);
        }

        throw new Error(`Failed to parse LLM response: ${error.message}`);
      }
    }

    // Fallback: Direct parse (if extractJSON not available)
    try {
      return JSON.parse(content);
    } catch (e) {
      console.error(`  ❌ Direct JSON parse failed: ${e.message}`);
      console.error(`  Content preview: ${content.substring(0, 200)}`);
      throw new Error(`Failed to parse LLM response: ${e.message}`);
    }
  }
}

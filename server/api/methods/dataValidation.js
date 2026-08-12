// server/api/methods/dataValidation.js
// Meteor methods for LLM-powered data validation

import { Meteor } from 'meteor/meteor';
import { validateDataFormat, quickValidate } from '../../llm/validators/dataValidator.js';

Meteor.methods({
  /**
   * Validate uploaded data format using LLM
   * @param {Object} params
   * @param {String} params.inputType - 'ora', 'pgsea', or 'expression'
   * @param {String} params.fileContent - Content of the uploaded file
   * @param {String} params.fileName - Name of the file (optional)
   * @param {Boolean} params.useLLM - Whether to use LLM or quick validation (default: true)
   * @returns {Promise<Object>} Validation result
   */
  async 'data.validate'({ inputType, fileContent, fileName = '', useLLM = true }) {
    console.log(`📋 Validating ${inputType} data file: ${fileName}`);

    // Input validation
    if (!inputType || !['ora', 'pgsea', 'expression', 'group'].includes(inputType)) {
      throw new Meteor.Error('invalid-input-type', 'Input type must be ora, pgsea, expression, or group');
    }

    if (!fileContent || typeof fileContent !== 'string') {
      throw new Meteor.Error('invalid-file-content', 'File content must be a non-empty string');
    }

    // Quick validation first (basic checks)
    const quickResult = quickValidate(inputType, fileContent);

    // If quick validation fails badly, no need for LLM
    if (!quickResult.valid && quickResult.errors.some(e => e.includes('empty'))) {
      return quickResult;
    }

    // Use LLM for detailed validation if requested
    if (useLLM) {
      try {
        const llmResult = await validateDataFormat(inputType, fileContent, fileName);
        return llmResult;
      } catch (error) {
        console.error('LLM validation failed, falling back to quick validation:', error);
        return {
          ...quickResult,
          llmFallback: true,
          llmError: error.message
        };
      }
    }

    return quickResult;
  },

  /**
   * Get format specifications for a given input type
   * @param {String} inputType - 'ora', 'pgsea', or 'expression'
   * @returns {Object} Format specification
   */
  'data.getFormatSpec'({ inputType }) {
    const { FORMAT_SPECS } = require('../../llm/validators/dataValidator.js');

    if (!FORMAT_SPECS[inputType]) {
      throw new Meteor.Error('invalid-input-type', `Unknown input type: ${inputType}`);
    }

    return FORMAT_SPECS[inputType];
  }
});

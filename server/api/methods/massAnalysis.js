// server/api/methods/massAnalysis.js
// Meteor methods for mass analysis folder detection and validation

import { Meteor } from 'meteor/meteor';
import { detectFolderInputType } from '../../llm/validators/dataValidator.js';

Meteor.methods({
  /**
   * Detect and validate input types for all folders in mass analysis
   * @param {Array} foldersData - Array of folder objects
   * @param {String} foldersData[].name - Folder name (path)
   * @param {Array} foldersData[].files - Array of {name, content} objects
   * @returns {Promise<Array>} Array of detection results
   */
  async 'massAnalysis.detectAndValidate'(foldersData) {
    console.log(`📁 Detecting input types for ${foldersData.length} folders...`);

    // Input validation
    if (!Array.isArray(foldersData) || foldersData.length === 0) {
      throw new Meteor.Error('invalid-input', 'foldersData must be a non-empty array');
    }

    // Validate each folder structure
    for (const folder of foldersData) {
      if (!folder.name || !Array.isArray(folder.files)) {
        throw new Meteor.Error('invalid-folder-structure', 'Each folder must have a name and files array');
      }
    }

    try {
      // Process folders in batches to avoid overwhelming the LLM server
      const BATCH_SIZE = 3;
      const results = [];

      for (let i = 0; i < foldersData.length; i += BATCH_SIZE) {
        const batch = foldersData.slice(i, i + BATCH_SIZE);
        console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(foldersData.length / BATCH_SIZE)} (folders ${i + 1}-${Math.min(i + BATCH_SIZE, foldersData.length)} of ${foldersData.length})`);

        // Process current batch in parallel
        const batchPromises = batch.map(folderData => detectFolderInputType(folderData));
        const batchResults = await Promise.all(batchPromises);

        results.push(...batchResults);

        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} complete`);
      }

      // Log summary
      const summary = results.reduce((acc, result) => {
        acc[result.detectedType] = (acc[result.detectedType] || 0) + 1;
        return acc;
      }, {});

      console.log('✅ All detection complete. Summary:', summary);

      return results;

    } catch (error) {
      console.error('❌ Mass analysis detection error:', error);
      throw new Meteor.Error('detection-failed', `Failed to detect input types: ${error.message}`);
    }
  },

  /**
   * Detect and validate a single folder
   * @param {Object} folderData - Folder object with name and files
   * @returns {Promise<Object>} Detection result
   */
  async 'massAnalysis.detectFolder'(folderData) {
    console.log(`📁 Detecting input type for folder: ${folderData.name}`);

    // Input validation
    if (!folderData || !folderData.name || !Array.isArray(folderData.files)) {
      throw new Meteor.Error('invalid-input', 'Folder must have a name and files array');
    }

    try {
      const result = await detectFolderInputType(folderData);
      console.log(`✅ Detected ${result.detectedType} for ${folderData.name}`);
      return result;

    } catch (error) {
      console.error('❌ Folder detection error:', error);
      throw new Meteor.Error('detection-failed', `Failed to detect input type: ${error.message}`);
    }
  }
});

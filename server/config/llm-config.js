// server/config/llm-config.js
// LLM configuration - now using unified provider system

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { getDefaultLLM } from '../llm/config.js';

// Export the default LLM instance getter (backward compatibility)
export const defaultvLLM = getDefaultLLM();

// Backward compatibility method for vllm.generateText
Meteor.methods({
  async 'vllm.generateText'(prompt, options = {}) {
    check(prompt, String);
    check(options, Object);

    try {
      const llm = getDefaultLLM();

      // Use chat method with prompt string
      const response = await llm.chat(prompt, options);

      // Return just the content for backward compatibility
      return response.content;
    } catch (error) {
      console.error('❌ vllm.generateText failed:', error);
      throw error;
    }
  }
});
// server/llm/providers/GroqProvider.js
// Groq provider - Ultra-fast inference

import { Meteor } from 'meteor/meteor';
import { LLMProvider } from '../LLMProvider.js';

/**
 * Groq Provider
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 * Models: llama-3.3-70b-versatile, mixtral-8x7b-32768, etc.
 */
export class GroqProvider extends LLMProvider {
  constructor(config = {}) {
    // Try to get API key from: config > Meteor.settings > env
    const apiKey = config.apiKey
      || (typeof Meteor !== 'undefined' && Meteor.settings?.private?.GROQ_API_KEY)
      || process.env.GROQ_API_KEY
      || '';

    super({
      baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
      apiKey,
      model: config.model || 'llama-3.3-70b-versatile',
      ...config
    });

    if (!this.config.apiKey) {
      throw new Error('Groq API key is required');
    }

    this.chatEndpoint = `${this.config.baseUrl}/chat/completions`;
  }

  /**
   * Chat completion using Groq
   * @param {Array|String} messages - Messages or prompt string
   * @param {Object} options - Request options
   * @returns {Promise<Object>}
   */
  async chat(messages, options = {}) {
    const requestBody = this.buildRequestBody(messages, options);

    const headers = {
      'Authorization': `Bearer ${this.config.apiKey}`
    };

    const response = await this.makeRequest(
      this.chatEndpoint,
      requestBody,
      headers
    );

    return this.parseResponse(response);
  }

  /**
   * Get Groq-specific info
   */
  getInfo() {
    return {
      ...super.getInfo(),
      provider: 'Groq',
      local: false,
      endpoint: this.chatEndpoint,
      features: ['ultra-fast-inference']
    };
  }
}

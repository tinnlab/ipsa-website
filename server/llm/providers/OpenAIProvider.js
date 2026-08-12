// server/llm/providers/OpenAIProvider.js
// OpenAI provider - Official OpenAI API

import { LLMProvider } from '../LLMProvider.js';

/**
 * OpenAI Provider
 * Endpoint: https://api.openai.com/v1/chat/completions
 * Models: gpt-4, gpt-4-turbo, gpt-3.5-turbo, etc.
 */
export class OpenAIProvider extends LLMProvider {
  constructor(config = {}) {
    super({
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
      model: config.model || 'gpt-4-turbo',
      ...config
    });

    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.chatEndpoint = `${this.config.baseUrl}/chat/completions`;
  }

  /**
   * Chat completion using OpenAI
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
   * Get OpenAI-specific info
   */
  getInfo() {
    return {
      ...super.getInfo(),
      provider: 'OpenAI',
      local: false,
      endpoint: this.chatEndpoint
    };
  }
}

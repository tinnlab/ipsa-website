// server/llm/providers/GeminiProvider.js
// Google Gemini provider via OpenAI compatibility

import { LLMProvider } from '../LLMProvider.js';

/**
 * Gemini Provider
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 * Models: gemini-2.0-flash-exp, gemini-1.5-pro, etc.
 */
export class GeminiProvider extends LLMProvider {
  constructor(config = {}) {
    super({
      baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: config.apiKey || process.env.GEMINI_API_KEY || '',
      model: config.model || 'gemini-2.0-flash-exp',
      ...config
    });

    if (!this.config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.chatEndpoint = `${this.config.baseUrl}/chat/completions`;
  }

  /**
   * Chat completion using Gemini
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
   * Get Gemini-specific info
   */
  getInfo() {
    return {
      ...super.getInfo(),
      provider: 'Google Gemini',
      local: false,
      endpoint: this.chatEndpoint,
      features: ['multimodal', 'long-context']
    };
  }
}

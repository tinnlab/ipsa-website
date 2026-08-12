// server/llm/providers/OllamaProvider.js
// Ollama provider - Local LLM with OpenAI compatibility

import { LLMProvider } from '../LLMProvider.js';

/**
 * Ollama Provider
 * Endpoint: http://localhost:11434/v1/chat/completions
 * Models: llama3.2, qwen2.5, mistral, etc.
 */
export class OllamaProvider extends LLMProvider {
  constructor(config = {}) {
    super({
      baseUrl: config.baseUrl || 'http://localhost:11434/v1',
      apiKey: config.apiKey || 'ollama', // Required but unused
      model: config.model || 'llama3.2',
      ...config
    });

    this.chatEndpoint = `${this.config.baseUrl}/chat/completions`;
  }

  /**
   * Chat completion using Ollama
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
   * Get Ollama-specific info
   */
  getInfo() {
    return {
      ...super.getInfo(),
      provider: 'Ollama',
      local: true,
      endpoint: this.chatEndpoint
    };
  }
}

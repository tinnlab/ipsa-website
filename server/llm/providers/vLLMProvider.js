// server/llm/providers/vLLMProvider.js
// vLLM provider - High-performance local inference with OpenAI compatibility

import { LLMProvider } from '../LLMProvider.js';

/**
 * vLLM Provider
 * Supports both /v1/completions and /v1/chat/completions endpoints
 * Models: Qwen/Qwen3-32B-FP8, meta-llama/Llama-3.1-8B, etc.
 */
export class vLLMProvider extends LLMProvider {
  constructor(config = {}) {
    super({
      baseUrl: config.baseUrl || 'http://localhost:8000',
      model: config.model || 'Qwen/Qwen3-32B-FP8',
      ...config
    });

    this.chatEndpoint = `${this.config.baseUrl}/v1/chat/completions`;
    this.completionsEndpoint = `${this.config.baseUrl}/v1/completions`;

    // vLLM supports both modes
    this.useCompletionsMode = config.useCompletionsMode || false;
  }

  /**
   * Chat completion using vLLM
   * @param {Array|String} messages - Messages or prompt string
   * @param {Object} options - Request options
   * @returns {Promise<Object>}
   */
  async chat(messages, options = {}) {
    // If in completions mode or messages is a simple string, use completions endpoint
    if (this.useCompletionsMode || typeof messages === 'string') {
      return this.completions(messages, options);
    }

    // Otherwise use chat completions endpoint
    const requestBody = this.buildRequestBody(messages, options);

    const response = await this.makeRequest(
      this.chatEndpoint,
      requestBody
    );

    return this.parseResponse(response);
  }

  /**
   * Legacy completions endpoint (for backward compatibility)
   * @param {String|Array} prompt - Prompt string or messages
   * @param {Object} options - Request options
   */
  async completions(prompt, options = {}) {
    // Convert messages to prompt if needed
    const promptText = typeof prompt === 'string'
      ? prompt
      : this.messagesToPrompt(prompt);

    const requestBody = {
      model: options.model || this.config.model,
      prompt: promptText,
      max_tokens: options.max_tokens || options.maxTokens || this.config.maxTokens,
      // temperature: options.temperature ?? this.config.temperature,
      top_p: options.top_p,
      stop: options.stop,
      stream: options.stream || false
    };

    const response = await this.makeRequest(
      this.completionsEndpoint,
      requestBody
    );

    // Parse completions response (different format)
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No choices in response');
    }

    const choice = response.choices[0];
    const content = choice.text || '';

    if (!content) {
      throw new Error('Empty text in response');
    }

    return {
      content: this.cleanResponse(content),
      usage: response.usage,
      model: response.model,
      finish_reason: choice.finish_reason,
      raw: response
    };
  }

  /**
   * Convert messages array to prompt string for completions endpoint
   * @param {Array} messages - Messages array
   * @returns {String} - Prompt string
   */
  messagesToPrompt(messages) {
    const normalized = this.normalizeMessages(messages);

    // Simple conversion - can be customized based on model
    return normalized.map(msg => {
      if (msg.role === 'system') return `System: ${msg.content}`;
      if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
      return `User: ${msg.content}`;
    }).join('\n\n');
  }

  /**
   * Get vLLM-specific info
   */
  getInfo() {
    return {
      ...super.getInfo(),
      provider: 'vLLM',
      local: true,
      mode: this.useCompletionsMode ? 'completions' : 'chat',
      chatEndpoint: this.chatEndpoint,
      completionsEndpoint: this.completionsEndpoint
    };
  }
}

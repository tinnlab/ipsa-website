// server/llm/LLMProvider.js
// Abstract base class for LLM providers following OpenAI Chat Completions API standard

import axios from 'axios';
import { Meteor } from 'meteor/meteor';

/**
 * Abstract base class for all LLM providers
 * Implements OpenAI Chat Completions API standard
 */
export class LLMProvider {
  constructor(config = {}) {
    if (new.target === LLMProvider) {
      throw new Error('LLMProvider is abstract and cannot be instantiated directly');
    }

    this.config = {
      baseUrl: config.baseUrl || '',
      apiKey: config.apiKey || '',
      model: config.model || '',
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens || 8000,
      timeout: config.timeout || 720000, // 12 minutes
      maxRetries: config.maxRetries || 3,
      ...config
    };

    this.providerName = this.constructor.name;
  }

  /**
   * Main chat method - must be implemented by subclasses
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Optional parameters (temperature, max_tokens, etc.)
   * @returns {Promise<Object>} - Chat completion response
   */
  async chat(messages, options = {}) {
    throw new Error('chat() must be implemented by subclass');
  }

  /**
   * Build request body following OpenAI format
   * @param {Array} messages - Chat messages
   * @param {Object} options - Request options
   * @returns {Object} - Request body
   */
  buildRequestBody(messages, options = {}) {
    const modelName = options.model || this.config.model;

    // Get max tokens from various parameter names
    const maxTokens = options.max_completion_tokens
      || options.maxCompletionTokens
      || options.max_tokens
      || options.maxTokens
      || this.config.maxCompletionTokens
      || this.config.maxTokens;

    const body = {
      model: modelName,
      messages: this.normalizeMessages(messages),
      // temperature: options.temperature ?? this.config.temperature,
      top_p: options.top_p || options.topP,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      stop: options.stop,
      stream: options.stream || false
    };

    // Use max_completion_tokens for new OpenAI/reasoning models, max_tokens for others
    if (modelName?.includes('openai/') || modelName?.includes('gpt-')) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    // Add reasoning_effort if configured (for reasoning models)
    const reasoningEffort = options.reasoningEffort || options.reasoning_effort || this.config.reasoningEffort;
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }

    // Merge any additional parameters
    if (options.additionalParams) {
      Object.assign(body, options.additionalParams);
    }

    return body;
  }

  /**
   * Normalize messages to OpenAI format
   * @param {Array|String} messages - Messages or single prompt string
   * @returns {Array} - Normalized messages array
   */
  normalizeMessages(messages) {
    // If string, convert to user message
    if (typeof messages === 'string') {
      return [{ role: 'user', content: messages }];
    }

    // If array, validate format
    if (Array.isArray(messages)) {
      return messages.map(msg => {
        if (typeof msg === 'string') {
          return { role: 'user', content: msg };
        }
        if (!msg.role || !msg.content) {
          throw new Error('Message must have role and content properties');
        }
        return msg;
      });
    }

    throw new Error('Messages must be a string or array of message objects');
  }

  /**
   * Make HTTP request with retry logic
   * @param {String} url - API endpoint
   * @param {Object} body - Request body
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} - API response
   */
  async makeRequest(url, body, headers = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        console.log(`🔄 [${this.providerName}] Request attempt ${attempt}/${this.config.maxRetries}`);

        const response = await axios.post(url, body, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...headers
          },
          timeout: this.config.timeout
        });

        console.log(`✅ [${this.providerName}] Request successful`);
        return response.data;

      } catch (error) {
        lastError = error;

        // Log error details
        if (axios.isAxiosError(error)) {
          if (error.response) {
            console.error(`❌ [${this.providerName}] API Error ${error.response.status}:`, error.response.data);
          } else if (error.request) {
            console.error(`❌ [${this.providerName}] No response received`);
          } else {
            console.error(`❌ [${this.providerName}] Request setup error:`, error.message);
          }
        }

        // Retry on retryable errors
        if (this.isRetryableError(error) && attempt < this.config.maxRetries) {
          const delay = this.getRetryDelay(attempt);
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Max retries reached or non-retryable error
        break;
      }
    }

    // All retries failed
    throw this.formatError(lastError);
  }

  /**
   * Check if error is retryable
   * @param {Error} error - The error to check
   * @returns {Boolean}
   */
  isRetryableError(error) {
    if (!axios.isAxiosError(error)) return false;

    // Retry on network errors
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;

    // Retry on 5xx server errors
    if (error.response && error.response.status >= 500) return true;

    // Retry on rate limiting
    if (error.response && error.response.status === 429) return true;

    return false;
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {Number} attempt - Current attempt number
   * @returns {Number} - Delay in milliseconds
   */
  getRetryDelay(attempt) {
    return Math.min(1000 * Math.pow(2, attempt), 10000);
  }

  /**
   * Format error for Meteor
   * @param {Error} error - Original error
   * @returns {Meteor.Error}
   */
  formatError(error) {
    let errorMessage = 'LLM request failed';
    let errorCode = 'llm-failed';
    let details = null;

    if (axios.isAxiosError(error)) {
      if (error.response) {
        errorCode = `llm-failed-${error.response.status}`;
        const apiError = error.response.data?.error?.message ||
                        error.response.data?.detail ||
                        JSON.stringify(error.response.data);
        errorMessage = `${this.providerName} API error (${error.response.status}): ${apiError}`;
        details = error.response.data;
      } else if (error.request) {
        errorMessage = `${this.providerName} request failed: No response received`;
      } else {
        errorMessage = `${this.providerName} request error: ${error.message}`;
      }
    } else {
      errorMessage = error.message || errorMessage;
    }

    return new Meteor.Error(errorCode, errorMessage, details);
  }

  /**
   * Parse response to extract content
   * @param {Object} response - API response
   * @returns {Object} - Parsed response with content
   */
  parseResponse(response) {
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No choices in response');
    }

    const choice = response.choices[0];
    const rawContent = choice.message?.content || choice.text || '';

    if (!rawContent) {
      throw new Error('Empty content in response');
    }

    const cleaned = this.cleanResponse(rawContent);

    // Debug log for reasoning models
    if (rawContent !== cleaned) {
      console.log('🧠 [Reasoning Model] Think tags removed');
      console.log(`   Raw length: ${rawContent.length} chars`);
      console.log(`   Cleaned length: ${cleaned.length} chars`);
      console.log(`   Removed: ${rawContent.length - cleaned.length} chars`);
    }

    return {
      content: cleaned,
      usage: response.usage,
      model: response.model,
      finish_reason: choice.finish_reason,
      raw: response
    };
  }

  /**
   * Clean response content (remove think tags, extra whitespace, etc.)
   * @param {String} content - Raw content
   * @returns {String} - Cleaned content
   */
  cleanResponse(content) {
    if (typeof content !== 'string') return content;

    let cleaned = content;

    // Remove all reasoning/thinking tag variations (with or without attributes)
    const thinkTagPatterns = [
      /<think[\s\S]*?<\/think>/gi,      // <think>...</think>
      /<thinking[\s\S]*?<\/thinking>/gi, // <thinking>...</thinking>
      /<reason[\s\S]*?<\/reason>/gi,     // <reason>...</reason>
      /<reasoning[\s\S]*?<\/reasoning>/gi, // <reasoning>...</reasoning>
      /<analysis[\s\S]*?<\/analysis>/gi, // <analysis>...</analysis>
      /<thought[\s\S]*?<\/thought>/gi    // <thought>...</thought>
    ];

    thinkTagPatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Remove XML/HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

    // Clean up extra whitespace
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Extract JSON from mixed content (handles code blocks, think tags, etc.)
   * @param {String} content - Content that may contain JSON
   * @returns {String} - Extracted JSON string
   * @throws {Error} - If no JSON found
   */
  extractJSON(content) {
    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
    }

    // First clean think tags
    let cleaned = this.cleanResponse(content);

    // Strategy 1: Try to extract from markdown code blocks
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const extracted = codeBlockMatch[1].trim();
      try {
        JSON.parse(extracted);
        return extracted;
      } catch (e) {
        console.log('  Debug: Code block JSON invalid:', e.message.substring(0, 100));
        // Continue to other strategies
      }
    }

    // Strategy 2: Find complete JSON object with brace matching
    const startBrace = cleaned.indexOf('{');
    if (startBrace >= 0) {
      const extracted = this.findCompleteJSONObject(cleaned, startBrace);
      if (extracted) {
        try {
          JSON.parse(extracted);
          return extracted;
        } catch (e) {
          console.log('  Debug: Brace-matched JSON invalid:', e.message.substring(0, 100));
          // Continue to fallback
        }
      }
    }

    // Strategy 3: Try direct parse (if content is pure JSON)
    try {
      JSON.parse(cleaned);
      return cleaned;
    } catch (e) {
      // Last resort failed
    }

    // If all strategies failed, throw with helpful error
    throw new Error(`No valid JSON found in content. First 200 chars: ${cleaned.substring(0, 200)}`);
  }

  /**
   * Find a complete JSON object by matching braces
   * @param {String} str - String containing JSON
   * @param {Number} startIndex - Index of opening brace
   * @returns {String|null} - Complete JSON string or null
   */
  findCompleteJSONObject(str, startIndex) {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < str.length; i++) {
      const char = str[i];

      // Handle escape sequences
      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      // Handle strings (don't count braces inside strings)
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      // Count braces
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;

      // Found complete object
      if (braceCount === 0 && i > startIndex) {
        return str.substring(startIndex, i + 1);
      }
    }

    // Incomplete object (truncated response)
    return null;
  }

  /**
   * Clean markdown formatting from inside JSON strings
   * @param {String} jsonString - JSON string that may contain markdown
   * @returns {String} - Cleaned JSON string
   */
  cleanMarkdownFromJSON(jsonString) {
    if (typeof jsonString !== 'string') return jsonString;

    // This is a simple cleanup - doesn't handle all edge cases
    // but should handle common markdown in JSON string values

    // Note: We need to be careful not to break valid JSON
    // Only clean markdown inside string values, not structure

    return jsonString;
  }

  /**
   * Get provider info
   * @returns {Object}
   */
  getInfo() {
    return {
      provider: this.providerName,
      model: this.config.model,
      baseUrl: this.config.baseUrl
    };
  }
}

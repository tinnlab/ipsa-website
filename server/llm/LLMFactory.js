// server/llm/LLMFactory.js
// Factory for creating LLM provider instances

import { OllamaProvider } from './providers/OllamaProvider.js';
import { vLLMProvider } from './providers/vLLMProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { GroqProvider } from './providers/GroqProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';

/**
 * Factory class for creating LLM providers
 */
export class LLMFactory {
  static providers = {
    'ollama': OllamaProvider,
    'vllm': vLLMProvider,
    'openai': OpenAIProvider,
    'groq': GroqProvider,
    'gemini': GeminiProvider
  };

  static defaultProvider = null;

  /**
   * Create a provider instance
   * @param {String} providerName - Name of the provider (ollama, vllm, openai, groq, gemini)
   * @param {Object} config - Provider configuration
   * @returns {LLMProvider} - Provider instance
   */
  static create(providerName, config = {}) {
    const normalizedName = providerName.toLowerCase();

    if (!this.providers[normalizedName]) {
      throw new Error(
        `Unknown provider: ${providerName}. Available providers: ${Object.keys(this.providers).join(', ')}`
      );
    }

    const ProviderClass = this.providers[normalizedName];
    return new ProviderClass(config);
  }

  /**
   * Create provider from configuration object
   * @param {Object} options - { provider: 'ollama', config: {...} }
   * @returns {LLMProvider}
   */
  static createFromOptions(options = {}) {
    if (!options.provider) {
      throw new Error('Provider name is required');
    }

    return this.create(options.provider, options.config || {});
  }

  /**
   * Set default provider instance
   * @param {LLMProvider} provider - Provider instance
   */
  static setDefault(provider) {
    this.defaultProvider = provider;
  }

  /**
   * Get default provider
   * @returns {LLMProvider}
   */
  static getDefault() {
    if (!this.defaultProvider) {
      throw new Error('No default LLM provider configured. Call LLMFactory.setDefault() first.');
    }
    return this.defaultProvider;
  }

  /**
   * List available providers
   * @returns {Array<String>}
   */
  static listProviders() {
    return Object.keys(this.providers);
  }

  /**
   * Get provider info
   * @param {String} providerName - Provider name
   * @returns {Object}
   */
  static getProviderInfo(providerName) {
    const normalizedName = providerName.toLowerCase();
    const ProviderClass = this.providers[normalizedName];

    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    // Get class name and basic info
    return {
      name: normalizedName,
      className: ProviderClass.name,
      description: this.getProviderDescription(normalizedName)
    };
  }

  /**
   * Get provider description
   * @param {String} providerName
   * @returns {String}
   */
  static getProviderDescription(providerName) {
    const descriptions = {
      'ollama': 'Local LLM with OpenAI compatibility (llama3.2, qwen2.5, mistral, etc.)',
      'vllm': 'High-performance local inference (Qwen, Llama, etc.)',
      'openai': 'Official OpenAI API (GPT-4, GPT-3.5, etc.)',
      'groq': 'Ultra-fast inference (Llama, Mixtral, etc.)',
      'gemini': 'Google Gemini models via OpenAI compatibility'
    };

    return descriptions[providerName] || 'No description available';
  }
}

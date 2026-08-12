// server/llm/config.js
// LLM configuration and initialization from Meteor settings

import { Meteor } from 'meteor/meteor';
import { LLMFactory } from './LLMFactory.js';

/**
 * Get LLM configuration from Meteor settings
 * @returns {Object} - LLM configuration
 */
export function getLLMConfig() {
  // Try to get from settings, with fallback defaults
  const settings = Meteor.settings?.llm || Meteor.settings?.private?.llm || {};

  const defaultConfig = {
    default_provider: 'vllm',
    providers: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
        temperature: 0.2,
        maxTokens: 8000
      },
      vllm: {
        // Any OpenAI-compatible server (vLLM, llama.cpp, TGI, ...). Point baseUrl at
        // your own deployment. vLLMProvider appends the route itself
        // (/v1/chat/completions for array messages, /v1/completions for string
        // prompts), so baseUrl must omit /v1.
        baseUrl: 'http://localhost:8000',
        model: 'gpt-oss-120b',
        temperature: 0.2,
        maxTokens: 8000,
        useCompletionsMode: false
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-4-turbo',
        temperature: 0.2,
        maxTokens: 4000
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        maxTokens: 8000
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: 'gemini-2.0-flash-exp',
        temperature: 0.2,
        maxTokens: 8000
      }
    }
  };

  // Merge with defaults
  return {
    default_provider: settings.default_provider || defaultConfig.default_provider,
    providers: {
      ...defaultConfig.providers,
      ...settings.providers
    }
  };
}

/**
 * Initialize default LLM provider from configuration
 * @returns {LLMProvider} - Default provider instance
 */
export function initializeDefaultLLM() {
  try {
    const config = getLLMConfig();
    const providerName = config.default_provider;
    const providerConfig = config.providers[providerName];

    if (!providerConfig) {
      throw new Error(
        `Configuration for provider '${providerName}' not found. Available: ${Object.keys(config.providers).join(', ')}`
      );
    }

    console.log(`🤖 Initializing default LLM provider: ${providerName}`);

    const provider = LLMFactory.create(providerName, providerConfig);
    LLMFactory.setDefault(provider);

    const info = provider.getInfo();
    console.log('✅ LLM Provider initialized:', info);

    return provider;
  } catch (error) {
    console.error('❌ Failed to initialize LLM provider:', error.message);
    throw error;
  }
}

/**
 * Get or create default LLM provider
 * @returns {LLMProvider}
 */
export function getDefaultLLM() {
  try {
    return LLMFactory.getDefault();
  } catch (error) {
    // If no default set, initialize it
    return initializeDefaultLLM();
  }
}

/**
 * Create a specific LLM provider
 * @param {String} providerName - Provider name
 * @param {Object} customConfig - Custom configuration (optional)
 * @returns {LLMProvider}
 */
export function createLLM(providerName, customConfig = {}) {
  const config = getLLMConfig();
  const baseConfig = config.providers[providerName] || {};

  // Merge base config with custom config
  const finalConfig = {
    ...baseConfig,
    ...customConfig
  };

  return LLMFactory.create(providerName, finalConfig);
}

/**
 * Switch default provider
 * @param {String} providerName - New default provider
 * @returns {LLMProvider}
 */
export function switchDefaultProvider(providerName) {
  console.log(`🔄 Switching default provider to: ${providerName}`);

  const config = getLLMConfig();
  const providerConfig = config.providers[providerName];

  if (!providerConfig) {
    throw new Error(`Provider '${providerName}' not configured`);
  }

  const provider = LLMFactory.create(providerName, providerConfig);
  LLMFactory.setDefault(provider);

  console.log(`✅ Default provider switched to: ${providerName}`);
  return provider;
}

/**
 * List all available providers
 * @returns {Array<Object>}
 */
export function listAvailableProviders() {
  const config = getLLMConfig();
  const providers = LLMFactory.listProviders();

  return providers.map(name => ({
    name,
    configured: !!config.providers[name],
    isDefault: name === config.default_provider,
    info: LLMFactory.getProviderInfo(name)
  }));
}

// Export default instance getter
export const defaultLLM = getDefaultLLM;

// server/api/methods/llm.js
// LLM Meteor methods using unified provider system

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { getDefaultLLM, createLLM, switchDefaultProvider, listAvailableProviders } from '../../llm/config.js';
import Permission from '../helper/Permission';

Meteor.methods({
  /**
   * Universal chat method - works with any LLM provider
   */
  async 'llm.chat'(messages, options = {}) {
    check(messages, Match.OneOf(String, Array));
    check(options, Object);

    try {
      const llm = getDefaultLLM();
      const response = await llm.chat(messages, options);

      return {
        content: response.content,
        usage: response.usage,
        model: response.model,
        provider: llm.getInfo().provider
      };
    } catch (error) {
      console.error('❌ llm.chat failed:', error);
      throw new Meteor.Error('llm-chat-failed', error.message);
    }
  },

  /**
   * Switch between LLM providers
   */
  async 'llm.switchProvider'(providerName, customConfig = {}) {
    check(providerName, String);
    check(customConfig, Object);
    // Mutates the server-wide default provider for every user. Operator-only.
    await Permission.isAdmin(this.userId);

    try {
      const provider = switchDefaultProvider(providerName);
      return {
        success: true,
        provider: provider.getInfo()
      };
    } catch (error) {
      console.error('❌ llm.switchProvider failed:', error);
      throw new Meteor.Error('switch-provider-failed', error.message);
    }
  },

  /**
   * List all available providers
   */
  async 'llm.listProviders'() {
    try {
      return listAvailableProviders();
    } catch (error) {
      console.error('❌ llm.listProviders failed:', error);
      throw new Meteor.Error('list-providers-failed', error.message);
    }
  },

  /**
   * Get current provider info
   */
  async 'llm.getProviderInfo'() {
    try {
      const llm = getDefaultLLM();
      return llm.getInfo();
    } catch (error) {
      console.error('❌ llm.getProviderInfo failed:', error);
      throw new Meteor.Error('get-provider-info-failed', error.message);
    }
  },

  /**
   * Create a custom LLM instance
   */
  async 'llm.createCustomProvider'(providerName, config) {
    check(providerName, String);
    check(config, Object);
    // config carries endpoints/credentials for a server-side LLM client. Operator-only.
    await Permission.isAdmin(this.userId);

    try {
      const llm = createLLM(providerName, config);
      return {
        success: true,
        info: llm.getInfo()
      };
    } catch (error) {
      console.error('❌ llm.createCustomProvider failed:', error);
      throw new Meteor.Error('create-provider-failed', error.message);
    }
  }
});

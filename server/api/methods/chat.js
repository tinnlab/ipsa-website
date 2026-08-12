// server/api/methods/chat.js
// Bridges the website chat widget to the LLM. The widget calls
// Meteor.call('chat.processMessage', message, history) and expects a plain string back.
// Pinned to the vLLM provider (gpt-oss-120b) so the chatbot always uses
// GPT-OSS regardless of any runtime default-provider switches elsewhere.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { createLLM } from '../../llm/config.js';
import { IPSA_SYSTEM_PROMPT } from '../../chat/ipsaSystemPrompt.js';

const MAX_HISTORY = 10;
const ALLOWED_ROLES = ['user', 'assistant'];

// Pure, unit-testable: builds the message array sent to the LLM.
export function buildChatMessages(message, history = []) {
  const cleaned = (history || [])
    .filter(m => m && ALLOWED_ROLES.includes(m.role) && typeof m.content === 'string')
    .slice(-MAX_HISTORY);
  return [
    { role: 'system', content: IPSA_SYSTEM_PROMPT },
    ...cleaned,
    { role: 'user', content: message },
  ];
}

// Core logic, with an injectable LLM factory so it can be tested without a model server.
// Always pins to the 'vllm' provider (gpt-oss-120b).
export async function processChatMessage(message, history = [], { llmFactory = createLLM } = {}) {
  const messages = buildChatMessages(message, history);
  const llm = llmFactory('vllm');
  const response = await llm.chat(messages, { temperature: 0.2, maxTokens: 2000 });
  return response.content; // widget renders the result as a plain string
}

Meteor.methods({
  async 'chat.processMessage'(message, history = []) {
    check(message, String);
    check(history, Match.Maybe([Object])); // [{ role, content }]

    // Deterministic, offline reply for E2E tests (no LLM server required).
    if (process.env.CHAT_TEST_STUB) {
      return '[stubbed] IPSA supports pathway-analysis methods such as ORA, GSEA, and FGSEA.';
    }

    try {
      return await processChatMessage(message, history);
    } catch (error) {
      console.error('❌ chat.processMessage failed:', error);
      throw new Meteor.Error('chat-failed', 'The assistant is temporarily unavailable.');
    }
  },
});

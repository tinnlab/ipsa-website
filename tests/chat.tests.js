// tests/chat.tests.js
// Unit + integration tests for the IPSA chatbot bridge. The LLM is injected/stubbed so the
// suite is deterministic and needs no running GPT-OSS server.
// Lives under tests/ (excluded from the app bundle) and is loaded only by tests/main.js
// (the project's testModule), so it never leaks into the production server.

import assert from 'assert';
import { Meteor } from 'meteor/meteor';
import { IPSA_SYSTEM_PROMPT } from '../server/chat/ipsaSystemPrompt.js';
// Importing the method module also registers the 'chat.processMessage' Meteor method.
import { buildChatMessages, processChatMessage } from '../server/api/methods/chat.js';

if (Meteor.isServer) {
  describe('chatbot system prompt', function () {
    it('is a non-empty string with key IPSA facts', function () {
      assert.strictEqual(typeof IPSA_SYSTEM_PROMPT, 'string');
      assert.ok(IPSA_SYSTEM_PROMPT.length > 0);
      for (const fact of [
        'Intelligent Platform for Systems-level Analysis',
        'ORA',
        'KEGG',
        'tin@wayne.edu',
        'Wayne State',
      ]) {
        assert.ok(
          IPSA_SYSTEM_PROMPT.includes(fact),
          `system prompt should mention "${fact}"`
        );
      }
    });
  });

  describe('buildChatMessages', function () {
    it('puts the system prompt first and the new user message last', function () {
      const messages = buildChatMessages('What is IPSA?');
      assert.strictEqual(messages[0].role, 'system');
      assert.strictEqual(messages[0].content, IPSA_SYSTEM_PROMPT);
      const last = messages[messages.length - 1];
      assert.strictEqual(last.role, 'user');
      assert.strictEqual(last.content, 'What is IPSA?');
    });

    it('passes history through between the system and user messages', function () {
      const history = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ];
      const messages = buildChatMessages('next', history);
      assert.deepStrictEqual(messages, [
        { role: 'system', content: IPSA_SYSTEM_PROMPT },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'next' },
      ]);
    });

    it('caps history at the 10 most recent turns', function () {
      const history = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i}`,
      }));
      const messages = buildChatMessages('latest', history);
      // 1 system + 10 history + 1 user = 12
      assert.strictEqual(messages.length, 12);
      assert.strictEqual(messages[1].content, 'm15'); // first kept history entry
      assert.strictEqual(messages[10].content, 'm24'); // last kept history entry
    });

    it('filters out malformed history entries', function () {
      const history = [
        { role: 'system', content: 'should be dropped' }, // disallowed role
        { role: 'user', content: 42 }, // non-string content
        null, // null entry
        { role: 'assistant', content: 'valid' }, // kept
      ];
      const messages = buildChatMessages('q', history);
      assert.deepStrictEqual(messages, [
        { role: 'system', content: IPSA_SYSTEM_PROMPT },
        { role: 'assistant', content: 'valid' },
        { role: 'user', content: 'q' },
      ]);
    });
  });

  describe('processChatMessage (LLM injected)', function () {
    it('returns the LLM response content as a plain string', async function () {
      const fakeLLM = { chat: async () => ({ content: 'STUBBED REPLY' }) };
      const result = await processChatMessage('What is IPSA?', [], {
        llmFactory: () => fakeLLM,
      });
      assert.strictEqual(result, 'STUBBED REPLY');
    });

    it("pins the provider to 'vllm' and sends a well-formed message array", async function () {
      let requestedProvider;
      let receivedMessages;
      const fakeLLM = {
        chat: async (messages) => {
          receivedMessages = messages;
          return { content: 'ok' };
        },
      };
      await processChatMessage('Hello', [{ role: 'user', content: 'earlier' }], {
        llmFactory: (name) => {
          requestedProvider = name;
          return fakeLLM;
        },
      });
      assert.strictEqual(requestedProvider, 'vllm');
      assert.strictEqual(receivedMessages[0].role, 'system');
      assert.strictEqual(receivedMessages[receivedMessages.length - 1].content, 'Hello');
    });

    it('propagates LLM errors to the caller', async function () {
      const fakeLLM = {
        chat: async () => {
          throw new Error('backend down');
        },
      };
      await assert.rejects(
        () => processChatMessage('hi', [], { llmFactory: () => fakeLLM }),
        /backend down/
      );
    });
  });

  describe("Meteor method 'chat.processMessage'", function () {
    it('is registered and returns a string via the test stub', async function () {
      const previous = process.env.CHAT_TEST_STUB;
      process.env.CHAT_TEST_STUB = '1';
      try {
        const result = await Meteor.callAsync('chat.processMessage', 'What methods does IPSA support?', []);
        assert.strictEqual(typeof result, 'string');
        assert.ok(result.length > 0);
      } finally {
        if (previous === undefined) delete process.env.CHAT_TEST_STUB;
        else process.env.CHAT_TEST_STUB = previous;
      }
    });
  });
}

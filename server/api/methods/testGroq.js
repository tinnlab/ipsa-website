// Test Groq API connection
import { Meteor } from 'meteor/meteor';
import { LLMFactory } from '../../llm/LLMFactory.js';
import { WorkflowConfig } from '../../workflows/config.js';

Meteor.methods({
  'test.groqConnection': async function() {
    console.log('🧪 Testing Groq connection...');
    console.log(`Model: ${WorkflowConfig.llm.model}`);
    console.log(`Temperature: ${WorkflowConfig.llm.temperature}`);

    try {
      // Create Groq provider
      const llm = LLMFactory.create(WorkflowConfig.llm.provider, {
        model: WorkflowConfig.llm.model,
        temperature: WorkflowConfig.llm.temperature,
        maxTokens: WorkflowConfig.llm.maxTokens
      });

      console.log('✓ LLM provider created');

      // Test simple completion
      const testMessages = [{
        role: 'user',
        content: 'Say "Hello, Groq is working!" if you can read this message.'
      }];

      console.log('Sending test message...');
      const startTime = Date.now();

      const response = await llm.chat(testMessages);

      const duration = Date.now() - startTime;

      console.log('✅ Groq test successful!');
      console.log(`Response: ${response.content}`);
      console.log(`Duration: ${duration}ms`);
      console.log(`Model used: ${response.model || 'N/A'}`);

      if (response.usage) {
        console.log(`Tokens: prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}`);
      }

      return {
        success: true,
        response: response.content,
        duration,
        model: response.model,
        usage: response.usage
      };

    } catch (error) {
      console.error('❌ Groq test failed:', error.message);
      throw new Meteor.Error('groq-test-failed', error.message, error.details);
    }
  },

  'test.groqJSON': async function() {
    console.log('\n🧪 Testing Groq JSON mode...');

    try {
      const llm = LLMFactory.create(WorkflowConfig.llm.provider, {
        model: WorkflowConfig.llm.model,
        temperature: WorkflowConfig.llm.temperature,
        maxTokens: WorkflowConfig.llm.maxTokens
      });

      const testMessages = [
        {
          role: 'system',
          content: 'You are a helpful assistant that responds in JSON format.'
        },
        {
          role: 'user',
          content: `Extract key facts from this text and return as JSON:

"The PI3K-AKT pathway is activated in many cancers. PI3K phosphorylates PIP2 to generate PIP3, which recruits AKT to the membrane."

Return JSON format:
{
  "facts": [
    {"fact": "...", "category": "pathway|gene|interaction"}
  ]
}`
        }
      ];

      console.log('Sending JSON test...');
      const response = await llm.chat(testMessages);

      console.log('Raw response:', response.content);

      // Try to parse JSON
      let parsed;
      try {
        parsed = JSON.parse(response.content);
        console.log('✅ JSON parsing successful!');
        console.log('Parsed:', JSON.stringify(parsed, null, 2));
      } catch (parseError) {
        console.error('⚠️ JSON parsing failed, trying to extract JSON from response...');

        // Try to extract JSON from markdown code blocks
        const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
          console.log('✅ Extracted and parsed JSON from code block!');
        } else {
          throw parseError;
        }
      }

      return {
        success: true,
        parsed,
        raw: response.content
      };

    } catch (error) {
      console.error('❌ JSON test failed:', error.message);
      throw new Meteor.Error('groq-json-test-failed', error.message);
    }
  }
});

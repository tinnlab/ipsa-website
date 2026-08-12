# LLM Provider System

A unified, OpenAI-compatible interface for using multiple LLM providers (Ollama, vLLM, OpenAI, Groq, Gemini) with consistent API.

## Overview

The LLM system provides:
- **Unified Interface**: Single API for all providers following OpenAI Chat Completions standard
- **Easy Switching**: Change providers without code changes
- **Provider Flexibility**: Support for local (Ollama, vLLM) and cloud (OpenAI, Groq, Gemini) providers
- **Automatic Cleanup**: Built-in response cleaning (removes thinking tags, extra whitespace)
- **Error Handling**: Retry logic with exponential backoff
- **Type Safety**: Full parameter validation

## Architecture

```
server/llm/
├── LLMProvider.js           # Abstract base class
├── LLMFactory.js            # Provider factory
├── config.js                # Configuration & initialization
└── providers/
    ├── OllamaProvider.js    # Local Ollama
    ├── vLLMProvider.js      # High-performance local
    ├── OpenAIProvider.js    # Official OpenAI
    ├── GroqProvider.js      # Ultra-fast inference
    └── GeminiProvider.js    # Google Gemini
```

## Configuration

### 1. Meteor Settings

Add to `settings.json`:

```json
{
  "llm": {
    "default_provider": "vllm",
    "providers": {
      "ollama": {
        "baseUrl": "http://localhost:11434/v1",
        "model": "llama3.2",
        "temperature": 0.2,
        "maxTokens": 8000
      },
      "vllm": {
        "baseUrl": "http://localhost:8000",
        "model": "Qwen/Qwen3-32B-FP8",
        "temperature": 0.2,
        "maxTokens": 8000
      },
      "openai": {
        "apiKey": "sk-...",
        "model": "gpt-4-turbo",
        "temperature": 0.2,
        "maxTokens": 4000
      },
      "groq": {
        "apiKey": "gsk_...",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.2,
        "maxTokens": 8000
      },
      "gemini": {
        "apiKey": "...",
        "model": "gemini-2.0-flash-exp",
        "temperature": 0.2,
        "maxTokens": 8000
      }
    }
  }
}
```

### 2. Environment Variables

For API keys:
```bash
export OPENAI_API_KEY="sk-..."
export GROQ_API_KEY="gsk_..."
export GEMINI_API_KEY="..."
```

## Usage

### Basic Usage (Server-Side)

```javascript
import { getDefaultLLM } from './server/llm/config.js';

// Get configured default provider
const llm = getDefaultLLM();

// Simple chat
const response = await llm.chat("What is photosynthesis?");
console.log(response.content);

// Chat with messages array
const response = await llm.chat([
  { role: 'system', content: 'You are a helpful biology tutor.' },
  { role: 'user', content: 'Explain cell division.' }
]);

// With options
const response = await llm.chat("Explain DNA", {
  temperature: 0.7,
  max_tokens: 2000
});
```

### Using Specific Providers

```javascript
import { createLLM } from './server/llm/config.js';

// Create specific provider
const ollama = createLLM('ollama', {
  model: 'llama3.2',
  temperature: 0.1
});

const response = await ollama.chat("Hello!");
```

### Switching Providers

```javascript
import { switchDefaultProvider } from './server/llm/config.js';

// Switch to Groq for faster inference
switchDefaultProvider('groq');

// Now all calls use Groq
const llm = getDefaultLLM();
const response = await llm.chat("Fast question");
```

### Client-Side Usage (Meteor Methods)

```javascript
// Universal chat method
const result = await Meteor.callAsync('llm.chat',
  "What causes diabetes?",
  { temperature: 0.2, max_tokens: 1000 }
);

console.log(result.content);
console.log(result.provider); // Which provider was used

// Get provider info
const info = await Meteor.callAsync('llm.getProviderInfo');
console.log(info); // { provider: 'vLLM', model: 'Qwen/Qwen3-32B-FP8', ... }

// List available providers
const providers = await Meteor.callAsync('llm.listProviders');
console.log(providers);

// Switch provider
await Meteor.callAsync('llm.switchProvider', 'groq');
```

## Supported Providers

### Local Providers

#### Ollama
- **Endpoint**: `http://localhost:11434/v1/chat/completions`
- **Models**: llama3.2, qwen2.5, mistral, codellama, etc.
- **Setup**: Install Ollama locally, pull model
```bash
ollama pull llama3.2
```

#### vLLM
- **Endpoint**: Configurable (e.g., cloud instance)
- **Models**: Qwen, Llama, Mistral, etc.
- **Features**: High-performance, supports both completions & chat
- **Setup**: Deploy vLLM server with your model

### Cloud Providers

#### OpenAI
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Models**: gpt-4, gpt-4-turbo, gpt-3.5-turbo
- **Setup**: Get API key from platform.openai.com

#### Groq
- **Endpoint**: `https://api.groq.com/openai/v1/chat/completions`
- **Models**: llama-3.3-70b-versatile, mixtral-8x7b-32768
- **Features**: Ultra-fast inference
- **Setup**: Get API key from console.groq.com

#### Google Gemini
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- **Models**: gemini-2.0-flash-exp, gemini-1.5-pro
- **Features**: Multimodal, long context
- **Setup**: Get API key from ai.google.dev

## Advanced Features

### Response Format

```javascript
{
  content: "The answer is...",      // Cleaned response text
  usage: {                           // Token usage
    prompt_tokens: 50,
    completion_tokens: 100,
    total_tokens: 150
  },
  model: "Qwen/Qwen3-32B-FP8",      // Model used
  finish_reason: "stop",             // Why generation stopped
  raw: {...}                         // Full API response
}
```

### Auto-Cleaning

Responses are automatically cleaned:
- Removes `<think>...</think>` tags
- Trims whitespace
- Handles empty responses

### Error Handling

```javascript
try {
  const response = await llm.chat("Question");
} catch (error) {
  if (error.error === 'llm-failed-429') {
    console.log('Rate limited, retrying...');
  } else if (error.error === 'llm-failed-500') {
    console.log('Server error');
  }
}
```

### Retry Logic

Automatic retries for:
- Network errors (ECONNABORTED, ETIMEDOUT)
- Server errors (5xx status codes)
- Rate limiting (429 status)

Exponential backoff: 1s, 2s, 4s, up to 10s max

## Migration Guide

### From Old System

**Old way:**
```javascript
const { defaultvLLM } = await import('../config/llm-config.js');
const response = await defaultvLLM.generateText(prompt);
```

**New way:**
```javascript
import { getDefaultLLM } from '../llm/config.js';
const llm = getDefaultLLM();
const response = await llm.chat(prompt);
const text = response.content;
```

### Key Changes

1. **Method name**: `generateText()` → `chat()`
2. **Response format**: String → Object with `content` field
3. **No RAG**: RAG functionality removed, pure LLM calls
4. **Provider agnostic**: Works with any provider

## Examples

### Simple Q&A
```javascript
const llm = getDefaultLLM();
const response = await llm.chat("What is mitochondria?");
console.log(response.content);
```

### System Prompt + User Message
```javascript
const response = await llm.chat([
  { role: 'system', content: 'You are a bioinformatics expert.' },
  { role: 'user', content: 'Explain RNA-seq analysis.' }
], {
  temperature: 0.3,
  max_tokens: 500
});
```

### JSON Response
```javascript
const response = await llm.chat(
  "List 3 diabetes types in JSON: {\"types\": [...]}",
  { temperature: 0.1 }
);
const data = JSON.parse(response.content);
```

### Provider Comparison
```javascript
// Test same prompt across providers
const providers = ['vllm', 'groq', 'gemini'];
const results = [];

for (const provider of providers) {
  const llm = createLLM(provider);
  const response = await llm.chat("Explain CRISPR in one sentence.");
  results.push({
    provider,
    response: response.content,
    tokens: response.usage?.total_tokens
  });
}

console.table(results);
```

## Troubleshooting

### Provider Not Found
```
Error: No default LLM provider configured
```
**Solution**: Call `initializeDefaultLLM()` or check settings.json

### API Key Missing
```
Error: OpenAI API key is required
```
**Solution**: Set environment variable or add to settings.json

### Network Error
```
Error: vLLM request failed: No response received
```
**Solution**: Check provider URL, ensure service is running

### Empty Response
```
Error: No choices in response
```
**Solution**: Check model compatibility, try different parameters

## Performance Tips

1. **Use appropriate models**:
   - Fast tasks: Groq (llama-3.3-70b-versatile)
   - Complex tasks: OpenAI (gpt-4-turbo)
   - Local: Ollama (llama3.2) or vLLM (Qwen)

2. **Optimize parameters**:
   - Lower temperature (0.1-0.3) for factual responses
   - Reduce max_tokens for shorter responses
   - Use streaming for long responses (future feature)

3. **Batch requests**:
   - Group related queries
   - Use parallel processing when possible

## Contributing

To add a new provider:

1. Create provider class in `server/llm/providers/YourProvider.js`
2. Extend `LLMProvider` base class
3. Implement `chat()` method
4. Add to `LLMFactory.providers`
5. Update config defaults
6. Add documentation

## License

Part of the IPSA project. Licensed under the MIT License; see the LICENSE and NOTICE files at the repository root.

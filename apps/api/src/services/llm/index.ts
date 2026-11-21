import { registerProvider } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

export {
  type LLMProvider,
  type LLMMessage,
  type LLMStreamChunk,
  type LLMStreamRequest,
  registerProvider,
  getProvider,
  listProviders,
} from './provider.js';
export { GeminiProvider } from './gemini.js';
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { FakeLLMProvider } from './fake.js';

// Auto-register built-in providers
registerProvider(new GeminiProvider());
registerProvider(new OpenAIProvider());
registerProvider(new AnthropicProvider());


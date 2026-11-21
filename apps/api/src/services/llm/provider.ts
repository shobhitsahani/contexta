/**
 * Provider-agnostic LLM interface.
 *
 * Each adapter implements this interface. The streaming response yields
 * text deltas and final usage info.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStreamChunk {
  text?: string;
  usage?: { in: number; out: number };
}

export interface LLMStreamRequest {
  model: string;
  system: string;
  messages: LLMMessage[];
  apiKey: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: string;
  stream(req: LLMStreamRequest): AsyncIterable<LLMStreamChunk>;
}

/**
 * Registry of LLM providers by id.
 */
const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): LLMProvider {
  const p = providers.get(id);
  if (!p) {
    throw new Error(`Unknown LLM provider: ${id}. Registered: ${[...providers.keys()].join(', ')}`);
  }
  return p;
}

export function listProviders(): string[] {
  return [...providers.keys()];
}

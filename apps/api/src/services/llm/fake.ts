import type { LLMProvider, LLMStreamChunk, LLMStreamRequest } from './provider.js';

/**
 * Fake LLM provider for testing.
 * Returns configurable canned responses.
 */
export class FakeLLMProvider implements LLMProvider {
  readonly id: string;
  private responses: string[];
  private callCount = 0;
  public lastRequest?: LLMStreamRequest;

  constructor(id = 'fake', responses: string[] = ['This is a test response based on the provided sources [1].']) {
    this.id = id;
    this.responses = responses;
  }

  async *stream(req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
    this.lastRequest = req;
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;

    // Simulate streaming: yield word by word
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (req.signal?.aborted) {
        throw new Error('Aborted');
      }
      const text = i === 0 ? words[i] : ' ' + words[i];
      yield { text };
    }

    // Yield final usage
    const inTokens = Math.ceil(req.system.length / 4) + req.messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
    const outTokens = Math.ceil(response.length / 4);
    yield { usage: { in: inTokens, out: outTokens } };
  }

  getCallCount(): number {
    return this.callCount;
  }

  setResponses(responses: string[]): void {
    this.responses = responses;
  }
}

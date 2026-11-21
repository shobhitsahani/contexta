/**
 * Tests for LLM provider interface and fake provider.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registerProvider,
  getProvider,
  listProviders,
} from '../../apps/api/src/services/llm/provider.js';
import { FakeLLMProvider } from '../../apps/api/src/services/llm/fake.js';
import { GeminiProvider } from '../../apps/api/src/services/llm/gemini.js';
import { OpenAIProvider } from '../../apps/api/src/services/llm/openai.js';
import { AnthropicProvider } from '../../apps/api/src/services/llm/anthropic.js';


describe('LLM Provider Registry', () => {
  beforeEach(() => {
    // Register fresh provider for each test
  });

  it('registers and retrieves a provider', () => {
    const fake = new FakeLLMProvider('test-reg');
    registerProvider(fake);
    const retrieved = getProvider('test-reg');
    expect(retrieved.id).toBe('test-reg');
  });

  it('throws for unknown provider', () => {
    expect(() => getProvider('nonexistent')).toThrow('Unknown LLM provider');
  });

  it('lists registered providers', () => {
    registerProvider(new FakeLLMProvider('list-test'));
    const list = listProviders();
    expect(list).toContain('list-test');
  });
});

describe('FakeLLMProvider', () => {
  it('streams text word by word', async () => {
    const fake = new FakeLLMProvider('fake', ['Hello world from test']);
    const chunks: string[] = [];

    for await (const chunk of fake.stream({
      model: 'test',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hi' }],
      apiKey: 'key',
    })) {
      if (chunk.text) chunks.push(chunk.text);
    }

    expect(chunks.join('')).toBe('Hello world from test');
  });

  it('yields usage at the end', async () => {
    const fake = new FakeLLMProvider('fake', ['Short']);
    let usage: { in: number; out: number } | undefined;

    for await (const chunk of fake.stream({
      model: 'test',
      system: 'System',
      messages: [{ role: 'user', content: 'Q' }],
      apiKey: 'key',
    })) {
      if (chunk.usage) usage = chunk.usage;
    }

    expect(usage).toBeDefined();
    expect(usage!.in).toBeGreaterThan(0);
    expect(usage!.out).toBeGreaterThan(0);
  });

  it('records last request', async () => {
    const fake = new FakeLLMProvider('fake');
    for await (const _ of fake.stream({
      model: 'my-model',
      system: 'sys',
      messages: [{ role: 'user', content: 'question' }],
      apiKey: 'secret',
    })) {
      // consume
    }

    expect(fake.lastRequest).toBeDefined();
    expect(fake.lastRequest!.model).toBe('my-model');
    expect(fake.lastRequest!.apiKey).toBe('secret');
  });

  it('cycles through multiple configured responses', async () => {
    const fake = new FakeLLMProvider('fake', ['Response A', 'Response B']);

    const collect = async () => {
      const parts: string[] = [];
      for await (const chunk of fake.stream({
        model: 't', system: 's',
        messages: [{ role: 'user', content: 'q' }],
        apiKey: 'k',
      })) {
        if (chunk.text) parts.push(chunk.text);
      }
      return parts.join('');
    };

    expect(await collect()).toBe('Response A');
    expect(await collect()).toBe('Response B');
    expect(await collect()).toBe('Response A'); // Cycles
  });

  it('respects abort signal', async () => {
    const fake = new FakeLLMProvider('fake', ['A very long response with many words to stream']);
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    await expect(async () => {
      for await (const _ of fake.stream({
        model: 't', system: 's',
        messages: [{ role: 'user', content: 'q' }],
        apiKey: 'k',
        signal: controller.signal,
      })) {
        // Should throw
      }
    }).rejects.toThrow('Aborted');
  });
});

// ── Helper for mock streaming fetch responses ──

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('GeminiProvider (mocked fetch)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams text chunks and reports usage metadata', async () => {
    const ssePayload = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Gemini answer"}]}}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":7}}\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createMockStream(ssePayload),
    });

    const provider = new GeminiProvider();
    const texts: string[] = [];
    let usage: { in: number; out: number } | undefined;

    for await (const chunk of provider.stream({
      model: 'gemini-2.0-flash',
      system: 'Instructions',
      messages: [{ role: 'user', content: 'Question' }],
      apiKey: 'test-key',
    })) {
      if (chunk.text) texts.push(chunk.text);
      if (chunk.usage) usage = chunk.usage;
    }

    expect(texts.join('')).toBe('Gemini answer');
    expect(usage).toEqual({ in: 15, out: 7 });
  });

  it('throws descriptive error on API failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Quota exceeded',
    });

    const provider = new GeminiProvider();
    await expect(async () => {
      for await (const _ of provider.stream({
        model: 'gemini-2.0-flash',
        system: '',
        messages: [{ role: 'user', content: 'Hi' }],
        apiKey: 'bad-key',
      })) {
        // consume
      }
    }).rejects.toThrow('Gemini API error 403: Quota exceeded');
  });
});

describe('OpenAIProvider (mocked fetch)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams text deltas and reports usage', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"OpenAI "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"response"}}],"usage":{"prompt_tokens":12,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createMockStream(ssePayload),
    });

    const provider = new OpenAIProvider();
    const texts: string[] = [];
    let usage: { in: number; out: number } | undefined;

    for await (const chunk of provider.stream({
      model: 'gpt-4o',
      system: 'Sys prompt',
      messages: [{ role: 'user', content: 'Prompt' }],
      apiKey: 'sk-test',
    })) {
      if (chunk.text) texts.push(chunk.text);
      if (chunk.usage) usage = chunk.usage;
    }

    expect(texts.join('')).toBe('OpenAI response');
    expect(usage).toEqual({ in: 12, out: 5 });
  });

  it('throws descriptive error on API failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid API key',
    });

    const provider = new OpenAIProvider();
    await expect(async () => {
      for await (const _ of provider.stream({
        model: 'gpt-4o',
        system: '',
        messages: [{ role: 'user', content: 'Hi' }],
        apiKey: 'bad-key',
      })) {
        // consume
      }
    }).rejects.toThrow('OpenAI API error 401: Invalid API key');
  });
});

describe('AnthropicProvider (mocked fetch)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams content blocks and tracks token usage', async () => {
    const ssePayload = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"Claude "}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"reply"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":8}}\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: createMockStream(ssePayload),
    });

    const provider = new AnthropicProvider();
    const texts: string[] = [];
    const usages: Array<{ in: number; out: number }> = [];

    for await (const chunk of provider.stream({
      model: 'claude-3-5-sonnet-20241022',
      system: 'Instructions',
      messages: [{ role: 'user', content: 'Hi' }],
      apiKey: 'sk-ant-test',
    })) {
      if (chunk.text) texts.push(chunk.text);
      if (chunk.usage) usages.push(chunk.usage);
    }

    expect(texts.join('')).toBe('Claude reply');
    expect(usages).toContainEqual({ in: 20, out: 0 });
    expect(usages).toContainEqual({ in: 20, out: 8 });
  });

  it('throws descriptive error on API failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid request parameters',
    });

    const provider = new AnthropicProvider();
    await expect(async () => {
      for await (const _ of provider.stream({
        model: 'claude-3-5-sonnet-20241022',
        system: '',
        messages: [{ role: 'user', content: 'Hi' }],
        apiKey: 'test-key',
      })) {
        // consume
      }
    }).rejects.toThrow('Anthropic API error 400: Invalid request parameters');
  });
});


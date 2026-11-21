import type { LLMProvider, LLMStreamChunk, LLMStreamRequest } from './provider.js';

/**
 * OpenAI adapter using the chat completions streaming API.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';

  async *stream(req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (req.system && req.system.trim()) {
      messages.push({ role: 'system', content: req.system });
    }
    for (const m of req.messages) {
      if (m.role === 'system') continue;
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.4,
        max_tokens: 4096,
      }),
      signal: req.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('OpenAI: no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              yield { text: delta };
            }
            const usage = parsed?.usage;
            if (usage) {
              yield {
                usage: {
                  in: usage.prompt_tokens ?? 0,
                  out: usage.completion_tokens ?? 0,
                },
              };
            }
          } catch {
            // Skip malformed
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

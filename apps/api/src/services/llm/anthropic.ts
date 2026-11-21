import type { LLMProvider, LLMStreamChunk, LLMStreamRequest } from './provider.js';

/**
 * Anthropic adapter using the Messages streaming API.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';

  async *stream(req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
    const url = 'https://api.anthropic.com/v1/messages';

    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        system: req.system,
        messages,
        stream: true,
        max_tokens: 4096,
        temperature: 0.4,
      }),
      signal: req.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('Anthropic: no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

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
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);

            if (parsed.type === 'content_block_delta') {
              const text = parsed.delta?.text;
              if (text) {
                yield { text };
              }
            }

            if (parsed.type === 'message_start') {
              const usage = parsed.message?.usage;
              if (usage?.input_tokens != null) {
                inputTokens = usage.input_tokens;
                yield {
                  usage: {
                    in: inputTokens,
                    out: outputTokens,
                  },
                };
              }
            }

            if (parsed.type === 'message_delta') {
              const usage = parsed.usage;
              if (usage) {
                if (usage.input_tokens != null) inputTokens = usage.input_tokens;
                if (usage.output_tokens != null) outputTokens = usage.output_tokens;
                yield {
                  usage: {
                    in: inputTokens,
                    out: outputTokens,
                  },
                };
              }
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

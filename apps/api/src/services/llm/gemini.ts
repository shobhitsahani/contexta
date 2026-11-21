import type { LLMProvider, LLMStreamChunk, LLMStreamRequest } from './provider.js';

/**
 * Gemini adapter using the REST streaming API.
 *
 * Uses the generateContent endpoint with stream=true.
 * API key is passed as a query parameter per Google's convention.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini';

  async *stream(req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse&key=${req.apiKey}`;

    const body: Record<string, unknown> = {
      contents: this.buildContents(req.messages),
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    };

    if (req.system && req.system.trim()) {
      body.systemInstruction = {
        parts: [{ text: req.system }],
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('Gemini: no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalIn = 0;
    let totalOut = 0;

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
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield { text };
            }
            const usage = parsed?.usageMetadata;
            if (usage) {
              totalIn = usage.promptTokenCount ?? totalIn;
              totalOut = usage.candidatesTokenCount ?? totalOut;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (totalIn > 0 || totalOut > 0) {
      yield { usage: { in: totalIn, out: totalOut } };
    }
  }

  private buildContents(messages: LLMStreamRequest['messages']) {
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        last.parts.push({ text: msg.content });
      } else {
        contents.push({
          role,
          parts: [{ text: msg.content }],
        });
      }
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: '' }] });
    }

    return contents;
  }
}

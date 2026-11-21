/**
 * Shared test helpers for Contexta QA.
 * Additive test-only files; no production code is modified.
 */

import type {
  RetrievalDB,
  SearchHit,
} from "../src/services/retrieval/search.js";
import type { Embedder } from "../src/services/embedding/embedder.js";
import type { LLMProvider, LLMStreamChunk, LLMStreamRequest } from "../src/services/llm/provider.js";
import type { StorageService } from "../src/services/storage.js";

export { FakeEmbedder } from "../src/services/embedding/embedder.js";
export type { Embedder };

export function makeSearchHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    documentName: "doc.txt",
    page: 1,
    content: "sample content",
    score: 0.9,
    ...overrides,
  };
}

export class FakeStorage implements StorageService {
  store = new Map<string, { buffer: Buffer; mimeType: string }>();
  async upload(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    this.store.set(key, { buffer: Buffer.from(buffer), mimeType });
    return key;
  }
  async download(key: string): Promise<Buffer> {
    const item = this.store.get(key);
    if (!item) throw new Error(`File not found: ${key}`);
    return item.buffer;
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  clear(): void {
    this.store.clear();
  }
}

export class FakeRetrievalDB implements RetrievalDB {
  vectorHits = new Map<string, SearchHit[]>();
  textHits = new Map<string, SearchHit[]>();
  async vectorSearch(
    userId: string,
    documentIds: string[],
    queryVec: number[],
    limit: number,
  ): Promise<SearchHit[]> {
    const key = `${userId}|${documentIds.join(",")}|${limit}`;
    return (this.vectorHits.get(key) ?? []).slice(0, limit);
  }
  async fullTextSearch(
    userId: string,
    documentIds: string[],
    queryText: string,
    limit: number,
  ): Promise<SearchHit[]> {
    const key = `${userId}|${documentIds.join(",")}|${queryText}|${limit}`;
    return (this.textHits.get(key) ?? []).slice(0, limit);
  }
}

export class FakeLLMProviderForTest implements LLMProvider {
  readonly id = "fake-test";
  responses: string[];
  callCount = 0;
  lastRequest?: LLMStreamRequest;

  constructor(responses?: string[]) {
    this.responses = responses ?? ["Based on the sources [1], the answer is yes."];
  }

  async *stream(_req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
    if (_req.signal?.aborted) {
      throw new Error("Aborted");
    }
    this.lastRequest = _req;
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    const words = response.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (_req.signal?.aborted) {
        throw new Error("Aborted");
      }
      const text = i === 0 ? words[i] : " " + words[i];
      yield { text };
    }
    yield { usage: { in: 10, out: Math.ceil(response.length / 4) } };
  }
}

export interface SSEEvent {
  type: string;
  data: any;
}

export function parseSseText(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let buffer = text;
  let idx: number;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let type = "";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) type = line.slice(7);
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (type) {
      try {
        events.push({ type, data: dataStr ? JSON.parse(dataStr) : {} });
      } catch {
        events.push({ type, data: dataStr });
      }
    }
  }
  return events;
}

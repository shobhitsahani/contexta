import { describe, expect, it, vi } from "vitest";
import {
  FIXED_EMBEDDING_DIMENSION,
  GeminiEmbedder,
} from "../../src/services/ingestion/embed.js";

describe("Gemini Embedder", () => {
  it("defaults to 768 fixed dimensions", () => {
    const embedder = new GeminiEmbedder({ apiKey: "test-api-key" });
    expect(embedder.dimension).toBe(FIXED_EMBEDDING_DIMENSION);
  });

  it("embeds a single text and returns a 768-dim vector", async () => {
    const mockVector = new Array(768).fill(0.123);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [{ values: mockVector }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder({ apiKey: "test-api-key" });
    const vec = await embedder.embed("Hello Contexta Embedding");

    expect(vec).toHaveLength(768);
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("embeds multiple texts in batches", async () => {
    const mockVectors = [new Array(768).fill(0.1), new Array(768).fill(0.2)];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: mockVectors.map((values) => ({ values })),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder({ apiKey: "test-api-key" });
    const vecs = await embedder.embedBatch(["Text 1", "Text 2"]);

    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(768);
    expect(vecs[1]).toHaveLength(768);

    const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(calledBody.requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
    expect(calledBody.requests[0].outputDimensionality).toBe(768);
    vi.unstubAllGlobals();
  });

  it("retries on rate limit (429) with exponential backoff", async () => {
    let callCount = 0;
    const mockVector = new Array(768).fill(0.5);

    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => "Rate limit exceeded: 429 RESOURCE_EXHAUSTED",
        };
      }
      return {
        ok: true,
        json: async () => ({
          embeddings: [{ values: mockVector }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder({
      apiKey: "test-api-key",
      maxRetries: 2,
    });
    const vec = await embedder.embed("Retry test query");

    expect(callCount).toBe(2);
    expect(vec).toHaveLength(768);
    vi.unstubAllGlobals();
  });
});

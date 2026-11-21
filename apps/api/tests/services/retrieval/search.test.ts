import { describe, it, expect } from "vitest";
import { search, reciprocalRankFusion } from "../../../src/services/retrieval/search.js";
import type { SearchHit } from "../../../src/services/retrieval/search.js";

const baseHit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  chunkId: "c1",
  documentId: "d1",
  documentName: "d1.txt",
  page: 1,
  content: "x",
  score: 0.5,
  ...overrides,
});

describe("reciprocalRankFusion", () => {
  it("combines two ranked lists by RRF", () => {
    const v = [baseHit({ chunkId: "a" }), baseHit({ chunkId: "b" })];
    const t = [baseHit({ chunkId: "b" }), baseHit({ chunkId: "c" })];
    const out = reciprocalRankFusion(v, t, 10);
    expect(out.length).toBe(3);
    // "b" appears in both lists -> highest score
    expect(out[0].chunkId).toBe("b");
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("is capped at topK", () => {
    const v = Array.from({ length: 20 }, (_, i) => baseHit({ chunkId: `v${i}` }));
    const t: SearchHit[] = [];
    const out = reciprocalRankFusion(v, t, 5);
    expect(out).toHaveLength(5);
  });
});

describe("search (hybrid + vector-only)", () => {
  const userId = "user-1";
  const docIds = ["d1"];

  it("vector-only returns vector hits above threshold", async () => {
    const db: any = {
      vectorSearch: async () => [
        makeHit("c1", 0.9),
        makeHit("c2", 0.4),
        makeHit("c3", 0.2),
      ],
      fullTextSearch: async () => [],
    };
    const hits = await search(db, {
      userId,
      documentIds: docIds,
      queryVec: [0.1, 0.2],
      queryText: "q",
      topK: 8,
      scoreThreshold: 0.3,
      hybridSearch: false,
    });
    expect(hits.map((h) => h.chunkId)).toEqual(["c1", "c2"]);
  });

  it("hybrid mode fuses vector + full-text and applies threshold", async () => {
    const db: any = {
      vectorSearch: async () => [makeHit("a", 0.9), makeHit("b", 0.5)],
      fullTextSearch: async () => [makeHit("b", 0.8), makeHit("c", 0.7)],
    };
    const hits = await search(db, {
      userId,
      documentIds: docIds,
      queryVec: [0.1],
      queryText: "term",
      topK: 8,
      scoreThreshold: 0.0,
      hybridSearch: true,
    });
    // "b" should be top due to appearing in both
    expect(hits[0].chunkId).toBe("b");
  });

  it("returns empty when no document ids", async () => {
    const db: any = { vectorSearch: async () => [], fullTextSearch: async () => [] };
    const hits = await search(db, {
      userId,
      documentIds: [],
      queryVec: [0.1],
      queryText: "q",
      topK: 8,
      scoreThreshold: 0,
      hybridSearch: false,
    });
    expect(hits).toEqual([]);
  });

  it("is scoped by userId and documentIds (passes through to db)", async () => {
    const seen: string[] = [];
    const db: any = {
      vectorSearch: async (_u: string, ids: string[]) => {
        seen.push(...ids);
        return [];
      },
      fullTextSearch: async () => [],
    };
    await search(db, {
      userId,
      documentIds: ["d1", "d2"],
      queryVec: [0.1],
      queryText: "q",
      topK: 8,
      scoreThreshold: 0,
      hybridSearch: false,
    });
    expect(seen).toEqual(["d1", "d2"]);
  });

  it("hybrid scoreThreshold of 0.3 filters out low RRF scores (regression guard)", async () => {
    const db: any = {
      vectorSearch: async () => [makeHit("a", 0.9)],
      fullTextSearch: async () => [makeHit("a", 0.9)],
    };
    const hits = await search(db, {
      userId,
      documentIds: docIds,
      queryVec: [0.1],
      queryText: "q",
      topK: 8,
      scoreThreshold: 0.3,
      hybridSearch: true,
    });
    // RRF fusion scores are ~0.016, far below 0.3 -> all filtered
    expect(hits).toEqual([]);
  });
});

function makeHit(chunkId: string, score: number): SearchHit {
  return baseHit({ chunkId, score });
}

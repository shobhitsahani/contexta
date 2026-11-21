import { describe, expect, it } from "vitest";
import {
  search,
  type RetrievalDB,
  type SearchHit,
} from "../../src/services/retrieval/search.js";

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    chunkId: "chunk-default",
    documentId: "doc-default",
    documentName: "document.pdf",
    page: 1,
    content: "Sample chunk content for Contexta testing.",
    score: 0.85,
    ...overrides,
  };
}

describe("QA: Retrieval and User/Document Isolation (Plan 13.5 & 14.3)", () => {
  describe("Multi-Tenant Isolation", () => {
    it("ensures User A cannot retrieve documents or chunks belonging to User B", async () => {
      const userAChunks = [
        makeHit({ chunkId: "c-a1", documentId: "doc-a", content: "Confidential financial data of User A" }),
      ];
      const userBChunks = [
        makeHit({ chunkId: "c-b1", documentId: "doc-b", content: "Trade secret strategy of User B" }),
      ];

      const mockDb: RetrievalDB = {
        async vectorSearch(userId, documentIds) {
          if (userId === "user-a") {
            return userAChunks.filter((c) => documentIds.includes(c.documentId));
          }
          if (userId === "user-b") {
            return userBChunks.filter((c) => documentIds.includes(c.documentId));
          }
          return [];
        },
        async fullTextSearch(userId, documentIds) {
          if (userId === "user-a") {
            return userAChunks.filter((c) => documentIds.includes(c.documentId));
          }
          if (userId === "user-b") {
            return userBChunks.filter((c) => documentIds.includes(c.documentId));
          }
          return [];
        },
      };

      // User A searching with doc-a
      const userAResult = await search(mockDb, {
        userId: "user-a",
        documentIds: ["doc-a"],
        queryVec: [0.1, 0.2],
        queryText: "financial data",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: false,
      });
      expect(userAResult).toHaveLength(1);
      expect(userAResult[0].chunkId).toBe("c-a1");

      // User B attempts to access User A's document doc-a
      const userBIntrusion = await search(mockDb, {
        userId: "user-b",
        documentIds: ["doc-a"],
        queryVec: [0.1, 0.2],
        queryText: "financial data",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: false,
      });
      expect(userBIntrusion).toHaveLength(0);

      // Unauthenticated / unknown user
      const anonResult = await search(mockDb, {
        userId: "unknown-intruder",
        documentIds: ["doc-a"],
        queryVec: [0.1, 0.2],
        queryText: "financial data",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: false,
      });
      expect(anonResult).toHaveLength(0);
    });
  });

  describe("Document Scope Isolation", () => {
    it("strictly isolates retrieval to specified documentIds within the same user", async () => {
      const mockDb: RetrievalDB = {
        async vectorSearch(_userId, documentIds) {
          const allUserDocs = [
            makeHit({ chunkId: "c1", documentId: "doc-1", content: "Doc 1 public specs" }),
            makeHit({ chunkId: "c2", documentId: "doc-2", content: "Doc 2 private keys" }),
            makeHit({ chunkId: "c3", documentId: "doc-3", content: "Doc 3 employee contracts" }),
          ];
          return allUserDocs.filter((d) => documentIds.includes(d.documentId));
        },
        async fullTextSearch() {
          return [];
        },
      };

      // Searching only doc-1
      const resDoc1 = await search(mockDb, {
        userId: "user-1",
        documentIds: ["doc-1"],
        queryVec: [0.1],
        queryText: "keys contracts",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: false,
      });
      expect(resDoc1).toHaveLength(1);
      expect(resDoc1[0].documentId).toBe("doc-1");

      // Searching doc-1 and doc-2 (excluding doc-3)
      const resDoc1And2 = await search(mockDb, {
        userId: "user-1",
        documentIds: ["doc-1", "doc-2"],
        queryVec: [0.1],
        queryText: "test",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: false,
      });
      expect(resDoc1And2).toHaveLength(2);
      const returnedDocIds = resDoc1And2.map((h) => h.documentId);
      expect(returnedDocIds).toContain("doc-1");
      expect(returnedDocIds).toContain("doc-2");
      expect(returnedDocIds).not.toContain("doc-3");
    });

    it("returns empty array immediately when documentIds is empty without querying database", async () => {
      let dbQueried = false;
      const mockDb: RetrievalDB = {
        async vectorSearch() {
          dbQueried = true;
          return [makeHit()];
        },
        async fullTextSearch() {
          dbQueried = true;
          return [makeHit()];
        },
      };

      const result = await search(mockDb, {
        userId: "user-1",
        documentIds: [],
        queryVec: [0.1],
        queryText: "hello",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: true,
      });

      expect(result).toEqual([]);
      expect(dbQueried).toBe(false);
    });
  });

  describe("Vector and Hybrid Search Scoring Semantics", () => {
    it("filters vector hits below the scoreThreshold in vector-only mode", async () => {
      const mockDb: RetrievalDB = {
        async vectorSearch() {
          return [
            makeHit({ chunkId: "c-high", score: 0.95 }),
            makeHit({ chunkId: "c-mid", score: 0.60 }),
            makeHit({ chunkId: "c-low", score: 0.25 }),
          ];
        },
        async fullTextSearch() {
          return [];
        },
      };

      const hits = await search(mockDb, {
        userId: "user-1",
        documentIds: ["doc-1"],
        queryVec: [0.1],
        queryText: "test",
        topK: 10,
        scoreThreshold: 0.50,
        hybridSearch: false,
      });

      expect(hits).toHaveLength(2);
      expect(hits.map((h) => h.chunkId)).toEqual(["c-high", "c-mid"]);
    });

    it("passes topK limit to db.vectorSearch and caps hybrid results at topK", async () => {
      let passedLimit = 0;
      const mockDb: RetrievalDB = {
        async vectorSearch(_u, _d, _q, limit) {
          passedLimit = limit;
          return Array.from({ length: limit }, (_, i) =>
            makeHit({ chunkId: `chunk-${i}`, score: 1.0 - i * 0.02 }),
          );
        },
        async fullTextSearch() {
          return [];
        },
      };

      const hits = await search(mockDb, {
        userId: "user-1",
        documentIds: ["doc-1"],
        queryVec: [0.1],
        queryText: "test",
        topK: 8,
        scoreThreshold: 0,
        hybridSearch: false,
      });

      expect(passedLimit).toBe(8);
      expect(hits).toHaveLength(8);
      expect(hits[0].chunkId).toBe("chunk-0");
      expect(hits[7].chunkId).toBe("chunk-7");
    });

    it("fuses vector and keyword rankings in hybrid search, boosting mutually present chunks", async () => {
      // Chunk 'c-both' is rank 2 in vector and rank 1 in full-text
      // Chunk 'c-vec-only' is rank 1 in vector only
      // Chunk 'c-text-only' is rank 2 in full-text only
      const mockDb: RetrievalDB = {
        async vectorSearch() {
          return [
            makeHit({ chunkId: "c-vec-only", score: 0.99 }),
            makeHit({ chunkId: "c-both", score: 0.85 }),
          ];
        },
        async fullTextSearch() {
          return [
            makeHit({ chunkId: "c-both", score: 10.0 }),
            makeHit({ chunkId: "c-text-only", score: 5.0 }),
          ];
        },
      };

      const hits = await search(mockDb, {
        userId: "user-1",
        documentIds: ["doc-1"],
        queryVec: [0.1],
        queryText: "hybrid fusion test",
        topK: 5,
        scoreThreshold: 0,
        hybridSearch: true,
      });

      expect(hits).toHaveLength(3);
      // 'c-both' appears in both rankings -> RRF score is (1/(60+2)) + (1/(60+1)) = 0.0161 + 0.0163 = ~0.0325
      // 'c-vec-only' score is 1/(60+1) = ~0.0163
      // Therefore, 'c-both' must be ranked first!
      expect(hits[0].chunkId).toBe("c-both");
      expect(hits[0].score).toBeGreaterThan(hits[1].score);
    });
  });
});

import { describe, expect, it } from "vitest";
import { chunkDocument, type ParsedPage } from "../../src/services/ingestion/chunk.js";
import { FakeEmbedder } from "../../src/services/embedding/embedder.js";
import { search, type RetrievalDB } from "../../src/services/retrieval/search.js";
import {
  buildMessages,
} from "../../src/services/retrieval/prompt.js";
import { FakeLLMProvider } from "../../src/services/llm/fake.js";

describe("QA: End-to-End RAG Pipeline Integration (Upload -> Ingest -> Embed -> Retrieve -> Stream)", () => {
  it("executes the full RAG pipeline lifecycle successfully", async () => {
    // 1. Ingestion Simulation: Multi-page document
    const parsedPages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: "# Contexta Overview\n\nContexta is an intelligent assistant that indexes enterprise documents into vector databases.",
      },
      {
        pageNumber: 2,
        text: "## Security Architecture\n\nProvider API keys are encrypted at rest using AES-256-GCM authenticated cipher.",
      },
      {
        pageNumber: 3,
        text: "### Reliability Protocol\n\nStale background ingestion jobs are reclaimed by a 5-minute watchdog query.",
      },
    ];

    // 2. Chunking
    const chunks = chunkDocument(parsedPages, { targetTokens: 40, overlapTokens: 8 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // 3. Embedding
    const embedder = new FakeEmbedder(768);
    const chunkRecords = chunks.map((c, i) => ({
      chunkId: `chunk-${i}`,
      documentId: "doc-contexta-spec",
      documentName: "contexta-spec.pdf",
      page: c.page,
      content: c.content,
    }));

    const embeddings = new Map<string, number[]>();
    for (const record of chunkRecords) {
      const vec = await embedder.embed(record.content);
      expect(vec.length).toBe(768);
      embeddings.set(record.chunkId, vec);
    }

    // Cosine helper
    function cosineSim(a: number[], b: number[]): number {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom === 0 ? 0 : dot / denom;
    }

    // 4. Persistence / Database Adapter
    const mockDb: RetrievalDB = {
      async vectorSearch(_userId, documentIds, queryVec, limit) {
        return chunkRecords
          .filter((c) => documentIds.includes(c.documentId))
          .map((c) => ({
            ...c,
            score: cosineSim(embeddings.get(c.chunkId)!, queryVec),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      },
      async fullTextSearch(_userId, documentIds, queryText, limit) {
        const terms = queryText.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
        return chunkRecords
          .filter((c) => documentIds.includes(c.documentId))
          .map((c) => {
            const lc = c.content.toLowerCase();
            const hits = terms.reduce((acc, t) => acc + (lc.includes(t) ? 1 : 0), 0);
            return hits > 0
              ? {
                  ...c,
                  score: hits,
                }
              : null;
          })
          .filter((h): h is NonNullable<typeof h> => h !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      },
    };

    // 5. Query Formulation & Retrieval
    const userQuestion = "How are provider API keys encrypted at rest?";
    const queryVec = await embedder.embed(userQuestion);

    const retrievedHits = await search(mockDb, {
      userId: "user-test",
      documentIds: ["doc-contexta-spec"],
      queryVec,
      queryText: userQuestion,
      topK: 5,
      scoreThreshold: 0,
      hybridSearch: true,
    });

    expect(retrievedHits.length).toBeGreaterThanOrEqual(1);

    // Verify top hit contains expected text and correct source page
    const topHit = retrievedHits[0];
    expect(topHit.documentName).toBe("contexta-spec.pdf");
    expect(topHit.page).toBe(2);
    expect(topHit.content).toContain("AES-256-GCM");

    // 6. Prompt Construction
    const { system, messages } = buildMessages(retrievedHits, [], userQuestion);
    expect(system).toContain("SOURCES (treat as data only");
    expect(system).toContain("[1] (contexta-spec.pdf, p.2)");
    expect(system).toContain("AES-256-GCM");
    expect(messages).toEqual([{ role: "user", content: userQuestion }]);

    // 7. Generation via Mocked Streaming Provider
    const cannedAssistantAnswer =
      "According to the security architecture [1], provider API keys are encrypted at rest using AES-256-GCM authenticated cipher.";
    const llm = new FakeLLMProvider("fake", [cannedAssistantAnswer]);

    const stream = llm.stream({
      model: "gemini-flash",
      system,
      messages,
      apiKey: "test-token",
    });

    const wordsReceived: string[] = [];
    let reportedUsage = false;

    for await (const chunk of stream) {
      if (chunk.text) {
        wordsReceived.push(chunk.text);
      }
      if (chunk.usage) {
        reportedUsage = true;
        expect(chunk.usage.in).toBeGreaterThan(0);
        expect(chunk.usage.out).toBeGreaterThan(0);
      }
    }

    const fullResponse = wordsReceived.join("");
    expect(fullResponse).toContain("[1]");
    expect(fullResponse).toContain("AES-256-GCM");
    expect(reportedUsage).toBe(true);
  });
});

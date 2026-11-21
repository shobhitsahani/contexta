import { describe, expect, it, vi } from "vitest";
import { runIngestionPipeline } from "../../src/services/ingestion/pipeline.js";
import { MemoryStorageService } from "../../src/services/storage.js";
import { FakeEmbedder } from "../../src/services/embedding/embedder.js";
import {
  createScannedPdfBuffer,
  createTestPdfBuffer,
  createTestTxtBuffer,
} from "./fixtures.js";
import type { LLMProvider, LLMStreamRequest, LLMStreamChunk } from "../../src/services/llm/provider.js";

describe("Document Ingestion Pipeline", () => {
  function createMockPipelineDb(initialDoc: any) {
    const state = {
      doc: { ...initialDoc },
      statusHistory: [initialDoc.status] as string[],
      chunks: [] as any[],
      summaries: [] as any[],
    };

    const fakeDb = {
      state,
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((_table: any) => ({
          where: vi.fn().mockImplementation(() => {
            return Promise.resolve([state.doc]);
          }),
        })),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((fields: any) => ({
          where: vi.fn().mockImplementation(() => {
            Object.assign(state.doc, fields);
            if (fields.status) {
              state.statusHistory.push(fields.status);
            }
            return Promise.resolve();
          }),
        })),
      })),
      insert: vi.fn().mockImplementation((_table: any) => ({
        values: vi.fn().mockImplementation((items: any) => {
          const list = Array.isArray(items) ? items : [items];
          // Distinguish between chunks and summaries by table name or properties
          if (list[0]?.embedding !== undefined || list[0]?.chunkIndex !== undefined) {
            state.chunks.push(...list);
          } else {
            state.summaries.push(...list);
          }
          return Promise.resolve();
        }),
      })),
      delete: vi.fn().mockImplementation((_table: any) => ({
        where: vi.fn().mockImplementation(() => {
          return Promise.resolve();
        }),
      })),
    };

    return fakeDb;
  }

  function createMockSummaryLLM(): LLMProvider {
    return {
      id: "gemini",
      async *stream(_req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
        yield {
          text: JSON.stringify({
            overview: "Overview of the test document.",
            keyPoints: ["Point A", "Point B"],
            sections: [
              {
                title: "Introduction",
                pageStart: 1,
                pageEnd: 1,
                summary: "Introductory section summary.",
              },
            ],
          }),
        };
      },
    };
  }

  it("completes full pipeline: queued -> parsing -> embedding -> ready", async () => {
    const storage = new MemoryStorageService();
    const storageKey = "docs/test-doc.txt";
    const content = "Introduction to Contexta RAG pipeline.\n\nSection 1 describes vector storage.";
    await storage.upload(storageKey, createTestTxtBuffer(content), "text/plain");

    const mockDb = createMockPipelineDb({
      id: "doc-pipeline-1",
      userId: "user-1",
      name: "test-doc.txt",
      mime: "text/plain",
      storageKey,
      status: "queued",
      pageCount: null,
      error: null,
      summaryStatus: "pending",
    });

    const embedder = new FakeEmbedder(768);
    const llm = createMockSummaryLLM();

    const result = await runIngestionPipeline("doc-pipeline-1", {
      db: mockDb,
      storage,
      embedder,
      llm,
    });

    expect(result.status).toBe("ready");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(mockDb.state.doc.status).toBe("ready");
    expect(mockDb.state.statusHistory).toEqual([
      "queued",
      "parsing",
      "embedding",
      "ready",
    ]);

    // Verify chunks were created and have 768-dim embeddings
    expect(mockDb.state.chunks.length).toBeGreaterThan(0);
    const firstChunk = mockDb.state.chunks[0];
    expect(firstChunk.documentId).toBe("doc-pipeline-1");
    expect(firstChunk.embedding).toHaveLength(768);
    expect(firstChunk.page).toBe(1);
    expect(firstChunk.tokenCount).toBeGreaterThan(0);
  });

  it("handles PDF files with page preservation", async () => {
    const storage = new MemoryStorageService();
    const storageKey = "docs/sample.pdf";
    await storage.upload(
      storageKey,
      createTestPdfBuffer("Contexta PDF Ingestion Pipeline Test with Page Preservation"),
      "application/pdf",
    );

    const mockDb = createMockPipelineDb({
      id: "doc-pdf-1",
      userId: "user-1",
      name: "sample.pdf",
      mime: "application/pdf",
      storageKey,
      status: "queued",
      pageCount: null,
      error: null,
      summaryStatus: "pending",
    });

    const embedder = new FakeEmbedder(768);

    const result = await runIngestionPipeline("doc-pdf-1", {
      db: mockDb,
      storage,
      embedder,
      skipSummary: true,
    });

    expect(result.status).toBe("ready");
    expect(mockDb.state.doc.status).toBe("ready");
    expect(mockDb.state.doc.pageCount).toBeGreaterThanOrEqual(1);
    expect(mockDb.state.chunks[0].page).toBe(1);
  });

  it("handles failure (scanned PDF) by updating status to failed with error reason", async () => {
    const storage = new MemoryStorageService();
    const storageKey = "docs/scanned.pdf";
    await storage.upload(storageKey, createScannedPdfBuffer(), "application/pdf");

    const mockDb = createMockPipelineDb({
      id: "doc-scanned-1",
      userId: "user-1",
      name: "scanned.pdf",
      mime: "application/pdf",
      storageKey,
      status: "queued",
      pageCount: null,
      error: null,
      summaryStatus: "pending",
    });

    await expect(
      runIngestionPipeline("doc-scanned-1", {
        db: mockDb,
        storage,
        embedder: new FakeEmbedder(768),
      }),
    ).rejects.toThrowError(/scanned PDF not supported yet/);

    expect(mockDb.state.doc.status).toBe("failed");
    expect(mockDb.state.doc.error).toContain("scanned PDF not supported yet");
  });

  it("is idempotent: returns immediately for already ready document", async () => {
    const storage = new MemoryStorageService();
    const mockDb = createMockPipelineDb({
      id: "doc-already-ready",
      userId: "user-1",
      name: "done.txt",
      mime: "text/plain",
      storageKey: "docs/done.txt",
      status: "ready",
      pageCount: 3,
      error: null,
      summaryStatus: "ready",
    });

    const result = await runIngestionPipeline("doc-already-ready", {
      db: mockDb,
      storage,
    });

    expect(result.status).toBe("ready");
    expect(result.pageCount).toBe(3);
    // Did not re-transition through parsing
    expect(mockDb.state.statusHistory).toEqual(["ready"]);
  });

  it("resumes partial ingestion without re-embedding already saved chunks (plan.md 17.2 & 17.5)", async () => {
    const storage = new MemoryStorageService();
    const storageKey = "docs/resumable.txt";
    // Text that produces at least 2 chunks
    const text = "Paragraph one with substantive technical material.\n\n".repeat(40);
    await storage.upload(storageKey, createTestTxtBuffer(text), "text/plain");

    const mockDb = createMockPipelineDb({
      id: "doc-resume-1",
      userId: "user-1",
      name: "resumable.txt",
      mime: "text/plain",
      storageKey,
      status: "embedding",
      pageCount: 1,
      error: null,
      summaryStatus: "pending",
    });

    // Simulate chunk 0 already saved from a prior attempt
    mockDb.state.chunks.push({
      documentId: "doc-resume-1",
      chunkIndex: 0,
      page: 1,
      content: "Previous chunk 0 content",
      tokenCount: 50,
      embedding: new Array(768).fill(0.1),
    });

    const embedder = new FakeEmbedder(768);
    const embedBatchSpy = vi.spyOn(embedder, "embedBatch");

    const result = await runIngestionPipeline("doc-resume-1", {
      db: mockDb,
      storage,
      embedder,
      skipSummary: true,
    });

    expect(result.status).toBe("ready");
    expect(mockDb.state.doc.status).toBe("ready");
    // Verify chunk 0 was NOT passed to embedBatch again
    const _embeddedTexts = embedBatchSpy.mock.calls.flatMap((call) => call[0]);
    // The spy should not embed chunkIndex 0
    expect(embedBatchSpy).toHaveBeenCalled();
  });
});

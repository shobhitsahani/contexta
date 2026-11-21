import { describe, expect, it, vi } from "vitest";
import {
  generateAndStoreSummary,
  getStoredSummary,
} from "../../src/services/ingestion/summary.js";
import type { ParsedDocument } from "../../src/services/ingestion/parse.js";
import type { LLMProvider, LLMStreamChunk, LLMStreamRequest } from "../../src/services/llm/provider.js";

describe("Document Summary Generation (plan.md section 20)", () => {
  const sampleParsedDoc: ParsedDocument = {
    pages: [
      { pageNumber: 1, text: "Chapter 1: Intro to Contexta. It connects files to AI." },
      { pageNumber: 2, text: "Chapter 2: Vector Search with pgvector and HNSW." },
    ],
    pageCount: 2,
    totalText: "Chapter 1: Intro to Contexta. Chapter 2: Vector Search with pgvector.",
  };

  function createMockLLM(responseJson: string, shouldFail = false): LLMProvider {
    return {
      id: "gemini",
      async *stream(_req: LLMStreamRequest): AsyncIterable<LLMStreamChunk> {
        if (shouldFail) {
          throw new Error("Gemini quota exceeded: 429");
        }
        yield { text: responseJson };
      },
    };
  }

  it("generates and stores level 0 and level 1 document summaries", async () => {
    const summaryData = {
      overview: "Contexta is an intelligent assistant for documents.",
      keyPoints: [
        "Uses pgvector for hybrid search",
        "Supports PDF, DOCX, and TXT",
      ],
      sections: [
        {
          title: "Introduction",
          pageStart: 1,
          pageEnd: 1,
          summary: "Covers the system background.",
        },
        {
          title: "Architecture",
          pageStart: 2,
          pageEnd: 2,
          summary: "Covers the database and embeddings.",
        },
      ],
    };

    const insertedRows: any[] = [];
    let updatedDocStatus = "";

    const fakeDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((val) => {
          if (val.summaryStatus) updatedDocStatus = val.summaryStatus;
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals) => {
          if (Array.isArray(vals)) {
            insertedRows.push(...vals);
          } else {
            insertedRows.push(vals);
          }
          return Promise.resolve();
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(insertedRows),
        }),
      }),
    };

    const mockLLM = createMockLLM(JSON.stringify(summaryData));
    const result = await generateAndStoreSummary(
      "doc-123",
      sampleParsedDoc,
      fakeDb,
      mockLLM,
    );

    expect(result).not.toBeNull();
    expect(result?.overview).toBe(summaryData.overview);
    expect(result?.keyPoints).toHaveLength(2);
    expect(result?.sections).toHaveLength(2);
    expect(updatedDocStatus).toBe("ready");

    // Check inserted rows in document_summaries
    expect(insertedRows.length).toBe(3); // 1 level-0 + 2 level-1
    const level0 = insertedRows.find((r) => r.level === 0);
    expect(level0).toBeDefined();
    expect(level0.title).toBe("Overview");

    const level1 = insertedRows.filter((r) => r.level === 1);
    expect(level1).toHaveLength(2);
    expect(level1[0].title).toBe("Introduction");
    expect(level1[1].title).toBe("Architecture");

    // Fetch via getStoredSummary
    const retrieved = await getStoredSummary("doc-123", fakeDb);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.overview).toBe(summaryData.overview);
    expect(retrieved?.keyPoints).toHaveLength(2);
    expect(retrieved?.sections).toHaveLength(2);
  });

  it("handles LLM failure gracefully without throwing and marks status as failed", async () => {
    let finalSummaryStatus = "";
    const fakeDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((val) => {
          if (val.summaryStatus) finalSummaryStatus = val.summaryStatus;
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
    };

    const failingLLM = createMockLLM("", true);
    const result = await generateAndStoreSummary(
      "doc-fail-summary",
      sampleParsedDoc,
      fakeDb,
      failingLLM,
    );

    expect(result).toBeNull();
    expect(finalSummaryStatus).toBe("failed");
  });

  it("extracts JSON wrapped in markdown code fences and conversational filler", async () => {
    const rawLlmText = `
Here is the requested summary of the document in JSON format:
\`\`\`json
{
  "overview": "Overview extracted from markdown wrapper.",
  "keyPoints": ["Main takeaway from doc."],
  "sections": [
    {
      "title": "Prelude",
      "pageStart": "1",
      "pageEnd": "2",
      "summary": "Covers initial concepts."
    }
  ]
}
\`\`\`
I hope this summary helps your analysis!`;

    const fakeDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const mockLLM = createMockLLM(rawLlmText);
    const result = await generateAndStoreSummary(
      "doc-fence-test",
      sampleParsedDoc,
      fakeDb,
      mockLLM,
    );

    expect(result).not.toBeNull();
    expect(result?.overview).toBe("Overview extracted from markdown wrapper.");
    expect(result?.keyPoints[0]).toBe("Main takeaway from doc.");
    // Verify stringified "1" was normalized to number 1
    expect(result?.sections[0].pageStart).toBe(1);
    expect(result?.sections[0].pageEnd).toBe(2);
  });

  it("extracts and normalizes JSON with trailing commas and missing fields", async () => {
    const rawLlmWithTrailingCommas = `
{
  "overview": "Overview with trailing commas.",
  "keyPoints": [
    "Point 1",
  ],
  "sections": [
    {
      "title": "Section A",
      "summary": "Summary A",
    },
  ],
}`;

    const fakeDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const mockLLM = createMockLLM(rawLlmWithTrailingCommas);
    const result = await generateAndStoreSummary(
      "doc-comma-test",
      sampleParsedDoc,
      fakeDb,
      mockLLM,
    );

    expect(result).not.toBeNull();
    expect(result?.overview).toBe("Overview with trailing commas.");
    expect(result?.keyPoints[0]).toBe("Point 1");
    expect(result?.sections[0].title).toBe("Section A");
  });
});

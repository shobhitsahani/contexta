import { describe, expect, it } from "vitest";
import {
  chunkDocument,
  estimateTokens,
  OVERLAP_TOKENS,
  TARGET_CHUNK_TOKENS,
} from "../../src/services/ingestion/chunk.js";
import type { ParsedPage } from "../../src/services/ingestion/parse.js";

describe("Document Chunking", () => {
  it("estimates token counts as chars / 4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("Hello World")).toBe(3); // 11 chars -> ceil(11/4) = 3
  });

  it("creates a single chunk for short content without overlap", () => {
    const pages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: "This is a short single-page document for Contexta testing.",
      },
    ];

    const chunks = chunkDocument(pages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].page).toBe(1);
    expect(chunks[0].content).toBe(
      "This is a short single-page document for Contexta testing.",
    );
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("splits text into chunks of approximately 600 tokens with 80 token overlap", () => {
    // Generate text of ~1800 tokens (~7200 characters) across paragraphs
    const paragraph =
      "Contexta is an AI-powered conversational assistant designed for retrieval augmented generation over technical documents and internal documentation repositories. ".repeat(
        6,
      ); // ~950 chars each

    const pages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: [paragraph, paragraph, paragraph, paragraph, paragraph, paragraph, paragraph, paragraph].join(
          "\n\n",
        ),
      },
    ];

    const chunks = chunkDocument(pages, {
      targetTokens: TARGET_CHUNK_TOKENS,
      overlapTokens: OVERLAP_TOKENS,
    });

    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
      expect(chunks[i].page).toBe(1);
      // Chunks should be within reasonable bounds of targetTokens (~600)
      expect(chunks[i].tokenCount).toBeLessThanOrEqual(TARGET_CHUNK_TOKENS * 1.5);
    }

    // Verify overlap: end of chunk 0 appears in the beginning of chunk 1
    const chunk0 = chunks[0].content;
    const chunk1 = chunks[1].content;
    const chunk0Ending = chunk0.slice(-80);
    // Find some words from the end of chunk 0 in chunk 1
    const sampleWords = chunk0Ending.split(/\s+/).filter((w) => w.length > 5);
    const hasOverlap = sampleWords.some((w) => chunk1.includes(w));
    expect(hasOverlap).toBe(true);
  });

  it("preserves page numbers across multiple pages", () => {
    const pages: ParsedPage[] = [
      { pageNumber: 1, text: "Page 1 Content: Introduction to System Design and Concepts." },
      { pageNumber: 2, text: "Page 2 Content: Detailed Architecture and Database Schema." },
      { pageNumber: 3, text: "Page 3 Content: Evaluation Metrics and Benchmark Results." },
    ];

    const chunks = chunkDocument(pages, { targetTokens: 15 }); // force chunks per page

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const page1Chunk = chunks.find((c) => c.content.includes("Page 1"));
    const page2Chunk = chunks.find((c) => c.content.includes("Page 2"));
    const page3Chunk = chunks.find((c) => c.content.includes("Page 3"));

    expect(page1Chunk?.page).toBe(1);
    expect(page2Chunk?.page).toBe(2);
    expect(page3Chunk?.page).toBe(3);
  });

  it("respects markdown headings and flushes chunks on major section breaks", () => {
    const pages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: `# Introduction
Here is the first paragraph describing the background of Contexta.
It contains some useful foundational information for the readers.

# Architecture Overview
Here is the second major section describing the API layer, database, and vector storage.
The system is built as a modular monorepo.`,
      },
    ];

    const chunks = chunkDocument(pages, { targetTokens: 30 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const hasIntro = chunks.some((c) => c.content.includes("Introduction"));
    const hasArch = chunks.some((c) => c.content.includes("Architecture Overview"));
    expect(hasIntro).toBe(true);
    expect(hasArch).toBe(true);
  });

  it("recognizes setext underlined headings (=== and ---)", () => {
    const pages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: `Overview Section
================
This paragraph describes the overview in detail.

Deep Dive Analysis
------------------
This paragraph goes into deep technical evaluation.`,
      },
    ];

    const chunks = chunkDocument(pages, { targetTokens: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.content.includes("Overview Section"))).toBe(true);
    expect(chunks.some((c) => c.content.includes("Deep Dive Analysis"))).toBe(true);
  });

  it("splits oversized blocks along sentence boundaries", () => {
    // Single massive block without paragraph breaks
    const longSentence = "This is a detailed sentence describing an architectural component. ";
    const massiveText = longSentence.repeat(80); // ~5300 chars, ~1300 tokens

    const pages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: massiveText,
      },
    ];

    const chunks = chunkDocument(pages, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(300);
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("handles continuous unspaced sequences without breaching token cap", () => {
    // 4000 continuous characters without spaces or sentence punctuation
    const unspacedString = "A".repeat(4000);
    const pages: ParsedPage[] = [
      {
        pageNumber: 1,
        text: unspacedString,
      },
    ];

    const chunks = chunkDocument(pages, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(250);
    }
  });
});

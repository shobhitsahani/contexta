import { describe, expect, it } from "vitest";
import {
  chunkDocument,
  estimateTokens,
  OVERLAP_TOKENS,
  TARGET_CHUNK_TOKENS,
} from "../../src/services/ingestion/chunk.js";
import type { ParsedPage } from "../../src/services/ingestion/parse.js";

describe("QA: Document Chunking, Overlap, and Page Mapping (Plan 14.4 & 14.10)", () => {
  describe("estimateTokens", () => {
    it("returns 0 for empty or null-ish strings", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens(undefined as any)).toBe(0);
      expect(estimateTokens(null as any)).toBe(0);
    });

    it("approximates tokens as Math.ceil(chars / 4)", () => {
      expect(estimateTokens("a")).toBe(1);
      expect(estimateTokens("abcd")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
      expect(estimateTokens("Contexta RAG")).toBe(3); // 12 chars -> 3 tokens
      expect(estimateTokens("x".repeat(100))).toBe(25);
    });
  });

  describe("chunkDocument heading and paragraph awareness", () => {
    it("handles empty pages array without throwing", () => {
      expect(chunkDocument([])).toEqual([]);
    });

    it("handles pages with only whitespace or empty text", () => {
      const pages: ParsedPage[] = [
        { pageNumber: 1, text: "   \n\n\t  " },
        { pageNumber: 2, text: "" },
      ];
      expect(chunkDocument(pages)).toEqual([]);
    });

    it("creates a single chunk for a short document without synthetic overlap", () => {
      const pages: ParsedPage[] = [
        { pageNumber: 1, text: "Contexta is an AI-powered conversational assistant." },
      ];
      const chunks = chunkDocument(pages);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].page).toBe(1);
      expect(chunks[0].content).toBe("Contexta is an AI-powered conversational assistant.");
      expect(chunks[0].tokenCount).toBe(estimateTokens(chunks[0].content));
    });

    it("recognizes markdown headings (#, ##, ###) and flushes chunks on section boundaries", () => {
      // Create substantive text before the heading to trigger the heading flush threshold
      const body = "This is a detailed paragraph explaining architectural primitives in depth. ".repeat(15);
      const pages: ParsedPage[] = [
        {
          pageNumber: 1,
          text: `# Section 1: Overview\n\n${body}\n\n## Section 2: Implementation Details\n\n${body}`,
        },
      ];

      const chunks = chunkDocument(pages, { targetTokens: 150 });
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].content).toContain("# Section 1: Overview");
      // Later chunk starts with or contains Section 2 heading
      const section2Chunk = chunks.find((c) => c.content.includes("## Section 2: Implementation Details"));
      expect(section2Chunk).toBeDefined();
    });

    it("recognizes setext underlines (=== and ---) as headings", () => {
      const text = `Document Title\n===============\n\nIntroductory text here.\n\nSub Header\n----------\n\nDetails here.`;
      const pages: ParsedPage[] = [{ pageNumber: 1, text }];
      const chunks = chunkDocument(pages);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].content).toContain("Document Title");
      expect(chunks[0].content).toContain("Sub Header");
    });

    it("recognizes formal chapter and section headings", () => {
      const text = `Chapter 1: The Beginning\n\nLong narrative here.\n\nSection 2.1: Formal Protocols\n\nMore details.`;
      const pages: ParsedPage[] = [{ pageNumber: 1, text }];
      const chunks = chunkDocument(pages);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].content).toContain("Chapter 1");
    });
  });

  describe("chunk overlap mechanics", () => {
    it("ensures subsequent chunks carry overlap from preceding chunks", () => {
      const paragraph =
        "The quick brown fox jumps over the lazy dog repeatedly until the token threshold is exceeded. " +
        "Machine learning models generalize patterns across diverse training datasets. ";
      const text = paragraph.repeat(25); // ~3700 chars -> forces multi-chunk
      const pages: ParsedPage[] = [{ pageNumber: 1, text }];

      const chunks = chunkDocument(pages, { targetTokens: 200, overlapTokens: 40 });
      expect(chunks.length).toBeGreaterThan(1);

      // Verify each consecutive pair shares overlapping text
      for (let i = 1; i < chunks.length; i++) {
        const prevContent = chunks[i - 1].content;
        const currentContent = chunks[i].content;

        // Take last 40 chars of previous chunk (minus trailing whitespace)
        const prevEndSample = prevContent.trim().slice(-40);
        const sampleWords = prevEndSample.split(/\s+/).filter((w) => w.length > 4);

        // At least one substantial word from the end of prev must appear in current
        const overlapFound = sampleWords.some((w) => currentContent.includes(w));
        expect(overlapFound).toBe(true);
      }
    });

    it("strictly bounds chunk size within target token limits", () => {
      const text = "Contexta indexes unstructured enterprise documents with dense embeddings. ".repeat(60);
      const targetTokens = 300;
      const chunks = chunkDocument([{ pageNumber: 1, text }], {
        targetTokens,
        overlapTokens: 50,
      });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Target is 300 tokens; allowing a safety factor of 1.5x for sentence boundary extension
        expect(chunk.tokenCount).toBeLessThanOrEqual(targetTokens * 1.5);
      }
    });
  });

  describe("multi-page page mapping", () => {
    it("preserves exact page numbers across distinct document pages", () => {
      const pages: ParsedPage[] = [
        { pageNumber: 1, text: "Page 1 Content: Introduction and Executive Summary.\n\n" + "Details. ".repeat(40) },
        { pageNumber: 2, text: "Page 2 Content: Architectural Schemas and Data Models.\n\n" + "Details. ".repeat(40) },
        { pageNumber: 3, text: "Page 3 Content: Evaluation Benchmarks and Conclusions.\n\n" + "Details. ".repeat(40) },
      ];

      // Using targetTokens small enough that each page produces at least one distinct chunk
      const chunks = chunkDocument(pages, { targetTokens: 50, overlapTokens: 10 });
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const pagesPresent = new Set(chunks.map((c) => c.page));
      expect(pagesPresent.has(1)).toBe(true);
      expect(pagesPresent.has(2)).toBe(true);
      expect(pagesPresent.has(3)).toBe(true);

      const chunkPage1 = chunks.find((c) => c.content.includes("Executive Summary"));
      const chunkPage2 = chunks.find((c) => c.content.includes("Architectural Schemas"));
      const chunkPage3 = chunks.find((c) => c.content.includes("Evaluation Benchmarks"));

      expect(chunkPage1?.page).toBe(1);
      expect(chunkPage2?.page).toBe(2);
      expect(chunkPage3?.page).toBe(3);
    });

    it("assigns sequential chunkIndex values starting from 0 without gaps", () => {
      const pages: ParsedPage[] = [
        { pageNumber: 1, text: "A paragraph for testing index ordering. ".repeat(30) },
        { pageNumber: 2, text: "Another paragraph across the second page. ".repeat(30) },
      ];

      const chunks = chunkDocument(pages, { targetTokens: 100, overlapTokens: 20 });
      expect(chunks.length).toBeGreaterThan(2);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i);
      }
    });
  });

  describe("extreme edge cases", () => {
    it("handles huge unbroken string without spaces by slicing into maxChars windows", () => {
      const giantWord = "A".repeat(8000);
      const pages: ParsedPage[] = [{ pageNumber: 1, text: giantWord }];

      // targetTokens: 200 -> maxChars: 800 -> 8000 / 800 = 10 chunks
      const chunks = chunkDocument(pages, { targetTokens: 200, overlapTokens: 20 });
      expect(chunks.length).toBe(10);
      for (const chunk of chunks) {
        // Body (800) + overlap prefix (20 * 4 = 80) + separator
        expect(chunk.content.length).toBeLessThanOrEqual(900);
      }
    });

    it("handles unicode, emojis, and multi-byte characters", () => {
      const unicodeText = "Contexta supports multilingual embeddings: 日本語, Español, Deutsch, 🚀, 🤖, 🧠.\n\n" +
        "Testing character length calculations accurately.";
      const pages: ParsedPage[] = [{ pageNumber: 1, text: unicodeText }];

      const chunks = chunkDocument(pages);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain("日本語");
      expect(chunks[0].content).toContain("🚀");
      expect(chunks[0].tokenCount).toBeGreaterThan(0);
    });

    it("verifies default constants match architecture specification (600 target, 80 overlap)", () => {
      expect(TARGET_CHUNK_TOKENS).toBe(600);
      expect(OVERLAP_TOKENS).toBe(80);
    });
  });
});

import { describe, expect, it } from "vitest";
import { DocumentSummarySchema, type DocumentSummary } from "@contexta/shared";
import { extractJsonFromLlmOutput } from "../../src/services/ingestion/summary.js";
import { detectSummaryIntent } from "../../src/services/retrieval/prompt.js";

describe("QA: Document Summary Quality and Schema Validation (Plan 20)", () => {
  describe("DocumentSummarySchema Validation", () => {
    it("validates a compliant, comprehensive document summary", () => {
      const validSummary: DocumentSummary = {
        overview:
          "Contexta is an intelligent context-aware knowledge assistant that transforms user files into conversational answers.",
        keyPoints: [
          "Users receive a 50,000 free token allowance.",
          "Original documents are stored in Cloudflare R2 / Supabase Storage.",
          "Provider API keys are encrypted at rest with AES-256-GCM.",
          "Hybrid search fuses vector and keyword rankings using Reciprocal Rank Fusion.",
          "Background ingestion operates through a PostgreSQL jobs table with SKIP LOCKED.",
        ],
        sections: [
          {
            title: "Product Overview",
            pageStart: 1,
            pageEnd: 1,
            summary: "Introduces product positioning and free tier budgets.",
          },
          {
            title: "Security and Privacy",
            pageStart: 2,
            pageEnd: 3,
            summary: "Details data retention, key encryption, and consent requirements.",
          },
        ],
      };

      const parsed = DocumentSummarySchema.safeParse(validSummary);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.keyPoints).toHaveLength(5);
        expect(parsed.data.sections).toHaveLength(2);
      }
    });

    it("rejects summaries with empty overview or invalid section schemas", () => {
      const invalidOverview = {
        overview: "",
        keyPoints: ["Point 1"],
        sections: [],
      };
      expect(DocumentSummarySchema.safeParse(invalidOverview).success).toBe(false);

      const invalidSection = {
        overview: "Valid overview",
        keyPoints: ["Point 1"],
        sections: [
          {
            title: "", // Empty title forbidden
            pageStart: 1,
            pageEnd: 1,
            summary: "summary",
          },
        ],
      };
      expect(DocumentSummarySchema.safeParse(invalidSection).success).toBe(false);
    });
  });

  describe("JSON Extraction from LLM Output", () => {
    it("parses raw JSON output", () => {
      const raw = JSON.stringify({ overview: "test", keyPoints: ["p1"], sections: [] });
      const extracted = extractJsonFromLlmOutput(raw);
      expect(extracted.overview).toBe("test");
    });

    it("extracts JSON embedded inside markdown code blocks", () => {
      const markdown = "Here is the summary you requested:\n```json\n{\n  \"overview\": \"extracted\",\n  \"keyPoints\": [\"k1\"],\n  \"sections\": []\n}\n```\nHope this helps!";
      const extracted = extractJsonFromLlmOutput(markdown);
      expect(extracted.overview).toBe("extracted");
    });

    it("cleans trailing commas before parsing", () => {
      const trailingCommaJson = '{"overview": "cleaned", "keyPoints": ["k1",], "sections": [],}';
      const extracted = extractJsonFromLlmOutput(trailingCommaJson);
      expect(extracted.overview).toBe("cleaned");
      expect(extracted.keyPoints).toEqual(["k1"]);
    });
  });

  describe("Summary Intent Detection (Router)", () => {
    it("accurately detects whole-document summary queries", () => {
      const queries = [
        "summarize this document",
        "Give me a summary of the whole file",
        "what is this about?",
        "overview of the report",
        "tl;dr of this paper",
        "what are the main points?",
        "key takeaways from this text",
      ];

      for (const q of queries) {
        const intent = detectSummaryIntent(q);
        expect(intent.isSummary).toBe(true);
        expect(intent.type).toBe("whole");
      }
    });

    it("accurately detects section-targeted summary queries", () => {
      const sectionQueries = [
        { query: "summarize chapter 3", expected: "3" },
        { query: "summary of section 2.1", expected: "2.1" },
        { query: "what's in pages 10-15?", expected: "10-15" },
      ];

      for (const { query, expected } of sectionQueries) {
        const intent = detectSummaryIntent(query);
        expect(intent.isSummary).toBe(true);
        expect(intent.type).toBe("section");
        expect(intent.sectionHint).toBe(expected);
      }
    });

    it("does not misclassify standard question queries as summaries", () => {
      const normalQueries = [
        "What is the maximum file size for PDF uploads?",
        "How are provider keys encrypted at rest?",
        "Why is supervised learning using labeled data?",
        "Explain backpropagation gradient updates.",
      ];

      for (const q of normalQueries) {
        const intent = detectSummaryIntent(q);
        expect(intent.isSummary).toBe(false);
        expect(intent.type).toBe("none");
      }
    });
  });

  describe("Fact Coverage and Hallucination Scoring (Plan 20.5 Checklist)", () => {
    it("computes coverage score against required facts checklist", () => {
      const requiredFacts = [
        "50,000 free tokens",
        "AES-256-GCM encryption",
        "pgvector HNSW index",
        "10 MB file size limit",
      ];

      const sampleSummary = {
        overview: "Contexta offers 50,000 free tokens and enforces AES-256-GCM encryption for stored keys.",
        keyPoints: [
          "Embeddings are stored in pgvector HNSW index at 768 dimensions.",
          "Uploads are capped at a 10 MB file size limit.",
        ],
      };

      const serialized = JSON.stringify(sampleSummary).toLowerCase();
      let covered = 0;
      for (const fact of requiredFacts) {
        if (serialized.includes(fact.toLowerCase())) {
          covered++;
        }
      }

      const coverageRate = covered / requiredFacts.length;
      expect(coverageRate).toBe(1.0); // 100% coverage
    });

    it("detects forbidden hallucinations when present", () => {
      const forbiddenFacts = [
        "Quantum entanglement computer",
        "Sells data to advertising brokers",
      ];

      const cleanSummary = "Contexta is an AI assistant using classical cloud servers.";
      const hallucinatedSummary = "Contexta operates a Quantum entanglement computer and sells data to advertising brokers.";

      // Clean summary has 0 hallucinations
      const cleanHallucinations = forbiddenFacts.filter((f) =>
        cleanSummary.toLowerCase().includes(f.toLowerCase()),
      );
      expect(cleanHallucinations).toHaveLength(0);

      // Hallucinated summary catches both
      const detected = forbiddenFacts.filter((f) =>
        hallucinatedSummary.toLowerCase().includes(f.toLowerCase()),
      );
      expect(detected).toHaveLength(2);
    });
  });
});

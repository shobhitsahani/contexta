import { describe, it, expect } from "vitest";
import {
  buildMessages,
  buildSourcesBlock,
  buildRetrievalQuery,
  detectSummaryIntent,
  buildSummaryContext,
} from "../../../src/services/retrieval/prompt.js";
import type { SearchHit } from "../../../src/services/retrieval/search.js";

const hit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  chunkId: "c1",
  documentId: "d1",
  documentName: "manual.pdf",
  page: 3,
  content: "The warranty covers parts for one year.",
  score: 0.9,
  ...overrides,
});

describe("buildSourcesBlock", () => {
  it("numbers sources and includes file, page, content", () => {
    const block = buildSourcesBlock([hit(), hit({ documentName: "other.txt", page: 1 })]);
    expect(block).toContain("[1] (manual.pdf, p.3)");
    expect(block).toContain("[2] (other.txt, p.1)");
    expect(block).toContain("warranty covers parts");
  });

  it("reports no sources when empty", () => {
    expect(buildSourcesBlock([])).toContain("No relevant sources were found");
  });
});

describe("buildMessages", () => {
  const history = [
    { role: "user" as const, content: "What does it say?" },
    { role: "assistant" as const, content: "It says X." },
  ];

  it("builds system prompt with sources block and appends question", () => {
    const { system, messages } = buildMessages([hit()], history, "current question?");
    expect(system).toContain("Cite every claim using [n]");
    expect(system).toContain("manual.pdf");
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "current question?",
    });
  });

  it("limits history to last 6 messages", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
    }));
    const { messages } = buildMessages([], many, "q");
    expect(messages.length).toBe(7); // 6 history + current question
  });

  it("uses summary prompt when summaryContext provided", () => {
    const { system } = buildMessages([], [], "summarize", "SUMMARY DATA");
    expect(system).toContain("SUMMARY DATA");
    expect(system).not.toContain("SOURCES");
  });
});

describe("buildRetrievalQuery (v1: last user message + current question)", () => {
  it("concatenates last user message with current question", () => {
    const q = buildRetrievalQuery("current", [
      { role: "user", content: "previous" },
      { role: "assistant", content: "ack" },
    ]);
    expect(q).toBe("previous current");
  });

  it("falls back to current question when no user history", () => {
    expect(buildRetrievalQuery("current", [])).toBe("current");
    expect(buildRetrievalQuery("current", [{ role: "assistant", content: "x" }])).toBe("current");
  });
});

describe("detectSummaryIntent", () => {
  it("detects whole-document summary requests", () => {
    expect(detectSummaryIntent("summarize this document").isSummary).toBe(true);
    expect(detectSummaryIntent("tl;dr").isSummary).toBe(true);
    expect(detectSummaryIntent("what is this about").isSummary).toBe(true);
    expect(detectSummaryIntent("key takeaways").isSummary).toBe(true);
  });

  it("detects section summary requests with hint", () => {
    const r = detectSummaryIntent("summarize chapter 3");
    expect(r.isSummary).toBe(true);
    expect(r.type).toBe("section");
    expect(r.sectionHint).toBeDefined();
  });

  it("returns none for regular questions", () => {
    expect(detectSummaryIntent("who wrote the warranty?").isSummary).toBe(false);
    expect(detectSummaryIntent("what pages cover pricing?").isSummary).toBe(false);
  });
});

describe("buildSummaryContext", () => {
  it("renders overview, key points, and sections with page ranges", () => {
    const ctx = buildSummaryContext({
      overview: "This is a policy doc.",
      keyPoints: ["Point one", "Point two"],
      sections: [
        { title: "Intro", pageStart: 1, pageEnd: 2, summary: "Intro summary" },
        { title: "Terms", pageStart: 3, pageEnd: 3, summary: "Terms summary" },
      ],
    });
    expect(ctx).toContain("This is a policy doc.");
    expect(ctx).toContain("1. Point one");
    expect(ctx).toContain("Intro (pages 1-2)");
    expect(ctx).toContain("Terms (pages 3-3)");
  });
});

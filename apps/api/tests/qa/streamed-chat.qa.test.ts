import { describe, expect, it } from "vitest";
import { FakeLLMProvider } from "../../src/services/llm/fake.js";
import {
  StreamEventDeltaSchema,
  StreamEventSourcesSchema,
  StreamEventUsageSchema,
  StreamEventDoneSchema,
  StreamEventErrorSchema,
  StreamEventSchema,
} from "@contexta/shared";

describe("QA: Mocked LLM Provider and Streamed Chat Protocols (Plan 13.3 & 14.5)", () => {
  describe("FakeLLMProvider Streaming Execution", () => {
    it("yields tokens word by word with proper spacing", async () => {
      const canned = "Contexta answers questions with verifiable citations.";
      const provider = new FakeLLMProvider("fake-provider", [canned]);

      const stream = provider.stream({
        model: "gemini-flash",
        system: "System prompt instructions",
        messages: [{ role: "user", content: "What does Contexta do?" }],
        apiKey: "test-api-key",
      });

      const words: string[] = [];
      let reportedUsage: { in: number; out: number } | undefined;

      for await (const chunk of stream) {
        if (chunk.text !== undefined) {
          words.push(chunk.text);
        }
        if (chunk.usage) {
          reportedUsage = chunk.usage;
        }
      }

      // Reconstructed text matches original sentence
      expect(words.join("")).toBe(canned);
      expect(words.length).toBe(canned.split(" ").length);

      // Final chunk reported usage
      expect(reportedUsage).toBeDefined();
      expect(reportedUsage?.in).toBeGreaterThan(0);
      expect(reportedUsage?.out).toBeGreaterThan(0);

      // Verifies provider stored request metadata accurately
      expect(provider.lastRequest).toBeDefined();
      expect(provider.lastRequest?.model).toBe("gemini-flash");
      expect(provider.lastRequest?.apiKey).toBe("test-api-key");
    });

    it("terminates stream promptly and throws error when AbortSignal triggers", async () => {
      const provider = new FakeLLMProvider("fake-provider", ["word1 word2 word3 word4 word5 word6 word7"]);
      const controller = new AbortController();

      const stream = provider.stream({
        model: "gemini-flash",
        system: "System",
        messages: [{ role: "user", content: "test" }],
        apiKey: "test-key",
        signal: controller.signal,
      });

      const received: string[] = [];
      await expect(async () => {
        for await (const chunk of stream) {
          if (chunk.text) {
            received.push(chunk.text);
            // Abort after receiving first word
            controller.abort();
          }
        }
      }).rejects.toThrow(/Aborted/i);

      expect(received.length).toBe(1);
    });

    it("cycles through multiple configured canned responses across calls", async () => {
      const responses = ["First response [1].", "Second response [2].", "Third response [3]."];
      const provider = new FakeLLMProvider("fake-provider", responses);

      async function collectText() {
        const stream = provider.stream({
          model: "gemini-flash",
          system: "sys",
          messages: [{ role: "user", content: "q" }],
          apiKey: "k",
        });
        const words: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) words.push(chunk.text);
        }
        return words.join("");
      }

      expect(await collectText()).toBe("First response [1].");
      expect(await collectText()).toBe("Second response [2].");
      expect(await collectText()).toBe("Third response [3].");
      // Cycles back to beginning
      expect(await collectText()).toBe("First response [1].");
      expect(provider.getCallCount()).toBe(4);
    });
  });

  describe("Server-Sent Events (SSE) Event Schema Conformance", () => {
    it("validates standard SSE stream events against shared Zod schemas", () => {
      // 1. Delta event
      const deltaEvent = { type: "delta" as const, delta: "According to the manual" };
      expect(StreamEventDeltaSchema.safeParse(deltaEvent).success).toBe(true);
      expect(StreamEventSchema.safeParse(deltaEvent).success).toBe(true);

      // 2. Sources event
      const sourcesEvent = {
        type: "sources" as const,
        sources: [
          {
            n: 1,
            documentId: "12345678-1234-4234-8234-123456789abc",
            fileName: "manual.pdf",
            page: 2,
            snippet: "Config guidelines",
          },
        ],
      };
      expect(StreamEventSourcesSchema.safeParse(sourcesEvent).success).toBe(true);
      expect(StreamEventSchema.safeParse(sourcesEvent).success).toBe(true);

      // 3. Usage event
      const usageEvent = {
        type: "usage" as const,
        tokensIn: 1540,
        tokensOut: 220,
      };
      expect(StreamEventUsageSchema.safeParse(usageEvent).success).toBe(true);
      expect(StreamEventSchema.safeParse(usageEvent).success).toBe(true);

      // 4. Done event
      const doneEvent = { type: "done" as const };
      expect(StreamEventDoneSchema.safeParse(doneEvent).success).toBe(true);
      expect(StreamEventSchema.safeParse(doneEvent).success).toBe(true);

      // 5. Error event
      const errorEvent = {
        type: "error" as const,
        code: "KEY_REQUIRED",
        message: "Free allowance exhausted",
      };
      expect(StreamEventErrorSchema.safeParse(errorEvent).success).toBe(true);
      expect(StreamEventSchema.safeParse(errorEvent).success).toBe(true);
    });

    it("rejects malformed stream events", () => {
      // Missing delta string
      expect(StreamEventDeltaSchema.safeParse({ type: "delta" }).success).toBe(false);

      // Negative token count in usage
      expect(
        StreamEventUsageSchema.safeParse({
          type: "usage",
          tokensIn: -10,
          tokensOut: 100,
        }).success,
      ).toBe(false);

      // Unknown event type
      expect(
        StreamEventSchema.safeParse({
          type: "unknown_event_type",
          data: {},
        }).success,
      ).toBe(false);
    });
  });
});

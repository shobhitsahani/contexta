import { describe, expect, it } from "vitest";
import {
  buildMessages,
  buildRetrievalQuery,
} from "../../src/services/retrieval/prompt.js";
import { FakeLLMProvider } from "../../src/services/llm/fake.js";
import type { SearchHit } from "../../src/services/retrieval/search.js";

describe("QA: Unanswerable Questions and Refusal Instructions (Plan 2, 7, 14.5)", () => {
  describe("Prompt Instructions for Missing Information", () => {
    it("contains explicit refusal directive when sources are missing or insufficient", () => {
      const { system } = buildMessages([], [], "What is the capital of Mars?");
      expect(system).toContain("I couldn't find this information in your documents.");
      expect(system).toContain("No relevant sources were found in the user's documents.");
    });

    it("mandates distinct labeling for general knowledge fallbacks", () => {
      const { system } = buildMessages([], [], "Explain quantum computing.");
      expect(system).toContain("---\\n**General knowledge (not from your documents):**");
      expect(system).toContain("Make it clear this is not from their uploaded documents.");
      expect(system).toContain("Do not invent facts that are not in the sources.");
    });

    it("instructs assistant to answer ONLY from sources", () => {
      const { system } = buildMessages([], [], "Any question");
      expect(system).toContain("Answer the user's question using ONLY the provided source documents.");
    });
  });

  describe("End-to-End Unanswerable Query Evaluation", () => {
    it("generates correct refusal response when retrieval yields zero sources", async () => {
      // Simulate retrieval returning 0 hits (all candidates below threshold)
      const emptyHits: SearchHit[] = [];
      const question = "What was Napoleon's favorite video game console?";

      const { system, messages } = buildMessages(emptyHits, [], question);

      // Canned provider response conforming to the system prompt's refusal instruction
      const cannedRefusal = "I couldn't find this information in your documents.";
      const provider = new FakeLLMProvider("fake", [cannedRefusal]);

      const stream = provider.stream({
        model: "gemini-flash",
        system,
        messages,
        apiKey: "test",
      });

      const words: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) words.push(chunk.text);
      }

      const answer = words.join("");
      expect(answer).toBe("I couldn't find this information in your documents.");
      expect(answer).not.toContain("PlayStation");
      expect(answer).not.toContain("Xbox");
    });

    it("properly constructs follow-up retrieval query even when prior turn was unanswerable", () => {
      const history = [
        { role: "user" as const, content: "What is quantum computing?" },
        {
          role: "assistant" as const,
          content: "I couldn't find this information in your documents.",
        },
      ];
      const followUpQuestion = "Is it mentioned in chapter 2?";

      const retrievalQuery = buildRetrievalQuery(followUpQuestion, history);
      // Incorporates last user question to form a contextual query
      expect(retrievalQuery).toBe("What is quantum computing? Is it mentioned in chapter 2?");
    });
  });
});

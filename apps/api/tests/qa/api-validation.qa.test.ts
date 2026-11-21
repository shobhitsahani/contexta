import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import {
  apiErrorSchema,
  createChatSchema,
  updateChatSchema,
  providerKeyBodySchema,
  providerSchema,
  sourceSchema,
  ERROR_CODES,
} from "@contexta/shared";

describe("QA: API Error Handling and Validation (Plan 14.6 & Packages/Shared)", () => {
  describe("AppError Factory and HTTP Status Codes", () => {
    it("maps validation errors to 400 VALIDATION_ERROR", () => {
      const err = AppError.validation("Invalid field format");
      expect(err.status).toBe(400);
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toBe("Invalid field format");
      expect(err.expose).toBe(true);
    });

    it("maps authentication required to 401 UNAUTHORIZED", () => {
      const err = AppError.unauthorized();
      expect(err.status).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.expose).toBe(true);
    });

    it("maps unverified email to 403 EMAIL_NOT_VERIFIED", () => {
      const err = AppError.emailNotVerified();
      expect(err.status).toBe(403);
      expect(err.code).toBe("EMAIL_NOT_VERIFIED");
      expect(err.message).toContain("Verify your email address");
    });

    it("maps exhausted free allowance to 402 KEY_REQUIRED", () => {
      const err = AppError.keyRequired();
      expect(err.status).toBe(402);
      expect(err.code).toBe("KEY_REQUIRED");
      expect(err.message).toContain("Free allowance exhausted");
    });

    it("maps rate limits to 429 RATE_LIMITED", () => {
      const err = AppError.rateLimited();
      expect(err.status).toBe(429);
      expect(err.code).toBe("RATE_LIMITED");
    });

    it("maps not found to 404 NOT_FOUND", () => {
      const err = AppError.notFound("Chat not found.");
      expect(err.status).toBe(404);
      expect(err.code).toBe("NOT_FOUND");
    });

    it("hides internal error messages from client responses (expose = false)", () => {
      const internalCause = new Error("Database connection pool exhausted password=secret");
      const err = AppError.internal(internalCause);
      expect(err.status).toBe(500);
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.message).toBe("Something went wrong.");
      expect(err.expose).toBe(false);
      // Ensure private database credentials are not exposed
      expect(err.message).not.toContain("password=secret");
    });
  });

  describe("API Error Schema Conformance", () => {
    it("validates that all standardized error codes parse against apiErrorSchema", () => {
      for (const code of ERROR_CODES) {
        const payload = {
          error: {
            code,
            message: `Sample error for ${code}`,
            requestId: "req-12345",
          },
        };
        const parsed = apiErrorSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
      }
    });

    it("rejects non-standard error codes", () => {
      const payload = {
        error: {
          code: "NON_EXISTENT_CUSTOM_CODE",
          message: "Something unexpected",
        },
      };
      const parsed = apiErrorSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Zod Request Validation Schemas", () => {
    describe("createChatSchema", () => {
      it("accepts valid empty or documentIds arrays", () => {
        expect(createChatSchema.parse({})).toEqual({ documentIds: [] });
        expect(
          createChatSchema.parse({
            title: "Research Project Chat",
            documentIds: ["11111111-1111-4111-8111-111111111111"],
          }),
        ).toEqual({
          title: "Research Project Chat",
          documentIds: ["11111111-1111-4111-8111-111111111111"],
        });
      });

      it("rejects empty title or title exceeding 120 chars", () => {
        expect(() => createChatSchema.parse({ title: "" })).toThrow();
        expect(() => createChatSchema.parse({ title: "   " })).toThrow();
        expect(() => createChatSchema.parse({ title: "A".repeat(121) })).toThrow();
      });

      it("rejects documentIds exceeding maximum limit of 20", () => {
        const tooManyDocs = Array.from({ length: 21 }, (_, i) =>
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        );
        expect(() => createChatSchema.parse({ documentIds: tooManyDocs })).toThrow();
      });
    });

    describe("updateChatSchema", () => {
      it("requires at least one of title or pinned", () => {
        expect(() => updateChatSchema.parse({})).toThrow("Provide at least one of title or pinned.");
        expect(updateChatSchema.parse({ pinned: true })).toEqual({ pinned: true });
        expect(updateChatSchema.parse({ title: "Renamed Title" })).toEqual({ title: "Renamed Title" });
      });
    });

    describe("providerKeyBodySchema", () => {
      it("accepts supported providers: gemini, openai, anthropic", () => {
        expect(providerSchema.safeParse("gemini").success).toBe(true);
        expect(providerSchema.safeParse("openai").success).toBe(true);
        expect(providerSchema.safeParse("anthropic").success).toBe(true);
      });

      it("rejects unsupported providers (e.g. bedrock, cohere, custom URLs)", () => {
        expect(providerSchema.safeParse("bedrock").success).toBe(false);
        expect(providerSchema.safeParse("cohere").success).toBe(false);
        expect(providerSchema.safeParse("https://custom-llm.example.com").success).toBe(false);
      });

      it("rejects API keys that are too short (<8 chars) or too long (>4096 chars)", () => {
        expect(() =>
          providerKeyBodySchema.parse({ provider: "gemini", apiKey: "short" }),
        ).toThrow();
        expect(() =>
          providerKeyBodySchema.parse({ provider: "gemini", apiKey: "x".repeat(4097) }),
        ).toThrow();
      });
    });

    describe("sourceSchema (Citation contract)", () => {
      it("validates well-formed citation source", () => {
        const source = {
          n: 1,
          documentId: "12345678-1234-4234-8234-123456789abc",
          fileName: "operations-manual.pdf",
          page: 3,
          snippet: "Watchdog reclaims stale jobs after 5 minutes.",
        };
        expect(sourceSchema.safeParse(source).success).toBe(true);
      });

      it("rejects non-positive marker indices", () => {
        const invalid = {
          n: 0,
          documentId: "12345678-1234-4234-8234-123456789abc",
          fileName: "doc.pdf",
          page: 1,
          snippet: "text",
        };
        expect(sourceSchema.safeParse(invalid).success).toBe(false);
      });
    });
  });
});

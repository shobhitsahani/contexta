import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, setEnv, type Env } from "../../src/config/env.js";

describe("config/env", () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
    // Reset cached env so getEnv re-reads
    (setEnv as any)(undefined);
  });

  afterEach(() => {
    process.env = original;
  });

  it("applies defaults when env vars missing", () => {
    delete process.env.NODE_ENV;
    delete process.env.FREE_TOKEN_CAP;
    delete process.env.EMBEDDING_DIMENSIONS;
    const env = getEnv();
    expect(env.NODE_ENV).toBe("development");
    expect(env.FREE_TOKEN_CAP).toBe(50000);
    expect(env.EMBEDDING_DIMENSIONS).toBe(768);
    expect(env.HYBRID_SEARCH_ENABLED).toBe(true);
  });

  it("setEnv overrides for testing and is reflected in getEnv", () => {
    setEnv({ FREE_TOKEN_CAP: 1000, DEFAULT_TOP_K: 5 } as Partial<Env>);
    const env = getEnv();
    expect(env.FREE_TOKEN_CAP).toBe(1000);
    expect(env.DEFAULT_TOP_K).toBe(5);
    expect(env.EMBEDDING_MODEL).toBe("gemini-embedding-001"); // default still present
  });

  it("coerces numeric strings", () => {
    process.env.DEFAULT_SCORE_THRESHOLD = "0.7";
    const env = getEnv();
    expect(env.DEFAULT_SCORE_THRESHOLD).toBe(0.7);
  });
});

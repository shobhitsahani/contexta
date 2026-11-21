/**
 * Global test setup.
 *
 * Sets deterministic environment defaults BEFORE any module reads env config,
 * so tests are reproducible and never depend on the developer's real .env.
 *
 * NOTE: this file is intentionally .ts and imported via setupFiles; it runs in
 * the same module graph as the tests.
 */

// Deterministic defaults required by apps/api/src/config/env.ts
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/contexta_test";

// Fixed 32-byte (hex-encoded, 64 chars) master key so encryption tests are
// reproducible. Never used in production.
process.env.KEY_ENCRYPTION_SECRET =
  process.env.KEY_ENCRYPTION_SECRET ?? "a".repeat(32);

process.env.EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "gemini-embedding-001";
process.env.EMBEDDING_DIMENSIONS = process.env.EMBEDDING_DIMENSIONS ?? "768";

process.env.FREE_TOKEN_CAP = process.env.FREE_TOKEN_CAP ?? "50000";
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "test-better-auth-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
process.env.DEFAULT_TOP_K = process.env.DEFAULT_TOP_K ?? "8";
process.env.DEFAULT_SCORE_THRESHOLD = process.env.DEFAULT_SCORE_THRESHOLD ?? "0.3";
process.env.HYBRID_SEARCH_ENABLED = process.env.HYBRID_SEARCH_ENABLED ?? "true";

// Silence expected-error noise from providers during negative-path tests.
process.env.VITEST = "true";

export {};
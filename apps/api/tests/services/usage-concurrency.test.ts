import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Concurrency test for the free-tier token budget.
 *
 * Reproduces production's atomic reserve statement exactly:
 *   INSERT ... ON CONFLICT (user_id)
 *   DO UPDATE SET free_tokens_used = usage.free_tokens_used + $2
 *   WHERE usage.free_tokens_used + $2 <= $cap
 *   RETURNING free_tokens_used
 *
 * Many concurrent reservations for the same user must never push usage above
 * the cap, because Postgres serializes ON CONFLICT updates on the same row.
 */
describe("UsageService concurrency (real Postgres via PGlite)", () => {
  const CAP = 100;
  let client: any;

  async function createUsageTable() {
    await client.query(
      `CREATE TABLE IF NOT EXISTS usage (
        user_id text primary key,
        free_tokens_used integer default 0 not null,
        updated_at timestamptz default now()
      )`,
    );
  }

  async function reserve(userId: string, tokens: number): Promise<boolean> {
    const res = await client.query(
      `INSERT INTO usage (user_id, free_tokens_used, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id)
       DO UPDATE SET free_tokens_used = usage.free_tokens_used + $2, updated_at = now()
       WHERE usage.free_tokens_used + $2 <= $3
       RETURNING free_tokens_used`,
      [userId, tokens, CAP],
    );
    return res.rows.length > 0;
  }

  async function currentUsage(userId: string): Promise<number> {
    const res = await client.query(
      "SELECT free_tokens_used FROM usage WHERE user_id = $1",
      [userId],
    );
    return res.rows.length ? Number(res.rows[0].free_tokens_used) : 0;
  }

  beforeEach(async () => {
    client = new PGlite();
    await createUsageTable();
    await client.query("DELETE FROM usage");
  });

  afterEach(async () => {
    try { await client.pool?.end?.(); } catch { /* ignore */ }
    try { await client.end?.(); } catch { /* ignore */ }
    client = null as any;
  });

  it("concurrent reservations never exceed the cap (same user)", async () => {
    const userId = "u-concurrent";
    const N = 50;
    const tokensEach = 5; // 50 * 5 = 250 > cap 100
    const results = await Promise.all(
      Array.from({ length: N }, () => reserve(userId, tokensEach)),
    );
    const granted = results.filter(Boolean).length;
    const used = await currentUsage(userId);
    expect(used).toBeLessThanOrEqual(CAP);
    expect(granted * tokensEach).toBe(used);
    // With cap 100 and 5-token grants, at most 20 should succeed
    expect(granted).toBeLessThanOrEqual(20);
  });

  it("reserve fails once cap is reached", async () => {
    await client.query(
      "INSERT INTO usage (user_id, free_tokens_used, updated_at) VALUES ('u-cap', 100, now())",
    );
    const ok = await reserve("u-cap", 1);
    expect(ok).toBe(false);
    expect(await currentUsage("u-cap")).toBe(100);
  });

  it("settle-style clamping keeps usage within [0, cap]", async () => {
    await client.query(
      "INSERT INTO usage (user_id, free_tokens_used, updated_at) VALUES ('u-clamp', 95, now())",
    );
    // Simulate settle: actual 3 < reserved 5 -> delta -2
    const res = await client.query(
      "UPDATE usage SET free_tokens_used = LEAST($1, GREATEST(0, free_tokens_used + $2)), updated_at = now() WHERE user_id = $3 RETURNING free_tokens_used",
      [CAP, -2, "u-clamp"],
    );
    expect(Number(res.rows[0].free_tokens_used)).toBe(93);
    // Clamp at 0
    const res2 = await client.query(
      "UPDATE usage SET free_tokens_used = LEAST($1, GREATEST(0, free_tokens_used + $2)), updated_at = now() WHERE user_id = $3 RETURNING free_tokens_used",
      [CAP, -1000, "u-clamp"],
    );
    expect(Number(res2.rows[0].free_tokens_used)).toBe(0);
    // Clamp at cap
    const res3 = await client.query(
      "UPDATE usage SET free_tokens_used = LEAST($1, GREATEST(0, free_tokens_used + $2)), updated_at = now() WHERE user_id = $3 RETURNING free_tokens_used",
      [CAP, 1000, "u-clamp"],
    );
    expect(Number(res3.rows[0].free_tokens_used)).toBe(CAP);
  });
});

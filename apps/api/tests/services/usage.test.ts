import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UsageService, estimateTokens } from "../../src/services/usage.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { seedUser } from "../helpers/seed.js";

describe("UsageService (token budget)", () => {
  let database: TestDatabase;
  let svc: UsageService;
  let userId: string;

  beforeEach(async () => {
    database = await createTestDatabase();
    const user = await seedUser(database.db, { emailVerified: true });
    userId = user.id;
    svc = new UsageService(database.db, { freeTokensCap: 100 });
  });

  afterEach(async () => {
    await database.close();
  });

  it("getUsage returns zero usage when no row exists", async () => {
    const u = await svc.getUsage(userId, true);
    expect(u.freeTokensUsed).toBe(0);
    expect(u.freeTokensCap).toBe(100);
    expect(u.freeTokensRemaining).toBe(100);
    expect(u.hasOwnKey).toBe(false);
    expect(u.freeTierEligible).toBe(true);
    expect(u.keyRequired).toBe(false);
  });

  it("keyRequired is true when not email verified", async () => {
    const u = await svc.getUsage(userId, false);
    expect(u.keyRequired).toBe(true);
  });

  it("reserveTokens rejects when estimate alone exceeds cap", async () => {
    await expect(
      svc.reserveTokens(userId, 150, { emailVerified: true }),
    ).rejects.toThrow();
  });

  it("reserveTokens rejects unverified email", async () => {
    await expect(
      svc.reserveTokens(userId, 10, { emailVerified: false }),
    ).rejects.toThrow(/email/i);
  });

  it("reserveTokens increments usage and settle adjusts downward", async () => {
    const res = await svc.reserveTokens(userId, 30, { emailVerified: true });
    expect(await svc.getFreeTokensUsed(userId)).toBe(30);
    const final = await res.settle(25); // actual 25 < reserved 30
    expect(final).toBe(25);
    expect(await svc.getFreeTokensUsed(userId)).toBe(25);
  });

  it("release restores the reservation", async () => {
    await svc.reserveTokens(userId, 40, { emailVerified: true });
    const res = await svc.reserveTokens(userId, 40, { emailVerified: true });
    expect(await svc.getFreeTokensUsed(userId)).toBe(80);
    await res.release(); // settle(0)
    expect(await svc.getFreeTokensUsed(userId)).toBe(40);
  });

  it("isFreeTierExhausted reflects usage vs cap", async () => {
    expect(await svc.isFreeTierExhausted(userId)).toBe(false);
    await svc.reserveTokens(userId, 100, { emailVerified: true });
    expect(await svc.isFreeTierExhausted(userId)).toBe(true);
  });
});

describe("estimateTokens (exported helper)", () => {
  it("computes chars/4 plus a 1500-token output reserve", () => {
    expect(estimateTokens("")).toBe(1500);
    expect(estimateTokens("abcd")).toBe(1501);
    expect(estimateTokens("abcde")).toBe(1502);
    expect(estimateTokens("abcd", 0)).toBe(1);
  });
});

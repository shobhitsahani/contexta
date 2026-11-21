import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  parseMasterKey,
  decryptProviderKey,
  keyAad,
} from "../../src/services/keys.js";
import { providerKeys } from "../../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createTestApp } from "../helpers/app.js";
import { seedUser, authHeader } from "../helpers/seed.js";

describe("settings router (BYOK)", () => {
  const masterKey = parseMasterKey("a".repeat(32));
  let database: TestDatabase;
  let user: Awaited<ReturnType<typeof seedUser>>;
  let app: ReturnType<typeof createTestApp>["app"];

  beforeEach(async () => {
    database = await createTestDatabase();
    user = await seedUser(database.db, { email: "user-1@example.com" });
    const ctx = createTestApp({
      db: database.db,
      validator: {
        validate: async () => undefined,
        calls: [],
        error: null,
      },
    });
    app = ctx.app;
  });

  afterEach(async () => {
    await database.close();
  });

  it("PUT encrypts and stores the key, returns 204", async () => {
    const res = await request(app)
      .put("/api/settings/provider-key")
      .set(authHeader(user.id))
      .send({ provider: "gemini", apiKey: "sk-test-12345" });
    expect(res.statusCode).toBe(204);

    const rows = await database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.userId, user.id));
    expect(rows.length).toBe(1);
    const again = decryptProviderKey(
      { ciphertext: rows[0].ciphertext, iv: rows[0].iv, authTag: rows[0].authTag },
      masterKey,
      keyAad(user.id, "gemini"),
    );
    expect(again).toBe("sk-test-12345");
  });

  it("PUT upserts (same user+provider replaces)", async () => {
    await request(app)
      .put("/api/settings/provider-key")
      .set(authHeader(user.id))
      .send({ provider: "openai", apiKey: "key-one-secret" });
    await request(app)
      .put("/api/settings/provider-key")
      .set(authHeader(user.id))
      .send({ provider: "openai", apiKey: "key-two-secret" });

    const rows = await database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.userId, user.id));
    expect(rows.length).toBe(1);
  });

  it("GET returns provider metadata only, never plaintext", async () => {
    await request(app)
      .put("/api/settings/provider-key")
      .set(authHeader(user.id))
      .send({ provider: "gemini", apiKey: "secret-gemini-key" });

    const res = await request(app)
      .get("/api/settings/provider-key")
      .set(authHeader(user.id));
    expect(res.statusCode).toBe(200);
    expect(res.body.providers[0].provider).toBe("gemini");
    expect((res.body.providers[0] as any).ciphertext).toBeUndefined();
  });

  it("DELETE removes a provider key", async () => {
    await request(app)
      .put("/api/settings/provider-key")
      .set(authHeader(user.id))
      .send({ provider: "gemini", apiKey: "secret-gemini-key" });

    const res = await request(app)
      .delete("/api/settings/provider-key?provider=gemini")
      .set(authHeader(user.id));
    expect(res.statusCode).toBe(204);

    const rows = await database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.userId, user.id));
    expect(rows.length).toBe(0);
  });
});

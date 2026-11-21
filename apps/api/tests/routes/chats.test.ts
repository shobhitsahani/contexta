import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { chats } from "../../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createTestApp } from "../helpers/app.js";
import { seedDocument, seedUser, authHeader } from "../helpers/seed.js";

describe("chats router (CRUD + isolation)", () => {
  let database: TestDatabase;
  let user1: Awaited<ReturnType<typeof seedUser>>;
  let user2: Awaited<ReturnType<typeof seedUser>>;
  let readyDoc1: Awaited<ReturnType<typeof seedDocument>>;
  let procDoc1: Awaited<ReturnType<typeof seedDocument>>;
  let otherDoc: Awaited<ReturnType<typeof seedDocument>>;
  let app: ReturnType<typeof createTestApp>["app"];

  beforeEach(async () => {
    database = await createTestDatabase();
    user1 = await seedUser(database.db, { email: "u1@example.com" });
    user2 = await seedUser(database.db, { email: "u2@example.com" });
    readyDoc1 = await seedDocument(database.db, user1.id, {
      status: "ready",
      name: "Ready doc",
    });
    procDoc1 = await seedDocument(database.db, user1.id, {
      status: "embedding",
      name: "Processing",
    });
    otherDoc = await seedDocument(database.db, user2.id, {
      status: "ready",
      name: "Other user's doc",
    });
    const ctx = createTestApp({ db: database.db });
    app = ctx.app;
  });

  afterEach(async () => {
    await database.close();
  });

  it("POST creates a chat with ready documents only", async () => {
    const res = await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ documentIds: [readyDoc1.id] });
    expect(res.statusCode).toBe(201);
    expect(res.body.documentIds).toEqual([readyDoc1.id]);

    const rows = await database.db
      .select()
      .from(chats)
      .where(eq(chats.userId, user1.id));
    expect(rows.length).toBe(1);
  });

  it("POST rejects non-ready documents", async () => {
    const res = await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ documentIds: [procDoc1.id] });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("DOCUMENT_NOT_READY");
  });

  it("POST rejects documents owned by another user (isolation)", async () => {
    const res = await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ documentIds: [otherDoc.id] });
    expect(res.statusCode).toBe(404);
  });

  it("GET lists only the requesting user's chats", async () => {
    await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ title: "A", documentIds: [] });
    await request(app)
      .post("/api/chats")
      .set(authHeader(user2.id))
      .send({ title: "B", documentIds: [] });

    const res = await request(app)
      .get("/api/chats")
      .set(authHeader(user1.id));
    expect(res.statusCode).toBe(200);
    expect(res.body.chats.length).toBe(1);
    expect(res.body.chats[0].title).toBe("A");
  });

  it("GET /:id returns chat + documentIds", async () => {
    const created = await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ title: "A", documentIds: [readyDoc1.id] });

    const res = await request(app)
      .get(`/api/chats/${created.body.id}`)
      .set(authHeader(user1.id));
    expect(res.statusCode).toBe(200);
    expect(res.body.documentIds).toContain(readyDoc1.id);
  });

  it("PATCH /:id renames and pins (owner only)", async () => {
    const created = await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ title: "Old", documentIds: [] });

    const res = await request(app)
      .patch(`/api/chats/${created.body.id}`)
      .set(authHeader(user1.id))
      .send({ title: "New", pinned: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.title).toBe("New");
    expect(res.body.pinned).toBe(true);
  });

  it("DELETE /:id removes the chat", async () => {
    const created = await request(app)
      .post("/api/chats")
      .set(authHeader(user1.id))
      .send({ title: "A", documentIds: [] });

    const res = await request(app)
      .delete(`/api/chats/${created.body.id}`)
      .set(authHeader(user1.id));
    expect(res.statusCode).toBe(204);

    const rows = await database.db
      .select()
      .from(chats)
      .where(eq(chats.userId, user1.id));
    expect(rows.length).toBe(0);
  });
});

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createDocumentsRouter } from "../../src/routes/documents/handler.js";
import { MemoryStorageService } from "../../src/services/storage.js";
import { MemoryJobQueue } from "../../src/queue/index.js";
import {
  createTestTxtBuffer,
} from "./fixtures.js";

describe("Documents Route Handlers", () => {
  function createTestApp(customDocs: any[] = [], queue = new MemoryJobQueue(), storage = new MemoryStorageService()) {
    const app = express();
    app.use(express.json());

    const docs = [...customDocs];

    const fakeDb = {
      docs,
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation((_cond: any) => ({
            orderBy: vi.fn().mockImplementation(() => Promise.resolve(docs)),
            then: (resolve: any) => resolve(docs),
          })),
          orderBy: vi.fn().mockImplementation(() => Promise.resolve(docs)),
          then: (resolve: any) => resolve(docs),
        })),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((val: any) => {
          docs.push(val);
          return Promise.resolve();
        }),
      })),
      delete: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => Promise.resolve()),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((_fields: any) => ({
          where: vi.fn().mockImplementation(() => Promise.resolve()),
        })),
      })),
    };

    const router = createDocumentsRouter({
      db: fakeDb,
      storage,
      queue,
    });

    app.use("/documents", router);
    return { app, fakeDb, queue, storage };
  }

  it("POST /documents uploads a valid TXT file and enqueues job", async () => {
    const { app, queue, storage } = createTestApp();
    const txtBuffer = createTestTxtBuffer("Contexta test document text content");

    const res = await request(app)
      .post("/documents")
      .set("x-user-id", "user-123")
      .attach("file", txtBuffer, "manual.txt");

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("queued");
    expect(res.body.id).toBeDefined();

    // Verify job was enqueued
    const claimed = await queue.claimNextJob();
    expect(claimed?.documentId).toBe(res.body.id);

    // Verify file in storage
    const storageKey = `documents/${res.body.id}/manual.txt`;
    expect(await storage.exists(storageKey)).toBe(true);
  });

  it("POST /documents rejects request without a file", async () => {
    const { app } = createTestApp();

    const res = await request(app)
      .post("/documents")
      .set("x-user-id", "user-123");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /documents rejects unsupported file extensions", async () => {
    const { app } = createTestApp();
    const fakeExe = Buffer.from("MZ fake executable binary");

    const res = await request(app)
      .post("/documents")
      .set("x-user-id", "user-123")
      .attach("file", fakeExe, "program.exe");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_TYPE");
  });

  it("POST /documents enforces max 5 documents per user limit", async () => {
    const initialDocs = Array.from({ length: 5 }, (_, i) => ({
      id: `doc-${i}`,
      userId: "user-limit-test",
      name: `file-${i}.txt`,
    }));

    const { app } = createTestApp(initialDocs);
    const txtBuffer = createTestTxtBuffer("Another file");

    const res = await request(app)
      .post("/documents")
      .set("x-user-id", "user-limit-test")
      .attach("file", txtBuffer, "sixth.txt");

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Maximum limit of 5 documents reached");
  });

  it("POST /documents rejects file exceeding 10 MB limit with 413 FILE_TOO_LARGE", async () => {
    const { app } = createTestApp();
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

    const res = await request(app)
      .post("/documents")
      .set("x-user-id", "user-123")
      .attach("file", largeBuffer, "large.txt");

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("GET /documents lists user documents", async () => {
    const initialDocs = [
      {
        id: "doc-1",
        userId: "user-a",
        name: "file1.txt",
        mime: "text/plain",
        sizeBytes: 100,
        status: "ready",
        createdAt: new Date(),
      },
    ];

    const { app } = createTestApp(initialDocs);

    const res = await request(app)
      .get("/documents")
      .set("x-user-id", "user-a");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("doc-1");
  });

  it("GET /documents/:id returns document status and metadata", async () => {
    const doc = {
      id: "doc-find-1",
      userId: "user-a",
      name: "report.pdf",
      mime: "application/pdf",
      sizeBytes: 2048,
      status: "embedding",
      pageCount: 5,
      isDemo: false,
      summaryStatus: "pending",
      createdAt: new Date(),
    };

    const { app, fakeDb } = createTestApp([doc]);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([doc]),
      }),
    }));

    const res = await request(app)
      .get("/documents/doc-find-1")
      .set("x-user-id", "user-a");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("doc-find-1");
    expect(res.body.status).toBe("embedding");
    expect(res.body.pageCount).toBe(5);
  });

  it("GET /documents/:id returns 404 for nonexistent document", async () => {
    const { app, fakeDb } = createTestApp([]);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }));

    const res = await request(app)
      .get("/documents/non-existent-id")
      .set("x-user-id", "user-a");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("DELETE /documents/:id deletes document and returns 204", async () => {
    const doc = {
      id: "doc-del-1",
      userId: "user-a",
      name: "todelete.txt",
      storageKey: "documents/doc-del-1/todelete.txt",
    };

    const storage = new MemoryStorageService();
    await storage.upload(doc.storageKey, Buffer.from("content"), "text/plain");

    const { app, fakeDb } = createTestApp([doc], new MemoryJobQueue(), storage);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([doc]),
      }),
    }));

    const res = await request(app)
      .delete("/documents/doc-del-1")
      .set("x-user-id", "user-a");

    expect(res.status).toBe(204);
    expect(await storage.exists(doc.storageKey)).toBe(false);
  });

  it("POST /documents rejects unauthenticated upload for private documents (401)", async () => {
    const { app } = createTestApp();
    const txtBuffer = createTestTxtBuffer("Private content");

    const res = await request(app)
      .post("/documents")
      .attach("file", txtBuffer, "private.txt");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("POST /documents rejects unauthenticated uploads even when isDemo is set (401)", async () => {
    const { app } = createTestApp();
    const txtBuffer = createTestTxtBuffer("Demo content attempt");

    const res = await request(app)
      .post("/documents")
      .field("isDemo", "true")
      .attach("file", txtBuffer, "demo.txt");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("POST /documents/:id/summary rejects document that is not ready with 400 DOCUMENT_NOT_READY", async () => {
    const notReadyDoc = {
      id: "doc-not-ready",
      userId: "user-a",
      name: "doc.txt",
      mime: "text/plain",
      status: "embedding",
      isDemo: false,
    };

    const { app, fakeDb } = createTestApp([notReadyDoc]);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([notReadyDoc]),
      }),
    }));

    const res = await request(app)
      .post("/documents/doc-not-ready/summary")
      .set("x-user-id", "user-a");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DOCUMENT_NOT_READY");
  });

  it("GET /documents/:id rejects unauthenticated and cross-user access to private documents (404)", async () => {
    const privateDoc = {
      id: "doc-private-1",
      userId: "alice-id",
      name: "secret.pdf",
      mime: "application/pdf",
      sizeBytes: 100,
      status: "ready",
      isDemo: false,
      createdAt: new Date(),
    };

    const { app, fakeDb } = createTestApp([privateDoc]);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([privateDoc]),
      }),
    }));

    // Anonymous request
    const unauthRes = await request(app).get("/documents/doc-private-1");
    expect(unauthRes.status).toBe(404);

    // Cross-user request (Bob)
    const bobRes = await request(app)
      .get("/documents/doc-private-1")
      .set("x-user-id", "bob-id");
    expect(bobRes.status).toBe(404);

    // Owner request (Alice)
    const aliceRes = await request(app)
      .get("/documents/doc-private-1")
      .set("x-user-id", "alice-id");
    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body.id).toBe("doc-private-1");
  });

  it("DELETE /documents/:id rejects deletion of demo documents (403)", async () => {
    const demoDoc = {
      id: "demo-doc-1",
      userId: null,
      name: "sample.txt",
      mime: "text/plain",
      sizeBytes: 100,
      status: "ready",
      isDemo: true,
      storageKey: "docs/demo-doc-1/sample.txt",
    };

    const { app, fakeDb } = createTestApp([demoDoc]);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([demoDoc]),
      }),
    }));

    const res = await request(app)
      .delete("/documents/demo-doc-1")
      .set("x-user-id", "any-user");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("DELETE /documents/:id rejects unauthenticated and cross-user deletion (404)", async () => {
    const privateDoc = {
      id: "doc-del-alice",
      userId: "alice-id",
      name: "alice.txt",
      storageKey: "docs/alice.txt",
      isDemo: false,
    };

    const { app, fakeDb } = createTestApp([privateDoc]);
    fakeDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([privateDoc]),
      }),
    }));

    // Unauthenticated
    const unauthRes = await request(app).delete("/documents/doc-del-alice");
    expect(unauthRes.status).toBe(404);

    // Cross-user (Bob)
    const bobRes = await request(app)
      .delete("/documents/doc-del-alice")
      .set("x-user-id", "bob-id");
    expect(bobRes.status).toBe(404);
  });
});

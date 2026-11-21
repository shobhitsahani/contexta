import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createDocumentsRouter } from "../../src/routes/documents/index.js";

describe("documents router (summary)", () => {
  let docStore: any[];
  let summaryStore: any[];

  beforeEach(() => {
    docStore = [
      {
        id: "doc-1",
        userId: "u1",
        name: "a.txt",
        mime: "text/plain",
        status: "ready",
        summaryStatus: "ready",
        storageKey: "k1",
        pageCount: 2,
        isDemo: false,
        createdAt: new Date(),
      },
    ];
    summaryStore = [];
  });

  function makeApp() {
    const app = express();
    app.use(express.json());

    const fakeDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: any) => ({
          where: vi.fn().mockImplementation((_cond: any) => {
            // Check if selecting from documentSummaries or documents
            const isSummary = table?._?.name === "document_summaries" || table?.documentId !== undefined;
            if (isSummary) {
              return Promise.resolve(summaryStore);
            }
            return Promise.resolve(docStore);
          }),
        })),
      })),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const router = createDocumentsRouter({
      db: fakeDb as any,
      storage: {
        download: async () => Buffer.from("hello world"),
        upload: async () => "k1",
        delete: async () => {},
        exists: async () => true,
      } as any,
      llm: undefined,
    });

    app.use("/documents", router);
    return app;
  }

  it("GET /:id/summary returns stored summary", async () => {
    summaryStore.push({
      documentId: "doc-1",
      level: 0,
      ordinal: 0,
      title: "Overview",
      pageStart: 1,
      pageEnd: 2,
      text: JSON.stringify({ overview: "A doc about things.", keyPoints: ["p1", "p2"] }),
    });

    const app = makeApp();
    const res = await request(app)
      .get("/documents/doc-1/summary")
      .set("x-user-id", "u1");

    expect(res.status).toBe(200);
    expect(res.body.overview).toBe("A doc about things.");
    expect(res.body.keyPoints).toEqual(["p1", "p2"]);
  });

  it("GET /:id/summary 404 when no stored summary", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/documents/doc-1/summary")
      .set("x-user-id", "u1");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("GET /:id/summary 404 for another user's document (isolation)", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/documents/doc-1/summary")
      .set("x-user-id", "u2"); // not the owner

    expect(res.status).toBe(404);
  });

  it("GET /:id/summary 404 when document missing", async () => {
    docStore = []; // no document
    const app = makeApp();
    const res = await request(app)
      .get("/documents/nope/summary")
      .set("x-user-id", "u1");

    expect(res.status).toBe(404);
  });
});

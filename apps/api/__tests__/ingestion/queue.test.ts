import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { MemoryJobQueue } from "../../src/queue/index.js";
import { JobWorker, PgQueue } from "../../src/queue/pgQueue.js";
import { createTestDatabase } from "../../tests/helpers/testDb.js";
import { documents, jobs } from "../../src/db/schema.js";

describe("Job Queue System", () => {
  describe("MemoryJobQueue", () => {
    it("enqueues and claims jobs in FIFO order", async () => {
      const queue = new MemoryJobQueue();
      await queue.enqueue({ documentId: "doc-1" });
      await queue.enqueue({ documentId: "doc-2" });

      const job1 = await queue.claimNextJob();
      expect(job1).not.toBeNull();
      expect(job1?.documentId).toBe("doc-1");
      expect(job1?.attempts).toBe(1);

      const job2 = await queue.claimNextJob();
      expect(job2).not.toBeNull();
      expect(job2?.documentId).toBe("doc-2");
      expect(job2?.attempts).toBe(1);

      const job3 = await queue.claimNextJob();
      expect(job3).toBeNull();
    });

    it("marks completed jobs as done", async () => {
      const queue = new MemoryJobQueue();
      await queue.enqueue({ documentId: "doc-1" });

      const job = await queue.claimNextJob();
      expect(job).not.toBeNull();

      await queue.completeJob(job!.id);

      const jobs = queue.getJobs();
      expect(jobs[0].status).toBe("done");
    });

    it("handles retries and marks failed after max attempts", async () => {
      const queue = new MemoryJobQueue(3);
      await queue.enqueue({ documentId: "doc-fail" });

      // Attempt 1
      const job1 = await queue.claimNextJob();
      expect(job1?.attempts).toBe(1);
      await queue.failJob(job1!.id, new Error("Transient network error"), 1);

      const jobs1 = queue.getJobs();
      expect(jobs1[0].status).toBe("queued");

      // Attempt 2
      jobs1[0].runAt = Date.now() - 1000; // force ready
      const job2 = await queue.claimNextJob();
      expect(job2?.attempts).toBe(2);
      await queue.failJob(job2!.id, new Error("Another transient error"), 2);
      expect(jobs1[0].status).toBe("queued");

      // Attempt 3 (Final attempt)
      jobs1[0].runAt = Date.now() - 1000;
      const job3 = await queue.claimNextJob();
      expect(job3?.attempts).toBe(3);
      await queue.failJob(job3!.id, new Error("Permanent fatal error"), 3);

      expect(jobs1[0].status).toBe("failed");
    });

    it("reclaims stale processing jobs", async () => {
      const queue = new MemoryJobQueue();
      await queue.enqueue({ documentId: "doc-stale" });

      const job = await queue.claimNextJob();
      expect(job).not.toBeNull();

      // Simulate a stale job locked 10 minutes ago
      const jobs = queue.getJobs();
      jobs[0].lockedAt = Date.now() - 10 * 60 * 1000;

      const reclaimed = await queue.reclaimStaleJobs(5 * 60 * 1000);
      expect(reclaimed).toBe(1);
      expect(jobs[0].status).toBe("queued");
    });
  });

  describe("JobWorker", () => {
    it("processes claimed jobs with the registered handler", async () => {
      const queue = new MemoryJobQueue();
      await queue.enqueue({ documentId: "doc-work" });

      const handlerMock = vi.fn().mockResolvedValue(undefined);
      const worker = new JobWorker(queue, handlerMock);

      const stepped = await worker.step();
      expect(stepped).toBe(true);
      expect(handlerMock).toHaveBeenCalledWith({ documentId: "doc-work" });

      const jobs = queue.getJobs();
      expect(jobs[0].status).toBe("done");

      // Next step should find nothing
      const secondStep = await worker.step();
      expect(secondStep).toBe(false);
    });

    it("fails the job if the handler throws an error", async () => {
      const queue = new MemoryJobQueue();
      await queue.enqueue({ documentId: "doc-error" });

      const handlerMock = vi.fn().mockRejectedValue(new Error("Parsing crash"));
      const worker = new JobWorker(queue, handlerMock);

      await worker.step();

      const jobs = queue.getJobs();
      expect(jobs[0].status).toBe("queued"); // retrying
    });
  });

  describe("PgQueue SQL generation", () => {
    it("constructs correct FOR UPDATE SKIP LOCKED query", async () => {
      const executedQueries: any[] = [];
      const fakeDb = {
        execute: vi.fn().mockImplementation(async (query: any) => {
          executedQueries.push(query);
          return { rows: [{ id: "job-1", documentId: "doc-1", attempts: 1 }] };
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const pgQueue = new PgQueue(fakeDb);
      const claimed = await pgQueue.claimNextJob();

      expect(claimed).toEqual({
        id: "job-1",
        documentId: "doc-1",
        attempts: 1,
      });

      expect(fakeDb.execute).toHaveBeenCalled();
    });
  });

  describe("PgQueue Integration (PostgreSQL via PGlite)", () => {
    it("enqueues, claims with SKIP LOCKED, retries and marks done in real PostgreSQL", async () => {
      const { db, client } = await createTestDatabase();
      try {
        const docId = "a1111111-1111-1111-1111-111111111111";
        await db.insert(documents).values({
          id: docId,
          name: "contract.pdf",
          mime: "application/pdf",
          sizeBytes: 1024,
          storageKey: "docs/contract.pdf",
          status: "queued",
        });

        const queue = new PgQueue(db, 3);
        await queue.enqueue({ documentId: docId });

        // Claim job
        const claimed = await queue.claimNextJob();
        expect(claimed).not.toBeNull();
        expect(claimed?.documentId).toBe(docId);
        expect(claimed?.attempts).toBe(1);

        // Fail attempt 1 with retryable error
        await queue.failJob(claimed!.id, new Error("Temporary connection reset"), claimed!.attempts);

        // Check document status is preserved as 'queued' during backoff (not prematurely failed)
        const docRows1 = await db.select().from(documents).where(eq(documents.id, docId));
        expect(docRows1[0].status).toBe("queued");
        expect(docRows1[0].error).toContain("Retrying");

        // Force runAt to now so it can be claimed again
        await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, claimed!.id));

        const claimed2 = await queue.claimNextJob();
        expect(claimed2?.attempts).toBe(2);

        // Complete job
        await queue.completeJob(claimed2!.id);
        const jobRowsDone = await db.select().from(jobs).where(eq(jobs.id, claimed!.id));
        expect(jobRowsDone[0].status).toBe("done");
      } finally {
        await client.close();
      }
    }, 45_000);

    it("immediately fails fatal non-retryable errors without wasting 3 retry attempts", async () => {
      const { db, client } = await createTestDatabase();
      try {
        const docId = "b2222222-2222-2222-2222-222222222222";
        await db.insert(documents).values({
          id: docId,
          name: "scanned.pdf",
          mime: "application/pdf",
          sizeBytes: 500,
          storageKey: "docs/scanned.pdf",
          status: "queued",
        });

        const queue = new PgQueue(db, 3);
        await queue.enqueue({ documentId: docId });

        const claimed = await queue.claimNextJob();
        expect(claimed).not.toBeNull();

        // Fail with fatal non-retryable error
        await queue.failJob(claimed!.id, new Error("scanned PDF not supported yet"), claimed!.attempts);

        const jobRows = await db.select().from(jobs).where(eq(jobs.id, claimed!.id));
        expect(jobRows[0].status).toBe("failed");

        const docRows = await db.select().from(documents).where(eq(documents.id, docId));
        expect(docRows[0].status).toBe("failed");
        expect(docRows[0].error).toContain("scanned PDF not supported yet");
      } finally {
        await client.close();
      }
    }, 45_000);

    it("reclaims stale jobs and synchronizes document status in real PostgreSQL", async () => {
      const { db, client } = await createTestDatabase();
      try {
        const docId = "c3333333-3333-3333-3333-333333333333";
        await db.insert(documents).values({
          id: docId,
          name: "stale.pdf",
          mime: "application/pdf",
          sizeBytes: 500,
          storageKey: "docs/stale.pdf",
          status: "embedding",
        });

        const queue = new PgQueue(db, 3);
        await queue.enqueue({ documentId: docId });

        const claimed = await queue.claimNextJob();
        // Simulate stuck in processing for 10 minutes (attempt 1)
        await db.update(jobs).set({ lockedAt: new Date(Date.now() - 10 * 60 * 1000) }).where(eq(jobs.id, claimed!.id));

        const reclaimed = await queue.reclaimStaleJobs(5 * 60 * 1000);
        expect(reclaimed).toBe(1);

        const jobRows = await db.select().from(jobs).where(eq(jobs.id, claimed!.id));
        expect(jobRows[0].status).toBe("queued");

        const docRows = await db.select().from(documents).where(eq(documents.id, docId));
        expect(docRows[0].status).toBe("queued");
        expect(docRows[0].error).toContain("Reclaimed stale job");

        // Simulate max attempts exhausted (attempt 3) and stuck again
        await db.update(jobs).set({
          status: "processing",
          attempts: 3,
          lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        }).where(eq(jobs.id, claimed!.id));

        const reclaimedMax = await queue.reclaimStaleJobs(5 * 60 * 1000);
        expect(reclaimedMax).toBe(1);

        const jobRowsFailed = await db.select().from(jobs).where(eq(jobs.id, claimed!.id));
        expect(jobRowsFailed[0].status).toBe("failed");

        const docRowsFailed = await db.select().from(documents).where(eq(documents.id, docId));
        expect(docRowsFailed[0].status).toBe("failed");
        expect(docRowsFailed[0].error).toContain("exceeded maximum retry attempts");
      } finally {
        await client.close();
      }
    }, 45_000);
  });
});

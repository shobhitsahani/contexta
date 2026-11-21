import { sql } from "drizzle-orm";
import { db as defaultDb } from "../db/client.js";
import { jobs } from "../db/schema.js";
import type { JobPayload, JobQueue, JobRecord } from "./queue.js";

export const MAX_JOB_ATTEMPTS = 3;
export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export class PgQueue implements JobQueue {
  private db: any;
  private maxAttempts: number;

  constructor(customDb?: any, maxAttempts = MAX_JOB_ATTEMPTS) {
    this.db = customDb ?? defaultDb;
    this.maxAttempts = maxAttempts;
  }

  async enqueue(job: JobPayload): Promise<void> {
    await this.db.insert(jobs).values({
      documentId: job.documentId,
      status: "queued",
      attempts: 0,
      runAt: new Date(),
    });
  }

  /**
   * Atomically claim the next eligible job using SELECT ... FOR UPDATE SKIP LOCKED.
   */
  async claimNextJob(): Promise<JobRecord | null> {
    const result: any = await this.db.execute(sql`
      UPDATE jobs
      SET status = 'processing',
          locked_at = NOW(),
          attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'queued'
          AND run_at <= NOW()
        ORDER BY run_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, document_id as "documentId", attempts
    `);

    const rows = result.rows ?? result;
    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      documentId: row.documentId ?? row.document_id,
      attempts: Number(row.attempts),
    };
  }

  async completeJob(jobId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs
      SET status = 'done',
          locked_at = NULL
      WHERE id = ${jobId}
    `);
  }

  async failJob(jobId: string, error: Error, attempts: number): Promise<void> {
    const errorMsg = (error.message || "Unknown error").slice(0, 1000);
    const status = (error as any).status;
    const isClientError = typeof status === "number" && status >= 400 && status < 500;

    const isNonRetryable =
      isClientError ||
      errorMsg.includes("scanned PDF") ||
      errorMsg.includes("UNSUPPORTED_TYPE") ||
      errorMsg.includes("FILE_TOO_LARGE") ||
      errorMsg.includes("VALIDATION_ERROR") ||
      errorMsg.includes("NOT_FOUND") ||
      errorMsg.includes("does not match") ||
      errorMsg.includes("corrupted") ||
      errorMsg.includes("binary/null bytes") ||
      errorMsg.includes("empty") ||
      errorMsg.includes("no readable text") ||
      errorMsg.includes("no text chunks") ||
      errorMsg.includes("not found");

    if (attempts < this.maxAttempts && !isNonRetryable) {
      // Exponential backoff: attempt 1 -> 10s, attempt 2 -> 20s
      const backoffSeconds = Math.pow(2, attempts) * 5;
      await this.db.execute(sql`
        UPDATE jobs
        SET status = 'queued',
            locked_at = NULL,
            run_at = NOW() + (${backoffSeconds} * interval '1 second'),
            last_error = ${errorMsg}
        WHERE id = ${jobId}
      `);

      // Keep document in queued state while awaiting retry so it is not prematurely marked failed
      await this.db.execute(sql`
        UPDATE documents
        SET status = 'queued',
            error = ${'Retrying: ' + errorMsg}
        WHERE id = (SELECT document_id FROM jobs WHERE id = ${jobId})
      `);
    } else {
      // Exceeded max attempts or fatal non-retryable error: mark job and document as failed
      await this.db.execute(sql`
        UPDATE jobs
        SET status = 'failed',
            locked_at = NULL,
            last_error = ${errorMsg}
        WHERE id = ${jobId}
      `);

      // Update associated document status to failed
      await this.db.execute(sql`
        UPDATE documents
        SET status = 'failed',
            error = ${errorMsg}
        WHERE id = (SELECT document_id FROM jobs WHERE id = ${jobId})
      `);
    }
  }

  /**
   * Reclaim jobs stuck in 'processing' longer than staleThresholdMs.
   * Plan.md 17.2: Reclaim jobs stuck in processing longer than N minutes.
   */
  async reclaimStaleJobs(staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS): Promise<number> {
    const intervalSeconds = Math.max(1, Math.floor(staleThresholdMs / 1000));
    const result: any = await this.db.execute(sql`
      UPDATE jobs
      SET status = CASE
            WHEN attempts < ${this.maxAttempts} THEN 'queued'
            ELSE 'failed'
          END,
          locked_at = NULL,
          run_at = NOW()
      WHERE status = 'processing'
        AND locked_at < NOW() - (${intervalSeconds} * interval '1 second')
      RETURNING id, document_id as "documentId", attempts
    `);

    const rows = result.rows ?? result;
    if (rows && rows.length > 0) {
      for (const row of rows) {
        const docId = row.documentId ?? row.document_id;
        if (!docId) continue;
        if (Number(row.attempts) >= this.maxAttempts) {
          await this.db.execute(sql`
            UPDATE documents
            SET status = 'failed',
                error = 'Ingestion job timed out and exceeded maximum retry attempts'
            WHERE id = ${docId}
          `);
        } else {
          await this.db.execute(sql`
            UPDATE documents
            SET status = 'queued',
                error = 'Reclaimed stale job for retry'
            WHERE id = ${docId}
          `);
        }
      }
    }
    return rows ? rows.length : 0;
  }

  process(handler: (job: JobPayload) => Promise<void>): void {
    // Process is initiated via JobWorker
    const worker = new JobWorker(this, handler);
    worker.start();
  }
}

/**
 * Worker runner that executes jobs one at a time.
 */
export class JobWorker {
  private queue: JobQueue;
  private handler: (job: JobPayload) => Promise<void>;
  private isRunning = false;
  private pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private reclaimTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    queue: JobQueue,
    handler: (job: JobPayload) => Promise<void>,
    pollIntervalMs = 1000,
  ) {
    this.queue = queue;
    this.handler = handler;
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Plan.md 17.2: Reclaim stale jobs on boot and every minute
    void this.queue.reclaimStaleJobs().catch(() => {});
    this.reclaimTimer = setInterval(() => {
      void this.queue.reclaimStaleJobs().catch(() => {});
    }, 60_000);
    if (this.reclaimTimer.unref) {
      this.reclaimTimer.unref();
    }

    this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.reclaimTimer) {
      clearInterval(this.reclaimTimer);
      this.reclaimTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    let hadWork = false;
    try {
      hadWork = await this.step();
    } catch {
      // Ignore polling errors and continue next loop
    }

    if (this.isRunning) {
      const delay = hadWork ? 50 : this.pollIntervalMs;
      this.timer = setTimeout(() => this.poll(), delay);
    }
  }

  async step(): Promise<boolean> {
    if (this.isProcessing) return false;
    this.isProcessing = true;

    try {
      const job = await this.queue.claimNextJob();
      if (!job) {
        return false;
      }

      try {
        await this.handler({ documentId: job.documentId });
        await this.queue.completeJob(job.id);
      } catch (err: any) {
        await this.queue.failJob(job.id, err instanceof Error ? err : new Error(String(err)), job.attempts);
      }
      return true;
    } finally {
      this.isProcessing = false;
    }
  }
}

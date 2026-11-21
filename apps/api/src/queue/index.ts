import type { JobPayload, JobQueue, JobRecord } from "./queue.js";
import { JobWorker } from "./pgQueue.js";

export * from "./queue.js";
export * from "./pgQueue.js";

/**
 * In-memory JobQueue for fast isolated unit tests.
 */
export class MemoryJobQueue implements JobQueue {
  private jobs: Array<{
    id: string;
    documentId: string;
    status: "queued" | "processing" | "done" | "failed";
    attempts: number;
    runAt: number;
    lockedAt: number | null;
  }> = [];
  private maxAttempts: number;

  constructor(maxAttempts = 3) {
    this.maxAttempts = maxAttempts;
  }

  async enqueue(job: JobPayload): Promise<void> {
    this.jobs.push({
      id: `job-${this.jobs.length + 1}`,
      documentId: job.documentId,
      status: "queued",
      attempts: 0,
      runAt: Date.now(),
      lockedAt: null,
    });
  }

  async claimNextJob(): Promise<JobRecord | null> {
    const now = Date.now();
    const candidate = this.jobs.find(
      (j) => j.status === "queued" && j.runAt <= now,
    );
    if (!candidate) return null;

    candidate.status = "processing";
    candidate.lockedAt = now;
    candidate.attempts += 1;

    return {
      id: candidate.id,
      documentId: candidate.documentId,
      attempts: candidate.attempts,
    };
  }

  async completeJob(jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "done";
      job.lockedAt = null;
    }
  }

  async failJob(jobId: string, error: Error, attempts: number): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;

    const errorMsg = (error.message || "").toLowerCase();
    const status = (error as any).status;
    const isClientError = typeof status === "number" && status >= 400 && status < 500;
    const isNonRetryable =
      isClientError ||
      errorMsg.includes("scanned pdf") ||
      errorMsg.includes("unsupported_type") ||
      errorMsg.includes("file_too_large") ||
      errorMsg.includes("validation_error") ||
      errorMsg.includes("not_found") ||
      errorMsg.includes("does not match") ||
      errorMsg.includes("corrupted") ||
      errorMsg.includes("binary/null bytes") ||
      errorMsg.includes("empty") ||
      errorMsg.includes("no readable text") ||
      errorMsg.includes("no text chunks") ||
      errorMsg.includes("not found");

    if (attempts < this.maxAttempts && !isNonRetryable) {
      job.status = "queued";
      job.lockedAt = null;
      job.runAt = Date.now() + 5000;
    } else {
      job.status = "failed";
      job.lockedAt = null;
    }
  }

  async reclaimStaleJobs(staleThresholdMs = 5 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let reclaimed = 0;
    for (const job of this.jobs) {
      if (
        job.status === "processing" &&
        job.lockedAt &&
        now - job.lockedAt > staleThresholdMs
      ) {
        if (job.attempts < this.maxAttempts) {
          job.status = "queued";
          job.lockedAt = null;
          job.runAt = now;
          reclaimed++;
        } else {
          job.status = "failed";
          job.lockedAt = null;
          reclaimed++;
        }
      }
    }
    return reclaimed;
  }

  process(handler: (job: JobPayload) => Promise<void>): void {
    const worker = new JobWorker(this, handler);
    worker.start();
  }

  getJobs() {
    return this.jobs;
  }
}

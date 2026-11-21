export interface JobPayload {
  documentId: string;
}

export interface JobRecord {
  id: string;
  documentId: string;
  attempts: number;
}

export interface JobQueue {
  enqueue(job: JobPayload): Promise<void>;
  process(handler: (job: JobPayload) => Promise<void>): void;
  claimNextJob(): Promise<JobRecord | null>;
  completeJob(jobId: string): Promise<void>;
  failJob(jobId: string, error: Error, attempts: number): Promise<void>;
  reclaimStaleJobs(staleThresholdMs?: number): Promise<number>;
}

import { describe, expect, it } from "vitest";
import {
  getMimeFromFilename,
  validateUpload,
  validateFileSignature,
  MAX_FILE_SIZE_BYTES,
} from "../../src/services/ingestion/validation.js";
import { MemoryJobQueue } from "../../src/queue/index.js";
import { JobWorker } from "../../src/queue/pgQueue.js";
import { runIngestionPipeline } from "../../src/services/ingestion/pipeline.js";
import { FakeEmbedder } from "../../src/services/embedding/embedder.js";

describe("QA: Ingestion Pipeline and Processing Failures (Plan 13.2 & 14.4)", () => {
  describe("MIME and File Size Validation", () => {
    it("recognizes all three v1 supported MIME types from filename", () => {
      expect(getMimeFromFilename("report.pdf")).toBe("application/pdf");
      expect(getMimeFromFilename("paper.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      expect(getMimeFromFilename("notes.txt")).toBe("text/plain");
    });

    it("rejects unsupported extensions from filename", () => {
      expect(getMimeFromFilename("image.png")).toBeNull();
      expect(getMimeFromFilename("video.mp4")).toBeNull();
      expect(getMimeFromFilename("archive.zip")).toBeNull();
      expect(getMimeFromFilename("page.html")).toBeNull();
    });

    it("enforces 10 MB maximum file size limit via validateUpload", () => {
      const validBuffer = Buffer.from("Valid text document content for Contexta testing");
      const validFile = {
        originalname: "doc.txt",
        mimetype: "text/plain",
        size: validBuffer.length,
        buffer: validBuffer,
      };
      expect(() => validateUpload(validFile)).not.toThrow();

      // Exceeds 10MB
      const oversizedFile = {
        originalname: "large.txt",
        mimetype: "text/plain",
        size: MAX_FILE_SIZE_BYTES + 1,
        buffer: Buffer.from("x"),
      };
      expect(() => validateUpload(oversizedFile)).toThrowError(
        expect.objectContaining({
          code: "FILE_TOO_LARGE",
          status: 413,
        }),
      );
    });

    it("validates file signatures and rejects binary pretending to be text", () => {
      // Buffer containing null byte pretending to be text/plain
      const fakeText = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // 'Hel\0o'
      expect(() => validateFileSignature(fakeText, "text/plain")).toThrowError(
        expect.objectContaining({
          code: "UNSUPPORTED_TYPE",
          message: expect.stringContaining("contains binary/null bytes"),
        }),
      );
    });

    it("rejects invalid PDF header signatures", () => {
      const invalidPdfBuffer = Buffer.from("NOT_A_PDF_HEADER_CONTENT");
      expect(() => validateFileSignature(invalidPdfBuffer, "application/pdf")).toThrowError(
        expect.objectContaining({
          code: "UNSUPPORTED_TYPE",
          message: expect.stringContaining("header signature does not match %PDF"),
        }),
      );
    });
  });

  describe("Queue Worker Retry and Failure Semantics", () => {
    it("schedules retry 5000ms in future for transient errors and immediately fails fatal errors", async () => {
      const queue = new MemoryJobQueue(3);
      await queue.enqueue({ documentId: "doc-transient" });

      const worker = new JobWorker(queue, async () => {
        throw new Error("Temporary network timeout");
      });

      const handled = await worker.step();
      expect(handled).toBe(true);

      // Verify the job was rescheduled with runAt in the future (~5000ms)
      const rawJob = queue.getJobs()[0];
      expect(rawJob.status).toBe("queued");
      expect(rawJob.attempts).toBe(1);
      expect(rawJob.runAt).toBeGreaterThan(Date.now() + 1000);

      // Now test non-retryable error (e.g. Scanned PDF) fails immediately
      await queue.enqueue({ documentId: "doc-scanned-pdf" });
      const fatalWorker = new JobWorker(queue, async () => {
        throw new Error("Scanned PDF not supported yet (requires OCR)");
      });

      const fatalHandled = await fatalWorker.step();
      expect(fatalHandled).toBe(true);
      const fatalJob = queue.getJobs().find((j) => j.documentId === "doc-scanned-pdf");
      expect(fatalJob?.status).toBe("failed");
      expect(fatalJob?.attempts).toBe(1); // Failed without retrying
    });

    it("immediately completes successfully when handler succeeds", async () => {
      const queue = new MemoryJobQueue(3);
      await queue.enqueue({ documentId: "doc-success" });

      let processed = false;
      const worker = new JobWorker(queue, async (job) => {
        expect(job.documentId).toBe("doc-success");
        processed = true;
      });

      const handled = await worker.step();
      expect(handled).toBe(true);
      expect(processed).toBe(true);

      const next = await queue.claimNextJob();
      expect(next).toBeNull();
    });
  });

  describe("Ingestion Pipeline Failure Handling", () => {
    it("throws 404 NOT_FOUND when document does not exist in database", async () => {
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: async () => [],
          }),
        }),
      };

      await expect(
        runIngestionPipeline("non-existent-doc-uuid", {
          db: mockDb,
        }),
      ).rejects.toThrow(/Document not found/);
    });

    it("updates document status to 'failed' with error message when storage download fails", async () => {
      let updatedStatus = "";
      let updatedError = "";

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: async () => [
              {
                id: "doc-err-1",
                status: "queued",
                name: "test.txt",
                mime: "text/plain",
                storageKey: "bad-key",
              },
            ],
          }),
        }),
        update: () => ({
          set: (vals: any) => {
            if (vals.status) updatedStatus = vals.status;
            if (vals.error) updatedError = vals.error;
            return {
              where: async () => {},
            };
          },
        }),
      };

      const failingStorage: any = {
        download: async () => {
          throw new Error("Object storage bucket unreachable");
        },
      };

      await expect(
        runIngestionPipeline("doc-err-1", {
          db: mockDb,
          storage: failingStorage,
          embedder: new FakeEmbedder(768),
          skipSummary: true,
        }),
      ).rejects.toThrow("Object storage bucket unreachable");

      expect(updatedStatus).toBe("failed");
      expect(updatedError).toContain("Object storage bucket unreachable");
    });
  });
});

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LocalStorageService,
  MemoryStorageService,
  S3StorageService,
} from "../../src/services/storage.js";

describe("Storage Service", () => {
  describe("MemoryStorageService", () => {
    it("uploads and downloads files in memory", async () => {
      const storage = new MemoryStorageService();
      const buffer = Buffer.from("Test file content", "utf-8");
      const key = "test/doc1.txt";

      await storage.upload(key, buffer, "text/plain");

      expect(await storage.exists(key)).toBe(true);
      const downloaded = await storage.download(key);
      expect(downloaded.toString("utf-8")).toBe("Test file content");

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
      await expect(storage.download(key)).rejects.toThrowError(/not found/);
    });
  });

  describe("LocalStorageService", () => {
    const testDir = "./tmp-test-storage";

    it("uploads and downloads files from the local filesystem", async () => {
      const storage = new LocalStorageService(testDir);
      const buffer = Buffer.from("Filesystem test payload", "utf-8");
      const key = "users/1/docs/file.txt";

      await storage.upload(key, buffer, "text/plain");
      expect(await storage.exists(key)).toBe(true);

      const downloaded = await storage.download(key);
      expect(downloaded.toString("utf-8")).toBe("Filesystem test payload");

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);

      // Clean up test dir
      await fs.rm(path.resolve(testDir), { recursive: true, force: true }).catch(() => {});
    });

    it("prevents path traversal attacks", async () => {
      const storage = new LocalStorageService(testDir);
      const maliciousKey = "subfolder/../../outside-sandbox.txt";
      await expect(
        storage.upload(maliciousKey, Buffer.from("attack"), "text/plain"),
      ).rejects.toThrowError(/Path traversal detected/);
    });
  });

  describe("S3StorageService", () => {
    it("generates valid AWS SigV4 signed authorization headers for S3/R2 requests", async () => {
      const s3 = new S3StorageService({
        endpoint: "https://example.r2.cloudflarestorage.com",
        accessKeyId: "mock-r2-key-id",
        secretAccessKey: "mock-r2-secret-key-1234567890",
        bucket: "test-bucket",
      });

      const signed = s3.signHeaders(
        "PUT",
        "https://example.r2.cloudflarestorage.com/test-bucket/docs/test.txt",
        { "content-type": "text/plain" },
        Buffer.from("payload"),
      );

      expect(signed.authorization).toBeDefined();
      expect(signed.authorization).toContain("AWS4-HMAC-SHA256");
      expect(signed.authorization).toContain("Credential=mock-r2-key-id/");
      expect(signed.authorization).toContain("SignedHeaders=");
      expect(signed.authorization).toContain("Signature=");
      expect(signed["x-amz-date"]).toBeDefined();
      expect(signed["x-amz-content-sha256"]).toBeDefined();
    });

    it("handles uppercase and mixed-case header keys without throwing", () => {
      const s3 = new S3StorageService({
        endpoint: "https://example.r2.cloudflarestorage.com/",
        accessKeyId: "mock-r2-key-id",
        secretAccessKey: "mock-r2-secret-key-1234567890",
        bucket: "/test-bucket/",
      });

      // Pass uppercase and camelCase headers that previously triggered undefined.trim() crash
      const signed = s3.signHeaders(
        "PUT",
        "https://example.r2.cloudflarestorage.com/test-bucket/docs/test.txt",
        {
          "Content-Type": "application/pdf",
          "X-Custom-Header": "CustomValue",
          Authorization: "Bearer token",
        },
        Buffer.from("payload"),
      );

      expect(signed.authorization).toBeDefined();
      expect(signed["content-type"]).toBe("application/pdf");
      expect(signed["x-custom-header"]).toBe("CustomValue");
    });

    it("executes upload, download, and exists over S3 with fetch", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (opts?.method === "PUT") {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        if (opts?.method === "HEAD") {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        return Promise.resolve(new Response("s3-file-bytes", { status: 200 }));
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        const s3 = new S3StorageService({
          endpoint: "https://example.r2.cloudflarestorage.com",
          accessKeyId: "mock-r2-key",
          secretAccessKey: "mock-r2-secret",
          bucket: "docs",
        });

        const key = await s3.upload("doc.txt", Buffer.from("content"), "text/plain");
        expect(key).toBe("doc.txt");
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("doc.txt"),
          expect.objectContaining({ method: "PUT" }),
        );

        const data = await s3.download("doc.txt");
        expect(data.toString()).toBe("s3-file-bytes");

        const exists = await s3.exists("doc.txt");
        expect(exists).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

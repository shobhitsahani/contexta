import { ContextaError } from "@contexta/shared";
import { desc, eq } from "drizzle-orm";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { db as defaultDb } from "../../db/client.js";
import {
  chunks as chunksTable,
  documents as documentsTable,
  documentSummaries,
} from "../../db/schema.js";
import type { Embedder } from "../../services/embedding/embedder.js";
import {
  MAX_DOCUMENTS_PER_USER,
  MAX_FILE_SIZE_BYTES,
  validateUpload,
} from "../../services/ingestion/validation.js";
import {
  generateAndStoreSummary,
  getStoredSummary,
} from "../../services/ingestion/summary.js";
import { parseDocument } from "../../services/ingestion/parse.js";
import { getStorageService, type StorageService } from "../../services/storage.js";
import type { JobQueue } from "../../queue/queue.js";
import { PgQueue } from "../../queue/pgQueue.js";
import type { LLMProvider } from "../../services/llm/index.js";

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
});

function handleUploadFile(req: Request, res: Response, next: NextFunction): void {
  uploadMiddleware.single("file")(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: {
            code: "FILE_TOO_LARGE",
            message: "File exceeds 10 MB limit",
          },
        });
        return;
      }
      if (err instanceof multer.MulterError) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: err.message || "File upload failed",
          },
        });
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

export interface DocumentsDeps {
  db?: any;
  storage?: StorageService;
  queue?: JobQueue;
  embedder?: Embedder;
  llm?: LLMProvider;
}

export function createDocumentsRouter(deps: DocumentsDeps = {}): Router {
  const router = Router();
  const db = deps.db ?? defaultDb;
  const storage = deps.storage ?? getStorageService();
  const queue = deps.queue ?? new PgQueue(db);

  function getUserId(req: Request): string | null {
    // Better Auth session, custom header for testing/internal, or null
    return (
      (req as any).user?.id ||
      (req.headers["x-user-id"] as string) ||
      null
    );
  }

  // ── POST /documents — Upload document ──
  router.post(
    "/",
    handleUploadFile,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const file = req.file;
        if (!file) {
          throw new ContextaError({
            code: "VALIDATION_ERROR",
            message: "No file was provided in the upload",
            status: 400,
          });
        }

        const userId = getUserId(req);
        const isDemo = req.body?.isDemo === "true" || req.body?.isDemo === true;

        // Anonymous users can never upload documents (plan.md 15.3: "No uploads ... for anonymous users")
        if (!userId) {
          throw new ContextaError({
            code: "UNAUTHORIZED",
            message: "Authentication required to upload documents",
            status: 401,
          });
        }

        // Check document count limit for authenticated users (plan.md 14.4)
        if (!isDemo) {
          const userDocs = await db
            .select()
            .from(documentsTable)
            .where(eq(documentsTable.userId, userId));

          if (userDocs.length >= MAX_DOCUMENTS_PER_USER) {
            throw new ContextaError({
              code: "VALIDATION_ERROR",
              message: `Maximum limit of ${MAX_DOCUMENTS_PER_USER} documents reached`,
              status: 400,
            });
          }
        }

        // Validate file type, size, and magic bytes
        const { mime } = validateUpload({
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        });

        const docId = uuid();
        const storageKey = `documents/${docId}/${file.originalname}`;

        try {
          // Upload original file to Object Storage
          await storage.upload(storageKey, file.buffer, mime);

          // Create document record in database
          await db.insert(documentsTable).values({
            id: docId,
            userId: isDemo ? null : userId,
            name: file.originalname,
            mime,
            sizeBytes: file.size,
            storageKey,
            status: "queued",
            summaryStatus: "pending",
            isDemo,
          });

          // Enqueue background ingestion job
          await queue.enqueue({ documentId: docId });
        } catch (innerErr) {
          await storage.delete(storageKey).catch(() => {});
          throw innerErr;
        }

        return res.status(201).json({
          id: docId,
          status: "queued",
        });
      } catch (err: any) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: {
              code: "FILE_TOO_LARGE",
              message: "File exceeds 10 MB limit",
            },
          });
        }
        if (err instanceof ContextaError) {
          return res.status(err.status).json({
            error: {
              code: err.code,
              message: err.message,
            },
          });
        }
        next(err);
      }
    },
  );

  // ── GET /documents — List user documents ──
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);

      let rows: any[];
      if (userId) {
        rows = await db
          .select()
          .from(documentsTable)
          .where(eq(documentsTable.userId, userId))
          .orderBy(desc(documentsTable.createdAt));
      } else {
        // Unauthenticated can only list demo docs
        rows = await db
          .select()
          .from(documentsTable)
          .where(eq(documentsTable.isDemo, true))
          .orderBy(desc(documentsTable.createdAt));
      }

      return res.json(
        rows.map((doc) => ({
          id: doc.id,
          userId: doc.userId,
          name: doc.name,
          mime: doc.mime,
          sizeBytes: doc.sizeBytes,
          status: doc.status,
          error: doc.error,
          pageCount: doc.pageCount,
          isDemo: doc.isDemo,
          summaryStatus: doc.summaryStatus,
          createdAt: doc.createdAt?.toISOString?.() ?? doc.createdAt,
        })),
      );
    } catch (err) {
      next(err);
    }
  });

  // ── GET /documents/:id — Get document status / details ──
  router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docId = String(req.params.id);
      const userId = getUserId(req);

      const rows = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, docId));

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Document not found",
          },
        });
      }

      const doc = rows[0];

      // Scoped check: demo documents are public, private docs require owner (plan.md 13.5 & 15.3)
      if (!doc.isDemo) {
        if (!userId || doc.userId !== userId) {
          return res.status(404).json({
            error: {
              code: "NOT_FOUND",
              message: "Document not found",
            },
          });
        }
      }

      const isoCreatedAt =
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : (doc.createdAt?.toISOString?.() ?? String(doc.createdAt || new Date().toISOString()));

      return res.json({
        id: doc.id,
        userId: doc.userId,
        name: doc.name,
        mime: doc.mime,
        sizeBytes: doc.sizeBytes,
        status: doc.status,
        error: doc.error,
        pageCount: doc.pageCount,
        isDemo: doc.isDemo,
        summaryStatus: doc.summaryStatus,
        createdAt: isoCreatedAt,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── DELETE /documents/:id — Delete document ──
  router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docId = String(req.params.id);
      const userId = getUserId(req);

      const rows = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, docId));

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Document not found",
          },
        });
      }

      const doc = rows[0];

      if (doc.isDemo) {
        return res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Demo documents cannot be deleted",
          },
        });
      }

      if (!userId || doc.userId !== userId) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Document not found",
          },
        });
      }

      // Remove from object storage
      await storage.delete(doc.storageKey);

      // Remove chunks and summaries
      await db.delete(chunksTable).where(eq(chunksTable.documentId, docId));
      await db.delete(documentSummaries).where(eq(documentSummaries.documentId, docId));

      // Remove document record
      await db.delete(documentsTable).where(eq(documentsTable.id, docId));

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ── GET /documents/:id/summary — Get document summary ──
  router.get("/:id/summary", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docId = String(req.params.id);
      const userId = getUserId(req);

      const rows = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, docId));

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Document not found",
          },
        });
      }

      const doc = rows[0];
      if (!doc.isDemo) {
        if (!userId || doc.userId !== userId) {
          return res.status(404).json({
            error: {
              code: "NOT_FOUND",
              message: "Document not found",
            },
          });
        }
      }

      const summary = await getStoredSummary(docId, db);

      if (!summary) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Document summary not found or not yet generated",
          },
        });
      }

      return res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  // ── POST /documents/:id/summary — Trigger on-demand document summary ──
  router.post("/:id/summary", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docId = String(req.params.id);
      const userId = getUserId(req);

      const rows = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, docId));

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Document not found",
          },
        });
      }

      const doc = rows[0];
      if (!doc.isDemo) {
        if (!userId || doc.userId !== userId) {
          return res.status(404).json({
            error: {
              code: "NOT_FOUND",
              message: "Document not found",
            },
          });
        }
      }

      if (doc.status !== "ready") {
        return res.status(400).json({
          error: {
            code: "DOCUMENT_NOT_READY",
            message: "Document must be in ready status before summarizing",
          },
        });
      }

      // If already ready, return stored summary
      if (doc.summaryStatus === "ready") {
        const stored = await getStoredSummary(docId, db);
        if (stored) {
          return res.json(stored);
        }
      }

      // Generate lazily using storage file
      const fileBuffer = await storage.download(doc.storageKey);
      const parsedDoc = await parseDocument(fileBuffer, doc.mime as any);
      const summary = await generateAndStoreSummary(docId, parsedDoc, db, deps.llm);

      if (!summary) {
        return res.status(500).json({
          error: {
            code: "INGESTION_FAILED",
            message: "Failed to generate document summary",
          },
        });
      }

      return res.json(summary);
    } catch (err: any) {
      if (err instanceof ContextaError) {
        return res.status(err.status).json({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }
      next(err);
    }
  });

  return router;
}

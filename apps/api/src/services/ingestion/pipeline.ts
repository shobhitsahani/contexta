import { ContextaError } from "@contexta/shared";
import { eq, sql } from "drizzle-orm";
import { db as defaultDb } from "../../db/client.js";
import { chunks as chunksTable, documents } from "../../db/schema.js";
import type { Embedder } from "../embedding/embedder.js";
import type { LLMProvider } from "../llm/index.js";
import { getStorageService, type StorageService } from "../storage.js";
import { chunkDocument, type Chunk } from "./chunk.js";
import { GeminiEmbedder, MAX_EMBEDDING_BATCH_SIZE } from "./embed.js";
import { parseDocument, type ParsedDocument } from "./parse.js";
import { generateAndStoreSummary } from "./summary.js";
import type { SupportedMimeType } from "./validation.js";

export interface PipelineOptions {
  db?: any;
  storage?: StorageService;
  embedder?: Embedder;
  llm?: LLMProvider;
  skipSummary?: boolean;
}

export interface IngestionResult {
  documentId: string;
  pageCount: number;
  chunkCount: number;
  status: "ready" | "failed";
}

/**
 * Complete document ingestion pipeline.
 *
 * Steps:
 * 1. Fetch document record (verify existence and current status).
 * 2. Update status -> 'parsing'.
 * 3. Download original file from Object Storage.
 * 4. Parse document by MIME type (PDF, DOCX, TXT) and extract pages.
 * 5. Update document page_count.
 * 6. Chunk text with heading/paragraph awareness (~600 tokens, 80 overlap).
 * 7. Update status -> 'embedding'.
 * 8. Clean up any previous partial chunks (resumable safety).
 * 9. Generate embeddings and persist chunks in batches to PostgreSQL/pgvector.
 * 10. Update status -> 'ready'.
 * 11. Generate whole-document summary (plan.md section 20).
 */
export async function runIngestionPipeline(
  documentId: string,
  options: PipelineOptions = {},
): Promise<IngestionResult> {
  const db = options.db ?? defaultDb;
  const storage = options.storage ?? getStorageService();
  const embedder = options.embedder ?? new GeminiEmbedder();

  // 1. Fetch document record
  const docRows = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));

  if (!docRows || docRows.length === 0) {
    throw new ContextaError({
      code: "NOT_FOUND",
      message: `Document not found: ${documentId}`,
      status: 404,
    });
  }

  const document = docRows[0];

  // If already ready, return (idempotent / already processed)
  if (document.status === "ready") {
    const existingChunks = await db
      .select({ count: sql<number>`count(*)` })
      .from(chunksTable)
      .where(eq(chunksTable.documentId, documentId));

    return {
      documentId,
      pageCount: document.pageCount ?? 1,
      chunkCount: Number(existingChunks[0]?.count ?? 0),
      status: "ready",
    };
  }

  try {
    // 2. Update status -> 'parsing'
    await db
      .update(documents)
      .set({ status: "parsing", error: null })
      .where(eq(documents.id, documentId));

    // 3. Download original file from Object Storage
    const fileBuffer = await storage.download(document.storageKey);

    // 4. Parse document
    const parsedDoc: ParsedDocument = await parseDocument(
      fileBuffer,
      document.mime as SupportedMimeType,
    );

    // 5. Update page count
    await db
      .update(documents)
      .set({ pageCount: parsedDoc.pageCount })
      .where(eq(documents.id, documentId));

    // 6. Chunk text
    const chunks: Chunk[] = chunkDocument(parsedDoc.pages);
    if (chunks.length === 0) {
      throw new ContextaError({
        code: "INGESTION_FAILED",
        message: "Document produced no text chunks",
        status: 400,
      });
    }

    // 7. Update status -> 'embedding'
    await db
      .update(documents)
      .set({ status: "embedding" })
      .where(eq(documents.id, documentId));

    // 8. Resumable progress per chunk batch (plan.md 17.2 & 17.5):
    // Retrieve already persisted chunks for this document so we don't re-embed them.
    const existingChunkRows = await db
      .select({ chunkIndex: chunksTable.chunkIndex })
      .from(chunksTable)
      .where(eq(chunksTable.documentId, documentId));

    const existingIndices = new Set<number>(
      (existingChunkRows || [])
        .map((r: any) => r.chunkIndex)
        .filter((idx: any): idx is number => typeof idx === "number"),
    );

    // If chunk sequence length changed on reparse, clean up stale high indices
    if (existingIndices.size > chunks.length) {
      await db
        .delete(chunksTable)
        .where(
          sql`${chunksTable.documentId} = ${documentId} AND ${chunksTable.chunkIndex} >= ${chunks.length}`,
        );
      for (const idx of Array.from(existingIndices)) {
        if (idx >= chunks.length) existingIndices.delete(idx);
      }
    }

    // 9. Embed in batches and insert chunks (only missing chunks)
    for (let i = 0; i < chunks.length; i += MAX_EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + MAX_EMBEDDING_BATCH_SIZE);
      const missingInBatch = batch.filter((c) => !existingIndices.has(c.chunkIndex));

      if (missingInBatch.length > 0) {
        const texts = missingInBatch.map((c) => c.content);

        // Generate 768-dim embeddings
        const embeddings = await embedder.embedBatch(texts);

        // Insert chunk batch
        await db.insert(chunksTable).values(
          missingInBatch.map((chunk, idx) => ({
            documentId,
            userId: document.userId,
            chunkIndex: chunk.chunkIndex,
            page: chunk.page,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            embedding: embeddings[idx],
          })),
        );

        for (const c of missingInBatch) {
          existingIndices.add(c.chunkIndex);
        }
      }
    }

    // 10. Update status -> 'ready'
    await db
      .update(documents)
      .set({
        status: "ready",
        error: null,
      })
      .where(eq(documents.id, documentId));

    // 11. Document summary generation (plan.md section 20)
    if (!options.skipSummary) {
      await generateAndStoreSummary(
        documentId,
        parsedDoc,
        db,
        options.llm,
      );
    }

    return {
      documentId,
      pageCount: parsedDoc.pageCount,
      chunkCount: chunks.length,
      status: "ready",
    };
  } catch (err: any) {
    const errorMsg = (err?.message || "Ingestion failed").slice(0, 1000);

    // Update document status -> 'failed'
    await db
      .update(documents)
      .set({
        status: "failed",
        error: errorMsg,
      })
      .where(eq(documents.id, documentId));

    throw err;
  }
}

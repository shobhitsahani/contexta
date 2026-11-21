import { ContextaError } from "@contexta/shared";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { MAX_PAGE_COUNT, type SupportedMimeType } from "./validation.js";

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedDocument {
  pages: ParsedPage[];
  pageCount: number;
  totalText: string;
}

export const PARSE_TIMEOUT_MS = 30_000; // 30s timeout to protect free host memory/CPU (plan.md 17.2)

/**
 * Guard parsing promises with an execution timeout.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new ContextaError({
          code: "INGESTION_FAILED",
          message: timeoutMessage,
          status: 408,
        }),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Parse PDF document buffer into per-page text.
 * Rejects scanned/empty PDFs and files exceeding the page limit.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  return withTimeout(
    (async () => {
      let parser: PDFParse | null = null;
      try {
        parser = new PDFParse({ data: buffer });
        const result = await parser.getText();

        const rawPages = result.pages || [];
        const totalPages = Math.max(result.total || 0, rawPages.length);

        if (totalPages > MAX_PAGE_COUNT) {
          throw new ContextaError({
            code: "FILE_TOO_LARGE",
            message: `Document exceeds maximum ${MAX_PAGE_COUNT} pages limit (got ${totalPages} pages)`,
            status: 413,
          });
        }

        const pages: ParsedPage[] = rawPages.map((p, idx) => ({
          pageNumber: p.num ?? idx + 1,
          text: (p.text || "").trim(),
        }));

        // If no pages were returned by result.pages, but result.text exists
        if (pages.length === 0 && result.text) {
          pages.push({
            pageNumber: 1,
            text: result.text.trim(),
          });
        }

        const totalText = pages.map((p) => p.text).join("\n\n").trim();

        // Check for scanned PDF (near-empty text content)
        // plan.md 14.4: "if total text is near empty, fail with 'scanned PDF not supported yet'"
        const cleanedText = totalText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "").trim();
        const meaningfulCharCount = cleanedText.replace(/\s+/g, "").length;
        if (meaningfulCharCount < 20) {
          throw new ContextaError({
            code: "INGESTION_FAILED",
            message: "scanned PDF not supported yet",
            status: 400,
          });
        }

        return {
          pages,
          pageCount: Math.max(totalPages, pages.length),
          totalText,
        };
      } catch (err: any) {
        if (err instanceof ContextaError) {
          throw err;
        }
        // Check if error is due to PDF corruption or scanned status
        const msg = (err?.message || "").toLowerCase();
        if (msg.includes("scanned") || msg.includes("empty")) {
          throw new ContextaError({
            code: "INGESTION_FAILED",
            message: "scanned PDF not supported yet",
            status: 400,
          });
        }
        throw new ContextaError({
          code: "INGESTION_FAILED",
          message: `Failed to parse PDF document: ${err.message || "Unknown error"}`,
          status: 400,
        });
      } finally {
        if (parser) {
          try {
            await parser.destroy();
          } catch {
            // ignore destroy error
          }
        }
      }
    })(),
    PARSE_TIMEOUT_MS,
    "PDF parsing timed out after 30 seconds",
  );
}

/**
 * Parse DOCX document buffer using mammoth.
 * Retains heading structure in markdown format for chunking.
 * Uses sequential extraction to halve peak memory consumption on 512 MB instances.
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  return withTimeout(
    (async () => {
      try {
        let text = "";
        try {
          const markdownResult = await (mammoth as any).convertToMarkdown({ buffer });
          text = (markdownResult?.value || "").trim();
        } catch {
          // Markdown conversion failed; proceed to raw text fallback
        }

        if (!text) {
          const rawResult = await mammoth.extractRawText({ buffer });
          text = (rawResult?.value || "").trim();
        }

        const meaningfulCharCount = text.replace(/\s+/g, "").length;

        if (meaningfulCharCount < 5) {
          throw new ContextaError({
            code: "INGESTION_FAILED",
            message: "DOCX file is empty or contains no readable text",
            status: 400,
          });
        }

        return {
          pages: [{ pageNumber: 1, text }],
          pageCount: 1,
          totalText: text,
        };
      } catch (err: any) {
        if (err instanceof ContextaError) {
          throw err;
        }
        throw new ContextaError({
          code: "INGESTION_FAILED",
          message: `Failed to parse DOCX document: ${err.message || "Invalid or corrupted file"}`,
          status: 400,
        });
      }
    })(),
    PARSE_TIMEOUT_MS,
    "DOCX parsing timed out after 30 seconds",
  );
}

/**
 * Parse plain text buffer as UTF-8.
 */
export async function parseTxt(buffer: Buffer): Promise<ParsedDocument> {
  return withTimeout(
    (async () => {
      const text = buffer.toString("utf-8").replace(/^\uFEFF/, "").trim();
      const meaningfulCharCount = text.replace(/\s+/g, "").length;

      if (meaningfulCharCount === 0) {
        throw new ContextaError({
          code: "INGESTION_FAILED",
          message: "Text file is empty",
          status: 400,
        });
      }

      return {
        pages: [{ pageNumber: 1, text }],
        pageCount: 1,
        totalText: text,
      };
    })(),
    PARSE_TIMEOUT_MS,
    "TXT parsing timed out after 30 seconds",
  );
}

/**
 * Parse file buffer based on MIME type.
 */
export async function parseDocument(
  buffer: Buffer,
  mime: SupportedMimeType,
): Promise<ParsedDocument> {
  switch (mime) {
    case "application/pdf":
      return parsePdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return parseDocx(buffer);
    case "text/plain":
      return parseTxt(buffer);
    default:
      throw new ContextaError({
        code: "UNSUPPORTED_TYPE",
        message: `Unsupported MIME type: ${mime}`,
        status: 415,
      });
  }
}

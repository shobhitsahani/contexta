import {
  type DocumentSummary,
  DocumentSummarySchema,
} from "@contexta/shared";
import { eq } from "drizzle-orm";
import { getEnv } from "../../config/env.js";
import { db as defaultDb } from "../../db/client.js";
import { documents, documentSummaries } from "../../db/schema.js";
import { getProvider, type LLMProvider } from "../llm/index.js";
import type { ParsedDocument } from "./parse.js";

const SUMMARY_SYSTEM_PROMPT = `You are Contexta's document summarization engine.
Analyze the provided document text and produce a comprehensive, structured JSON summary.

You MUST respond with valid JSON adhering exactly to this schema:
{
  "overview": "A thorough 2-4 paragraph overview explaining what the document is about, its main thesis, scope, and conclusions.",
  "keyPoints": [
    "5 to 10 distinct, substantive key takeaways or core findings from the document."
  ],
  "sections": [
    {
      "title": "Title of section or topic",
      "pageStart": 1,
      "pageEnd": 2,
      "summary": "2-3 sentence summary of what this section covers."
    }
  ]
}

Do not include any text outside the JSON object. Output raw JSON only.`;

function sanitizeJsonString(str: string): string {
  // Strip trailing commas before closing braces and brackets
  return str.replace(/,\s*([\]}])/g, "$1");
}

export function extractJsonFromLlmOutput(output: string): any {
  const trimmed = output.trim();

  // 1. Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(sanitizeJsonString(trimmed));
    } catch {
      // Continue to next strategy
    }
  }

  // 2. Try markdown code block: ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    const blockContent = codeBlockMatch[1].trim();
    try {
      return JSON.parse(blockContent);
    } catch {
      try {
        return JSON.parse(sanitizeJsonString(blockContent));
      } catch {
        // Continue to next strategy
      }
    }
  }

  // 3. Try finding outermost { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(sanitizeJsonString(candidate));
      } catch {
        // Fall through to error
      }
    }
  }

  throw new Error("Could not extract valid JSON from LLM summary response");
}

/**
 * Generate a structured summary for a document and persist it in document_summaries.
 * Does not throw on LLM failure — marks summary_status as 'failed' or 'pending'
 * while allowing the document itself to remain 'ready'.
 */
export async function generateAndStoreSummary(
  documentId: string,
  parsedDoc: ParsedDocument,
  customDb?: any,
  customLlm?: LLMProvider,
): Promise<DocumentSummary | null> {
  const db = customDb ?? defaultDb;
  const env = getEnv();

  // Mark status as 'pending'
  await db
    .update(documents)
    .set({ summaryStatus: "pending" })
    .where(eq(documents.id, documentId));

  try {
    let llm: LLMProvider;
    if (customLlm) {
      llm = customLlm;
    } else {
      try {
        llm = getProvider(env.FREE_CHAT_PROVIDER);
      } catch {
        llm = getProvider("gemini");
      }
    }

    // Limit full text if extremely large (context window protection)
    const maxChars = 200_000;
    const documentText =
      parsedDoc.totalText.length > maxChars
        ? parsedDoc.totalText.slice(0, maxChars) + "\n\n[... truncated for length ...]"
        : parsedDoc.totalText;

    const stream = llm.stream({
      model: env.FREE_CHAT_MODEL,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Document page count: ${parsedDoc.pageCount}\n\nDocument Text:\n${documentText}`,
        },
      ],
      apiKey: env.FREE_CHAT_API_KEY,
    });

    let fullOutput = "";
    for await (const chunk of stream) {
      if (chunk.text) {
        fullOutput += chunk.text;
      }
    }

    // Parse JSON with multi-strategy extractor
    const rawParsed = extractJsonFromLlmOutput(fullOutput);

    // Normalize potential model idiosyncrasies (e.g., stringified page numbers or missing arrays)
    const normalizedJson = {
      overview:
        typeof rawParsed?.overview === "string" && rawParsed.overview.trim().length > 0
          ? rawParsed.overview.trim()
          : "Overview of document contents and key concepts.",
      keyPoints:
        Array.isArray(rawParsed?.keyPoints) && rawParsed.keyPoints.length > 0
          ? rawParsed.keyPoints
              .filter((k: any) => typeof k === "string" && k.trim().length > 0)
              .map((k: any) => k.trim())
          : ["Document contains structured text and sections."],
      sections: Array.isArray(rawParsed?.sections)
        ? rawParsed.sections.map((sec: any) => ({
            title: String(sec.title || "Section").trim() || "Section",
            pageStart: typeof sec.pageStart === "string" ? parseInt(sec.pageStart, 10) || null : sec.pageStart ?? null,
            pageEnd: typeof sec.pageEnd === "string" ? parseInt(sec.pageEnd, 10) || null : sec.pageEnd ?? null,
            summary: String(sec.summary || "Summary of section contents.").trim() || "Summary of section contents.",
          }))
        : [],
    };

    const summary = DocumentSummarySchema.parse(normalizedJson);

    // Clean up any existing summaries for this document
    await db
      .delete(documentSummaries)
      .where(eq(documentSummaries.documentId, documentId));

    // Store Level 0 (Overview + Key Points)
    await db.insert(documentSummaries).values({
      documentId,
      level: 0,
      ordinal: 0,
      title: "Overview",
      pageStart: 1,
      pageEnd: parsedDoc.pageCount,
      text: JSON.stringify({
        overview: summary.overview,
        keyPoints: summary.keyPoints,
      }),
    });

    // Store Level 1 (Sections)
    if (summary.sections && summary.sections.length > 0) {
      await db.insert(documentSummaries).values(
        summary.sections.map((section: any, idx: number) => ({
          documentId,
          level: 1,
          ordinal: idx,
          title: section.title,
          pageStart: section.pageStart ?? 1,
          pageEnd: section.pageEnd ?? section.pageStart ?? 1,
          text: section.summary,
        })),
      );
    }

    // Update document summary status to ready
    await db
      .update(documents)
      .set({ summaryStatus: "ready" })
      .where(eq(documents.id, documentId));

    return summary;
  } catch {
    // Non-fatal for document ingestion; mark summary_status as failed
    await db
      .update(documents)
      .set({ summaryStatus: "failed" })
      .where(eq(documents.id, documentId));
    return null;
  }
}

/**
 * Retrieve stored summary for a document from the database.
 */
export async function getStoredSummary(
  documentId: string,
  customDb?: any,
): Promise<DocumentSummary | null> {
  const db = customDb ?? defaultDb;

  const rows: any[] = await db
    .select()
    .from(documentSummaries)
    .where(eq(documentSummaries.documentId, documentId));

  if (!rows || rows.length === 0) {
    return null;
  }

  const level0 = rows.find((r) => r.level === 0);
  if (!level0) {
    return null;
  }

  let overview: string;
  let keyPoints: string[];

  try {
    const parsedLevel0 = JSON.parse(level0.text);
    overview = parsedLevel0.overview || level0.text;
    keyPoints = parsedLevel0.keyPoints || [];
  } catch {
    overview = level0.text;
    keyPoints = [];
  }

  const sectionRows = rows
    .filter((r) => r.level === 1)
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

  const sections = sectionRows.map((r) => ({
    title: r.title,
    pageStart: r.pageStart,
    pageEnd: r.pageEnd,
    summary: r.text,
  }));

  return {
    overview,
    keyPoints,
    sections,
  };
}

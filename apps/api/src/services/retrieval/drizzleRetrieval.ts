import { sql, and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { chunks, documents, documentSummaries } from '../../db/schema.js';
import type { RetrievalDB, SearchHit, SummaryDB } from './search.js';

export function createDrizzleRetrievalDB(db: Db): RetrievalDB {
  return {
    async vectorSearch(
      userId: string,
      documentIds: string[],
      queryVec: number[],
      limit: number,
    ): Promise<SearchHit[]> {
      if (documentIds.length === 0 || queryVec.length === 0 || limit <= 0) return [];

      const vectorStr = `[${queryVec.join(',')}]`;

      const rows = await db
        .select({
          chunkId: chunks.id,
          documentId: chunks.documentId,
          documentName: documents.name,
          page: chunks.page,
          content: chunks.content,
          score: sql<number>`1 - (${chunks.embedding} <=> ${vectorStr}::vector)`,
        })
        .from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .where(
          and(
            inArray(chunks.documentId, documentIds),
            or(eq(chunks.userId, userId), eq(documents.userId, userId), eq(documents.isDemo, true)),
          ),
        )
        .orderBy(sql`${chunks.embedding} <=> ${vectorStr}::vector`)
        .limit(limit);

      return rows.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentName: r.documentName,
        page: r.page,
        content: r.content,
        score: Number(r.score) || 0,
      }));
    },

    async fullTextSearch(
      userId: string,
      documentIds: string[],
      queryText: string,
      limit: number,
    ): Promise<SearchHit[]> {
      if (documentIds.length === 0 || !queryText.trim() || limit <= 0) return [];

      const rows = await db
        .select({
          chunkId: chunks.id,
          documentId: chunks.documentId,
          documentName: documents.name,
          page: chunks.page,
          content: chunks.content,
          score: sql<number>`ts_rank(to_tsvector('english', ${chunks.content}), plainto_tsquery('english', ${queryText}))`,
        })
        .from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .where(
          and(
            inArray(chunks.documentId, documentIds),
            or(eq(chunks.userId, userId), eq(documents.userId, userId), eq(documents.isDemo, true)),
            sql`to_tsvector('english', ${chunks.content}) @@ plainto_tsquery('english', ${queryText})`,
          ),
        )
        .orderBy(sql`ts_rank(to_tsvector('english', ${chunks.content}), plainto_tsquery('english', ${queryText})) DESC`)
        .limit(limit);

      return rows.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentName: r.documentName,
        page: r.page,
        content: r.content,
        score: Number(r.score) || 0,
      }));
    },
  };
}

export function createDrizzleSummaryDB(db: Db): SummaryDB {
  return {
    async getDocumentSummary(documentId: string, userId: string) {
      const rows = await db
        .select({
          level: documentSummaries.level,
          ordinal: documentSummaries.ordinal,
          title: documentSummaries.title,
          pageStart: documentSummaries.pageStart,
          pageEnd: documentSummaries.pageEnd,
          text: documentSummaries.text,
        })
        .from(documentSummaries)
        .innerJoin(documents, eq(documentSummaries.documentId, documents.id))
        .where(
          and(
            eq(documentSummaries.documentId, documentId),
            or(eq(documents.userId, userId), eq(documents.isDemo, true)),
          ),
        )
        .orderBy(documentSummaries.level, documentSummaries.ordinal);

      if (rows.length === 0) return null;

      const wholeDoc = rows.find((r) => r.level === 0);
      const sectionRows = rows.filter((r) => r.level === 1);

      let keyPoints: string[] = [];
      let overview = wholeDoc ? wholeDoc.text : '';

      if (wholeDoc) {
        try {
          const parsed = JSON.parse(wholeDoc.text);
          if (typeof parsed.overview === 'string') overview = parsed.overview;
          if (Array.isArray(parsed.keyPoints)) keyPoints = parsed.keyPoints;
        } catch {
          const lines = wholeDoc.text.split('\n');
          const bullets = lines.filter((l) => l.trim().startsWith('- ') || l.trim().startsWith('* '));
          if (bullets.length > 0) {
            keyPoints = bullets.map((b) => b.trim().replace(/^[-*]\s+/, ''));
          }
        }
      }

      return {
        overview,
        keyPoints,
        sections: sectionRows.map((s) => ({
          title: s.title,
          pageStart: s.pageStart ?? 1,
          pageEnd: s.pageEnd ?? 1,
          summary: s.text,
        })),
      };
    },
  };
}

/**
 * Retrieval service: vector search, full-text search, and hybrid (RRF).
 *
 * All queries are scoped by userId to prevent cross-user data leaks.
 */

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentName: string;
  page: number;
  content: string;
  score: number;
}

export interface SearchOptions {
  userId: string;
  documentIds: string[];
  queryVec: number[];
  queryText: string;
  topK: number;
  scoreThreshold: number;
  hybridSearch: boolean;
}

/** Database interface for retrieval queries. Abstracted for testing. */
export interface RetrievalDB {
  vectorSearch(
    userId: string,
    documentIds: string[],
    queryVec: number[],
    limit: number,
  ): Promise<SearchHit[]>;

  fullTextSearch(
    userId: string,
    documentIds: string[],
    queryText: string,
    limit: number,
  ): Promise<SearchHit[]>;
}

/**
 * Reciprocal Rank Fusion (RRF) to combine two ranked lists.
 * RRF(d) = sum(1 / (k + rank_i(d))) for each ranking that includes d.
 * k=60 is the standard constant.
 */
export function reciprocalRankFusion(
  vectorHits: SearchHit[],
  textHits: SearchHit[],
  topK: number,
  k = 60,
): SearchHit[] {
  const scores = new Map<string, { hit: SearchHit; score: number }>();

  for (let i = 0; i < vectorHits.length; i++) {
    const hit = vectorHits[i];
    const existing = scores.get(hit.chunkId);
    const rrfScore = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(hit.chunkId, { hit, score: rrfScore });
    }
  }

  for (let i = 0; i < textHits.length; i++) {
    const hit = textHits[i];
    const existing = scores.get(hit.chunkId);
    const rrfScore = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(hit.chunkId, { hit, score: rrfScore });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, topK))
    .map(({ hit, score }) => ({ ...hit, score }));
}

/**
 * Run retrieval: hybrid (vector + full-text with RRF) or vector-only.
 */
export async function search(
  db: RetrievalDB,
  opts: SearchOptions,
): Promise<SearchHit[]> {
  if (opts.documentIds.length === 0 || opts.topK <= 0) {
    return [];
  }

  if (opts.hybridSearch) {
    // Run both searches in parallel
    const [rawVectorHits, textHits] = await Promise.all([
      db.vectorSearch(opts.userId, opts.documentIds, opts.queryVec, opts.topK * 2),
      db.fullTextSearch(opts.userId, opts.documentIds, opts.queryText, opts.topK * 2),
    ]);

    // Score threshold applies to cosine similarity of vector candidates
    const vectorHits = opts.scoreThreshold > 0
      ? rawVectorHits.filter((h) => h.score >= opts.scoreThreshold)
      : rawVectorHits;

    const fused = reciprocalRankFusion(vectorHits, textHits, opts.topK);
    return opts.scoreThreshold > 0
      ? fused.filter((h) => h.score >= opts.scoreThreshold)
      : fused;
  }

  // Vector-only
  const hits = await db.vectorSearch(opts.userId, opts.documentIds, opts.queryVec, opts.topK);
  return hits.filter((h) => h.score >= opts.scoreThreshold);
}

/**
 * Retrieve document summaries from stored summaries.
 */
export interface SummaryDB {
  getDocumentSummary(documentId: string, userId: string): Promise<{
    overview: string;
    keyPoints: string[];
    sections: Array<{ title: string; pageStart: number; pageEnd: number; summary: string }>;
  } | null>;
}

export async function getSummary(
  db: SummaryDB,
  documentId: string,
  userId: string,
): Promise<{
  overview: string;
  keyPoints: string[];
  sections: Array<{ title: string; pageStart: number; pageEnd: number; summary: string }>;
} | null> {
  return db.getDocumentSummary(documentId, userId);
}

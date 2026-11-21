/**
 * Shared embedding interface.
 * Agent 1 (ingestion) and Agent 2 (retrieval) both use this.
 */
export interface Embedder {
  /** Embed a single text, returning a vector of the configured dimension. */
  embed(text: string): Promise<number[]>;
  /** Embed a batch of texts. */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** The fixed vector dimension. */
  readonly dimension: number;
}

/**
 * Fake embedder for testing. Returns deterministic vectors based on text hash.
 */
export class FakeEmbedder implements Embedder {
  readonly dimension: number;

  constructor(dimension = 768) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    return this.deterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.deterministicVector(t));
  }

  private deterministicVector(text: string): number[] {
    // Simple hash-based deterministic vector for reproducible tests
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    const vec: number[] = [];
    for (let i = 0; i < this.dimension; i++) {
      // Use a simple LCG seeded by hash + index
      hash = (hash * 1103515245 + 12345) | 0;
      vec.push(((hash >>> 16) & 0x7fff) / 0x7fff - 0.5);
    }
    // Normalize to unit vector
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }
}

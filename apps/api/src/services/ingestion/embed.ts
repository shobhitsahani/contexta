import { getEnv } from "../../config/env.js";
import type { Embedder } from "../embedding/embedder.js";

export const FIXED_EMBEDDING_DIMENSION = 768;
export const MAX_EMBEDDING_BATCH_SIZE = 64;

export interface GeminiEmbedderOptions {
  apiKey?: string;
  model?: string;
  dimension?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING";
  batchDelayMs?: number;
}

/**
 * Gemini Embedder implementing the shared Embedder interface with a fixed 768-dim model.
 */
export class GeminiEmbedder implements Embedder {
  readonly dimension: number;
  private apiKey: string;
  private model: string;
  private maxRetries: number;
  private baseDelayMs: number;
  private taskType?: string;
  private batchDelayMs: number;

  constructor(options: GeminiEmbedderOptions = {}) {
    const env = getEnv();
    this.dimension = options.dimension ?? env.EMBEDDING_DIMENSIONS ?? FIXED_EMBEDDING_DIMENSION;
    this.apiKey = options.apiKey ?? env.EMBEDDING_API_KEY;
    this.model = options.model ?? env.EMBEDDING_MODEL ?? "gemini-embedding-001";
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.taskType = options.taskType ?? "RETRIEVAL_DOCUMENT";
    this.batchDelayMs = options.batchDelayMs ?? 0;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Split into chunks of MAX_EMBEDDING_BATCH_SIZE
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_EMBEDDING_BATCH_SIZE) {
      if (i > 0 && this.batchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.batchDelayMs));
      }
      const slice = texts.slice(i, i + MAX_EMBEDDING_BATCH_SIZE);
      const batchResult = await this.callBatchWithRetry(slice);
      allEmbeddings.push(...batchResult);
    }

    return allEmbeddings;
  }

  private async callBatchWithRetry(texts: string[]): Promise<number[][]> {
    let attempt = 0;
    let delay = this.baseDelayMs;

    while (true) {
      attempt++;
      try {
        return await this.executeBatchRequest(texts);
      } catch (err: any) {
        const isRateLimit =
          err?.status === 429 ||
          err?.message?.includes("429") ||
          err?.message?.includes("RESOURCE_EXHAUSTED");
        const isTransient =
          err?.status >= 500 ||
          err?.message?.includes("503") ||
          err?.message?.includes("fetch failed");

        if ((isRateLimit || isTransient) && attempt <= this.maxRetries) {
          // Exponential backoff with jitter
          const jitter = Math.random() * 200;
          await new Promise((res) => setTimeout(res, delay + jitter));
          delay *= 2;
          continue;
        }

        throw new Error(`Gemini embedding failed after ${attempt} attempts: ${err.message}`, { cause: err });
      }
    }
  }

  private async executeBatchRequest(texts: string[]): Promise<number[][]> {
    const modelPath = this.model.startsWith("models/") ? this.model : `models/${this.model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => ({
      model: modelPath,
      content: {
        parts: [{ text: text.trim() || " " }],
      },
      outputDimensionality: this.dimension,
      ...(this.taskType ? { taskType: this.taskType } : {}),
    }));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const error: any = new Error(`Gemini embedding API error ${response.status}: ${errText}`);
      error.status = response.status;
      throw error;
    }

    const data: any = await response.json();
    const embeddings: any[] = data?.embeddings || [];

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Gemini embedding returned ${embeddings.length} vectors for ${texts.length} texts`,
      );
    }

    return embeddings.map((item, _index) => {
      let values: number[] = item?.values || [];
      // Handle dimension mismatch if needed (Matryoshka truncation / padding)
      if (values.length > this.dimension) {
        values = values.slice(0, this.dimension);
      } else if (values.length < this.dimension) {
        while (values.length < this.dimension) {
          values.push(0);
        }
      }
      return values;
    });
  }
}

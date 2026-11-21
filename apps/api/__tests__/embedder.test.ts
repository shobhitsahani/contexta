/**
 * Tests for the embedding interface and fake embedder.
 */
import { describe, it, expect } from 'vitest';
import { FakeEmbedder } from '../../apps/api/src/services/embedding/embedder.js';

describe('FakeEmbedder', () => {
  it('returns vectors of the configured dimension', async () => {
    const embedder = new FakeEmbedder(768);
    const vec = await embedder.embed('test text');
    expect(vec).toHaveLength(768);
  });

  it('returns normalized unit vectors', async () => {
    const embedder = new FakeEmbedder(768);
    const vec = await embedder.embed('test text');
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('is deterministic: same input produces same output', async () => {
    const embedder = new FakeEmbedder(768);
    const v1 = await embedder.embed('hello world');
    const v2 = await embedder.embed('hello world');
    expect(v1).toEqual(v2);
  });

  it('produces different vectors for different inputs', async () => {
    const embedder = new FakeEmbedder(768);
    const v1 = await embedder.embed('hello');
    const v2 = await embedder.embed('goodbye');
    expect(v1).not.toEqual(v2);
  });

  it('embedBatch returns one vector per input', async () => {
    const embedder = new FakeEmbedder(128);
    const vecs = await embedder.embedBatch(['a', 'b', 'c']);
    expect(vecs).toHaveLength(3);
    for (const v of vecs) {
      expect(v).toHaveLength(128);
    }
  });

  it('embedBatch is consistent with individual embed', async () => {
    const embedder = new FakeEmbedder(128);
    const single = await embedder.embed('test');
    const batch = await embedder.embedBatch(['test']);
    expect(batch[0]).toEqual(single);
  });

  it('handles empty string', async () => {
    const embedder = new FakeEmbedder(64);
    const vec = await embedder.embed('');
    expect(vec).toHaveLength(64);
  });

  it('reports correct dimension', () => {
    const embedder = new FakeEmbedder(256);
    expect(embedder.dimension).toBe(256);
  });
});

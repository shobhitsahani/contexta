import { describe, it, expect } from "vitest";
import { FakeEmbedder } from "../../../src/services/embedding/embedder.js";

describe("FakeEmbedder (shared Embedder interface)", () => {
  it("returns unit vectors of the configured dimension", async () => {
    const embedder = new FakeEmbedder(768);
    const vec = await embedder.embed("hello world");
    expect(vec).toHaveLength(768);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("is deterministic: same text -> same vector", async () => {
    const embedder = new FakeEmbedder();
    const a = await embedder.embed("the quick brown fox");
    const b = await embedder.embed("the quick brown fox");
    expect(a).toEqual(b);
  });

  it("different texts produce different vectors", async () => {
    const embedder = new FakeEmbedder();
    const a = await embedder.embed("alpha");
    const b = await embedder.embed("beta");
    expect(a).not.toEqual(b);
  });

  it("embedBatch returns one vector per text", async () => {
    const embedder = new FakeEmbedder(128);
    const vecs = await embedder.embedBatch(["one", "two", "three"]);
    expect(vecs).toHaveLength(3);
    for (const v of vecs) expect(v).toHaveLength(128);
  });

  it("batch embed is consistent with single embed", async () => {
    const embedder = new FakeEmbedder();
    const single = await embedder.embed("consistency check");
    const batched = (await embedder.embedBatch(["consistency check"]))[0];
    expect(batched).toEqual(single);
  });
});

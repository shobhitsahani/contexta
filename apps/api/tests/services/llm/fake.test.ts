import { describe, it, expect } from "vitest";
import { FakeLLMProviderForTest } from "../../helpers.js";

async function collect(it: AsyncIterable<any>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of it) if (c.text) out.push(c.text);
  return out;
}

describe("FakeLLMProviderForTest (streamed chat contract)", () => {
  it("streams text deltas word by word", async () => {
    const provider = new FakeLLMProviderForTest();
    const chunks: any[] = [];
    for await (const c of provider.stream({
      model: "m",
      system: "sys",
      messages: [{ role: "user", content: "q" }],
      apiKey: "key",
    })) {
      chunks.push(c);
    }
    const deltas = chunks.filter((c) => c.text).map((c) => c.text);
    expect(deltas.join("")).toBe(provider.responses[0]);
    expect(provider.callCount).toBe(1);
    expect(provider.lastRequest?.model).toBe("m");
    expect(provider.lastRequest?.apiKey).toBe("key");
  });

  it("yields final usage", async () => {
    const provider = new FakeLLMProviderForTest();
    let usage: any = null;
    for await (const c of provider.stream({
      model: "m",
      system: "s",
      messages: [{ role: "user", content: "q" }],
      apiKey: "key",
    })) {
      if (c.usage) usage = c.usage;
    }
    expect(usage).toMatchObject({
      in: expect.any(Number),
      out: expect.any(Number),
    });
  });

  it("honors abort signal", async () => {
    const provider = new FakeLLMProviderForTest();
    const ac = new AbortController();
    const iter = provider.stream({
      model: "m",
      system: "s",
      messages: [{ role: "user", content: "q" }],
      apiKey: "key",
      signal: ac.signal,
    })[Symbol.asyncIterator]();
    ac.abort();
    await expect(iter.next()).rejects.toThrow(/Aborted/);
  });

  it("cycles through configured responses", async () => {
    const provider = new FakeLLMProviderForTest([
      "first reply",
      "second reply",
    ]);
    const c1 = await collect(
      provider.stream({ model: "m", system: "s", messages: [], apiKey: "k" }),
    );
    const c2 = await collect(
      provider.stream({ model: "m", system: "s", messages: [], apiKey: "k" }),
    );
    expect(c1.join("")).toBe("first reply");
    expect(c2.join("")).toBe("second reply");
    expect(provider.callCount).toBe(2);
  });
});

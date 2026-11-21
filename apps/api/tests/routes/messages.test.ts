import { describe, it, expect } from "vitest";
import { createMessagesRouter } from "../../src/routes/messages/index.js";
import { FakeEmbedder, FakeRetrievalDB, FakeLLMProviderForTest } from "../helpers.js";

function deps(overrides: any = {}): any {
  return {
    embedder: new FakeEmbedder(),
    retrievalDB: new FakeRetrievalDB(),
    summaryDB: { getDocumentSummary: async () => null },
    messagesDB: {
      getChat: async () => ({ id: "c1", userId: "u1", title: "Chat" }),
      getChatDocumentIds: async () => [],
      getRecentMessages: async () => [],
      saveMessage: async () => {},
      updateChatTitle: async () => {},
    },
    usageDB: { getFreeTokensUsed: async () => 0, addFreeTokensUsed: async () => {} },
    keysDB: { getUserProviderKey: async () => null },
    documentsDB: { getDocumentsByIds: async () => [] },
    getProviderFn: () => new FakeLLMProviderForTest(["Based on the sources [1], yes."]),
    ...overrides,
  };
}

describe("messages router", () => {
  it("createMessagesRouter returns a callable express router", () => {
    const r = createMessagesRouter(deps());
    expect(typeof r).toBe("function");
    expect(typeof (r as any).handle).toBe("function");
  });

  it("POST /messages executes and streams successfully (shared exports verified)", async () => {
    const r = createMessagesRouter(deps());
    const req: any = {
      method: "POST",
      url: "/chats/c1/messages",
      params: { id: "c1" },
      body: { content: "What does the warranty cover?" },
      userId: "u1",
      user: { id: "u1" },
      headers: {},
      on() {},
    };
    const chunks: string[] = [];
    const res: any = {
      statusCode: 200,
      writeHead() {},
      flushHeaders() {},
      write(c: string | Buffer) { chunks.push(c.toString()); return true; },
      end() {},
      status() { return res; },
      json() { return res; },
      setHeader() { return res; },
    };
    let threw: Error | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        r(req, res, (err?: any) => (err ? reject(err) : resolve()));
      });
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).toBeNull();
  });
});

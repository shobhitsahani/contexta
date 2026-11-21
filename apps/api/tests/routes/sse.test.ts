import { describe, it, expect } from "vitest";
import {
  initSSE,
  sendDelta,
  sendSources,
  sendUsage,
  sendDone,
  sendError,
  sendKeepAlive,
} from "../../src/routes/messages/sse.js";

function makeRes(): any {
  const chunks: Buffer[] = [];
  const res: any = {
    writeHead: () => {},
    flushHeaders: () => {},
    write: (chunk: string | Buffer) => { chunks.push(Buffer.from(chunk)); return true; },
    end: () => {},
    get chunks() { return chunks.map((c) => c.toString()).join(""); },
  };
  return res;
}

describe("SSE helpers", () => {
  it("initSSE sets streaming headers", () => {
    let headCode: number | null = null;
    let headHeaders: any = null;
    const res = {
      writeHead: (code: number, headers: any) => { headCode = code; headHeaders = headers; },
      flushHeaders: () => {},
      write: () => true,
      end: () => {},
    };
    initSSE(res as any);
    expect(headCode).toBe(200);
    expect(headHeaders["Content-Type"]).toBe("text/event-stream");
    expect(headHeaders["X-Accel-Buffering"]).toBe("no");
  });

  it("sendDelta writes an SSE delta event", () => {
    const res = makeRes();
    sendDelta(res, "hello");
    expect(res.chunks).toContain("event: delta");
    expect(res.chunks).toContain('data: "hello"');
  });

  it("sendSources writes a sources event", () => {
    const res = makeRes();
    sendSources(res, [{ n: 1, documentId: "d1", fileName: "a.txt", page: 1, snippet: "hi" }]);
    expect(res.chunks).toContain("event: sources");
    expect(res.chunks).toContain("a.txt");
  });

  it("sendUsage writes tokens", () => {
    const res = makeRes();
    sendUsage(res, 10, 5);
    expect(res.chunks).toContain("event: usage");
    expect(res.chunks).toContain('"tokensIn":10');
  });

  it("sendDone writes done event", () => {
    const res = makeRes();
    sendDone(res);
    expect(res.chunks).toContain("event: done");
  });

  it("sendError writes code and message", () => {
    const res = makeRes();
    sendError(res, "KEY_REQUIRED", "add a key");
    expect(res.chunks).toContain("event: error");
    expect(res.chunks).toContain("KEY_REQUIRED");
  });

  it("sendKeepAlive writes a comment line", () => {
    const res = makeRes();
    sendKeepAlive(res);
    expect(res.chunks).toContain(": keep-alive");
  });
});

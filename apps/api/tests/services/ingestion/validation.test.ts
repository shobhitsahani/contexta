import { describe, it, expect } from "vitest";
import {
  validateUpload,
  getMimeFromFilename,
  MAX_FILE_SIZE_BYTES,
  MAX_PAGE_COUNT,
  MAX_DOCUMENTS_PER_USER,
} from "../../../src/services/ingestion/validation.js";

function file(overrides: Partial<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}> = {}): any {
  return {
    originalname: "test.txt",
    mimetype: "text/plain",
    size: 10,
    buffer: Buffer.from("hello"),
    ...overrides,
  };
}

describe("ingestion validation", () => {
  it("accepts a valid TXT upload", () => {
    const result = validateUpload(file({ buffer: Buffer.from("valid text content") }));
    expect(result.mime).toBe("text/plain");
  });

  it("rejects oversized files (10 MB cap)", () => {
    const tooBig = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1);
    expect(() =>
      validateUpload(file({ originalname: "big.txt", size: tooBig.length, buffer: tooBig })),
    ).toThrow(/10 MB/);
  });

  it("rejects unsupported extension", () => {
    expect(() =>
      validateUpload(file({ originalname: "image.png", mimetype: "image/png", buffer: Buffer.from("x") }),
    )).toThrow(/Unsupported file type/);
  });

  it("rejects PDF without %PDF header", () => {
    expect(() =>
      validateUpload(file({ originalname: "bad.pdf", mimetype: "application/pdf", buffer: Buffer.from("not a pdf") }),
    )).toThrow(/header signature/);
  });

  it("rejects DOCX without ZIP signature", () => {
    expect(() =>
      validateUpload(file({ originalname: "bad.docx", mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("not zip") }),
    )).toThrow(/ZIP container/);
  });

  it("rejects TXT with null bytes", () => {
    const buf = Buffer.from("text\0binary", "utf8");
    expect(() =>
      validateUpload(file({ originalname: "bad.txt", buffer: buf })),
    ).toThrow(/null bytes/);
  });

  it("getMimeFromFilename maps extensions", () => {
    expect(getMimeFromFilename("a.pdf")).toBe("application/pdf");
    expect(getMimeFromFilename("a.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(getMimeFromFilename("a.txt")).toBe("text/plain");
    expect(getMimeFromFilename("a.xyz")).toBeNull();
  });

  it("limits are as specified in plan.md", () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_PAGE_COUNT).toBe(100);
    expect(MAX_DOCUMENTS_PER_USER).toBe(5);
  });
});

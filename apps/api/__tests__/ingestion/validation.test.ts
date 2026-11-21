import { describe, expect, it } from "vitest";
import {
  getMimeFromFilename,
  MAX_FILE_SIZE_BYTES,
  validateFileSignature,
  validateUpload,
} from "../../src/services/ingestion/validation.js";
import {
  createTestDocxBuffer,
  createTestPdfBuffer,
  createTestTxtBuffer,
} from "./fixtures.js";

describe("Ingestion Validation", () => {
  it("determines MIME type from supported file extensions", () => {
    expect(getMimeFromFilename("report.pdf")).toBe("application/pdf");
    expect(getMimeFromFilename("notes.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(getMimeFromFilename("readme.txt")).toBe("text/plain");
    expect(getMimeFromFilename("photo.png")).toBeNull();
    expect(getMimeFromFilename("script.exe")).toBeNull();
  });

  it("validates valid PDF file signatures (%PDF-)", () => {
    const pdfBuf = createTestPdfBuffer();
    expect(() =>
      validateFileSignature(pdfBuf, "application/pdf"),
    ).not.toThrow();
  });

  it("rejects invalid PDF signatures", () => {
    const fakePdf = Buffer.from("NOT_A_REAL_PDF_HEADER");
    expect(() =>
      validateFileSignature(fakePdf, "application/pdf"),
    ).toThrowError(/header signature does not match %PDF/);
  });

  it("validates valid DOCX file signatures (PK zip)", () => {
    const docxBuf = createTestDocxBuffer();
    expect(() =>
      validateFileSignature(
        docxBuf,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).not.toThrow();
  });

  it("rejects invalid DOCX signatures", () => {
    const fakeDocx = Buffer.from("NOT_A_ZIP");
    expect(() =>
      validateFileSignature(
        fakeDocx,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toThrowError(/header signature does not match ZIP container/);
  });

  it("validates clean TXT files and rejects binary null bytes", () => {
    const txtBuf = createTestTxtBuffer("Valid text with no null bytes");
    expect(() => validateFileSignature(txtBuf, "text/plain")).not.toThrow();

    const binaryTxt = Buffer.from("Fake text\x00with null byte");
    expect(() => validateFileSignature(binaryTxt, "text/plain")).toThrowError(
      /contains binary\/null bytes/,
    );
  });

  it("enforces maximum file size limit (10 MB)", () => {
    const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 100);
    expect(() =>
      validateUpload({
        originalname: "huge.pdf",
        mimetype: "application/pdf",
        size: oversized.length,
        buffer: oversized,
      }),
    ).toThrowError(/File size exceeds the 10 MB limit/);
  });

  it("normalizes generic octet-stream MIME types for valid files", () => {
    const pdfBuf = createTestPdfBuffer();
    const result = validateUpload({
      originalname: "test.pdf",
      mimetype: "application/octet-stream",
      size: pdfBuf.length,
      buffer: pdfBuf,
    });
    expect(result.mime).toBe("application/pdf");
  });

  it("rejects unsupported file formats", () => {
    const pngBuf = Buffer.from("fake png");
    expect(() =>
      validateUpload({
        originalname: "picture.png",
        mimetype: "image/png",
        size: pngBuf.length,
        buffer: pngBuf,
      }),
    ).toThrowError(/Unsupported file type/);
  });

  it("accepts valid PDF with leading whitespace/BOM before %PDF-", () => {
    const leadingWhitespacePdf = Buffer.concat([
      Buffer.from("\r\n% Comment header\r\n"),
      createTestPdfBuffer(),
    ]);
    expect(() =>
      validateFileSignature(leadingWhitespacePdf, "application/pdf"),
    ).not.toThrow();
  });

  it("accepts valid short text files under 4 bytes and rejects completely empty buffer", () => {
    expect(() =>
      validateFileSignature(Buffer.from("OK"), "text/plain"),
    ).not.toThrow();

    expect(() =>
      validateFileSignature(Buffer.alloc(0), "text/plain"),
    ).toThrowError(/Uploaded file is empty/);
  });

  it("rejects corrupt binary header less than 4 bytes for PDF and DOCX", () => {
    expect(() =>
      validateFileSignature(Buffer.from("%P"), "application/pdf"),
    ).toThrowError(/Uploaded file is empty or corrupted/);

    expect(() =>
      validateFileSignature(
        Buffer.from("PK"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toThrowError(/Uploaded file is empty or corrupted/);
  });

  it("rejects DOCX files exceeding 50 MB decompressed size in central directory", () => {
    // Construct two central directory headers with 30 MB uncompressed size each (total 60 MB > 50 MB limit)
    const cdEntry1 = Buffer.alloc(46 + 4);
    cdEntry1.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cdEntry1.writeUInt16LE(20, 4);
    cdEntry1.writeUInt16LE(20, 6);
    cdEntry1.writeUInt32LE(30 * 1024 * 1024, 24); // uncompressedSize 30 MB
    cdEntry1.writeUInt16LE(4, 28); // fileNameLength
    cdEntry1.write("doc1", 46);

    const cdEntry2 = Buffer.alloc(46 + 4);
    cdEntry2.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cdEntry2.writeUInt16LE(20, 4);
    cdEntry2.writeUInt16LE(20, 6);
    cdEntry2.writeUInt32LE(30 * 1024 * 1024, 24); // uncompressedSize 30 MB
    cdEntry2.writeUInt16LE(4, 28); // fileNameLength
    cdEntry2.write("doc2", 46);

    // Initial local header to satisfy DOCX isZip check
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04

    const zipBuffer = Buffer.concat([localHeader, cdEntry1, cdEntry2]);

    expect(() =>
      validateFileSignature(
        zipBuffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toThrowError(/exceeds the 50 MB limit/);
  });

  it("rejects DOCX files exceeding 50 MB decompressed size (zip bomb protection)", () => {
    // Construct a synthetic ZIP header with a 60 MB uncompressed size entry
    const zipHeader = Buffer.alloc(40);
    zipHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    zipHeader.writeUInt16LE(20, 4);
    zipHeader.writeUInt16LE(0, 6);
    zipHeader.writeUInt16LE(0, 8);
    zipHeader.writeUInt32LE(100, 18); // compressedSize
    zipHeader.writeUInt32LE(60 * 1024 * 1024, 22); // uncompressedSize: 60 MB
    zipHeader.writeUInt16LE(4, 26); // fileNameLength
    zipHeader.writeUInt16LE(0, 28); // extraFieldLength
    zipHeader.write("test", 30);

    expect(() =>
      validateFileSignature(
        zipHeader,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toThrowError(/exceeds the 50 MB limit/);
  });
});

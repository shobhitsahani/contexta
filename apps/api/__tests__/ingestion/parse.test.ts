import { describe, expect, it } from "vitest";
import {
  parseDocx,
  parseDocument,
  parsePdf,
  parseTxt,
} from "../../src/services/ingestion/parse.js";
import {
  createMultiPagePdfBuffer,
  createScannedPdfBuffer,
  createTestDocxBuffer,
  createTestPdfBuffer,
  createTestTxtBuffer,
} from "./fixtures.js";

describe("Document Parsing", () => {
  it("parses valid TXT files and returns page 1", async () => {
    const text = "Contexta is an AI-powered RAG chatbot for document analysis.";
    const buf = createTestTxtBuffer(text);
    const parsed = await parseTxt(buf);

    expect(parsed.pageCount).toBe(1);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0].pageNumber).toBe(1);
    expect(parsed.pages[0].text).toBe(text);
    expect(parsed.totalText).toBe(text);
  });

  it("rejects empty TXT files", async () => {
    const emptyBuf = createTestTxtBuffer("    \n\n  ");
    await expect(parseTxt(emptyBuf)).rejects.toThrowError(/Text file is empty/);
  });

  it("parses valid DOCX files and retains content", async () => {
    const docxBuf = createTestDocxBuffer([
      { text: "Overview of Architecture", isHeading: true },
      { text: "This section details the system architecture." },
    ]);
    const parsed = await parseDocx(docxBuf);

    expect(parsed.pageCount).toBe(1);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.totalText).toContain("Overview of Architecture");
    expect(parsed.totalText).toContain("This section details the system architecture");
  });

  it("rejects empty DOCX files", async () => {
    const emptyDocxBuf = createTestDocxBuffer([{ text: "" }]);
    await expect(parseDocx(emptyDocxBuf)).rejects.toThrowError(
      /empty or contains no readable text/,
    );
  });

  it("parses valid PDF files with page preservation", async () => {
    const pdfBuf = createTestPdfBuffer("Contexta RAG Architecture Document");
    const parsed = await parsePdf(pdfBuf);

    expect(parsed.pageCount).toBeGreaterThanOrEqual(1);
    expect(parsed.pages.length).toBeGreaterThanOrEqual(1);
    expect(parsed.pages[0].pageNumber).toBe(1);
    expect(parsed.totalText).toContain("Contexta RAG Architecture Document");
  });

  it("preserves individual pages across multi-page PDF documents", async () => {
    const multiPagePdf = createMultiPagePdfBuffer(3, [
      "First page of the Contexta system architecture document.",
      "Second page describing the PostgreSQL vector ingestion.",
      "Third page covering evaluation and retrieval benchmarks.",
    ]);
    const parsed = await parsePdf(multiPagePdf);

    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages).toHaveLength(3);
    expect(parsed.pages[0].pageNumber).toBe(1);
    expect(parsed.pages[0].text).toContain("First page");
    expect(parsed.pages[1].pageNumber).toBe(2);
    expect(parsed.pages[1].text).toContain("Second page");
    expect(parsed.pages[2].pageNumber).toBe(3);
    expect(parsed.pages[2].text).toContain("Third page");
  });

  it("rejects PDF documents exceeding 100 pages limit (plan.md 14.4)", async () => {
    const oversizedPdf = createMultiPagePdfBuffer(101);
    await expect(parsePdf(oversizedPdf)).rejects.toThrowError(
      /Document exceeds maximum 100 pages limit/,
    );
  });

  it("rejects scanned / near-empty PDFs with 'scanned PDF not supported yet'", async () => {
    const scannedPdf = createScannedPdfBuffer();
    await expect(parsePdf(scannedPdf)).rejects.toThrowError(
      /scanned PDF not supported yet/,
    );
  });

  it("routes parseDocument correctly based on mime type", async () => {
    const txtBuf = createTestTxtBuffer("Sample routing text content");
    const parsedTxt = await parseDocument(txtBuf, "text/plain");
    expect(parsedTxt.totalText).toBe("Sample routing text content");

    const pdfBuf = createTestPdfBuffer("Sample routing PDF content");
    const parsedPdf = await parseDocument(pdfBuf, "application/pdf");
    expect(parsedPdf.totalText).toContain("Sample routing PDF content");
  });

  it("strips UTF-8 Byte Order Mark (BOM) from TXT documents", async () => {
    const bomBuffer = Buffer.from("\uFEFFHello Contexta with BOM", "utf-8");
    const parsed = await parseTxt(bomBuffer);
    expect(parsed.totalText).toBe("Hello Contexta with BOM");
    expect(parsed.totalText.charCodeAt(0)).not.toBe(0xfeff);
  });
});

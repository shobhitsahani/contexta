import zlib from "node:zlib";

/**
 * Generate a valid minimal PDF buffer containing the provided text with exact dynamic xref offsets.
 */
export function createTestPdfBuffer(text = "Hello Contexta Test Document"): Buffer {
  return createMultiPagePdfBuffer(1, [text]);
}

/**
 * Generate a valid multi-page PDF buffer with exact dynamic xref offsets.
 */
export function createMultiPagePdfBuffer(pageCount: number, pageTexts: string[] = []): Buffer {
  const pages: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const text = pageTexts[i] ?? `Page ${i + 1} content for Contexta document evaluation testing.`;
    pages.push(text);
  }

  // PDF Structure:
  // 1: Catalog
  // 2: Pages container
  // For each page i (0 to pageCount - 1):
  //   Obj (3 + 2*i): Page object
  //   Obj (4 + 2*i): Content stream object
  // Font obj: (3 + 2*pageCount)

  const fontObjNum = 3 + 2 * pageCount;
  const pageObjNums: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(3 + 2 * i);
  }

  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];

  function appendObj(objNum: number, content: string): void {
    offsets[objNum] = Buffer.byteLength(out, "utf-8");
    out += `${objNum} 0 obj\n${content}\nendobj\n`;
  }

  // 1. Catalog
  appendObj(1, `<< /Type /Catalog /Pages 2 0 R >>`);

  // 2. Pages
  const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  appendObj(2, `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageCount} >>`);

  // 3. Pages and contents
  for (let i = 0; i < pageCount; i++) {
    const pageNum = pageObjNums[i];
    const contentNum = pageNum + 1;
    const stream = `BT\n/F1 24 Tf\n100 700 Td\n(${pages[i]}) Tj\nET`;
    const streamLen = Buffer.byteLength(stream, "utf-8");

    appendObj(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`,
    );

    appendObj(contentNum, `<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`);
  }

  // Font
  appendObj(fontObjNum, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  const xrefOffset = Buffer.byteLength(out, "utf-8");
  const totalObjs = fontObjNum + 1;

  out += `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjs; i++) {
    const off = offsets[i] ?? 0;
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }

  out += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(out, "utf-8");
}

/**
 * Generate a scanned/empty PDF buffer (no text).
 */
export function createScannedPdfBuffer(): Buffer {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer
<< /Size 4 /Root 1 0 R >>
startxref
210
%%EOF`;

  return Buffer.from(pdf, "utf-8");
}

/**
 * Generate a valid minimal DOCX buffer with paragraphs and optional headings.
 */
export function createTestDocxBuffer(paragraphs: Array<{ text: string; isHeading?: boolean }> = [{ text: "Hello from Contexta DOCX" }]): Buffer {
  let bodyXml = "";
  for (const p of paragraphs) {
    if (p.isHeading) {
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${p.text}</w:t></w:r></w:p>`;
    } else {
      bodyXml += `<w:p><w:r><w:t>${p.text}</w:t></w:r></w:p>`;
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
  const contentBuf = Buffer.from(xml, "utf8");
  const fileNameBuf = Buffer.from("word/document.xml", "utf8");
  const crc = zlib.crc32(contentBuf);

  // Local file header: PK\x03\x04
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8); // Store
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(contentBuf.length, 18);
  header.writeUInt32LE(contentBuf.length, 22);
  header.writeUInt16LE(fileNameBuf.length, 26);
  header.writeUInt16LE(0, 28);

  // Central directory header: PK\x01\x02
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(0, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(contentBuf.length, 20);
  cd.writeUInt32LE(contentBuf.length, 24);
  cd.writeUInt16LE(fileNameBuf.length, 28);
  cd.writeUInt32LE(0, 42); // offset

  // EOCD: PK\x05\x06
  const cdOffset = header.length + fileNameBuf.length + contentBuf.length;
  const cdSize = cd.length + fileNameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([header, fileNameBuf, contentBuf, cd, fileNameBuf, eocd]);
}

/**
 * Generate a valid plain text buffer.
 */
export function createTestTxtBuffer(text = "Hello Contexta TXT content"): Buffer {
  return Buffer.from(text, "utf-8");
}

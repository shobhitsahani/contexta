import { ContextaError } from "@contexta/shared";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PAGE_COUNT = 100;
export const MAX_DOCUMENTS_PER_USER = 5;

export type SupportedMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

export function getMimeFromFilename(filename: string): SupportedMimeType | null {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt":
      return "text/plain";
    default:
      return null;
  }
}

export const MAX_DOCX_DECOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB (plan.md 17.2 zip bomb cap)

/**
 * Scan a ZIP buffer and ensure the uncompressed size does not exceed the limit.
 * Inspects both local file headers and the central directory.
 */
export function validateDocxDecompressedSize(buffer: Buffer): void {
  let totalLocalUncompressedSize = 0;
  let totalCentralUncompressedSize = 0;
  let offset = 0;
  const len = buffer.length;

  while (offset + 30 <= len) {
    // Check for Local File Header (PK\x03\x04)
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x03 &&
      buffer[offset + 3] === 0x04
    ) {
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLen = buffer.readUInt16LE(offset + 26);
      const extraFieldLen = buffer.readUInt16LE(offset + 28);

      totalLocalUncompressedSize += uncompressedSize;
      if (totalLocalUncompressedSize > MAX_DOCX_DECOMPRESSED_SIZE_BYTES) {
        throw new ContextaError({
          code: "FILE_TOO_LARGE",
          message: `DOCX decompressed content exceeds the 50 MB limit`,
          status: 413,
        });
      }

      if (compressedSize > 0) {
        offset += 30 + fileNameLen + extraFieldLen + compressedSize;
      } else {
        offset += 30 + fileNameLen + extraFieldLen;
      }
    } else if (
      // Central Directory entry (PK\x01\x02)
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x01 &&
      buffer[offset + 3] === 0x02
    ) {
      if (offset + 46 <= len) {
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLen = buffer.readUInt16LE(offset + 28);
        const extraFieldLen = buffer.readUInt16LE(offset + 30);
        const commentLen = buffer.readUInt16LE(offset + 32);

        totalCentralUncompressedSize += uncompressedSize;
        if (totalCentralUncompressedSize > MAX_DOCX_DECOMPRESSED_SIZE_BYTES) {
          throw new ContextaError({
            code: "FILE_TOO_LARGE",
            message: `DOCX decompressed content exceeds the 50 MB limit`,
            status: 413,
          });
        }
        offset += 46 + fileNameLen + extraFieldLen + commentLen;
      } else {
        break;
      }
    } else {
      offset++;
    }
  }
}

/**
 * Check file signature / magic bytes.
 */
export function validateFileSignature(buffer: Buffer, mime: string): void {
  if (buffer.length === 0) {
    throw new ContextaError({
      code: "VALIDATION_ERROR",
      message: "Uploaded file is empty",
      status: 400,
    });
  }

  if (mime !== "text/plain" && buffer.length < 4) {
    throw new ContextaError({
      code: "VALIDATION_ERROR",
      message: "Uploaded file is empty or corrupted",
      status: 400,
    });
  }

  if (mime === "application/pdf") {
    // PDF signature: %PDF- within the first 1024 bytes (per ISO 32000-1)
    const headerSlice = buffer.subarray(0, 1024);
    const hasPdfHeader =
      headerSlice.includes(Buffer.from("%PDF-")) ||
      headerSlice.includes(Buffer.from("%PDF"));

    if (!hasPdfHeader) {
      throw new ContextaError({
        code: "UNSUPPORTED_TYPE",
        message: "Invalid PDF file: header signature does not match %PDF",
        status: 400,
      });
    }
  } else if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    // DOCX is a zip archive starting with PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
    const isZip =
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
    if (!isZip) {
      throw new ContextaError({
        code: "UNSUPPORTED_TYPE",
        message: "Invalid DOCX file: header signature does not match ZIP container",
        status: 400,
      });
    }

    // Protect against zip bombs / decompressed memory exhaustion (plan.md 17.2)
    validateDocxDecompressedSize(buffer);
  } else if (mime === "text/plain") {
    // Reject binary files pretending to be text: check for null bytes in initial chunk
    const checkLength = Math.min(buffer.length, 1024);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0x00) {
        throw new ContextaError({
          code: "UNSUPPORTED_TYPE",
          message: "Invalid TXT file: contains binary/null bytes",
          status: 400,
        });
      }
    }
  }
}

/**
 * Validate file size and mime type.
 */
export function validateUpload(file: {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}): { mime: SupportedMimeType } {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ContextaError({
      code: "FILE_TOO_LARGE",
      message: `File size exceeds the 10 MB limit (got ${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
      status: 413,
    });
  }

  let mime = file.mimetype as SupportedMimeType;
  const inferredMime = getMimeFromFilename(file.originalname);

  if (!inferredMime) {
    throw new ContextaError({
      code: "UNSUPPORTED_TYPE",
      message: `Unsupported file type for "${file.originalname}". Only PDF, DOCX, and TXT are supported.`,
      status: 415,
    });
  }

  // Normalize generic or octet-stream mime types
  if ((mime as string) === "application/octet-stream" || !mime) {
    mime = inferredMime;
  } else if (mime !== inferredMime) {
    // Prefer inferred from known extension if header is generic
    mime = inferredMime;
  }

  validateFileSignature(file.buffer, mime);

  return { mime };
}

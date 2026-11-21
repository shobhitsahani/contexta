import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface StorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * In-memory storage implementation for unit tests.
 */
export class MemoryStorageService implements StorageService {
  private store = new Map<string, { buffer: Buffer; mimeType: string }>();

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    this.store.set(key, { buffer, mimeType });
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const item = this.store.get(key);
    if (!item) {
      throw new Error(`File not found in storage: ${key}`);
    }
    return item.buffer;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Local filesystem storage service (for local development).
 */
export class LocalStorageService implements StorageService {
  private baseDir: string;

  constructor(baseDir = "./uploads") {
    this.baseDir = path.resolve(baseDir);
  }

  private resolvePath(key: string): string {
    const resolvedBase = path.resolve(this.baseDir);
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new Error(`Path traversal detected in storage key: ${key}`);
    }
    return resolved;
  }

  async upload(key: string, buffer: Buffer): Promise<string> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.resolvePath(key);
    try {
      return await fs.readFile(filePath);
    } catch {
      throw new Error(`File not found in local storage: ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSigV4Key(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secret}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

/**
 * S3 / Cloudflare R2 / Supabase Storage compatible service with AWS SigV4 signing.
 */
export class S3StorageService implements StorageService {
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucket: string;
  private region: string;

  constructor(config: {
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
    region?: string;
  }) {
    this.endpoint = config.endpoint || process.env.R2_ENDPOINT || "";
    this.accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID || "";
    this.secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "";
    this.bucket = config.bucket || process.env.R2_BUCKET || "contexta-documents";
    this.region = config.region || process.env.R2_REGION || "auto";
  }

  private getObjectUrl(key: string): string {
    const cleanEndpoint = this.endpoint.replace(/\/+$/, "");
    const cleanBucket = this.bucket.replace(/^\/+|\/+$/g, "");
    const safeKey = key
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${cleanEndpoint}/${cleanBucket}/${safeKey}`;
  }

  signHeaders(
    method: string,
    url: string,
    baseHeaders: Record<string, string>,
    payload: Buffer | Uint8Array | string = "",
  ): Record<string, string> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      return baseHeaders;
    }

    const parsedUrl = new URL(url);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const service = "s3";
    const payloadHash = sha256Hex(payload);

    // Normalize all input header keys to lowercase to prevent case-mismatch lookup bugs
    const normalizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseHeaders)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    normalizedHeaders.host = parsedUrl.host;
    normalizedHeaders["x-amz-content-sha256"] = payloadHash;
    normalizedHeaders["x-amz-date"] = amzDate;

    const headersToSign = normalizedHeaders;

    const signedHeaderKeys = Object.keys(headersToSign)
      .map((k) => k.toLowerCase())
      .sort();

    const canonicalHeaders = signedHeaderKeys
      .map((k) => `${k}:${(headersToSign[k] ?? "").trim()}\n`)
      .join("");
    const signedHeaders = signedHeaderKeys.join(";");

    const canonicalRequest = [
      method.toUpperCase(),
      parsedUrl.pathname,
      parsedUrl.search ? parsedUrl.search.slice(1) : "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSigV4Key(this.secretAccessKey, dateStamp, this.region, service);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    headersToSign.authorization = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headersToSign;
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (!this.endpoint) {
      throw new Error("S3/R2 storage endpoint is not configured");
    }
    const url = this.getObjectUrl(key);
    const headers = this.signHeaders("PUT", url, { "content-type": mimeType }, buffer);
    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(buffer),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(`Failed to upload to S3/R2: ${response.status} ${err}`);
    }
    return key;
  }

  async download(key: string): Promise<Buffer> {
    if (!this.endpoint) {
      throw new Error("S3/R2 storage endpoint is not configured");
    }
    const url = this.getObjectUrl(key);
    const headers = this.signHeaders("GET", url, {});
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to download from S3/R2: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(key: string): Promise<void> {
    if (!this.endpoint) {
      return;
    }
    const url = this.getObjectUrl(key);
    const headers = this.signHeaders("DELETE", url, {});
    await fetch(url, { method: "DELETE", headers }).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    if (!this.endpoint) {
      return false;
    }
    const url = this.getObjectUrl(key);
    const headers = this.signHeaders("HEAD", url, {});
    const response = await fetch(url, { method: "HEAD", headers });
    return response.ok;
  }
}

let defaultStorage: StorageService | undefined;

export function getStorageService(): StorageService {
  if (!defaultStorage) {
    if (process.env.STORAGE_DRIVER === "s3" || process.env.R2_ENDPOINT) {
      defaultStorage = new S3StorageService({});
    } else if (process.env.NODE_ENV === "test") {
      defaultStorage = new MemoryStorageService();
    } else {
      defaultStorage = new LocalStorageService(process.env.LOCAL_STORAGE_DIR || "./uploads");
    }
  }
  return defaultStorage;
}

export function setStorageService(service: StorageService): void {
  defaultStorage = service;
}

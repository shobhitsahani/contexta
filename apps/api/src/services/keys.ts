import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD_PREFIX = 'contexta-provider-key:v1';

export interface EncryptedKeyMaterial {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Accepts a 32-byte master key encoded as hex (64 chars), base64 (standard or
 * URL-safe), or raw 32 bytes. No silent hashing/truncation: a wrong-length
 * secret is a startup error.
 */
export function parseMasterKey(secret: string): Buffer {
  const value = secret.trim();
  if (!value) {
    throw new Error('KEY_ENCRYPTION_SECRET is empty.');
  }

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const base64 = Buffer.from(normalized, 'base64');
  if (base64.length === KEY_BYTES) {
    return base64;
  }

  const raw = Buffer.from(value, 'utf8');
  if (raw.length === KEY_BYTES) {
    return raw;
  }

  throw new Error(
    'KEY_ENCRYPTION_SECRET must decode to exactly 32 bytes (hex or base64).',
  );
}

/** Binds ciphertext to its owner and provider to prevent row swapping. */
export function keyAad(userId: string, provider: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}:${userId}:${provider}`, 'utf8');
}

function toBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

export function encryptProviderKey(
  plaintext: string,
  masterKey: Buffer,
  aad: Buffer,
): EncryptedKeyMaterial {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error('Invalid encryption key length.');
  }
  if (!plaintext) {
    throw new Error('Provider key must not be empty.');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptProviderKey(
  material: EncryptedKeyMaterial,
  masterKey: Buffer,
  aad: Buffer,
): string {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error('Invalid encryption key length.');
  }
  const iv = toBuffer(material.iv);
  const authTag = toBuffer(material.authTag);
  const ciphertext = toBuffer(material.ciphertext);
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error('Invalid encrypted key material.');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Authentication failures are intentionally indistinguishable.
    throw new Error('Provider key could not be decrypted.');
  }
}

/** Constant-time comparison used by tests and future rotation tooling. */
export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

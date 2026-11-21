import { describe, it, expect } from "vitest";
import {
  parseMasterKey,
  encryptProviderKey,
  decryptProviderKey,
  keyAad,
  keysEqual,
} from "../../src/services/keys.js";

const MASTER_KEY_HEX = "a".repeat(64); // 32 bytes hex

describe("keys.ts encryption/decryption", () => {
  const masterKey = parseMasterKey(MASTER_KEY_HEX);

  it("roundtrips a provider key", () => {
    const plaintext = "sk-test-1234567890abcdef";
    const aad = keyAad("user-1", "gemini");
    const material = encryptProviderKey(plaintext, masterKey, aad);
    const decrypted = decryptProviderKey(material, masterKey, aad);
    expect(decrypted).toBe(plaintext);
    expect(material.ciphertext.length).toBeGreaterThan(0);
    expect(material.iv.length).toBe(12);
    expect(material.authTag.length).toBe(16);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const aad = keyAad("user-1", "gemini");
    const m1 = encryptProviderKey("sk-same", masterKey, aad);
    const m2 = encryptProviderKey("sk-same", masterKey, aad);
    expect(m1.ciphertext.toString("hex")).not.toBe(m2.ciphertext.toString("hex"));
    expect(m1.iv.toString("hex")).not.toBe(m2.iv.toString("hex"));
  });

  it("fails to decrypt with wrong AAD (user/provider binding)", () => {
    const aad1 = keyAad("user-1", "gemini");
    const aad2 = keyAad("user-2", "gemini");
    const material = encryptProviderKey("sk-secret", masterKey, aad1);
    expect(() => decryptProviderKey(material, masterKey, aad2)).toThrow();
  });

  it("fails to decrypt tampered ciphertext", () => {
    const aad = keyAad("user-1", "openai");
    const material = encryptProviderKey("sk-secret", masterKey, aad);
    const tampered = {
      ciphertext: Buffer.from(material.ciphertext),
      iv: material.iv,
      authTag: material.authTag,
    };
    tampered.ciphertext[0] ^= 0xff;
    expect(() => decryptProviderKey(tampered, masterKey, aad)).toThrow();
  });

  it("rejects wrong-length master key", () => {
    expect(() => parseMasterKey("short")).toThrow();
    expect(() => parseMasterKey("a".repeat(63))).toThrow();
    expect(() => parseMasterKey("a".repeat(65))).toThrow();
  });

  it("keysEqual is constant-time-aware and accurate", () => {
    expect(keysEqual(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
    expect(keysEqual(Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(false);
    expect(keysEqual(Buffer.from([1]), Buffer.from([1, 2]))).toBe(false);
  });
});

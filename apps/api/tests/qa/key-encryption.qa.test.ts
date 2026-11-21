import { describe, expect, it } from "vitest";
import {
  encryptProviderKey,
  decryptProviderKey,
  parseMasterKey,
  keyAad,
  keysEqual,
} from "../../src/services/keys.js";

describe("QA: Provider Key Encryption and Decryption (Plan 9, 14.7)", () => {
  const masterKey = parseMasterKey(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ); // 64 hex chars -> 32 bytes

  describe("Master Key Parsing", () => {
    it("parses 64-character hex encoded master key", () => {
      const hexKey = "a".repeat(64);
      const parsed = parseMasterKey(hexKey);
      expect(parsed.length).toBe(32);
      expect(parsed).toEqual(Buffer.from(hexKey, "hex"));
    });

    it("parses 44-character base64 encoded master key", () => {
      const b64Key = Buffer.alloc(32, 7).toString("base64");
      const parsed = parseMasterKey(b64Key);
      expect(parsed.length).toBe(32);
      expect(parsed).toEqual(Buffer.alloc(32, 7));
    });

    it("throws descriptive error for invalid master key length", () => {
      expect(() => parseMasterKey("")).toThrow("KEY_ENCRYPTION_SECRET is empty.");
      expect(() => parseMasterKey("short-secret")).toThrow(/must decode to exactly 32 bytes/);
      expect(() => parseMasterKey("0".repeat(30))).toThrow(/must decode to exactly 32 bytes/);
    });
  });

  describe("AES-256-GCM Round-Trip Encryption and Decryption", () => {
    it("successfully encrypts and decrypts provider API key", () => {
      const originalKey = "sk-ant-api03-live-abcdef1234567890ContextaSecretKey";
      const aad = keyAad("user-123", "anthropic");

      const material = encryptProviderKey(originalKey, masterKey, aad);
      expect(material.ciphertext).toBeInstanceOf(Buffer);
      expect(material.iv.length).toBe(12); // Standard GCM IV length
      expect(material.authTag.length).toBe(16); // GCM 128-bit authentication tag

      const decrypted = decryptProviderKey(material, masterKey, aad);
      expect(decrypted).toBe(originalKey);
    });

    it("generates a distinct IV and distinct ciphertext for every encryption call", () => {
      const originalKey = "sk-openai-fixed-value-for-entropy-check";
      const aad = keyAad("user-1", "openai");

      const enc1 = encryptProviderKey(originalKey, masterKey, aad);
      const enc2 = encryptProviderKey(originalKey, masterKey, aad);

      expect(enc1.iv).not.toEqual(enc2.iv);
      expect(enc1.ciphertext).not.toEqual(enc2.ciphertext);
      expect(enc1.authTag).not.toEqual(enc2.authTag);

      // Both decrypt back to original
      expect(decryptProviderKey(enc1, masterKey, aad)).toBe(originalKey);
      expect(decryptProviderKey(enc2, masterKey, aad)).toBe(originalKey);
    });

    it("rejects encryption of empty plaintext key", () => {
      const aad = keyAad("user-1", "gemini");
      expect(() => encryptProviderKey("", masterKey, aad)).toThrow("Provider key must not be empty.");
    });
  });

  describe("Cryptographic Authenticated Data (AAD) and Tamper Resistance", () => {
    it("fails decryption if AAD is swapped (e.g. mismatched userId or provider)", () => {
      const originalKey = "sk-secret-key-123";
      const correctAad = keyAad("user-alice", "openai");
      const wrongUserAad = keyAad("user-mallory", "openai");
      const wrongProviderAad = keyAad("user-alice", "anthropic");

      const material = encryptProviderKey(originalKey, masterKey, correctAad);

      // Decrypting with wrong user AAD must fail
      expect(() => decryptProviderKey(material, masterKey, wrongUserAad)).toThrow(
        "Provider key could not be decrypted.",
      );

      // Decrypting with wrong provider AAD must fail
      expect(() => decryptProviderKey(material, masterKey, wrongProviderAad)).toThrow(
        "Provider key could not be decrypted.",
      );
    });

    it("fails decryption if ciphertext is tampered by 1 bit", () => {
      const originalKey = "sk-secret-key-456";
      const aad = keyAad("user-1", "gemini");
      const material = encryptProviderKey(originalKey, masterKey, aad);

      // Tamper ciphertext
      const corruptedCiphertext = Buffer.from(material.ciphertext);
      corruptedCiphertext[0] ^= 0x01; // flip 1 bit

      expect(() =>
        decryptProviderKey(
          { ...material, ciphertext: corruptedCiphertext },
          masterKey,
          aad,
        ),
      ).toThrow("Provider key could not be decrypted.");
    });

    it("fails decryption if authTag is tampered", () => {
      const originalKey = "sk-secret-key-789";
      const aad = keyAad("user-1", "gemini");
      const material = encryptProviderKey(originalKey, masterKey, aad);

      // Tamper authTag
      const corruptedTag = Buffer.from(material.authTag);
      corruptedTag[0] ^= 0x01;

      expect(() =>
        decryptProviderKey(
          { ...material, authTag: corruptedTag },
          masterKey,
          aad,
        ),
      ).toThrow("Provider key could not be decrypted.");
    });

    it("fails decryption if master key does not match", () => {
      const originalKey = "sk-secret-key-abc";
      const aad = keyAad("user-1", "gemini");
      const material = encryptProviderKey(originalKey, masterKey, aad);

      const differentMasterKey = parseMasterKey("b".repeat(64));
      expect(() =>
        decryptProviderKey(material, differentMasterKey, aad),
      ).toThrow("Provider key could not be decrypted.");
    });
  });

  describe("Security and Constant-Time Comparison", () => {
    it("keysEqual provides constant-time equality check", () => {
      const buf1 = Buffer.from("constant-time-token-sample");
      const buf2 = Buffer.from("constant-time-token-sample");
      const buf3 = Buffer.from("constant-time-token-differ");

      expect(keysEqual(buf1, buf2)).toBe(true);
      expect(keysEqual(buf1, buf3)).toBe(false);
      expect(keysEqual(buf1, Buffer.alloc(10))).toBe(false); // different length
    });
  });
});

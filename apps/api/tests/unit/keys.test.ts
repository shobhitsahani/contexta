import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptProviderKey,
  encryptProviderKey,
  keyAad,
  keysEqual,
  parseMasterKey,
} from '../../src/services/keys.js';

const MASTER_HEX = '11'.repeat(32);
const MASTER_KEY = parseMasterKey(MASTER_HEX);
const PLAINTEXT = 'sk-live-super-secret-provider-key';
const USER_ID = '4f0f2f2c-1c1b-4f0b-9a59-2f8f7f6d5e4d';

describe('key encryption', () => {
  it('roundtrips a provider key with AAD binding', () => {
    const encrypted = encryptProviderKey(
      PLAINTEXT,
      MASTER_KEY,
      keyAad(USER_ID, 'openai'),
    );

    expect(encrypted.ciphertext.toString('utf8')).not.toContain(PLAINTEXT);
    expect(encrypted.iv).toHaveLength(12);
    expect(encrypted.authTag).toHaveLength(16);

    const decrypted = decryptProviderKey(
      encrypted,
      MASTER_KEY,
      keyAad(USER_ID, 'openai'),
    );
    expect(decrypted).toBe(PLAINTEXT);
  });

  it('uses a fresh IV for every encryption', () => {
    const aad = keyAad(USER_ID, 'gemini');
    const first = encryptProviderKey(PLAINTEXT, MASTER_KEY, aad);
    const second = encryptProviderKey(PLAINTEXT, MASTER_KEY, aad);

    expect(first.iv.equals(second.iv)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it('rejects the wrong AAD (row swapping)', () => {
    const encrypted = encryptProviderKey(
      PLAINTEXT,
      MASTER_KEY,
      keyAad(USER_ID, 'openai'),
    );
    expect(() =>
      decryptProviderKey(
        encrypted,
        MASTER_KEY,
        keyAad(USER_ID, 'anthropic'),
      ),
    ).toThrow('could not be decrypted');
    expect(() =>
      decryptProviderKey(
        encrypted,
        MASTER_KEY,
        keyAad('00000000-0000-4000-8000-000000000000', 'openai'),
      ),
    ).toThrow('could not be decrypted');
  });

  it('rejects a tampered ciphertext or auth tag', () => {
    const aad = keyAad(USER_ID, 'openai');
    const encrypted = encryptProviderKey(PLAINTEXT, MASTER_KEY, aad);

    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;
    expect(() =>
      decryptProviderKey(
        { ...encrypted, ciphertext: tamperedCiphertext },
        MASTER_KEY,
        aad,
      ),
    ).toThrow();

    const tamperedTag = Buffer.from(encrypted.authTag);
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;
    expect(() =>
      decryptProviderKey(
        { ...encrypted, authTag: tamperedTag },
        MASTER_KEY,
        aad,
      ),
    ).toThrow();
  });

  it('rejects the wrong master key', () => {
    const encrypted = encryptProviderKey(
      PLAINTEXT,
      MASTER_KEY,
      keyAad(USER_ID, 'openai'),
    );
    const otherKey = parseMasterKey(randomBytes(32).toString('base64'));
    expect(() =>
      decryptProviderKey(
        encrypted,
        otherKey,
        keyAad(USER_ID, 'openai'),
      ),
    ).toThrow();
  });

  it('parses hex, base64 and raw 32-byte secrets', () => {
    expect(parseMasterKey(MASTER_HEX)).toHaveLength(32);
    expect(parseMasterKey(randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(parseMasterKey('b'.repeat(32))).toHaveLength(32);
  });

  it('rejects malformed master keys', () => {
    expect(() => parseMasterKey('')).toThrow();
    expect(() => parseMasterKey('short')).toThrow();
    expect(() => parseMasterKey('a'.repeat(31))).toThrow();
    expect(() => parseMasterKey('a'.repeat(33))).toThrow();
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow();
  });

  it('compares buffers in constant time', () => {
    expect(keysEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(keysEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(keysEqual(Buffer.from('abc'), Buffer.from('ab'))).toBe(false);
  });
});

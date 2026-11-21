import { describe, expect, it } from 'vitest';
import { HttpProviderValidator } from '../../src/services/providerValidation.js';

function response(status: number): Response {
  return new Response(null, { status });
}

function validatorWith(
  handler: (url: string, init: RequestInit) => Promise<Response>,
) {
  return new HttpProviderValidator({
    timeoutMs: 2_000,
    fetchImpl: handler as typeof fetch,
  });
}

describe('provider key validation', () => {
  it('accepts a valid OpenAI key and sends it in the header', async () => {
    let seenUrl = '';
    let seenHeaders: HeadersInit | undefined;
    const validator = validatorWith(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return response(200);
    });

    await validator.validate('openai', 'sk-test');
    expect(seenUrl).toBe('https://api.openai.com/v1/models');
    expect(new Headers(seenHeaders).get('authorization')).toBe('Bearer sk-test');
    expect(seenUrl).not.toContain('sk-test');
  });

  it('accepts a valid Anthropic key with the version header', async () => {
    let seenHeaders: HeadersInit | undefined;
    const validator = validatorWith(async (_url, init) => {
      seenHeaders = init.headers;
      return response(200);
    });
    await validator.validate('anthropic', 'sk-ant-test');
    const headers = new Headers(seenHeaders);
    expect(headers.get('x-api-key')).toBe('sk-ant-test');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it('sends the Gemini key in a header, never the query string', async () => {
    let seenUrl = '';
    let seenHeaders: HeadersInit | undefined;
    const validator = validatorWith(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return response(200);
    });

    await validator.validate('gemini', 'AIza-test');
    expect(seenUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models',
    );
    expect(seenUrl).not.toContain('AIza-test');
    expect(new Headers(seenHeaders).get('x-goog-api-key')).toBe('AIza-test');
  });

  it('accepts 429 because the credential was recognized', async () => {
    const validator = validatorWith(async () => response(429));
    await expect(
      validator.validate('openai', 'sk-test'),
    ).resolves.toBeUndefined();
  });

  it('rejects a key the provider says is invalid', async () => {
    const validator = validatorWith(async () => response(401));
    await expect(
      validator.validate('openai', 'sk-bad'),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PROVIDER_KEY_INVALID',
    });
    await expect(
      validator.validate('openai', 'sk-bad'),
    ).rejects.not.toThrow(/sk-bad/);
  });

  it('treats Gemini 400 as an invalid key', async () => {
    const validator = validatorWith(async () => response(400));
    await expect(
      validator.validate('gemini', 'bad'),
    ).rejects.toMatchObject({ code: 'PROVIDER_KEY_INVALID' });
  });

  it('maps provider 5xx and network errors to unavailable', async () => {
    const serverError = validatorWith(async () => response(503));
    await expect(
      serverError.validate('anthropic', 'key'),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    const networkError = validatorWith(async () => {
      throw new TypeError('network down');
    });
    await expect(
      networkError.validate('openai', 'key'),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

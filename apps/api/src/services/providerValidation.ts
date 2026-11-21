import type { Provider } from '@contexta/shared';
import { AppError } from '../lib/errors.js';

export interface ProviderValidator {
  validate(provider: Provider, apiKey: string): Promise<void>;
}

export interface ProviderValidatorOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface ProviderEndpoint {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
  /** Gemini reports an invalid key as 400 rather than 401. */
  invalidStatuses: readonly number[];
}

const ENDPOINTS: Record<Provider, ProviderEndpoint> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    }),
    invalidStatuses: [401, 403],
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    }),
    invalidStatuses: [401, 403],
  },
  gemini: {
    // Key goes in a header, never a query string, so it cannot leak via logs.
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: (apiKey) => ({
      'x-goog-api-key': apiKey,
      Accept: 'application/json',
    }),
    invalidStatuses: [400, 401, 403],
  },
};

/**
 * Validates BYOK keys with a read-only provider call. URLs are fixed (no custom
 * base URLs), which removes the SSRF surface. 429 means the credential was
 * accepted but throttled, so it is treated as valid.
 */
export class HttpProviderValidator implements ProviderValidator {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ProviderValidatorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async validate(provider: Provider, apiKey: string): Promise<void> {
    const endpoint = ENDPOINTS[provider];
    if (!endpoint) {
      throw AppError.badRequest('Unsupported provider.');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint.url, {
        method: 'GET',
        headers: endpoint.headers(apiKey),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw AppError.providerUnavailable();
    }

    if (response.ok || response.status === 429) {
      return;
    }
    if (endpoint.invalidStatuses.includes(response.status)) {
      throw AppError.providerKeyInvalid();
    }
    if (response.status >= 500) {
      throw AppError.providerUnavailable();
    }
    throw AppError.providerKeyInvalid();
  }
}

export function createProviderValidator(
  options: ProviderValidatorOptions,
): ProviderValidator {
  return new HttpProviderValidator(options);
}

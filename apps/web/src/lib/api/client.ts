import { type ErrorCode } from "@contexta/shared";
import { AppError } from "@/lib/types";

const API_URL = (() => {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) {
    const base = process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    return base.endsWith("/api") ? base : `${base}/api`;
  }
  return "/api";
})();

let wakingUntil: number | null = null;
const WAKE_WINDOW_MS = 6000;

export function markWaking() {
  wakingUntil = Date.now() + WAKE_WINDOW_MS;
}

export function isWaking() {
  return wakingUntil !== null && Date.now() < wakingUntil;
}

function getHeaders(init?: RequestInit): HeadersInit {
  const headers: HeadersInit = { Accept: "application/json" };
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => (headers as any)[k] = v);
    } else if (Array.isArray(init.headers)) {
      (init.headers as [string, string][]).forEach(([k, v]) => (headers as any)[k] = v);
    } else {
      Object.assign(headers, init.headers);
    }
  }
  return headers;
}

function resolveUrl(input: RequestInfo | URL): string {
  const str = String(input);
  if (str.startsWith("http://") || str.startsWith("https://")) {
    return str;
  }
  const cleanPath = str.startsWith("/") ? str : `/${str}`;
  if (cleanPath.startsWith("/api/") || cleanPath === "/api") {
    return cleanPath;
  }
  return `${API_URL}${cleanPath}`;
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const url = resolveUrl(input);
  markWaking();

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: getHeaders(init) });
  } catch {
    throw new AppError({
      code: "INTERNAL_ERROR",
      message: "Unable to reach the server. It may be waking up — please try again.",
      status: 0,
    });
  }

  if (!res.ok) {
    let code: ErrorCode = "INTERNAL_ERROR";
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code as ErrorCode;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore parse errors
    }
    throw new AppError({ code, message, status: res.status });
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return null as unknown as T;
}

export async function* streamEvents(
  input: RequestInfo | URL,
  init: RequestInit = {},
): AsyncGenerator<unknown> {
  const url = resolveUrl(input);
  markWaking();

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: getHeaders(init) });
  } catch {
    throw new AppError({
      code: "INTERNAL_ERROR",
      message: "Unable to reach the server to stream the response.",
      status: 0,
    });
  }

  if (!res.ok || !res.body) {
    let code: ErrorCode = "INTERNAL_ERROR";
    let message = `Stream failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code as ErrorCode;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore
    }
    throw new AppError({ code, message, status: res.status });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed.startsWith("data: ")) {
          const payload = trimmed.slice(6);
          try {
            yield JSON.parse(payload);
          } catch {
            yield { type: "error", code: "INTERNAL_ERROR", message: "Malformed stream event" } as const;
          }
        }
      }
    }
    yield { type: "done" } as const;
  } finally {
    reader.releaseLock();
  }
}

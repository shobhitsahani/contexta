import { describe, it, expect } from "vitest";
import { AppError } from "../../src/lib/errors.js";

describe("AppError", () => {
  it("badRequest -> 400 VALIDATION_ERROR", () => {
    const e = AppError.badRequest("oops");
    expect(e.status).toBe(400);
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("oops");
  });

  it("unauthorized -> 401", () => {
    expect(AppError.unauthorized().status).toBe(401);
    expect(AppError.unauthorized().code).toBe("UNAUTHORIZED");
  });

  it("notFound -> 404", () => {
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.notFound().code).toBe("NOT_FOUND");
  });

  it("keyRequired -> 402 KEY_REQUIRED", () => {
    expect(AppError.keyRequired().status).toBe(402);
    expect(AppError.keyRequired().code).toBe("KEY_REQUIRED");
  });

  it("rateLimited -> 429", () => {
    expect(AppError.rateLimited().status).toBe(429);
    expect(AppError.rateLimited().code).toBe("RATE_LIMITED");
  });

  it("providerKeyInvalid -> 400 PROVIDER_KEY_INVALID", () => {
    expect(AppError.providerKeyInvalid().status).toBe(400);
    expect(AppError.providerKeyInvalid().code).toBe("PROVIDER_KEY_INVALID");
  });

  it("providerUnavailable -> 502", () => {
    expect(AppError.providerUnavailable().status).toBe(502);
    expect(AppError.providerUnavailable().code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("emailNotVerified -> 403 EMAIL_NOT_VERIFIED", () => {
    expect(AppError.emailNotVerified().status).toBe(403);
    expect(AppError.emailNotVerified().code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("internal -> 500, not exposed", () => {
    const e = AppError.internal();
    expect(e.status).toBe(500);
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.expose).toBe(false);
  });

  it("expose defaults to status < 500", () => {
    expect(AppError.badRequest().expose).toBe(true);
    expect(AppError.internal().expose).toBe(false);
    expect(AppError.internal("x", { expose: true }).expose).toBe(true);
  });
});

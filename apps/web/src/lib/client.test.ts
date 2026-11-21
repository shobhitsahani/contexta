import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppError } from "./types";
import { isWaking, markWaking } from "./api/client";

describe("API Client & Error State", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates AppError with status and code", () => {
    const error = new AppError({
      code: "KEY_REQUIRED",
      message: "API key is required",
      status: 402,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.code).toBe("KEY_REQUIRED");
    expect(error.message).toBe("API key is required");
    expect(error.status).toBe(402);
  });

  it("handles markWaking and isWaking window correctly", () => {
    markWaking();
    expect(isWaking()).toBe(true);
  });
});

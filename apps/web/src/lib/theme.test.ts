import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
} from "./theme-core";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => (store[key] === undefined ? null : store[key])),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

beforeEach(() => {
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.clear();
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("getStoredTheme returns null when nothing stored", () => {
    localStorageMock.getItem.mockReturnValue(null);
    expect(getStoredTheme()).toBeNull();
  });

  it("getStoredTheme returns stored value", () => {
    localStorageMock.getItem.mockReturnValue("dark");
    expect(getStoredTheme()).toBe("dark");
  });

  it("resolveTheme returns stored light/dark", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolveTheme falls back to system for null/system", () => {
    const matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList));
    Object.defineProperty(window, "matchMedia", { value: matchMedia, writable: true });
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("getSystemTheme respects prefers-color-scheme", () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({ matches: false } as MediaQueryList)),
      writable: true,
    });
    expect(getSystemTheme()).toBe("light");
  });
});

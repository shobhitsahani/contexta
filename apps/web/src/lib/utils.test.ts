import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges tailwind conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("joins classes", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("handles no input", () => {
    expect(cn()).toBe("");
  });
});

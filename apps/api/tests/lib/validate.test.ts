import { describe, it, expect } from "vitest";
import { parseOrThrow } from "../../src/lib/validate.js";
import { z } from "zod";

describe("parseOrThrow", () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().nonnegative(),
  });

  it("returns parsed data for valid input", () => {
    const data = parseOrThrow(schema, { name: "Ada", age: 30 });
    expect(data).toEqual({ name: "Ada", age: 30 });
  });

  it("throws AppError with VALIDATION_ERROR for invalid input", () => {
    expect(() => parseOrThrow(schema, { name: "", age: -1 })).toThrow();
    try {
      parseOrThrow(schema, { name: "", age: -1 });
    } catch (e: any) {
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(e.status).toBe(400);
      expect(e.message).toContain("name");
    }
  });

  it("throws for wrong types", () => {
    expect(() => parseOrThrow(schema, { name: 123, age: "old" })).toThrow();
  });
});

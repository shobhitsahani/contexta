import { describe, it, expect } from "vitest";

describe("Markdown & Citations Syntax", () => {
  it("detects citation numbers in bracketed format", () => {
    const text = "According to Section 4 [1], carryover is permitted up to 5 days [2].";
    const matches = Array.from(text.matchAll(/\[(\d+)\]/g)).map((m) => parseInt(m[1], 10));

    expect(matches).toEqual([1, 2]);
  });

  it("extracts multiple citations correctly", () => {
    const text = "Policies [1][2] require review.";
    const matches = Array.from(text.matchAll(/\[(\d+)\]/g)).map((m) => parseInt(m[1], 10));

    expect(matches).toEqual([1, 2]);
  });

  it("validates supported document formats", () => {
    const supported = ["pdf", "docx", "txt"];
    const isSupported = (filename: string) => {
      const ext = filename.split(".").pop()?.toLowerCase();
      return supported.includes(ext || "");
    };

    expect(isSupported("handbook.pdf")).toBe(true);
    expect(isSupported("contract.docx")).toBe(true);
    expect(isSupported("notes.txt")).toBe(true);
    expect(isSupported("archive.zip")).toBe(false);
    expect(isSupported("image.png")).toBe(false);
  });
});

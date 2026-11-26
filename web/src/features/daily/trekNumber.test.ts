import { describe, it, expect } from "vitest";
import { trekNumber, DAILY_EPOCH } from "./trekNumber";

describe("trekNumber", () => {
  it("numbers the epoch day as Trek #1", () => {
    expect(trekNumber(DAILY_EPOCH)).toBe(1);
    expect(trekNumber("2026-11-26")).toBe(1);
  });

  it("counts up by one per calendar day", () => {
    expect(trekNumber("2026-11-27")).toBe(2);
    expect(trekNumber("2026-12-06")).toBe(11);
  });

  it("crosses month boundaries via UTC days", () => {
    expect(trekNumber("2026-12-26")).toBe(31); // 30 days after the epoch
  });

  it("is <= 0 before launch", () => {
    expect(trekNumber("2026-11-25")).toBe(0);
  });
});

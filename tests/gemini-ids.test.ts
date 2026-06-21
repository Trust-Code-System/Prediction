import { describe, it, expect } from "vitest";
import { stableId, isSyntheticId, SYNTHETIC_ID_BASE } from "@/lib/ingest/gemini";

const RANGE = 1_000_000_000;

describe("stableId", () => {
  it("is deterministic for the same parts", () => {
    expect(stableId("team", "Ajax")).toBe(stableId("team", "Ajax"));
    expect(stableId("fixture", "Ajax", "PSV", "2026-06-20")).toBe(
      stableId("fixture", "Ajax", "PSV", "2026-06-20")
    );
  });

  it("is case-insensitive", () => {
    expect(stableId("team", "Ajax")).toBe(stableId("TEAM", "AJAX"));
  });

  it("differs for different inputs", () => {
    expect(stableId("team", "Ajax")).not.toBe(stableId("team", "PSV"));
    expect(stableId("team", "Ajax")).not.toBe(stableId("venue", "Ajax"));
  });

  it("always lands inside the synthetic id range", () => {
    for (const name of ["Ajax", "PSV", "Feyenoord", "AZ", "", "a very long club name here"]) {
      const id = stableId("team", name);
      expect(id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE);
      expect(id).toBeLessThan(SYNTHETIC_ID_BASE + RANGE);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});

describe("isSyntheticId", () => {
  it("is true for ids minted by stableId", () => {
    expect(isSyntheticId(stableId("team", "Ajax"))).toBe(true);
  });

  it("is false for small real API-Football ids", () => {
    expect(isSyntheticId(1035398)).toBe(false);
    expect(isSyntheticId(0)).toBe(false);
  });

  it("is false just below and at the top of the range", () => {
    expect(isSyntheticId(SYNTHETIC_ID_BASE - 1)).toBe(false);
    expect(isSyntheticId(SYNTHETIC_ID_BASE + RANGE)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  formatRefereeContext,
  refereeSlug,
  validateRefereeProfile
} from "@/lib/ingest/referee";

describe("refereeSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(refereeSlug("Michael Oliver")).toBe("michael-oliver");
  });
  it("strips accents", () => {
    expect(refereeSlug("Antonio Mateu Lahoz")).toBe("antonio-mateu-lahoz");
    expect(refereeSlug("Clément Turpin")).toBe("clement-turpin");
  });
  it("strips punctuation and collapses spacing", () => {
    expect(refereeSlug("  O'Brien,  John  ")).toBe("o-brien-john");
  });
  it("is stable across casing/spacing variants", () => {
    expect(refereeSlug("Michael  OLIVER")).toBe(refereeSlug("michael oliver"));
  });
});

describe("validateRefereeProfile", () => {
  it("accepts a well-formed object", () => {
    const r = validateRefereeProfile(
      JSON.stringify({
        avg_cards: 4.2,
        penalty_tendency: "awards penalties at an average rate",
        strictness: "strict",
        summary: "A card-heavy official who lets little go."
      })
    );
    expect(r).not.toBeNull();
    expect(r?.avg_cards).toBe(4.2);
    expect(r?.strictness).toBe("strict");
  });

  it("returns null for non-JSON", () => {
    expect(validateRefereeProfile("nope")).toBeNull();
  });

  it("coerces an out-of-range or non-numeric avg_cards to null", () => {
    expect(validateRefereeProfile(JSON.stringify({ avg_cards: 99 }))?.avg_cards).toBeNull();
    expect(validateRefereeProfile(JSON.stringify({ avg_cards: "lots" }))?.avg_cards).toBeNull();
  });

  it("parses a numeric string avg_cards", () => {
    expect(validateRefereeProfile(JSON.stringify({ avg_cards: "3.7" }))?.avg_cards).toBe(3.7);
  });

  it("drops an invalid strictness", () => {
    expect(validateRefereeProfile(JSON.stringify({ strictness: "savage" }))?.strictness).toBeNull();
  });

  it("strips em dashes from text fields", () => {
    const r = validateRefereeProfile(
      JSON.stringify({ summary: "Strict referee — quick to book." })
    );
    expect(r?.summary).not.toContain("—");
  });

  it("tolerates missing fields (all null)", () => {
    const r = validateRefereeProfile(JSON.stringify({}));
    expect(r).toEqual({
      avg_cards: null,
      penalty_tendency: null,
      strictness: null,
      summary: null
    });
  });
});

describe("formatRefereeContext", () => {
  it("notes when no referee is assigned", () => {
    expect(formatRefereeContext(null, null)).toBe("No referee assigned yet.");
  });

  it("shows limited data when there is a name but no profile", () => {
    const out = formatRefereeContext("Michael Oliver", null);
    expect(out).toContain("Michael Oliver");
    expect(out).toContain("limited official data");
  });

  it("includes the tendencies when present", () => {
    const out = formatRefereeContext("Michael Oliver", {
      avg_cards: 4.1,
      penalty_tendency: "average",
      strictness: "strict",
      summary: "Lets little go."
    });
    expect(out).toContain("4.1");
    expect(out).toContain("strict");
    expect(out).toContain("Lets little go.");
  });

  it("contains no em dashes", () => {
    const out = formatRefereeContext("Ref Name", { avg_cards: 3, penalty_tendency: null, strictness: "average", summary: null });
    expect(out).not.toContain("—");
  });
});

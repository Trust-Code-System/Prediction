import { describe, it, expect } from "vitest";
import { validateNewsSignals } from "@/lib/ingest/news-signals";

describe("validateNewsSignals", () => {
  it("returns null for non-JSON", () => {
    expect(validateNewsSignals("not json")).toBeNull();
  });

  it("returns null for a non-object JSON value", () => {
    expect(validateNewsSignals("[1,2,3]")).toBeNull();
    expect(validateNewsSignals("42")).toBeNull();
  });

  it("normalizes a full object", () => {
    const s = validateNewsSignals(
      JSON.stringify({
        home_form_summary: "Won 3 of last 4",
        away_form_summary: "Drew last 2",
        key_players: [{ team: "home", name: "Striker", note: "in form" }],
        injuries: [{ team: "away", name: "Keeper", note: "doubtful" }]
      })
    );
    expect(s).not.toBeNull();
    expect(s!.home_form_summary).toBe("Won 3 of last 4");
    expect(s!.key_players).toHaveLength(1);
    expect(s!.injuries[0]).toEqual({ team: "away", name: "Keeper", note: "doubtful" });
  });

  it("defaults missing fields to null and empty arrays", () => {
    const s = validateNewsSignals("{}");
    expect(s).toEqual({
      home_form_summary: null,
      away_form_summary: null,
      key_players: [],
      injuries: []
    });
  });

  it("drops players with an invalid team or missing name", () => {
    const s = validateNewsSignals(
      JSON.stringify({
        key_players: [
          { team: "midfield", name: "X", note: "" },
          { team: "home", note: "no name" },
          { team: "home", name: "Valid", note: "keep" }
        ]
      })
    );
    expect(s!.key_players).toHaveLength(1);
    expect(s!.key_players[0].name).toBe("Valid");
  });

  it("strips em dashes from summaries and notes", () => {
    const s = validateNewsSignals(
      JSON.stringify({
        home_form_summary: "Strong—unbeaten run",
        key_players: [{ team: "home", name: "X", note: "sharp—clinical" }]
      })
    );
    expect(s!.home_form_summary).not.toContain("—");
    expect(s!.key_players[0].note).not.toContain("—");
  });

  it("caps key_players at 6 and injuries at 8", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ team: "home", name: `P${i}`, note: "" }));
    const s = validateNewsSignals(
      JSON.stringify({ key_players: many(10), injuries: many(12) })
    );
    expect(s!.key_players).toHaveLength(6);
    expect(s!.injuries).toHaveLength(8);
  });

  it("treats an empty-string summary as null", () => {
    const s = validateNewsSignals(JSON.stringify({ home_form_summary: "   " }));
    expect(s!.home_form_summary).toBeNull();
  });
});

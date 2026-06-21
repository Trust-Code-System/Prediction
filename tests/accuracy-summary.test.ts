import { describe, it, expect } from "vitest";
import { summarizeResults, pct } from "@/lib/accuracy/read";
import type { PredictionResultEnrichedRow } from "@/lib/types";

function row(over: Partial<PredictionResultEnrichedRow>): PredictionResultEnrichedRow {
  return {
    fixture_id: 1,
    home_goals: 2,
    away_goals: 1,
    predicted_outcome: "home_win",
    actual_outcome: "home_win",
    winner_correct: true,
    btts_pick: "yes",
    btts_correct: true,
    ou_pick: "over",
    ou_correct: true,
    scoreline_lean: "2-1",
    scoreline_correct: true,
    confidence: "medium",
    model: "claude-opus-4-8",
    graded_at: "2026-06-20T00:00:00Z",
    kickoff_at: "2026-06-20T15:00:00Z",
    league_id: 39,
    league: "Premier League",
    home_team: "A",
    away_team: "B",
    ...over
  };
}

describe("pct", () => {
  it("rounds a ratio", () => expect(pct({ correct: 1, total: 3 })).toBe(33));
  it("returns null for an empty tally", () => expect(pct({ correct: 0, total: 0 })).toBeNull());
});

describe("summarizeResults", () => {
  it("counts winner accuracy across rows", () => {
    const rows = [row({}), row({ winner_correct: false })];
    const s = summarizeResults(rows);
    expect(s.graded).toBe(2);
    expect(s.byMarket.winner).toEqual({ correct: 1, total: 2 });
  });

  it("excludes null goals-market picks from the market totals", () => {
    const rows = [
      row({}),
      row({ btts_pick: null, btts_correct: null, ou_pick: null, ou_correct: null })
    ];
    const s = summarizeResults(rows);
    expect(s.byMarket.btts).toEqual({ correct: 1, total: 1 });
    expect(s.byMarket.ou).toEqual({ correct: 1, total: 1 });
    // winner still counts both rows
    expect(s.byMarket.winner.total).toBe(2);
  });

  it("groups winner accuracy by league, most-graded first", () => {
    const rows = [
      row({ league: "Premier League" }),
      row({ league: "Premier League", winner_correct: false }),
      row({ league: "La Liga" })
    ];
    const s = summarizeResults(rows);
    expect(s.byLeague[0].name).toBe("Premier League");
    expect(s.byLeague[0].tally).toEqual({ correct: 1, total: 2 });
    expect(s.byLeague[1].name).toBe("La Liga");
  });

  it("groups by month, newest first", () => {
    const rows = [
      row({ kickoff_at: "2026-05-10T15:00:00Z" }),
      row({ kickoff_at: "2026-06-10T15:00:00Z" })
    ];
    const s = summarizeResults(rows);
    expect(s.byMonth[0].name).toBe("2026-06");
    expect(s.byMonth[1].name).toBe("2026-05");
  });

  it("falls back to 'Other' when league is null", () => {
    const s = summarizeResults([row({ league: null })]);
    expect(s.byLeague[0].name).toBe("Other");
  });
});

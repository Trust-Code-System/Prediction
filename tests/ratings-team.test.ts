import { describe, it, expect } from "vitest";
import { computeTeamStrength, type TeamStrengthInput } from "@/lib/ratings/team";
import { scale, clamp } from "@/lib/ratings/scale";
import type { FormResult, PlayerRow, StandingRow } from "@/lib/types";

function standing(over: Partial<StandingRow> = {}): StandingRow {
  return {
    id: 1,
    league_id: 10,
    season: 2026,
    team_id: 100,
    rank: 1,
    points: 60,
    goals_diff: 30,
    played: 30,
    win: 18,
    draw: 6,
    lose: 6,
    goals_for: 60,
    goals_against: 24,
    form: "WWWDW",
    fetched_at: "",
    ...over
  };
}

function form(results: Array<Partial<FormResult>>): { id: number; team_id: number | null; fixture_id: number | null; last5: FormResult[]; fetched_at: string } {
  return {
    id: 1,
    team_id: 100,
    fixture_id: 1,
    last5: results.map((r, i) => ({
      fixture_id: i,
      opponent: "X",
      home_away: "home",
      goals_for: 1,
      goals_against: 1,
      result: "D",
      date: "2026-06-01",
      ...r
    })),
    fetched_at: ""
  };
}

function midfielder(rating: number, assists = 5): PlayerRow {
  return {
    id: Math.floor(Math.random() * 1e9),
    team_id: 100,
    name: "Mid",
    position: "Midfielder",
    photo: null,
    season: 2026,
    season_stats: {
      appearances: 30,
      goals: 2,
      assists,
      minutes: 2500,
      shots: 20,
      shots_on: 8,
      rating,
      yellow_cards: 2,
      red_cards: 0
    },
    fetched_at: ""
  };
}

const EMPTY: TeamStrengthInput = { standing: null, form: null, players: [] };

describe("scale", () => {
  it("maps min to 0 and max to 100", () => {
    expect(scale(0, 0, 10)).toBe(0);
    expect(scale(10, 0, 10)).toBe(100);
    expect(scale(5, 0, 10)).toBe(50);
  });
  it("clamps out-of-range values", () => {
    expect(scale(-5, 0, 10)).toBe(0);
    expect(scale(50, 0, 10)).toBe(100);
  });
  it("guards a zero-width range", () => {
    expect(scale(5, 5, 5)).toBe(0);
  });
  it("clamp bounds", () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe("computeTeamStrength", () => {
  it("rates a strong side higher than a weak side on attack, defense, overall", () => {
    const strong = computeTeamStrength({
      standing: standing({ goals_for: 75, goals_against: 18, points: 75, form: "WWWWW" }),
      form: form([{ result: "W", goals_for: 3, goals_against: 0 }]),
      players: [midfielder(7.4)]
    });
    const weak = computeTeamStrength({
      standing: standing({ goals_for: 18, goals_against: 60, points: 20, form: "LLLDL" }),
      form: form([{ result: "L", goals_for: 0, goals_against: 3 }]),
      players: [midfielder(6.1)]
    });
    expect(strong.attack).toBeGreaterThan(weak.attack);
    expect(strong.defense).toBeGreaterThan(weak.defense);
    expect(strong.midfield).toBeGreaterThan(weak.midfield);
    expect(strong.overall).toBeGreaterThan(weak.overall);
  });

  it("keeps every axis within 0-100", () => {
    const r = computeTeamStrength({
      standing: standing({ goals_for: 200, goals_against: 0, points: 90 }),
      form: form([{ result: "W", goals_for: 9, goals_against: 0 }]),
      players: [midfielder(9.5)]
    });
    for (const v of [r.attack, r.defense, r.midfield, r.form, r.overall]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("falls back to last-5 form when there is no standing", () => {
    const r = computeTeamStrength({
      standing: null,
      form: form([
        { result: "W", goals_for: 3, goals_against: 0 },
        { result: "W", goals_for: 2, goals_against: 1 }
      ]),
      players: []
    });
    expect(r.hasData).toBe(true);
    expect(r.attack).toBeGreaterThan(0);
    expect(r.form).toBeGreaterThan(50);
  });

  it("weights recent form more heavily", () => {
    const recentWins = computeTeamStrength({
      standing: null,
      form: form([
        { result: "W" },
        { result: "W" },
        { result: "L" },
        { result: "L" },
        { result: "L" }
      ]),
      players: []
    });
    const recentLosses = computeTeamStrength({
      standing: null,
      form: form([
        { result: "L" },
        { result: "L" },
        { result: "W" },
        { result: "W" },
        { result: "W" }
      ]),
      players: []
    });
    expect(recentWins.form).toBeGreaterThan(recentLosses.form);
  });

  it("reports hasData false for a fully empty input", () => {
    const r = computeTeamStrength(EMPTY);
    expect(r.hasData).toBe(false);
    expect(r.overall).toBe(0);
  });
});

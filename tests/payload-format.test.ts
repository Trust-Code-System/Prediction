import { describe, it, expect } from "vitest";
import {
  buildNewsPlayers,
  formText,
  formatForm,
  formatKeyPlayers,
  formatNewsPlayers,
  rankKeyPlayers
} from "@/lib/prediction/payload";
import { isSyntheticId } from "@/lib/ingest/gemini";
import type { FormResult, NewsSignals, PlayerRow, PlayerSeasonStats } from "@/lib/types";

function player(id: number, name: string, stats: Partial<PlayerSeasonStats> | null): PlayerRow {
  return {
    id,
    team_id: 1,
    name,
    position: "FW",
    photo: null,
    season: 2026,
    season_stats: stats
      ? {
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0,
          shots: 0,
          shots_on: 0,
          rating: null,
          yellow_cards: 0,
          red_cards: 0,
          ...stats
        }
      : null,
    fetched_at: "2026-06-20T00:00:00Z"
  };
}

function form(result: FormResult["result"]): FormResult {
  return {
    fixture_id: Math.floor(Math.random() * 1e6),
    opponent: "Rivals",
    home_away: "home",
    goals_for: 2,
    goals_against: 1,
    result,
    date: "2026-06-01"
  };
}

describe("formatForm", () => {
  it("reports absence for null or empty", () => {
    expect(formatForm(null)).toMatch(/No recent form/);
    expect(formatForm([])).toMatch(/No recent form/);
  });
  it("summarizes populated form", () => {
    const out = formatForm([form("W"), form("L")]);
    expect(out).toMatch(/W 2-1 vs Rivals/);
  });
});

describe("formText (form with news fallback)", () => {
  it("uses last-5 form when present", () => {
    expect(formText([form("W")], "news summary")).toMatch(/W 2-1/);
  });
  it("falls back to the labelled news summary when no form", () => {
    expect(formText(null, "Unbeaten in 5")).toBe(
      "From recent news (external context): Unbeaten in 5"
    );
  });
  it("reports absence when neither is present", () => {
    expect(formText(null, null)).toMatch(/No recent form/);
  });
});

describe("rankKeyPlayers", () => {
  it("orders by attacking output and caps at 6", () => {
    const players = [
      player(1, "Low", { goals: 0, minutes: 100 }),
      player(2, "High", { goals: 10, assists: 5 }),
      player(3, "Mid", { goals: 3 }),
      player(4, "D", { goals: 1 }),
      player(5, "E", { goals: 1 }),
      player(6, "F", { goals: 1 }),
      player(7, "G", { goals: 1 })
    ];
    const ranked = rankKeyPlayers(players);
    expect(ranked).toHaveLength(6);
    expect(ranked[0].name).toBe("High");
  });
});

describe("formatKeyPlayers", () => {
  it("reports absence for empty squads", () => {
    expect(formatKeyPlayers([])).toMatch(/No player data/);
  });
  it("includes the player_id and stat line", () => {
    const out = formatKeyPlayers([player(42, "Star", { goals: 9 })]);
    expect(out).toMatch(/player_id 42/);
    expect(out).toMatch(/goals 9/);
  });
});

describe("buildNewsPlayers", () => {
  const signals: NewsSignals = {
    home_form_summary: null,
    away_form_summary: null,
    key_players: [
      { team: "home", name: "Home Star", note: "danger" },
      { team: "away", name: "Away Star", note: "creator" }
    ],
    injuries: []
  };

  it("returns [] for null signals", () => {
    expect(buildNewsPlayers(null, "home", 1)).toEqual([]);
  });

  it("filters by team and mints synthetic, deterministic ids", () => {
    const home = buildNewsPlayers(signals, "home", 8_000_000_123);
    expect(home).toHaveLength(1);
    expect(home[0].name).toBe("Home Star");
    expect(isSyntheticId(home[0].id)).toBe(true);
    // Deterministic across calls.
    expect(buildNewsPlayers(signals, "home", 8_000_000_123)[0].id).toBe(home[0].id);
  });

  it("formats news players with their player_id", () => {
    const home = buildNewsPlayers(signals, "home", 1);
    const out = formatNewsPlayers(home);
    expect(out).toMatch(/Home Star \(player_id \d+\): danger/);
  });

  it("reports absence for an empty news-player list", () => {
    expect(formatNewsPlayers([])).toMatch(/No player data/);
  });
});

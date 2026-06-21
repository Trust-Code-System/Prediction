import { describe, it, expect } from "vitest";
import { buildMatchContext } from "@/lib/chat/context";
import type { MatchView } from "@/lib/data/match";
import type { FixtureRow, PredictionRow } from "@/lib/types";

function fixture(): FixtureRow {
  return {
    id: 1,
    league_id: 10,
    home_team_id: 100,
    away_team_id: 200,
    venue_id: 5,
    kickoff_at: "2026-06-21T16:30:00Z",
    status: "scheduled",
    referee: null,
    created_at: "2026-06-20T00:00:00Z",
    home_goals: null,
    away_goals: null,
    finished_at: null
  };
}

function prediction(): PredictionRow {
  return {
    fixture_id: 1,
    outcome_probs: { home_win: 55, draw: 25, away_win: 20 },
    scoreline_lean: "2-1",
    confidence: "medium",
    player_to_watch: { player_id: 100, name: "Striker One", reason: "Top scorer with 12 goals" },
    key_factors: ["Strong home form", "Won last 3 H2H", "Top scorer fit"],
    rationale: "Home side won 4 of their last 5 and scored in every recent meeting at this venue.",
    model: "claude-opus-4-8",
    status: "published",
    generated_at: "2026-06-20T01:00:00Z",
    goals_market: {
      both_teams_to_score: { pick: "yes", probability: 60 },
      over_under_2_5: { pick: "over", probability: 58 }
    },
    best_angle: { label: "Over 2.5 goals", reason: "Four of the last five H2H went over 2.5." },
    risk_level: "medium",
    what_could_change: ["Top scorer rested", "Keeper injury confirmed"]
  };
}

/** A fully-populated view. */
function fullView(): MatchView {
  return {
    fixture: fixture(),
    league: { id: 10, name: "Premier League", country: "England", season: 2026, logo: null, coverage: null, created_at: "" },
    venue: { id: 5, name: "Home Park", city: null, capacity: null },
    homeTeam: { id: 100, name: "Home FC", league_id: 10, logo: null, venue_id: 5, created_at: "" },
    awayTeam: { id: 200, name: "Away United", league_id: 10, logo: null, venue_id: 9, created_at: "" },
    prediction: prediction(),
    homePlayers: [
      {
        id: 100,
        team_id: 100,
        name: "Striker One",
        position: "Attacker",
        photo: null,
        season: 2026,
        season_stats: {
          appearances: 30,
          goals: 12,
          assists: 5,
          minutes: 2600,
          shots: 70,
          shots_on: 35,
          rating: 7.4,
          yellow_cards: 3,
          red_cards: 0
        },
        fetched_at: ""
      }
    ],
    awayPlayers: [],
    homeForm: {
      id: 1,
      team_id: 100,
      fixture_id: 1,
      last5: [
        { fixture_id: 9, opponent: "Rivals", home_away: "home", goals_for: 2, goals_against: 0, result: "W", date: "2026-06-10" }
      ],
      fetched_at: ""
    },
    awayForm: null,
    h2h: {
      id: 1,
      home_team_id: 100,
      away_team_id: 200,
      history: [
        { fixture_id: 8, date: "2026-01-01", venue: "Home Park", home_team: "Home FC", away_team: "Away United", home_goals: 3, away_goals: 1 }
      ],
      fetched_at: ""
    },
    homeVenueRecord: {
      id: 1,
      team_id: 100,
      venue_id: 5,
      record: { played: 10, wins: 7, draws: 2, losses: 1, goals_for: 20, goals_against: 8 },
      fetched_at: ""
    },
    awayVenueRecord: null,
    homeStanding: {
      id: 1,
      league_id: 10,
      season: 2026,
      team_id: 100,
      rank: 3,
      points: 60,
      goals_diff: 25,
      played: 30,
      win: 18,
      draw: 6,
      lose: 6,
      goals_for: 55,
      goals_against: 30,
      form: "WWDWL",
      fetched_at: ""
    },
    awayStanding: null,
    injuries: [
      { id: 1, fixture_id: 1, team_id: 200, player_id: 201, player_name: "Away Defender", reason: "Hamstring", fetched_at: "" }
    ],
    news: {
      fixture_id: 1,
      items: [
        { title: "Home FC in good shape", url: "https://example.com", content: "Squad fully fit ahead of kickoff.", published_date: "2026-06-19", source: "Example" }
      ],
      query: null,
      signals: null,
      fetched_at: ""
    },
    tactical: null,
    refereeName: null,
    referee: null
  };
}

/** A sparse view: published prediction but most supporting data missing. */
function sparseView(): MatchView {
  return {
    fixture: fixture(),
    league: null,
    venue: null,
    homeTeam: { id: 100, name: "Home FC", league_id: null, logo: null, venue_id: null, created_at: "" },
    awayTeam: { id: 200, name: "Away United", league_id: null, logo: null, venue_id: null, created_at: "" },
    prediction: prediction(),
    homePlayers: [],
    awayPlayers: [],
    homeForm: null,
    awayForm: null,
    h2h: null,
    homeVenueRecord: null,
    awayVenueRecord: null,
    homeStanding: null,
    awayStanding: null,
    injuries: [],
    news: null,
    tactical: null,
    refereeName: null,
    referee: null
  };
}

describe("buildMatchContext", () => {
  it("includes the verdict and a present section", () => {
    const ctx = buildMatchContext(fullView());
    expect(ctx).toContain("MATCH CONTEXT");
    expect(ctx).toContain("Home FC to win");
    expect(ctx).toContain("Over 2.5 goals");
    expect(ctx).toContain("Home FC 3-1 Away United"); // H2H present
    expect(ctx).toContain("Away Defender"); // injury present
    expect(ctx).toContain("Striker One"); // key player present
  });

  it("cleanly marks missing sections rather than omitting them silently", () => {
    const ctx = buildMatchContext(sparseView());
    expect(ctx).toContain("No head-to-head history available.");
    expect(ctx).toContain("No standings data available.");
    expect(ctx).toContain("None reported."); // injuries
    expect(ctx).toContain("No recent news available.");
  });

  it("notes when there is no published prediction", () => {
    const v = sparseView();
    v.prediction = null;
    const ctx = buildMatchContext(v);
    expect(ctx).toContain("No published prediction is available for this match.");
  });

  it("contains no em dashes and no betting language", () => {
    const ctx = buildMatchContext(fullView());
    expect(ctx).not.toContain("—"); // em dash
    expect(ctx).not.toMatch(/\b(odds|bet|bets|wager|stake)\b/i);
  });
});

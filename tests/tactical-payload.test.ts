import { describe, it, expect } from "vitest";
import { squadByPosition } from "@/lib/tactical/payload";
import type { PlayerRow, PlayerSeasonStats } from "@/lib/types";

function player(position: string | null, minutes: number): PlayerRow {
  const stats: PlayerSeasonStats = {
    appearances: 10,
    goals: 0,
    assists: 0,
    minutes,
    shots: 0,
    shots_on: 0,
    rating: 7,
    yellow_cards: 0,
    red_cards: 0
  };
  return {
    id: Math.floor(Math.random() * 1e9),
    team_id: 100,
    name: "P",
    position,
    photo: null,
    season: 2026,
    season_stats: stats,
    fetched_at: ""
  };
}

describe("squadByPosition", () => {
  it("reports no data for an empty squad", () => {
    expect(squadByPosition([])).toBe("No squad data available.");
  });

  it("groups by position in defensive-to-attacking order", () => {
    const out = squadByPosition([
      player("Attacker", 2000),
      player("Goalkeeper", 2000),
      player("Defender", 2000),
      player("Midfielder", 2000)
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toContain("Goalkeeper");
    expect(lines[1]).toContain("Defender");
    expect(lines[2]).toContain("Midfielder");
    expect(lines[3]).toContain("Attacker");
  });

  it("counts squad size and players with regular minutes separately", () => {
    const out = squadByPosition([
      player("Defender", 2000), // regular
      player("Defender", 100), // fringe (< 450)
      player("Defender", 900) // regular
    ]);
    expect(out).toContain("Defender: 3 in squad, 2 with regular minutes");
  });

  it("buckets a missing position under Unknown", () => {
    const out = squadByPosition([player(null, 1000)]);
    expect(out).toContain("Unknown");
  });

  it("contains no em dashes", () => {
    const out = squadByPosition([player("Midfielder", 1500)]);
    expect(out).not.toContain("—");
  });
});

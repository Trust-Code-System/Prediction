import { describe, it, expect } from "vitest";
import { computePlayerImpact, rankPlayerImpact } from "@/lib/ratings/player";
import type { PlayerRow, PlayerSeasonStats } from "@/lib/types";

function player(id: number, name: string, stats: Partial<PlayerSeasonStats> | null): PlayerRow {
  return {
    id,
    team_id: 100,
    name,
    position: "Attacker",
    photo: null,
    season: 2026,
    season_stats:
      stats === null
        ? null
        : {
            appearances: 30,
            goals: 0,
            assists: 0,
            minutes: 2500,
            shots: 30,
            shots_on: 12,
            rating: 7.0,
            yellow_cards: 2,
            red_cards: 0,
            ...stats
          },
    fetched_at: ""
  };
}

describe("computePlayerImpact", () => {
  it("scores a prolific attacker above a fringe player", () => {
    const star = computePlayerImpact(
      player(1, "Star", { goals: 20, assists: 10, minutes: 2700, rating: 7.8, shots: 90 })
    );
    const fringe = computePlayerImpact(
      player(2, "Fringe", { goals: 0, assists: 0, minutes: 300, rating: 6.2, shots: 5 })
    );
    expect(star.score).toBeGreaterThan(fringe.score);
  });

  it("keeps the score within 0-100", () => {
    const r = computePlayerImpact(
      player(1, "Max", { goals: 60, assists: 40, minutes: 4000, rating: 9.9, shots: 400 })
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("scores a player with no season stats at 0", () => {
    expect(computePlayerImpact(player(3, "Unknown", null)).score).toBe(0);
  });

  it("still credits a high-rated defender via rating and minutes", () => {
    const defender = computePlayerImpact(
      player(4, "Rock", { goals: 1, assists: 1, minutes: 2700, rating: 7.5, shots: 8 })
    );
    expect(defender.score).toBeGreaterThan(0);
  });
});

describe("rankPlayerImpact", () => {
  it("orders by impact descending and sorts no-stats players last", () => {
    const players = [
      player(1, "Fringe", { goals: 0, assists: 0, minutes: 400, rating: 6.3, shots: 4 }),
      player(2, "Star", { goals: 18, assists: 9, minutes: 2600, rating: 7.7, shots: 80 }),
      player(3, "Ghost", null)
    ];
    const ranked = rankPlayerImpact(players);
    expect(ranked[0].player.name).toBe("Star");
    expect(ranked[ranked.length - 1].player.name).toBe("Ghost");
    expect(ranked[ranked.length - 1].score).toBe(0);
  });

  it("respects topN", () => {
    const players = [
      player(1, "A", { goals: 10 }),
      player(2, "B", { goals: 5 }),
      player(3, "C", { goals: 1 })
    ];
    expect(rankPlayerImpact(players, 2)).toHaveLength(2);
  });
});

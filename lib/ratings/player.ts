import type { PlayerRow, PlayerSeasonStats } from "@/lib/types";
import { scale } from "@/lib/ratings/scale";

/**
 * Per-player impact score (0-100), computed at read time from season stats. Pure
 * and reusable on the player pages in a later slice.
 *
 * Impact blends end-product (goal contributions per 90), quality (rating),
 * importance/availability (total minutes), and attacking threat (shots per 90).
 * Rating carries real weight so defenders and keepers still register a score
 * rather than collapsing to zero on an attacking-only metric.
 */

export interface PlayerImpact {
  score: number;
  breakdown: {
    contribution: number;
    rating: number;
    minutes: number;
    shots: number;
  };
}

export interface RankedPlayer {
  player: PlayerRow;
  score: number;
}

function per90(total: number, minutes: number): number {
  if (minutes <= 0) return 0;
  return total / (minutes / 90);
}

export function computePlayerImpact(player: PlayerRow): PlayerImpact {
  const s: PlayerSeasonStats | null = player.season_stats;
  if (!s) {
    return { score: 0, breakdown: { contribution: 0, rating: 0, minutes: 0, shots: 0 } };
  }

  const minutes = s.minutes ?? 0;
  const goals = s.goals ?? 0;
  const assists = s.assists ?? 0;
  const shots = s.shots ?? 0;

  // Goal contributions per 90; mapped so ~1.0 g+a per 90 reaches the top.
  const contribution = scale(per90(goals + assists, minutes), 0, 1.0);
  // Season rating; 6.0 is replacement level, 8.0 is elite.
  const rating = s.rating != null ? scale(s.rating, 6.0, 8.0) : 0;
  // Minutes as importance/availability; ~2700 (30 full games) tops out.
  const minutesScore = scale(minutes, 0, 2700);
  // Shot volume per 90 as attacking threat.
  const shotsScore = scale(per90(shots, minutes), 0, 4);

  const score =
    0.4 * contribution + 0.3 * rating + 0.2 * minutesScore + 0.1 * shotsScore;

  return {
    score: Math.round(score),
    breakdown: {
      contribution: Math.round(contribution),
      rating: Math.round(rating),
      minutes: Math.round(minutesScore),
      shots: Math.round(shotsScore)
    }
  };
}

/**
 * Players ranked by impact, highest first. Players with no season stats score 0
 * and sort last. Pass `topN` to cap the list.
 */
export function rankPlayerImpact(players: PlayerRow[], topN?: number): RankedPlayer[] {
  const ranked = players
    .map((player) => ({ player, score: computePlayerImpact(player).score }))
    .sort((a, b) => b.score - a.score);
  return topN != null ? ranked.slice(0, topN) : ranked;
}

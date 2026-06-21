import { describe, it, expect } from "vitest";
import { stripFences, validatePrediction } from "@/lib/prediction/validate";

/** A well-formed prediction object; tests clone and break individual fields. */
function validObject() {
  return {
    outcome_probs: { home_win: 40, draw: 30, away_win: 30 },
    scoreline_lean: "2-1",
    confidence: "medium",
    goals_market: {
      both_teams_to_score: { pick: "yes", probability: 62 },
      over_under_2_5: { pick: "over", probability: 58 }
    },
    best_angle: { label: "Both teams to score", reason: "Both scored in 4 of 5 H2H." },
    risk_level: "medium",
    what_could_change: ["Top scorer rested", "Keeper injury confirmed"],
    player_to_watch: { player_id: 10, name: "Striker", reason: "Top scorer" },
    key_factors: ["form", "h2h", "venue"],
    rationale: "Home side won 4 of their last 5."
  };
}
const PLAYERS = new Set([10, 11]);

describe("stripFences", () => {
  it("removes ```json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes bare ``` fences", () => {
    expect(stripFences("```\n{}\n```")).toBe("{}");
  });
  it("leaves unfenced text untouched", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("validatePrediction", () => {
  it("accepts a well-formed object", () => {
    const r = validatePrediction(JSON.stringify(validObject()), PLAYERS);
    expect(r.ok).toBe(true);
  });

  it("accepts a fenced response", () => {
    const r = validatePrediction("```json\n" + JSON.stringify(validObject()) + "\n```", PLAYERS);
    expect(r.ok).toBe(true);
  });

  it("rejects non-JSON", () => {
    const r = validatePrediction("not json", PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not valid JSON/);
  });

  it("rejects non-integer probabilities", () => {
    const obj = validObject();
    obj.outcome_probs = { home_win: 33.3, draw: 33.3, away_win: 33.4 };
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/integers/);
  });

  it("rejects probabilities that do not sum to 100", () => {
    const obj = validObject();
    obj.outcome_probs = { home_win: 40, draw: 30, away_win: 20 };
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/sum to 100/);
  });

  it("rejects a player_to_watch id absent from the payload", () => {
    const obj = validObject();
    obj.player_to_watch.player_id = 999;
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/does not appear/);
  });

  it("accepts the no-player-data placeholder when the payload has no players", () => {
    const obj = validObject();
    obj.player_to_watch = { player_id: 0, name: "No player data", reason: "Unavailable" };
    const r = validatePrediction(JSON.stringify(obj), new Set());
    expect(r.ok).toBe(true);
  });

  it("rejects key_factors that are not exactly 3 strings", () => {
    const obj = validObject();
    obj.key_factors = ["only", "two"];
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/3 non-empty/);
  });

  it("rejects an empty rationale", () => {
    const obj = validObject();
    obj.rationale = "   ";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/rationale/);
  });

  it("rejects a malformed scoreline_lean", () => {
    const obj = validObject();
    obj.scoreline_lean = "two to one";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/scoreline_lean/);
  });

  it("rejects an invalid confidence", () => {
    const obj = validObject();
    obj.confidence = "certain";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/confidence/);
  });

  it("rejects an invalid BTTS pick", () => {
    const obj = validObject();
    obj.goals_market.both_teams_to_score.pick = "maybe";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/both_teams_to_score.pick/);
  });

  it("rejects an out-of-range market probability", () => {
    const obj = validObject();
    obj.goals_market.over_under_2_5.probability = 150;
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/over_under_2_5.probability/);
  });

  it("rejects an over/under pick that is not over or under", () => {
    const obj = validObject();
    obj.goals_market.over_under_2_5.pick = "exactly";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/over_under_2_5.pick/);
  });

  it("rejects a missing goals_market", () => {
    const obj = validObject() as Record<string, unknown>;
    delete obj.goals_market;
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/goals_market/);
  });

  it("rejects an empty best_angle reason", () => {
    const obj = validObject();
    obj.best_angle.reason = "  ";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/best_angle.reason/);
  });

  it("rejects an invalid risk_level", () => {
    const obj = validObject();
    obj.risk_level = "extreme";
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/risk_level/);
  });

  it("rejects what_could_change with fewer than 2 items", () => {
    const obj = validObject();
    obj.what_could_change = ["only one"];
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/what_could_change/);
  });

  it("rejects what_could_change with more than 4 items", () => {
    const obj = validObject();
    obj.what_could_change = ["a", "b", "c", "d", "e"];
    const r = validatePrediction(JSON.stringify(obj), PLAYERS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/what_could_change/);
  });
});

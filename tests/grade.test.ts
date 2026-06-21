import { describe, it, expect } from "vitest";
import { actualOutcome, gradePrediction, type GradablePrediction } from "@/lib/accuracy/grade";

function prediction(over: Partial<GradablePrediction> = {}): GradablePrediction {
  return {
    outcome_probs: { home_win: 55, draw: 25, away_win: 20 },
    scoreline_lean: "2-1",
    goals_market: {
      both_teams_to_score: { pick: "yes", probability: 60 },
      over_under_2_5: { pick: "over", probability: 58 }
    },
    confidence: "medium",
    model: "claude-opus-4-8",
    ...over
  };
}

describe("actualOutcome", () => {
  it("home win", () => expect(actualOutcome(2, 1)).toBe("home_win"));
  it("away win", () => expect(actualOutcome(0, 3)).toBe("away_win"));
  it("draw", () => expect(actualOutcome(1, 1)).toBe("draw"));
});

describe("gradePrediction", () => {
  it("marks the winner correct when the lean matches", () => {
    const r = gradePrediction(1, prediction(), 2, 1);
    expect(r.predicted_outcome).toBe("home_win");
    expect(r.actual_outcome).toBe("home_win");
    expect(r.winner_correct).toBe(true);
  });

  it("marks the winner wrong when the lean misses", () => {
    const r = gradePrediction(1, prediction(), 0, 2);
    expect(r.winner_correct).toBe(false);
  });

  it("grades an exact scoreline hit", () => {
    const r = gradePrediction(1, prediction(), 2, 1);
    expect(r.scoreline_correct).toBe(true);
  });

  it("grades a scoreline miss", () => {
    const r = gradePrediction(1, prediction(), 3, 1);
    expect(r.scoreline_correct).toBe(false);
  });

  it("grades BTTS yes correct when both score", () => {
    const r = gradePrediction(1, prediction(), 2, 1);
    expect(r.btts_pick).toBe("yes");
    expect(r.btts_correct).toBe(true);
  });

  it("grades BTTS yes wrong on a clean sheet", () => {
    const r = gradePrediction(1, prediction(), 2, 0);
    expect(r.btts_correct).toBe(false);
  });

  it("grades over 2.5 correct on a 3-goal game", () => {
    const r = gradePrediction(1, prediction(), 2, 1);
    expect(r.ou_pick).toBe("over");
    expect(r.ou_correct).toBe(true);
  });

  it("grades over 2.5 wrong on a 2-goal game", () => {
    const r = gradePrediction(1, prediction({ scoreline_lean: "1-1" }), 1, 1);
    expect(r.ou_correct).toBe(false);
  });

  it("treats exactly 2 goals as under (the 2.5 line)", () => {
    const under = prediction({
      goals_market: {
        both_teams_to_score: { pick: "no", probability: 55 },
        over_under_2_5: { pick: "under", probability: 60 }
      }
    });
    const r = gradePrediction(1, under, 1, 1);
    expect(r.ou_correct).toBe(true);
  });

  it("leaves goals markets null when the prediction carried none", () => {
    const r = gradePrediction(1, prediction({ goals_market: null }), 2, 1);
    expect(r.btts_pick).toBeNull();
    expect(r.btts_correct).toBeNull();
    expect(r.ou_pick).toBeNull();
    expect(r.ou_correct).toBeNull();
  });

  it("snapshots confidence and model", () => {
    const r = gradePrediction(1, prediction(), 2, 1);
    expect(r.confidence).toBe("medium");
    expect(r.model).toBe("claude-opus-4-8");
  });
});

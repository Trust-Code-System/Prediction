import type { Confidence, OutcomeProbs, PlayerToWatch } from "@/lib/types";

/**
 * Validates a raw Claude response against the prediction output contract.
 * Guardrails live here, in code, not in the prompt:
 *  - strip stray code fences before parsing
 *  - JSON.parse must succeed
 *  - outcome_probs are integers summing to exactly 100
 *  - confidence is one of low | medium | high
 *  - scoreline_lean looks like "N-N"
 *  - key_factors is exactly 3 non-empty strings
 *  - rationale is a non-empty string
 *  - player_to_watch.player_id exists in the payload's player set
 */

export interface ValidPrediction {
  outcome_probs: OutcomeProbs;
  scoreline_lean: string;
  confidence: Confidence;
  player_to_watch: PlayerToWatch;
  key_factors: string[];
  rationale: string;
}

export type ValidationResult =
  | { ok: true; value: ValidPrediction }
  | { ok: false; errors: string[] };

/** Remove leading/trailing markdown code fences the model sometimes adds. */
export function stripFences(text: string): string {
  let t = text.trim();
  // ```json ... ``` or ``` ... ```
  const fenceStart = /^```[a-zA-Z]*\s*\n?/;
  const fenceEnd = /\n?```$/;
  if (fenceStart.test(t)) t = t.replace(fenceStart, "");
  if (fenceEnd.test(t)) t = t.replace(fenceEnd, "");
  return t.trim();
}

function isInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

export function validatePrediction(
  raw: string,
  validPlayerIds: Set<number>
): ValidationResult {
  const errors: string[] = [];
  const cleaned = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, errors: ["response is not valid JSON"] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, errors: ["response is not a JSON object"] };
  }
  const obj = parsed as Record<string, unknown>;

  // outcome_probs
  const probs = obj.outcome_probs as Record<string, unknown> | undefined;
  if (!probs || typeof probs !== "object") {
    errors.push("outcome_probs missing or not an object");
  } else {
    const { home_win, draw, away_win } = probs;
    if (!isInteger(home_win) || !isInteger(draw) || !isInteger(away_win)) {
      errors.push("outcome_probs values must be integers");
    } else if (home_win + draw + away_win !== 100) {
      errors.push(
        `outcome_probs must sum to 100, got ${home_win + draw + away_win}`
      );
    }
  }

  // scoreline_lean
  if (typeof obj.scoreline_lean !== "string" || !/^\d{1,2}-\d{1,2}$/.test(obj.scoreline_lean)) {
    errors.push('scoreline_lean must be a string like "2-1"');
  }

  // confidence
  if (
    obj.confidence !== "low" &&
    obj.confidence !== "medium" &&
    obj.confidence !== "high"
  ) {
    errors.push("confidence must be low | medium | high");
  }

  // player_to_watch. When the payload carries no players at all (for example a
  // fixture sourced without season stats), we cannot require a real player id,
  // so the existence check is skipped and a placeholder is accepted. name and
  // reason are still required so the card is never blank.
  const ptw = obj.player_to_watch as Record<string, unknown> | undefined;
  if (!ptw || typeof ptw !== "object") {
    errors.push("player_to_watch missing or not an object");
  } else {
    if (!isInteger(ptw.player_id)) {
      errors.push("player_to_watch.player_id must be an integer");
    } else if (validPlayerIds.size > 0 && !validPlayerIds.has(ptw.player_id)) {
      errors.push(
        `player_to_watch.player_id ${ptw.player_id} does not appear in the payload`
      );
    }
    if (typeof ptw.name !== "string" || ptw.name.trim() === "") {
      errors.push("player_to_watch.name must be a non-empty string");
    }
    if (typeof ptw.reason !== "string" || ptw.reason.trim() === "") {
      errors.push("player_to_watch.reason must be a non-empty string");
    }
  }

  // key_factors
  if (
    !Array.isArray(obj.key_factors) ||
    obj.key_factors.length !== 3 ||
    !obj.key_factors.every((k) => typeof k === "string" && k.trim() !== "")
  ) {
    errors.push("key_factors must be an array of 3 non-empty strings");
  }

  // rationale
  if (typeof obj.rationale !== "string" || obj.rationale.trim() === "") {
    errors.push("rationale must be a non-empty string");
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: obj as unknown as ValidPrediction };
}

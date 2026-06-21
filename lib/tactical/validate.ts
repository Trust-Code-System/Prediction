import { stripFences } from "@/lib/prediction/validate";
import type { TacticalTeam } from "@/lib/types";

/**
 * Validates a raw tactical response against the contract, in CODE not just the
 * prompt:
 *  - strip stray code fences, JSON.parse must succeed
 *  - home and away each have a formation matching N-N(-N(-N)), a non-empty style,
 *    2-4 strengths, 1-3 weaknesses (all non-empty strings)
 *  - dangerous_areas and key_battles are each 2-4 non-empty strings
 *  - summary is a non-empty string
 *  - NO string anywhere contains an em dash (enforces the no-em-dash rule)
 */

export interface ValidTactical {
  home: TacticalTeam;
  away: TacticalTeam;
  dangerous_areas: string[];
  key_battles: string[];
  summary: string;
}

export type TacticalValidation =
  | { ok: true; value: ValidTactical }
  | { ok: false; errors: string[] };

const FORMATION_RE = /^\d+(-\d+){1,3}$/;
const EM_DASH = "—";

function isNonEmptyString(s: unknown): s is string {
  return typeof s === "string" && s.trim() !== "";
}

function hasEmDash(s: string): boolean {
  return s.includes(EM_DASH);
}

function stringArrayInRange(
  value: unknown,
  min: number,
  max: number
): { ok: boolean; emDash: boolean } {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return { ok: false, emDash: false };
  }
  if (!value.every(isNonEmptyString)) return { ok: false, emDash: false };
  return { ok: true, emDash: (value as string[]).some(hasEmDash) };
}

function validateTeam(label: string, raw: unknown, errors: string[]): void {
  if (typeof raw !== "object" || raw === null) {
    errors.push(`${label} missing or not an object`);
    return;
  }
  const t = raw as Record<string, unknown>;

  if (typeof t.formation !== "string" || !FORMATION_RE.test(t.formation)) {
    errors.push(`${label}.formation must look like "4-3-3"`);
  }
  if (!isNonEmptyString(t.style)) {
    errors.push(`${label}.style must be a non-empty string`);
  } else if (hasEmDash(t.style)) {
    errors.push(`${label}.style must not contain an em dash`);
  }

  const strengths = stringArrayInRange(t.strengths, 2, 4);
  if (!strengths.ok) errors.push(`${label}.strengths must be 2-4 non-empty strings`);
  else if (strengths.emDash) errors.push(`${label}.strengths must not contain an em dash`);

  const weaknesses = stringArrayInRange(t.weaknesses, 1, 3);
  if (!weaknesses.ok) errors.push(`${label}.weaknesses must be 1-3 non-empty strings`);
  else if (weaknesses.emDash) errors.push(`${label}.weaknesses must not contain an em dash`);
}

export function validateTactical(raw: string): TacticalValidation {
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

  validateTeam("home", obj.home, errors);
  validateTeam("away", obj.away, errors);

  const danger = stringArrayInRange(obj.dangerous_areas, 2, 4);
  if (!danger.ok) errors.push("dangerous_areas must be 2-4 non-empty strings");
  else if (danger.emDash) errors.push("dangerous_areas must not contain an em dash");

  const battles = stringArrayInRange(obj.key_battles, 2, 4);
  if (!battles.ok) errors.push("key_battles must be 2-4 non-empty strings");
  else if (battles.emDash) errors.push("key_battles must not contain an em dash");

  if (!isNonEmptyString(obj.summary)) {
    errors.push("summary must be a non-empty string");
  } else if (hasEmDash(obj.summary)) {
    errors.push("summary must not contain an em dash");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: obj as unknown as ValidTactical };
}

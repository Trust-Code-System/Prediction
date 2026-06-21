import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";
import { assemblePayload } from "@/lib/prediction/payload";
import {
  OPENAI_PREDICTION_MODEL,
  PREDICTION_MAX_TOKENS,
  PREDICTION_MODEL,
  SYSTEM_PROMPT
} from "@/lib/prediction/prompt";
import { validatePrediction, type ValidPrediction } from "@/lib/prediction/validate";

/**
 * Generate, validate, and store a prediction for one fixture.
 *
 * Providers run as a chain: Claude is primary, OpenAI is the fallback. Each
 * provider gets its own attempt budget; the same contract validation (probs sum
 * to 100, player id exists, etc) gates every attempt. The first provider to
 * return a valid object publishes, tagged with the model that produced it. If
 * the whole chain fails, a 'review' row is stored (never a malformed published
 * one) and the failure is logged.
 *
 * The OpenAI fallback is only active when OPENAI_API_KEY is set, so the pipeline
 * works with Claude alone if no OpenAI key is configured.
 */

const CLAUDE_ATTEMPTS = 4; // 1 initial + 3 retries
const OPENAI_ATTEMPTS = 3;

interface PredictionProvider {
  label: string;
  model: string;
  generate(userMessage: string): Promise<string>;
  attempts: number;
}

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  return anthropic;
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: serverEnv.openaiApiKey });
  return openai;
}

const claudeProvider: PredictionProvider = {
  label: "claude",
  model: PREDICTION_MODEL,
  attempts: CLAUDE_ATTEMPTS,
  async generate(userMessage) {
    const msg = await getAnthropic().messages.create({
      model: PREDICTION_MODEL,
      max_tokens: PREDICTION_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }]
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
};

const openaiProvider: PredictionProvider = {
  label: "openai",
  model: OPENAI_PREDICTION_MODEL,
  attempts: OPENAI_ATTEMPTS,
  async generate(userMessage) {
    const resp = await getOpenAI().chat.completions.create({
      model: OPENAI_PREDICTION_MODEL,
      max_tokens: PREDICTION_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]
    });
    return resp.choices[0]?.message?.content ?? "";
  }
};

/** Claude first, then OpenAI only if its key is configured. */
function getProviders(): PredictionProvider[] {
  const providers: PredictionProvider[] = [claudeProvider];
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== "") {
    providers.push(openaiProvider);
  }
  return providers;
}

export interface PredictOutcome {
  fixtureId: number;
  status: "published" | "review";
  provider: string | null;
  attempts: number;
  errors: string[];
}

async function storePublished(
  fixtureId: number,
  prediction: ValidPrediction,
  model: string
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("predictions").upsert({
    fixture_id: fixtureId,
    outcome_probs: prediction.outcome_probs as never,
    scoreline_lean: prediction.scoreline_lean,
    confidence: prediction.confidence,
    goals_market: prediction.goals_market as never,
    best_angle: prediction.best_angle as never,
    risk_level: prediction.risk_level,
    what_could_change: prediction.what_could_change as never,
    player_to_watch: prediction.player_to_watch as never,
    key_factors: prediction.key_factors as never,
    rationale: prediction.rationale,
    model,
    status: "published",
    generated_at: new Date().toISOString()
  });
  if (error) throw new Error(`prediction publish failed: ${error.message}`);
}

async function storeForReview(fixtureId: number, errors: string[]): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("predictions").upsert({
    fixture_id: fixtureId,
    outcome_probs: { home_win: 0, draw: 0, away_win: 0 } as never,
    scoreline_lean: null,
    confidence: null,
    goals_market: null,
    best_angle: null,
    risk_level: null,
    what_could_change: null,
    player_to_watch: null,
    key_factors: errors as never,
    rationale: "Validation failed across all providers. Flagged for manual review.",
    model: "none",
    status: "review",
    generated_at: new Date().toISOString()
  });
  if (error) throw new Error(`prediction review insert failed: ${error.message}`);
}

export async function predictFixture(fixtureId: number): Promise<PredictOutcome> {
  const payload = await assemblePayload(fixtureId);
  let lastErrors: string[] = ["no attempt ran"];
  let totalAttempts = 0;

  for (const provider of getProviders()) {
    for (let attempt = 1; attempt <= provider.attempts; attempt++) {
      totalAttempts++;
      let raw: string;
      try {
        raw = await provider.generate(payload.userMessage);
      } catch (err) {
        lastErrors = [`${provider.label} API error: ${(err as Error).message}`];
        continue;
      }

      const result = validatePrediction(raw, payload.validPlayerIds);
      if (result.ok) {
        await storePublished(fixtureId, result.value, provider.model);
        return {
          fixtureId,
          status: "published",
          provider: provider.label,
          attempts: totalAttempts,
          errors: []
        };
      }
      lastErrors = result.errors;
    }
  }

  await storeForReview(fixtureId, lastErrors);
  console.error(
    `[predict] fixture ${fixtureId} flagged for review after ${totalAttempts} attempts across providers:`,
    lastErrors.join("; ")
  );
  return { fixtureId, status: "review", provider: null, attempts: totalAttempts, errors: lastErrors };
}

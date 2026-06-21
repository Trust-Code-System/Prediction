import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";
import { assembleTacticalPayload } from "@/lib/tactical/payload";
import {
  OPENAI_TACTICAL_MODEL,
  TACTICAL_MAX_TOKENS,
  TACTICAL_MODEL,
  TACTICAL_SYSTEM_PROMPT
} from "@/lib/tactical/prompt";
import { validateTactical, type ValidTactical } from "@/lib/tactical/validate";

/**
 * Generate, validate, and store the tactical analysis for one fixture.
 *
 * Same provider chain as the prediction pipeline (Claude primary, OpenAI
 * fallback), but tactical is SUPPLEMENTARY: on total failure nothing is stored
 * (no review row) and the fixture is simply retried on the next run. The match
 * page hides the section when no row exists, so a failure never blocks anything.
 */

const CLAUDE_ATTEMPTS = 3;
const OPENAI_ATTEMPTS = 2;

interface TacticalProvider {
  label: string;
  model: string;
  attempts: number;
  generate(userMessage: string): Promise<string>;
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

const claudeProvider: TacticalProvider = {
  label: "claude",
  model: TACTICAL_MODEL,
  attempts: CLAUDE_ATTEMPTS,
  async generate(userMessage) {
    const msg = await getAnthropic().messages.create({
      model: TACTICAL_MODEL,
      max_tokens: TACTICAL_MAX_TOKENS,
      system: TACTICAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }]
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
};

const openaiProvider: TacticalProvider = {
  label: "openai",
  model: OPENAI_TACTICAL_MODEL,
  attempts: OPENAI_ATTEMPTS,
  async generate(userMessage) {
    const resp = await getOpenAI().chat.completions.create({
      model: OPENAI_TACTICAL_MODEL,
      max_tokens: TACTICAL_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TACTICAL_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]
    });
    return resp.choices[0]?.message?.content ?? "";
  }
};

function getProviders(): TacticalProvider[] {
  const providers: TacticalProvider[] = [claudeProvider];
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== "") {
    providers.push(openaiProvider);
  }
  return providers;
}

export interface TacticalOutcome {
  fixtureId: number;
  status: "stored" | "failed";
  provider: string | null;
  attempts: number;
  errors: string[];
}

async function store(
  fixtureId: number,
  value: ValidTactical,
  model: string
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("tactical_analysis").upsert({
    fixture_id: fixtureId,
    home: value.home as never,
    away: value.away as never,
    dangerous_areas: value.dangerous_areas as never,
    key_battles: value.key_battles as never,
    summary: value.summary,
    model,
    generated_at: new Date().toISOString()
  });
  if (error) throw new Error(`tactical store failed: ${error.message}`);
}

export async function generateTactical(fixtureId: number): Promise<TacticalOutcome> {
  const payload = await assembleTacticalPayload(fixtureId);
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

      const result = validateTactical(raw);
      if (result.ok) {
        await store(fixtureId, result.value, provider.model);
        return {
          fixtureId,
          status: "stored",
          provider: provider.label,
          attempts: totalAttempts,
          errors: []
        };
      }
      lastErrors = result.errors;
    }
  }

  // Supplementary: store nothing, just log. Retried on the next run.
  console.error(
    `[tactical] fixture ${fixtureId} not stored after ${totalAttempts} attempts:`,
    lastErrors.join("; ")
  );
  return { fixtureId, status: "failed", provider: null, attempts: totalAttempts, errors: lastErrors };
}

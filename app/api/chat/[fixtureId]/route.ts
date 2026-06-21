import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { getMatchView } from "@/lib/data/match";
import { buildMatchContext } from "@/lib/chat/context";
import { checkRateLimit } from "@/lib/chat/rate-limit";
import { validateChatRequest } from "@/lib/chat/validate";
import {
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  CHAT_SYSTEM_PROMPT
} from "@/lib/chat/prompt";

/**
 * Public, match-grounded AI analyst chat. Streams Claude's answer token by token.
 *
 * Reads the match view through the anon, RLS-bound read layer (so it only ever
 * sees published predictions and public data), builds a grounded MATCH CONTEXT
 * block, and asks Claude to answer ONLY from it. No DB writes, no API-Football,
 * no service-role key. Guardrails: input caps (validate.ts), best-effort rate
 * limiting (rate-limit.ts), and the grounded system prompt.
 *
 *   POST /api/chat/<fixtureId>
 *   body: { message: string, history?: {role, content}[] }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  return anthropic;
}

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: Request,
  { params }: { params: { fixtureId: string } }
) {
  const fixtureId = Number.parseInt(params.fixtureId, 10);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "invalid fixtureId" }, { status: 400 });
  }

  const limit = checkRateLimit(clientKey(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too many requests, please slow down" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const validation = validateChatRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { message, history } = validation.value;

  const view = await getMatchView(fixtureId);
  if (!view) {
    return NextResponse.json({ error: "match not found" }, { status: 404 });
  }

  const context = buildMatchContext(view);

  // The grounded context is part of the system instruction: the model must
  // answer only from it. It stays identical across a conversation, so the same
  // system string is reused turn to turn.
  const mstream = getAnthropic().messages.stream({
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: `${CHAT_SYSTEM_PROMPT}\n\n${context}`,
    messages: [...history, { role: "user", content: message }]
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of mstream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        console.error(`[chat] fixture ${fixtureId} stream error:`, (err as Error).message);
        controller.enqueue(
          encoder.encode(
            "\n\nSorry, the analyst is unavailable right now. Please try again in a moment."
          )
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

import { MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS } from "@/lib/chat/prompt";

/**
 * Validates and normalises an incoming chat request body in code (not just the
 * prompt). Caps the message length, validates the optional history shape, and
 * trims the history to the last MAX_HISTORY_TURNS turns before it ever reaches
 * Claude. Returns a clean typed payload or a single error message.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export interface ValidChatRequest {
  message: string;
  history: ChatTurn[];
}

export type ChatValidation =
  | { ok: true; value: ValidChatRequest }
  | { ok: false; error: string };

function isTurn(value: unknown): value is ChatTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Record<string, unknown>;
  if (turn.role !== "user" && turn.role !== "assistant") return false;
  if (typeof turn.content !== "string") return false;
  const content = turn.content.trim();
  return content.length > 0 && content.length <= MAX_MESSAGE_CHARS;
}

export function validateChatRequest(body: unknown): ChatValidation {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj.message !== "string") {
    return { ok: false, error: "message is required" };
  }
  const message = obj.message.trim();
  if (message.length === 0) {
    return { ok: false, error: "message must not be empty" };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `message must be ${MAX_MESSAGE_CHARS} characters or fewer` };
  }

  let history: ChatTurn[] = [];
  if (obj.history !== undefined) {
    if (!Array.isArray(obj.history)) {
      return { ok: false, error: "history must be an array" };
    }
    if (!obj.history.every(isTurn)) {
      return { ok: false, error: "history entries must be {role, content} with valid content" };
    }
    // Keep only the most recent turns so an over-long history cannot be used to
    // bloat the prompt. Normalise the content (trim) while we are here.
    history = (obj.history as ChatTurn[])
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.content.trim() }));
  }

  return { ok: true, value: { message, history } };
}

import { describe, it, expect } from "vitest";
import { validateChatRequest } from "@/lib/chat/validate";
import { MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS } from "@/lib/chat/prompt";

describe("validateChatRequest", () => {
  it("accepts a valid message with no history", () => {
    const r = validateChatRequest({ message: "Why the over 2.5 lean?" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.message).toBe("Why the over 2.5 lean?");
      expect(r.value.history).toEqual([]);
    }
  });

  it("trims the message", () => {
    const r = validateChatRequest({ message: "  hello  " });
    expect(r.ok && r.value.message).toBe("hello");
  });

  it("rejects a non-object body", () => {
    expect(validateChatRequest("nope").ok).toBe(false);
    expect(validateChatRequest(null).ok).toBe(false);
  });

  it("rejects a missing or empty message", () => {
    expect(validateChatRequest({}).ok).toBe(false);
    expect(validateChatRequest({ message: "   " }).ok).toBe(false);
  });

  it("rejects an over-cap message", () => {
    const long = "a".repeat(MAX_MESSAGE_CHARS + 1);
    const r = validateChatRequest({ message: long });
    expect(r.ok).toBe(false);
  });

  it("accepts a message exactly at the cap", () => {
    const exact = "a".repeat(MAX_MESSAGE_CHARS);
    expect(validateChatRequest({ message: exact }).ok).toBe(true);
  });

  it("rejects a non-array history", () => {
    const r = validateChatRequest({ message: "hi", history: "x" });
    expect(r.ok).toBe(false);
  });

  it("rejects malformed history entries", () => {
    expect(validateChatRequest({ message: "hi", history: [{ role: "bot", content: "x" }] }).ok).toBe(
      false
    );
    expect(validateChatRequest({ message: "hi", history: [{ role: "user" }] }).ok).toBe(false);
    expect(validateChatRequest({ message: "hi", history: [{ role: "user", content: "" }] }).ok).toBe(
      false
    );
  });

  it("trims history to the last MAX_HISTORY_TURNS turns", () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`
    }));
    const r = validateChatRequest({ message: "next", history });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.history).toHaveLength(MAX_HISTORY_TURNS);
      expect(r.value.history[0].content).toBe("turn 4");
    }
  });

  it("normalises (trims) history content", () => {
    const r = validateChatRequest({
      message: "next",
      history: [{ role: "user", content: "  spaced  " }]
    });
    expect(r.ok && r.value.history[0].content).toBe("spaced");
  });
});

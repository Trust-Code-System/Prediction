"use client";

import { useRef, useState } from "react";
import { Disclaimer } from "@/components/Disclaimer";

/**
 * Match-grounded AI analyst chat. Posts to /api/chat/<fixtureId> and renders the
 * streamed answer token by token. The server answers only from the cached match
 * data, so this stays analysis only with no betting language. Input is capped
 * client-side too, mirroring the server guardrail.
 */

// Keep in sync with MAX_MESSAGE_CHARS in lib/chat/prompt.ts.
const MAX_MESSAGE_CHARS = 600;

type Turn = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Why this lean?",
  "Why the over or under 2.5 call?",
  "Who is most likely to score?",
  "Compare both sides' recent form",
  "What is the safest angle?",
  "What could change this prediction?"
];

export function MatchChat({ fixtureId }: { fixtureId: number }) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || streaming) return;
    setError(null);

    const history = messages;
    const withUser: Turn[] = [...history, { role: "user", content: text }];
    setMessages([...withUser, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch(`/api/chat/${fixtureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history })
      });

      if (!res.ok || !res.body) {
        let msg = "The analyst is unavailable right now. Please try again.";
        if (res.status === 429) msg = "You are sending messages too quickly. Please wait a moment.";
        else {
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* keep default */
          }
        }
        setError(msg);
        // Drop the empty assistant placeholder.
        setMessages(withUser);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...withUser, { role: "assistant", content: acc }]);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setMessages(withUser);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Ask the analyst</h2>
        <span className="text-xs text-slate-400">Grounded in this match data</span>
      </div>

      {messages.length === 0 ? (
        <div className="mt-3">
          <p className="text-sm text-slate-600">
            Ask about the verdict, the form, the goals markets, or anything in the data below.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                disabled={streaming}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:border-pitch-300 hover:bg-pitch-50 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-pitch-600 px-3 py-2 text-sm text-white"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-800"
                }
              >
                {m.content || (streaming ? "Thinking..." : "")}
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="flex-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="Ask about this match..."
            disabled={streaming}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-pitch-400 focus:outline-none focus:ring-1 focus:ring-pitch-200 disabled:bg-slate-50"
          />
          <div className="mt-1 text-right text-xs text-slate-400">
            {input.length}/{MAX_MESSAGE_CHARS}
          </div>
        </div>
        <button
          type="submit"
          disabled={streaming || input.trim().length === 0}
          className="mb-6 rounded-lg bg-pitch-600 px-4 py-2 text-sm font-medium text-white hover:bg-pitch-700 disabled:opacity-50"
        >
          {streaming ? "..." : "Send"}
        </button>
      </form>

      <Disclaimer />
    </section>
  );
}

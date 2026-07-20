import { useEffect, useState } from "react";
import {
  listChatMessages,
  sendChatMessage,
  type ChatMessage,
} from "../backend/feedback";
import { getDisplayName } from "../identity";
import { getSupabase } from "../backend/supabase";
import { FeedbackWidget } from "./FeedbackWidget";

/** Public per-topic chat (plan 0014): one thread per topic, visible to
 * every learner who opens it — not a private line to maintainers. Each
 * message carries the same report action as any other content (targeting
 * `content_kind: "chat_message"`), which is the only moderation path for
 * v1: no rate limiting, no proactive moderation.
 * ponytail: no realtime subscription — messages load once per screen
 * open/send, add live updates if a stale thread turns out to matter. */
export function ChatThread({ docId }: { docId: string }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listChatMessages(docId).then(setMessages, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [docId]);

  async function handleSend() {
    setError(null);
    try {
      await sendChatMessage(docId, draft);
      setDraft("");
      setMessages(await listChatMessages(docId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (getSupabase() === null) {
    return null;
  }

  return (
    <section className="card chat-thread">
      <h2>Chat</h2>
      <p className="status">
        Public to everyone studying this topic, posted as {getDisplayName()}.
      </p>
      {messages === null ? (
        <p className="status">{error !== null ? error : "Loading…"}</p>
      ) : messages.length === 0 ? (
        <p className="status">No messages yet.</p>
      ) : (
        <ul className="card-list chat-messages">
          {messages.map((m) => (
            <li key={m.id} className="chat-message">
              <p>
                <strong>{m.display_name}</strong> {m.message}
              </p>
              <FeedbackWidget
                docId={docId}
                contentKind="chat_message"
                contentId={m.id}
              />
            </li>
          ))}
        </ul>
      )}
      {messages !== null && error !== null && (
        <p className="error-text">{error}</p>
      )}
      <div className="chat-compose">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder="Say something…"
        />
        <button
          className="primary"
          disabled={draft.trim() === ""}
          onClick={() => void handleSend()}
        >
          Send
        </button>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import {
  deleteChatMessage,
  listChatMessages,
  listReports,
  setReportResolved,
  type ChatMessage,
  type FeedbackReport,
} from "../backend/feedback";

/** Maintainer-facing feedback view (plan 0014): reports and the chat
 * thread for one document, reached from the editor's root view (the
 * existing per-document maintainer check already scopes `docId`, no new
 * routing needed). Capture is anon-writable; review/moderation happens
 * only here. */
export function FeedbackPanel({ docId }: { docId: string }) {
  const [reports, setReports] = useState<FeedbackReport[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e));
    void listReports(docId).then(setReports, onError);
    void listChatMessages(docId).then(setMessages, onError);
  }, [docId]);

  async function handleResolve(report: FeedbackReport) {
    await setReportResolved(report.id, !report.resolved);
    setReports(await listReports(docId));
  }

  async function handleDeleteMessage(id: string) {
    if (!window.confirm("Delete this chat message?")) {
      return;
    }
    await deleteChatMessage(id);
    setMessages(await listChatMessages(docId));
  }

  return (
    <section className="card">
      <h2>Feedback</h2>
      {error !== null && <p className="error-text">{error}</p>}
      {reports === null ? (
        <p className="status">{error === null ? "Loading…" : "—"}</p>
      ) : reports.length === 0 ? (
        <p className="status">No reports yet.</p>
      ) : (
        <ul className="card-list">
          {reports.map((report) => (
            <li key={report.id} className="card">
              <p>
                <strong>{report.category}</strong> · {report.content_kind}:
                {report.content_id} · {report.display_name}
              </p>
              {report.message !== null && <p>{report.message}</p>}
              <button
                className="plain"
                onClick={() => void handleResolve(report)}
              >
                {report.resolved ? "Mark unresolved" : "Mark resolved"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Chat</h3>
      {messages === null ? (
        <p className="status">{error === null ? "Loading…" : "—"}</p>
      ) : messages.length === 0 ? (
        <p className="status">No messages yet.</p>
      ) : (
        <ul className="card-list">
          {messages.map((message) => (
            <li key={message.id} className="card">
              <p>
                <strong>{message.display_name}</strong> {message.message}
              </p>
              <button
                className="plain danger"
                onClick={() => void handleDeleteMessage(message.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

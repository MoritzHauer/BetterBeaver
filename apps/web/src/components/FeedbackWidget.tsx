import { useState } from "react";
import { createPortal } from "react-dom";
import {
  castVote,
  getMyVote,
  submitReport,
  type ContentKind,
  type ReportCategory,
} from "../backend/feedback";
import { getSupabase } from "../backend/supabase";

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "error", label: "Error" },
  { value: "explicit", label: "Explicit content" },
  { value: "spam", label: "Spam" },
  { value: "feedback", label: "Give feedback" },
];

/** Thumbs up/down + report action (plan 0014), attached to any content
 * level (topic/lesson/unit/item/task/note) or a chat message
 * (`contentKind: "chat_message"`, not otherwise voteable). Hidden entirely
 * when the backend isn't configured — feedback has nowhere to go. */
export function FeedbackWidget({
  docId,
  contentKind,
  contentId,
}: {
  docId: string;
  contentKind: ContentKind | "chat_message";
  contentId: string;
}) {
  const [vote, setVote] = useState(() =>
    contentKind === "chat_message"
      ? null
      : getMyVote(docId, contentKind, contentId),
  );
  const [reportOpen, setReportOpen] = useState(false);

  if (getSupabase() === null) {
    return null;
  }

  async function handleVote(value: 1 | -1) {
    const next = vote === value ? null : value;
    setVote(next);
    if (contentKind !== "chat_message") {
      await castVote(docId, contentKind, contentId, next).catch(() => {
        // best-effort: local cache already reflects the tap either way
      });
    }
  }

  return (
    <div className="feedback-widget">
      {contentKind !== "chat_message" && (
        <>
          <button
            type="button"
            className={
              vote === 1 ? "plain feedback-vote active" : "plain feedback-vote"
            }
            aria-label="Thumbs up"
            aria-pressed={vote === 1}
            onClick={() => void handleVote(1)}
          >
            <img
              src={`${import.meta.env.BASE_URL}art/icons/thumbs_up.png`}
              alt=""
            />
          </button>
          <button
            type="button"
            className={
              vote === -1 ? "plain feedback-vote active" : "plain feedback-vote"
            }
            aria-label="Thumbs down"
            aria-pressed={vote === -1}
            onClick={() => void handleVote(-1)}
          >
            <img
              src={`${import.meta.env.BASE_URL}art/icons/thumbs_down.png`}
              alt=""
            />
          </button>
        </>
      )}
      <button
        type="button"
        className="plain feedback-vote"
        aria-label="Report"
        onClick={() => setReportOpen(true)}
      >
        <img src={`${import.meta.env.BASE_URL}art/icons/flag.png`} alt="" />
      </button>
      {reportOpen && (
        <ReportPopup
          docId={docId}
          contentKind={contentKind}
          contentId={contentId}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}

function ReportPopup({
  docId,
  contentKind,
  contentId,
  onClose,
}: {
  docId: string;
  contentKind: ContentKind | "chat_message";
  contentId: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: ReportCategory, text?: string) {
    setError(null);
    try {
      await submitReport(docId, contentKind, contentId, value, text);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return createPortal(
    <div className="popup-overlay" onClick={onClose}>
      <div
        className="popup-panel"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="plain popup-close"
          aria-label="Close"
          onClick={onClose}
        >
          &#10005;
        </button>
        {sent ? (
          <>
            <p>Thanks — got it.</p>
            <button className="primary" onClick={onClose}>
              Close
            </button>
          </>
        ) : category === "feedback" ? (
          <>
            <h2>Give feedback</h2>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="What's on your mind?"
            />
            {error !== null && <p className="error-text">{error}</p>}
            <button
              className="primary"
              disabled={message.trim() === ""}
              onClick={() => void submit("feedback", message)}
            >
              Send
            </button>
          </>
        ) : (
          <>
            <h2>Report</h2>
            {error !== null && <p className="error-text">{error}</p>}
            <div className="grade-buttons">
              {CATEGORIES.map(({ value, label }) => (
                <button
                  key={value}
                  className="plain"
                  onClick={() =>
                    value === "feedback"
                      ? setCategory(value)
                      : void submit(value)
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

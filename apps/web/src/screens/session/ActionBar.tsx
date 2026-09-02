import type { ReactNode } from "react";

/**
 * The session's one action zone (plan 0003), shared by every interaction and
 * by the summary panel. Its own module because both halves of the session
 * need it and neither owns it.
 */
export type Verdict = "correct" | "incorrect";

/** The fixed bottom action bar (plan 0003): the single action zone of the
 * session screen. Neutral while answering; verdict-filled after. */
export function ActionBar({
  verdict,
  children,
}: {
  verdict?: Verdict;
  children: ReactNode;
}) {
  return (
    <div className={`action-bar${verdict !== undefined ? ` ${verdict}` : ""}`}>
      <div className="action-bar-inner">{children}</div>
    </div>
  );
}

/** Post-answer state of the bar: verdict text plus a full-width Continue.
 * The Continue button is auto-focused so Enter continues (preserving the
 * form-submit-then-Enter flow of typed questions). */
export function VerdictBar({
  verdict,
  detail,
  advance,
}: {
  verdict: Verdict;
  detail: string;
  advance: () => void;
}) {
  return (
    <ActionBar verdict={verdict}>
      <p className="verdict">{verdict === "correct" ? "Correct!" : detail}</p>
      <button autoFocus onClick={advance}>
        Continue
      </button>
    </ActionBar>
  );
}

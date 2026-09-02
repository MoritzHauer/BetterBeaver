/**
 * The session's closing panel, and the tally it renders.
 *
 * Owns `SessionSummary` because it is the only thing that reads one; the
 * screen builds it and hands it over. `SessionScreen` re-exports the type
 * for callers that pass an `onFinished`.
 */
import { useEffect, useState } from "react";
import type { Streak } from "@betterbeaver/engine";
import { localDay } from "@betterbeaver/engine";
import type { SelfGrade } from "@betterbeaver/srs";
import { playFanfare } from "../../sounds";
import { ActionBar } from "./ActionBar";

/** Tally of results across a session; only the fields for the task type(s)
 * actually encountered end up non-zero. Every auto-graded kind (recognize,
 * cloze, scramble, build, matching, listen, dictation, minimal-pair, picture)
 * shares one tally; recall and shadowing (self-graded) share the other. */
export interface SessionSummary {
  autoCorrect: number;
  autoTotal: number;
  recallCounts: Record<SelfGrade, number>;
}

export function emptySummary(): SessionSummary {
  return {
    autoCorrect: 0,
    autoTotal: 0,
    recallCounts: { again: 0, hard: 0, good: 0 },
  };
}

/** Celebration panel (plan 0003 step 4): fanfare on mount, stat tiles for
 * the accuracy (auto-graded) or again/hard/good tallies (self-graded), and
 * the streak flame — animated when today's session extended it. */
export function SummaryPanel({
  summary,
  loadStreak,
  onFinished,
  nextAction,
}: {
  summary: SessionSummary;
  loadStreak?: () => Promise<Streak | null>;
  onFinished: (summary: SessionSummary) => void;
  nextAction?: { label: string; onClick: () => void };
}) {
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    playFanfare();
    void loadStreak?.().then(setStreak);
  }, [loadStreak]);

  const recallTotal =
    summary.recallCounts.again +
    summary.recallCounts.hard +
    summary.recallCounts.good;
  const extendedToday =
    streak !== null && streak.lastActiveDay === localDay(new Date());
  // Self-graded recall has no pass/fail — only auto-graded accuracy earns a
  // thumbs-down beaver, and only below a middling score.
  const passed =
    summary.autoTotal === 0 || summary.autoCorrect / summary.autoTotal >= 0.7;

  return (
    <section>
      <img
        className="summary-icon"
        src={`${import.meta.env.BASE_URL}art/icons/thumbs_${passed ? "up" : "down"}_beaver.png`}
        alt=""
      />
      <h2>Session complete!</h2>
      <div className="stat-tiles">
        {summary.autoTotal > 0 ? (
          <div className="stat-tile">
            <span className="stat-value">
              {Math.round((summary.autoCorrect / summary.autoTotal) * 100)}%
            </span>
            <span className="status">
              {summary.autoCorrect} of {summary.autoTotal} correct
            </span>
          </div>
        ) : null}
        {recallTotal > 0 ? (
          <>
            <div className="stat-tile">
              <span className="stat-value">{summary.recallCounts.again}</span>
              <span className="status">Again</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.recallCounts.hard}</span>
              <span className="status">Hard</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.recallCounts.good}</span>
              <span className="status">Good</span>
            </div>
          </>
        ) : null}
        {streak !== null ? (
          <div className="stat-tile">
            <span className={`stat-value${extendedToday ? " flame-tick" : ""}`}>
              <img
                className="icon-glyph"
                src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
                alt=""
              />{" "}
              {streak.length}
            </span>
            <span className="status">Day streak</span>
          </div>
        ) : null}
      </div>
      <ActionBar>
        {nextAction !== undefined ? (
          <button className="primary" autoFocus onClick={nextAction.onClick}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/play.png`}
              alt=""
            />{" "}
            {nextAction.label}
          </button>
        ) : null}
        <button
          className={nextAction !== undefined ? "plain" : "primary"}
          autoFocus={nextAction === undefined}
          onClick={() => onFinished(summary)}
        >
          Done
        </button>
      </ActionBar>
    </section>
  );
}

import { useEffect } from "react";
import type { Content, Exam } from "@betterbeaver/schema";
import {
  readExamState,
  startAttempt,
  submitAttempt,
} from "../progress/exam-attempts";

/** Every question's item carries `generated: true` (plan 0027 §6/§8):
 * derived, never stored twice. Shared by the intro and the Book card. A
 * dangling `taskId` or non-question item counts as "not generated" — the
 * same conservative default `scoreExam` uses for content that has drifted
 * out from under a stored result. */
export function examAllGenerated(exam: Exam, content: Content): boolean {
  return exam.questions.every((entry) => {
    const task = content.tasks.find((t) => t.id === entry.taskId);
    const item = task && content.items.find((i) => i.id === task.itemIds[0]);
    return item?.kind === "question" && item.payload.generated === true;
  });
}

/** The exam's total points — the sum of its entries' own weighting, not
 * anything stored on the question (plan §3). */
export function examMaxPoints(exam: Exam): number {
  return exam.questions.reduce((sum, entry) => sum + entry.points, 0);
}

/** Whole minutes left until `deadlineAt`, floored at 0 — never negative, so a
 * deadline that has already passed (handled separately, by an immediate
 * submit) never renders as "−1 min left". */
function minutesLeft(deadlineAt: string, now: Date): number {
  return Math.max(
    0,
    Math.ceil((new Date(deadlineAt).getTime() - now.getTime()) / 60_000),
  );
}

/**
 * The exam intro (plan 0027 §6): title, counts, the full description, and
 * Start/Resume, Review mode, and Last result. An attempt whose deadline has
 * already passed is submitted on open rather than shown as resumable.
 */
export function ExamScreen({
  content,
  examId,
  onBack,
  onOpenQuestion,
  onReview,
  onEnd,
}: {
  content: Content;
  examId: string;
  onBack: () => void;
  /** Opens the runner at the given 0-based question index (`?q=<n>`). */
  onOpenQuestion: (q: number) => void;
  /** Opens review mode (`?review=1`). */
  onReview: () => void;
  /** Opens the report (`?end=1`) — both "Last result" and the auto-submit
   * below land here. */
  onEnd: () => void;
}) {
  const exam = content.exams.find((e) => e.id === examId);
  const state = exam !== undefined ? readExamState(exam.id) : {};
  const deadlinePassed =
    state.attempt !== undefined &&
    new Date(state.attempt.deadlineAt).getTime() <= Date.now();

  // "Opening a resumed attempt past its deadline submits it immediately"
  // (plan §6) — a side effect, so it runs once per mount rather than on
  // every render, and only after the render that would otherwise show a
  // dead attempt as resumable.
  useEffect(() => {
    if (exam !== undefined && deadlinePassed) {
      submitAttempt(exam, content, new Date());
      onEnd();
    }
    // `content`/`onEnd` deliberately absent — see the comment above.
  }, [exam, deadlinePassed]);

  if (exam === undefined) {
    return (
      <main>
        <button onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          Back
        </button>
        <p>Unknown exam: {examId}</p>
      </main>
    );
  }

  if (deadlinePassed) {
    // The effect above submits and navigates away; nothing here should
    // flash the stale "Resume" state in the meantime.
    return (
      <main>
        <p>Loading&hellip;</p>
      </main>
    );
  }

  const { ruleset } = exam;
  const resumable = state.attempt !== undefined;

  return (
    <main>
      <button className="plain" onClick={onBack}>
        <img
          className="icon-glyph"
          src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
          alt=""
        />{" "}
        Back
      </button>
      <h1>
        {exam.title}{" "}
        {examAllGenerated(exam, content) ? (
          <span className="badge-generated">KI-generiert</span>
        ) : null}
      </h1>
      <p>
        {exam.questions.length} questions · {examMaxPoints(exam)} points ·{" "}
        {ruleset.passPercent} % to pass · {ruleset.timeLimitMinutes} min
      </p>
      <p style={{ whiteSpace: "pre-line" }}>{exam.description}</p>
      <div className="card-list">
        {resumable ? (
          <button className="primary" onClick={() => onOpenQuestion(0)}>
            Resume · {minutesLeft(state.attempt!.deadlineAt, new Date())} min
            left
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => {
              startAttempt(exam, new Date());
              onOpenQuestion(0);
            }}
          >
            Start
          </button>
        )}
        <button onClick={onReview}>Review mode</button>
        {state.lastResult !== undefined ? (
          <button onClick={onEnd}>Last result</button>
        ) : null}
      </div>
    </main>
  );
}

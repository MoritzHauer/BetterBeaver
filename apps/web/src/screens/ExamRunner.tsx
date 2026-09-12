import { useEffect, useMemo, useState } from "react";
import type { Content } from "@betterbeaver/schema";
import type { ExamAnswer } from "@betterbeaver/engine";
import { ChoiceOptions, AssignRows } from "./session/interactions";
import { ConfirmSheet } from "../components/Sheet";
import { examQuestionsByTaskId, type PickedQuestion } from "./examQuestions";
import {
  fitAnswers,
  readExamState,
  saveAnswer,
  submitAttempt,
  type ExamState,
} from "../progress/exam-attempts";

/** `mm:ss` from now to `deadlineAt`, floored at zero. */
function formatCountdown(deadlineAt: string, now: Date): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((new Date(deadlineAt).getTime() - now.getTime()) / 1000),
  );
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * The exam runner (plan 0027 §6): one question at a time, ungraded, with a
 * navigator, a countdown, and Submit. No feedback of any kind before submit
 * — `ChoiceOptions`/`AssignRows` are rendered with no `graded` prop and no
 * grading state of their own.
 */
export function ExamRunner({
  content,
  examId,
  q,
  onIntro,
  onOpenQuestion,
  onSubmitted,
}: {
  content: Content;
  examId: string;
  q: number;
  /** No attempt is running: redirect to the intro (plan §6). */
  onIntro: () => void;
  onOpenQuestion: (q: number) => void;
  /** The attempt has just been submitted (Submit, or the clock hitting
   * zero): go to the report (`?end=1`). */
  onSubmitted: () => void;
}) {
  const exam = content.exams.find((e) => e.id === examId);

  const [state, setState] = useState<ExamState>(() =>
    exam !== undefined ? readExamState(exam.id) : {},
  );
  useEffect(() => {
    setState(exam !== undefined ? readExamState(exam.id) : {});
  }, [exam]);

  // Re-renders once a second so the countdown and the zero-deadline check
  // below both stay live; cleared on unmount.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const questionByTaskId = useMemo(
    () =>
      exam !== undefined
        ? examQuestionsByTaskId(
            exam.questions.map((entry) => entry.taskId),
            content,
          )
        : new Map<string, PickedQuestion>(),
    [exam, content],
  );

  const answersByTaskId = useMemo(
    () =>
      exam !== undefined
        ? fitAnswers(exam, content, state.attempt?.answersByTaskId ?? {})
        : {},
    [exam, content, state],
  );

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Every redirect this screen can need: no attempt (back to the intro), the
  // deadline reached (auto-submit, then the report), or a stale `q` (a bad
  // deep link, or the exam having fewer questions than it used to).
  useEffect(() => {
    if (exam === undefined) {
      return;
    }
    if (state.attempt === undefined) {
      onIntro();
      return;
    }
    if (new Date(state.attempt.deadlineAt).getTime() <= Date.now()) {
      submitAttempt(exam, content, new Date());
      onSubmitted();
      return;
    }
    if (q < 0 || q >= exam.questions.length) {
      onOpenQuestion(0);
    }
    // `onIntro`/`onSubmitted`/`onOpenQuestion` deliberately absent: they are
    // freshly-created closures every render, and none of these checks needs
    // to rerun just because the parent re-rendered.
  }, [exam, state.attempt, q, content, tick]);

  if (exam === undefined) {
    return (
      <main>
        <p>Unknown exam: {examId}</p>
      </main>
    );
  }
  const entry = exam.questions[q];
  if (
    state.attempt === undefined ||
    new Date(state.attempt.deadlineAt).getTime() <= Date.now() ||
    entry === undefined
  ) {
    return (
      <main>
        <p>Loading&hellip;</p>
      </main>
    );
  }

  const question = questionByTaskId.get(entry.taskId);
  const answer = answersByTaskId[entry.taskId] ?? [];

  function setAnswer(next: ExamAnswer) {
    saveAnswer(exam!.id, entry!.taskId, next);
    setState((current) =>
      current.attempt === undefined
        ? current
        : {
            ...current,
            attempt: {
              ...current.attempt,
              answersByTaskId: {
                ...current.attempt.answersByTaskId,
                [entry!.taskId]: next,
              },
            },
          },
    );
  }

  // Answered means complete: every row picked for `assign`, the full pick
  // count for `choice`. An `assign` answer is a whole-row array from its
  // first pick, so "non-empty" would mark a 5-row question done after one
  // row and make the Submit confirmation overstate what is filled in.
  const isAnswered = (taskId: string): boolean => {
    const built = questionByTaskId.get(taskId);
    const marks = answersByTaskId[taskId] ?? [];
    if (built?.kind === "assign") {
      return (
        marks.length === built.rows.length && marks.every((m) => m !== null)
      );
    }
    if (built?.kind === "choice") {
      return marks.length === built.selectCount;
    }
    return marks.length > 0;
  };
  const answeredCount = exam.questions.filter((e) =>
    isAnswered(e.taskId),
  ).length;

  return (
    <main>
      <p>{formatCountdown(state.attempt.deadlineAt, new Date())}</p>
      <div>
        {exam.questions.map((e, i) => (
          <button
            key={e.taskId}
            type="button"
            className={isAnswered(e.taskId) ? "answered" : "unanswered"}
            aria-current={i === q ? "step" : undefined}
            onClick={() => onOpenQuestion(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {question === undefined ? null : (
        <>
          <h2>{question.stem}</h2>
          {question.kind === "choice" ? (
            <ChoiceOptions
              choices={question.choices}
              selected={answer as number[]}
              onToggle={(index) => {
                const current = answer as number[];
                if (current.includes(index)) {
                  setAnswer(current.filter((i) => i !== index));
                } else if (current.length < question.selectCount) {
                  setAnswer([...current, index]);
                }
                // At the cap: ignored (plan §4 — over-selection is
                // unreachable by construction).
              }}
            />
          ) : (
            <AssignRows
              rows={question.rows}
              labels={question.labels}
              picks={
                answer.length === question.rows.length
                  ? answer
                  : question.rows.map(() => null)
              }
              onPick={(row, label) => {
                const base =
                  answer.length === question.rows.length
                    ? [...answer]
                    : question.rows.map(() => null);
                base[row] = label;
                setAnswer(base);
              }}
            />
          )}
        </>
      )}
      <div>
        <button
          type="button"
          disabled={q === 0}
          onClick={() => onOpenQuestion(q - 1)}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={q === exam.questions.length - 1}
          onClick={() => onOpenQuestion(q + 1)}
        >
          Next
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => setConfirmOpen(true)}
        >
          Submit
        </button>
      </div>
      {confirmOpen ? (
        <ConfirmSheet
          icon="lock_key"
          title="Submit?"
          body={`${answeredCount} of ${exam.questions.length} answered`}
          cancelLabel="Keep going"
          confirmLabel="Submit"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            submitAttempt(exam, content, new Date());
            onSubmitted();
          }}
        />
      ) : null}
    </main>
  );
}

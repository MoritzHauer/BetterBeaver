/**
 * Exam attempt persistence (plan 0027 §6): one `bb.exam.<examId>` key holding
 * the current attempt, if any, plus the last submitted result. Both are keyed
 * by `taskId`, not position, so a content update that reorders or edits an
 * exam cannot shift stored answers onto other questions.
 *
 * Same shape as `learning.ts`: one JSON blob under one key, writes wrapped in
 * try/catch so a blocked `localStorage` degrades rather than throwing, and
 * `progress/backup.ts`'s `bb.*` sweep already covers the key with no change
 * of its own.
 */
import type { Content, Exam, Item } from "@betterbeaver/schema";
import {
  type ExamAnswer,
  type ExamScore,
  scoreExam,
} from "@betterbeaver/engine";
import { readJson } from "./local-storage";

export interface ExamState {
  attempt?: {
    startedAt: string;
    deadlineAt: string;
    answersByTaskId: Record<string, ExamAnswer>;
  };
  lastResult?: {
    submittedAt: string;
    pointsByTaskId: Record<string, number>;
    answersByTaskId: Record<string, ExamAnswer>;
  };
}

function keyFor(examId: string): string {
  return `bb.exam.${examId}`;
}

/** Writes the whole state blob, swallowing a write failure the way
 * `learning.ts`'s `setLearning` does — the attempt simply doesn't stick. */
function writeExamState(examId: string, state: ExamState): void {
  try {
    localStorage.setItem(keyFor(examId), JSON.stringify(state));
  } catch {
    // Deliberately ignored — see the doc comment.
  }
}

/** The stored state for one exam, or `{}` if there is none yet. Does not
 * apply the discard rule (`fitAnswer`) itself: a caller with `content` in
 * hand fits each question's answer against its current shape as it reads it
 * (`submitAttempt` below, and the runner/report screens). */
export function readExamState(examId: string): ExamState {
  return readJson<ExamState>(keyFor(examId)) ?? {};
}

/** Starts (or restarts) an attempt: an absolute wall-clock deadline, so the
 * clock never pauses while the app is closed or backgrounded (plan §6). Any
 * previous attempt is discarded; `lastResult` is left as it is. */
export function startAttempt(exam: Exam, now: Date): void {
  const state = readExamState(exam.id);
  writeExamState(exam.id, {
    ...state,
    attempt: {
      startedAt: now.toISOString(),
      deadlineAt: new Date(
        now.getTime() + exam.ruleset.timeLimitMinutes * 60_000,
      ).toISOString(),
      answersByTaskId: {},
    },
  });
}

/** Records one question's answer against the running attempt. A no-op
 * without an attempt in progress (nothing to save into). */
export function saveAnswer(
  examId: string,
  taskId: string,
  answer: ExamAnswer,
): void {
  const state = readExamState(examId);
  if (state.attempt === undefined) {
    return;
  }
  writeExamState(examId, {
    ...state,
    attempt: {
      ...state.attempt,
      answersByTaskId: { ...state.attempt.answersByTaskId, [taskId]: answer },
    },
  });
}

/**
 * Discards a stored answer that no longer fits its question (plan §6):
 * - `choice`: any index ≥ `options.length`, or more selections than the
 *   number of correct options;
 * - `assign`: the answer's length differs from the row count.
 *
 * Returns `null` when the answer must be discarded — the question then reads
 * as unanswered. Takes the resolved `question` item, not a task or content,
 * so it stays a pure, easily tested function.
 */
export function fitAnswer(
  item: Extract<Item, { kind: "question" }>,
  answer: ExamAnswer,
): ExamAnswer | null {
  const { options, labels } = item.payload;
  if (labels === undefined) {
    const selectCount = options.filter((option) => option.correct).length;
    const outOfRange = answer.some(
      (index) => index === null || index < 0 || index >= options.length,
    );
    if (outOfRange || answer.length > selectCount) {
      return null;
    }
    return answer;
  }
  return answer.length === options.length ? answer : null;
}

/** The `question` item behind one exam entry's `taskId`, or `undefined` for
 * a dangling reference or a non-question task (never reachable from
 * validated content, but the caller must not throw on a stale attempt). */
function questionItemFor(
  taskId: string,
  content: Content,
): Extract<Item, { kind: "question" }> | undefined {
  const task = content.tasks.find((t) => t.id === taskId);
  const item = task && content.items.find((i) => i.id === task.itemIds[0]);
  return item?.kind === "question" ? item : undefined;
}

/**
 * Fits every answer of `rawAnswersByTaskId` against `exam`'s current
 * questions (`fitAnswer` applied per question, plan §6) and drops whatever
 * fails, keyed by `taskId`. `submitAttempt` uses this to score; the runner
 * and the report reuse it to hydrate what they show from a resumed attempt
 * or a stored result — content may have changed underneath either since it
 * was written.
 */
export function fitAnswers(
  exam: Exam,
  content: Content,
  rawAnswersByTaskId: Readonly<Record<string, ExamAnswer>>,
): Record<string, ExamAnswer> {
  const fitted: Record<string, ExamAnswer> = {};
  for (const entry of exam.questions) {
    const raw = rawAnswersByTaskId[entry.taskId];
    if (raw === undefined) {
      continue;
    }
    const item = questionItemFor(entry.taskId, content);
    const fit = item !== undefined ? fitAnswer(item, raw) : null;
    if (fit !== null) {
      fitted[entry.taskId] = fit;
    }
  }
  return fitted;
}

/**
 * Submits the running attempt: scores the discard-filtered answers
 * (`fitAnswer` applied per question), writes `lastResult` with both the
 * fitted answers and the points scored, clears `attempt`, and returns the
 * score so the caller can go straight to the report without a second read.
 */
export function submitAttempt(
  exam: Exam,
  content: Content,
  now: Date,
): ExamScore {
  const state = readExamState(exam.id);
  const answersByTaskId = fitAnswers(
    exam,
    content,
    state.attempt?.answersByTaskId ?? {},
  );

  const score = scoreExam(exam, answersByTaskId, content);
  const pointsByTaskId: Record<string, number> = {};
  for (const q of score.questions) {
    pointsByTaskId[q.taskId] = q.points;
  }

  writeExamState(exam.id, {
    lastResult: {
      submittedAt: now.toISOString(),
      pointsByTaskId,
      answersByTaskId,
    },
  });

  return score;
}

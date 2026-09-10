/**
 * Exam attempts on this device (plan 0027 §6), under `bb.exam.<examId>` —
 * alongside the existing `bb.item.*` / `bb.attempted` / `bb.streak.*` keys,
 * and swept by `progress/backup.ts` for free because it exports every `bb.*`
 * key. An in-flight attempt is learner state, and learner state on-device
 * with export/import is the standing durability floor.
 *
 * **The deadline is an absolute timestamp, so the clock is wall-clock and
 * never pauses.** Closing the app, backgrounding it, or having the PWA
 * evicted all leave the attempt intact and resumable with the elapsed time
 * gone. Opening a resumed attempt past its deadline submits it immediately
 * with whatever is answered. That is what "one run" means here: you cannot
 * bank half an exam and come back fresh tomorrow, but Android reclaiming
 * memory does not cost you the hour. The strict alternative — leaving the
 * exam voids it — was considered and rejected by the owner.
 *
 * **A result stores its answers, not its score.** Scoring is a pure function
 * of the exam and the answers (`scoreExam`), and the report has to resolve
 * the questions anyway to show which ones were missed — so a stored total
 * would be a second source of truth that could disagree with the first the
 * day the Book is republished. There is nothing a stored number buys.
 */
import type { ExamAnswer } from "@betterbeaver/engine";
import { readJson } from "./local-storage";

/** One in-flight attempt: when it started, when it dies, what is answered. */
export interface ExamAttempt {
  startedAt: number;
  /** Absolute epoch milliseconds — see the note above on wall-clock time. */
  deadlineAt: number;
  /** Keyed by the exam entry's `taskId`, which is its identity in the exam. */
  answers: Record<string, ExamAnswer>;
}

/** The last submitted attempt, kept so the report survives a reload. */
export interface ExamLastResult {
  submittedAt: number;
  answers: Record<string, ExamAnswer>;
}

export interface ExamRecord {
  attempt?: ExamAttempt;
  lastResult?: ExamLastResult;
}

/** The `localStorage` key for one exam's record — minted here only. */
export function examKey(examId: string): string {
  return `bb.exam.${examId}`;
}

function isAnswer(value: unknown): value is ExamAnswer {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const answer = value as {
    kind?: unknown;
    selected?: unknown;
    chosen?: unknown;
  };
  if (answer.kind === "choice") {
    return (
      Array.isArray(answer.selected) &&
      answer.selected.every((i) => typeof i === "number")
    );
  }
  if (answer.kind === "assign") {
    return (
      Array.isArray(answer.chosen) &&
      answer.chosen.every((i) => i === null || typeof i === "number")
    );
  }
  return false;
}

/** Keeps only the well-formed answers — a corrupt entry is dropped, never
 * allowed to reach the scorer as a shape it does not expect. */
function readAnswers(value: unknown): Record<string, ExamAnswer> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const answers: Record<string, ExamAnswer> = {};
  for (const [taskId, answer] of Object.entries(value)) {
    if (isAnswer(answer)) {
      answers[taskId] = answer;
    }
  }
  return answers;
}

/**
 * This exam's record, or an empty one.
 *
 * Everything read here is untrusted: it survives an app version, an import of
 * someone else's backup, and a hand-edited `localStorage`. A corrupt attempt
 * reads as no attempt rather than a runner that cannot render — the same
 * "failed reads degrade to absent" rule the rest of `progress/` follows.
 */
export function readExamRecord(examId: string): ExamRecord {
  const raw = readJson<unknown>(examKey(examId));
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const stored = raw as { attempt?: unknown; lastResult?: unknown };
  const record: ExamRecord = {};
  if (typeof stored.attempt === "object" && stored.attempt !== null) {
    const attempt = stored.attempt as Record<string, unknown>;
    if (
      typeof attempt.startedAt === "number" &&
      typeof attempt.deadlineAt === "number"
    ) {
      record.attempt = {
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        answers: readAnswers(attempt.answers),
      };
    }
  }
  if (typeof stored.lastResult === "object" && stored.lastResult !== null) {
    const result = stored.lastResult as Record<string, unknown>;
    if (typeof result.submittedAt === "number") {
      record.lastResult = {
        submittedAt: result.submittedAt,
        answers: readAnswers(result.answers),
      };
    }
  }
  return record;
}

/** Writes the record, swallowing a storage failure the way every other
 * learner-state write does (spec 0019): a full or blocked `localStorage`
 * must not take the running exam down with it. */
function writeExamRecord(examId: string, record: ExamRecord): void {
  try {
    localStorage.setItem(examKey(examId), JSON.stringify(record));
  } catch {
    // Deliberately silent here: the banner spec 0019 §2 raises on the books
    // screen is the surface for this, and an alert mid-exam is not.
  }
}

/** Starts a fresh attempt, discarding any unfinished one and keeping the
 * last result until this attempt is itself submitted. */
export function startAttempt(
  examId: string,
  timeLimitMinutes: number,
  now: number = Date.now(),
): ExamAttempt {
  const attempt: ExamAttempt = {
    startedAt: now,
    deadlineAt: now + timeLimitMinutes * 60_000,
    answers: {},
  };
  writeExamRecord(examId, { ...readExamRecord(examId), attempt });
  return attempt;
}

/** Records one question's answer into the in-flight attempt. A no-op when
 * there is no attempt, so a stale runner cannot resurrect one. */
export function saveAnswer(
  examId: string,
  taskId: string,
  answer: ExamAnswer,
): ExamAttempt | undefined {
  const record = readExamRecord(examId);
  if (record.attempt === undefined) {
    return undefined;
  }
  const attempt: ExamAttempt = {
    ...record.attempt,
    answers: { ...record.attempt.answers, [taskId]: answer },
  };
  writeExamRecord(examId, { ...record, attempt });
  return attempt;
}

/**
 * Submits the in-flight attempt: it becomes the last result and stops being
 * an attempt. Idempotent — submitting with nothing in flight leaves the
 * record alone, which is what a timer firing on an already-submitted exam
 * does.
 */
export function submitAttempt(
  examId: string,
  now: number = Date.now(),
): ExamLastResult | undefined {
  const record = readExamRecord(examId);
  if (record.attempt === undefined) {
    return record.lastResult;
  }
  const lastResult: ExamLastResult = {
    submittedAt: now,
    answers: record.attempt.answers,
  };
  writeExamRecord(examId, { lastResult });
  return lastResult;
}

/** Drops this exam's record entirely (nothing in the app calls this yet;
 * `eraseAllData`'s `bb.*` sweep is what clears it today). */
export function clearExamRecord(examId: string): void {
  try {
    localStorage.removeItem(examKey(examId));
  } catch {
    // Same rule as the write above.
  }
}

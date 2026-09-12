/**
 * Exam scoring (plan 0027 §4) — one pure function, with the ruleset the only
 * source of the rules.
 *
 * The iSAQB rules are a `ExamRuleset` record, not a code path: a second exam
 * with a different pass mark, no partial credit or no penalty needs no change
 * here. Nothing in this file writes SRS state, and nothing in it may: partial
 * credit on a 2-point question is not a `Quality`. Missed questions reach SRS
 * only through the ordinary practice session the report offers.
 */
import type { Content, Exam, ExamRuleset, Item } from "@betterbeaver/schema";
import type { AssignQuestion, ChoiceQuestion } from "./session.js";

/**
 * The `question` item one exam entry asks, resolved through its task.
 *
 * Validated content guarantees the chain — class (ag) proves every `taskId`
 * resolves to a one-item `choice`/`assign` task — so `undefined` means a
 * draft or a half-broken document, and every caller degrades rather than
 * throwing.
 */
export function examQuestionItem(
  taskId: string,
  content: Content,
): Extract<Item, { kind: "question" }> | undefined {
  const task = content.tasks.find((t) => t.id === taskId);
  const itemId = task?.itemIds[0];
  if (itemId === undefined) {
    return undefined;
  }
  const item = content.items.find((i) => i.id === itemId);
  return item?.kind === "question" ? item : undefined;
}

/**
 * Whether every one of this exam's questions is model-written (plan 0027
 * §6): the condition for the "KI-generiert" badge.
 *
 * **Derived, never stored twice.** The flag lives on the question, where a
 * generated question outside any exam needs it just as much; an exam-level
 * copy would be a second truth to keep in step. An exam with a single
 * expert-reviewed question is not a generated exam, and an exam with no
 * resolvable questions at all is not one either.
 */
export function examIsGenerated(exam: Exam, content: Content): boolean {
  const items = exam.questions.flatMap((entry) => {
    const item = examQuestionItem(entry.taskId, content);
    return item === undefined ? [] : [item];
  });
  return (
    items.length === exam.questions.length &&
    items.length > 0 &&
    items.every((item) => item.payload.generated === true)
  );
}

/**
 * One question's answer as the runner holds it.
 *
 * A `choice` answer is the selected option indices; an `assign` answer is one
 * label index per row, `null` for a row left blank. Both are exactly what the
 * shared boards produce, so the runner stores what it renders.
 */
export type ExamAnswer =
  | { kind: "choice"; selected: number[] }
  | { kind: "assign"; chosen: (number | null)[] };

/** What one question was worth and what it scored. */
export interface ExamQuestionResult {
  taskId: string;
  points: number;
  scored: number;
  /** Full marks — the report's per-question tick, not a pass/fail of its own. */
  correct: boolean;
  /** Marks required: the correct-option count for `choice`, the row count for
   * `assign`. Derived from the question, never authored (§1). */
  required: number;
  /** Marks given that were right, and marks given that were wrong. An
   * unanswered `assign` row is neither. */
  right: number;
  wrong: number;
}

export interface ExamResult {
  questions: ExamQuestionResult[];
  total: number;
  maxPoints: number;
  /** `total / maxPoints` as a percentage, 0 when the exam is worth nothing. */
  percentage: number;
  passed: boolean;
}

/**
 * The marks one answer gets right and wrong, against the authored truth.
 *
 * For `choice` the marks are the selected options. For `assign` the marks are
 * the answered rows: a blank row is neither right nor wrong, so it contributes
 * nothing and costs nothing — which is the iSAQB rule for a blank row, falling
 * out of the counting rather than special-cased.
 */
function countMarks(
  question: ChoiceQuestion | AssignQuestion,
  answer: ExamAnswer | undefined,
): { right: number; wrong: number; required: number } {
  if (question.kind === "choice") {
    const required = question.correctIndices.length;
    if (answer === undefined || answer.kind !== "choice") {
      return { right: 0, wrong: 0, required };
    }
    const correct = new Set(question.correctIndices);
    const selected = [...new Set(answer.selected)];
    return {
      required,
      right: selected.filter((index) => correct.has(index)).length,
      wrong: selected.filter((index) => !correct.has(index)).length,
    };
  }
  const required = question.rows.length;
  if (answer === undefined || answer.kind !== "assign") {
    return { right: 0, wrong: 0, required };
  }
  let right = 0;
  let wrong = 0;
  for (const [row, correct] of question.correctLabelIndex.entries()) {
    const chosen = answer.chosen[row] ?? null;
    if (chosen === null) {
      continue;
    }
    if (chosen === correct) {
      right++;
    } else {
      wrong++;
    }
  }
  return { right, wrong, required };
}

/**
 * What a question worth `points` scores, given `right` of `required` marks and
 * `wrong` ones (§4):
 *
 * - `partialCredit: false` → all of it, or none.
 * - `partialCredit: true` → `points × (right − (negativeMarking ? wrong : 0)) / required`.
 *
 * **Floored at 0, and that floor is hardcoded rather than a ruleset field.**
 * It is what "negative marking" means in every ruleset we have: a wrong
 * single-answer question scores 0, not −1. A ruleset that lets a question drag
 * the total negative can add the field on the day one exists.
 *
 * The one formula covers all three iSAQB question types. A single-answer
 * question is just `required === 1`.
 */
function scoreQuestion(
  points: number,
  right: number,
  wrong: number,
  required: number,
  ruleset: ExamRuleset,
): number {
  if (required === 0) {
    return 0;
  }
  if (!ruleset.partialCredit) {
    return right === required && wrong === 0 ? points : 0;
  }
  const net = right - (ruleset.negativeMarking ? wrong : 0);
  return Math.max(0, (points * net) / required);
}

/**
 * Scores one exam attempt.
 *
 * `questionsByTaskId` is the built question per exam entry — the runner
 * already has them, and passing them in keeps this function free of content
 * lookup. An entry with no question (impossible in validated content, where
 * class (ag) proves every `taskId` resolves to a one-item `choice`/`assign`
 * task) scores 0 rather than throwing, so a half-broken draft still reports.
 */
export function scoreExam(
  exam: Exam,
  questionsByTaskId: ReadonlyMap<string, ChoiceQuestion | AssignQuestion>,
  answersByTaskId: ReadonlyMap<string, ExamAnswer>,
): ExamResult {
  const questions = exam.questions.map((entry): ExamQuestionResult => {
    const question = questionsByTaskId.get(entry.taskId);
    if (question === undefined) {
      return {
        taskId: entry.taskId,
        points: entry.points,
        scored: 0,
        correct: false,
        required: 0,
        right: 0,
        wrong: 0,
      };
    }
    const { right, wrong, required } = countMarks(
      question,
      answersByTaskId.get(entry.taskId),
    );
    const scored = scoreQuestion(
      entry.points,
      right,
      wrong,
      required,
      exam.ruleset,
    );
    return {
      taskId: entry.taskId,
      points: entry.points,
      scored,
      correct: right === required && wrong === 0,
      required,
      right,
      wrong,
    };
  });
  const total = questions.reduce((sum, q) => sum + q.scored, 0);
  const maxPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const percentage = maxPoints === 0 ? 0 : (total / maxPoints) * 100;
  return {
    questions,
    total,
    maxPoints,
    percentage,
    // `>=`, so an exam whose pass mark is exactly reached passes.
    passed: total >= (exam.ruleset.passPercent / 100) * maxPoints,
  };
}

/** One lesson's readiness bucket (plan 0027 §4/§6): points scored versus
 * points available, over the exam entries that test that lesson. */
export interface LessonReadiness {
  /** null = the "Other" bucket: entries the exam gave no `lessonId`. */
  lessonId: string | null;
  points: number;
  maxPoints: number;
  /** 0 when maxPoints is 0. */
  percent: number;
}

/**
 * Readiness per lesson, a second pure function over the same per-question
 * result `scoreExam` produces (plan 0027 §4/§6). Walks `exam.questions` in
 * order and buckets each entry's `scored`/`points` by `entry.lessonId ??
 * null`; an entry with no result is left out of both sums entirely — the
 * learner never saw it, most likely because content changed after the
 * result was recorded.
 *
 * Bucket order is `lessonIds` order, then any lesson id the exam names that
 * isn't in `lessonIds` (in first-seen order), then the `null` "Other" bucket
 * last. Empty buckets (no entry with a result) are omitted.
 *
 * `weakestLessonId` is the non-null bucket with the lowest `percent`, ties
 * going to the earlier bucket; "Other" is never weakest, and the result is
 * `null` when there is no non-null bucket at all.
 */
export function readinessByLesson(
  exam: Exam,
  results: readonly ExamQuestionResult[],
  lessonIds: readonly string[],
): { buckets: LessonReadiness[]; weakestLessonId: string | null } {
  const resultByTaskId = new Map(results.map((r) => [r.taskId, r]));
  const sums = new Map<string | null, { points: number; maxPoints: number }>();
  const firstSeen: (string | null)[] = [];

  for (const entry of exam.questions) {
    const result = resultByTaskId.get(entry.taskId);
    if (result === undefined) {
      continue;
    }
    const key = entry.lessonId ?? null;
    let sum = sums.get(key);
    if (sum === undefined) {
      sum = { points: 0, maxPoints: 0 };
      sums.set(key, sum);
      firstSeen.push(key);
    }
    sum.points += result.scored;
    sum.maxPoints += entry.points;
  }

  const knownOrder = lessonIds.filter((id) => sums.has(id));
  const unknownOrder = firstSeen.filter(
    (key): key is string => key !== null && !lessonIds.includes(key),
  );
  const bucketOrder: (string | null)[] = [
    ...knownOrder,
    ...unknownOrder,
    ...(sums.has(null) ? [null] : []),
  ];

  const buckets: LessonReadiness[] = bucketOrder.map((lessonId) => {
    const sum = sums.get(lessonId)!;
    const percent =
      sum.maxPoints === 0 ? 0 : (sum.points / sum.maxPoints) * 100;
    return { lessonId, points: sum.points, maxPoints: sum.maxPoints, percent };
  });

  let weakestLessonId: string | null = null;
  let weakestPercent = Infinity;
  for (const bucket of buckets) {
    if (bucket.lessonId !== null && bucket.percent < weakestPercent) {
      weakestPercent = bucket.percent;
      weakestLessonId = bucket.lessonId;
    }
  }

  return { buckets, weakestLessonId };
}

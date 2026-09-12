/**
 * Exam scoring and readiness per lesson (plan 0027 §4, §6): pure functions
 * over a submitted exam attempt. No SRS state, no I/O — grading a `choice`
 * or `assign` task inside an exam never touches the practice/Check auto-grader.
 */
import type { Content, Exam } from "@betterbeaver/schema";

/** A learner's marks for one question. `choice`: selected option indices.
 *  `assign`: per row, the chosen label index (0 or 1) or `null` if blank. */
export type ExamAnswer = (number | null)[];

export interface QuestionScore {
  taskId: string;
  points: number; // scored, >= 0, may be fractional
  maxPoints: number; // the entry's `points`
  lessonId?: string;
}

export interface ExamScore {
  questions: QuestionScore[]; // in exam order
  total: number;
  max: number;
  percent: number; // total / max * 100, unrounded
  passed: boolean;
  /** Task ids scoring below their full points, in exam order (plan §6). */
  missedTaskIds: string[];
}

/** Scores one exam entry against its resolved question payload (plan §4).
 *  `n` marks required, `c` correct marks given, `w` wrong ones. */
function scoreQuestion(
  entry: Exam["questions"][number],
  content: Content,
  answer: ExamAnswer,
  partialCredit: boolean,
  negativeMarking: boolean,
): number {
  const task = content.tasks.find((t) => t.id === entry.taskId);
  const item = task && content.items.find((i) => i.id === task.itemIds[0]);
  if (!item || item.kind !== "question") {
    // Dangling taskId or a draft missing its item/payload: never reachable
    // from validated content, but the scorer must not throw on it.
    return 0;
  }
  const { options, labels } = item.payload;
  const isAssign = labels !== undefined;

  let n: number;
  let c = 0;
  let w = 0;
  if (isAssign) {
    n = options.length;
    for (let i = 0; i < options.length; i++) {
      const a = answer[i];
      if (a === undefined || a === null) {
        continue; // a blank row is neither correct nor wrong
      }
      if ((a === 0) === options[i]!.correct) {
        c++;
      } else {
        w++;
      }
    }
  } else {
    n = options.filter((o) => o.correct).length;
    const seen = new Set<number>();
    for (const idx of answer) {
      if (idx === null || idx < 0 || idx >= options.length || seen.has(idx)) {
        continue; // ignore duplicate or out-of-range indices
      }
      seen.add(idx);
      if (options[idx]!.correct) {
        c++;
      } else {
        w++;
      }
    }
  }

  if (n === 0) {
    return 0; // degenerate payload (unvalidated draft); nothing to score
  }
  if (!partialCredit) {
    return c === n && w === 0 ? entry.points : 0;
  }
  return Math.max(0, (entry.points * (c - (negativeMarking ? w : 0))) / n);
}

export function scoreExam(
  exam: Exam,
  answersByTaskId: Readonly<Record<string, ExamAnswer>>,
  content: Content,
): ExamScore {
  const { partialCredit, negativeMarking } = exam.ruleset;
  const questions: QuestionScore[] = exam.questions.map((entry) => ({
    taskId: entry.taskId,
    points: scoreQuestion(
      entry,
      content,
      answersByTaskId[entry.taskId] ?? [],
      partialCredit,
      negativeMarking,
    ),
    maxPoints: entry.points,
    lessonId: entry.lessonId,
  }));

  const total = questions.reduce((sum, q) => sum + q.points, 0);
  const max = questions.reduce((sum, q) => sum + q.maxPoints, 0);

  return {
    questions,
    total,
    max,
    percent: (total / max) * 100,
    // Partial-credit sums are fractions of 1/n, inexact in float (e.g. 1/5
    // added 156 times gives 31.19999999999992). Without the tolerance, a
    // learner landing exactly on the pass mark reads as failed.
    passed: total + 1e-9 >= (exam.ruleset.passPercent / 100) * max,
    missedTaskIds: questions
      .filter((q) => q.points < q.maxPoints - 1e-9)
      .map((q) => q.taskId),
  };
}

export interface LessonReadiness {
  lessonId: string | null; // null = the "Other" bucket
  points: number;
  maxPoints: number;
  percent: number; // 0 when maxPoints is 0
}

export function readinessByLesson(
  exam: Exam,
  pointsByTaskId: Readonly<Record<string, number>>,
  lessonIds: readonly string[], // the Book's lessonIds, for ordering
): { buckets: LessonReadiness[]; weakestLessonId: string | null } {
  const sums = new Map<string | null, { points: number; maxPoints: number }>();
  const firstSeen: (string | null)[] = [];

  for (const entry of exam.questions) {
    const points = pointsByTaskId[entry.taskId];
    if (points === undefined) {
      continue; // the learner never saw this question; leave it out entirely
    }
    const key = entry.lessonId ?? null;
    let bucket = sums.get(key);
    if (!bucket) {
      bucket = { points: 0, maxPoints: 0 };
      sums.set(key, bucket);
      firstSeen.push(key);
    }
    bucket.points += points;
    bucket.maxPoints += entry.points;
  }

  const known = lessonIds.filter((id) => sums.has(id));
  const unknown = firstSeen.filter(
    (id): id is string => id !== null && !lessonIds.includes(id),
  );
  const orderedKeys = [...known, ...unknown, ...(sums.has(null) ? [null] : [])];

  const buckets: LessonReadiness[] = orderedKeys.map((lessonId) => {
    const bucket = sums.get(lessonId)!;
    return {
      lessonId,
      points: bucket.points,
      maxPoints: bucket.maxPoints,
      percent:
        bucket.maxPoints === 0 ? 0 : (bucket.points / bucket.maxPoints) * 100,
    };
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

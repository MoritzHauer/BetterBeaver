/**
 * The exam run (plan 0027 §6): intro, runner, report.
 *
 * One component with three phases rather than three screens, because they
 * share one thing that cannot be split — the attempt. The runner needs it to
 * answer, the intro needs it to offer Resume, the report needs the answers it
 * left behind, and the timer that ends the run belongs to none of them alone.
 *
 * **The one genuinely new interaction in the app is that nothing grades
 * before Submit.** Every other question in BetterBeaver answers immediately;
 * here answers are revisitable in both directions until one submit, and the
 * only feedback before it is the navigator's answered/unanswered marks.
 *
 * The boards themselves are the practice session's boards (`questionInputs`),
 * so a question reads identically wherever it is asked.
 */
import { useEffect, useState } from "react";
import type { Content, Exam } from "@betterbeaver/schema";
import type { AssignQuestion, ChoiceQuestion } from "@betterbeaver/engine";
import {
  buildTaskSession,
  examIsGenerated,
  readinessByLesson,
  scoreExam,
  type ExamAnswer,
  type ExamResult,
} from "@betterbeaver/engine";
import {
  AssignBoard,
  ChoiceBoard,
  QuestionFeedback,
} from "./session/questionInputs";
import {
  readExamRecord,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type ExamAttempt,
} from "../progress/exam-attempts";

/** How often the countdown re-renders. A second is the resolution the
 * learner reads; the deadline itself is an absolute timestamp, so a missed
 * tick costs display accuracy and never a minute of the run. */
const TICK_MS = 1000;

/** Builds every exam question once, keyed by its entry's `taskId`.
 *
 * The rng is never consumed — neither builder samples or shuffles, and
 * option order is the authored order (plan 0027 §5) — so an exam renders
 * identically on every visit without storing anything about how it was
 * built. */
export function buildExamQuestions(
  exam: Exam,
  content: Content,
): Map<string, ChoiceQuestion | AssignQuestion> {
  const questions = new Map<string, ChoiceQuestion | AssignQuestion>();
  for (const entry of exam.questions) {
    const task = content.tasks.find((t) => t.id === entry.taskId);
    if (task === undefined) {
      continue;
    }
    const [built] = buildTaskSession(task, content, () => 0);
    if (built?.kind === "choice" || built?.kind === "assign") {
      questions.set(entry.taskId, built);
    }
  }
  return questions;
}

function formatClock(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Points as the report shows them: whole where whole, one decimal where
 * partial credit made them fractional. `2` rather than `2.0`, `0.7` rather
 * than `0.6666666666666666`. */
function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function ExamScreen({
  content,
  exam,
  questionIndex,
  atEnd,
  onOpenQuestion,
  onOpenIntro,
  onOpenReport,
  onPracticeMissed,
  onReview,
  onBack,
}: {
  content: Content;
  exam: Exam;
  /** The runner's question, or `undefined` for the intro. */
  questionIndex?: number;
  atEnd?: boolean;
  onOpenQuestion: (index: number) => void;
  onOpenIntro: () => void;
  onOpenReport: () => void;
  /** Hands the missed questions' tasks to an ordinary practice session,
   * which grades them into SRS normally — the only path by which anything
   * an exam touched reaches the scheduler (plan 0027 §6). */
  onPracticeMissed: (taskIds: string[]) => void;
  /** Opens review mode (plan 0027 §6 amendment): the intro's second action,
   * alongside Start. */
  onReview: () => void;
  onBack: () => void;
}) {
  const [questions] = useState(() => buildExamQuestions(exam, content));
  const [record, setRecord] = useState(() => readExamRecord(exam.id));
  const [now, setNow] = useState(() => Date.now());

  const attempt = record.attempt;
  const maxPoints = exam.questions.reduce(
    (sum, question) => sum + question.points,
    0,
  );

  // The clock is wall-clock and absolute (plan 0027 §6), so this interval
  // only decides how often the display refreshes — it never accumulates the
  // elapsed time, and a backgrounded tab that fires no ticks at all still
  // comes back to the correct remaining time.
  useEffect(() => {
    if (attempt === undefined) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [attempt]);

  // A deadline in the past submits on open, wherever "open" happens to be:
  // an attempt resumed hours later, or the tab that was left running. This
  // is what makes the absolute deadline safe — the run ends at its own
  // wall-clock time whether or not anything was watching.
  useEffect(() => {
    if (attempt !== undefined && now >= attempt.deadlineAt) {
      submitAttempt(exam.id, attempt.deadlineAt);
      setRecord(readExamRecord(exam.id));
      onOpenReport();
    }
  }, [attempt, now, exam.id, onOpenReport]);

  function answerCurrent(taskId: string, answer: ExamAnswer) {
    saveAnswer(exam.id, taskId, answer);
    setRecord(readExamRecord(exam.id));
  }

  function start() {
    startAttempt(exam.id, exam.ruleset.timeLimitMinutes);
    setRecord(readExamRecord(exam.id));
    onOpenQuestion(0);
  }

  function submit() {
    submitAttempt(exam.id);
    setRecord(readExamRecord(exam.id));
    onOpenReport();
  }

  // --- the report ---

  if (atEnd === true) {
    const answers = new Map(
      Object.entries(record.lastResult?.answers ?? {}),
    ) as ReadonlyMap<string, ExamAnswer>;
    const result = scoreExam(exam, questions, answers);
    return (
      <ExamReport
        exam={exam}
        content={content}
        result={result}
        answers={answers}
        questions={questions}
        submitted={record.lastResult !== undefined}
        onPracticeMissed={onPracticeMissed}
        onBack={onBack}
      />
    );
  }

  // --- the runner ---

  if (questionIndex !== undefined && attempt !== undefined) {
    const entry = exam.questions[questionIndex];
    const question =
      entry === undefined ? undefined : questions.get(entry.taskId);
    if (entry === undefined || question === undefined) {
      // A `?q=` past the end, or a question the content no longer resolves.
      // The intro is the honest landing place; it is one tap from the run.
      return (
        <main className="exam">
          <p className="status">That question is not part of this exam.</p>
          <button onClick={onOpenIntro}>Back to the exam</button>
        </main>
      );
    }
    const answer = attempt.answers[entry.taskId];
    return (
      <main className="exam">
        <ExamClock deadlineAt={attempt.deadlineAt} now={now} />
        <p className="status">
          Frage {questionIndex + 1} von {exam.questions.length} · {entry.points}{" "}
          {entry.points === 1 ? "Punkt" : "Punkte"}
        </p>
        {question.kind === "choice" ? (
          <ChoiceBoard
            question={question}
            selected={answer?.kind === "choice" ? answer.selected : []}
            onChange={(selected) =>
              answerCurrent(entry.taskId, { kind: "choice", selected })
            }
          />
        ) : (
          <AssignBoard
            question={question}
            chosen={
              answer?.kind === "assign"
                ? answer.chosen
                : question.rows.map(() => null)
            }
            onChange={(chosen) =>
              answerCurrent(entry.taskId, { kind: "assign", chosen })
            }
          />
        )}
        <ExamNavigator
          exam={exam}
          attempt={attempt}
          current={questionIndex}
          onOpenQuestion={onOpenQuestion}
        />
        <div className="exam-actions">
          <button
            disabled={questionIndex === 0}
            onClick={() => onOpenQuestion(questionIndex - 1)}
          >
            &lsaquo; Zurück
          </button>
          {questionIndex + 1 < exam.questions.length ? (
            <button onClick={() => onOpenQuestion(questionIndex + 1)}>
              Weiter &rsaquo;
            </button>
          ) : null}
          <button className="primary" onClick={submit}>
            Abgeben
          </button>
        </div>
      </main>
    );
  }

  // --- the intro ---

  const resumable = attempt !== undefined && now < attempt.deadlineAt;
  return (
    <main className="exam">
      <h1>{exam.title}</h1>
      {examIsGenerated(exam, content) ? (
        <p className="badge-generated">KI-generiert</p>
      ) : null}
      <p>{exam.description}</p>
      <ul className="status">
        <li>{exam.questions.length} Fragen</li>
        <li>{maxPoints} Punkte</li>
        <li>Bestanden ab {exam.ruleset.passPercent}%</li>
        <li>{exam.ruleset.timeLimitMinutes} Minuten, am Stück</li>
      </ul>
      {resumable ? (
        <>
          <p className="status">
            Ein Versuch läuft noch — {formatClock(attempt.deadlineAt - now)}{" "}
            übrig.
          </p>
          <button className="primary" onClick={() => onOpenQuestion(0)}>
            Weitermachen
          </button>
        </>
      ) : (
        <button className="primary" onClick={start}>
          Prüfung starten
        </button>
      )}
      <button onClick={onReview}>Testmodus (ohne Zeitlimit)</button>
      {record.lastResult !== undefined ? (
        <button onClick={onOpenReport}>Letztes Ergebnis ansehen</button>
      ) : null}
      <button onClick={onBack}>Zurück</button>
    </main>
  );
}

/** The visible countdown. Its own component so the per-second re-render does
 * not take the boards with it. */
function ExamClock({ deadlineAt, now }: { deadlineAt: number; now: number }) {
  const left = deadlineAt - now;
  // Under a minute the clock is the thing on screen that matters most.
  const urgent = left <= 60_000;
  return (
    <p className={urgent ? "exam-clock urgent" : "exam-clock"}>
      {formatClock(left)}
    </p>
  );
}

/** Answered/unanswered at a glance, and a jump to any question — free
 * movement in both directions is the point of deferred grading. */
function ExamNavigator({
  exam,
  attempt,
  current,
  onOpenQuestion,
}: {
  exam: Exam;
  attempt: ExamAttempt;
  current: number;
  onOpenQuestion: (index: number) => void;
}) {
  return (
    <nav className="exam-nav" aria-label="Fragen">
      {exam.questions.map((entry, index) => {
        const answered = attempt.answers[entry.taskId] !== undefined;
        const classes = [
          "exam-nav-cell",
          answered ? "answered" : "",
          index === current ? "current" : "",
        ]
          .filter((c) => c !== "")
          .join(" ");
        return (
          <button
            key={entry.taskId}
            className={classes}
            aria-current={index === current ? "true" : undefined}
            aria-label={`Frage ${index + 1}${answered ? ", beantwortet" : ", offen"}`}
            onClick={() => onOpenQuestion(index)}
          >
            {index + 1}
          </button>
        );
      })}
    </nav>
  );
}

function ExamReport({
  exam,
  content,
  result,
  answers,
  questions,
  submitted,
  onPracticeMissed,
  onBack,
}: {
  exam: Exam;
  content: Content;
  result: ExamResult;
  answers: ReadonlyMap<string, ExamAnswer>;
  questions: ReadonlyMap<string, ChoiceQuestion | AssignQuestion>;
  submitted: boolean;
  onPracticeMissed: (taskIds: string[]) => void;
  onBack: () => void;
}) {
  if (!submitted) {
    return (
      <main className="exam">
        <p className="status">Für diese Prüfung gibt es noch kein Ergebnis.</p>
        <button onClick={onBack}>Zurück</button>
      </main>
    );
  }
  const missed = result.questions
    .filter((question) => !question.correct)
    .map((question) => question.taskId);
  // Readiness per lesson (plan 0027 §4/§6 amendment), weakest first: the
  // same per-lesson buckets the Book card's "weakest" line reads, sorted
  // here rather than by the engine, since "weakest first" is this report's
  // presentation choice — `readinessByLesson` itself only names the single
  // weakest lesson id.
  const readiness = readinessByLesson(
    exam,
    result.questions,
    content.topic.lessonIds,
  );
  const sortedReadiness = [...readiness.buckets].sort(
    (a, b) => a.percent - b.percent,
  );
  const lessonTitle = (lessonId: string | null): string =>
    lessonId === null
      ? "Other"
      : (content.lessons.find((l) => l.id === lessonId)?.title ?? lessonId);
  return (
    <main className="exam">
      <h1>{exam.title}</h1>
      <p className={result.passed ? "exam-verdict passed" : "exam-verdict"}>
        {result.passed ? "Bestanden" : "Nicht bestanden"}
      </p>
      <p className="status">
        {formatPoints(result.total)} von {result.maxPoints} Punkten ·{" "}
        {result.percentage.toFixed(1)}% · bestanden ab{" "}
        {exam.ruleset.passPercent}%
      </p>
      {examIsGenerated(exam, content) ? (
        <p className="status">
          KI-generiert und gegen nichts kalibriert: dieses Ergebnis sagt nichts
          über eine echte Prüfung aus.
        </p>
      ) : null}
      <section className="exam-readiness">
        <h2>Bereitschaft nach Lektion</h2>
        <ul className="status">
          {sortedReadiness.map((bucket) => (
            <li key={bucket.lessonId ?? "other"}>
              {lessonTitle(bucket.lessonId)}: {formatPoints(bucket.points)} /{" "}
              {formatPoints(bucket.maxPoints)} · {bucket.percent.toFixed(1)}%
            </li>
          ))}
        </ul>
      </section>
      <ol className="card-list">
        {result.questions.map((scored, index) => {
          const question = questions.get(scored.taskId);
          return (
            <li key={scored.taskId} className="card">
              <div>
                <p className="status">
                  Frage {index + 1} · {formatPoints(scored.scored)} von{" "}
                  {scored.points} {scored.points === 1 ? "Punkt" : "Punkte"}
                  {scored.correct ? " ✓" : ""}
                </p>
                {question === undefined ? (
                  <p className="status">Diese Frage gibt es nicht mehr.</p>
                ) : question.kind === "choice" ? (
                  <ChoiceBoard
                    question={question}
                    selected={
                      answers.get(scored.taskId)?.kind === "choice"
                        ? (
                            answers.get(scored.taskId) as {
                              kind: "choice";
                              selected: number[];
                            }
                          ).selected
                        : []
                    }
                    onChange={() => undefined}
                    whys={question.whys}
                    reveal
                    disabled
                  />
                ) : (
                  <AssignBoard
                    question={question}
                    chosen={
                      answers.get(scored.taskId)?.kind === "assign"
                        ? (
                            answers.get(scored.taskId) as {
                              kind: "assign";
                              chosen: (number | null)[];
                            }
                          ).chosen
                        : question.rows.map(() => null)
                    }
                    onChange={() => undefined}
                    whys={question.whys}
                    reveal
                    disabled
                  />
                )}
                {/* Plan 0027 §6: the report shows the same teaching the Check
                    and Review do — the reason per option, then the
                    explanation. A learner reading a failed exam is exactly
                    who needs it. */}
                {question === undefined ? null : (
                  <QuestionFeedback
                    explanation={question.explanation}
                    generated={question.explanationGenerated}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {missed.length > 0 ? (
        <button className="primary" onClick={() => onPracticeMissed(missed)}>
          Falsche Fragen üben ({missed.length})
        </button>
      ) : null}
      <button onClick={onBack}>Zurück</button>
    </main>
  );
}

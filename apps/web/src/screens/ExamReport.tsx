import { useEffect } from "react";
import type { Content } from "@betterbeaver/schema";
import { readinessByLesson, scoreExam } from "@betterbeaver/engine";
import {
  ChoiceOptions,
  AssignRows,
  QuestionFeedback,
} from "./session/interactions";
import { examQuestionsByTaskId } from "./examQuestions";
import { fitAnswers, readExamState } from "../progress/exam-attempts";

/** Rounds to 1 decimal (plan §4: "Displayed points and percentages round to
 * one decimal"). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The exam report (plan 0027 §6): the score against the pass mark, points
 * per lesson (weakest first), and every question with its stored marks and
 * feedback. Recomputes the score from the stored answers against *current*
 * content on every render, so a content update after the attempt applies —
 * a question the exam has since dropped simply does not appear.
 */
export function ExamReport({
  content,
  examId,
  onBack,
  onIntro,
  onPractice,
}: {
  content: Content;
  examId: string;
  onBack: () => void;
  /** No `lastResult` exists: redirect to the intro (plan §6). */
  onIntro: () => void;
  /** "Practise the questions you missed" (`?practice=1`). */
  onPractice: () => void;
}) {
  const exam = content.exams.find((e) => e.id === examId);
  const state = exam !== undefined ? readExamState(exam.id) : {};

  useEffect(() => {
    if (exam !== undefined && state.lastResult === undefined) {
      onIntro();
    }
    // `onIntro` deliberately absent: a fresh closure every render, and this
    // check only needs to rerun when the exam or its result actually change.
  }, [exam, state.lastResult]);

  if (exam === undefined) {
    return (
      <main>
        <p>Unknown exam: {examId}</p>
      </main>
    );
  }
  const { lastResult } = state;
  if (lastResult === undefined) {
    return (
      <main>
        <p>Loading&hellip;</p>
      </main>
    );
  }

  // The headline score and per-question feedback: recomputed from the
  // stored (discard-filtered) answers against current content.
  const answersByTaskId = fitAnswers(exam, content, lastResult.answersByTaskId);
  const score = scoreExam(exam, answersByTaskId, content);
  const questionByTaskId = examQuestionsByTaskId(
    exam.questions.map((entry) => entry.taskId),
    content,
  );

  // Readiness per lesson reads the *stored* points as they were at submit
  // time (plan §4/§6): a question the current exam added since then has no
  // entry here and is left out of its bucket entirely, not scored as 0.
  const { buckets, weakestLessonId } = readinessByLesson(
    exam,
    lastResult.pointsByTaskId,
    content.topic.lessonIds,
  );
  const weakestFirst = [...buckets].sort((a, b) => a.percent - b.percent);
  const lessonTitle = (lessonId: string | null) =>
    lessonId === null
      ? "Other"
      : (content.lessons.find((l) => l.id === lessonId)?.title ?? "Other");

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
      <h1>{exam.title}</h1>
      <p>
        {round1(score.total)} / {round1(score.max)} points ·{" "}
        {round1(score.percent)} % · {score.passed ? "Passed" : "Failed"}
      </p>

      <h2>Readiness by lesson</h2>
      <ul className="card-list">
        {weakestFirst.map((bucket) => (
          <li
            key={bucket.lessonId ?? "other"}
            className={bucket.lessonId === weakestLessonId ? "weakest" : ""}
          >
            {lessonTitle(bucket.lessonId)}: {round1(bucket.points)} /{" "}
            {round1(bucket.maxPoints)} ({round1(bucket.percent)} %)
          </li>
        ))}
      </ul>

      <h2>Questions</h2>
      {score.questions.map((qs) => {
        const question = questionByTaskId.get(qs.taskId);
        const answer = answersByTaskId[qs.taskId] ?? [];
        return (
          <div key={qs.taskId}>
            <p>
              {round1(qs.points)} / {qs.maxPoints}
            </p>
            {question !== undefined ? (
              <>
                <h3>{question.stem}</h3>
                {question.kind === "choice" ? (
                  <ChoiceOptions
                    choices={question.choices}
                    selected={answer as number[]}
                    graded={{
                      correctIndices: question.correctIndices,
                      whys: question.whys,
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
                    graded={{
                      correctLabelIndex: question.correctLabelIndex,
                      whys: question.whys,
                    }}
                  />
                )}
                <QuestionFeedback
                  explanation={question.explanation}
                  generated={question.explanationGenerated}
                />
              </>
            ) : null}
          </div>
        );
      })}

      {score.missedTaskIds.length > 0 ? (
        <button className="primary" onClick={onPractice}>
          Practise the questions you missed
        </button>
      ) : null}
    </main>
  );
}

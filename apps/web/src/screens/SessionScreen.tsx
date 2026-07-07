import { useState } from "react";
import type {
  Question,
  RecallQuestion,
  RecognizeQuestion,
} from "@betterbeaver/engine";
import type { Quality, SelfGrade } from "@betterbeaver/srs";
import { recallQuality, recognizeQuality } from "@betterbeaver/srs";

/** Tally of results across a session; only the fields for the task type(s)
 * actually encountered end up non-zero. */
export interface SessionSummary {
  recognizeCorrect: number;
  recognizeTotal: number;
  recallCounts: Record<SelfGrade, number>;
}

function emptySummary(): SessionSummary {
  return {
    recognizeCorrect: 0,
    recognizeTotal: 0,
    recallCounts: { again: 0, hard: 0, good: 0 },
  };
}

/**
 * Runs one task or review session: presents `questions` one at a time,
 * grades each answer via `onGrade`, and shows a summary panel after the
 * last question. Shared by the task-practice and review flows; the caller
 * decides what happens after (`onFinished`) and on early exit (`onExit`).
 */
export function SessionScreen({
  title,
  questions,
  onGrade,
  onFinished,
  onExit,
}: {
  title: string;
  questions: Question[];
  onGrade: (itemId: string, quality: Quality) => Promise<void>;
  onFinished: (summary: SessionSummary) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  const [done, setDone] = useState(false);

  const question = questions[index];

  function advance() {
    if (index + 1 >= questions.length) {
      setDone(true);
    } else {
      setIndex(index + 1);
      setPicked(null);
      setRevealed(false);
    }
  }

  async function handlePick(q: RecognizeQuestion, choiceIndex: number) {
    if (picked !== null) {
      return;
    }
    setPicked(choiceIndex);
    const correct = choiceIndex === q.correctIndex;
    setSummary((s) => ({
      ...s,
      recognizeCorrect: s.recognizeCorrect + (correct ? 1 : 0),
      recognizeTotal: s.recognizeTotal + 1,
    }));
    await onGrade(q.itemId, recognizeQuality(correct));
  }

  async function handleRecallGrade(q: RecallQuestion, grade: SelfGrade) {
    setSummary((s) => ({
      ...s,
      recallCounts: { ...s.recallCounts, [grade]: s.recallCounts[grade] + 1 },
    }));
    await onGrade(q.itemId, recallQuality(grade));
    advance();
  }

  const recallTotal =
    summary.recallCounts.again +
    summary.recallCounts.hard +
    summary.recallCounts.good;

  return (
    <main>
      <button onClick={onExit}>&larr; Exit</button>
      <h1>{title}</h1>

      {done ? (
        <section>
          {summary.recognizeTotal > 0 ? (
            <p>
              {summary.recognizeCorrect} of {summary.recognizeTotal} correct
            </p>
          ) : null}
          {recallTotal > 0 ? (
            <ul>
              <li>Again: {summary.recallCounts.again}</li>
              <li>Hard: {summary.recallCounts.hard}</li>
              <li>Good: {summary.recallCounts.good}</li>
            </ul>
          ) : null}
          <button onClick={() => onFinished(summary)}>Done</button>
        </section>
      ) : question === undefined ? null : (
        <>
          <p className="status">
            Question {index + 1} of {questions.length}
          </p>
          <p className="prompt">{question.prompt}</p>

          {question.kind === "recognize" ? (
            <>
              <ul className="card-list">
                {question.choices.map((choice, choiceIndex) => {
                  const state =
                    picked === null
                      ? ""
                      : choiceIndex === question.correctIndex
                        ? " correct"
                        : choiceIndex === picked
                          ? " incorrect"
                          : "";
                  return (
                    <li key={choiceIndex} className={`card${state}`}>
                      <button
                        disabled={picked !== null}
                        onClick={() => handlePick(question, choiceIndex)}
                      >
                        {choice}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {picked !== null ? <button onClick={advance}>Next</button> : null}
            </>
          ) : (
            <div>
              {!revealed ? (
                <button onClick={() => setRevealed(true)}>Show answer</button>
              ) : (
                <>
                  {question.reveal.map((line, lineIndex) => (
                    <p key={lineIndex}>{line}</p>
                  ))}
                  <div className="grade-buttons">
                    <button
                      onClick={() => handleRecallGrade(question, "again")}
                    >
                      Again
                    </button>
                    <button onClick={() => handleRecallGrade(question, "hard")}>
                      Hard
                    </button>
                    <button onClick={() => handleRecallGrade(question, "good")}>
                      Good
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

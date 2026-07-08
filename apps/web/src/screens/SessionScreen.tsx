import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  MatchingQuestion,
  Question,
  QuestionOutcome,
  ScrambleQuestion,
} from "@betterbeaver/engine";
import {
  checkMatchingPair,
  checkScrambleAnswer,
  checkTypedAnswer,
  matchingOutcomes,
} from "@betterbeaver/engine";
import type { Quality, SelfGrade } from "@betterbeaver/srs";
import { recallQuality, recognizeQuality } from "@betterbeaver/srs";
import { getAssetUrl } from "../content/bundled";

/** Tally of results across a session; only the fields for the task type(s)
 * actually encountered end up non-zero. Every auto-graded kind (recognize,
 * cloze, scramble, matching, listen, dictation, minimal-pair, picture)
 * shares one tally; recall and shadowing (self-graded) share the other. */
export interface SessionSummary {
  autoCorrect: number;
  autoTotal: number;
  recallCounts: Record<SelfGrade, number>;
}

function emptySummary(): SessionSummary {
  return {
    autoCorrect: 0,
    autoTotal: 0,
    recallCounts: { again: 0, hard: 0, good: 0 },
  };
}

/** Native audio element; unlimited replays for free, no custom player. */
function AudioPlayer({ topicId, stem }: { topicId: string; stem: string }) {
  const url = getAssetUrl(topicId, "audio", stem);
  if (url === undefined) {
    return <p className="status">Missing audio asset: {stem}</p>;
  }
  return <audio controls src={url} />;
}

function ImageDisplay({
  topicId,
  stem,
  alt,
}: {
  topicId: string;
  stem: string;
  alt: string;
}) {
  const url = getAssetUrl(topicId, "img", stem);
  if (url === undefined) {
    return <p className="status">Missing image asset: {stem}</p>;
  }
  return <img src={url} alt={alt} />;
}

/** Shared MCQ choice list: recognize, listen, minimal-pair, and picture all
 * pick one of N choices against a known correct index. */
function ChoiceList({
  choices,
  correctIndex,
  unitId,
  applyAuto,
  advance,
}: {
  choices: readonly string[];
  correctIndex: number;
  unitId: string;
  applyAuto: (unitId: string, correct: boolean) => Promise<void>;
  advance: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);

  async function pick(choiceIndex: number) {
    if (picked !== null) {
      return;
    }
    setPicked(choiceIndex);
    await applyAuto(unitId, choiceIndex === correctIndex);
  }

  return (
    <>
      <ul className="card-list">
        {choices.map((choice, choiceIndex) => {
          const state =
            picked === null
              ? ""
              : choiceIndex === correctIndex
                ? " correct"
                : choiceIndex === picked
                  ? " incorrect"
                  : "";
          return (
            <li key={choiceIndex} className={`card${state}`}>
              <button
                disabled={picked !== null}
                onClick={() => pick(choiceIndex)}
              >
                {choice}
              </button>
            </li>
          );
        })}
      </ul>
      {picked !== null ? <button onClick={advance}>Next</button> : null}
    </>
  );
}

/** Shared reveal + self-grade: recall (reveal the answer) and shadowing
 * (reveal the transcript) both show lines behind a reveal button, then
 * grade themselves via the existing again/hard/good buttons. */
function SelfGradeReveal({
  lines,
  revealLabel,
  unitId,
  applySelf,
  advance,
}: {
  lines: string[];
  revealLabel: string;
  unitId: string;
  applySelf: (unitId: string, grade: SelfGrade) => Promise<void>;
  advance: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(false);

  async function grade(selfGrade: SelfGrade) {
    if (graded) {
      return;
    }
    setGraded(true);
    await applySelf(unitId, selfGrade);
    advance();
  }

  return (
    <div>
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>{revealLabel}</button>
      ) : (
        <>
          {lines.map((line, lineIndex) => (
            <p key={lineIndex}>{line}</p>
          ))}
          <div className="grade-buttons">
            <button disabled={graded} onClick={() => grade("again")}>
              Again
            </button>
            <button disabled={graded} onClick={() => grade("hard")}>
              Hard
            </button>
            <button disabled={graded} onClick={() => grade("good")}>
              Good
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Shared typed-input form: cloze and dictation both type an answer, checked
 * via `checkTypedAnswer`, and reveal the target on submit. Form submit (not
 * a bare button) so Enter works. */
function TypedInput({
  target,
  unitId,
  applyAuto,
  advance,
}: {
  target: string;
  unitId: string;
  applyAuto: (unitId: string, correct: boolean) => Promise<void>;
  advance: () => void;
}) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<"correct" | "incorrect" | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (result !== null) {
      return;
    }
    const correct = checkTypedAnswer(target, value);
    setResult(correct ? "correct" : "incorrect");
    await applyAuto(unitId, correct);
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          disabled={result !== null}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" disabled={result !== null}>
          Submit
        </button>
      </form>
      {result !== null ? (
        <>
          <div className={`card ${result}`}>
            <div>{result === "correct" ? "Correct!" : `Answer: ${target}`}</div>
          </div>
          <button onClick={advance}>Next</button>
        </>
      ) : null}
    </div>
  );
}

/** Shuffled tokens as a pool of buttons; clicking one appends it to the
 * ordered answer row, clicking an answer token returns it to the pool (by
 * index, so duplicate token strings behave). */
function ScrambleInteraction({
  question,
  applyAuto,
  advance,
}: {
  question: ScrambleQuestion;
  applyAuto: (unitId: string, correct: boolean) => Promise<void>;
  advance: () => void;
}) {
  const [pool, setPool] = useState(
    question.tokens.map((token, key) => ({ token, key })),
  );
  const [answer, setAnswer] = useState<{ token: string; key: number }[]>([]);
  const [result, setResult] = useState<"correct" | "incorrect" | null>(null);

  function moveToAnswer(poolIndex: number) {
    if (result !== null) {
      return;
    }
    const entry = pool[poolIndex];
    if (entry === undefined) {
      return;
    }
    setPool(pool.filter((_, index) => index !== poolIndex));
    setAnswer([...answer, entry]);
  }

  function moveToPool(answerIndex: number) {
    if (result !== null) {
      return;
    }
    const entry = answer[answerIndex];
    if (entry === undefined) {
      return;
    }
    setAnswer(answer.filter((_, index) => index !== answerIndex));
    setPool([...pool, entry]);
  }

  async function submit() {
    if (result !== null) {
      return;
    }
    const correct = checkScrambleAnswer(
      question,
      answer.map((entry) => entry.token),
    );
    setResult(correct ? "correct" : "incorrect");
    await applyAuto(question.unitId, correct);
  }

  return (
    <div>
      <div className="token-row">
        {answer.map((entry, index) => (
          <button
            key={entry.key}
            disabled={result !== null}
            onClick={() => moveToPool(index)}
          >
            {entry.token}
          </button>
        ))}
      </div>
      <div className="token-row">
        {pool.map((entry, index) => (
          <button
            key={entry.key}
            disabled={result !== null}
            onClick={() => moveToAnswer(index)}
          >
            {entry.token}
          </button>
        ))}
      </div>
      {result === null ? (
        <button onClick={submit} disabled={pool.length > 0}>
          Submit
        </button>
      ) : (
        <>
          <div className={`card ${result}`}>
            <div>
              {result === "correct"
                ? "Correct!"
                : `Answer: ${question.targetTokens.join(" ")}`}
            </div>
          </div>
          <button onClick={advance}>Next</button>
        </>
      )}
    </div>
  );
}

/** Two columns (prompts, answers); every selection-pair is appended to a
 * history array and re-checked via `matchingOutcomes` — a non-null result
 * clears the board and applies every outcome at once. */
function MatchingBoard({
  question,
  applyMatchingOutcomes,
  advance,
}: {
  question: MatchingQuestion;
  applyMatchingOutcomes: (outcomes: QuestionOutcome[]) => Promise<void>;
  advance: () => void;
}) {
  const [selectedPrompt, setSelectedPrompt] = useState<number | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [history, setHistory] = useState<
    { promptIndex: number; answerIndex: number }[]
  >([]);
  const [clearedPrompts, setClearedPrompts] = useState<Set<number>>(new Set());
  const [clearedAnswers, setClearedAnswers] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);

  async function resolvePair(promptIndex: number, answerIndex: number) {
    const newHistory = [...history, { promptIndex, answerIndex }];
    setHistory(newHistory);
    if (checkMatchingPair(question, promptIndex, answerIndex)) {
      setClearedPrompts((cleared) => new Set(cleared).add(promptIndex));
      setClearedAnswers((cleared) => new Set(cleared).add(answerIndex));
    }
    setSelectedPrompt(null);
    setSelectedAnswer(null);
    const outcomes = matchingOutcomes(question, newHistory);
    if (outcomes !== null) {
      setFinished(true);
      await applyMatchingOutcomes(outcomes);
    }
  }

  function pickPrompt(promptIndex: number) {
    if (finished || clearedPrompts.has(promptIndex)) {
      return;
    }
    setSelectedPrompt(promptIndex);
    if (selectedAnswer !== null) {
      void resolvePair(promptIndex, selectedAnswer);
    }
  }

  function pickAnswer(answerIndex: number) {
    if (finished || clearedAnswers.has(answerIndex)) {
      return;
    }
    setSelectedAnswer(answerIndex);
    if (selectedPrompt !== null) {
      void resolvePair(selectedPrompt, answerIndex);
    }
  }

  return (
    <div>
      <div className="matching-board">
        <ul className="card-list">
          {question.prompts.map((prompt, index) => (
            <li
              key={index}
              className={`card${
                clearedPrompts.has(index)
                  ? " correct"
                  : selectedPrompt === index
                    ? " selected"
                    : ""
              }`}
            >
              <button
                disabled={finished || clearedPrompts.has(index)}
                onClick={() => pickPrompt(index)}
              >
                {prompt.text}
              </button>
            </li>
          ))}
        </ul>
        <ul className="card-list">
          {question.answers.map((answer, index) => (
            <li
              key={index}
              className={`card${
                clearedAnswers.has(index)
                  ? " correct"
                  : selectedAnswer === index
                    ? " selected"
                    : ""
              }`}
            >
              <button
                disabled={finished || clearedAnswers.has(index)}
                onClick={() => pickAnswer(index)}
              >
                {answer.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {finished ? <button onClick={advance}>Next</button> : null}
    </div>
  );
}

/** Renders the interaction for one question, per the plan's per-kind table.
 * Views only render and forward answers; all checking/normalization is
 * engine code (`checkTypedAnswer`, `checkScrambleAnswer`,
 * `checkMatchingPair`, `matchingOutcomes`). */
function renderInteraction(
  question: Question,
  topicId: string,
  applyAuto: (unitId: string, correct: boolean) => Promise<void>,
  applySelf: (unitId: string, grade: SelfGrade) => Promise<void>,
  applyMatchingOutcomes: (outcomes: QuestionOutcome[]) => Promise<void>,
  advance: () => void,
) {
  switch (question.kind) {
    case "recognize":
      return (
        <>
          <p className="prompt">{question.prompt}</p>
          <ChoiceList
            choices={question.choices}
            correctIndex={question.correctIndex}
            unitId={question.unitId}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    case "recall":
      return (
        <>
          <p className="prompt">{question.prompt}</p>
          <SelfGradeReveal
            lines={question.reveal}
            revealLabel="Show answer"
            unitId={question.unitId}
            applySelf={applySelf}
            advance={advance}
          />
        </>
      );
    case "cloze":
      return (
        <>
          <p className="prompt">{question.prompt}</p>
          <TypedInput
            target={question.target}
            unitId={question.unitId}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    case "dictation":
      return (
        <>
          <AudioPlayer topicId={topicId} stem={question.audioStem} />
          <TypedInput
            target={question.target}
            unitId={question.unitId}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    case "scramble":
      return (
        <ScrambleInteraction
          question={question}
          applyAuto={applyAuto}
          advance={advance}
        />
      );
    case "matching":
      return (
        <MatchingBoard
          question={question}
          applyMatchingOutcomes={applyMatchingOutcomes}
          advance={advance}
        />
      );
    case "listen":
      return (
        <>
          <AudioPlayer topicId={topicId} stem={question.audioStem} />
          <ChoiceList
            choices={question.choices}
            correctIndex={question.correctIndex}
            unitId={question.unitId}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    case "shadowing":
      return (
        <>
          <AudioPlayer topicId={topicId} stem={question.audioStem} />
          <SelfGradeReveal
            lines={question.transcript}
            revealLabel="Show transcript"
            unitId={question.unitId}
            applySelf={applySelf}
            advance={advance}
          />
        </>
      );
    case "minimal-pair":
      return (
        <>
          <AudioPlayer topicId={topicId} stem={question.audioStem} />
          <ChoiceList
            choices={question.choices}
            correctIndex={question.correctIndex}
            unitId={question.unitId}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    case "picture":
      return (
        <>
          <ImageDisplay topicId={topicId} stem={question.imageStem} alt="" />
          <ChoiceList
            choices={question.choices}
            correctIndex={question.correctIndex}
            unitId={question.unitId}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    default:
      question satisfies never;
      throw new Error(`unknown question kind: ${(question as Question).kind}`);
  }
}

/**
 * Runs one task or review session: presents `questions` one at a time,
 * grades each answer via `onGrade`, and shows a summary panel after the
 * last question. Shared by the task-practice and review flows; the caller
 * decides what happens after (`onFinished`) and on early exit (`onExit`).
 *
 * Every question resolves to a list of `(unitId, quality)` outcomes (the
 * outcome-list contract, plan 0002): single-unit questions apply one, a
 * cleared matching board applies N. `onGrade` is applied once per outcome;
 * `onAllAnswered` (optional) fires once, at grade time of the last
 * question, for callers that record task attempts — so exiting after the
 * final answer still counts as a completed attempt.
 */
export function SessionScreen({
  title,
  questions,
  topicId,
  onGrade,
  onAllAnswered,
  onFinished,
  onExit,
}: {
  title: string;
  questions: Question[];
  topicId: string;
  onGrade: (unitId: string, quality: Quality) => Promise<void>;
  onAllAnswered?: () => void;
  onFinished: (summary: SessionSummary) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  const [done, setDone] = useState(false);
  const answeredCount = useRef(0);

  const question = questions[index];

  function advance() {
    if (index + 1 >= questions.length) {
      setDone(true);
    } else {
      // Snapshot form (not a functional updater) so a stray double-call
      // within one render advances once, never skipping a question.
      setIndex(index + 1);
    }
  }

  /** Called once per question, when its outcome(s) are applied (each
   * interaction component guards against re-entry, so exactly once). */
  function noteAnswered() {
    answeredCount.current += 1;
    if (answeredCount.current === questions.length) {
      onAllAnswered?.();
    }
  }

  function tallyAuto(corrects: boolean[]) {
    setSummary((s) => ({
      ...s,
      autoCorrect: s.autoCorrect + corrects.filter(Boolean).length,
      autoTotal: s.autoTotal + corrects.length,
    }));
  }

  async function applyAuto(unitId: string, correct: boolean) {
    noteAnswered();
    tallyAuto([correct]);
    await onGrade(unitId, recognizeQuality(correct));
  }

  async function applySelf(unitId: string, grade: SelfGrade) {
    noteAnswered();
    setSummary((s) => ({
      ...s,
      recallCounts: { ...s.recallCounts, [grade]: s.recallCounts[grade] + 1 },
    }));
    await onGrade(unitId, recallQuality(grade));
  }

  async function applyMatchingOutcomes(outcomes: QuestionOutcome[]) {
    noteAnswered();
    tallyAuto(
      outcomes.map(([, quality]) => quality === recognizeQuality(true)),
    );
    for (const [unitId, quality] of outcomes) {
      await onGrade(unitId, quality);
    }
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
          {summary.autoTotal > 0 ? (
            <p>
              {summary.autoCorrect} of {summary.autoTotal} correct
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
        <div key={index}>
          <p className="status">
            Question {index + 1} of {questions.length}
          </p>
          {renderInteraction(
            question,
            topicId,
            applyAuto,
            applySelf,
            applyMatchingOutcomes,
            advance,
          )}
        </div>
      )}
    </main>
  );
}

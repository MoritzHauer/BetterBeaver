import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  BuildQuestion,
  MatchingQuestion,
  Question,
  QuestionOutcome,
  ScrambleQuestion,
} from "@betterbeaver/engine";
import type { Streak } from "@betterbeaver/engine";
import {
  checkMatchingPair,
  checkScrambleAnswer,
  checkTypedAnswer,
  localDay,
  matchingOutcomes,
  resolveToken,
} from "@betterbeaver/engine";
import { itemDisplayText } from "@betterbeaver/schema";
import type { Quality, SelfGrade } from "@betterbeaver/srs";
import { recallQuality, recognizeQuality } from "@betterbeaver/srs";
import type { TapLookup } from "../components/TappableText";
import { TappableText } from "../components/TappableText";
import { NoteView } from "../components/NoteView";
import { getAssetUrl } from "../content/bundled";
import { getNoteMarkdown } from "../content/source";
import { SpeakerButton } from "../tts";
import { playCorrect, playFanfare, playWrong } from "../sounds";

/** Tally of results across a session; only the fields for the task type(s)
 * actually encountered end up non-zero. Every auto-graded kind (recognize,
 * cloze, scramble, build, matching, listen, dictation, minimal-pair, picture)
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

type Verdict = "correct" | "incorrect";

/** The fixed bottom action bar (plan 0003): the single action zone of the
 * session screen. Neutral while answering; verdict-filled after. */
function ActionBar({
  verdict,
  children,
}: {
  verdict?: Verdict;
  children: ReactNode;
}) {
  return (
    <div className={`action-bar${verdict !== undefined ? ` ${verdict}` : ""}`}>
      <div className="action-bar-inner">{children}</div>
    </div>
  );
}

/** Post-answer state of the bar: verdict text plus a full-width Continue.
 * The Continue button is auto-focused so Enter continues (preserving the
 * form-submit-then-Enter flow of typed questions). */
function VerdictBar({
  verdict,
  detail,
  advance,
}: {
  verdict: Verdict;
  detail: string;
  advance: () => void;
}) {
  return (
    <ActionBar verdict={verdict}>
      <p className="verdict">{verdict === "correct" ? "Correct!" : detail}</p>
      <button autoFocus onClick={advance}>
        Continue
      </button>
    </ActionBar>
  );
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
 * pick one of N choices against a known correct index. Tap-to-answer, so the
 * action bar holds nothing until the verdict.
 *
 * `prompt`/`lookup` (recognize only, plan 0006 step 4): recognize's prompt
 * is target-language script, shown throughout the question — but tap-to-
 * lookup is pinned to post-answer surfaces only, so it renders as plain text
 * until `picked !== null`, then swaps to `TappableText`. */
function ChoiceList({
  prompt,
  lookup,
  choices,
  correctIndex,
  unitId,
  applyAuto,
  advance,
}: {
  prompt?: string;
  lookup?: TapLookup;
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
      {prompt !== undefined ? (
        <p className="prompt">
          {picked !== null && lookup !== undefined ? (
            <TappableText text={prompt} lookup={lookup} />
          ) : (
            prompt
          )}
        </p>
      ) : null}
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
      {picked !== null ? (
        <VerdictBar
          verdict={picked === correctIndex ? "correct" : "incorrect"}
          detail={`Answer: ${choices[correctIndex]}`}
          advance={advance}
        />
      ) : null}
    </>
  );
}

/** Shared reveal + self-grade: recall (reveal the answer) and shadowing
 * (reveal the transcript) both show lines behind a reveal action, then grade
 * themselves via Again/Hard/Good — all in the action bar (plan 0003). */
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
      {revealed
        ? lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)
        : null}
      <ActionBar>
        {!revealed ? (
          <button className="primary" onClick={() => setRevealed(true)}>
            {revealLabel}
          </button>
        ) : (
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
        )}
      </ActionBar>
    </div>
  );
}

/** A note-derived review question (plan 0008 step 7): the note's markdown
 * (or, missing that, its stem as a plain fallback) is the whole card — there
 * is nothing to reveal, so the Again/Hard/Good row appears immediately below
 * it, reusing the same `applySelf` pipeline as `SelfGradeReveal` (just
 * without a reveal gate). */
function NoteReview({
  markdown,
  fallbackStem,
  lookup,
  unitId,
  applySelf,
  advance,
}: {
  markdown: string | undefined;
  fallbackStem: string;
  lookup: TapLookup;
  unitId: string;
  applySelf: (unitId: string, grade: SelfGrade) => Promise<void>;
  advance: () => void;
}) {
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
      {markdown !== undefined ? (
        <NoteView markdown={markdown} lookup={lookup} />
      ) : (
        <p className="prompt">{fallbackStem}</p>
      )}
      <ActionBar>
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
      </ActionBar>
    </div>
  );
}

/** Reveal-on-tap hint control (plan 0008 step 5): a plain "Hint" button that
 * swaps itself for `text` once tapped, never submitting an answer. Shared by
 * cloze's target-word hint and build's now-hidden-by-default English prompt
 * — the same interaction shape, just fed different text. */
function HintReveal({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return revealed ? (
    <p className="prompt">{text}</p>
  ) : (
    <button
      type="button"
      className="plain tappable-token"
      onClick={() => setRevealed(true)}
    >
      Hint
    </button>
  );
}

/** Shared typed-input form: cloze and dictation both type an answer, checked
 * via `checkTypedAnswer`, and reveal the target on submit. The Check button
 * lives in the action bar, tied to the form via the native `form` attribute
 * so Enter still submits.
 *
 * `revealedText`/`lookup` (cloze only, plan 0006 step 4): once answered,
 * cloze reveals the sentence with its blank filled in — the "cloze sentence
 * revealed" pinned surface — as tappable text. Dictation never passes these
 * (its target is already the whole sentence with nothing left gapped, and
 * it isn't a pinned surface).
 *
 * `hint` (cloze only, plan 0008 step 5): the target blank's English word,
 * behind a `HintReveal` shown only while unanswered — purely additive, the
 * post-answer reveal above is unchanged. Dictation never passes it. */
function TypedInput({
  target,
  unitId,
  hint,
  revealedText,
  lookup,
  applyAuto,
  advance,
}: {
  target: string;
  unitId: string;
  hint?: string;
  revealedText?: string;
  lookup?: TapLookup;
  applyAuto: (unitId: string, correct: boolean) => Promise<void>;
  advance: () => void;
}) {
  const formId = useId();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);

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
      <form id={formId} onSubmit={handleSubmit}>
        <input
          type="text"
          autoFocus
          value={value}
          disabled={result !== null}
          onChange={(event) => setValue(event.target.value)}
        />
      </form>
      {result === null && hint !== undefined ? (
        <HintReveal text={hint} />
      ) : null}
      {result !== null && revealedText !== undefined && lookup !== undefined ? (
        <p className="prompt">
          <TappableText text={revealedText} lookup={lookup} />
        </p>
      ) : null}
      {result === null ? (
        <ActionBar>
          <button className="primary" type="submit" form={formId}>
            Check
          </button>
        </ActionBar>
      ) : (
        <VerdictBar
          verdict={result}
          detail={`Answer: ${target}`}
          advance={advance}
        />
      )}
    </div>
  );
}

/** Shuffled tokens as a pool of buttons; clicking one appends it to the
 * ordered answer row, clicking an answer token returns it to the pool (by
 * index, so duplicate token strings behave). Shared by scramble (all tokens
 * must be placed) and build (bank distractors may stay in the pool).
 *
 * `lookup` (plan 0006 step 4): once checked, the assembled sentence — "the
 * sentence just built" — renders again as tappable text below the (now
 * frozen) token rows. */
function ScrambleInteraction({
  question,
  lookup,
  applyAuto,
  advance,
}: {
  question: ScrambleQuestion | BuildQuestion;
  lookup: TapLookup;
  applyAuto: (unitId: string, correct: boolean) => Promise<void>;
  advance: () => void;
}) {
  const [pool, setPool] = useState(
    question.tokens.map((token, key) => ({ token, key })),
  );
  const [answer, setAnswer] = useState<{ token: string; key: number }[]>([]);
  const [result, setResult] = useState<Verdict | null>(null);

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
      {result !== null ? (
        <p className="prompt">
          <TappableText
            text={answer.map((entry) => entry.token).join(" ")}
            lookup={lookup}
          />
        </p>
      ) : null}
      {result === null ? (
        <ActionBar>
          <button
            className="primary"
            onClick={submit}
            disabled={
              question.kind === "scramble"
                ? pool.length > 0
                : answer.length === 0
            }
          >
            Check
          </button>
        </ActionBar>
      ) : (
        <VerdictBar
          verdict={result}
          detail={`Answer: ${question.targetTokens.join(" ")}`}
          advance={advance}
        />
      )}
    </div>
  );
}

/** Two columns (prompts, answers); every selection-pair is appended to a
 * history array and re-checked via `matchingOutcomes` — a non-null result
 * clears the board and applies every outcome at once. Per-pair feedback is
 * sound + card color; the action bar appears once the board clears.
 *
 * `lookup` (plan 0006 step 4): "the matched cards" — once a prompt card is
 * cleared (correctly matched), it swaps from a plain (now-disabled) button
 * to tappable text. Only the prompts column is target-language script; the
 * answers column is the gloss/translation side, so it's never tap-to-lookup
 * material and stays plain buttons throughout. */
function MatchingBoard({
  question,
  lookup,
  applyMatchingOutcomes,
  advance,
}: {
  question: MatchingQuestion;
  lookup: TapLookup;
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
    const correct = checkMatchingPair(question, promptIndex, answerIndex);
    if (correct) {
      playCorrect();
      setClearedPrompts((cleared) => new Set(cleared).add(promptIndex));
      setClearedAnswers((cleared) => new Set(cleared).add(answerIndex));
    } else {
      playWrong();
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
          {question.prompts.map((prompt, index) => {
            const cleared = clearedPrompts.has(index);
            return (
              <li
                key={index}
                className={`card${
                  cleared
                    ? " correct"
                    : selectedPrompt === index
                      ? " selected"
                      : ""
                }`}
              >
                {cleared ? (
                  <div>
                    <TappableText text={prompt.text} lookup={lookup} />
                  </div>
                ) : (
                  <button disabled={finished} onClick={() => pickPrompt(index)}>
                    {prompt.text}
                  </button>
                )}
              </li>
            );
          })}
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
      {finished ? (
        <VerdictBar verdict="correct" detail="" advance={advance} />
      ) : null}
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
  readAloudLang: string | undefined,
  lookup: TapLookup,
  applyAuto: (unitId: string, correct: boolean) => Promise<void>,
  applySelf: (unitId: string, grade: SelfGrade) => Promise<void>,
  applyMatchingOutcomes: (outcomes: QuestionOutcome[]) => Promise<void>,
  advance: () => void,
) {
  switch (question.kind) {
    case "recognize":
      return (
        <ChoiceList
          prompt={question.prompt}
          lookup={lookup}
          choices={question.choices}
          correctIndex={question.correctIndex}
          unitId={question.unitId}
          applyAuto={applyAuto}
          advance={advance}
        />
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
    case "cloze": {
      const hintItem = resolveToken(
        question.target,
        lookup.domainContent.entries,
      );
      const hint =
        hintItem !== undefined ? itemDisplayText(hintItem) : undefined;
      return (
        <>
          <p className="prompt">{question.prompt}</p>
          <TypedInput
            target={question.target}
            unitId={question.unitId}
            hint={hint}
            revealedText={question.prompt.replace("___", question.target)}
            lookup={lookup}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    }
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
          lookup={lookup}
          applyAuto={applyAuto}
          advance={advance}
        />
      );
    case "build":
      return (
        <>
          <HintReveal text={question.prompt} />
          <ScrambleInteraction
            question={question}
            lookup={lookup}
            applyAuto={applyAuto}
            advance={advance}
          />
        </>
      );
    case "matching":
      return (
        <MatchingBoard
          question={question}
          lookup={lookup}
          applyMatchingOutcomes={applyMatchingOutcomes}
          advance={advance}
        />
      );
    case "listen":
      return (
        <>
          {question.audio.kind === "stem" ? (
            <AudioPlayer topicId={topicId} stem={question.audio.stem} />
          ) : (
            <SpeakerButton text={question.audio.text} lang={readAloudLang} />
          )}
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
    case "note":
      return (
        <NoteReview
          markdown={getNoteMarkdown(topicId, question.stem)}
          fallbackStem={question.stem}
          lookup={lookup}
          unitId={question.unitId}
          applySelf={applySelf}
          advance={advance}
        />
      );
    default:
      question satisfies never;
      throw new Error(`unknown question kind: ${(question as Question).kind}`);
  }
}

/** Celebration panel (plan 0003 step 4): fanfare on mount, stat tiles for
 * the accuracy (auto-graded) or again/hard/good tallies (self-graded), and
 * the streak flame — animated when today's session extended it. */
function SummaryPanel({
  summary,
  loadStreak,
  onFinished,
}: {
  summary: SessionSummary;
  loadStreak?: () => Promise<Streak | null>;
  onFinished: (summary: SessionSummary) => void;
}) {
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    playFanfare();
    void loadStreak?.().then(setStreak);
  }, [loadStreak]);

  const recallTotal =
    summary.recallCounts.again +
    summary.recallCounts.hard +
    summary.recallCounts.good;
  const extendedToday =
    streak !== null && streak.lastActiveDay === localDay(new Date());

  return (
    <section>
      <h2>Session complete!</h2>
      <div className="stat-tiles">
        {summary.autoTotal > 0 ? (
          <div className="stat-tile">
            <span className="stat-value">
              {Math.round((summary.autoCorrect / summary.autoTotal) * 100)}%
            </span>
            <span className="status">
              {summary.autoCorrect} of {summary.autoTotal} correct
            </span>
          </div>
        ) : null}
        {recallTotal > 0 ? (
          <>
            <div className="stat-tile">
              <span className="stat-value">{summary.recallCounts.again}</span>
              <span className="status">Again</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.recallCounts.hard}</span>
              <span className="status">Hard</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.recallCounts.good}</span>
              <span className="status">Good</span>
            </div>
          </>
        ) : null}
        {streak !== null ? (
          <div className="stat-tile">
            <span className={`stat-value${extendedToday ? " flame-tick" : ""}`}>
              &#128293; {streak.length}
            </span>
            <span className="status">Day streak</span>
          </div>
        ) : null}
      </div>
      <ActionBar>
        <button
          className="primary"
          autoFocus
          onClick={() => onFinished(summary)}
        >
          Done
        </button>
      </ActionBar>
    </section>
  );
}

/**
 * Runs one task, review, or pooled unit-practice session: presents
 * `questions` one at a time, grades each answer via `onGrade`, and shows a
 * summary panel after the last question. Shared by the task-practice,
 * review, and unit-practice flows; the caller decides what happens after
 * (`onFinished`) and on early exit (`onExit`).
 *
 * Every question resolves to a list of `(unitId, quality)` outcomes (the
 * outcome-list contract, plan 0002): single-unit questions apply one, a
 * cleared matching board applies N. `onGrade` is applied once per outcome;
 * `onAllAnswered` (optional) fires once, at grade time of the last
 * question, for callers that record task attempts — so exiting after the
 * final answer still counts as a completed attempt. `onTaskAnswered` (plan
 * 0010, optional, only meaningful with `taskIds`) fires once per task, as
 * soon as that task's own questions are all answered — granular, unlike
 * `onAllAnswered`, so a pooled multi-task session credits each task as it
 * finishes rather than only at session-end.
 */
export function SessionScreen({
  title,
  questions,
  topicId,
  readAloudLang,
  lookup,
  taskIds,
  pinnedTaskIds,
  onTogglePin,
  onGrade,
  onAllAnswered,
  onTaskAnswered,
  onFinished,
  onExit,
  loadStreak,
}: {
  title: string;
  questions: Question[];
  topicId: string;
  /** The topic's `readAloudLang`, for TTS-backed listen questions (plan 0004). */
  readAloudLang?: string | undefined;
  /** The domain's tap-to-lookup dependencies (plan 0006 step 4), threaded to
   * every post-answer reveal surface the pinned rules cover (recognize's
   * prompt, the cloze/build/scramble revealed sentence, matching's matched
   * cards) — never to a not-yet-answered question. */
  lookup: TapLookup;
  /** Parallel array to `questions` (plan 0010): index *i*'s task, if the
   * question at index *i* came from one. Only the pooled unit-practice
   * session passes this — `TaskSession`/`ReviewSession` omit it, so the pin
   * control never renders there. */
  taskIds?: (string | undefined)[];
  pinnedTaskIds?: ReadonlySet<string>;
  onTogglePin?: (taskId: string) => void;
  onGrade: (unitId: string, quality: Quality) => Promise<void>;
  onAllAnswered?: () => void;
  /** Fires once per task, the moment every question tagged with that task's
   * id has been answered (plan 0010) — distinct from `onAllAnswered`, which
   * only fires once the whole session is done. Only meaningful when
   * `taskIds` is passed. */
  onTaskAnswered?: (taskId: string) => void;
  onFinished: (summary: SessionSummary) => void;
  onExit: () => void;
  /** Fetches the current streak for the summary panel (plan 0003). */
  loadStreak?: () => Promise<Streak | null>;
}) {
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  const [done, setDone] = useState(false);
  const answeredCount = useRef(0);

  // Per-task question totals (plan 0010), recomputed only when `taskIds`
  // changes: how many questions belong to each distinct task id, so
  // `noteAnswered` can tell when a given task's questions are all answered.
  const taskTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const taskId of taskIds ?? []) {
      if (taskId !== undefined) {
        totals.set(taskId, (totals.get(taskId) ?? 0) + 1);
      }
    }
    return totals;
  }, [taskIds]);
  const taskAnsweredCount = useRef(new Map<string, number>());

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
   * interaction component guards against re-entry, so exactly once). Reads
   * the current question's task id via `index` — called before `advance()`
   * shifts it, so it still points at the just-answered question. */
  function noteAnswered() {
    answeredCount.current += 1;
    if (answeredCount.current === questions.length) {
      onAllAnswered?.();
    }
    const taskId = taskIds?.[index];
    if (taskId !== undefined) {
      const counts = taskAnsweredCount.current;
      const nextCount = (counts.get(taskId) ?? 0) + 1;
      counts.set(taskId, nextCount);
      if (nextCount === taskTotals.get(taskId)) {
        onTaskAnswered?.(taskId);
      }
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
    if (correct) {
      playCorrect();
    } else {
      playWrong();
    }
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

  const currentTaskId = taskIds?.[index];

  return (
    <main className="session">
      <header className="session-header">
        <button className="plain exit" aria-label="Exit" onClick={onExit}>
          &#10005;
        </button>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={done ? questions.length : index}
        >
          <div
            className="progress-fill"
            style={{
              width: `${((done ? questions.length : index) / Math.max(questions.length, 1)) * 100}%`,
            }}
          />
        </div>
        {currentTaskId !== undefined ? (
          <button
            className="plain"
            onClick={() => onTogglePin?.(currentTaskId)}
          >
            {pinnedTaskIds?.has(currentTaskId) ? "📌 Pinned" : "📌 Pin"}
          </button>
        ) : null}
      </header>
      <h1>{title}</h1>

      {done ? (
        <SummaryPanel
          summary={summary}
          loadStreak={loadStreak}
          onFinished={onFinished}
        />
      ) : question === undefined ? null : (
        <div key={index} className="question">
          {renderInteraction(
            question,
            topicId,
            readAloudLang,
            lookup,
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

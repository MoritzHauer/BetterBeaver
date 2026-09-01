import { useEffect, useId, useRef, useState } from "react";
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
import { noteStorageUnwritable } from "../storage-health";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { BookWatermark } from "../components/BookWatermark";
import { Sheet } from "../components/Sheet";
import {
  SKIP_DAYS,
  getLearning,
  setLearning as setLearningSetting,
  type SkipLength,
} from "../learning";
import {
  KeyboardSetupCard,
  keyboardPlatform,
} from "../components/KeyboardSetupCard";
import { SWIPE_THRESHOLD } from "./UnitScreen";

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
function AudioPlayer({ bookId, stem }: { bookId: string; stem: string }) {
  const url = getAssetUrl(bookId, "audio", stem);
  if (url === undefined) {
    return <p className="status">Missing audio asset: {stem}</p>;
  }
  return <audio controls src={url} />;
}

function ImageDisplay({
  bookId,
  stem,
  alt,
}: {
  bookId: string;
  stem: string;
  alt: string;
}) {
  const url = getAssetUrl(bookId, "img", stem);
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
            {/* Sublabels, not next-interval previews (plan 0022 §9): Again
                and Hard both re-ask tomorrow, so a "1d" on each would make
                the two buttons look identical again — which is the confusion
                the ladder exists to remove. */}
            <button disabled={graded} onClick={() => grade("again")}>
              Again
              <small>start over</small>
            </button>
            <button disabled={graded} onClick={() => grade("hard")}>
              Hard
              <small>keep my place</small>
            </button>
            <button disabled={graded} onClick={() => grade("good")}>
              Good
              <small>advance</small>
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
  bookId,
  unitId,
  applySelf,
  advance,
}: {
  markdown: string | undefined;
  fallbackStem: string;
  lookup: TapLookup;
  /** The bare Book id (spec 0021-2 §2c), for a figure's `getAssetUrl` call —
   * not to be confused with `AudioPlayer`/`ImageDisplay`'s own `bookId` prop
   * above, a different component's copy of the same value. */
  bookId: string;
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
        <NoteView markdown={markdown} lookup={lookup} bookId={bookId} />
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
 * post-answer reveal above is unchanged. Dictation never passes it.
 *
 * `extraChars` (plan 0025 §10): characters the domain declares its script
 * needs and a learner's keyboard cannot produce — `ң ө ү` for Kyrgyz, whose
 * learners type on a Russian layout. Without the row those answers are
 * unanswerable, not merely awkward: grading is against the exact script and
 * normalization deliberately never folds ң onto н.
 *
 * Gated on the `extraKeys` setting, **off by default**: the real fix is the
 * platform keyboard layout, which the setup card walks the learner through,
 * and this row is the fallback for anyone who cannot install one. Absent or
 * empty `extraChars` means no row either way. */
function TypedInput({
  target,
  unitId,
  hint,
  extraChars,
  revealedText,
  lookup,
  applyAuto,
  advance,
}: {
  target: string;
  unitId: string;
  hint?: string;
  extraChars?: readonly string[] | undefined;
  revealedText?: string;
  lookup?: TapLookup;
  applyAuto: (unitId: string, correct: boolean) => Promise<void>;
  advance: () => void;
}) {
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // State, not a bare read: the setup card below can turn the row on, and
  // dismissing the card has to take it off screen without a navigation.
  const [learning, setLearning] = useState(() => getLearning());
  const showExtraKeys = learning.extraKeys;
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);
  const declared = extraChars ?? [];
  // The card is the first thing a learner sees on a typed answer whose
  // script needs characters their keyboard may not have (plan 0025 §10) —
  // once, until they dismiss it. Not shown after answering: by then the
  // question is moot for this card.
  const showSetupCard =
    result === null && declared.length > 0 && !learning.keyboardHelpDismissed;

  /** Inserts `char` at the caret and puts the caret after it, keeping focus
   * on the input so the on-screen keyboard never dismisses mid-answer.
   * Falls back to appending when the input has no selection (it is not
   * focused yet, so `selectionStart` is null). */
  function insertChar(char: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + char + value.slice(end));
    const caret = start + char.length;
    // The value lands on the DOM node in the commit after this handler, so
    // the caret has to be set once React has written it.
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  }

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
      {showSetupCard && (
        <KeyboardSetupCard
          chars={declared}
          platform={keyboardPlatform(navigator.userAgent)}
          extraKeys={showExtraKeys}
          onToggleExtraKeys={(next) => {
            setLearningSetting({ extraKeys: next });
            setLearning(getLearning());
          }}
          onDismiss={() => {
            setLearningSetting({ keyboardHelpDismissed: true });
            setLearning(getLearning());
          }}
        />
      )}
      <form id={formId} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={value}
          disabled={result !== null}
          onChange={(event) => setValue(event.target.value)}
        />
      </form>
      {result === null && showExtraKeys && declared.length > 0 ? (
        <div className="extra-keys">
          {declared.map((char) => (
            <button
              key={char}
              type="button"
              // Keeps the input focused: mousedown would blur it first, and
              // on a phone that closes the keyboard on every tap.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertChar(char)}
            >
              {char}
            </button>
          ))}
        </div>
      ) : null}
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

/** The scheduling-unit id(s) a question resolves to for pinning purposes: a
 * matching board's several ids (every prompt's and answer's unitId — a
 * matching board is one question), or the single `unitId` of every other
 * kind. */
function questionUnitIds(q: Question): string[] {
  return q.kind === "matching"
    ? [...q.prompts, ...q.answers].map((p) => p.unitId)
    : [q.unitId];
}

/** The three skip lengths (plan 0022 §5), opened by long-press/right-click on
 * Skip. Every one of them expires by itself, which is why there is no
 * indefinite option here and no un-skip screen anywhere: a card the learner
 * genuinely never wants is an authoring problem (delete the item), not a
 * scheduling one. */
function SkipSheet({
  onCancel,
  onSkip,
}: {
  onCancel: () => void;
  onSkip: (skip: SkipLength) => void;
}) {
  return (
    <Sheet label="Skip this card" onDismiss={onCancel}>
      <div className="sheet-prompt">
        <img
          className="summary-icon"
          src={`${import.meta.env.BASE_URL}art/icons/pause.png`}
          alt=""
        />
        <h2>Skip this card</h2>
        <p>It comes back on its own — pick how long to rest it.</p>
        <div className="sheet-actions">
          {SKIP_SHEET_OPTIONS.map(({ skip, label }) => (
            <button key={skip} onClick={() => onSkip(skip)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

const SKIP_SHEET_OPTIONS: { skip: SkipLength; label: string }[] = [
  { skip: "week", label: "1 week" },
  { skip: "month", label: "1 month" },
  { skip: "year", label: "1 year" },
];

/** Renders the interaction for one question, per the plan's per-kind table.
 * Views only render and forward answers; all checking/normalization is
 * engine code (`checkTypedAnswer`, `checkScrambleAnswer`,
 * `checkMatchingPair`, `matchingOutcomes`). */
function renderInteraction(
  question: Question,
  bookId: string,
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
            extraChars={lookup.domainContent.domain.extraChars}
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
          <AudioPlayer bookId={bookId} stem={question.audioStem} />
          <TypedInput
            target={question.target}
            unitId={question.unitId}
            extraChars={lookup.domainContent.domain.extraChars}
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
            <AudioPlayer bookId={bookId} stem={question.audio.stem} />
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
          <AudioPlayer bookId={bookId} stem={question.audioStem} />
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
          <AudioPlayer bookId={bookId} stem={question.audioStem} />
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
          <ImageDisplay bookId={bookId} stem={question.imageStem} alt="" />
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
          markdown={getNoteMarkdown(bookId, question.stem)}
          fallbackStem={question.stem}
          lookup={lookup}
          bookId={bookId}
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
  nextAction,
}: {
  summary: SessionSummary;
  loadStreak?: () => Promise<Streak | null>;
  onFinished: (summary: SessionSummary) => void;
  nextAction?: { label: string; onClick: () => void };
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
  // Self-graded recall has no pass/fail — only auto-graded accuracy earns a
  // thumbs-down beaver, and only below a middling score.
  const passed =
    summary.autoTotal === 0 || summary.autoCorrect / summary.autoTotal >= 0.7;

  return (
    <section>
      <img
        className="summary-icon"
        src={`${import.meta.env.BASE_URL}art/icons/thumbs_${passed ? "up" : "down"}_beaver.png`}
        alt=""
      />
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
              <img
                className="icon-glyph"
                src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
                alt=""
              />{" "}
              {streak.length}
            </span>
            <span className="status">Day streak</span>
          </div>
        ) : null}
      </div>
      <ActionBar>
        {nextAction !== undefined ? (
          <button className="primary" autoFocus onClick={nextAction.onClick}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/play.png`}
              alt=""
            />{" "}
            {nextAction.label}
          </button>
        ) : null}
        <button
          className={nextAction !== undefined ? "plain" : "primary"}
          autoFocus={nextAction === undefined}
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
 * cleared matching board applies N, and `onGrade` is applied once per
 * outcome. That is the whole of what a session reports now: the
 * task-attempt callbacks it used to fire went with the attempted-task set
 * plan 0025 §8 replaced, and completion is read from the levels those
 * grades write. `taskIds` stays, because Pin and Edit still need to know
 * which task produced a question.
 */
export function SessionScreen({
  title,
  questions,
  bookId,
  readAloudLang,
  lookup,
  taskIds,
  pinnedUnitIds,
  onTogglePin,
  onSkip,
  onEdit,
  onGrade,
  onFinished,
  nextAction,
  onExit,
  onSwipeBack,
  requeueOnAgain,
  loadStreak,
}: {
  title: string;
  questions: Question[];
  bookId: string;
  /** The book's `readAloudLang`, for TTS-backed listen questions (plan 0004). */
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
  pinnedUnitIds?: ReadonlySet<string>;
  onTogglePin?: (unitIds: string[]) => void;
  /** Push this card's next due date out (plan 0022 §5), the mirror of Pin:
   * surface later rather than surface first. **Review sessions only** — only
   * they are due-driven, so only there does a skip do anything visible, and
   * a card with no SRS state is not in a queue to be annoyed by. Passing the
   * prop is what renders the control. */
  onSkip?: (unitIds: string[], days: number) => Promise<void>;
  /** Edit affordance for whoever may edit this content (a maintainer, a
   * proposer, or a private Book's owner): opens the scoped sheet on the
   * current question's item/entry/task, over this session rather than
   * navigating away, so closing it resumes right here. Hidden on
   * `NoteQuestion` (no resolvable target) but otherwise independent of
   * `taskIds` — unlike Pin, it renders in `TaskSession`/`ReviewSession` too,
   * not just pooled unit sessions. */
  onEdit?: (index: number) => void;
  onGrade: (unitId: string, quality: Quality) => Promise<void>;
  onFinished: (summary: SessionSummary) => void;
  /** Plan 0020 §4: an optional forward step shown as the summary's primary
   * button. Only the pooled unit-practice session passes this — every other
   * session type (review, ad-hoc, recall, single-task) keeps a bare `Done`,
   * because "next unit" is not what follows them. */
  nextAction?: { label: string; onClick: () => void };
  onExit: () => void;
  /** Back-swipe target, in the same direction the Unit trail's `goPrev` uses
   * (owner request): only the unit-practice session passes it, to land back
   * on the trail's last content page. Ignored on the summary panel — leaving
   * there must go through Done/`nextAction`, which is what advances the
   * lesson. */
  onSwipeBack?: () => void;
  /** Re-show a failed card later in this same session (plan 0022 §4).
   * **Daily Review only.** Unit practice drives `onTaskAnswered` and plan
   * 0020's lesson chaining off its answer counts, and its own completion is
   * what unlocks the next unit — a queue that grows under it would be
   * reasoning about a moving target. Pedagogically the restriction costs
   * little: a unit session already drills each item across several task
   * types, whereas Daily Review shows each scheduling unit exactly once,
   * which is where a failure genuinely disappears for a day. */
  requeueOnAgain?: boolean;
  /** Fetches the current streak for the summary panel (plan 0003). */
  loadStreak?: () => Promise<Streak | null>;
}) {
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  const [done, setDone] = useState(false);
  const [skipSheetOpen, setSkipSheetOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  /**
   * The live queue (plan 0022 §4), as positions into `questions` rather than
   * copies of them: a failed card in Daily Review is re-inserted three cards
   * later, so the same question can occupy two positions, and the session is
   * not over until the second one is answered.
   *
   * Positions, not copies, because `questions` is a live prop — the scoped
   * `✎` sheet re-derives it from the draft mid-session, and a snapshot would
   * freeze the session on the pre-edit text. `repeat` marks the re-inserted
   * visit, which never requeues again: "answered again" ends it, however it
   * went, so a card the learner keeps failing cannot extend the session
   * forever.
   */
  const [queue, setQueue] = useState<{ source: number; repeat?: true }[]>(() =>
    questions.map((_, source) => ({ source })),
  );

  /**
   * The queue's length as of *now*, including an insertion made earlier in
   * this same tick. `advance()` runs immediately after the grade handler
   * that requeues, in the same closure, where `queue` is still the
   * pre-insertion array — without this, failing the last card of a review
   * would end the session on the spot and the requeued card would never be
   * shown. Re-synced on every render, so it can never drift.
   */
  const queueLength = useRef(queue.length);
  queueLength.current = queue.length;

  // Keep the queue in step with a `questions` prop that changed under us:
  // drop entries whose question is gone, append ones that appeared. Requeued
  // visits of surviving questions are preserved. Returning `current`
  // unchanged when nothing moved is what keeps this from looping.
  useEffect(() => {
    setQueue((current) => {
      const kept = current.filter((entry) => entry.source < questions.length);
      const seen = new Set(kept.map((entry) => entry.source));
      const added = questions
        .map((_, source) => source)
        .filter((source) => !seen.has(source))
        .map((source) => ({ source }));
      return kept.length === current.length && added.length === 0
        ? current
        : [...kept, ...added];
    });
  }, [questions.length]);

  // Clamped, not a bare `queue[index]`: the questions now re-derive from
  // the draft while the scoped `✎` sheet is open, and the sheet's exercise
  // card can drop an item — shrinking the list under a session already past
  // that point. `index` would then read past the end and the body rendered
  // blank with no way forward. Empty list still lands on `undefined`, which
  // the render below already handles.
  const entry = queue[Math.min(index, queue.length - 1)];
  const source = entry?.source;
  const question = source === undefined ? undefined : questions[source];

  function advance() {
    if (index + 1 >= queueLength.current) {
      setDone(true);
    } else {
      // Snapshot form (not a functional updater) so a stray double-call
      // within one render advances once, never skipping a question.
      setIndex(index + 1);
    }
  }

  function tallyAuto(corrects: boolean[]) {
    setSummary((s) => ({
      ...s,
      autoCorrect: s.autoCorrect + corrects.filter(Boolean).length,
      autoTotal: s.autoTotal + corrects.length,
    }));
  }

  // Every interaction component's answer/grade handler funnels through one
  // of these three (spec 0019 §3b) — wrapping here, once, covers all nine
  // `pick`/`grade`/`handleSubmit`/`submit`/`resolvePair` call sites at once.
  // The guard wraps the ENTIRE body, not just the `onGrade` await: a
  // blocked-storage throw out of `playCorrect`/`playWrong` (both synchronous
  // `localStorage` reads) would otherwise escape before `onGrade` ever runs
  // and trap the learner exactly like an unguarded `onGrade` rejection would
  // (owner decision 4: the learner is never trapped). Swallowing here,
  // rather than in the two `grade` functions that call `advance()` after,
  // means every caller — including the five
  // `pick`/`handleSubmit`/`submit`/`resolvePair` sites that never call
  // `advance()` themselves — still runs its own follow-up.
  /**
   * Re-inserts the current card three cards later (plan 0022 §4):
   * `min(index + 4, queue.length)` is one expression with no branch — with
   * at least three cards left it lands exactly three later, with fewer it
   * lands at the end. Nothing is persisted and nothing needs to be: Again
   * already put the card at rung 0 due tomorrow, so a closed app loses only
   * a same-day drill, and the requeued answer has no grading effect anyway
   * (`applyGrade` returns null for a card that is no longer due).
   */
  function requeueCurrent() {
    if (!requeueOnAgain || entry === undefined || entry.repeat === true) {
      return;
    }
    const position = Math.min(index, queue.length - 1);
    queueLength.current += 1;
    setQueue((current) => {
      const next = [...current];
      next.splice(Math.min(position + 4, current.length), 0, {
        source: entry.source,
        repeat: true,
      });
      return next;
    });
  }

  async function applyAuto(unitId: string, correct: boolean) {
    try {
      tallyAuto([correct]);
      if (correct) {
        playCorrect();
      } else {
        playWrong();
        requeueCurrent();
      }
      await onGrade(unitId, recognizeQuality(correct));
    } catch {
      noteStorageUnwritable();
    }
  }

  async function applySelf(unitId: string, grade: SelfGrade) {
    try {
      if (grade === "again") {
        requeueCurrent();
      }
      setSummary((s) => ({
        ...s,
        recallCounts: {
          ...s.recallCounts,
          [grade]: s.recallCounts[grade] + 1,
        },
      }));
      await onGrade(unitId, recallQuality(grade));
    } catch {
      noteStorageUnwritable();
    }
  }

  async function applyMatchingOutcomes(outcomes: QuestionOutcome[]) {
    try {
      tallyAuto(
        outcomes.map(([, quality]) => quality === recognizeQuality(true)),
      );
      for (const [unitId, quality] of outcomes) {
        await onGrade(unitId, quality);
      }
    } catch {
      noteStorageUnwritable();
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }
  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null || done) {
      return;
    }
    const endX = event.changedTouches[0]?.clientX ?? startX;
    if (endX - startX > SWIPE_THRESHOLD) {
      onSwipeBack?.();
    }
  }

  const currentTaskId = source === undefined ? undefined : taskIds?.[source];
  // No longer gated on `currentTaskId`: Pin still is (it is a unit-practice
  // control), but Skip lives in review sessions, which pass no `taskIds`.
  const currentUnitIds =
    question === undefined ? [] : questionUnitIds(question);
  const isPinned =
    currentUnitIds.length > 0 &&
    currentUnitIds.every((id) => pinnedUnitIds?.has(id));

  /** Pushes the current card out and moves on. Skipping is not an answer, so
   * nothing is tallied and nothing is graded — `advance()` alone. */
  async function skipCurrent(skip: SkipLength) {
    setSkipSheetOpen(false);
    if (onSkip === undefined || currentUnitIds.length === 0) {
      return;
    }
    try {
      await onSkip(currentUnitIds, SKIP_DAYS[skip]);
    } catch {
      noteStorageUnwritable();
    }
    advance();
  }

  return (
    <main
      className="session"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <BookWatermark bookId={bookId} />
      <header className="session-header">
        <button className="plain exit" aria-label="Exit" onClick={onExit}>
          &#10005;
        </button>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={queue.length}
          aria-valuenow={done ? queue.length : index}
        >
          <div
            className="progress-fill"
            style={{
              width: `${((done ? queue.length : index) / Math.max(queue.length, 1)) * 100}%`,
            }}
          />
        </div>
        {currentTaskId !== undefined ? (
          <button
            className="plain"
            onClick={() => onTogglePin?.(currentUnitIds)}
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/pin.png`}
              alt=""
            />{" "}
            {isPinned ? "Pinned" : "Pin"}
          </button>
        ) : null}
        {onSkip !== undefined && !done && currentUnitIds.length > 0 ? (
          <button
            className="plain skip"
            onClick={() => void skipCurrent(getLearning().skip)}
            // Long-press on Android Chrome and right-click on desktop are the
            // same native event, so one handler covers both — and it cannot
            // collide with the back-swipe detector bound to `main`, which
            // listens for touchstart/touchend rather than this. The CSS
            // `-webkit-touch-callout: none` on `.skip` stops iOS opening its
            // own callout menu over the sheet.
            onContextMenu={(event) => {
              event.preventDefault();
              setSkipSheetOpen(true);
            }}
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/pause.png`}
              alt=""
            />{" "}
            Skip
          </button>
        ) : null}
        {skipSheetOpen ? (
          <SkipSheet
            onCancel={() => setSkipSheetOpen(false)}
            onSkip={(skip) => void skipCurrent(skip)}
          />
        ) : null}
        {onEdit !== undefined &&
        question !== undefined &&
        question.kind !== "note" ? (
          <button className="plain" onClick={() => onEdit(index)}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/edit.png`}
              alt=""
            />{" "}
            Edit
          </button>
        ) : null}
        {currentTaskId !== undefined ? (
          <FeedbackWidget
            docId={`topic:${bookId}`}
            contentKind="task"
            contentId={currentTaskId}
          />
        ) : null}
      </header>
      <h1>{title}</h1>

      {done ? (
        <SummaryPanel
          summary={summary}
          loadStreak={loadStreak}
          onFinished={onFinished}
          nextAction={nextAction}
        />
      ) : question === undefined ? null : (
        <div key={index} className="question">
          {renderInteraction(
            question,
            bookId,
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

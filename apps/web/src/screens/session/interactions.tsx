/**
 * Every per-question interaction the session can show, and the switch that
 * picks one (plan 0002's per-kind table).
 *
 * Split out of `SessionScreen` because that file had grown past the ~1500
 * line ceiling `docs/design.md` pins for a single file, and because these
 * two things are genuinely separate jobs: this module knows how each
 * exercise kind is answered, and the screen knows what a session is. Views
 * only render and forward answers — all checking and normalization is engine
 * code (`checkTypedAnswer`, `checkScrambleAnswer`, `checkMatchingPair`,
 * `matchingOutcomes`).
 */
import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  BuildQuestion,
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
  resolveToken,
} from "@betterbeaver/engine";
import { itemDisplayText } from "@betterbeaver/schema";
import type { SelfGrade } from "@betterbeaver/srs";
import type { TapLookup } from "../../components/TappableText";
import { TappableText } from "../../components/TappableText";
import { NoteView } from "../../components/NoteView";
import { getAssetUrl } from "../../content/bundled";
import { getNoteMarkdown } from "../../content/source";
import { SpeakerButton } from "../../tts";
import { playCorrect, playWrong } from "../../sounds";
import { getLearning, setLearning as setLearningSetting } from "../../learning";
import {
  KeyboardSetupCard,
  keyboardPlatform,
} from "../../components/KeyboardSetupCard";
import { ActionBar, VerdictBar, type Verdict } from "./ActionBar";

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

/** Renders the interaction for one question, per the plan's per-kind table.
 * Views only render and forward answers; all checking/normalization is
 * engine code (`checkTypedAnswer`, `checkScrambleAnswer`,
 * `checkMatchingPair`, `matchingOutcomes`). */
export function renderInteraction(
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
    case "write":
      // Level 9 (plan 0025 §9): the meaning is the prompt, the foreign form
      // is typed. Same interaction as cloze and dictation, so the same form
      // — including the key row, for a script the keyboard cannot reach.
      return (
        <>
          <p className="prompt">{question.prompt}</p>
          <TypedInput
            target={question.target}
            unitId={question.unitId}
            extraChars={lookup.domainContent.domain.extraChars}
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

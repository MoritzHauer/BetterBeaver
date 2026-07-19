import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import {
  gapClozeMarkup,
  itemDisplayText,
  parseClozeMarkup,
  recallPrompt,
  recallReveal,
  recognizePrompt,
  sentenceTokens,
  stripClozeMarkup,
  RECOGNIZE_DISTRACTOR_COUNT,
} from "@betterbeaver/schema";
import type { Quality } from "@betterbeaver/srs";
import { blankUnitId, type SchedulingUnit } from "./units.js";
import { normalizeTypedInput } from "./normalize.js";

export interface RecognizeQuestion {
  kind: "recognize";
  unitId: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export interface RecallQuestion {
  kind: "recall";
  unitId: string;
  prompt: string;
  reveal: string[];
}

/** One cloze blank: the sentence with that blank gapped (others filled), typed target. Auto-graded via `checkTypedAnswer`. */
export interface ClozeQuestion {
  kind: "cloze";
  unitId: string;
  prompt: string;
  target: string;
}

/** One matching board for a whole task: both sides shuffled independently; see `checkMatchingPair`/`matchingOutcomes`. */
export interface MatchingQuestion {
  kind: "matching";
  prompts: { text: string; unitId: string }[];
  answers: { text: string; unitId: string }[];
}

/** One scrambled sentence: `tokens` is the shuffled order to display, `targetTokens` the correct order. Auto-graded via `checkScrambleAnswer`. */
export interface ScrambleQuestion {
  kind: "scramble";
  unitId: string;
  tokens: string[];
  targetTokens: string[];
}

/** How a listen question's prompt is played: a bundled audio asset (`stem`),
 * or live TTS over the item's script (`speak`, ad-hoc sessions only — plan
 * 0004). Task construction always emits `stem` (class (n) guarantees the
 * asset). */
export type ListenAudio =
  { kind: "stem"; stem: string } | { kind: "speak"; text: string };

/** MCQ over same-kind display texts, prompted by an audio clip. Auto-graded like `RecognizeQuestion`. */
export interface ListenQuestion {
  kind: "listen";
  unitId: string;
  audio: ListenAudio;
  choices: string[];
  correctIndex: number;
}

/** Hear the audio, type what was said. Auto-graded via `checkTypedAnswer`. */
export interface DictationQuestion {
  kind: "dictation";
  unitId: string;
  audioStem: string;
  target: string;
}

/** Hear the audio, repeat aloud, reveal the transcript, self-grade. */
export interface ShadowingQuestion {
  kind: "shadowing";
  unitId: string;
  audioStem: string;
  transcript: string[];
}

/** Hear one clip (coin-flipped which side), choose which near-homophone it was. Auto-graded (2-choice). */
export interface MinimalPairQuestion {
  kind: "minimal-pair";
  unitId: string;
  audioStem: string;
  choices: [string, string];
  correctIndex: number;
}

/** MCQ over same-kind display texts, prompted by an image. Auto-graded like `RecognizeQuestion`. */
export interface PictureQuestion {
  kind: "picture";
  unitId: string;
  imageStem: string;
  choices: string[];
  correctIndex: number;
}

/** Word bank size cap: a build bank holds the target tokens plus up to this many distractors. */
export const BUILD_DISTRACTOR_COUNT = 3;

/** One sentence to build from `prompt` (the translation): `tokens` is the
 * shuffled bank (target tokens + distractors, some may stay unused),
 * `targetTokens` the correct order. Auto-graded via `checkScrambleAnswer`. */
export interface BuildQuestion {
  kind: "build";
  unitId: string;
  prompt: string;
  tokens: string[];
  targetTokens: string[];
}

/** A note-derived scheduling unit due for review (plan 0008 step 7): the
 * note's markdown is the card itself, self-graded like `RecallQuestion` —
 * review-only, task sessions never produce this kind. */
export interface NoteQuestion {
  kind: "note";
  unitId: string;
  noteId: string;
  stem: string;
}

export type Question =
  | RecognizeQuestion
  | RecallQuestion
  | ClozeQuestion
  | MatchingQuestion
  | ScrambleQuestion
  | ListenQuestion
  | DictationQuestion
  | ShadowingQuestion
  | MinimalPairQuestion
  | PictureQuestion
  | BuildQuestion
  | NoteQuestion;

/** One `(schedulingUnitId, quality)` grading outcome (the outcome-list contract, plan 0002). */
export type QuestionOutcome = [unitId: string, quality: Quality];

/** Uniform random number in [0, 1), injected so sessions are reproducible in tests. */
export type Rng = () => number;

/** Builds the recall-presentation question for one item. */
function recallQuestion(item: Item): RecallQuestion {
  return {
    kind: "recall",
    unitId: item.id,
    prompt: recallPrompt(item),
    reveal: recallReveal(item),
  };
}

/**
 * Fisher-Yates shuffle of a copy of `items`, using `rng` for the swap index
 * at each step. Pinned algorithm: iterate `i` from `length - 1` down to 1,
 * `j = Math.floor(rng() * (i + 1))`, swap `i` and `j`. Exported for the
 * ad-hoc session builder (plan 0004) — the one shuffle everywhere.
 */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i >= 1; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/**
 * Samples `RECOGNIZE_DISTRACTOR_COUNT` same-kind distractors from
 * `unitItems` for `item` and splices its own display text in at a
 * shuffle-scripted index. Shared by `recognize`, `listen`, and `picture`
 * (the pinned shuffle-and-insert algorithm).
 */
function sampleMcq(
  item: Item,
  unitItems: Item[],
  rng: Rng,
): { choices: string[]; correctIndex: number } {
  const candidates = unitItems.filter(
    (c) => c.id !== item.id && c.kind === item.kind,
  );
  const distractors = shuffle(candidates, rng).slice(
    0,
    RECOGNIZE_DISTRACTOR_COUNT,
  );
  const correctIndex = Math.floor(rng() * (RECOGNIZE_DISTRACTOR_COUNT + 1));
  const choices = distractors.map((candidate) => itemDisplayText(candidate));
  choices.splice(correctIndex, 0, itemDisplayText(item));
  return { choices, correctIndex };
}

/** The unit whose `taskIds` contains `task.id` (guaranteed unique by the content validator). */
function owningUnitOf(task: Task, content: Content) {
  return content.units.find((unit) => unit.taskIds.includes(task.id))!;
}

/** An item's `audioRef` stem; only `lexeme`/`concept`/`sentence` carry one (guaranteed present by validator class (n)). */
function requiredAudioStem(item: Item): string {
  if (item.kind === "pair") {
    throw new Error(`item "${item.id}" is a pair; use its own a/b audioRef`);
  }
  const stem = item.payload.audioRef;
  if (stem === undefined) {
    throw new Error(`item "${item.id}" is missing audioRef`);
  }
  return stem;
}

/** An item's `imageRef` stem; only `lexeme`/`concept` carry one (guaranteed present by validator class (n)). */
function requiredImageStem(item: Item): string {
  if (item.kind !== "lexeme" && item.kind !== "concept") {
    throw new Error(`item "${item.id}" has no imageRef`);
  }
  const stem = item.payload.imageRef;
  if (stem === undefined) {
    throw new Error(`item "${item.id}" is missing imageRef`);
  }
  return stem;
}

/** Reveal transcript for a `shadowing` question, per item kind (plan 0002's presentation rule). */
function shadowingTranscript(item: Item): string[] {
  switch (item.kind) {
    case "lexeme":
      return [item.payload.script, item.payload.transliteration];
    case "concept":
      return [item.payload.term];
    case "sentence":
      return [stripClozeMarkup(item.payload.text)];
    case "pair":
      throw new Error(
        `item "${item.id}" is a pair; shadowing never uses pair items`,
      );
  }
}

/** Builds the cloze question for one blank of a sentence item. */
function buildClozeQuestion(
  item: Extract<Item, { kind: "sentence" }>,
  blankNumber: number,
): ClozeQuestion {
  const { prompt, target } = gapClozeMarkup(item.payload.text, blankNumber);
  return {
    kind: "cloze",
    unitId: blankUnitId(item.id, blankNumber),
    prompt,
    target,
  };
}

/** Builds the minimal-pair question for a pair item, coin-flipping which side plays (the only nondeterminism in review). */
function buildMinimalPairQuestion(
  item: Extract<Item, { kind: "pair" }>,
  rng: Rng,
): MinimalPairQuestion {
  const playsA = rng() < 0.5;
  const playing = playsA ? item.payload.a : item.payload.b;
  return {
    kind: "minimal-pair",
    unitId: item.id,
    audioStem: playing.audioRef,
    choices: [item.payload.a.script, item.payload.b.script],
    correctIndex: playsA ? 0 : 1,
  };
}

/** Checks a typed answer (cloze/dictation) against a target, both normalized via `normalizeTypedInput`. */
export function checkTypedAnswer(target: string, answer: string): boolean {
  return normalizeTypedInput(answer) === normalizeTypedInput(target);
}

/** Checks a scramble/build answer: the learner's ordered token strings joined with single spaces must equal the target's (duplicate tokens interchangeable by construction; build bank distractors may stay unused). */
export function checkScrambleAnswer(
  question: ScrambleQuestion | BuildQuestion,
  orderedTokens: string[],
): boolean {
  return orderedTokens.join(" ") === question.targetTokens.join(" ");
}

/** Whether a matching selection (prompt index, answer index) is a correct pair. Out-of-range indices are never correct. */
export function checkMatchingPair(
  question: MatchingQuestion,
  promptIndex: number,
  answerIndex: number,
): boolean {
  const prompt = question.prompts[promptIndex];
  const answer = question.answers[answerIndex];
  return (
    prompt !== undefined &&
    answer !== undefined &&
    prompt.unitId === answer.unitId
  );
}

/**
 * Reduces a matching board's selection history to its outcome list (pinned
 * mechanics): per prompt item, the first selection whose prompt side is
 * that item decides its grade (correct -> 4, wrong -> 2); later retries
 * don't change it. Outcomes are emitted only once every prompt has been
 * correctly matched at least once (the board clears); returns `null` for an
 * abandoned board (nothing graded).
 */
export function matchingOutcomes(
  question: MatchingQuestion,
  selections: { promptIndex: number; answerIndex: number }[],
): QuestionOutcome[] | null {
  const decided = new Map<number, Quality>();
  const cleared = new Set<number>();
  for (const selection of selections) {
    const correct = checkMatchingPair(
      question,
      selection.promptIndex,
      selection.answerIndex,
    );
    if (!decided.has(selection.promptIndex)) {
      decided.set(selection.promptIndex, correct ? 4 : 2);
    }
    if (correct) {
      cleared.add(selection.promptIndex);
    }
  }
  if (cleared.size !== question.prompts.length) {
    return null;
  }
  return question.prompts.map((prompt, index) => [
    prompt.unitId,
    decided.get(index)!,
  ]);
}

/**
 * Builds the questions for one task, in `task.itemIds` order. See plan
 * 0002's per-type table for the construction rule of each new type; `rng`
 * drives every shuffle/sample/coin-flip (the pinned Fisher-Yates `shuffle`
 * is the only shuffle) so sessions are reproducible in tests.
 */
export function buildTaskSession(
  task: Task,
  content: Content,
  rng: Rng,
): Question[] {
  const itemById = new Map(content.items.map((item) => [item.id, item]));

  switch (task.type) {
    case "recall":
      return task.itemIds.map((itemId) =>
        recallQuestion(itemById.get(itemId)!),
      );

    case "recognize": {
      const owningUnit = owningUnitOf(task, content);
      const unitItems = owningUnit.itemIds.map((id) => itemById.get(id)!);

      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        const { choices, correctIndex } = sampleMcq(item, unitItems, rng);
        return {
          kind: "recognize",
          unitId: itemId,
          prompt: recognizePrompt(item),
          choices,
          correctIndex,
        };
      });
    }

    case "cloze": {
      const questions: ClozeQuestion[] = [];
      for (const itemId of task.itemIds) {
        const item = itemById.get(itemId)!;
        if (item.kind !== "sentence") {
          throw new Error(`cloze item "${itemId}" is not a sentence`);
        }
        const parsed = parseClozeMarkup(item.payload.text);
        const blanks = parsed.valid ? parsed.blanks : [];
        const sortedBlanks = [...blanks].sort((a, b) => a.number - b.number);
        for (const blank of sortedBlanks) {
          questions.push(buildClozeQuestion(item, blank.number));
        }
      }
      return questions;
    }

    case "matching": {
      const items = task.itemIds.map((itemId) => itemById.get(itemId)!);
      const prompts = shuffle(items, rng).map((item) => ({
        text: recognizePrompt(item),
        unitId: item.id,
      }));
      const answers = shuffle(items, rng).map((item) => ({
        text: itemDisplayText(item),
        unitId: item.id,
      }));
      return [{ kind: "matching", prompts, answers }];
    }

    case "scramble":
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        if (item.kind !== "sentence") {
          throw new Error(`scramble item "${itemId}" is not a sentence`);
        }
        const targetTokens = sentenceTokens(item.payload.text);
        return {
          kind: "scramble",
          unitId: itemId,
          tokens: shuffle(targetTokens, rng),
          targetTokens,
        };
      });

    case "listen": {
      const owningUnit = owningUnitOf(task, content);
      const unitItems = owningUnit.itemIds.map((id) => itemById.get(id)!);
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        const { choices, correctIndex } = sampleMcq(item, unitItems, rng);
        return {
          kind: "listen",
          unitId: itemId,
          audio: { kind: "stem", stem: requiredAudioStem(item) },
          choices,
          correctIndex,
        };
      });
    }

    case "dictation":
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        if (item.kind !== "sentence") {
          throw new Error(`dictation item "${itemId}" is not a sentence`);
        }
        return {
          kind: "dictation",
          unitId: itemId,
          audioStem: requiredAudioStem(item),
          target: stripClozeMarkup(item.payload.text),
        };
      });

    case "shadowing":
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        return {
          kind: "shadowing",
          unitId: itemId,
          audioStem: requiredAudioStem(item),
          transcript: shadowingTranscript(item),
        };
      });

    case "minimal-pair":
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        if (item.kind !== "pair") {
          throw new Error(`minimal-pair item "${itemId}" is not a pair`);
        }
        return buildMinimalPairQuestion(item, rng);
      });

    case "picture": {
      const owningUnit = owningUnitOf(task, content);
      const unitItems = owningUnit.itemIds.map((id) => itemById.get(id)!);
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        const { choices, correctIndex } = sampleMcq(item, unitItems, rng);
        return {
          kind: "picture",
          unitId: itemId,
          imageStem: requiredImageStem(item),
          choices,
          correctIndex,
        };
      });
    }

    case "build": {
      const owningUnit = owningUnitOf(task, content);
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        if (item.kind !== "sentence") {
          throw new Error(`build item "${itemId}" is not a sentence`);
        }
        const targetTokens = sentenceTokens(item.payload.text);
        // Distractor pool: the other sentence items' tokens, deduplicated by
        // string, minus anything case-insensitively equal to a target token
        // (a duplicate chip is indistinguishable; a re-cased one an unfair
        // trap). Fewer/zero candidates just means a smaller bank.
        const targetLower = new Set(targetTokens.map((t) => t.toLowerCase()));
        const pool = [
          ...new Set(
            owningUnit.itemIds.flatMap((id) => {
              const sibling = itemById.get(id)!;
              return sibling.id !== item.id && sibling.kind === "sentence"
                ? sentenceTokens(sibling.payload.text)
                : [];
            }),
          ),
        ].filter((token) => !targetLower.has(token.toLowerCase()));
        const distractors = shuffle(pool, rng).slice(0, BUILD_DISTRACTOR_COUNT);
        return {
          kind: "build",
          unitId: itemId,
          prompt: item.payload.translation,
          tokens: shuffle([...targetTokens, ...distractors], rng),
          targetTokens,
        };
      });
    }

    default:
      task.type satisfies never;
      throw new Error(`unknown task type: ${task.type as string}`);
  }
}

/**
 * Builds one pooled, shuffled session across an entire content `Unit`'s task
 * set (plan 0010): every `taskIds` entry's questions (via `buildTaskSession`)
 * are tagged with that task's id, concatenated, then shuffled once as a
 * whole — no sampling/capping, no per-task grouping preserved.
 *
 * Returns `{ question, taskId }` pairs rather than bare `Question[]`: a
 * `Question`'s own `unitId` field is an SRS scheduling-unit id (unrelated to
 * which content `Unit`/`Task` produced it), and a `NoteQuestion` or
 * `matching` board has no field that reverse-maps to a task at all. Tracking
 * `taskId` at construction time is the only reliable way to carry it
 * forward.
 */
export function buildUnitSession(
  unit: Unit,
  content: Content,
  rng: Rng,
): { question: Question; taskId: string }[] {
  const taskById = new Map(content.tasks.map((task) => [task.id, task]));
  const pairs = unit.taskIds.flatMap((taskId) => {
    const task = taskById.get(taskId);
    if (task === undefined) {
      return [];
    }
    return buildTaskSession(task, content, rng).map((question) => ({
      question,
      taskId,
    }));
  });
  return shuffle(pairs, rng);
}

/**
 * Counts the actual questions/flashcards `buildUnitSession` would produce
 * for `unit`, without building any `Question` objects or requiring an `Rng`
 * (plan 0011): mirrors `buildTaskSession`'s per-type question count, since
 * `unit.taskIds.length` alone counts task groups, not individual questions
 * (e.g. a 5-item `recall` task is 5 questions; a `matching` task is 1
 * question regardless of item count; a `cloze` task is one question per
 * blank across its items).
 */
function countTaskQuestions(task: Task, itemById: Map<string, Item>): number {
  switch (task.type) {
    case "matching":
      return 1;
    case "cloze":
      return task.itemIds.reduce((sum, itemId) => {
        const item = itemById.get(itemId);
        if (item === undefined || item.kind !== "sentence") {
          return sum;
        }
        const parsed = parseClozeMarkup(item.payload.text);
        return sum + (parsed.valid ? parsed.blanks.length : 0);
      }, 0);
    case "recall":
    case "recognize":
    case "scramble":
    case "listen":
    case "dictation":
    case "shadowing":
    case "minimal-pair":
    case "picture":
    case "build":
      return task.itemIds.length;
    default:
      task.type satisfies never;
      throw new Error(`unknown task type: ${task.type as string}`);
  }
}

export function countUnitQuestions(unit: Unit, content: Content): number {
  const taskById = new Map(content.tasks.map((task) => [task.id, task]));
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  return unit.taskIds.reduce((total, taskId) => {
    const task = taskById.get(taskId);
    return task === undefined
      ? total
      : total + countTaskQuestions(task, itemById);
  }, 0);
}

/**
 * Builds a review session, one question per due unit (amendment 3, plan
 * 0002): `lexeme`/`concept`/plain-`sentence` units use the recall
 * presentation (self-graded); a due cloze blank uses that blank's cloze
 * question (auto); a due `pair` uses a minimal-pair question (auto); a due
 * note (plan 0008 step 7) uses a `NoteQuestion` (self-graded). `rng` drives
 * only the minimal-pair coin flip, the sole nondeterminism in review.
 */
export function buildReviewSession(
  dueUnits: SchedulingUnit[],
  content: Content,
  rng: Rng,
): Question[] {
  return dueUnits.map((unit): Question => {
    if (unit.note !== undefined) {
      return {
        kind: "note",
        unitId: unit.id,
        noteId: unit.note.id,
        stem: unit.note.stem,
      };
    }
    if (unit.item === undefined) {
      throw new Error(`scheduling unit "${unit.id}" has neither item nor note`);
    }
    if (unit.blankNumber !== undefined) {
      if (unit.item.kind !== "sentence") {
        throw new Error(
          `blank unit "${unit.id}" owning item is not a sentence`,
        );
      }
      return buildClozeQuestion(unit.item, unit.blankNumber);
    }
    if (unit.item.kind === "pair") {
      return buildMinimalPairQuestion(unit.item, rng);
    }
    return recallQuestion(unit.item);
  });
}

import type {
  Content,
  Exercise,
  Item,
  Task,
  TaskType,
  Unit,
} from "@betterbeaver/schema";
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
  TASK_EXERCISES,
} from "@betterbeaver/schema";
import type { Quality } from "@betterbeaver/srs";
import { blankUnitId, type SchedulingUnit } from "./units.js";
import { availableExercises, drawExercise } from "./draw.js";
import { plannedVisits, startDrill } from "./drill.js";
import { normalizeTypedInput } from "./normalize.js";
import { shuffle, type Rng } from "./rng.js";

// Re-exported so every existing importer of `shuffle`/`Rng` keeps working.
export { shuffle, type Rng };

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
/**
 * Type the foreign form from its meaning (plan 0025 §9, level 9): prompt is
 * the item's display text, target its `recognizePrompt`. Auto-graded via
 * `checkTypedAnswer`, the same check cloze and dictation use.
 *
 * Derived, not authored — no task type builds this, which is what makes the
 * top of the ladder reachable on Books published before the plan existed.
 * Lexemes and concepts only: typing a whole sentence from its translation is
 * dictation without the audio, and belongs at level 10 if anywhere.
 */
export interface WriteQuestion {
  kind: "write";
  unitId: string;
  prompt: string;
  target: string;
}

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

/** MCQ over same-kind foreign forms, prompted by an image. Auto-graded like
 * `RecognizeQuestion`. Production direction (plan 0025 §2): an image over a
 * list of English glosses puts no foreign form on the screen at all, so it
 * tests nothing about the language. */
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
  | WriteQuestion
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
 * Samples `RECOGNIZE_DISTRACTOR_COUNT` same-kind distractors from
 * `unitItems` for `item` and splices `item`'s own choice in at a
 * shuffle-scripted index. Shared by `recognize`, `listen` and `picture`
 * (the pinned shuffle-and-insert algorithm).
 *
 * `choiceText` is the direction (plan 0025 §2): `itemDisplayText` renders
 * the meaning side, so the learner comprehends; `recognizePrompt` renders
 * the foreign side, so the learner produces. Distractors are rendered the
 * same way as the answer, or they would give themselves away.
 *
 * Choices are deduplicated *by rendered text*. The validator's class (h)
 * only guarantees distinct display texts, so a produce-direction board can
 * be handed two items that share a script — an unanswerable question, since
 * only one of the two identical buttons is the correct index. Dropping the
 * clash yields a shorter board instead, exactly as a unit short of siblings
 * does. Filtering happens before the shuffle so content without a clash
 * consumes the rng identically.
 */
function sampleMcq(
  item: Item,
  unitItems: Item[],
  rng: Rng,
  choiceText: (candidate: Item) => string,
): { choices: string[]; correctIndex: number } {
  const answer = choiceText(item);
  const candidates = unitItems.filter(
    (c) => c.id !== item.id && c.kind === item.kind,
  );
  const seen = new Set([answer]);
  const distractors: string[] = [];
  for (const candidate of shuffle(candidates, rng)) {
    if (distractors.length === RECOGNIZE_DISTRACTOR_COUNT) {
      break;
    }
    const text = choiceText(candidate);
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    distractors.push(text);
  }
  // Clamped, because a board short of distractors would otherwise report a
  // correct index past its own end (splice silently appends).
  const correctIndex = Math.min(
    Math.floor(rng() * (RECOGNIZE_DISTRACTOR_COUNT + 1)),
    distractors.length,
  );
  const choices = [...distractors];
  choices.splice(correctIndex, 0, answer);
  return { choices, correctIndex };
}

/** The unit whose `taskIds` contains `task.id` — unique, and present, for
 * any content the validator has passed. `undefined` is reachable only from a
 * draft, so this no longer asserts; `buildTaskSession`'s `owningUnitItems`
 * degrades to an empty distractor pool rather than throwing. */
function owningUnitOf(task: Task, content: Content): Unit | undefined {
  return content.units.find((unit) => unit.taskIds.includes(task.id));
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
  rawTask: Task,
  content: Content,
  rng: Rng,
): Question[] {
  const itemById = new Map(content.items.map((item) => [item.id, item]));

  /**
   * Every `itemById.get(id)!` below is sound only over *validated* content,
   * where the reference checker has already proved each id resolves. That
   * stopped being the only caller: an edit session renders through
   * `draftContent`, whose whole contract is that it never fails, and it
   * settles the Book document before the lexicon — so for one render a unit
   * that references lexicon words has itemIds that resolve to nothing. The
   * assertions then handed `undefined` to `sampleMcq`, which crashed the
   * running session outright.
   *
   * Dropping the unresolvable ids once, here, covers all eleven task types
   * and both id lists rather than repeating a guard sixteen times. Validated
   * content filters nothing, so this is invisible to every existing caller.
   */
  const resolves = (id: string) => itemById.has(id);
  const task = rawTask.itemIds.every(resolves)
    ? rawTask
    : { ...rawTask, itemIds: rawTask.itemIds.filter(resolves) };
  /** The owning unit's items, holes dropped — the distractor pool for the
   * MCQ types and the token bank for `build`. A missing owner (only
   * reachable from a draft) yields an empty pool, not a throw. */
  const owningUnitItems = (): Item[] =>
    (owningUnitOf(task, content)?.itemIds ?? []).flatMap(
      (id) => itemById.get(id) ?? [],
    );

  switch (task.type) {
    case "recall":
      return task.itemIds.map((itemId) =>
        recallQuestion(itemById.get(itemId)!),
      );

    case "recognize": {
      const unitItems = owningUnitItems();

      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        const { choices, correctIndex } = sampleMcq(
          item,
          unitItems,
          rng,
          itemDisplayText,
        );
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
      const unitItems = owningUnitItems();
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        const { choices, correctIndex } = sampleMcq(
          item,
          unitItems,
          rng,
          itemDisplayText,
        );
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
      const unitItems = owningUnitItems();
      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;
        const { choices, correctIndex } = sampleMcq(
          item,
          unitItems,
          rng,
          recognizePrompt,
        );
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
      const siblings = owningUnitItems();
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
            siblings.flatMap((sibling) =>
              sibling.id !== item.id && sibling.kind === "sentence"
                ? sentenceTokens(sibling.payload.text)
                : [],
            ),
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
/**
 * The task type that presents `exercise`, or `null` for the two this plan
 * derives from content that authored no task for them (plan 0025 §9).
 *
 * The reverse of `TASK_EXERCISES`, computed rather than written out so the
 * two cannot drift: adding an exercise to a task type's list is enough.
 */
function taskTypeFor(exercise: Exercise): TaskType | null {
  for (const [type, exercises] of Object.entries(TASK_EXERCISES)) {
    if (exercises.includes(exercise) && exercise !== "recognize-produce") {
      return type as TaskType;
    }
  }
  return null;
}

/**
 * The question that asks `unit` as `exercise` (plan 0025 §4 picks the
 * exercise; this builds it). `null` when the content cannot produce one —
 * a caller with no question moves on rather than showing a broken card.
 *
 * Exercises backed by an authored task delegate to `buildTaskSession` over a
 * **synthetic single-item copy** of the real task, which is plan 0022 §6's
 * trick generalised: every builder — distractor sampling, token banks,
 * asset stems, the cloze fan-out — is reused untouched, and the synthetic
 * task keeps the real task's id so `owningUnitOf` still finds the pool.
 *
 * The two derived exercises are built here directly, because no task exists
 * to copy.
 */
export function buildExerciseQuestion(
  unit: SchedulingUnit,
  exercise: Exercise,
  content: Content,
  rng: Rng,
): Question | null {
  const item = unit.item;
  if (item === undefined) {
    return null;
  }

  if (exercise === "write") {
    if (item.kind !== "lexeme" && item.kind !== "concept") {
      return null;
    }
    return {
      kind: "write",
      unitId: unit.id,
      prompt: itemDisplayText(item),
      target: recognizePrompt(item),
    };
  }

  if (exercise === "recognize-produce") {
    if (item.kind === "pair") {
      return null;
    }
    const owner = content.units.find((u) => u.itemIds.includes(item.id));
    const unitItems = (owner?.itemIds ?? [])
      .map((id) => content.items.find((i) => i.id === id))
      .filter((i): i is Item => i !== undefined);
    const { choices, correctIndex } = sampleMcq(
      item,
      unitItems,
      rng,
      recognizePrompt,
    );
    return {
      kind: "recognize",
      unitId: unit.id,
      prompt: itemDisplayText(item),
      choices,
      correctIndex,
    };
  }

  const type = taskTypeFor(exercise);
  if (type === null) {
    return null;
  }
  const task = content.tasks.find(
    (candidate) =>
      candidate.type === type && candidate.itemIds.includes(item.id),
  );
  if (task === undefined) {
    return null;
  }
  // Matching keeps the task's whole item list: a board is a board, and a
  // one-pair one "is not a question at all" (plan 0022 §6's words). Every
  // other exercise narrows to this item, so the session asks about the word
  // whose turn it is rather than its whole task.
  const built =
    exercise === "matching"
      ? buildTaskSession(task, content, rng)
      : buildTaskSession({ ...task, itemIds: [item.id] }, content, rng);
  // A cloze task fans out one question per blank; this scheduling unit is
  // one of them, so pick the blank it names rather than the first.
  if (unit.blankNumber !== undefined) {
    // A matching board has no `unitId` — and cannot be a cloze question
    // anyway, so narrowing it away here is exhaustive rather than defensive.
    return (
      built.find((q) => q.kind !== "matching" && q.unitId === unit.id) ?? null
    );
  }
  return built[0] ?? null;
}

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

/**
 * A unit's practice session, planned by the progression engine (plan 0025
 * §4, §6): every word gets `repetitions` appearances — the first its new
 * attempt at one level above where it sits, the rest repetitions drawn from
 * the level below or its own — and each appearance is built as whichever
 * exercise the draw chose.
 *
 * Replaces `buildUnitSession`'s pooled shuffle over authored tasks. The shape
 * is unchanged (`{ question, taskId }` pairs, in order) so every caller,
 * pin control and edit route keeps working; what changed is that the session
 * is now per *word* rather than per authored task, and its difficulty is the
 * learner's rather than the author's.
 *
 * `levelOf` is the only thing here that knows about the learner — the caller
 * reads it from the progress store, so this stays pure and testable.
 *
 * A word whose content can build nothing at all is skipped rather than
 * shown as a blank card; that is only reachable from a draft, where a unit
 * can hold an item no task references yet.
 */
export function buildDrillSession(
  unit: Unit,
  content: Content,
  levelOf: (schedulingUnitId: string) => number,
  repetitions: number,
  rng: Rng,
): { question: Question; taskId: string }[] {
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const taskById = new Map(content.tasks.map((task) => [task.id, task]));
  const state = startDrill(shuffle([...unit.itemIds], rng), repetitions);

  const built: { question: Question; taskId: string }[] = [];
  const coveredByBoard = new Set<string>();
  for (const visit of plannedVisits(state)) {
    const item = itemById.get(visit.unitId);
    if (item === undefined) {
      continue;
    }
    // A matching board answers for every word on it, so a word already
    // covered by one built earlier in this session must not summon another
    // — four new words would otherwise open with four identical boards.
    let available = availableExercises(item, content);
    if (coveredByBoard.has(visit.unitId)) {
      available = available.filter((exercise) => exercise !== "matching");
    }
    const exercise = drawExercise(
      levelOf(visit.unitId),
      visit.slot,
      available,
      rng,
    );
    if (exercise === null) {
      continue;
    }
    const question = buildExerciseQuestion(
      { id: item.id, item },
      exercise,
      content,
      rng,
    );
    if (question === null) {
      continue;
    }
    if (question.kind === "matching") {
      for (const prompt of question.prompts) {
        coveredByBoard.add(prompt.unitId);
      }
    }
    // The task this exercise came from, for the pin control and the edit
    // route. A derived exercise has no authored task, so it borrows the
    // unit's first task that references the item — which is what both of
    // those surfaces actually want: somewhere in this unit to act on.
    const taskId =
      unit.taskIds.find((id) => {
        const task = taskById.get(id);
        return task !== undefined && task.itemIds.includes(item.id);
      }) ??
      unit.taskIds[0] ??
      unit.id;
    built.push({ question, taskId });
  }
  return built;
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
 * Task types a due sentence reviews as, in preference order (plan 0022 §6).
 *
 * All three are *production*: the learner builds, orders or types the whole
 * sentence, which is stronger retrieval than the flip-card review used
 * before. The list is deliberately not "every non-cloze type" — a sentence's
 * `recognize`/`listen`/`matching` tasks are multiple choice, i.e. *weaker*
 * than the recall card, and a one-item `matching` board is not a question at
 * all. `shadowing` is left out for the same reason it is not in plan 0022
 * §6's list: nothing checks the answer, so it grades no better than recall
 * while costing the audio.
 */
const SENTENCE_REVIEW_TASK_TYPES = ["build", "scramble", "dictation"] as const;

/**
 * The question a due sentence reviews as: its own authored `build` /
 * `scramble` / `dictation` exercise, built through `buildTaskSession` on a
 * synthetic single-item copy of that task — the existing builder unchanged,
 * distractor sampling and token banks included (the synthetic task keeps the
 * real task's id, so `owningUnitOf` still finds the real pool).
 *
 * `null` when the sentence has no such task, which is the fall-back to the
 * recall card. `dictation` candidates are skipped for an item with no
 * `audioRef`: `requiredAudioStem` throws on those, and a throw here would
 * take down the whole review session rather than one card.
 *
 * Selection is the first match in authored `content.tasks` order — the
 * variety comes from the exercise being an exercise, not from picking a
 * different one each day.
 */
function sentenceExerciseQuestion(
  item: Extract<Item, { kind: "sentence" }>,
  content: Content,
  rng: Rng,
): Question | null {
  for (const type of SENTENCE_REVIEW_TASK_TYPES) {
    const task = content.tasks.find(
      (candidate) =>
        candidate.type === type &&
        candidate.itemIds.includes(item.id) &&
        (type !== "dictation" || item.payload.audioRef !== undefined),
    );
    if (task === undefined) {
      continue;
    }
    const built = buildTaskSession(
      { ...task, itemIds: [item.id] },
      content,
      rng,
    );
    if (built[0] !== undefined) {
      return built[0];
    }
  }
  return null;
}

/**
 * Builds a review session, one question per due unit (amendment 3, plan
 * 0002): `lexeme`/`concept` units use the recall presentation (self-graded);
 * a due cloze blank uses that blank's cloze question (auto); a due `pair`
 * uses a minimal-pair question (auto); a due note (plan 0008 step 7) uses a
 * `NoteQuestion` (self-graded); and a due whole `sentence` reviews as its
 * authored production exercise where it has one (plan 0022 §6), falling back
 * to the recall card where it does not.
 *
 * `rng` drives the minimal-pair coin flip and — since plan 0022 — the token
 * shuffles of a sentence's build/scramble exercise.
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
    if (unit.item.kind === "sentence") {
      const exercise = sentenceExerciseQuestion(unit.item, content, rng);
      if (exercise !== null) {
        return exercise;
      }
    }
    return recallQuestion(unit.item);
  });
}

/** Cap on how many of the linked unit's tasks a recall session samples (plan 0016). */
const RECALL_SESSION_MAX_TASKS = 5;

/**
 * Builds a practice-only "Remember: …" recall session (plan 0016) over a
 * random sample of up to `RECALL_SESSION_MAX_TASKS` of `linkedUnit`'s own
 * tasks — reusing `buildUnitSession` unchanged (it reads only `unit.taskIds`
 * plus `content`), so the per-task question shape is identical to practicing
 * the linked unit directly. No content is authored for the link itself.
 */
export function buildRecallSession(
  linkedUnit: Unit,
  content: Content,
  rng: Rng,
): { question: Question; taskId: string }[] {
  const sampledTaskIds = shuffle(linkedUnit.taskIds, rng).slice(
    0,
    RECALL_SESSION_MAX_TASKS,
  );
  return buildUnitSession(
    { ...linkedUnit, taskIds: sampledTaskIds },
    content,
    rng,
  );
}

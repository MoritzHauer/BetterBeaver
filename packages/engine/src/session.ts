import type { Content, Item, Task } from "@betterbeaver/schema";
import {
  itemDisplayText,
  recallPrompt,
  recallReveal,
  recognizePrompt,
  RECOGNIZE_DISTRACTOR_COUNT,
} from "@betterbeaver/schema";

export interface RecognizeQuestion {
  kind: "recognize";
  itemId: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export interface RecallQuestion {
  kind: "recall";
  itemId: string;
  prompt: string;
  reveal: string[];
}

export type Question = RecognizeQuestion | RecallQuestion;

/** Uniform random number in [0, 1), injected so sessions are reproducible in tests. */
export type Rng = () => number;

/** Builds the recall-presentation question for one item. */
function recallQuestion(item: Item): RecallQuestion {
  return {
    kind: "recall",
    itemId: item.id,
    prompt: recallPrompt(item),
    reveal: recallReveal(item),
  };
}

/**
 * Fisher-Yates shuffle of a copy of `items`, using `rng` for the swap index
 * at each step. Pinned algorithm: iterate `i` from `length - 1` down to 1,
 * `j = Math.floor(rng() * (i + 1))`, swap `i` and `j`.
 */
function shuffle<T>(items: T[], rng: Rng): T[] {
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
 * Builds the questions for one task, in `task.itemIds` order. Recall tasks
 * yield one `RecallQuestion` per item. Recognize tasks sample
 * `RECOGNIZE_DISTRACTOR_COUNT` distractors from other same-kind items of
 * the task's owning unit (the unit whose `taskIds` contains `task.id`),
 * using the pinned shuffle-and-insert algorithm so results are
 * reproducible with a fake `rng`.
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
      // owningUnit and enough same-kind siblings are guaranteed by the
      // content validator.
      const owningUnit = content.units.find((unit) =>
        unit.taskIds.includes(task.id),
      )!;
      const unitItems = owningUnit.itemIds.map((id) => itemById.get(id)!);

      return task.itemIds.map((itemId): Question => {
        const item = itemById.get(itemId)!;

        const candidates = unitItems.filter(
          (c) => c.id !== itemId && c.kind === item.kind,
        );
        const distractors = shuffle(candidates, rng).slice(
          0,
          RECOGNIZE_DISTRACTOR_COUNT,
        );
        const correctIndex = Math.floor(
          rng() * (RECOGNIZE_DISTRACTOR_COUNT + 1),
        );
        const choices = distractors.map((candidate) =>
          itemDisplayText(candidate),
        );
        choices.splice(correctIndex, 0, itemDisplayText(item));

        return {
          kind: "recognize",
          itemId,
          prompt: recognizePrompt(item),
          choices,
          correctIndex,
        };
      });
    }

    // New task types from plan 0002; session construction for these lands
    // in plan 0002 step 2.
    case "cloze":
    case "matching":
    case "scramble":
    case "listen":
    case "dictation":
    case "shadowing":
    case "minimal-pair":
    case "picture":
      throw new Error("not implemented: plan 0002 step 2");

    default:
      task.type satisfies never;
      throw new Error(`unknown task type: ${task.type as string}`);
  }
}

/** Builds a review session: recall presentation, in input order. */
export function buildReviewSession(dueItems: Item[]): RecallQuestion[] {
  return dueItems.map((item) => recallQuestion(item));
}

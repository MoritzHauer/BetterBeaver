import type { Item, LinkType } from "@betterbeaver/schema";
import {
  itemDisplayText,
  recallPrompt,
  recallReveal,
  recognizePrompt,
  RECOGNIZE_DISTRACTOR_COUNT,
} from "@betterbeaver/schema";
import { shuffle, type Question, type Rng } from "./session.js";

/** One link resolved to its target's displayable script (plan 0006): the
 * web layer fills this from `ContentSource.loadDomain`'s merged entry pool. */
export type ResolvedItemLink = { type: LinkType; script: string };

/** The learner-choosable exercise modes of an ad-hoc vocabulary session (plan 0004). */
export const ADHOC_MODES = [
  "recall",
  "recognize",
  "matching",
  "listen",
] as const;
export type AdhocMode = (typeof ADHOC_MODES)[number];

/**
 * Why `mode` cannot run over `items`, or `null` if it can (the pinned floors,
 * plan 0004). Ad-hoc sets have no validator behind them, so the floors that
 * content classes (g)/(h)/(n)/(p) normally guarantee are enforced here at
 * runtime. `items` must not contain `pair` items (vocabulary mode only ever
 * feeds lexemes).
 */
function modeUnavailableReason(
  mode: AdhocMode,
  items: Item[],
  ttsAvailable: boolean,
): string | null {
  if (items.length === 0) {
    return "no words to study";
  }
  switch (mode) {
    case "recall":
      return null;
    case "recognize":
    case "listen": {
      const distinctTexts = new Set(items.map(itemDisplayText)).size;
      if (distinctTexts < RECOGNIZE_DISTRACTOR_COUNT + 1) {
        return `needs at least ${RECOGNIZE_DISTRACTOR_COUNT + 1} words with distinct meanings`;
      }
      if (mode === "listen" && !ttsAvailable) {
        const unplayable = items.some(
          (item) => item.kind === "pair" || item.payload.audioRef === undefined,
        );
        if (unplayable) {
          return "some words have no audio and read-aloud is unavailable";
        }
      }
      return null;
    }
    case "matching": {
      if (items.length < 2 || items.length > 8) {
        return "needs 2 to 8 words";
      }
      if (
        new Set(items.map(recognizePrompt)).size !== items.length ||
        new Set(items.map(itemDisplayText)).size !== items.length
      ) {
        return "some words share the same text";
      }
      return null;
    }
  }
}

/**
 * Availability of every ad-hoc mode over `items`: `null` means available,
 * a string is the learner-facing reason it is not. The web layer computes
 * `ttsAvailable` (the engine stays I/O-free).
 */
export function availableModes(
  items: Item[],
  opts: { ttsAvailable: boolean },
): Record<AdhocMode, string | null> {
  return {
    recall: modeUnavailableReason("recall", items, opts.ttsAvailable),
    recognize: modeUnavailableReason("recognize", items, opts.ttsAvailable),
    matching: modeUnavailableReason("matching", items, opts.ttsAvailable),
    listen: modeUnavailableReason("listen", items, opts.ttsAvailable),
  };
}

/**
 * MCQ choices for an ad-hoc question: distractors are sampled from the
 * distinct display texts of the *given item set* (not the owning unit), the
 * item's own text excluded — so no choice ever duplicates another or the
 * correct answer, even when the set has duplicate glosses across units.
 * Same pinned shuffle-and-insert algorithm as `sampleMcq`.
 */
function sampleAdhocMcq(
  item: Item,
  items: Item[],
  rng: Rng,
): { choices: string[]; correctIndex: number } {
  const ownText = itemDisplayText(item);
  const texts = [...new Set(items.map(itemDisplayText))].filter(
    (text) => text !== ownText,
  );
  const distractors = shuffle(texts, rng).slice(0, RECOGNIZE_DISTRACTOR_COUNT);
  const correctIndex = Math.floor(rng() * (RECOGNIZE_DISTRACTOR_COUNT + 1));
  const choices = [...distractors];
  choices.splice(correctIndex, 0, ownText);
  return { choices, correctIndex };
}

/**
 * Builds an ad-hoc vocabulary session over `items` (plan 0004): the four
 * mode floors are re-checked (throws on violation — the UI greys out
 * unavailable modes via `availableModes` first), distractors come from the
 * given set, an item's `synonym`-type links (plan 0006; re-based from the
 * deleted `payload.synonyms`) are appended to its recall reveal, and a
 * listen question falls back to TTS (`audio.kind === "speak"`) when the item
 * has no `audioRef`. Grading is identical to tasks (outcome-list contract);
 * per the plan's amendment, an ad-hoc answer on a stateless item schedules
 * it exactly like a task answer.
 */
export function buildAdhocSession(
  mode: AdhocMode,
  items: Item[],
  rng: Rng,
  /**
   * Pre-resolved links per item id, keyed by the domain's merged entry pool
   * (plan 0006). The engine never resolves `entryId`s itself — the web layer
   * fills this from `ContentSource.loadDomain`; only `synonym`-type links
   * feed the recall reveal's "also:" line.
   */
  resolvedLinks?: Map<string, ResolvedItemLink[]>,
): Question[] {
  // ttsAvailable: true — playability is the web layer's runtime gate; the
  // builder can always fall back to a `speak` question.
  const reason = modeUnavailableReason(mode, items, true);
  if (reason !== null) {
    throw new Error(`ad-hoc ${mode} session unavailable: ${reason}`);
  }

  switch (mode) {
    case "recall":
      return items.map((item): Question => {
        const reveal = recallReveal(item);
        const synonyms = (resolvedLinks?.get(item.id) ?? []).filter(
          (link) => link.type === "synonym",
        );
        if (synonyms.length > 0) {
          reveal.push(`also: ${synonyms.map((s) => s.script).join(", ")}`);
        }
        return {
          kind: "recall",
          unitId: item.id,
          prompt: recallPrompt(item),
          reveal,
        };
      });

    case "recognize":
      return items.map((item): Question => {
        const { choices, correctIndex } = sampleAdhocMcq(item, items, rng);
        return {
          kind: "recognize",
          unitId: item.id,
          prompt: recognizePrompt(item),
          choices,
          correctIndex,
        };
      });

    case "matching": {
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

    case "listen":
      return items.map((item): Question => {
        const { choices, correctIndex } = sampleAdhocMcq(item, items, rng);
        return {
          kind: "listen",
          unitId: item.id,
          audio:
            item.kind !== "pair" && item.payload.audioRef !== undefined
              ? { kind: "stem", stem: item.payload.audioRef }
              : { kind: "speak", text: recognizePrompt(item) },
          choices,
          correctIndex,
        };
      });
  }
}

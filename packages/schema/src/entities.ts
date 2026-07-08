import { z } from "zod";

/**
 * A slug matches lowercase alphanumeric segments separated by single hyphens,
 * e.g. "kyrgyz", "ky-item-salamatsyzby".
 */
export const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .regex(
    slugPattern,
    "must be a valid slug (lowercase alphanumeric segments separated by hyphens)",
  );

export const topicSchema = z.object({
  id: slugSchema,
  code: slugSchema,
  title: z.string(),
  description: z.string(),
  unitIds: z.array(slugSchema),
});
export type Topic = z.infer<typeof topicSchema>;

export const unitSchema = z.object({
  id: slugSchema,
  topicId: slugSchema,
  title: z.string(),
  goal: z.string(),
  itemIds: z.array(slugSchema),
  taskIds: z.array(slugSchema),
  noteIds: z.array(slugSchema),
  unlocksAfterUnitId: slugSchema.optional(),
});
export type Unit = z.infer<typeof unitSchema>;

const lexemePayloadSchema = z.object({
  script: z.string(),
  transliteration: z.string(),
  gloss: z.string(),
  usageNote: z.string().optional(),
  audioRef: slugSchema.optional(),
  imageRef: slugSchema.optional(),
});

const conceptPayloadSchema = z.object({
  term: z.string(),
  definition: z.string(),
  example: z.string().optional(),
  audioRef: slugSchema.optional(),
  imageRef: slugSchema.optional(),
});

/**
 * A sentence's `text` may contain Anki-style cloze markup (`{{c1::word}}`,
 * `{{c2::word}}`, …); see `parseClozeMarkup`/`stripClozeMarkup` below. A
 * sentence with no markup at all is valid (used by non-cloze tasks).
 */
const sentencePayloadSchema = z.object({
  text: z.string(),
  translation: z.string(),
  audioRef: slugSchema.optional(),
});

/** Two near-homophones and what distinguishes them, for `minimal-pair` tasks. */
const pairPayloadSchema = z.object({
  a: z.object({ script: z.string(), audioRef: slugSchema }),
  b: z.object({ script: z.string(), audioRef: slugSchema }),
  contrast: z.string(),
});

const lexemeItemSchema = z.object({
  id: slugSchema,
  kind: z.literal("lexeme"),
  payload: lexemePayloadSchema,
  sourceRef: slugSchema,
});

const conceptItemSchema = z.object({
  id: slugSchema,
  kind: z.literal("concept"),
  payload: conceptPayloadSchema,
  sourceRef: slugSchema,
});

const sentenceItemSchema = z.object({
  id: slugSchema,
  kind: z.literal("sentence"),
  payload: sentencePayloadSchema,
  sourceRef: slugSchema,
});

const pairItemSchema = z.object({
  id: slugSchema,
  kind: z.literal("pair"),
  payload: pairPayloadSchema,
  sourceRef: slugSchema,
});

export const itemSchema = z.discriminatedUnion("kind", [
  lexemeItemSchema,
  conceptItemSchema,
  sentenceItemSchema,
  pairItemSchema,
]);
export type Item = z.infer<typeof itemSchema>;
export type ItemKind = Item["kind"];

/**
 * One numbered blank parsed out of a sentence's cloze markup, e.g. `{
 * number: 2, text: "word" }` for `{{c2::word}}`.
 */
export interface ClozeBlank {
  number: number;
  text: string;
}

export type ClozeParseResult =
  { valid: true; blanks: ClozeBlank[] } | { valid: false };

const CLOZE_TOKEN_PATTERN = /\{\{([^{}]*)\}\}/g;

/**
 * Parses Anki-style cloze markup (`{{c1::word}}`, `{{c2::word}}`, …) out of
 * a sentence's `text`. Valid markup: every `{{...}}` token is `cN::text`
 * with N a positive integer (Anki's `::hint` suffix is unsupported), and
 * the blank numbers used across the sentence are exactly `1..N`, each
 * appearing exactly once. A sentence with no cloze tokens at all parses as
 * `{ valid: true, blanks: [] }`. Returns `{ valid: false }` for anything
 * malformed or non-contiguous — including stray `{{`/`}}` outside a
 * well-formed token (e.g. an unclosed `{{c1::hi}`) — never throws; the
 * validator (class (m)) turns that into a content error.
 */
export function parseClozeMarkup(text: string): ClozeParseResult {
  const leftover = text.replace(CLOZE_TOKEN_PATTERN, "");
  if (leftover.includes("{{") || leftover.includes("}}")) {
    return { valid: false };
  }
  const blanks: ClozeBlank[] = [];
  for (const match of text.matchAll(CLOZE_TOKEN_PATTERN)) {
    const parts = (match[1] ?? "").split("::");
    if (parts.length !== 2) {
      return { valid: false };
    }
    const numberMatch = /^c([1-9]\d*)$/.exec(parts[0] ?? "");
    if (numberMatch === null || numberMatch[1] === undefined) {
      return { valid: false };
    }
    blanks.push({ number: Number(numberMatch[1]), text: parts[1] ?? "" });
  }
  const numbers = blanks.map((b) => b.number).sort((a, b) => a - b);
  for (const [index, number] of numbers.entries()) {
    if (number !== index + 1) {
      return { valid: false };
    }
  }
  return { valid: true, blanks };
}

/** Strips cloze markup from `text`, leaving the plain sentence (blanks filled in). */
export function stripClozeMarkup(text: string): string {
  return text.replace(CLOZE_TOKEN_PATTERN, (token, inner: string) => {
    const parts = inner.split("::");
    return parts.length === 2 ? (parts[1] ?? "") : token;
  });
}

/** `pair` items only ever feed the `minimal-pair` task; every other presentation is unreachable by construction (validator class (o)) and permanently throws. */
function pairUnsupported(helper: string): never {
  throw new Error(`pair items do not support ${helper} (minimal-pair only)`);
}

/** Display text shown to the learner for an item, per kind. */
export function itemDisplayText(item: Item): string {
  switch (item.kind) {
    case "lexeme":
      return item.payload.gloss;
    case "concept":
      return item.payload.definition;
    case "sentence":
      return item.payload.translation;
    case "pair":
      return pairUnsupported("itemDisplayText");
  }
}

/** Prompt shown for the recognize presentation, per item kind (plan's presentation rules). */
export function recognizePrompt(item: Item): string {
  switch (item.kind) {
    case "lexeme":
      return item.payload.script;
    case "concept":
      return item.payload.term;
    case "sentence":
      return stripClozeMarkup(item.payload.text);
    case "pair":
      return pairUnsupported("recognizePrompt");
  }
}

/** Prompt shown for the recall presentation, per item kind (plan's presentation rules). */
export function recallPrompt(item: Item): string {
  switch (item.kind) {
    case "lexeme":
      return item.payload.gloss;
    case "concept":
      return item.payload.term;
    case "sentence":
      return item.payload.translation;
    case "pair":
      return pairUnsupported("recallPrompt");
  }
}

/** Reveal shown after a recall self-grade, per item kind (plan's presentation rules). */
export function recallReveal(item: Item): string[] {
  switch (item.kind) {
    case "lexeme":
      return [item.payload.script, item.payload.transliteration];
    case "concept":
      return [item.payload.definition];
    case "sentence":
      return [stripClozeMarkup(item.payload.text)];
    case "pair":
      return pairUnsupported("recallReveal");
  }
}

/** Recognize-task distractor count; a recognize task's unit needs this many + 1 same-kind items. */
export const RECOGNIZE_DISTRACTOR_COUNT = 3;

export const TASK_TYPES = [
  "recognize",
  "recall",
  "cloze",
  "matching",
  "scramble",
  "listen",
  "dictation",
  "shadowing",
  "minimal-pair",
  "picture",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * The task-type catalogue (the contract): which item kinds each task type
 * accepts. Enforced by the validator's class (o) (task/kind mismatch).
 */
export const TASK_ALLOWED_ITEM_KINDS: Record<TaskType, ItemKind[]> = {
  recognize: ["lexeme", "concept", "sentence"],
  recall: ["lexeme", "concept", "sentence"],
  cloze: ["sentence"],
  matching: ["lexeme", "concept", "sentence"],
  scramble: ["sentence"],
  listen: ["lexeme", "concept", "sentence"],
  dictation: ["sentence"],
  shadowing: ["lexeme", "concept", "sentence"],
  "minimal-pair": ["pair"],
  picture: ["lexeme", "concept"],
};

/**
 * Asset each task type requires on its items (validator class (n)).
 * Exhaustive over TaskType so adding a type forces a decision here.
 */
export const TASK_REQUIRED_ASSET: Record<TaskType, "audio" | "image" | null> = {
  recognize: null,
  recall: null,
  cloze: null,
  matching: null,
  scramble: null,
  listen: "audio",
  dictation: "audio",
  shadowing: "audio",
  "minimal-pair": null,
  picture: "image",
};

/**
 * Task types whose MCQ presentation samples RECOGNIZE_DISTRACTOR_COUNT
 * distractors from same-kind unit siblings (validator classes (g)/(r)).
 * Exhaustive over TaskType so adding a type forces a decision here.
 */
export const TASK_NEEDS_DISTRACTORS: Record<TaskType, boolean> = {
  recognize: true,
  recall: false,
  cloze: false,
  matching: false,
  scramble: false,
  listen: true,
  dictation: false,
  shadowing: false,
  "minimal-pair": false,
  picture: true,
};

export const taskSchema = z.object({
  id: slugSchema,
  type: z.enum(TASK_TYPES),
  itemIds: z.array(slugSchema).min(1),
  instructions: z.string().optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const resourceSchema = z.object({
  id: slugSchema,
  title: z.string(),
  path: z.string(),
});
export type Resource = z.infer<typeof resourceSchema>;

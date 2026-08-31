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

/** Owner-approved icon set for a Book (plan 0015 decision 6): languages + general subjects. */
export const BOOK_ICONS = [
  "📚",
  "🦫",
  "🌍",
  "🗣️",
  "💬",
  "🔤",
  "🧪",
  "🧬",
  "🔬",
  "🧮",
  "📐",
  "💻",
  "🎵",
  "🎨",
  "🏛️",
  "🌱",
  "🍄",
  "⚖️",
  "🚀",
  "🌤️",
  "🐾",
  "❤️",
  "🥘",
  "🚌",
] as const;

export const bookSchema = z.object({
  id: slugSchema,
  code: slugSchema,
  title: z.string(),
  description: z.string(),
  lessonIds: z.array(slugSchema),
  /** The lexicon domain this book draws vocabulary from (plan 0006); readAloudLang lives on the domain now. */
  domainId: slugSchema,
  /** Library/My Books card icon (plan 0015 decision 6); absent means no icon, no default. */
  icon: z.enum(BOOK_ICONS).optional(),
  /** Whether a decorative cover-art watermark renders behind this book's My
   * Books card (plan-less UI polish batch, 2026-07-25). The image itself is
   * NOT part of content — it must exist at `art/icons/<book.id>.png` in the
   * web app's public assets (same convention/location the one-off Kyrgyz
   * watermark already used); this field only toggles whether it's shown. */
  hasCoverArt: z.boolean().optional(),
});
export type Book = z.infer<typeof bookSchema>;

/** A domain's kind gates which entry kind its lexicon holds (plan 0006): `language` -> lexeme, `general` -> concept. */
export const DOMAIN_KINDS = ["language", "general"] as const;
export type DomainKind = (typeof DOMAIN_KINDS)[number];

export const domainSchema = z.object({
  id: slugSchema,
  /** Prefixes entry ids: `<code>-...` (plan 0006, class (c) extension). */
  code: slugSchema,
  kind: z.enum(DOMAIN_KINDS),
  title: z.string(),
  /** The language glosses/definitions are written in; required for both domain kinds. */
  glossLanguage: z.string().min(1),
  /** BCP-47 tag for reading entry script aloud via TTS (plan 0004's rules, moved here by plan 0006). */
  readAloudLang: z.string().min(1).optional(),
  /**
   * Characters this domain's script needs that a learner's keyboard cannot
   * produce (plan 0025 §10), rendered as a key row over every typed-input
   * exercise. Kyrgyz is the Russian layout plus exactly three letters, so
   * `["ң", "ө", "ү"]`; Turkish would declare `ğ ı ş ç ö ü`, a maths domain
   * `≤ ∈ ∀`. Absent means no row — the list is authored because isolating
   * these needs a per-language model of what a keyboard already has, which
   * is the domain-specific code plan 0023 §9 refuses to build.
   *
   * Additive and optional, so an older client drops it and parses the
   * domain unchanged: no `CONTENT_SCHEMA_VERSION` bump.
   */
  extraChars: z.array(z.string().min(1)).max(12).optional(),
});
export type Domain = z.infer<typeof domainSchema>;

export const familySchema = z.object({
  id: slugSchema,
  name: z.string(),
  entryIds: z.array(slugSchema),
});
export type Family = z.infer<typeof familySchema>;

/** A link's type is legal only within its domain kind (plan 0006, validator class (z)). */
export const LINK_TYPES = [
  "synonym",
  "antonym",
  "related",
  "contrast",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const DOMAIN_LINK_TYPES: Record<DomainKind, LinkType[]> = {
  language: ["synonym", "antonym"],
  general: ["related", "contrast"],
};

/** Authored on one side only; the engine derives the symmetric closure at load (plan 0006). */
export const linkSchema = z.object({
  type: z.enum(LINK_TYPES),
  entryId: slugSchema,
});
export type Link = z.infer<typeof linkSchema>;

/** One part of a hand-authored morpheme breakdown (plan 0023 §4). `text` and
 * `gloss` are what renders; `entryId` is navigation only, so the breakdown
 * displays without resolving anything. */
const componentObjectSchema = z.object({
  text: z.string(),
  gloss: z.string(),
  /** The part's own lexicon entry, when one exists — navigation only. */
  entryId: slugSchema.optional(),
});

/**
 * Reads a schema-version-**1** component as well: plan 0023 §7 renamed
 * `script` to `text` here, and this normalizes the old name on the way in.
 *
 * That direction of compatibility is not optional, it is what
 * `CONTENT_SCHEMA_VERSION` promises. The gate everywhere is
 * `schema_version <= CONTENT_SCHEMA_VERSION`: a bump exists to stop an
 * **older** client reading a **newer** document, and says nothing about the
 * reverse — a v2 client advertises that it reads v1 documents, and every
 * published document is still v1 until the bump procedure's republish runs.
 * Without this, a build that claims to read v1 rejected the only v1 content
 * there is: adding the Kyrgyz Book failed with `payload.components.0.text:
 * Invalid input`, and it would have failed for every learner, on every
 * Book carrying a breakdown, for as long as the republish was outstanding.
 *
 * Writing is unaffected — the parsed shape is always `text`, so nothing
 * downstream sees two spellings, and the republish stays worth doing (it is
 * what lets this normalizer eventually go). Same rename, same rule as
 * `content/private-migrations.ts`, which does it for the one document kind
 * no republish can ever reach.
 */
export const componentSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const part = value as Record<string, unknown>;
  if ("text" in part || typeof part.script !== "string") {
    return value;
  }
  const { script, ...rest } = part;
  return { ...rest, text: script };
}, componentObjectSchema);
export type Component = z.infer<typeof componentSchema>;

/** Plan 0008: the former Unit, renamed — the unlock-chain/progress level under a Book; its content refs moved down to the new, daily-sized `Unit`. */
export const lessonSchema = z.object({
  id: slugSchema,
  // Wire-format field name (lesson.json content files); not renamed — see docs/specs/0015-rename-topic-to-book.md DO-NOT-TOUCH.
  topicId: slugSchema,
  title: z.string(),
  goal: z.string(),
  unitIds: z.array(slugSchema),
  unlocksAfterLessonId: slugSchema.optional(),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const unitSchema = z.object({
  id: slugSchema,
  lessonId: slugSchema,
  title: z.string(),
  goal: z.string(),
  itemIds: z.array(slugSchema),
  taskIds: z.array(slugSchema),
  noteIds: z.array(slugSchema),
  unlocksAfterUnitId: slugSchema.optional(),
  /** Manual cross-unit recall links (plan 0016): zero or more earlier units in the same book to prompt a refresher on. */
  recallUnitIds: z.array(slugSchema).optional(),
});
export type Unit = z.infer<typeof unitSchema>;

const lexemePayloadSchema = z.object({
  script: z.string(),
  transliteration: z.string(),
  gloss: z.string(),
  example: z.object({ text: z.string(), translation: z.string() }).optional(),
  usageNote: z.string().optional(),
  audioRef: slugSchema.optional(),
  imageRef: slugSchema.optional(),
  /** Authored one side only; see `linkSchema` (plan 0006, validator class (z)). */
  links: z.array(linkSchema).optional(),
  /** Hand-authored compound breakdown (plan 0008 step 5), reshaped to the
   * shared component shape by plan 0023 §4, e.g. кайнэне → [{text: "кайн",
   * gloss: "in-law"}, {text: "эне", gloss: "mother"}]. */
  components: z.array(componentSchema).optional(),
  /** A bound morpheme: an affix that only occurs attached (plan 0023 §1–2).
   * Absent = an ordinary free-standing word. */
  bound: z.enum(["prefix", "suffix"]).optional(),
  /** Vowel-harmony allomorphs, hand-authored and closed (plan 0023 §3) —
   * never generated, and meaningless unless `bound` is set. */
  variants: z.array(z.string()).optional(),
});

const conceptPayloadSchema = z.object({
  term: z.string(),
  definition: z.string(),
  example: z.string().optional(),
  audioRef: slugSchema.optional(),
  imageRef: slugSchema.optional(),
  /** Authored one side only; see `linkSchema` (plan 0006, validator class (z)). */
  links: z.array(linkSchema).optional(),
  /** The same breakdown a lexeme carries (plan 0023 §4), which is what makes
   * cardio·myo·pathy work with no language-specific code. */
  components: z.array(componentSchema).optional(),
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

/** The entry kind a domain's lexicon holds, keyed by domain kind (plan 0006, validator class (u)). */
export const DOMAIN_ENTRY_KIND: Record<DomainKind, ItemKind> = {
  language: "lexeme",
  general: "concept",
};

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
 * with N a positive integer and non-blank text (Anki's `::hint` suffix is
 * unsupported), and the blank numbers used across the sentence are exactly
 * `1..N`, each appearing exactly once. A sentence with no cloze tokens at
 * all parses as
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
    const blankText = parts[1] ?? "";
    if (blankText.trim() === "") {
      // An empty blank would auto-grade an empty typed answer as correct.
      return { valid: false };
    }
    blanks.push({ number: Number(numberMatch[1]), text: blankText });
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

/**
 * Renders `text` for one cloze question: blank `targetBlankNumber` becomes a
 * `"___"` gap, every other blank is filled in, and the gapped blank's text is
 * returned as `target`. Assumes valid markup containing that blank (validator
 * class (m) plus derivation from `parseClozeMarkup`'s own blanks); `target`
 * stays `""` if the blank is absent.
 */
export function gapClozeMarkup(
  text: string,
  targetBlankNumber: number,
): { prompt: string; target: string } {
  let target = "";
  const prompt = text.replace(CLOZE_TOKEN_PATTERN, (token, inner: string) => {
    const parts = inner.split("::");
    if (parts.length !== 2) {
      return token;
    }
    const blankText = parts[1] ?? "";
    if (parts[0] === `c${targetBlankNumber}`) {
      target = blankText;
      return "___";
    }
    return blankText;
  });
  return { prompt, target };
}

/**
 * A sentence's whitespace tokens after stripping cloze markup — the single
 * tokenization shared by the validator's `scramble` guarantee (class (q),
 * >= 3 tokens) and the engine's scramble question construction.
 */
export function sentenceTokens(text: string): string[] {
  return stripClozeMarkup(text)
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
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
  "build",
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
  build: ["sentence"],
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
  build: null,
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
  // build's word-bank distractors are its own mechanism (engine), not the MCQ sampler.
  build: false,
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

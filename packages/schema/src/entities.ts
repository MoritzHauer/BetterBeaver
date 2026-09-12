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

/** Practice-depth presets (plan 0025 §3): how many correct answers a word
 *  is owed per unit-practice session. Named, never numeric. */
export const PRACTICE_DEPTHS = ["careful", "normal", "fast"] as const;
export type PracticeDepth = (typeof PRACTICE_DEPTHS)[number];

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
  /**
   * Whether this Book's exercises may be **constructed** from its items
   * where no authored task covers the (item, level) cell (plan 0026 §9,
   * phase 1).
   *
   * Opt-in per Book, and the reason phase 1 costs no
   * `CONTENT_SCHEMA_VERSION` bump: the field is additive and optional, so an
   * older client drops it and plays the Book exactly as it plays it today.
   * Absent or `false` means authored tasks only — which is what keeps every
   * shipped Book's exercise mix from changing on the day this lands.
   *
   * It never changes how *many* questions a session asks: length is word
   * count times the Progression preset (plan 0025 §6). It changes only which
   * exercise fills a slot.
   */
  generatedExercises: z.boolean().optional(),
  /**
   * The exams this Book offers (plan 0027 §3), listed after `lessonIds` on
   * the Book screen. An exam is a **sibling of a lesson**, one level under
   * the Book: it is never part of the unlock chain and has no completion
   * effect in either direction.
   *
   * Optional, and that is forced rather than a style choice: plan 0017
   * decision 5 makes the schema policy for private content additive-only,
   * because no admin republish can reach a Book that exists on one device.
   * A required `examIds` would permanently break every private Book already
   * authored.
   */
  examIds: z.array(slugSchema).optional(),
  /** The depth this Book's unit practice uses while the learner's own
   *  setting is "Book's choice" (plan 0027 §11). Absent = Normal. Session
   *  length only: the Fast preset's double step is SRS state, which is
   *  global (one word, one state), so a Book never changes it. Additive. */
  practiceDepth: z.enum(PRACTICE_DEPTHS).optional(),
});
export type Book = z.infer<typeof bookSchema>;

/** A domain's kind gates which entry kind its lexicon holds (plan 0006): `language` -> lexeme, `general` -> concept. */
export const DOMAIN_KINDS = ["language", "general"] as const;
export type DomainKind = (typeof DOMAIN_KINDS)[number];

/**
 * Every exercise the level ladder ranks (plan 0025 §2).
 *
 * An exercise is not the same thing as a task type. `recognize` runs in two
 * directions — see the foreign word and pick the meaning, or see the meaning
 * and pick the foreign word — and those are two exercises two levels apart.
 * `write` is derived from lexeme/concept items with no authored task type of
 * its own (§9), which is why the two tables below point in opposite
 * directions: `EXERCISE_LEVEL` covers the ladder, `TASK_EXERCISES` covers
 * what content can author.
 */
export const EXERCISES = [
  "matching",
  "recognize",
  "listen",
  "minimal-pair",
  "recognize-produce",
  "picture",
  "scramble",
  "build",
  "cloze",
  "recall",
  "write",
  "dictation",
  "shadowing",
  "choice",
  "assign",
] as const;
export type Exercise = (typeof EXERCISES)[number];

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
  /** The exercises unit practice may draw for this domain's items (plan
   *  0027 §10). Absent means every exercise, so no shipped Book changes.
   *  `write` and `recognize-produce` are listable although no task authors
   *  them — they are the derived ones, and the usual reason to curate: in a
   *  knowledge domain, typing the author's label teaches nothing.
   *
   *  Only the practice draw reads it. Review, the Check, exams and ad-hoc
   *  study keep their fixed presentations.
   *
   *  Additive and optional, so an older client drops it and parses the
   *  domain unchanged: no `CONTENT_SCHEMA_VERSION` bump. */
  exercises: z.array(z.enum(EXERCISES)).min(1).optional(),
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

/** The ladder's bounds. A word level shares the scale but starts at 0 — "not answered correctly yet" (plan 0025 §1). */
export const MIN_EXERCISE_LEVEL = 1;
export const MAX_EXERCISE_LEVEL = 10;

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
  /**
   * How far up the ladder each of this unit's items should be taken (plan
   * 0026 §5) — **intent, not difficulty**. How hard a word is, SRS already
   * discovers empirically and per learner and writes into the level; an
   * authored number would be stale on arrival. How far a word is *meant* to
   * go is the opposite: "passive vocabulary" versus "active vocabulary" is a
   * teaching decision no amount of learner data can infer.
   *
   * Keyed by the unit's own item ids (validator class (ac)), holding a
   * maximum `EXERCISE_LEVEL`: 2 stops a word at recognition, 9 takes it as
   * far as typing it. Absent for an item means the full ladder its kind
   * allows, so most items never set it.
   *
   * On the **unit**, not the item, because lexemes and concepts are
   * domain-owned and shared across Books (plan 0006: one word, one SRS
   * state) — a target on the entry would be global, and a word may
   * legitimately be passive in unit 3 and active in unit 9.
   *
   * It caps which exercise a word is asked as, never how far its level
   * climbs: a passive word is still answered, still advances, still stretches
   * its interval. Additive and optional — no `CONTENT_SCHEMA_VERSION` bump.
   */
  itemTargets: z
    .record(
      slugSchema,
      z.number().int().min(MIN_EXERCISE_LEVEL).max(MAX_EXERCISE_LEVEL),
    )
    .optional(),
});
export type Unit = z.infer<typeof unitSchema>;

const lexemePayloadSchema = z.object({
  script: z.string(),
  transliteration: z.string(),
  gloss: z.string(),
  example: z.object({ text: z.string(), translation: z.string() }).optional(),
  /** The `example` above was model-generated, not taken from a source, and
   * has not had a native-speaker pass. Top-level rather than a third key
   * inside `example` on purpose: `inPlace.ts`'s `withPayload` deletes a
   * nested object once its last key is cleared, and a leftover flag would
   * turn "author cleared the example" into `{generated: true}`, which the
   * schema rejects with no control left to clear it. */
  exampleGenerated: z.boolean().optional(),
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

const questionOptionSchema = z.object({
  text: z.string().min(1),
  /** The statement holds. For `choice` that means "is a correct answer";
   *  for `assign` it means "belongs to labels[0]". */
  correct: z.boolean(),
  /** Why this option is right or wrong. Shown under the option once the
   *  question is graded, in practice, the Check, Review and the exam
   *  report. Own words. */
  why: z.string().min(1).optional(),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

/**
 * An authored-option question (plan 0027 §1): its options and their
 * correctness are properties of the question, not sampled from its unit
 * siblings the way `recognize`'s distractors are.
 *
 * The payload alone decides which of the two task types plays it — `labels`
 * present means `assign`, absent means `choice` — and the validator enforces
 * the pairing (class (af)).
 */
const questionPayloadSchema = z.object({
  stem: z.string().min(1),
  options: z.array(questionOptionSchema).min(2),
  /** Present iff this is an `assign` question: exactly two category labels.
   *  Where one of the two is the affirmative one it goes first
   *  (Richtig/Falsch, Geeignet/Nicht geeignet); where the pair is genuinely
   *  symmetric (Blackbox/Whitebox, enge/lose Kopplung) the order is just an
   *  authoring choice, and `correct: true` means "the first one". */
  labels: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  /** Shown under the question once it is graded, wherever `why` is shown:
   *  the reasoning behind the answer as a whole. */
  explanation: z.string().min(1).optional(),
  /** Model-generated, not taken from a source, and without an expert review
   *  pass. Same purpose and same honesty as `lexemePayload.exampleGenerated`;
   *  it sits on the question rather than the exam because a generated
   *  question in a Unit, outside any exam, needs the mark just as much. */
  generated: z.boolean().optional(),
  /** The `explanation` and `why`s are model-written and unreviewed while
   *  the question itself is not — the official mock exam's case, where the
   *  questions are transcribed and the explanations are ours. Meaningless
   *  when `generated` is set, which already covers them. */
  explanationGenerated: z.boolean().optional(),
});
export type QuestionPayload = z.infer<typeof questionPayloadSchema>;

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

/** Book-owned like `sentence` and `pair` — never a lexicon entry, so
 * `DOMAIN_ENTRY_KIND` is untouched (plan 0027 §1). */
const questionItemSchema = z.object({
  id: slugSchema,
  kind: z.literal("question"),
  payload: questionPayloadSchema,
  sourceRef: slugSchema,
});

export const itemSchema = z.discriminatedUnion("kind", [
  lexemeItemSchema,
  conceptItemSchema,
  sentenceItemSchema,
  pairItemSchema,
  questionItemSchema,
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

/** `question` items only ever feed `choice`/`assign`, whose presentation is
 * the authored payload itself; every other presentation is unreachable by
 * construction (validator class (o)) and permanently throws — exactly as
 * `pair` does. */
function questionUnsupported(helper: string): never {
  throw new Error(
    `question items do not support ${helper} (choice/assign only)`,
  );
}

/** An item kind the four presentation helpers accept — and, since the two
 * excluded kinds are also the two that carry no `audioRef`/`imageRef`, the
 * narrowing every asset lookup over a mixed pool needs. */
export type PresentableItem = Exclude<Item, { kind: "pair" | "question" }>;

/**
 * Whether an item has a generic presentation at all — false for the two
 * kinds whose only exercises read their payload directly (`pair` ->
 * `minimal-pair`, `question` -> `choice`/`assign`).
 *
 * Every caller that walks a mixed item pool needs this: `itemDisplayText`,
 * `recognizePrompt`, `recallPrompt` and `recallReveal` all throw for these
 * kinds, so a loop over "every item in the unit" must skip them rather than
 * discover the throw at runtime. One predicate rather than a hand-written
 * `kind === "pair"` at each site, so the next such kind is one edit here.
 */
export function hasGenericPresentation(item: Item): item is PresentableItem {
  return item.kind !== "pair" && item.kind !== "question";
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
    case "question":
      return questionUnsupported("itemDisplayText");
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
    case "question":
      return questionUnsupported("recognizePrompt");
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
    case "question":
      return questionUnsupported("recallPrompt");
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
    case "question":
      return questionUnsupported("recallReveal");
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
  "choice",
  "assign",
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
  choice: ["question"],
  assign: ["question"],
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
  choice: null,
  assign: null,
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
  // choice/assign options are authored on the item (plan 0027 §2), so the
  // sampler must not run and classes (g)/(r) must not demand same-kind
  // siblings — the load-bearing row of the three.
  choice: false,
  assign: false,
};

/**
 * How hard each exercise is (plan 0025 §2) — a fixed property of the
 * exercise, identical for every learner and every Book, and the number a
 * word's level is compared against.
 *
 * `null` is *unranked*, not "level 0": `shadowing` never checks the answer,
 * so it can neither be a level nor confirm one, and it is never chosen to
 * advance a word.
 *
 * Ties are deliberate. Two exercises at the same level are equally hard and
 * differ only in modality, so a Book with no audio has fewer options at that
 * level rather than a hole in its ladder. Three placements carry their own
 * argument (§2): `matching` sits below `recognize` because a board clears
 * correct pairs and carries the last one by elimination; `recall` sits below
 * `write` because both are free production from the meaning side but `write`
 * is checked; `picture` is a production exercise because an image prompting
 * a list of English glosses involves no foreign form anywhere.
 */
export const EXERCISE_LEVEL: Record<Exercise, number | null> = {
  shadowing: null,
  matching: 1,
  recognize: 2,
  // Plan 0027 §2a. `choice` is `recognize`'s act with better distractors —
  // everything on screen, comprehension not production — so it shares its
  // rung; authored quality is cashed in as a better level-2 exercise, not as
  // a higher level. `assign` sits above because every row is judged
  // independently and elimination never helps, the exact inverse of the
  // reason `matching` sits at 1; it is also the only level-3 exercise a
  // text-only Book can have, since `listen`/`minimal-pair` both need audio.
  choice: 2,
  assign: 3,
  listen: 3,
  "minimal-pair": 3,
  "recognize-produce": 4,
  picture: 4,
  scramble: 5,
  build: 6,
  cloze: 7,
  recall: 8,
  write: 9,
  dictation: 10,
};

/**
 * The exercises each authored task type presents, lowest level first.
 * Exhaustive over TaskType so adding a type forces a decision here.
 *
 * `write` appears in no list: it is derived from any lexeme or concept item
 * rather than authored as a task (§9), so it is reachable from content that
 * has no such task type — which is the point, since no published Book could
 * have authored one.
 */
export const TASK_EXERCISES: Record<TaskType, readonly Exercise[]> = {
  matching: ["matching"],
  recognize: ["recognize", "recognize-produce"],
  listen: ["listen"],
  "minimal-pair": ["minimal-pair"],
  picture: ["picture"],
  scramble: ["scramble"],
  build: ["build"],
  cloze: ["cloze"],
  recall: ["recall"],
  dictation: ["dictation"],
  shadowing: ["shadowing"],
  choice: ["choice"],
  assign: ["assign"],
};

export const taskSchema = z.object({
  id: slugSchema,
  type: z.enum(TASK_TYPES),
  itemIds: z.array(slugSchema).min(1),
  instructions: z.string().optional(),
});
export type Task = z.infer<typeof taskSchema>;

/**
 * The rules one exam is scored under (plan 0027 §3) — **data, not a code
 * path**: the iSAQB rules are one such record, and a second exam with a
 * different pass mark or no partial credit needs no engine change.
 */
export const examRulesetSchema = z.object({
  passPercent: z.number().min(1).max(100),
  timeLimitMinutes: z.number().int().min(1),
  /** false = all-or-nothing per question; true = 1/n per correct mark. */
  partialCredit: z.boolean(),
  /** Wrong marks cost 1/n. A question never scores below 0 either way. */
  negativeMarking: z.boolean(),
});
export type ExamRuleset = z.infer<typeof examRulesetSchema>;

/**
 * A fixed, ordered, complete list of questions run in one sitting (plan
 * 0027 §3). An exam never samples from a pool — that is what "fixed and
 * complete" means, and it is the property a Unit's shuffled practice
 * session does not have.
 *
 * Points sit on the exam's own list rather than on the question, because
 * they are the exam's weighting: the same question is worth 1 point in one
 * exam and 2 in another.
 */
export const examSchema = z.object({
  id: slugSchema,
  // Wire-format field name, as on `lessonSchema`; not renamed — see
  // docs/specs/0015-rename-topic-to-book.md DO-NOT-TOUCH.
  topicId: slugSchema,
  title: z.string(),
  description: z.string(),
  questions: z
    .array(
      z.object({
        taskId: slugSchema,
        points: z.number().int().min(1),
        /** The lesson this question tests, for readiness per lesson (plan
         *  0027 §6). On the entry rather than the question because the same
         *  question can serve two exams. */
        lessonId: slugSchema.optional(),
      }),
    )
    .min(1),
  ruleset: examRulesetSchema,
});
export type Exam = z.infer<typeof examSchema>;
export type ExamQuestion = Exam["questions"][number];

export const resourceSchema = z.object({
  id: slugSchema,
  title: z.string(),
  path: z.string(),
});
export type Resource = z.infer<typeof resourceSchema>;

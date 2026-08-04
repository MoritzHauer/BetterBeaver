import {
  type Item,
  type ItemKind,
  RECOGNIZE_DISTRACTOR_COUNT,
  TASK_ALLOWED_ITEM_KINDS,
  TASK_NEEDS_DISTRACTORS,
  TASK_REQUIRED_ASSET,
  TASK_TYPES,
  type TaskType,
  parseClozeMarkup,
  recognizePrompt,
  sentenceTokens,
  stripClozeMarkup,
} from "@betterbeaver/schema";

/**
 * Which exercises a unit can actually support, and why the rest cannot
 * (spec 0021-8 §1a). A fold over the catalogue tables in `entities.ts`, run
 * against one unit's items.
 *
 * **The point of this module is that no publish error can originate here.**
 * Every rule `checkReferences` applies to a task lives in `exerciseProblem`
 * below, once — if a fold produces a task the validator then rejects, the
 * fold is wrong. `UnitScreen.exercises.test.tsx` pins that as its contract
 * test: creating any offered exercise must not grow `checkReferences`'
 * error set.
 *
 * Beyond the seven checks §1a enumerates, three more are enforced, because
 * §1a's own contract requires them and the spec's list simply missed them
 * (recorded back into the spec's "A refinement to the plan" section):
 * class (q)'s >= 3 tokens for scramble/build, class (m)'s at-least-one-blank
 * for cloze, and class (p)'s prompt-uniqueness/upper bound applied to the
 * *pre-fill* rather than only to the offer — a unit of six words would
 * otherwise create an invalid `matching` task on the first tap.
 */

/** Class (p): a matching task's upper bound (`validate.ts:508`). */
const MATCHING_MAX = 5;
const MATCHING_MIN = 2;

/** How each item kind is named to an author. "Task" is never one of them
 * (§1c) and neither is "lexeme". */
const KIND_PLURAL: Record<ItemKind, string> = {
  lexeme: "words",
  concept: "concepts",
  sentence: "sentences",
  pair: "pairs",
};

/** An exercise the author could add, or a greyed row saying why not. */
export interface ExerciseOffer {
  type: TaskType;
  /** The single kind this row builds over, or `null` when the unit holds
   * none of the kinds this type accepts at all. */
  kind: ItemKind | null;
  /** What creating it would pre-fill; empty whenever `reason` is set. */
  itemIds: string[];
  /** `null` when it can be built; otherwise the reason, in the author's
   * words, shown next to the greyed row. */
  reason: string | null;
}

/** Title-cased for display: "recognize" → "Recognize", "minimal-pair" →
 * "Minimal-pair" (§1c keeps the type names the app already uses). */
export function exerciseTypeLabel(type: TaskType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * One item, named for an author (§1b: display text, never an id).
 *
 * Not `itemDisplayText`/`recognizePrompt`: both **throw permanently** on a
 * `pair` (`entities.ts:326`), and a `minimal-pair` exercise's item pool is
 * exactly pairs — calling either here would white-screen the page.
 */
export function itemLabel(item: Item): string {
  switch (item.kind) {
    case "lexeme":
      return `${item.payload.script} · ${item.payload.gloss}`;
    case "concept":
      return item.payload.term;
    case "sentence":
      return stripClozeMarkup(item.payload.text);
    case "pair":
      return `${item.payload.a.script} / ${item.payload.b.script}`;
  }
}

/** A one-line label for a whole exercise — "Recognize · 5 words" — for the
 * list rows and the delete confirm (§1b: never by id). */
export function exerciseLabel(type: TaskType, items: Item[]): string {
  const kind = items[0]?.kind;
  const noun =
    kind === undefined
      ? "items"
      : items.length === 1
        ? KIND_PLURAL[kind].replace(/s$/, "")
        : KIND_PLURAL[kind];
  return `${exerciseTypeLabel(type)} · ${items.length} ${noun}`;
}

/** Class (n), audio half. `pair` is exempt exactly as `validate.ts:625` is:
 * its audio lives on the two sides, and it only ever feeds `minimal-pair`,
 * which requires no asset. */
function hasAudio(item: Item): boolean {
  return item.kind === "pair" || item.payload.audioRef !== undefined;
}

/** Class (n), image half — `sentence` is exempt (`validate.ts:635`). */
function hasImage(item: Item): boolean {
  return (
    item.kind === "pair" ||
    item.kind === "sentence" ||
    item.payload.imageRef !== undefined
  );
}

/** Class (m): a cloze task's item needs well-formed markup with >= 1 blank. */
function hasBlank(item: Item): boolean {
  if (item.kind !== "sentence") {
    return false;
  }
  const parsed = parseClozeMarkup(item.payload.text);
  return parsed.valid && parsed.blanks.length > 0;
}

/** Class (q): scramble/build need >= 3 tokens to have anything to reorder. */
function reorderable(item: Item): boolean {
  return (
    item.kind === "sentence" && sentenceTokens(item.payload.text).length >= 3
  );
}

/**
 * Every rule the validator applies to one task, as a single predicate:
 * `null` when a task of `type` over exactly `items` would publish clean,
 * otherwise the author-facing reason it would not.
 *
 * Both callers go through here — the offer fold below and the type `<select>`
 * on an existing exercise (§1b, "listing only the types still valid for the
 * task's current items"). Two copies of these rules would drift, and drift
 * here means publish errors, which is precisely what §1a forbids.
 *
 * `unitItems` is separate from `items` on purpose: classes (g)/(r) count the
 * *unit's* same-kind items, not the task's (`validate.ts:494`), so a
 * `listen` task over the two words that happen to have audio still needs
 * four words in the unit.
 */
export function exerciseProblem(
  type: TaskType,
  items: Item[],
  unitItems: Item[],
): string | null {
  // `taskSchema.itemIds` is `.min(1)`.
  const first = items[0];
  if (first === undefined) {
    return "needs at least one item";
  }
  // Class (e): candidates are one kind only, never a blend.
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.size > 1) {
    return "mixes kinds";
  }
  const kind = first.kind;
  // Class (o): the type's catalogue row.
  if (!TASK_ALLOWED_ITEM_KINDS[type].includes(kind)) {
    return `no ${KIND_PLURAL[kind]} in this unit`;
  }
  // Classes (g)/(r), counted over the unit, not the task.
  if (TASK_NEEDS_DISTRACTORS[type]) {
    const required = RECOGNIZE_DISTRACTOR_COUNT + 1;
    const sameKind = unitItems.filter((item) => item.kind === kind).length;
    if (sameKind < required) {
      return `needs ${required} ${KIND_PLURAL[kind]}, this unit has ${sameKind}`;
    }
  }
  const asset = TASK_REQUIRED_ASSET[type];
  if (asset === "audio" && !items.every(hasAudio)) {
    return "needs audio";
  }
  if (asset === "image" && !items.every(hasImage)) {
    return "needs images";
  }
  if (type === "cloze" && !items.every(hasBlank)) {
    return "needs a sentence with a {{c1::blank}}";
  }
  if ((type === "scramble" || type === "build") && !items.every(reorderable)) {
    return "needs a sentence of 3 words or more";
  }
  // Class (p): 2..5 items, no two sharing a prompt-side text.
  if (type === "matching") {
    const prompts = new Set(items.map(recognizePrompt));
    if (
      items.length < MATCHING_MIN ||
      items.length > MATCHING_MAX ||
      prompts.size !== items.length
    ) {
      return `needs ${MATCHING_MIN} to ${MATCHING_MAX} ${KIND_PLURAL[kind]} with different prompts`;
    }
  }
  return null;
}

/** The types an existing exercise could be switched to (§1b): changing type
 * to something its items cannot support is never offered. */
export function validTypesFor(items: Item[], unitItems: Item[]): TaskType[] {
  return TASK_TYPES.filter(
    (type) => exerciseProblem(type, items, unitItems) === null,
  );
}

/** "words, concepts or sentences" — the kinds a type accepts, listed. */
function listKinds(kinds: readonly ItemKind[]): string {
  const names = kinds.map((kind) => KIND_PLURAL[kind]);
  const last = names[names.length - 1] ?? "items";
  return names.length < 2
    ? last
    : `${names.slice(0, -1).join(", ")} or ${last}`;
}

/** One row for one (type, kind) pair the unit has items for. */
function offerFor(
  type: TaskType,
  kind: ItemKind,
  siblings: Item[],
): ExerciseOffer {
  let candidates = siblings;
  const asset = TASK_REQUIRED_ASSET[type];
  if (asset === "audio") {
    candidates = candidates.filter(hasAudio);
  } else if (asset === "image") {
    candidates = candidates.filter(hasImage);
  }
  if (type === "cloze") {
    candidates = candidates.filter(hasBlank);
  }
  if (type === "scramble" || type === "build") {
    candidates = candidates.filter(reorderable);
  }
  if (type === "matching") {
    // Deduping and capping the *pre-fill*, not just gating the offer: class
    // (p) rejects a sixth item and a repeated prompt, so a unit of six words
    // would otherwise create an invalid task on the first tap.
    const seen = new Set<string>();
    candidates = candidates
      .filter((item) => {
        const prompt = recognizePrompt(item);
        if (seen.has(prompt)) {
          return false;
        }
        seen.add(prompt);
        return true;
      })
      .slice(0, MATCHING_MAX);
  }

  // An emptied candidate set carries no kind for `exerciseProblem` to report
  // on, and the rule that emptied it is the one worth naming — so ask about
  // the full sibling set instead, which is non-empty by construction and
  // fails on that very rule.
  const problem = exerciseProblem(
    type,
    candidates.length === 0 ? siblings : candidates,
    siblings,
  );
  return problem === null
    ? { type, kind, itemIds: candidates.map((item) => item.id), reason: null }
    : { type, kind, itemIds: [], reason: problem };
}

/**
 * The `+ add an exercise` list for one unit: every task type, offered once
 * per item kind the unit actually holds for it (so a unit with words and
 * sentences offers Recognize twice, each pre-filled with only that kind),
 * and once — greyed, naming the kinds — for a type the unit holds nothing
 * for at all.
 *
 * `unitItemIds` is the unit's own `itemIds` (class (f)); `itemById` must be
 * the merged pool, book items *and* the lexicon entries this unit
 * references, exactly as `checkReferences` resolves them.
 */
export function exerciseOffers(
  unitItemIds: string[],
  itemById: Map<string, Item>,
): ExerciseOffer[] {
  const unitItems = unitItemIds.flatMap((id) => {
    const item = itemById.get(id);
    return item !== undefined ? [item] : [];
  });
  const offers: ExerciseOffer[] = [];
  for (const type of TASK_TYPES) {
    const allowed = TASK_ALLOWED_ITEM_KINDS[type];
    const present = allowed.filter((kind) =>
      unitItems.some((item) => item.kind === kind),
    );
    if (present.length === 0) {
      offers.push({
        type,
        kind: null,
        itemIds: [],
        reason: `no ${listKinds(allowed)} in this unit`,
      });
      continue;
    }
    for (const kind of present) {
      offers.push(
        offerFor(
          type,
          kind,
          unitItems.filter((item) => item.kind === kind),
        ),
      );
    }
  }
  return offers;
}

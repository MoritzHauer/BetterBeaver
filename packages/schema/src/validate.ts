import type { z } from "zod";
import {
  slugPattern,
  bookSchema,
  lessonSchema,
  unitSchema,
  itemSchema,
  taskSchema,
  resourceSchema,
  domainSchema,
  familySchema,
  itemDisplayText,
  recognizePrompt,
  parseClozeMarkup,
  sentenceTokens,
  RECOGNIZE_DISTRACTOR_COUNT,
  TASK_ALLOWED_ITEM_KINDS,
  TASK_NEEDS_DISTRACTORS,
  TASK_REQUIRED_ASSET,
  DOMAIN_ENTRY_KIND,
  DOMAIN_LINK_TYPES,
  type Book,
  type Lesson,
  type Unit,
  type Item,
  type Task,
  type Resource,
  type Domain,
  type Family,
} from "./entities.js";

export interface Content {
  topic: Book;
  lessons: Lesson[];
  units: Unit[];
  /** Book-owned items plus the domain entries referenced by this book's units (plan 0006, pinned). */
  items: Item[];
  tasks: Task[];
  resources: Resource[];
  notes: { id: string; stem: string }[];
}

export interface ValidateContentInput {
  topic: unknown;
  lessons: unknown[];
  units: unknown[];
  /** Book-owned items only: sentences, pairs, and (for language books) non-lexicon concepts. */
  items: unknown[];
  tasks: unknown[];
  resources: unknown[];
  noteStems: string[];
  /** Two separate stem lists (never cross-checked) so an `imageRef` can never validate against an audio file. */
  audioStems: string[];
  imageStems: string[];
  /** The book's domain (plan 0006): domain.json, its entries and families, and its asset stems. */
  domain: unknown;
  entries: unknown[];
  families: unknown[];
  lexiconAudioStems: string[];
  lexiconImageStems: string[];
}

export type ValidateContentResult =
  | { content: Content; domain: Domain; entries: Item[]; families: Family[] }
  | { errors: string[] };

function formatZodError(label: string, error: z.ZodError): string {
  const detail = error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  return `${label}: ${detail}`;
}

/**
 * Parses a zod schema over a list of raw inputs, appending one formatted
 * error per failure to `errors`. Returns the parsed values only if every
 * element parsed successfully.
 */
function parseAll<T>(
  schema: z.ZodType<T>,
  rawList: unknown[],
  labelFor: (raw: unknown, index: number) => string,
  errors: string[],
): T[] | undefined {
  const parsed: T[] = [];
  let ok = true;
  for (const [index, raw] of rawList.entries()) {
    const result = schema.safeParse(raw);
    if (result.success) {
      parsed.push(result.data);
    } else {
      ok = false;
      errors.push(formatZodError(labelFor(raw, index), result.error));
    }
  }
  return ok ? parsed : undefined;
}

function idLabel(raw: unknown, index: number, arrayName: string): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "id" in raw &&
    typeof (raw as { id: unknown }).id === "string"
  ) {
    return (raw as { id: string }).id;
  }
  return `${arrayName}[${index}]`;
}

/** Reports ids that occur more than once in `entities` as class (j) violations. */
function reportDuplicateIds(
  entities: { id: string }[],
  noun: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entity of entities) {
    if (seen.has(entity.id)) {
      duplicates.add(entity.id);
    }
    seen.add(entity.id);
  }
  for (const id of duplicates) {
    errors.push(`${id}: duplicate ${noun} id`);
  }
}

/** Reports ids that occur more than once within one id list as class (k) violations. */
function reportDuplicateEntries(
  owner: string,
  ids: string[],
  listName: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  for (const id of duplicates) {
    errors.push(`${owner}: duplicate entry "${id}" in ${listName}`);
  }
}

/** Reports orphaned/multiply-owned entities as class (d) violations. */
function reportOwnership(
  entities: { id: string }[],
  counts: Map<string, number>,
  noun: string,
  ownerNoun: string,
  errors: string[],
): void {
  for (const entity of entities) {
    const count = counts.get(entity.id) ?? 0;
    if (count === 0) {
      errors.push(
        `${entity.id}: ${noun} is orphaned (owned by no ${ownerNoun})`,
      );
    } else if (count > 1) {
      errors.push(`${entity.id}: ${noun} is owned by multiple ${ownerNoun}s`);
    }
  }
}

export function validateContent(
  input: ValidateContentInput,
): ValidateContentResult {
  const phase1Errors: string[] = [];

  const bookResult = bookSchema.safeParse(input.topic);
  if (!bookResult.success) {
    phase1Errors.push(formatZodError("book", bookResult.error));
  }

  const lessons = parseAll(
    lessonSchema,
    input.lessons,
    (raw, i) => idLabel(raw, i, "lessons"),
    phase1Errors,
  );
  const units = parseAll(
    unitSchema,
    input.units,
    (raw, i) => idLabel(raw, i, "units"),
    phase1Errors,
  );
  const items = parseAll(
    itemSchema,
    input.items,
    (raw, i) => idLabel(raw, i, "items"),
    phase1Errors,
  );
  const tasks = parseAll(
    taskSchema,
    input.tasks,
    (raw, i) => idLabel(raw, i, "tasks"),
    phase1Errors,
  );
  const resources = parseAll(
    resourceSchema,
    input.resources,
    (raw, i) => idLabel(raw, i, "resources"),
    phase1Errors,
  );

  const domainResult = domainSchema.safeParse(input.domain);
  if (!domainResult.success) {
    phase1Errors.push(formatZodError("domain", domainResult.error));
  }
  const entries = parseAll(
    itemSchema,
    input.entries,
    (raw, i) => idLabel(raw, i, "entries"),
    phase1Errors,
  );
  const families = parseAll(
    familySchema,
    input.families,
    (raw, i) => idLabel(raw, i, "families"),
    phase1Errors,
  );

  for (const [name, stems] of [
    ["noteStems", input.noteStems],
    ["audioStems", input.audioStems],
    ["imageStems", input.imageStems],
    ["lexiconAudioStems", input.lexiconAudioStems],
    ["lexiconImageStems", input.lexiconImageStems],
  ] as const) {
    for (const [index, stem] of stems.entries()) {
      if (!slugPattern.test(stem)) {
        phase1Errors.push(`${name}[${index}] ("${stem}"): invalid slug`);
      }
    }
  }

  if (
    phase1Errors.length > 0 ||
    !bookResult.success ||
    !domainResult.success ||
    lessons === undefined ||
    units === undefined ||
    items === undefined ||
    tasks === undefined ||
    resources === undefined ||
    entries === undefined ||
    families === undefined
  ) {
    return { errors: phase1Errors };
  }

  const book = bookResult.data;
  const domain = domainResult.data;
  const notes = input.noteStems.map((stem) => ({
    id: `${book.code}-note-${stem}`,
    stem,
  }));

  // --- uniqueness phase: class (j) duplicate entity ids, class (k) duplicate list entries ---
  // Id collisions make the by-id Maps below (last-wins) ill-defined, so if
  // anything here fails we return immediately without running the
  // remaining, Map-dependent checks.
  const uniquenessErrors: string[] = [];

  reportDuplicateIds(lessons, "lesson", uniquenessErrors);
  reportDuplicateIds(units, "unit", uniquenessErrors);
  // Merged pool: a book-owned item id colliding with a domain entry id
  // would silently share its `bb.item.<id>` SRS state (plan 0006).
  reportDuplicateIds([...items, ...entries], "item", uniquenessErrors);
  reportDuplicateIds(tasks, "task", uniquenessErrors);
  reportDuplicateIds(resources, "resource", uniquenessErrors);
  reportDuplicateIds(notes, "note", uniquenessErrors);
  reportDuplicateIds(families, "family", uniquenessErrors);

  reportDuplicateEntries(
    "topic.lessonIds",
    book.lessonIds,
    "lessonIds",
    uniquenessErrors,
  );
  for (const lesson of lessons) {
    reportDuplicateEntries(
      lesson.id,
      lesson.unitIds,
      "unitIds",
      uniquenessErrors,
    );
  }
  for (const unit of units) {
    reportDuplicateEntries(unit.id, unit.itemIds, "itemIds", uniquenessErrors);
    reportDuplicateEntries(unit.id, unit.taskIds, "taskIds", uniquenessErrors);
    reportDuplicateEntries(unit.id, unit.noteIds, "noteIds", uniquenessErrors);
  }
  for (const task of tasks) {
    reportDuplicateEntries(task.id, task.itemIds, "itemIds", uniquenessErrors);
  }

  if (uniquenessErrors.length > 0) {
    return { errors: uniquenessErrors };
  }

  const errors: string[] = [];

  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  // Merged pool (plan 0006, pinned): unit/task itemIds resolve against
  // book-owned items *and* the domain's lexicon entries.
  const itemById = new Map([...items, ...entries].map((i) => [i.id, i]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  // --- class (c): non-Book entity ids must start with "<code>-" ---
  const prefix = `${book.code}-`;
  for (const [noun, entities] of [
    ["lesson", lessons],
    ["unit", units],
    ["item", items],
    ["task", tasks],
    ["resource", resources],
  ] as const) {
    for (const entity of entities) {
      if (!entity.id.startsWith(prefix)) {
        errors.push(`${entity.id}: ${noun} id must start with "${prefix}"`);
      }
    }
  }
  // Derived note ids are always `${book.code}-note-${stem}`, so they
  // trivially start with "<code>-" by construction; no check needed.

  // --- class (a): dangling references ---
  // Extended one level by plan 0008: Book -> Lesson -> Unit -> content,
  // each level's child-id list must resolve and each child's parent-id must
  // match.
  for (const id of book.lessonIds) {
    if (!lessonById.has(id)) {
      errors.push(`topic.lessonIds: dangling lesson reference "${id}"`);
    }
  }
  for (const lesson of lessons) {
    for (const id of lesson.unitIds) {
      const unit = unitById.get(id);
      if (unit === undefined) {
        errors.push(`${lesson.id}: dangling unit reference "${id}" in unitIds`);
      } else if (unit.lessonId !== lesson.id) {
        errors.push(
          `${unit.id}: lessonId "${unit.lessonId}" does not match owning lesson "${lesson.id}"`,
        );
      }
    }
    if (
      lesson.unlocksAfterLessonId !== undefined &&
      !lessonById.has(lesson.unlocksAfterLessonId)
    ) {
      errors.push(
        `${lesson.id}: dangling unlocksAfterLessonId reference "${lesson.unlocksAfterLessonId}"`,
      );
    }
    if (lesson.topicId !== book.id) {
      errors.push(
        `${lesson.id}: topicId "${lesson.topicId}" does not match topic id "${book.id}"`,
      );
    }
  }
  // Every lesson must be referenced from topic.lessonIds (an orphaned lesson).
  const bookLessonIdSet = new Set(book.lessonIds);
  for (const lesson of lessons) {
    if (!bookLessonIdSet.has(lesson.id)) {
      errors.push(`${lesson.id}: lesson is not referenced in topic.lessonIds`);
    }
  }
  for (const unit of units) {
    for (const id of unit.itemIds) {
      if (!itemById.has(id)) {
        errors.push(`${unit.id}: dangling item reference "${id}" in itemIds`);
      }
    }
    for (const id of unit.taskIds) {
      if (!taskById.has(id)) {
        errors.push(`${unit.id}: dangling task reference "${id}" in taskIds`);
      }
    }
    for (const id of unit.noteIds) {
      if (!noteById.has(id)) {
        errors.push(`${unit.id}: dangling note reference "${id}" in noteIds`);
      }
    }
    if (
      unit.unlocksAfterUnitId !== undefined &&
      !unitById.has(unit.unlocksAfterUnitId)
    ) {
      errors.push(
        `${unit.id}: dangling unlocksAfterUnitId reference "${unit.unlocksAfterUnitId}"`,
      );
    }
    for (const id of unit.recallUnitIds ?? []) {
      if (id === unit.id) {
        errors.push(
          `${unit.id}: recallUnitIds must not reference itself "${id}"`,
        );
      } else if (!unitById.has(id)) {
        errors.push(`${unit.id}: dangling recallUnitIds reference "${id}"`);
      }
    }
  }
  for (const item of items) {
    if (!resourceById.has(item.sourceRef)) {
      errors.push(`${item.id}: dangling sourceRef "${item.sourceRef}"`);
    }
  }
  for (const task of tasks) {
    for (const id of task.itemIds) {
      if (!itemById.has(id)) {
        errors.push(`${task.id}: dangling item reference "${id}" in itemIds`);
      }
    }
  }
  // --- class (d): orphaned or multiply-owned units/items/tasks/notes ---
  function countOwnership(
    unitsList: Unit[],
    getIds: (unit: Unit) => string[],
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const unit of unitsList) {
      for (const id of getIds(unit)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }

  // Units are owned by lessons (plan 0008's inserted level), exactly like
  // items/tasks/notes are owned by units.
  const unitOwnerCounts = new Map<string, number>();
  for (const lesson of lessons) {
    for (const id of lesson.unitIds) {
      unitOwnerCounts.set(id, (unitOwnerCounts.get(id) ?? 0) + 1);
    }
  }
  reportOwnership(units, unitOwnerCounts, "unit", "lesson", errors);

  const itemOwnerCounts = countOwnership(units, (u) => u.itemIds);
  reportOwnership(items, itemOwnerCounts, "item", "unit", errors);

  const taskOwnerCounts = countOwnership(units, (u) => u.taskIds);
  reportOwnership(tasks, taskOwnerCounts, "task", "unit", errors);

  const noteOwnerCounts = countOwnership(units, (u) => u.noteIds);
  reportOwnership(notes, noteOwnerCounts, "note", "unit", errors);

  // Well-defined single owning unit per task, used by classes (f) and (g).
  const taskOwningUnit = new Map<string, Unit>();
  for (const unit of units) {
    for (const id of unit.taskIds) {
      if (taskOwnerCounts.get(id) === 1) {
        taskOwningUnit.set(id, unit);
      }
    }
  }

  // --- classes (e), (f), (g): task item kind/ownership/count checks ---
  for (const task of tasks) {
    const taskItems = task.itemIds.flatMap((id) => {
      const item = itemById.get(id);
      return item ? [item] : [];
    });
    if (taskItems.length !== task.itemIds.length) {
      // Dangling reference already reported under class (a); kind is not
      // well-defined, so skip further checks for this task.
      continue;
    }

    // class (e): mixed-kind task items.
    const kinds = new Set(taskItems.map((item) => item.kind));
    if (kinds.size > 1) {
      errors.push(
        `${task.id}: task items have mixed kinds (${[...kinds].join(", ")})`,
      );
      continue;
    }
    const taskKind = taskItems[0]?.kind;

    // class (o): task/kind mismatch — a type given an item kind outside its
    // catalogue row (this is what makes `pair` unreachable everywhere but
    // `minimal-pair`).
    if (
      taskKind !== undefined &&
      !TASK_ALLOWED_ITEM_KINDS[task.type].includes(taskKind)
    ) {
      errors.push(
        `${task.id}: task type "${task.type}" does not accept item kind "${taskKind}"`,
      );
      continue;
    }

    const owningUnit = taskOwningUnit.get(task.id);
    if (owningUnit === undefined) {
      // Ownership already reported under class (d); "the task's unit" is
      // not well-defined, so skip further checks for this task.
      continue;
    }

    // class (f): all task items must belong to the task's owning unit.
    const owningUnitItemIdSet = new Set(owningUnit.itemIds);
    let allOwned = true;
    for (const id of task.itemIds) {
      if (!owningUnitItemIdSet.has(id)) {
        allOwned = false;
        errors.push(
          `${task.id}: item "${id}" is not owned by the task's unit "${owningUnit.id}"`,
        );
      }
    }
    if (!allOwned) {
      continue;
    }

    // class (g)/(r): an MCQ-presentation task's owning unit must have
    // enough items of the task's kind to sample RECOGNIZE_DISTRACTOR_COUNT
    // distractors plus the correct answer (listen/picture reuse the
    // recognize distractor sampler over display texts, so the requirement
    // is identical).
    if (TASK_NEEDS_DISTRACTORS[task.type]) {
      const requiredCount = RECOGNIZE_DISTRACTOR_COUNT + 1;
      const sameKindCount = owningUnit.itemIds.filter(
        (id) => itemById.get(id)?.kind === taskKind,
      ).length;
      if (sameKindCount < requiredCount) {
        errors.push(
          `${task.id}: ${task.type} task's owning unit "${owningUnit.id}" has only ${sameKindCount} item(s) of kind "${taskKind}" (needs >= ${requiredCount})`,
        );
      }
    }

    // class (p): a matching task must have 2..5 items, and no two items
    // sharing a prompt-side text (two identical prompt cards would make the
    // pairing undecidable).
    if (task.type === "matching") {
      if (taskItems.length < 2 || taskItems.length > 5) {
        errors.push(
          `${task.id}: matching task has ${taskItems.length} item(s) (needs 2..5)`,
        );
      }
      const idsByPrompt = new Map<string, string[]>();
      for (const item of taskItems) {
        const prompt = recognizePrompt(item);
        const ids = idsByPrompt.get(prompt) ?? [];
        ids.push(item.id);
        idsByPrompt.set(prompt, ids);
      }
      for (const [prompt, ids] of idsByPrompt) {
        if (ids.length > 1) {
          errors.push(
            `${task.id}: duplicate matching prompt text "${prompt}" among items ${ids.join(", ")}`,
          );
        }
      }
    }

    // class (q): a scramble/build item's stripped text needs >= 3 whitespace
    // tokens to reorder (nothing to reorder otherwise).
    if (task.type === "scramble" || task.type === "build") {
      for (const item of taskItems) {
        if (item.kind !== "sentence") {
          continue; // kind mismatch already reported under class (o).
        }
        const tokenCount = sentenceTokens(item.payload.text).length;
        if (tokenCount < 3) {
          errors.push(
            `${task.id}: ${task.type} item "${item.id}" has only ${tokenCount} token(s) (needs >= 3)`,
          );
        }
      }
    }

    // class (m), continued: a cloze task item with zero blanks (malformed
    // markup itself is checked below, over every sentence item).
    if (task.type === "cloze") {
      for (const item of taskItems) {
        if (item.kind !== "sentence") {
          continue; // kind mismatch already reported under class (o).
        }
        const parsed = parseClozeMarkup(item.payload.text);
        if (parsed.valid && parsed.blanks.length === 0) {
          errors.push(
            `${task.id}: cloze task item "${item.id}" has zero blanks`,
          );
        }
      }
    }
  }

  // --- classes (m) and (n), per item: invalid cloze markup on sentence
  // text (the zero-blanks-for-a-cloze-task sub-case lives in the task loop
  // above) and dangling audioRef/imageRef ---
  const audioStemSet = new Set(input.audioStems);
  const imageStemSet = new Set(input.imageStems);
  for (const item of items) {
    if (item.kind === "pair") {
      for (const side of ["a", "b"] as const) {
        if (!audioStemSet.has(item.payload[side].audioRef)) {
          errors.push(
            `${item.id}: dangling audioRef "${item.payload[side].audioRef}" in payload.${side}`,
          );
        }
      }
      continue;
    }
    if (
      item.payload.audioRef !== undefined &&
      !audioStemSet.has(item.payload.audioRef)
    ) {
      errors.push(`${item.id}: dangling audioRef "${item.payload.audioRef}"`);
    }
    if (
      item.kind !== "sentence" &&
      item.payload.imageRef !== undefined &&
      !imageStemSet.has(item.payload.imageRef)
    ) {
      errors.push(`${item.id}: dangling imageRef "${item.payload.imageRef}"`);
    }
    if (
      item.kind === "sentence" &&
      !parseClozeMarkup(item.payload.text).valid
    ) {
      errors.push(`${item.id}: invalid cloze markup in text`);
    }
    // class (x): `links` is a lexicon-entry-only field; no validator or UI
    // exists for it on a book-owned item.
    if (
      (item.kind === "lexeme" || item.kind === "concept") &&
      item.payload.links !== undefined
    ) {
      errors.push(`${item.id}: "links" is not allowed on a book-owned item`);
    }
  }

  // --- class (n), per task: task items missing the ref their type needs ---
  for (const task of tasks) {
    const requiredAsset = TASK_REQUIRED_ASSET[task.type];
    if (requiredAsset === null) {
      continue;
    }
    for (const id of task.itemIds) {
      const item = itemById.get(id);
      if (item === undefined || item.kind === "pair") {
        continue; // dangling ref (a) or kind mismatch (o) already reported.
      }
      if (requiredAsset === "audio" && item.payload.audioRef === undefined) {
        errors.push(
          `${task.id}: item "${id}" is missing audioRef required by task type "${task.type}"`,
        );
      }
      if (
        requiredAsset === "image" &&
        item.kind !== "sentence" &&
        item.payload.imageRef === undefined
      ) {
        errors.push(
          `${task.id}: item "${id}" is missing imageRef required by task type "${task.type}"`,
        );
      }
    }
  }

  // --- class (h): duplicate display text per kind within a unit ---
  for (const unit of units) {
    const itemIdsByKindAndText = new Map<string, Map<string, string[]>>();
    for (const id of unit.itemIds) {
      const item = itemById.get(id);
      // `pair` items have no display text (they only ever feed
      // `minimal-pair`, which doesn't use `itemDisplayText`) — skip them so
      // this loop, which runs over every item unconditionally, doesn't hit
      // itemDisplayText's permanent throw for that kind.
      if (item === undefined || item.kind === "pair") {
        continue;
      }
      const text = itemDisplayText(item);
      const byText =
        itemIdsByKindAndText.get(item.kind) ?? new Map<string, string[]>();
      const ids = byText.get(text) ?? [];
      ids.push(item.id);
      byText.set(text, ids);
      itemIdsByKindAndText.set(item.kind, byText);
    }
    for (const [kind, byText] of itemIdsByKindAndText) {
      for (const [text, ids] of byText) {
        if (ids.length > 1) {
          errors.push(
            `${unit.id}: duplicate ${kind} display text "${text}" among items ${ids.join(", ")}`,
          );
        }
      }
    }
  }

  // --- class (i): a unit with zero tasks ---
  for (const unit of units) {
    if (unit.taskIds.length === 0) {
      errors.push(`${unit.id}: unit has zero tasks`);
    }
  }

  // --- class (l): unlocksAfterLessonId cycles (plan 0008, one level up) ---
  for (const startLesson of lessons) {
    let current: Lesson | undefined = startLesson;
    let steps = 0;
    let cameBackToStart = false;
    while (
      current?.unlocksAfterLessonId !== undefined &&
      steps < lessons.length
    ) {
      current = lessonById.get(current.unlocksAfterLessonId);
      steps++;
      if (current?.id === startLesson.id) {
        cameBackToStart = true;
        break;
      }
    }
    if (cameBackToStart) {
      errors.push(
        `${startLesson.id}: unlocksAfterLessonId chain forms a cycle`,
      );
    }
  }

  // --- class (l): unlocksAfterUnitId cycles ---
  for (const startUnit of units) {
    let current: Unit | undefined = startUnit;
    let steps = 0;
    let cameBackToStart = false;
    while (current?.unlocksAfterUnitId !== undefined && steps < units.length) {
      const nextId = current.unlocksAfterUnitId;
      // A dangling target is already reported under class (a); treat it as
      // chain end here (current becomes undefined, loop stops below).
      current = unitById.get(nextId);
      steps++;
      if (current?.id === startUnit.id) {
        cameBackToStart = true;
        break;
      }
    }
    if (cameBackToStart) {
      errors.push(`${startUnit.id}: unlocksAfterUnitId chain forms a cycle`);
    }
  }

  // --- class (t): topic.domainId must reference the domain content was
  // validated against ---
  if (book.domainId !== domain.id) {
    errors.push(
      `topic.domainId "${book.domainId}" does not match domain id "${domain.id}"`,
    );
  }

  // --- classes (u)/(v), per entry: entry kind must be a valid lexicon kind
  // and match the domain kind, entry id must start with "<domain.code>-";
  // plus sourceRef and audioRef/imageRef must resolve — the lexicon's own
  // resource/asset pools (asset-resolution pinned rule) ---
  const expectedEntryKind = DOMAIN_ENTRY_KIND[domain.kind];
  const entryPrefix = `${domain.code}-`;
  const lexiconAudioStemSet = new Set(input.lexiconAudioStems);
  const lexiconImageStemSet = new Set(input.lexiconImageStems);
  for (const entry of entries) {
    if (!entry.id.startsWith(entryPrefix)) {
      errors.push(`${entry.id}: entry id must start with "${entryPrefix}"`);
    }
    if (entry.kind !== "lexeme" && entry.kind !== "concept") {
      errors.push(
        `${entry.id}: entry kind "${entry.kind}" is not a valid lexicon entry kind (must be "lexeme" or "concept")`,
      );
      continue;
    }
    if (entry.kind !== expectedEntryKind) {
      errors.push(
        `${entry.id}: entry kind "${entry.kind}" does not match domain kind "${domain.kind}" (expected "${expectedEntryKind}")`,
      );
    }
    if (!resourceById.has(entry.sourceRef)) {
      errors.push(`${entry.id}: dangling sourceRef "${entry.sourceRef}"`);
    }
    if (
      entry.payload.audioRef !== undefined &&
      !lexiconAudioStemSet.has(entry.payload.audioRef)
    ) {
      errors.push(`${entry.id}: dangling audioRef "${entry.payload.audioRef}"`);
    }
    if (
      entry.payload.imageRef !== undefined &&
      !lexiconImageStemSet.has(entry.payload.imageRef)
    ) {
      errors.push(`${entry.id}: dangling imageRef "${entry.payload.imageRef}"`);
    }
  }

  // --- class (w): family entryIds must resolve against the domain's entries ---
  for (const family of families) {
    for (const entryId of family.entryIds) {
      if (!entryById.has(entryId)) {
        errors.push(
          `${family.id}: dangling entry reference "${entryId}" in entryIds`,
        );
      }
    }
  }

  // --- class (y): "user-" is reserved for learner-created entries (plan
  // 0006); no shipped id may use it ---
  for (const [noun, entities] of [
    ["lesson", lessons],
    ["unit", units],
    ["item", items],
    ["task", tasks],
    ["resource", resources],
    ["entry", entries],
    ["family", families],
  ] as const) {
    for (const entity of entities) {
      if (entity.id.startsWith("user-")) {
        errors.push(
          `${entity.id}: ${noun} id must not start with "user-" (reserved for learner-created entries)`,
        );
      }
    }
  }
  if (book.id.startsWith("user-")) {
    errors.push(
      `${book.id}: book id must not start with "user-" (reserved for learner-created entries)`,
    );
  }
  if (domain.id.startsWith("user-")) {
    errors.push(
      `${domain.id}: domain id must not start with "user-" (reserved for learner-created entries)`,
    );
  }

  // --- class (z), per entry link: dangling target, self-link, illegal type
  // for the domain kind, and double-authored symmetric duplicates (a link
  // is authored on one side only; the engine derives the reverse at load) ---
  const legalLinkTypes = new Set(DOMAIN_LINK_TYPES[domain.kind]);
  const linkTriples = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "lexeme" && entry.kind !== "concept") {
      continue;
    }
    for (const link of entry.payload.links ?? []) {
      linkTriples.add(`${entry.id}|${link.type}|${link.entryId}`);
    }
  }
  for (const entry of entries) {
    if (entry.kind !== "lexeme" && entry.kind !== "concept") {
      continue;
    }
    for (const link of entry.payload.links ?? []) {
      if (link.entryId === entry.id) {
        errors.push(`${entry.id}: link "${link.type}" targets itself`);
        continue;
      }
      if (!entryById.has(link.entryId)) {
        errors.push(`${entry.id}: dangling link target "${link.entryId}"`);
        continue;
      }
      if (!legalLinkTypes.has(link.type)) {
        errors.push(
          `${entry.id}: link type "${link.type}" is not legal for domain kind "${domain.kind}"`,
        );
      }
      if (
        entry.id < link.entryId &&
        linkTriples.has(`${link.entryId}|${link.type}|${entry.id}`)
      ) {
        errors.push(
          `${entry.id}: link "${link.type}" to "${link.entryId}" is authored on both sides (double-authored symmetric link)`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  // Content.items (pinned, plan 0006): book-owned items plus the domain
  // entries this book's units actually reference, so per-book sessions,
  // review, and distractor sampling behave exactly as before the migration.
  const unitItemIdUnion = new Set(units.flatMap((u) => u.itemIds));
  const referencedEntries = entries.filter((entry) =>
    unitItemIdUnion.has(entry.id),
  );

  return {
    content: {
      topic: book,
      lessons,
      units,
      items: [...items, ...referencedEntries],
      tasks,
      resources,
      notes,
    },
    domain,
    entries,
    families,
  };
}

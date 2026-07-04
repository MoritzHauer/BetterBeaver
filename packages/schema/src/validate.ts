import type { z } from "zod";
import {
  slugPattern,
  topicSchema,
  unitSchema,
  itemSchema,
  taskSchema,
  resourceSchema,
  itemDisplayText,
  RECOGNIZE_DISTRACTOR_COUNT,
  type Topic,
  type Unit,
  type Item,
  type Task,
  type Resource,
} from "./entities.js";

export interface Content {
  topic: Topic;
  units: Unit[];
  items: Item[];
  tasks: Task[];
  resources: Resource[];
  notes: { id: string; stem: string }[];
}

export interface ValidateContentInput {
  topic: unknown;
  units: unknown[];
  items: unknown[];
  tasks: unknown[];
  resources: unknown[];
  noteStems: string[];
}

export type ValidateContentResult = { content: Content } | { errors: string[] };

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
  errors: string[],
): void {
  for (const entity of entities) {
    const count = counts.get(entity.id) ?? 0;
    if (count === 0) {
      errors.push(`${entity.id}: ${noun} is orphaned (owned by no unit)`);
    } else if (count > 1) {
      errors.push(`${entity.id}: ${noun} is owned by multiple units`);
    }
  }
}

export function validateContent(
  input: ValidateContentInput,
): ValidateContentResult {
  const phase1Errors: string[] = [];

  const topicResult = topicSchema.safeParse(input.topic);
  if (!topicResult.success) {
    phase1Errors.push(formatZodError("topic", topicResult.error));
  }

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

  for (const [index, stem] of input.noteStems.entries()) {
    if (!slugPattern.test(stem)) {
      phase1Errors.push(`noteStems[${index}] ("${stem}"): invalid slug`);
    }
  }

  if (
    phase1Errors.length > 0 ||
    !topicResult.success ||
    units === undefined ||
    items === undefined ||
    tasks === undefined ||
    resources === undefined
  ) {
    return { errors: phase1Errors };
  }

  const topic = topicResult.data;
  const notes = input.noteStems.map((stem) => ({
    id: `${topic.code}-note-${stem}`,
    stem,
  }));

  // --- uniqueness phase: class (j) duplicate entity ids, class (k) duplicate list entries ---
  // Id collisions make the by-id Maps below (last-wins) ill-defined, so if
  // anything here fails we return immediately without running the
  // remaining, Map-dependent checks.
  const uniquenessErrors: string[] = [];

  reportDuplicateIds(units, "unit", uniquenessErrors);
  reportDuplicateIds(items, "item", uniquenessErrors);
  reportDuplicateIds(tasks, "task", uniquenessErrors);
  reportDuplicateIds(resources, "resource", uniquenessErrors);
  reportDuplicateIds(notes, "note", uniquenessErrors);

  reportDuplicateEntries(
    "topic.unitIds",
    topic.unitIds,
    "unitIds",
    uniquenessErrors,
  );
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

  const unitById = new Map(units.map((u) => [u.id, u]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  // --- class (c): non-Topic entity ids must start with "<code>-" ---
  const prefix = `${topic.code}-`;
  for (const [noun, entities] of [
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
  // Derived note ids are always `${topic.code}-note-${stem}`, so they
  // trivially start with "<code>-" by construction; no check needed.

  // --- class (a): dangling references ---
  for (const id of topic.unitIds) {
    if (!unitById.has(id)) {
      errors.push(`topic.unitIds: dangling unit reference "${id}"`);
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
    if (unit.topicId !== topic.id) {
      errors.push(
        `${unit.id}: topicId "${unit.topicId}" does not match topic id "${topic.id}"`,
      );
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
  // Every unit must be referenced from topic.unitIds (an orphaned unit structure).
  const topicUnitIdSet = new Set(topic.unitIds);
  for (const unit of units) {
    if (!topicUnitIdSet.has(unit.id)) {
      errors.push(`${unit.id}: unit is not referenced in topic.unitIds`);
    }
  }

  // --- class (d): orphaned or multiply-owned items/tasks/notes ---
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

  const itemOwnerCounts = countOwnership(units, (u) => u.itemIds);
  reportOwnership(items, itemOwnerCounts, "item", errors);

  const taskOwnerCounts = countOwnership(units, (u) => u.taskIds);
  reportOwnership(tasks, taskOwnerCounts, "task", errors);

  const noteOwnerCounts = countOwnership(units, (u) => u.noteIds);
  reportOwnership(notes, noteOwnerCounts, "note", errors);

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

    // class (g): a recognize task's owning unit must have enough items of the task's kind
    // to sample RECOGNIZE_DISTRACTOR_COUNT distractors plus the correct answer.
    if (task.type === "recognize") {
      const requiredCount = RECOGNIZE_DISTRACTOR_COUNT + 1;
      const sameKindCount = owningUnit.itemIds.filter(
        (id) => itemById.get(id)?.kind === taskKind,
      ).length;
      if (sameKindCount < requiredCount) {
        errors.push(
          `${task.id}: recognize task's owning unit "${owningUnit.id}" has only ${sameKindCount} item(s) of kind "${taskKind}" (needs >= ${requiredCount})`,
        );
      }
    }
  }

  // --- class (h): duplicate display text per kind within a unit ---
  for (const unit of units) {
    const itemIdsByKindAndText = new Map<string, Map<string, string[]>>();
    for (const id of unit.itemIds) {
      const item = itemById.get(id);
      if (item === undefined) {
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

  if (errors.length > 0) {
    return { errors };
  }

  return { content: { topic, units, items, tasks, resources, notes } };
}

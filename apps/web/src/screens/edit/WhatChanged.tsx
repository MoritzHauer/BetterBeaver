import type { Content } from "@betterbeaver/schema";
import type { ContentDiff, DiffStatus } from "@betterbeaver/engine";
import { noteTitle } from "../../content/noteTitle";

/**
 * Every touched entity in one Book, grouped by lesson (spec 0021-9 §4).
 *
 * It lives in the `[⋮]` menu rather than behind the Diff tab on purpose: the
 * tab is absent exactly on the screens with no local change, which is where
 * you most need to be told where the changes *are*.
 *
 * Rows show a title and a status word, never an id. Entities with no screen
 * of their own — exercises, resources — group under their unit and the Book
 * respectively, linking to slice 8's pages.
 */

export type ChangedTarget = {
  lessonId?: string;
  unitId?: string;
  /** Which of the Unit trail's pages to open on — the difference between
   * "one tap from the thing that caused it" and "one tap from its unit"
   * (spec 0021-10 §3). */
  page?: string;
  /** Open the Book screen with its settings sheet up: the same rule as
   * `page`, for the resources that live in the sheet rather than on the
   * page (slice 14 §3). */
  bookSettings?: boolean;
};

interface Row {
  key: string;
  title: string;
  kind: string;
  status: DiffStatus;
  target: ChangedTarget;
}

const WORD: Record<DiffStatus, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  unchanged: "",
};

/**
 * How many entities publishing would touch — the badge on the menu entry,
 * which doubles as the answer to "is there anything to review?".
 *
 * Counts **rows**, not raw status entries. The status map also holds
 * `families`, which no screen in this plan surfaces, so counting it would
 * put a 3 on a list of 2. (Lexicon *entries* do have rows: `draftContent`
 * merges them into `Content.items`.)
 */
export function changedCount(
  diff: ContentDiff | null,
  noteMarkdown: (stem: string) => string | undefined,
): number {
  return diff === null ? 0 : rowsOf(diff, noteMarkdown).length;
}

/** The lesson a unit belongs to, and the unit an item/task/note belongs to,
 * read off the **union** content so a removed entity still has a home. */
function ownership(content: Content) {
  const lessonOfUnit = new Map<string, string>();
  for (const lesson of content.lessons) {
    for (const unitId of lesson.unitIds) {
      lessonOfUnit.set(unitId, lesson.id);
    }
  }
  const unitOfEntity = new Map<string, string>();
  const noteStemOfUnit = new Map<string, string>();
  const noteById = new Map(content.notes.map((note) => [note.id, note]));
  for (const unit of content.units) {
    for (const id of [...unit.itemIds, ...unit.taskIds]) {
      unitOfEntity.set(id, unit.id);
    }
    for (const noteId of unit.noteIds) {
      const stem = noteById.get(noteId)?.stem;
      if (stem !== undefined) {
        unitOfEntity.set(stem, unit.id);
        noteStemOfUnit.set(stem, unit.id);
      }
    }
  }
  return { lessonOfUnit, unitOfEntity };
}

function rowsOf(
  diff: ContentDiff,
  noteMarkdown: (stem: string) => string | undefined,
): Row[] {
  const { content, status } = diff;
  const { lessonOfUnit, unitOfEntity } = ownership(content);
  const rows: Row[] = [];
  const push = (
    key: string,
    title: string,
    kind: string,
    target: ChangedTarget,
  ) => {
    const s = status.get(key);
    if (s !== undefined && s !== "unchanged") {
      rows.push({ key, title, kind, status: s, target });
    }
  };

  push("topic", content.topic.title || "This Book", "Book", {});
  // The lexicon publishes with the Book (slice 5 §1d) and is edited through
  // `[⋮] → Words`, so a change to it belongs in this list — under the Book,
  // since it has no screen of its own. The word "domain" appears nowhere.
  push("domain", "The words this Book uses", "Lexicon", {});
  for (const resource of content.resources) {
    // No screen of its own: Sources lives on the Book (spec 0021-8 §2a).
    push(resource.id, resource.title || "Untitled source", "Source", {});
  }
  for (const lesson of content.lessons) {
    push(lesson.id, lesson.title || "Untitled lesson", "Lesson", {
      lessonId: lesson.id,
    });
  }
  for (const unit of content.units) {
    const target = {
      ...(lessonOfUnit.get(unit.id) !== undefined
        ? { lessonId: lessonOfUnit.get(unit.id) }
        : {}),
      unitId: unit.id,
    };
    push(unit.id, unit.title || "Untitled unit", "Unit", target);
  }
  const unitTarget = (id: string): ChangedTarget => {
    const unitId = unitOfEntity.get(id);
    if (unitId === undefined) {
      return {};
    }
    const lessonId = lessonOfUnit.get(unitId);
    return { ...(lessonId !== undefined ? { lessonId } : {}), unitId };
  };
  for (const item of content.items) {
    push(item.id, itemTitle(item), "Word", {
      ...unitTarget(item.id),
      page: pageForKind(item.kind),
    });
  }
  for (const task of content.tasks) {
    // Exercises group under their unit and link to slice 8's page.
    push(task.id, `${task.type} exercise`, "Exercise", {
      ...unitTarget(task.id),
      page: "exercises",
    });
  }
  for (const note of content.notes) {
    // `Content.notes` carries only `{id, stem}`; a note's name is its `# `
    // heading, and the stem is a UUID — never a title. The draft's markdown
    // where it still exists, the base's where the draft deleted it.
    const markdown =
      noteMarkdown(note.stem) ??
      String(
        (diff.before.get(note.stem) as { markdown?: unknown })?.markdown ?? "",
      );
    push(note.stem, noteTitle(markdown, "Untitled note"), "Note", {
      ...unitTarget(note.stem),
      page: "theory",
    });
  }
  return rows;
}

/** Which Unit-trail page a row of this kind lives on (spec 0021-10 §3). */
function pageForKind(kind: Content["items"][number]["kind"]): string {
  return kind === "lexeme"
    ? "vocabulary"
    : kind === "concept"
      ? "concepts"
      : "examples";
}

/**
 * The screen that owns `id`, or `null` when nothing does — a dangling
 * reference to something already deleted. Shared by the What-changed rows
 * and by publish-error deep-linking (spec 0021-10 §3), so an error and its
 * index row always land in the same place.
 */
export function entityTarget(
  content: Content,
  id: string,
): ChangedTarget | null {
  const { lessonOfUnit, unitOfEntity } = ownership(content);
  if (id === "topic" || id === "domain" || id === content.topic.id) {
    return {};
  }
  if (content.resources.some((resource) => resource.id === id)) {
    // Sources live in the Book settings sheet since slice 14 §3, so landing
    // on the Book screen alone would show nothing of what the error names.
    return { bookSettings: true };
  }
  const lesson = content.lessons.find((l) => l.id === id);
  if (lesson !== undefined) {
    return { lessonId: lesson.id };
  }
  const unitTargetOf = (unitId: string): ChangedTarget => {
    const lessonId = lessonOfUnit.get(unitId);
    return { ...(lessonId !== undefined ? { lessonId } : {}), unitId };
  };
  if (content.units.some((unit) => unit.id === id)) {
    return unitTargetOf(id);
  }
  const unitId = unitOfEntity.get(id);
  if (unitId === undefined) {
    return null;
  }
  const item = content.items.find((i) => i.id === id);
  if (item !== undefined) {
    return { ...unitTargetOf(unitId), page: pageForKind(item.kind) };
  }
  if (content.tasks.some((task) => task.id === id)) {
    return { ...unitTargetOf(unitId), page: "exercises" };
  }
  if (content.notes.some((note) => note.stem === id)) {
    return { ...unitTargetOf(unitId), page: "theory" };
  }
  return unitTargetOf(unitId);
}

/** A title for an item without touching `itemDisplayText`, which throws on
 * a `pair` — the same trap slice 8's `itemLabel` records. */
function itemTitle(item: Content["items"][number]): string {
  switch (item.kind) {
    case "lexeme":
      return item.payload.script;
    case "concept":
      return item.payload.term;
    case "sentence":
      return item.payload.translation;
    case "pair":
      return `${item.payload.a.script} / ${item.payload.b.script}`;
  }
}

export function WhatChanged({
  diff,
  noteMarkdown,
  onOpen,
}: {
  diff: ContentDiff;
  /** The draft's note text; a note the draft deleted falls back to the base
   * copy `diff.before` still holds. */
  noteMarkdown: (stem: string) => string | undefined;
  onOpen: (target: ChangedTarget) => void;
}) {
  const rows = rowsOf(diff, noteMarkdown);
  if (rows.length === 0) {
    return (
      <>
        <h2>What changed</h2>
        <p className="status">Nothing yet — this draft matches what is live.</p>
      </>
    );
  }
  const lessonTitle = new Map(
    diff.content.lessons.map((lesson) => [
      lesson.id,
      lesson.title || "Untitled lesson",
    ]),
  );
  // Grouped by lesson, with everything Book-level first. No collapsing until
  // real content demands it (§4).
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.target.lessonId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return (
    <>
      <h2>What changed</h2>
      {[...groups].map(([lessonId, groupRows]) => (
        <section key={lessonId || "book"}>
          <h3>{lessonId === "" ? "This Book" : lessonTitle.get(lessonId)}</h3>
          <ul className="card-list">
            {groupRows.map((row) => (
              <li key={row.key} className={`card diff-row ${row.status}`}>
                <button className="plain" onClick={() => onOpen(row.target)}>
                  <strong>{row.title}</strong>
                  <span className="status">
                    {row.kind} · {WORD[row.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

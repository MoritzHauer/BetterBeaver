import { describe, it, expect } from "vitest";
import type { Content, Item, Lesson, Task, Unit } from "@betterbeaver/schema";
import { noteUnitId } from "@betterbeaver/engine";
import { formatDue, lessonSchedulingUnits } from "./LessonSummaryScreen";

const itemA: Item = {
  id: "t-item-a",
  kind: "lexeme",
  payload: { script: "А", transliteration: "A", gloss: "a" },
  sourceRef: "t-resource",
};
const itemB: Item = {
  id: "t-item-b",
  kind: "lexeme",
  payload: { script: "Б", transliteration: "B", gloss: "b" },
  sourceRef: "t-resource",
};
const taskA: Task = { id: "t-task-a", type: "recall", itemIds: [itemA.id] };
const taskB: Task = { id: "t-task-b", type: "recall", itemIds: [itemB.id] };
const noteA = { id: "t-note-a", stem: "stem" };

const unitA: Unit = {
  id: "t-unit-a",
  lessonId: "t-lesson-a",
  title: "Unit A",
  goal: "Goal",
  itemIds: [itemA.id],
  taskIds: [taskA.id],
  noteIds: [noteA.id],
};
const unitB: Unit = {
  id: "t-unit-b",
  lessonId: "t-lesson-b",
  title: "Unit B",
  goal: "Goal",
  itemIds: [itemB.id],
  taskIds: [taskB.id],
  noteIds: [],
};

const lessonA: Lesson = {
  id: "t-lesson-a",
  topicId: "t-topic",
  title: "Lesson A",
  goal: "Goal",
  unitIds: [unitA.id],
};

const content: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t-domain",
    title: "Book",
    description: "",
    lessonIds: [lessonA.id, "t-lesson-b"],
  },
  lessons: [
    lessonA,
    {
      id: "t-lesson-b",
      topicId: "t-topic",
      title: "Lesson B",
      goal: "Goal",
      unitIds: [unitB.id],
    },
  ],
  units: [unitA, unitB],
  items: [itemA, itemB],
  tasks: [taskA, taskB],
  resources: [],
  notes: [noteA],
};

describe("lessonSchedulingUnits", () => {
  it("keeps only the scheduling units reachable from the lesson's own units' itemIds/noteIds", () => {
    const ids = lessonSchedulingUnits(content, lessonA).map((su) => su.id);
    expect(ids.sort()).toEqual([itemA.id, noteUnitId(noteA.id)].sort());
  });

  it("excludes another lesson's items and notes", () => {
    const ids = lessonSchedulingUnits(content, lessonA).map((su) => su.id);
    expect(ids).not.toContain(itemB.id);
  });
});

describe("formatDue", () => {
  // Local-time constructor throughout: `localDay` reads local calendar
  // fields, so a UTC literal would drift the assertion by a day per timezone.
  const now = new Date(2026, 6, 28, 14, 0, 0);

  it("labels today", () => {
    expect(formatDue(new Date(2026, 6, 28, 0, 0, 0), now)).toBe("Today");
  });

  it("labels tomorrow", () => {
    expect(formatDue(new Date(2026, 6, 29, 23, 59, 0), now)).toBe("Tomorrow");
  });

  it("labels an overdue item Today, never its past date", () => {
    // The regression: an item that went overdue days ago is the earliest due
    // date, so it wins `Math.min` — printing "7/25/2026" under "Next review"
    // would be a lie about something that is due right now.
    expect(formatDue(new Date(2026, 6, 25, 9, 0, 0), now)).toBe("Today");
  });

  it("falls through to a date for anything further out", () => {
    const label = formatDue(new Date(2026, 6, 31, 9, 0, 0), now);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Tomorrow");
    expect(label).toBe(new Date(2026, 6, 31, 9, 0, 0).toLocaleDateString());
  });
});

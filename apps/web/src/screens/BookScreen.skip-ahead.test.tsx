import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Content, Lesson, Task, Unit } from "@betterbeaver/schema";
import type { ProgressStore } from "@betterbeaver/engine";
import { BookScreen } from "./BookScreen";

/**
 * The lesson-level skip-ahead sheet (`pendingLesson`/`blockingLesson`).
 *
 * It gets its own test because no shipped content can reach it: the bundled
 * "Meet BetterBeaver" Book has a single lesson, so nothing is ever gated, and
 * the browser pass could only drive the *unit*-level path on LessonScreen —
 * a different resolution (`lessonById.get()` rather than `units.find()`).
 * The real Kyrgyz Book has thirteen gated lessons, so this is the branch
 * learners actually hit, and naming the wrong lesson would typecheck fine.
 */

const task: Task = { id: "t-task-a", type: "recall", itemIds: [] };

const unitA: Unit = {
  id: "t-unit-a",
  lessonId: "t-lesson-a",
  title: "Unit A",
  goal: "Goal",
  itemIds: [],
  taskIds: [task.id],
  noteIds: [],
};
const unitB: Unit = {
  id: "t-unit-b",
  lessonId: "t-lesson-b",
  title: "Unit B",
  goal: "Goal",
  itemIds: [],
  taskIds: [],
  noteIds: [],
};

const greetings: Lesson = {
  id: "t-lesson-a",
  topicId: "t-topic",
  title: "Greetings",
  goal: "Say hello",
  unitIds: [unitA.id],
};
// Gated behind Greetings, which has an unattempted task and so is incomplete.
const numbers: Lesson = {
  id: "t-lesson-b",
  topicId: "t-topic",
  title: "Numbers",
  goal: "Count to ten",
  unitIds: [unitB.id],
  unlocksAfterLessonId: greetings.id,
};

const content: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t-domain",
    title: "Book",
    description: "",
    lessonIds: [greetings.id, numbers.id],
  },
  lessons: [greetings, numbers],
  units: [unitA, unitB],
  items: [],
  tasks: [task],
  resources: [],
  notes: [],
};

const store: ProgressStore = {
  getItemState: () => Promise.resolve(null),
  setItemState: () => Promise.resolve(),
  getStreak: () => Promise.resolve(null),
  setStreak: () => Promise.resolve(),
  incrementReps: () => Promise.resolve(),
};

function renderBookScreen(onSelectLesson: (lessonId: string) => void) {
  return render(
    <BookScreen
      content={content}
      unitProgress={new Map()}
      store={store}
      epoch={0}
      onSelectLesson={onSelectLesson}
      onPracticeTask={() => {}}
      onPlay={() => {}}
      onReview={() => {}}
      onVocabulary={() => {}}
      onBack={() => {}}
    />,
  );
}

// The suite doesn't run with `globals: true`, so testing-library's own
// auto-cleanup afterEach is never registered and containers would stack —
// every query across the second and third cases would match twice.
afterEach(cleanup);

describe("BookScreen skip-ahead sheet", () => {
  it("names the blocking lesson, not the one being opened", async () => {
    const onSelectLesson = vi.fn();
    renderBookScreen(onSelectLesson);

    screen.getByRole("button", { name: /Numbers/ }).click();

    const body = await screen.findByText(/You haven’t finished/);
    expect(body.textContent).toContain("Greetings");
    expect(body.textContent).not.toContain("Numbers");
    // Still a confirmation, not a navigation.
    expect(onSelectLesson).not.toHaveBeenCalled();
  });

  it("opens an unlocked lesson directly, with no sheet", () => {
    const onSelectLesson = vi.fn();
    renderBookScreen(onSelectLesson);

    screen.getByRole("button", { name: /Greetings/ }).click();

    expect(onSelectLesson).toHaveBeenCalledWith(greetings.id);
    expect(screen.queryByText(/You haven’t finished/)).toBeNull();
  });

  it("cancels without navigating, and confirms into the locked lesson", async () => {
    const onSelectLesson = vi.fn();
    renderBookScreen(onSelectLesson);

    screen.getByRole("button", { name: /Numbers/ }).click();
    (await screen.findByRole("button", { name: "Not yet" })).click();

    await waitFor(() =>
      expect(screen.queryByText(/You haven’t finished/)).toBeNull(),
    );
    expect(onSelectLesson).not.toHaveBeenCalled();

    screen.getByRole("button", { name: /Numbers/ }).click();
    (await screen.findByRole("button", { name: "Start anyway" })).click();

    expect(onSelectLesson).toHaveBeenCalledWith(numbers.id);
  });
});

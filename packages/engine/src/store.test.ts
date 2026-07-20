import { describe, it, expect, beforeEach } from "vitest";
import type { Content, Item, Task } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import type { ProgressStore } from "./interfaces.js";
import type { Streak } from "./streak.js";
import {
  collectItemStates,
  dueDomainUnits,
  dueUnits,
  recordGrade,
} from "./store.js";

/** Minimal in-memory ProgressStore, satisfying the interface types. */
class InMemoryProgressStore implements ProgressStore {
  private readonly states = new Map<string, SrsState>();
  private readonly attempted = new Set<string>();
  streak: Streak | null = null;
  setItemStateCalls = 0;
  setStreakCalls = 0;
  reps = 0;

  async incrementReps(): Promise<void> {
    this.reps++;
  }

  async getItemState(itemId: string): Promise<SrsState | null> {
    return this.states.get(itemId) ?? null;
  }

  async setItemState(itemId: string, state: SrsState): Promise<void> {
    this.setItemStateCalls++;
    this.states.set(itemId, state);
  }

  async getAttemptedTaskIds(): Promise<string[]> {
    return [...this.attempted];
  }

  async markTaskAttempted(taskId: string): Promise<void> {
    this.attempted.add(taskId);
  }

  async getStreak(): Promise<Streak | null> {
    return this.streak;
  }

  async setStreak(_domainId: string, streak: Streak): Promise<void> {
    this.setStreakCalls++;
    this.streak = streak;
  }
}

const dueState: SrsState = {
  due: "2026-07-04T00:00:00.000Z",
  intervalDays: 1,
  ease: 2.5,
  reps: 1,
};

const notDueState: SrsState = {
  due: "2026-07-10T00:00:00.000Z",
  intervalDays: 6,
  ease: 2.5,
  reps: 2,
};

describe("collectItemStates", () => {
  it("includes only items with non-null state, mixing hits and misses", async () => {
    const store = new InMemoryProgressStore();
    await store.setItemState("t-item-1", dueState);
    // t-item-2 is left with no stored state.

    const states = await collectItemStates(["t-item-1", "t-item-2"], store);

    expect(states.size).toBe(1);
    expect(states.get("t-item-1")).toEqual(dueState);
    expect(states.has("t-item-2")).toBe(false);
  });
});

describe("recordGrade", () => {
  let store: InMemoryProgressStore;

  beforeEach(() => {
    store = new InMemoryProgressStore();
  });

  it("persists and returns the new state for a new item", async () => {
    const result = await recordGrade(
      store,
      "t-item-new",
      4,
      new Date("2026-07-04T10:00:00Z"),
      "t-domain",
    );

    expect(result).not.toBeNull();
    expect(store.setItemStateCalls).toBe(1);
    expect(await store.getItemState("t-item-new")).toEqual(result);
  });

  it("persists and returns the new state for a due item", async () => {
    await store.setItemState("t-item-due", dueState);

    const result = await recordGrade(
      store,
      "t-item-due",
      4,
      new Date("2026-07-05T00:00:00Z"),
      "t-domain",
    );

    expect(result).not.toBeNull();
    expect(store.setItemStateCalls).toBe(2); // one from setup, one from recordGrade
    expect(await store.getItemState("t-item-due")).toEqual(result);
  });

  it("does not call setItemState and returns null when the item is not due (practice-only)", async () => {
    await store.setItemState("t-item-not-due", notDueState);
    store.setItemStateCalls = 0; // reset after setup write

    const result = await recordGrade(
      store,
      "t-item-not-due",
      4,
      new Date("2026-07-05T00:00:00Z"),
      "t-domain",
    );

    expect(result).toBeNull();
    expect(store.setItemStateCalls).toBe(0);
    expect(await store.getItemState("t-item-not-due")).toEqual(notDueState);
  });

  it("marks the local day streak-active on every grade, practice-only included", async () => {
    await store.setItemState("t-item-not-due", notDueState);

    await recordGrade(
      store,
      "t-item-not-due",
      4,
      new Date(2026, 6, 5, 10, 0), // local time; practice-only grade
      "t-domain",
    );

    expect(store.streak).toEqual({ lastActiveDay: "2026-07-05", length: 1 });
  });

  it("does not rewrite the streak on a same-day repeat grade", async () => {
    await recordGrade(
      store,
      "t-item-a",
      4,
      new Date(2026, 6, 5, 10, 0),
      "t-domain",
    );
    expect(store.setStreakCalls).toBe(1);

    await recordGrade(
      store,
      "t-item-b",
      4,
      new Date(2026, 6, 5, 11, 0),
      "t-domain",
    );

    expect(store.setStreakCalls).toBe(1);
    expect(store.streak).toEqual({ lastActiveDay: "2026-07-05", length: 1 });
  });
});

describe("dueUnits / dueDomainUnits pinning (plan 0008)", () => {
  const itemA: Item = {
    id: "t-item-a",
    kind: "concept",
    payload: { term: "Term A", definition: "Definition A" },
    sourceRef: "t-resource-1",
  };
  const itemB: Item = {
    id: "t-item-b",
    kind: "concept",
    payload: { term: "Term B", definition: "Definition B" },
    sourceRef: "t-resource-1",
  };
  const sentence: Item = {
    id: "t-item-sentence",
    kind: "sentence",
    payload: { text: "A {{c1::single}} blank.", translation: "t" },
    sourceRef: "t-resource-1",
  };
  const taskA: Task = { id: "t-task-a", type: "recall", itemIds: [itemA.id] };
  const taskB: Task = { id: "t-task-b", type: "recall", itemIds: [itemB.id] };
  const clozeTask: Task = {
    id: "t-task-cloze",
    type: "cloze",
    itemIds: [sentence.id],
  };
  const unit = {
    id: "t-unit-1",
    lessonId: "t-topic",
    title: "Unit",
    goal: "Goal",
    itemIds: [itemA.id, itemB.id, sentence.id],
    taskIds: [taskA.id, taskB.id, clozeTask.id],
    noteIds: [],
  };
  const content: Content = {
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Topic",
      description: "",
      lessonIds: [unit.id],
    },
    lessons: [],
    units: [unit],
    items: [itemA, itemB, sentence],
    tasks: [taskA, taskB, clozeTask],
    resources: [],
    notes: [],
  };

  const earlierDue: SrsState = {
    due: "2026-07-04T00:00:00.000Z",
    intervalDays: 1,
    ease: 2.5,
    reps: 1,
  };
  const laterDue: SrsState = {
    due: "2026-07-05T00:00:00.000Z",
    intervalDays: 1,
    ease: 2.5,
    reps: 1,
  };
  const now = new Date("2026-07-06T00:00:00Z");

  let store: InMemoryProgressStore;

  beforeEach(async () => {
    store = new InMemoryProgressStore();
    await store.setItemState(itemA.id, laterDue);
    await store.setItemState(itemB.id, earlierDue);
    await store.setItemState(`${sentence.id}::c1`, earlierDue);
  });

  it("pins a task's unit(s) first even when a non-pinned unit is due earlier", async () => {
    const result = await dueUnits(content, store, now, new Set([taskA.id]));
    expect(result.map((u) => u.id)).toEqual([
      itemA.id,
      itemB.id,
      `${sentence.id}::c1`,
    ]);
  });

  it("expands a pinned cloze task to its blank unit ids", async () => {
    const result = await dueUnits(content, store, now, new Set([clozeTask.id]));
    expect(result.map((u) => u.id)).toEqual([
      `${sentence.id}::c1`,
      itemB.id,
      itemA.id,
    ]);
  });

  it("without pinnedTaskIds, order is due-ascending as before", async () => {
    const result = await dueUnits(content, store, now);
    expect(result.map((u) => u.id)).toEqual([
      itemB.id,
      `${sentence.id}::c1`,
      itemA.id,
    ]);
  });

  it("dueDomainUnits threads pinnedTaskIds the same way", async () => {
    const result = await dueDomainUnits(
      [content],
      [],
      store,
      now,
      new Set([taskA.id]),
    );
    expect(result.map((u) => u.id)).toEqual([
      itemA.id,
      itemB.id,
      `${sentence.id}::c1`,
    ]);
  });
});

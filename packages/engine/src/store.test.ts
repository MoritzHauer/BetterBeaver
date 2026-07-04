import { describe, it, expect, beforeEach } from "vitest";
import type { SrsState } from "@betterbeaver/srs";
import type { ProgressStore } from "./interfaces.js";
import { collectItemStates, recordGrade } from "./store.js";

/** Minimal in-memory ProgressStore, satisfying the interface types. */
class InMemoryProgressStore implements ProgressStore {
  private readonly states = new Map<string, SrsState>();
  private readonly attempted = new Set<string>();
  setItemStateCalls = 0;

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
    );

    expect(result).toBeNull();
    expect(store.setItemStateCalls).toBe(0);
    expect(await store.getItemState("t-item-not-due")).toEqual(notDueState);
  });
});

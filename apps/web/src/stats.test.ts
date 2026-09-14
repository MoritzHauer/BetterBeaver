import { describe, expect, it, vi, afterEach } from "vitest";
import { gatherStats } from "./stats";

/**
 * `gatherStats` must resolve (not reject) even when the raw
 * `Object.keys(localStorage)` read (spec 0019 §1's `storageKeys()` guard)
 * hits a blocked `localStorage`.
 */
describe("gatherStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("resolves with itemsInReview 0 when Object.keys(localStorage) throws", async () => {
    const originalKeys = Object.keys;
    vi.spyOn(Object, "keys").mockImplementation((obj: object) => {
      if (obj === localStorage) {
        throw new DOMException("blocked", "SecurityError");
      }
      return originalKeys(obj);
    });

    await expect(gatherStats(new Date())).resolves.toMatchObject({
      itemsInReview: 0,
    });
  });

  /* The forward-looking half of the Stats screen (ui-review 2026-09-13,
     finding st-vanity). It is derived from SRS state rather than stored, so
     the thing to pin is the band boundaries -- PRODUCTION_LEVEL splits
     learning from known, and a 21-day interval splits known from mature --
     and that overdue cards land in today's bucket rather than being lost. */
  it("splits words into learning / known / mature and forecasts seven days", async () => {
    const now = new Date("2026-03-10T12:00:00Z");
    const day = (offset: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const put = (
      id: string,
      reps: number,
      intervalDays: number,
      dueIn: number,
    ) =>
      localStorage.setItem(
        `bb.item.${id}`,
        JSON.stringify({
          due: day(dueIn),
          intervalDays,
          ease: 2.5,
          reps,
          lastAdvancedDay: day(-1),
        }),
      );

    put("a", 0, 1, 0); // learning, due today
    put("b", 3, 1, 1); // learning (below PRODUCTION_LEVEL), due tomorrow
    put("c", 4, 8, 2); // known: at PRODUCTION_LEVEL, interval under 21
    put("d", 9, 21, 3); // mature: interval at the 21-day boundary
    put("e", 6, 5, -4); // known; overdue by four days -> today's bucket
    put("f", 6, 5, 30); // known; beyond the window -> in no forecast bucket

    const stats = await gatherStats(now);

    expect(stats.mastery).toEqual({ learning: 2, known: 3, mature: 1 });
    expect(stats.itemsInReview).toBe(6);
    // today gets the due-today card and the overdue one; nothing falls off
    // the front of the window.
    expect(stats.dueNext7).toEqual([2, 1, 1, 1, 0, 0, 0]);
  });
});

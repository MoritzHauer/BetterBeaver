/** Daily streak state: the last *local* calendar day with a recorded grade,
 * and the count of consecutive active days ending on it. (SRS due-dates stay
 * UTC per plan 0001 — independent systems.) */
export interface Streak {
  /** YYYY-MM-DD in the learner's local time zone. */
  lastActiveDay: string;
  length: number;
}

/** `now` as a local-calendar YYYY-MM-DD day string. */
export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Advances the streak for a grade recorded at `now` (plan 0003): the local
 * day becomes active; a same-day repeat is a no-op (returns `prev`
 * unchanged), the day after `lastActiveDay` increments, any gap resets to 1.
 * No freezes or grace.
 */
export function advanceStreak(prev: Streak | null, now: Date): Streak {
  const today = localDay(now);
  if (prev === null) {
    return { lastActiveDay: today, length: 1 };
  }
  if (prev.lastActiveDay === today) {
    return prev;
  }
  const yesterday = localDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  );
  return {
    lastActiveDay: today,
    length: prev.lastActiveDay === yesterday ? prev.length + 1 : 1,
  };
}

/** The local-calendar day before `day` (a YYYY-MM-DD string). */
function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return localDay(new Date(year, month - 1, date - 1));
}

/**
 * A single "daily streak" across all per-domain streaks (plan 0006 keeps
 * streaks per domain): the number of consecutive calendar days — ending
 * today, or yesterday if today isn't active yet — with activity in *any*
 * domain. Each domain's `(lastActiveDay, length)` is a contiguous run, so
 * the union of those runs is exactly computable from the current state; past
 * broken runs aren't stored and don't matter for the current streak. `today`
 * is passed in (like `advanceStreak`'s `now`) to stay pure/testable.
 */
export function combinedStreak(streaks: Streak[], today: string): number {
  const activeDays = new Set<string>();
  for (const streak of streaks) {
    let day = streak.lastActiveDay;
    for (let i = 0; i < streak.length; i++) {
      activeDays.add(day);
      day = previousDay(day);
    }
  }
  // The streak is still "alive" (and shown) while the most recent active day
  // is today or yesterday; a 2+ day gap is a broken streak (zero).
  let anchor = today;
  if (!activeDays.has(anchor)) {
    anchor = previousDay(today);
    if (!activeDays.has(anchor)) {
      return 0;
    }
  }
  let length = 0;
  while (activeDays.has(anchor)) {
    length++;
    anchor = previousDay(anchor);
  }
  return length;
}

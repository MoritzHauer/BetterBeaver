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

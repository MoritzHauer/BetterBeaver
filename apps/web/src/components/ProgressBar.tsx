/** Graphical progress bar (plan 0010): the same `.progress-track`/
 * `.progress-fill` treatment `SessionScreen` already uses for in-session
 * progress, reused for per-row progress on Lesson/Book/MyBooks screens. */
export function ProgressBar({
  value,
  max,
  seen,
}: {
  value: number;
  max: number;
  /** Optional second level, drawn blue behind `value` on the same scale:
   * how much of the content has been seen at all. */
  seen?: number;
}) {
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {seen !== undefined && (
        <div
          className="progress-fill progress-seen"
          style={{ width: `${pct(seen)}%` }}
        />
      )}
      <div
        className={`progress-fill${seen !== undefined ? " progress-mastery" : ""}`}
        style={{ width: `${pct(value)}%` }}
      />
    </div>
  );
}

/** `ProgressBar` + compact caption when unlocked, "locked" text otherwise
 * (plan 0010): the row-progress shape shared by `LessonScreen`'s units and
 * `BookScreen`'s lessons — both gate progress display behind the same
 * unlock check.
 *
 * The bar is a **percentage** (plan 0025 §8): the mean word level times ten,
 * for a unit, and the mean of those for a lesson. It replaces "3 of 5 tasks
 * attempted", which jumped in fifths and stopped moving the moment a unit
 * was walked through once. This one moves from the first session and keeps
 * moving for weeks, and 100% is attainable on any content because §4 makes
 * every level reachable.
 *
 * Two levels: blue is the share of words seen at all (`seenPercent`, which
 * unlocks the next unit at `SEEN_TO_COMPLETE`), green the level bar above. */
export function LockableProgress({
  unlocked,
  percent,
  seenPercent,
  due,
}: {
  unlocked: boolean;
  /** 0-100. */
  percent: number;
  /** 0-100, always >= `percent`. */
  seenPercent: number;
  /** Cards of this row's own scheduling units that are due right now (plan
   * 0022 §7), appended to the caption as `· 8 due`. Passive: it answers
   * "which unit am I forgetting" at a glance, where a start-of-session
   * prompt would push the learner from interleaved review into blocked
   * repetition. Omitted or 0 renders nothing. */
  due?: number;
}) {
  if (!unlocked) {
    return <p className="status">locked</p>;
  }
  return (
    <>
      <ProgressBar value={percent} max={100} seen={seenPercent} />
      <p className="status">
        {seenPercent}% seen · {percent}% learned
        {due !== undefined && due > 0 ? ` · ${due} due` : ""}
      </p>
    </>
  );
}

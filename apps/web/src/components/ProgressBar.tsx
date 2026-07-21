/** Graphical progress bar (plan 0010): the same `.progress-track`/
 * `.progress-fill` treatment `SessionScreen` already uses for in-session
 * progress, reused for per-row progress on Lesson/Book/MyBooks screens. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** `ProgressBar` + compact caption when unlocked, "locked" text otherwise
 * (plan 0010): the row-progress shape shared by `LessonScreen`'s units and
 * `BookScreen`'s lessons — both gate progress display behind the same
 * unlock check. */
export function LockableProgress({
  unlocked,
  value,
  max,
}: {
  unlocked: boolean;
  value: number;
  max: number;
}) {
  if (!unlocked) {
    return <p className="status">locked</p>;
  }
  return (
    <>
      <ProgressBar value={value} max={max} />
      <p className="status">
        {value}/{max}
      </p>
    </>
  );
}

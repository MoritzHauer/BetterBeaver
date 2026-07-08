import { useEffect, useState } from "react";
import type { Content } from "@betterbeaver/schema";
import type { ProgressStore } from "@betterbeaver/engine";
import { dueUnits, isUnitComplete, isUnitUnlocked } from "@betterbeaver/engine";

export function TopicScreen({
  content,
  attemptedTaskIds,
  store,
  epoch,
  onSelectUnit,
  onReview,
  onBack,
}: {
  content: Content;
  attemptedTaskIds: ReadonlySet<string>;
  store: ProgressStore;
  /** Bumped by the caller on every navigation to this screen, so the due
   * count is recomputed after sessions elsewhere may have changed it. */
  epoch: number;
  onSelectUnit: (unitId: string) => void;
  onReview: () => void;
  onBack: () => void;
}) {
  const unitById = new Map(content.units.map((unit) => [unit.id, unit]));
  const [dueCount, setDueCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    dueUnits(content, store, new Date()).then((due) => {
      if (cancelled) {
        return;
      }
      setDueCount(due.length);
    });
    return () => {
      cancelled = true;
    };
  }, [content, store, epoch]);

  return (
    <main>
      <button onClick={onBack}>&larr; Topics</button>
      <h1>{content.topic.title}</h1>
      <p>{content.topic.description}</p>
      <ul className="card-list">
        <li className="card">
          <button onClick={onReview} disabled={dueCount === 0}>
            <strong>Review</strong>
            <p className="status">
              {dueCount === null
                ? "Loading…"
                : dueCount === 0
                  ? "Nothing due"
                  : `${dueCount} due`}
            </p>
          </button>
        </li>
        {content.topic.unitIds.map((unitId) => {
          const unit = unitById.get(unitId);
          if (unit === undefined) {
            return null;
          }
          const unlocked = isUnitUnlocked(
            unit,
            content.units,
            attemptedTaskIds,
          );
          const complete = isUnitComplete(unit, attemptedTaskIds);
          const status = !unlocked ? "locked" : complete ? "completed" : "open";
          return (
            <li key={unit.id} className={`card${unlocked ? "" : " locked"}`}>
              {unlocked ? (
                <button onClick={() => onSelectUnit(unit.id)}>
                  <strong>{unit.title}</strong>
                  <p>{unit.goal}</p>
                  <p className="status">{status}</p>
                </button>
              ) : (
                <div>
                  <strong>{unit.title}</strong>
                  <p>{unit.goal}</p>
                  <p className="status">{status}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

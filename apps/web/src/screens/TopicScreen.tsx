import { useEffect, useState } from "react";
import type { Content } from "@betterbeaver/schema";
import type { ProgressStore, Streak } from "@betterbeaver/engine";
import { dueUnits, isUnitComplete, isUnitUnlocked } from "@betterbeaver/engine";

export function TopicScreen({
  content,
  attemptedTaskIds,
  store,
  epoch,
  onSelectUnit,
  onReview,
  onVocabulary,
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
  onVocabulary: () => void;
  onBack: () => void;
}) {
  const unitById = new Map(content.units.map((unit) => [unit.id, unit]));
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    let cancelled = false;
    dueUnits(content, store, new Date()).then((due) => {
      if (cancelled) {
        return;
      }
      setDueCount(due.length);
    });
    void store.getStreak().then((current) => {
      if (!cancelled) {
        setStreak(current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, store, epoch]);

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          &larr; Topics
        </button>
        {streak !== null && streak.length > 0 ? (
          <span className="streak" title="Day streak">
            &#128293; {streak.length}
          </span>
        ) : null}
      </header>
      <h1>{content.topic.title}</h1>
      <p>{content.topic.description}</p>
      <ul className="card-list">
        <li className={`card review${dueCount !== 0 ? " primary" : ""}`}>
          <button onClick={onReview} disabled={dueCount === 0}>
            <strong>Review</strong>
            {dueCount !== null && dueCount > 0 ? (
              <span className="badge">{dueCount}</span>
            ) : null}
            <p className="status">
              {dueCount === null
                ? "Loading…"
                : dueCount === 0
                  ? "Nothing due"
                  : `${dueCount} due`}
            </p>
          </button>
        </li>
        <li className="card">
          <button onClick={onVocabulary}>
            <strong>Vocabulary</strong>
            <p className="status">Browse words, make lists, study your way</p>
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
          const attemptedCount = unit.taskIds.filter((id) =>
            attemptedTaskIds.has(id),
          ).length;
          const progress = `${attemptedCount} of ${unit.taskIds.length} tasks`;
          return (
            <li key={unit.id} className={`card${unlocked ? "" : " locked"}`}>
              {unlocked ? (
                <button onClick={() => onSelectUnit(unit.id)}>
                  <strong>{unit.title}</strong>
                  {complete ? (
                    <span className="done-mark"> &#10003;</span>
                  ) : null}
                  <p>{unit.goal}</p>
                  <p className="status">{progress}</p>
                </button>
              ) : (
                <div>
                  <strong>&#128274; {unit.title}</strong>
                  <p>{unit.goal}</p>
                  <p className="status">locked</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

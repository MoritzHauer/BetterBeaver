import type { Content } from "@betterbeaver/schema";
import { isUnitComplete, isUnitUnlocked } from "@betterbeaver/engine";

export function TopicScreen({
  content,
  attemptedTaskIds,
  onSelectUnit,
  onBack,
}: {
  content: Content;
  attemptedTaskIds: ReadonlySet<string>;
  onSelectUnit: (unitId: string) => void;
  onBack: () => void;
}) {
  const unitById = new Map(content.units.map((unit) => [unit.id, unit]));

  return (
    <main>
      <button onClick={onBack}>&larr; Topics</button>
      <h1>{content.topic.title}</h1>
      <p>{content.topic.description}</p>
      <ul className="card-list">
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

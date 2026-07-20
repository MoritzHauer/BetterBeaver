import type { Content } from "@betterbeaver/schema";
import { isUnitComplete, isUnitUnlocked } from "@betterbeaver/engine";
import { LockableProgress } from "../components/ProgressBar";
import type { PracticeTarget } from "./TopicScreen";
import { lessonPracticeTargets } from "./TopicScreen";

/**
 * A lesson's units (plan 0008): the navigation level between TopicScreen's
 * lessons and UnitScreen's content — structurally today's former
 * TopicScreen-rendering-units logic, one level down.
 */
export function LessonScreen({
  content,
  lessonId,
  attemptedTaskIds,
  onSelectUnit,
  onPracticeTask,
  onEdit,
  onBack,
}: {
  content: Content;
  lessonId: string;
  attemptedTaskIds: ReadonlySet<string>;
  onSelectUnit: (unitId: string) => void;
  onPracticeTask: (target: PracticeTarget) => void;
  /** Authors only (plan 0012): opens this lesson in the editor. */
  onEdit?: () => void;
  onBack: () => void;
}) {
  const lesson = content.lessons.find((l) => l.id === lessonId);
  if (lesson === undefined) {
    return (
      <main>
        <button onClick={onBack}>&larr; Back</button>
        <p>Unknown lesson: {lessonId}</p>
      </main>
    );
  }

  const units = lesson.unitIds.flatMap((id) => {
    const unit = content.units.find((u) => u.id === id);
    return unit !== undefined ? [unit] : [];
  });
  // Lesson-level Practice shuffles across this lesson's opened units (plan
  // 0008, pinned scope).
  const practicePool = lessonPracticeTargets(lesson, content, attemptedTaskIds);

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          &larr; {content.topic.title}
        </button>
        {onEdit !== undefined && (
          <button className="plain" onClick={onEdit}>
            ✎ Edit
          </button>
        )}
      </header>
      <h1>{lesson.title}</h1>
      <p>{lesson.goal}</p>
      <ul className="card-list">
        <li className="card">
          <button
            disabled={practicePool.length === 0}
            onClick={() => {
              const target =
                practicePool[Math.floor(Math.random() * practicePool.length)];
              if (target !== undefined) {
                onPracticeTask(target);
              }
            }}
          >
            <strong>Practice</strong>
            <p className="status">A random task from your opened units</p>
          </button>
        </li>
        {units.map((unit) => {
          const unlocked = isUnitUnlocked(unit, units, attemptedTaskIds);
          const complete = isUnitComplete(unit, attemptedTaskIds);
          const attemptedCount = unit.taskIds.filter((id) =>
            attemptedTaskIds.has(id),
          ).length;
          return (
            <li key={unit.id} className={`card${unlocked ? "" : " locked"}`}>
              <button
                onClick={() => {
                  // Skip-ahead behind a confirmation (plan 0008 point 15).
                  if (
                    unlocked ||
                    window.confirm(
                      "Are you sure you want to skip the previous unit?",
                    )
                  ) {
                    onSelectUnit(unit.id);
                  }
                }}
              >
                <strong>
                  {unlocked ? "" : "\u{1F512} "}
                  {unit.title}
                </strong>
                {complete ? <span className="done-mark"> &#10003;</span> : null}
                <p>{unit.goal}</p>
                <LockableProgress
                  unlocked={unlocked}
                  value={attemptedCount}
                  max={unit.taskIds.length}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

import { useState } from "react";
import type { Content } from "@betterbeaver/schema";
import { isUnitComplete, isUnitUnlocked } from "@betterbeaver/engine";
import { ConfirmSheet } from "../components/Sheet";
import { LockableProgress } from "../components/ProgressBar";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { BookWatermark } from "../components/BookWatermark";
import type { PracticeTarget } from "./BookScreen";
import { lessonPracticeTargets } from "./BookScreen";

/**
 * A lesson's units (plan 0008): the navigation level between BookScreen's
 * lessons and UnitScreen's content — structurally today's former
 * BookScreen-rendering-units logic, one level down.
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
  // Ahead of the unknown-lesson early return below: hooks cannot be
  // conditional.
  const [pendingUnitId, setPendingUnitId] = useState<string | null>(null);

  const lesson = content.lessons.find((l) => l.id === lessonId);
  if (lesson === undefined) {
    return (
      <main>
        <button onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          Back
        </button>
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

  // The unit awaiting a skip-ahead confirmation, and the one gating it. A
  // pending unit always has a gate — `isUnitUnlocked` returns true when
  // `unlocksAfterUnitId` is absent or dangling, so an unlocked unit never
  // gets here — but the name is resolved defensively all the same.
  const pendingUnit = units.find((u) => u.id === pendingUnitId);
  const blockingUnit = units.find(
    (u) => u.id === pendingUnit?.unlocksAfterUnitId,
  );

  return (
    <main>
      <BookWatermark bookId={content.topic.id} />
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          {content.topic.title}
        </button>
        {onEdit !== undefined && (
          <button className="plain" onClick={onEdit}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/edit.png`}
              alt=""
            />{" "}
            Edit
          </button>
        )}
      </header>
      <h1>{lesson.title}</h1>
      <p>{lesson.goal}</p>
      <FeedbackWidget
        docId={`topic:${content.topic.id}`}
        contentKind="lesson"
        contentId={lesson.id}
      />
      <ul className="card-list">
        <li className={`card${practicePool.length > 0 ? " primary" : ""}`}>
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
                onClick={() =>
                  // Skip-ahead behind a confirmation (plan 0008 point 15) —
                  // a locked unit is clickable, not blocked.
                  unlocked ? onSelectUnit(unit.id) : setPendingUnitId(unit.id)
                }
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
      {pendingUnit !== undefined && (
        <ConfirmSheet
          icon="lock_key"
          title="Skip ahead?"
          body={
            blockingUnit !== undefined
              ? `You haven’t finished “${blockingUnit.title}” yet. You can come back to it any time.`
              : "You haven’t finished the unit before this one yet. You can come back to it any time."
          }
          cancelLabel="Not yet"
          confirmLabel="Start anyway"
          onCancel={() => setPendingUnitId(null)}
          onConfirm={() => {
            setPendingUnitId(null);
            onSelectUnit(pendingUnit.id);
          }}
        />
      )}
    </main>
  );
}

import { useState } from "react";
import type { Content } from "@betterbeaver/schema";
import { isUnitComplete, isUnitUnlocked } from "@betterbeaver/engine";
import { ConfirmSheet } from "../components/Sheet";
import { LockableProgress } from "../components/ProgressBar";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { BookWatermark } from "../components/BookWatermark";
import { useEditSession } from "./edit/EditSessionContext";
import { ProblemMarker, lessonEditOps, withOptionalKey } from "./edit/inPlace";
import { EntityPicker, RowActions } from "./edit/fields";
import { optionsFrom } from "./entityPicker";
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Edit mode (plan 0021 §2), same shape as the Book and Unit screens.
  const edit = lessonEditOps(useEditSession(), lessonId);

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
  // Named by title, never by id.
  const pendingDelete = units.find((u) => u.id === pendingDeleteId);

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
      {edit === null ? (
        <>
          <h1>{lesson.title}</h1>
          <p>{lesson.goal}</p>
          <FeedbackWidget
            docId={`topic:${content.topic.id}`}
            contentKind="lesson"
            contentId={lesson.id}
          />
        </>
      ) : (
        <>
          <label className="field">
            Title
            <input
              type="text"
              value={lesson.title}
              onChange={(e) =>
                edit.patchLesson({ ...edit.rawLesson, title: e.target.value })
              }
            />
          </label>
          <ProblemMarker problems={edit.fieldProblems(lesson.id, "title")} />
          <label className="field">
            Goal
            <textarea
              rows={3}
              value={lesson.goal}
              onChange={(e) =>
                edit.patchLesson({ ...edit.rawLesson, goal: e.target.value })
              }
            />
          </label>
          <ProblemMarker problems={edit.fieldProblems(lesson.id, "goal")} />
          <ProblemMarker problems={edit.entityProblems(lesson.id)} />
          {/* Edited here, on the entity it belongs to, even though its
              learner surface is the lock on the Book screen's card. */}
          <EntityPicker
            label="Unlocks after"
            options={optionsFrom(
              content.lessons.filter((l) => l.id !== lesson.id),
            )}
            selected={
              lesson.unlocksAfterLessonId !== undefined
                ? [lesson.unlocksAfterLessonId]
                : []
            }
            onChange={(ids) =>
              edit.patchLesson(
                withOptionalKey(edit.rawLesson, "unlocksAfterLessonId", ids[0]),
              )
            }
            multiple={false}
            hideIds
          />
        </>
      )}
      <ul className="card-list">
        {/* A progress affordance over published content, meaningless while
            you are looking at a draft (§2b). */}
        {edit === null && (
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
        )}
        {units.map((unit) => {
          const unlocked = isUnitUnlocked(unit, units, attemptedTaskIds);
          const complete = isUnitComplete(unit, attemptedTaskIds);
          const attemptedCount = unit.taskIds.filter((id) =>
            attemptedTaskIds.has(id),
          ).length;
          if (edit !== null) {
            const raw = edit.rawUnit(unit.id) ?? { id: unit.id };
            return (
              <li key={unit.id} className={`card${unlocked ? "" : " locked"}`}>
                <label className="field">
                  {unlocked ? "Unit" : "\u{1F512} Unit"}
                  <input
                    type="text"
                    value={unit.title}
                    onChange={(e) =>
                      edit.patchUnit({ ...raw, title: e.target.value })
                    }
                  />
                </label>
                <ProblemMarker
                  problems={edit.fieldProblems(unit.id, "title")}
                />
                <label className="field">
                  Goal
                  <textarea
                    rows={2}
                    value={unit.goal}
                    onChange={(e) =>
                      edit.patchUnit({ ...raw, goal: e.target.value })
                    }
                  />
                </label>
                <ProblemMarker problems={edit.fieldProblems(unit.id, "goal")} />
                {/* A brand-new unit reads "unit has zero tasks" straight
                    away; slice 8's Exercises page is where that resolves. */}
                <ProblemMarker problems={edit.entityProblems(unit.id)} />
                <LockableProgress
                  unlocked={unlocked}
                  value={attemptedCount}
                  max={unit.taskIds.length}
                />
                <RowActions
                  onUp={() => edit.moveUnit(unit.id, -1)}
                  onDown={() => edit.moveUnit(unit.id, 1)}
                  onRemove={() => setPendingDeleteId(unit.id)}
                />
                <button className="plain" onClick={() => onSelectUnit(unit.id)}>
                  Open &rsaquo;
                </button>
              </li>
            );
          }
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
      {edit !== null && (
        <>
          <ProblemMarker problems={edit.fieldProblems(lesson.id, "unitIds")} />
          <button type="button" className="editor-add" onClick={edit.addUnit}>
            + unit
          </button>
        </>
      )}
      {pendingDelete !== undefined && (
        <ConfirmSheet
          icon="lock_key"
          title="Delete this unit?"
          body={`“${pendingDelete.title}” and everything in it will be removed from this Book.`}
          cancelLabel="Keep it"
          confirmLabel="Delete"
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            setPendingDeleteId(null);
            edit?.removeUnit(pendingDelete.id);
          }}
        />
      )}
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

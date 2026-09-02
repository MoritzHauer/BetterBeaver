import { Fragment, useEffect, useState } from "react";
import type { Content } from "@betterbeaver/schema";
import type { ProgressStore, UnitProgress } from "@betterbeaver/engine";
import {
  dueCountsByUnit,
  dueUnits,
  isUnitComplete,
  isUnitUnlocked,
} from "@betterbeaver/engine";
import { ConfirmSheet } from "../components/Sheet";
import { SettingsSheet } from "../components/SettingsSheet";
import { UndoToast, useUndoSnapshot } from "../components/UndoToast";
import { LockableProgress } from "../components/ProgressBar";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { BookWatermark } from "../components/BookWatermark";
import { useEditSession } from "./edit/EditSessionContext";
import { ProblemMarker, lessonEditOps, withOptionalKey } from "./edit/inPlace";
import { diffView } from "./edit/diffView";
import { EntityPicker, RowActions } from "./edit/fields";
import { optionsFrom, unitPoolOptionsGroupedByLesson } from "./entityPicker";
import type { PracticeTarget } from "./BookScreen";
import { lessonPracticeTargets } from "./BookScreen";
// The multiline in-place control (spec 0021-13 §1): Goal on each unit card,
// same as the Book screen reaches across for its own lesson cards.
import { GrowingTextarea } from "./UnitScreen";

/**
 * A lesson's units (plan 0008): the navigation level between BookScreen's
 * lessons and UnitScreen's content — structurally today's former
 * BookScreen-rendering-units logic, one level down.
 */
export function LessonScreen({
  content,
  lessonId,
  unitProgress,
  store,
  onSelectUnit,
  onPracticeTask,
  onEdit,
  onBack,
}: {
  content: Content;
  lessonId: string;
  unitProgress: ReadonlyMap<string, UnitProgress>;
  /** Progress store, for the per-unit due badges (plan 0022 §7) — the same
   * `dueUnits` sweep BookScreen runs for its Daily Review badge, one level
   * down. Nothing else on this screen reads progress from storage. */
  store: ProgressStore;
  onSelectUnit: (unitId: string) => void;
  onPracticeTask: (target: PracticeTarget) => void;
  /** Authors only (plan 0012): opens this lesson in the editor. */
  onEdit?: () => void;
  onBack: () => void;
}) {
  // Ahead of the unknown-lesson early return below: hooks cannot be
  // conditional.
  const [pendingUnitId, setPendingUnitId] = useState<string | null>(null);
  const [dueByUnit, setDueByUnit] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Which unit's "Unlocks after" sheet is open, across every card — same
  // one-id-serves-every-row shape as `BookScreen`'s `openLessonSettingsId`
  // (spec 0021-14 §2).
  const [openUnitSettingsId, setOpenUnitSettingsId] = useState<string | null>(
    null,
  );
  // Edit mode (plan 0021 §2), same shape as the Book and Unit screens.
  const session = useEditSession();
  const edit = lessonEditOps(session, lessonId);
  // Diff renders the union read-only with per-element tints (spec 0021-9 §3).
  const diff = diffView(session);
  // Undo toast for the unit delete (spec 0021-14 §4) — captured inside the
  // existing confirm's `onConfirm`, not instead of it, same as BookScreen's
  // lesson delete.
  const { message: undoMessage, capture, undo } = useUndoSnapshot();

  useEffect(() => {
    let cancelled = false;
    // Cannot reject: `dueUnits` only ever awaits `readJson`-backed reads,
    // which degrade to absent rather than throwing (spec 0019 §1).
    void dueUnits(content, store, new Date()).then((due) => {
      if (!cancelled) {
        setDueByUnit(dueCountsByUnit(due, content.units));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, store]);

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
  const practicePool = lessonPracticeTargets(lesson, content, unitProgress);

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
          {/* The lesson's own fields, old above new when *these two* changed
              — a lesson whose `unitIds` changed shows them once (§3). */}
          {(() => {
            const shown = { title: lesson.title, goal: lesson.goal };
            const was = diff?.changedFrom<typeof shown>(lesson.id, shown);
            return (
              <>
                {was !== undefined && (
                  <div className="diff-old">
                    <h1>{was.title ?? ""}</h1>
                    <p>{was.goal ?? ""}</p>
                  </div>
                )}
                <div className={diff?.className(lesson.id, shown)}>
                  <h1>{lesson.title}</h1>
                  <p>{lesson.goal}</p>
                </div>
              </>
            );
          })()}
          {/* Reporting a problem in content you are looking at as a draft is
              a loop — hidden in Preview and Diff as well as in Edit. */}
          {session === null && (
            <FeedbackWidget
              docId={`topic:${content.topic.id}`}
              contentKind="lesson"
              contentId={lesson.id}
            />
          )}
        </>
      ) : (
        <>
          {/* Title and goal at their learner type (spec 0021-14 §2): the
              same `.book-edit-card` borderless treatment the Book screen
              gives its own h1/description — the title stays an <h1>, not a
              labelled box. */}
          <h1 className="book-edit-card">
            <input
              type="text"
              aria-label="Title"
              value={lesson.title}
              onChange={(e) =>
                edit.patchLesson({ ...edit.rawLesson, title: e.target.value })
              }
            />
          </h1>
          <ProblemMarker problems={edit.fieldProblems(lesson.id, "title")} />
          <div className="book-edit-card">
            <GrowingTextarea
              ariaLabel="Goal"
              value={lesson.goal}
              onChange={(e) =>
                edit.patchLesson({ ...edit.rawLesson, goal: e.target.value })
              }
            />
          </div>
          <ProblemMarker problems={edit.fieldProblems(lesson.id, "goal")} />
          <ProblemMarker problems={edit.entityProblems(lesson.id)} />
          {/* Edited here, on the entity it belongs to, even though its
              learner surface is the lock on the Book screen's card. Stays
              inline rather than behind a header `⚙` (spec 0021-14 §3): the
              Lesson screen has no card of its own to carry one, and the
              Book screen's lesson card already carries this same field —
              a second sheet for one control is what §3 rules out. */}
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
          />
        </>
      )}
      <ul className="card-list">
        {/* A progress affordance over published content, meaningless while
            you are looking at a draft (§2b) — and over the union content a
            Diff renders. Preview keeps it: with everything unlocked it
            shuffles the whole lesson, which is what Preview is for. */}
        {(session === null || session.view === "preview") && (
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
          const unlocked = isUnitUnlocked(unit, units, unitProgress);
          const complete = isUnitComplete(unit, unitProgress);
          const percent = unitProgress.get(unit.id)?.percent ?? 0;
          if (edit !== null) {
            const raw = edit.rawUnit(unit.id) ?? { id: unit.id };
            // The card can't stay one big <button> once it holds inputs, so
            // opening the unit becomes its own control — same move the Book
            // screen made for its lesson cards (spec 0021-14 §1/§2). Title
            // and goal keep the card's own learner treatment, and "Unlocks
            // after" moves behind the card's own `⚙`.
            return (
              <li
                key={unit.id}
                className={`card book-edit-card${unlocked ? "" : " locked"}`}
              >
                <strong>
                  {unlocked ? "" : "\u{1F512} "}
                  <input
                    type="text"
                    aria-label="Unit title"
                    value={unit.title}
                    onChange={(e) =>
                      edit.patchUnit({ ...raw, title: e.target.value })
                    }
                  />
                </strong>
                <ProblemMarker
                  problems={edit.fieldProblems(unit.id, "title")}
                />
                <GrowingTextarea
                  ariaLabel="Unit goal"
                  value={unit.goal}
                  onChange={(e) =>
                    edit.patchUnit({ ...raw, goal: e.target.value })
                  }
                />
                <ProblemMarker problems={edit.fieldProblems(unit.id, "goal")} />
                {/* A brand-new unit reads "unit has zero tasks" straight
                    away; slice 8's Exercises page is where that resolves. */}
                <ProblemMarker problems={edit.entityProblems(unit.id)} />
                <LockableProgress unlocked={unlocked} percent={percent} />
                <RowActions
                  onUp={() => edit.moveUnit(unit.id, -1)}
                  onDown={() => edit.moveUnit(unit.id, 1)}
                  onSettings={() => setOpenUnitSettingsId(unit.id)}
                  settingsLabel="Unit settings"
                  onRemove={() => setPendingDeleteId(unit.id)}
                />
                <button className="plain" onClick={() => onSelectUnit(unit.id)}>
                  Open &rsaquo;
                </button>
              </li>
            );
          }
          if (diff !== null) {
            const was = diff.changedFrom<{ title?: string; goal?: string }>(
              unit.id,
            );
            return (
              <Fragment key={unit.id}>
                {was !== undefined && (
                  <li className="card diff-old">
                    <strong>{was.title}</strong>
                    <p>{was.goal}</p>
                  </li>
                )}
                <li className={`card ${diff.className(unit.id) ?? ""}`}>
                  <button onClick={() => onSelectUnit(unit.id)}>
                    <strong>{unit.title}</strong>
                    <p>{unit.goal}</p>
                  </button>
                </li>
              </Fragment>
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
                  percent={percent}
                  due={dueByUnit.get(unit.id)}
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
            // Snapshot before the mutation (spec 0021-14 §4) — a unit's own
            // items, tasks and notes go with it, so Undo has to hand back
            // the whole book, not just the unit.
            const bookBefore = session?.book;
            if (bookBefore !== undefined) {
              capture("Unit", () => session?.changeBook(bookBefore));
            }
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
      {/* One unit's "Unlocks after" (spec 0021-14 §2/§3): the only control
          the card's own `⚙` carries — not a whole Unit settings sheet with
          more, the card already carries everything else. */}
      {edit !== null &&
        (() => {
          const openUnit = units.find((u) => u.id === openUnitSettingsId);
          if (openUnit === undefined) {
            return null;
          }
          const raw = edit.rawUnit(openUnit.id) ?? { id: openUnit.id };
          return (
            <SettingsSheet
              title={openUnit.title.trim() === "" ? "New unit" : openUnit.title}
              onDismiss={() => setOpenUnitSettingsId(null)}
            >
              <EntityPicker
                label="Unlocks after"
                options={unitPoolOptionsGroupedByLesson(
                  content.topic.lessonIds.flatMap((id) => {
                    const l = content.lessons.find((x) => x.id === id);
                    return l !== undefined ? [l] : [];
                  }),
                  content.units.filter((u) => u.id !== openUnit.id),
                )}
                selected={
                  openUnit.unlocksAfterUnitId !== undefined
                    ? [openUnit.unlocksAfterUnitId]
                    : []
                }
                onChange={(ids) =>
                  edit.patchUnit(
                    withOptionalKey(raw, "unlocksAfterUnitId", ids[0]),
                  )
                }
                multiple={false}
                groupBy
              />
            </SettingsSheet>
          );
        })()}
      {undoMessage !== null && (
        <UndoToast message={undoMessage} onUndo={undo} />
      )}
    </main>
  );
}

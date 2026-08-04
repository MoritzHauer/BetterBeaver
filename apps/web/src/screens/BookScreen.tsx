import { useEffect, useState } from "react";
import type { Content, Lesson } from "@betterbeaver/schema";
import type { ProgressStore, Streak } from "@betterbeaver/engine";
import {
  dueUnits,
  isLessonComplete,
  isLessonUnlocked,
  isUnitComplete,
  isUnitUnlocked,
  nextUnit,
} from "@betterbeaver/engine";
import { BOOK_ICONS } from "@betterbeaver/schema";
import { ConfirmSheet } from "../components/Sheet";
import { LockableProgress } from "../components/ProgressBar";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { ChatThread } from "../components/ChatThread";
import { BookWatermark } from "../components/BookWatermark";
import { useEditSession } from "./edit/EditSessionContext";
import { ProblemMarker, bookEditOps, withOptionalKey } from "./edit/inPlace";
import { RowActions } from "./edit/fields";

const CHAT_ENABLED = false;

/** One practice-able task and where it lives, for the shuffle buttons (plan 0008). */
export interface PracticeTarget {
  lessonId: string;
  unitId: string;
  taskId: string;
}

/**
 * Every task of a lesson's *opened* (unlocked) units — the lesson-level
 * Practice shuffle pool (plan 0008, pinned scope).
 */
export function lessonPracticeTargets(
  lesson: Lesson,
  content: Content,
  attemptedTaskIds: ReadonlySet<string>,
): PracticeTarget[] {
  const units = lesson.unitIds.flatMap((id) => {
    const unit = content.units.find((u) => u.id === id);
    return unit !== undefined ? [unit] : [];
  });
  return units
    .filter((unit) => isUnitUnlocked(unit, units, attemptedTaskIds))
    .flatMap((unit) =>
      unit.taskIds.map((taskId) => ({
        lessonId: lesson.id,
        unitId: unit.id,
        taskId,
      })),
    );
}

export function BookScreen({
  content,
  attemptedTaskIds,
  store,
  epoch,
  onSelectLesson,
  onPracticeTask,
  onPlay,
  onReview,
  onVocabulary,
  onEdit,
  onBack,
  unpublishedChanges = false,
}: {
  content: Content;
  attemptedTaskIds: ReadonlySet<string>;
  store: ProgressStore;
  /** This Book has authored work that has not left the device (spec 0021-5
   * §3). Shown to everyone who can see it, because only an author ever has
   * the storage key it is read from — leaving edit mode used to hide the
   * fact that a draft existed at all. */
  unpublishedChanges?: boolean;
  /** Bumped by the caller on every navigation to this screen, so the due
   * count is recomputed after sessions elsewhere may have changed it. */
  epoch: number;
  onSelectLesson: (lessonId: string) => void;
  onPracticeTask: (target: PracticeTarget) => void;
  /** Play (plan 0020 §2): due > 0 → Daily Review, else the next incomplete
   * unit, else nothing (the trophy state below handles that in-place). */
  onPlay: () => void;
  onReview: () => void;
  onVocabulary: () => void;
  /** Authors only (plan 0012): opens this book's document in the editor. */
  onEdit?: () => void;
  onBack: () => void;
}) {
  const lessonById = new Map(
    content.lessons.map((lesson) => [lesson.id, lesson]),
  );
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(null);
  // Edit mode (plan 0021 §1), same shape as the Unit screen: `null` in
  // learner mode, and every editable surface is `edit === null ? … : …`.
  const edit = bookEditOps(useEditSession());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cannot reject: `dueUnits` only ever awaits `readJson`-backed reads,
    // which degrade to absent rather than throwing (spec 0019 §1).
    void dueUnits(content, store, new Date()).then((due) => {
      if (cancelled) {
        return;
      }
      setDueCount(due.length);
    });
    void store.getStreak(content.topic.domainId).then((current) => {
      if (!cancelled) {
        setStreak(current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, store, epoch]);

  // Play card state (plan 0020 §2, table in spec 0020-1 §4): resolved here
  // rather than threaded down as a prop — BookScreen already has `content`
  // and `attemptedTaskIds`, so this is the fewer-props option.
  const nextUp = nextUnit(content, attemptedTaskIds);
  const bookComplete = dueCount === 0 && nextUp === null;
  const playDisabled = dueCount === null || bookComplete;

  // Book-level Practice shuffles across the opened lessons' opened units
  // (plan 0008, pinned scope).
  const practicePool = content.lessons
    .filter((lesson) =>
      isLessonUnlocked(
        lesson,
        content.lessons,
        content.units,
        attemptedTaskIds,
      ),
    )
    .flatMap((lesson) =>
      lessonPracticeTargets(lesson, content, attemptedTaskIds),
    );

  // The lesson awaiting a skip-ahead confirmation, and the one gating it. A
  // pending lesson always has a gate — `isLessonUnlocked` returns true when
  // `unlocksAfterLessonId` is absent or dangling, so an unlocked lesson never
  // gets here — but the name is resolved defensively all the same.
  const pendingLesson =
    pendingLessonId !== null ? lessonById.get(pendingLessonId) : undefined;
  // Named by title, never by id — the id is a UUID and means nothing.
  const pendingDelete =
    pendingDeleteId !== null ? lessonById.get(pendingDeleteId) : undefined;
  const blockingLesson =
    pendingLesson?.unlocksAfterLessonId !== undefined
      ? lessonById.get(pendingLesson.unlocksAfterLessonId)
      : undefined;

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
          Books
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
        {streak !== null && streak.length > 0 ? (
          <span className="streak" title="Day streak">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
              alt=""
            />{" "}
            {streak.length}
          </span>
        ) : null}
      </header>
      {edit === null ? (
        <>
          <h1>{content.topic.title}</h1>
          {unpublishedChanges && <p className="status">unpublished changes</p>}
          <p>{content.topic.description}</p>
          {/* Reporting a problem in content you are editing is a loop, so
              this and the chat block below are hidden in edit mode. */}
          <FeedbackWidget
            docId={`topic:${content.topic.id}`}
            contentKind="topic"
            contentId={content.topic.id}
          />
        </>
      ) : (
        <>
          <label className="field">
            Title
            <input
              type="text"
              value={content.topic.title}
              onChange={(e) =>
                edit.patchBook({ ...edit.rawBook, title: e.target.value })
              }
            />
          </label>
          <ProblemMarker problems={edit.fieldProblems("topic", "title")} />
          <label className="field">
            Description
            <textarea
              rows={3}
              value={content.topic.description}
              onChange={(e) =>
                edit.patchBook({ ...edit.rawBook, description: e.target.value })
              }
            />
          </label>
          <ProblemMarker
            problems={edit.fieldProblems("topic", "description")}
          />
          <label className="field">
            Icon
            <select
              value={content.topic.icon ?? ""}
              onChange={(e) =>
                edit.patchBook(
                  withOptionalKey(edit.rawBook, "icon", e.target.value),
                )
              }
            >
              <option value="">(none)</option>
              {BOOK_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </label>
          {/* Hidden for a private Book, not disabled: the watermark is loaded
              from `art/icons/<book.id>.png` in the app's *public* assets,
              which a private Book can never reach — offering a control that
              could only ever silently fail is worse than not offering it
              (`BookEditor.tsx:46-51`, same rationale). */}
          {!edit.isPrivate && (
            <label className="field">
              Cover art
              <input
                type="checkbox"
                checked={content.topic.hasCoverArt === true}
                onChange={(e) =>
                  edit.patchBook(
                    withOptionalKey(
                      edit.rawBook,
                      "hasCoverArt",
                      e.target.checked,
                    ),
                  )
                }
              />
            </label>
          )}
          <ProblemMarker problems={edit.entityProblems("topic")} />
        </>
      )}
      <ul className="card-list">
        {/* Progress affordances, not content (§1c): all four are hidden in
            edit mode. Play in particular derives from `nextUnit`/`dueUnits`
            over the *published* content while you are looking at a draft, so
            it would be actively misleading. */}
        {edit === null && (
          <>
            <li className={"card" + (playDisabled ? "" : " primary")}>
              <button onClick={onPlay} disabled={playDisabled}>
                <strong>
                  <img
                    className="icon-glyph"
                    src={`${import.meta.env.BASE_URL}art/icons/${bookComplete ? "trophy" : "play"}.png`}
                    alt=""
                  />{" "}
                  {bookComplete ? "Book complete" : "Continue learning"}
                </strong>
              </button>
            </li>
            <li className={`card review${dueCount !== 0 ? " primary" : ""}`}>
              <button onClick={onReview} disabled={dueCount === 0}>
                <strong>Daily Review</strong>
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
            <li className={`card${practicePool.length > 0 ? " primary" : ""}`}>
              <button
                disabled={practicePool.length === 0}
                onClick={() => {
                  const target =
                    practicePool[
                      Math.floor(Math.random() * practicePool.length)
                    ];
                  if (target !== undefined) {
                    onPracticeTask(target);
                  }
                }}
              >
                <strong>Practice</strong>
                <p className="status">A random task from your opened lessons</p>
              </button>
            </li>
            <li className="card vocab">
              <button onClick={onVocabulary}>
                <strong>
                  <img
                    className="icon-glyph"
                    src={`${import.meta.env.BASE_URL}art/icons/book_front.png`}
                    alt=""
                  />{" "}
                  Vocabulary
                </strong>
              </button>
            </li>
          </>
        )}
        {content.topic.lessonIds.map((lessonId) => {
          const lesson = lessonById.get(lessonId);
          if (lesson === undefined) {
            return null;
          }
          const unlocked = isLessonUnlocked(
            lesson,
            content.lessons,
            content.units,
            attemptedTaskIds,
          );
          const complete = isLessonComplete(
            lesson,
            content.units,
            attemptedTaskIds,
          );
          const completeCount = lesson.unitIds.filter((id) => {
            const unit = content.units.find((u) => u.id === id);
            return unit !== undefined && isUnitComplete(unit, attemptedTaskIds);
          }).length;
          if (edit !== null) {
            const raw = edit.rawLesson(lesson.id) ?? { id: lesson.id };
            // The card can't stay one big <button> once it holds inputs, so
            // opening the lesson becomes its own control. The lock glyph and
            // progress bar stay (§1c): a lock is the learner-visible face of
            // `unlocksAfterLessonId`, and seeing it is how the author checks
            // the chain they just authored.
            return (
              <li
                key={lesson.id}
                className={`card${unlocked ? "" : " locked"}`}
              >
                <label className="field">
                  {unlocked ? "Lesson" : "\u{1F512} Lesson"}
                  <input
                    type="text"
                    value={lesson.title}
                    onChange={(e) =>
                      edit.patchLesson({ ...raw, title: e.target.value })
                    }
                  />
                </label>
                <ProblemMarker
                  problems={edit.fieldProblems(lesson.id, "title")}
                />
                <label className="field">
                  Goal
                  <textarea
                    rows={2}
                    value={lesson.goal}
                    onChange={(e) =>
                      edit.patchLesson({ ...raw, goal: e.target.value })
                    }
                  />
                </label>
                <ProblemMarker
                  problems={edit.fieldProblems(lesson.id, "goal")}
                />
                <ProblemMarker problems={edit.entityProblems(lesson.id)} />
                <LockableProgress
                  unlocked={unlocked}
                  value={completeCount}
                  max={lesson.unitIds.length}
                />
                <RowActions
                  onUp={() => edit.moveLesson(lesson.id, -1)}
                  onDown={() => edit.moveLesson(lesson.id, 1)}
                  onRemove={() => setPendingDeleteId(lesson.id)}
                />
                <button
                  className="plain"
                  onClick={() => onSelectLesson(lesson.id)}
                >
                  Open &rsaquo;
                </button>
              </li>
            );
          }
          return (
            <li key={lesson.id} className={`card${unlocked ? "" : " locked"}`}>
              <button
                onClick={() =>
                  // Skip-ahead is allowed behind a confirmation (plan 0008
                  // point 15) — a locked lesson is clickable, not blocked.
                  unlocked
                    ? onSelectLesson(lesson.id)
                    : setPendingLessonId(lesson.id)
                }
              >
                <strong>
                  {unlocked ? "" : "\u{1F512} "}
                  {lesson.title}
                </strong>
                {complete ? <span className="done-mark"> &#10003;</span> : null}
                <p>{lesson.goal}</p>
                <LockableProgress
                  unlocked={unlocked}
                  value={completeCount}
                  max={lesson.unitIds.length}
                />
              </button>
            </li>
          );
        })}
      </ul>
      {edit !== null && (
        <>
          {/* Book-level problems — a dangling `topic.lessonIds` reference is
              the usual one — belong beside the list they are about. */}
          <ProblemMarker problems={edit.fieldProblems("topic", "lessonIds")} />
          <button type="button" className="editor-add" onClick={edit.addLesson}>
            + lesson
          </button>
        </>
      )}
      {/* ponytail: chat deactivated per owner call, not removed — code
       * stays intact for later; flip this back to re-enable. */}
      {CHAT_ENABLED && edit === null && (
        <ChatThread docId={`topic:${content.topic.id}`} />
      )}
      {pendingDelete !== undefined && (
        <ConfirmSheet
          icon="lock_key"
          title="Delete this lesson?"
          body={`“${pendingDelete.title}” and everything under it will be removed from this Book.`}
          cancelLabel="Keep it"
          confirmLabel="Delete"
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            setPendingDeleteId(null);
            edit?.removeLesson(pendingDelete.id);
          }}
        />
      )}
      {pendingLesson !== undefined && (
        <ConfirmSheet
          icon="lock_key"
          title="Skip ahead?"
          body={
            blockingLesson !== undefined
              ? `You haven’t finished “${blockingLesson.title}” yet. You can come back to it any time.`
              : "You haven’t finished the lesson before this one yet. You can come back to it any time."
          }
          cancelLabel="Not yet"
          confirmLabel="Start anyway"
          onCancel={() => setPendingLessonId(null)}
          onConfirm={() => {
            setPendingLessonId(null);
            onSelectLesson(pendingLesson.id);
          }}
        />
      )}
    </main>
  );
}

import { useEffect, useState } from "react";
import type { Content, Lesson } from "@betterbeaver/schema";
import type { ProgressStore, Streak } from "@betterbeaver/engine";
import {
  dueUnits,
  isLessonComplete,
  isLessonUnlocked,
  isUnitComplete,
  isUnitUnlocked,
} from "@betterbeaver/engine";
import { LockableProgress } from "../components/ProgressBar";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { ChatThread } from "../components/ChatThread";

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
  onReview,
  onVocabulary,
  onEdit,
  onBack,
}: {
  content: Content;
  attemptedTaskIds: ReadonlySet<string>;
  store: ProgressStore;
  /** Bumped by the caller on every navigation to this screen, so the due
   * count is recomputed after sessions elsewhere may have changed it. */
  epoch: number;
  onSelectLesson: (lessonId: string) => void;
  onPracticeTask: (target: PracticeTarget) => void;
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

  useEffect(() => {
    let cancelled = false;
    dueUnits(content, store, new Date()).then((due) => {
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

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          &larr; Books
        </button>
        {onEdit !== undefined && (
          <button className="plain" onClick={onEdit}>
            ✎ Edit
          </button>
        )}
        {streak !== null && streak.length > 0 ? (
          <span className="streak" title="Day streak">
            &#128293; {streak.length}
          </span>
        ) : null}
      </header>
      <h1>{content.topic.title}</h1>
      <p>{content.topic.description}</p>
      <FeedbackWidget
        docId={`topic:${content.topic.id}`}
        contentKind="topic"
        contentId={content.topic.id}
      />
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
            <p className="status">A random task from your opened lessons</p>
          </button>
        </li>
        <li className="card">
          <button onClick={onVocabulary}>
            <img
              className="topic-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/icon_book_front.png`}
              alt=""
            />
            <strong>Vocabulary</strong>
          </button>
        </li>
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
          return (
            <li key={lesson.id} className={`card${unlocked ? "" : " locked"}`}>
              <button
                onClick={() => {
                  // Skip-ahead is allowed behind a confirmation (plan 0008
                  // point 15) — a locked lesson is clickable, not blocked.
                  if (
                    unlocked ||
                    window.confirm(
                      "Are you sure you want to skip the previous lesson?",
                    )
                  ) {
                    onSelectLesson(lesson.id);
                  }
                }}
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
      <ChatThread docId={`topic:${content.topic.id}`} />
    </main>
  );
}

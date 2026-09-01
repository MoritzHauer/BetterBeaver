import { Fragment, useEffect, useState } from "react";
import type { Content, Lesson } from "@betterbeaver/schema";
import type { ProgressStore, Streak, UnitProgress } from "@betterbeaver/engine";
import {
  dueCountsByLesson,
  dueCountsByUnit,
  dueUnits,
  isLessonComplete,
  isLessonUnlocked,
  isUnitUnlocked,
  nextUnit,
} from "@betterbeaver/engine";
import { BOOK_ICONS } from "@betterbeaver/schema";
import { ConfirmSheet } from "../components/Sheet";
import { SettingsSheet } from "../components/SettingsSheet";
import { UndoToast, useUndoSnapshot } from "../components/UndoToast";
import { LockableProgress } from "../components/ProgressBar";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { ChatThread } from "../components/ChatThread";
import { BookWatermark } from "../components/BookWatermark";
import { useEditSession } from "./edit/EditSessionContext";
import { ProblemMarker, bookEditOps, withOptionalKey } from "./edit/inPlace";
import { diffView } from "./edit/diffView";
import { EntityPicker, RowActions } from "./edit/fields";
import { optionsFrom } from "./entityPicker";
// The multiline in-place control (spec 0021-13 §1): Description here, Goal
// on each lesson card. Imported rather than re-declared — `SessionEditSheet`
// already reaches across screens for the same component.
import { GrowingTextarea } from "./UnitScreen";

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
  unitProgress: ReadonlyMap<string, UnitProgress>,
): PracticeTarget[] {
  const units = lesson.unitIds.flatMap((id) => {
    const unit = content.units.find((u) => u.id === id);
    return unit !== undefined ? [unit] : [];
  });
  return units
    .filter((unit) => isUnitUnlocked(unit, units, unitProgress))
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
  unitProgress,
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
  atSettings = false,
}: {
  content: Content;
  unitProgress: ReadonlyMap<string, UnitProgress>;
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
  /** Arrive with the settings sheet already up, for a publish-error link to
   * a resource — Sources moved into it in slice 14 §3, so the page alone has
   * nothing to show. The Unit trail's `atPage` does the same job. */
  atSettings?: boolean;
}) {
  const lessonById = new Map(
    content.lessons.map((lesson) => [lesson.id, lesson]),
  );
  const [dueCount, setDueCount] = useState<number | null>(null);
  // Per-lesson due counts (plan 0022 §7), bucketed from the same sweep the
  // Daily Review badge above already runs — no second query, no new state to
  // keep in step.
  const [dueByLesson, setDueByLesson] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [streak, setStreak] = useState<Streak | null>(null);
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(null);
  // Edit mode (plan 0021 §1), same shape as the Unit screen: `null` in
  // learner mode, and every editable surface is `edit === null ? … : …`.
  const session = useEditSession();
  const edit = bookEditOps(session);
  // Diff renders the union read-only with per-element tints (spec 0021-9
  // §3); Preview renders the learner screen for real.
  const diff = diffView(session);
  const previewing = session?.view === "preview";
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingResourceId, setPendingResourceId] = useState<string | null>(
    null,
  );
  // The Book settings sheet (spec 0021-14 §3): icon, cover art and Sources,
  // none of which has a learner-visible spot on this page.
  const [bookSettingsOpen, setBookSettingsOpen] = useState(atSettings);
  // An effect, not just the seed above: the publish panel is reachable *from*
  // the Book screen, so a resource error usually re-renders this component
  // rather than remounting it, and a seed-only version would never fire in
  // the commonest case. Keyed on the flag, so dismissing the sheet sticks.
  useEffect(() => {
    if (atSettings) {
      setBookSettingsOpen(true);
    }
  }, [atSettings]);
  // Which lesson's "Unlocks after" sheet is open, across every card — same
  // one-id-serves-every-row shape as `UnitScreen`'s `expandedRow` (spec
  // 0021-13 §2).
  const [openLessonSettingsId, setOpenLessonSettingsId] = useState<
    string | null
  >(null);
  // Undo toast for the lesson delete (spec 0021-14 §4) — captured inside the
  // existing confirm's `onConfirm`, not instead of it: `BookLesson.edit.test.
  // tsx`'s "reorders and deletes lessons" pins the confirm-dialog flow, and
  // §4 only says the delete *lands* on the toast, not that nothing may come
  // before it.
  const { message: undoMessage, capture, undo } = useUndoSnapshot();

  useEffect(() => {
    let cancelled = false;
    // Cannot reject: `dueUnits` only ever awaits `readJson`-backed reads,
    // which degrade to absent rather than throwing (spec 0019 §1).
    void dueUnits(content, store, new Date()).then((due) => {
      if (cancelled) {
        return;
      }
      setDueCount(due.length);
      setDueByLesson(
        dueCountsByLesson(dueCountsByUnit(due, content.units), content.lessons),
      );
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
  // and `unitProgress`, so this is the fewer-props option.
  const nextUp = nextUnit(content, unitProgress);
  const bookComplete = dueCount === 0 && nextUp === null;
  const playDisabled = dueCount === null || bookComplete;

  // Book-level Practice shuffles across the opened lessons' opened units
  // (plan 0008, pinned scope).
  const practicePool = content.lessons
    .filter((lesson) =>
      isLessonUnlocked(lesson, content.lessons, content.units, unitProgress),
    )
    .flatMap((lesson) => lessonPracticeTargets(lesson, content, unitProgress));

  // The lesson awaiting a skip-ahead confirmation, and the one gating it. A
  // pending lesson always has a gate — `isLessonUnlocked` returns true when
  // `unlocksAfterLessonId` is absent or dangling, so an unlocked lesson never
  // gets here — but the name is resolved defensively all the same.
  const pendingLesson =
    pendingLessonId !== null ? lessonById.get(pendingLessonId) : undefined;
  // Named by title, never by id — the id is a UUID and means nothing.
  const pendingDelete =
    pendingDeleteId !== null ? lessonById.get(pendingDeleteId) : undefined;
  // Named by title in the confirm, and counted across both documents — a
  // lexicon entry's `sourceRef` resolves against the *Book's* resources too.
  const pendingResource =
    pendingResourceId !== null
      ? edit?.resources.find((r) => r.id === pendingResourceId)
      : undefined;
  const resourceRefCount =
    pendingResourceId !== null
      ? (edit?.sourceRefCount(pendingResourceId) ?? 0)
      : 0;
  const pendingResourceTitle =
    typeof pendingResource?.title === "string" && pendingResource.title !== ""
      ? pendingResource.title
      : "this source";
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
        {/* Icon, cover art and Sources (spec 0021-14 §3): none of them has a
            learner-visible spot on this page, so they live behind the
            header's own gear rather than as fields in the flow below. */}
        {edit !== null && (
          <RowActions
            onSettings={() => setBookSettingsOpen(true)}
            settingsLabel="Book settings"
          />
        )}
      </header>
      {edit === null ? (
        <>
          {/* The Book's own fields, old above new when *these two* changed
              — adding a lesson changes `topic` too, and shows them once. */}
          {(() => {
            const shown = {
              title: content.topic.title,
              description: content.topic.description,
            };
            const was = diff?.changedFrom<typeof shown>("topic", shown);
            return (
              <>
                {was !== undefined && (
                  <div className="diff-old">
                    <h1>{was.title ?? ""}</h1>
                    <p>{was.description ?? ""}</p>
                  </div>
                )}
                <div className={diff?.className("topic", shown)}>
                  <h1>{content.topic.title}</h1>
                  {unpublishedChanges && diff === null && (
                    <p className="status">unpublished changes</p>
                  )}
                  <p>{content.topic.description}</p>
                </div>
              </>
            );
          })()}
          {/* Reporting a problem in content you are editing is a loop, so
              this and the chat block below are hidden in edit mode — and in
              Preview and Diff, which are the same content. */}
          {session === null && (
            <FeedbackWidget
              docId={`topic:${content.topic.id}`}
              contentKind="topic"
              contentId={content.topic.id}
            />
          )}
        </>
      ) : (
        <>
          {/* Title and description at their learner type (spec 0021-14 §1):
              borderless in place, the same `.book-edit-card` treatment slice
              13 gives a table cell — the title stays an `<h1>`, sized and
              weighted like the learner's own heading, not a labelled box. */}
          <h1 className="book-edit-card">
            <input
              type="text"
              aria-label="Title"
              value={content.topic.title}
              // Not `patchBook`: the title also names this Book's lexicon
              // (decision 11), and that is where `VocabularyScreen`'s heading
              // comes from.
              onChange={(e) => edit.setTitle(e.target.value)}
            />
          </h1>
          <ProblemMarker problems={edit.fieldProblems("topic", "title")} />
          <div className="book-edit-card">
            <GrowingTextarea
              ariaLabel="Description"
              value={content.topic.description}
              onChange={(e) =>
                edit.patchBook({ ...edit.rawBook, description: e.target.value })
              }
            />
          </div>
          <ProblemMarker
            problems={edit.fieldProblems("topic", "description")}
          />
          <ProblemMarker problems={edit.entityProblems("topic")} />
        </>
      )}
      <ul className="card-list">
        {/* Progress affordances, not content (§1c): hidden in edit mode.
            Play in particular derives from `nextUnit`/`dueUnits` over the
            *published* content while you are looking at a draft, so it would
            be actively misleading.
            Hidden in Preview too, and this is required rather than tidy
            (spec 0021-9 §1b): Preview passes a full attempted-task set, so
            `nextUnit` returns null and `dueUnits` nothing — Play would show
            the "Book complete" trophy and Daily Review would be permanently
            disabled, which looks like a broken Preview. */}
        {session === null && (
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
          </>
        )}
        {/* Practice stays in Preview (§1b): it shuffles over unlocked
            lessons, which with everything unlocked is exactly what Preview
            is for. */}
        {(session === null || previewing) && (
          <>
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
            unitProgress,
          );
          const complete = isLessonComplete(
            lesson,
            content.units,
            unitProgress,
          );
          // The lesson's bar is the mean of its units' bars (plan 0025 §8),
          // so it moves for the same reason theirs do — where the old
          // "2 of 5 units complete" only ever moved five times.
          const unitPercents = lesson.unitIds.flatMap((id) => {
            const progress = unitProgress.get(id);
            return progress === undefined ? [] : [progress.percent];
          });
          const percent =
            unitPercents.length === 0
              ? 0
              : Math.round(
                  unitPercents.reduce((sum, value) => sum + value, 0) /
                    unitPercents.length,
                );
          if (edit !== null) {
            const raw = edit.rawLesson(lesson.id) ?? { id: lesson.id };
            // The card can't stay one big <button> once it holds inputs, so
            // opening the lesson becomes its own control. The lock glyph and
            // progress bar stay (§1c): a lock is the learner-visible face of
            // `unlocksAfterLessonId`, and seeing it is how the author checks
            // the chain they just authored.
            // Title and goal keep the card's own learner treatment (spec
            // 0021-14 §1) rather than a labelled box — `<strong>`/wrapping
            // text in place of the form fields the card used to grow.
            // "Unlocks after" moves behind the card's own `⚙`, the same move
            // slice 13 made for a row's secondary fields.
            return (
              <li
                key={lesson.id}
                className={`card book-edit-card${unlocked ? "" : " locked"}`}
              >
                <strong>
                  {unlocked ? "" : "\u{1F512} "}
                  <input
                    type="text"
                    aria-label="Lesson title"
                    value={lesson.title}
                    onChange={(e) =>
                      edit.patchLesson({ ...raw, title: e.target.value })
                    }
                  />
                </strong>
                <ProblemMarker
                  problems={edit.fieldProblems(lesson.id, "title")}
                />
                <GrowingTextarea
                  ariaLabel="Goal"
                  value={lesson.goal}
                  onChange={(e) =>
                    edit.patchLesson({ ...raw, goal: e.target.value })
                  }
                />
                <ProblemMarker
                  problems={edit.fieldProblems(lesson.id, "goal")}
                />
                <ProblemMarker problems={edit.entityProblems(lesson.id)} />
                <LockableProgress unlocked={unlocked} percent={percent} />
                <RowActions
                  onUp={() => edit.moveLesson(lesson.id, -1)}
                  onDown={() => edit.moveLesson(lesson.id, 1)}
                  onSettings={() => setOpenLessonSettingsId(lesson.id)}
                  settingsLabel="Lesson settings"
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
          if (diff !== null) {
            // The old card sits directly above the new one; a removed lesson
            // is in the union with only its base card, tinted red.
            const was = diff.changedFrom<{ title?: string; goal?: string }>(
              lesson.id,
            );
            return (
              <Fragment key={lesson.id}>
                {was !== undefined && (
                  <li className="card diff-old">
                    <strong>{was.title}</strong>
                    <p>{was.goal}</p>
                  </li>
                )}
                <li className={`card ${diff.className(lesson.id) ?? ""}`}>
                  <button onClick={() => onSelectLesson(lesson.id)}>
                    <strong>{lesson.title}</strong>
                    <p>{lesson.goal}</p>
                  </button>
                </li>
              </Fragment>
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
                  percent={percent}
                  due={dueByLesson.get(lesson.id)}
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
          {/* This Book's words, at the level that owns them (spec 0021-11
              §1). Both settings belong to the lexicon, so both are hidden
              — not disabled — when it is somebody else's (§7). */}
          {edit.canEditLexicon && (
            <>
              <h2>Words</h2>
              <label className="field">
                Read-aloud language
                <input
                  type="text"
                  placeholder="ky"
                  value={edit.readAloudLang}
                  onChange={(e) => edit.setReadAloudLang(e.target.value)}
                />
                <span className="status">
                  A BCP-47 tag, like <code>ky</code> or <code>de-AT</code>.
                  Leave it empty and this Book&rsquo;s words are never read
                  aloud.
                </span>
              </label>
              <h3>Word families</h3>
              <p className="status">
                Groups of related words, shown together on the Vocabulary
                screen.
              </p>
              <ul className="editor-list">
                {edit.families.map((family) => (
                  <li key={family.id}>
                    <label className="field">
                      Name
                      <input
                        type="text"
                        value={
                          typeof family.name === "string" ? family.name : ""
                        }
                        onChange={(e) =>
                          edit.patchFamily({ ...family, name: e.target.value })
                        }
                      />
                    </label>
                    <ProblemMarker
                      problems={edit.fieldProblems(family.id, "name")}
                    />
                    <EntityPicker
                      label="Words in this family"
                      options={edit.entryOptions}
                      selected={
                        Array.isArray(family.entryIds)
                          ? (family.entryIds as string[])
                          : []
                      }
                      onChange={(ids) =>
                        edit.patchFamily({ ...family, entryIds: ids })
                      }
                      multiple
                    />
                    <ProblemMarker problems={edit.entityProblems(family.id)} />
                    <RowActions onRemove={() => edit.dropFamily(family.id)} />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="editor-add"
                onClick={edit.addFamily}
              >
                + word family
              </button>
            </>
          )}
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
            // Snapshot *before* the mutation (spec 0021-14 §4) — the most
            // destructive `−` in the app, so Undo has to hand back the whole
            // book, not just the lesson.
            const bookBefore = session?.book;
            if (bookBefore !== undefined) {
              capture("Lesson", () => session?.changeBook(bookBefore));
            }
            edit?.removeLesson(pendingDelete.id);
          }}
        />
      )}
      {pendingResource !== undefined && (
        <ConfirmSheet
          icon="lock_key"
          title="Delete this source?"
          // Not cascaded (§2a): the items keep pointing at it and say so at
          // publish. Silently rewriting somebody's `sourceRef` to a source
          // they did not choose is the worse outcome.
          body={
            resourceRefCount === 0
              ? `“${pendingResourceTitle}” is not used by anything yet.`
              : `${resourceRefCount} ${resourceRefCount === 1 ? "entry points" : "entries point"} at “${pendingResourceTitle}”. They will need a new source before this Book can be published.`
          }
          cancelLabel="Keep it"
          confirmLabel="Delete"
          onCancel={() => setPendingResourceId(null)}
          onConfirm={() => {
            setPendingResourceId(null);
            edit?.removeResource(pendingResource.id);
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
      {/* The Book settings sheet (spec 0021-14 §3): everything that has no
          learner-visible spot on this page — icon, cover art, and Sources,
          which was the single largest block of form on the screen. */}
      {edit !== null && bookSettingsOpen && (
        <SettingsSheet
          title="Book settings"
          onDismiss={() => setBookSettingsOpen(false)}
        >
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
              could only ever silently fail is worse than not offering it —
              the same rationale the deleted form editor recorded. */}
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
          {/* Sources (spec 0021-8 §2a). On the Book, not the Unit trail:
              `resources` is a field of the Book, shared across every unit.
              Edit-only — a resource is never shown to a learner. */}
          <h3>Sources</h3>
          <p className="status">
            Where this Book&rsquo;s content comes from. Every word, concept and
            example points at one.
          </p>
          <ul className="editor-list">
            {edit.resources.map((resource) => (
              <li key={resource.id}>
                <label className="field">
                  Title
                  <input
                    type="text"
                    value={
                      typeof resource.title === "string" ? resource.title : ""
                    }
                    onChange={(e) =>
                      edit.patchResource({ ...resource, title: e.target.value })
                    }
                  />
                </label>
                <ProblemMarker
                  problems={edit.fieldProblems(resource.id, "title")}
                />
                <label className="field">
                  Link
                  <input
                    type="text"
                    value={
                      typeof resource.path === "string" ? resource.path : ""
                    }
                    onChange={(e) =>
                      edit.patchResource({ ...resource, path: e.target.value })
                    }
                  />
                </label>
                <ProblemMarker
                  problems={edit.fieldProblems(resource.id, "path")}
                />
                <ProblemMarker problems={edit.entityProblems(resource.id)} />
                <RowActions
                  onRemove={() => setPendingResourceId(resource.id)}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="editor-add"
            onClick={edit.addResource}
          >
            + source
          </button>
        </SettingsSheet>
      )}
      {/* One lesson's "Unlocks after" (spec 0021-14 §3): the only control the
          card's own `⚙` carries — not a whole Lesson settings sheet for one
          field, the card already carries everything else. */}
      {edit !== null &&
        (() => {
          const openLesson =
            openLessonSettingsId !== null
              ? lessonById.get(openLessonSettingsId)
              : undefined;
          if (openLesson === undefined) {
            return null;
          }
          const raw = edit.rawLesson(openLesson.id) ?? { id: openLesson.id };
          return (
            <SettingsSheet
              title={
                openLesson.title.trim() === "" ? "New lesson" : openLesson.title
              }
              onDismiss={() => setOpenLessonSettingsId(null)}
            >
              <EntityPicker
                label="Unlocks after"
                options={optionsFrom(
                  content.lessons.filter((l) => l.id !== openLesson.id),
                )}
                selected={
                  openLesson.unlocksAfterLessonId !== undefined
                    ? [openLesson.unlocksAfterLessonId]
                    : []
                }
                onChange={(ids) =>
                  edit.patchLesson(
                    withOptionalKey(raw, "unlocksAfterLessonId", ids[0]),
                  )
                }
                multiple={false}
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

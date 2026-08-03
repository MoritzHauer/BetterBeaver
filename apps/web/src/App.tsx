import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  BookDocument,
  Content,
  Item,
  Task,
  Unit,
} from "@betterbeaver/schema";
import { contentIdOf, documentId } from "@betterbeaver/schema";
import type {
  ContentSource,
  DomainContent,
  DomainSummary,
  ProgressStore,
  BookSummary,
} from "@betterbeaver/engine";
import type { AdhocMode } from "@betterbeaver/engine";
import {
  buildAdhocSession,
  buildRecallSession,
  buildReviewSession,
  buildTaskSession,
  buildUnitSession,
  dueDomainUnits,
  dueUnits,
  isLessonComplete,
  itemIdFromUnitId,
  nextUnit,
  noteUnitId,
  recordGrade,
  symmetricLinks,
} from "@betterbeaver/engine";
import type { Question } from "@betterbeaver/engine";
import type { Quality } from "@betterbeaver/srs";
import { recallQuality } from "@betterbeaver/srs";
import type { TapLookup } from "./components/TappableText";
import { NewBookSheet } from "./components/Sheet";
import type { ContentInit, ContentUpdate } from "./content/source";
import { SKIP_COVER_KEY } from "./content/source";
import { resolvedLinksByEntryId } from "./content/links";
import { readCachedDocuments } from "./content/cache";
import { readPrivateBooks } from "./content/private-store";
import { readArchived } from "./content/myBooks";
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { createLocalStorageVocabListStore } from "./progress/vocab-lists";
import { createLocalStorageUserEntryStore } from "./progress/user-entries";
import { getPinnedUnitIds, togglePinnedUnits } from "./progress/pinned-tasks";
import { AUTO_UPDATE_KEY } from "./autoUpdate";
import { isOffline } from "./offline";
import { useStorageUnwritable } from "./storage-health";
import { MyBooksScreen } from "./screens/MyBooksScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { BookScreen } from "./screens/BookScreen";
import { LessonScreen } from "./screens/LessonScreen";
import { UnitScreen } from "./screens/UnitScreen";
import { SessionScreen } from "./screens/SessionScreen";
import {
  ADHOC_MODE_LABELS,
  VocabularyScreen,
} from "./screens/VocabularyScreen";
import { ErrorScreen } from "./screens/ErrorScreen";
import { StartScreen } from "./screens/StartScreen";
import { AuthorScreen } from "./screens/AuthorScreen";
import { EditScreen, type EditTarget } from "./screens/EditScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { ImpressumScreen } from "./screens/ImpressumScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { LessonSummaryScreen } from "./screens/LessonSummaryScreen";
import {
  currentUser,
  getSupabase,
  listMyDocuments,
  loadCatalogEntry,
} from "./backend/supabase";
import {
  type AnyDoc,
  draftKey,
  proposalKey,
  type StoredProposal,
} from "./screens/edit/types";

type Screen =
  | { screen: "books" }
  | { screen: "book"; bookId: string }
  // The lesson level sits between book and unit (plan 0008).
  | { screen: "lesson"; bookId: string; lessonId: string }
  | {
      screen: "unit";
      bookId: string;
      lessonId: string;
      unitId: string;
      /** Open the trail on its last content page rather than the Overview —
       * set only by the practice session's back-swipe. */
      atEnd?: boolean;
    }
  | {
      screen: "task";
      bookId: string;
      lessonId: string;
      unitId: string;
      taskId: string;
    }
  // Pooled unit-level practice (plan 0010): one shuffled session across an
  // entire unit's task set, launched by UnitScreen's sticky Practice bar.
  | {
      screen: "unit-session";
      bookId: string;
      lessonId: string;
      unitId: string;
    }
  // Cross-unit recall session (plan 0016): practice-only over a sample of
  // the LINKED unit's tasks; onDone returns to the LINKING unit's Overview.
  | {
      screen: "recall-session";
      bookId: string;
      lessonId: string;
      unitId: string; // the linking unit, for onDone back-nav
      recallUnitId: string; // the linked unit whose tasks are sampled
    }
  // Lesson summary (plan 0020 §5): shown after the unit session that
  // completed the lesson. Derived tiles only — nothing is persisted for it.
  | { screen: "lesson-summary"; bookId: string; lessonId: string }
  // Review, Vocabulary, and ad-hoc study are domain-scoped (plan 0006): the
  // review queue, lists, and streak all key on the domain now, not the book.
  | { screen: "review"; domainId: string }
  | { screen: "vocab"; domainId: string }
  | { screen: "adhoc"; domainId: string; mode: AdhocMode; itemIds: string[] }
  // Library (plan 0015): browse the full catalog and Add a Book. Entered
  // from My Books; back returns there.
  | { screen: "library" }
  // Authoring (plan 0012 step 2): sign-in + document list, the editor, and
  // the static privacy note. Learner flows never route here.
  | { screen: "author" }
  // `target` deep-links into a level (lesson/unit/note); `back` returns to
  // the learner screen the Edit button was tapped on (default: author list).
  // `mode` (plan 0012 §5): "propose" for a non-maintainer suggesting edits.
  // Leave it unset and the edit branch derives it from `maintainedDocIds`;
  // set it only to pin a route (AuthorScreen's two lists, which already know
  // which list the row came from).
  // "private" (plan 0017 §3): the Book being viewed has no account behind
  // it at all — always pinned explicitly by the ✎ call sites, never left
  // for the maintainedDocIds fallback to guess at.
  | {
      screen: "edit";
      docId: string;
      target?: EditTarget;
      mode?: "maintain" | "propose" | "private";
      back?: Screen;
    }
  // The two legal pages (§ 5 DDG, Art. 13 GDPR), reached from the legal links
  // on the cover and the home screen. `back` returns to the sign-in form for
  // the one link that isn't the footer (AuthorScreen's "privacy note").
  | { screen: "privacy"; back?: Screen }
  | { screen: "impressum" }
  // Learner settings and stats (reached from the home top bar); both are
  // back-button screens over on-device state.
  | { screen: "settings" }
  | { screen: "stats" };

type ContentSourceResult = { source: ContentSource } | { errors: string[] };

const progressStore = createLocalStorageProgressStore();
const vocabListStore = createLocalStorageVocabListStore();
const userEntryStore = createLocalStorageUserEntryStore();

/** Resolves the author Edit button's `EditScreen` deep-link target for one
 * non-matching question's scheduling unit, shared by `TaskSession`,
 * `UnitSession`, and `ReviewSession`: a lexeme/concept item routes to the
 * domain's entry view; any other kind (sentence/pair) routes to its book's
 * item view via `bookIdForItem` — a fixed book id in `TaskSession`/
 * `UnitSession`, a per-item lookup in `ReviewSession` (which pools items
 * across every book of the domain). Returns `undefined` when no target can
 * be resolved (the item's book isn't known — shouldn't happen in practice);
 * callers then simply don't navigate. */
function itemEditTarget(
  itemId: string,
  itemKind: string | undefined,
  domainId: string,
  bookIdForItem: (itemId: string) => string | undefined,
): { docId: string; target: EditTarget } | undefined {
  if (itemKind === "lexeme" || itemKind === "concept") {
    return {
      docId: documentId("domain", domainId),
      target: { entryId: itemId },
    };
  }
  const bookId = bookIdForItem(itemId);
  if (bookId === undefined) {
    return undefined;
  }
  return { docId: documentId("topic", bookId), target: { itemId } };
}

/** Wires the engine's task-session building and grading to `SessionScreen`.
 * Questions are built once per mount (keyed by `task.id` via `useMemo`), so
 * they don't reshuffle across re-renders. An attempt is recorded only once
 * every question has been answered, matching the plan's completion rule. */
function TaskSession({
  content,
  lookup,
  task,
  canEdit,
  onOpenEdit,
  onDone,
}: {
  content: Content;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal
   * surfaces (SessionScreen's pinned rules). */
  lookup: TapLookup;
  task: Task;
  /** Whether this content is editable from here (plan 0012 for a signed-in
   * author, plan 0017 §3 for a private Book, which has no account behind it
   * at all); gates the session screen's Edit button. */
  canEdit: boolean;
  /** Opens `EditScreen` at the given deep-link target. */
  onOpenEdit: (docId: string, target: EditTarget) => void;
  onDone: () => void;
}) {
  const domainId = content.topic.domainId;
  const questions = useMemo(
    () => buildTaskSession(task, content, Math.random),
    // Keyed by taskId only: `content` is reloaded (new reference) on every
    // screen change, but the session must not reshuffle across re-renders.
    [task.id],
  );
  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(progressStore, unitId, quality, new Date(), domainId);
  }

  const onEdit = canEdit
    ? (index: number) => {
        const question = questions[index];
        if (question === undefined) {
          return;
        }
        if (question.kind === "matching") {
          onOpenEdit(documentId("topic", content.topic.id), {
            taskId: task.id,
          });
          return;
        }
        const itemId = itemIdFromUnitId(question.unitId);
        const kind = content.items.find((item) => item.id === itemId)?.kind;
        const resolved = itemEditTarget(
          itemId,
          kind,
          domainId,
          () => content.topic.id,
        );
        if (resolved !== undefined) {
          onOpenEdit(resolved.docId, resolved.target);
        }
      }
    : undefined;

  return (
    <SessionScreen
      title={task.instructions ?? `${task.type} practice`}
      questions={questions}
      bookId={content.topic.id}
      lookup={lookup}
      onEdit={onEdit}
      onGrade={handleGrade}
      onAllAnswered={() => void progressStore.markTaskAttempted(task.id)}
      onFinished={onDone}
      onExit={onDone}
      loadStreak={() => progressStore.getStreak(domainId)}
    />
  );
}

/** Wires the engine's pooled unit-practice session building to
 * `SessionScreen` (plan 0010): one shuffled session across every task in the
 * unit, tagged per-question so `SessionScreen` can render a pin control and
 * report `onTaskAnswered` granularly (rather than only at session-end, the
 * way `TaskSession`'s single-task `onAllAnswered` does). */
function UnitSession({
  content,
  unit,
  lookup,
  pinnedUnitIds,
  onTogglePin,
  canEdit,
  onOpenEdit,
  onDone,
  onSwipeBack,
  nextAction,
}: {
  content: Content;
  unit: Unit;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal
   * surfaces (SessionScreen's pinned rules). */
  lookup: TapLookup;
  pinnedUnitIds: ReadonlySet<string>;
  onTogglePin: (unitIds: string[]) => void;
  /** Whether this content is editable from here (plan 0012 for a signed-in
   * author, plan 0017 §3 for a private Book, which has no account behind it
   * at all); gates the session screen's Edit button. */
  canEdit: boolean;
  /** Opens `EditScreen` at the given deep-link target. */
  onOpenEdit: (docId: string, target: EditTarget) => void;
  onDone: () => void;
  /** Exit back to the unit's last content page (owner request); forwarded to
   * `SessionScreen`'s back-swipe. */
  onSwipeBack: () => void;
  /** Plan 0020 §4: forwarded straight through to `SessionScreen` — only the
   * caller (the `unit-session` branch) knows whether this unit finishes its
   * lesson. */
  nextAction?: { label: string; onClick: () => void };
}) {
  const domainId = content.topic.domainId;
  const pairs = useMemo(
    () => buildUnitSession(unit, content, Math.random),
    // Keyed by unit.id only, same reshuffle-guard rule as TaskSession.
    [unit.id],
  );
  const questions = useMemo(() => pairs.map((pair) => pair.question), [pairs]);
  const taskIds = useMemo(() => pairs.map((pair) => pair.taskId), [pairs]);

  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(progressStore, unitId, quality, new Date(), domainId);
  }

  const onEdit = canEdit
    ? (index: number) => {
        const question = questions[index];
        if (question === undefined) {
          return;
        }
        if (question.kind === "matching") {
          const taskId = taskIds[index];
          if (taskId === undefined) {
            return;
          }
          onOpenEdit(documentId("topic", content.topic.id), { taskId });
          return;
        }
        const itemId = itemIdFromUnitId(question.unitId);
        const kind = content.items.find((item) => item.id === itemId)?.kind;
        const resolved = itemEditTarget(
          itemId,
          kind,
          domainId,
          () => content.topic.id,
        );
        if (resolved !== undefined) {
          onOpenEdit(resolved.docId, resolved.target);
        }
      }
    : undefined;

  return (
    <SessionScreen
      title={unit.title}
      questions={questions}
      bookId={content.topic.id}
      lookup={lookup}
      taskIds={taskIds}
      pinnedUnitIds={pinnedUnitIds}
      onTogglePin={onTogglePin}
      onEdit={onEdit}
      onGrade={handleGrade}
      onTaskAnswered={(taskId) => void progressStore.markTaskAttempted(taskId)}
      onFinished={onDone}
      nextAction={nextAction}
      onExit={onDone}
      onSwipeBack={onSwipeBack}
      loadStreak={() => progressStore.getStreak(domainId)}
    />
  );
}

/** Wires the engine's practice-only cross-unit recall session (plan 0016) to
 * `SessionScreen`: a random sample of up to 5 of the LINKED unit's tasks.
 * Grading routes through the same `recordGrade` (due-gated, so a completed
 * unit isn't rescheduled); no `markTaskAttempted` — the linking unit's
 * completion must stay derived from its own taskIds, not this session. */
function RecallSession({
  content,
  linkedUnit,
  lookup,
  onDone,
}: {
  content: Content;
  linkedUnit: Unit;
  lookup: TapLookup;
  onDone: () => void;
}) {
  const domainId = content.topic.domainId;
  const pairs = useMemo(
    () => buildRecallSession(linkedUnit, content, Math.random),
    // Keyed by linkedUnit.id only, same reshuffle-guard as UnitSession.
    [linkedUnit.id],
  );
  const questions = useMemo(() => pairs.map((pair) => pair.question), [pairs]);

  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(progressStore, unitId, quality, new Date(), domainId);
  }

  return (
    <SessionScreen
      title={`Remember: ${linkedUnit.title}`}
      questions={questions}
      bookId={content.topic.id}
      lookup={lookup}
      onGrade={handleGrade}
      onFinished={onDone}
      onExit={onDone}
      loadStreak={() => progressStore.getStreak(domainId)}
    />
  );
}

/** Wires the engine's per-domain due-item queue and review-session building
 * to `SessionScreen` (plan 0006: re-scoped from per-book — the queue is the
 * union of every domain book's scheduling units plus unreferenced lexicon
 * entries). Grading goes through the same `recordGrade` as tasks; no attempt
 * is recorded (review isn't task completion). */
function ReviewSession({
  domainContent,
  booksContent,
  store,
  lookup,
  canEdit,
  onOpenEdit,
  onDone,
}: {
  domainContent: DomainContent;
  /** Every book belonging to the domain. */
  booksContent: Content[];
  store: ProgressStore;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal surfaces. */
  lookup: TapLookup;
  /** Whether this content is editable from here (plan 0012 for a signed-in
   * author, plan 0017 §3 for a private Book, which has no account behind it
   * at all); gates the session screen's Edit button. */
  canEdit: boolean;
  /** Opens `EditScreen` at the given deep-link target. */
  onOpenEdit: (docId: string, target: EditTarget) => void;
  onDone: () => void;
}) {
  const domainId = domainContent.domain.id;
  const [questions, setQuestions] = useState<ReturnType<
    typeof buildReviewSession
  > | null>(null);

  // Non-lexeme/concept item id -> the book it belongs to (Edit-button
  // routing): ReviewSession pools items across every book of the domain, so
  // (unlike TaskSession/UnitSession) a topic-owned item's book isn't known
  // without this lookup. Lexeme/concept items are skipped — they always
  // route to the domain doc, not a specific book, regardless of which book
  // referenced them (see `itemEditTarget`).
  const itemBookId = useMemo(() => {
    const map = new Map<string, string>();
    for (const bookContent of booksContent) {
      for (const item of bookContent.items) {
        if (item.kind !== "lexeme" && item.kind !== "concept") {
          map.set(item.id, bookContent.topic.id);
        }
      }
    }
    return map;
  }, [booksContent]);

  useEffect(() => {
    let cancelled = false;
    // Cannot reject: `dueDomainUnits` only ever awaits `readJson`-backed
    // reads, which degrade to absent rather than throwing (spec 0019 §1).
    void dueDomainUnits(
      booksContent,
      domainContent.entries,
      store,
      new Date(),
      getPinnedUnitIds(domainId),
    ).then((due) => {
      if (cancelled) {
        return;
      }
      // buildReviewSession's `content` parameter is unused by the engine
      // (every field it needs lives on the units themselves); any book
      // of the domain satisfies the type.
      const anyBookContent = booksContent[0];
      if (anyBookContent === undefined) {
        setQuestions([]);
        return;
      }
      setQuestions(buildReviewSession(due, anyBookContent, Math.random));
    });
    return () => {
      cancelled = true;
    };
  }, [domainContent, booksContent, store]);

  function handleGrade(unitId: string, quality: Quality) {
    return recordGrade(store, unitId, quality, new Date(), domainId).then(
      () => undefined,
    );
  }

  if (questions === null) {
    return <p>Loading&hellip;</p>;
  }

  if (questions.length === 0) {
    return (
      <main>
        <p className="empty-state">
          <img
            className="empty-state-icon"
            src={`${import.meta.env.BASE_URL}art/icons/beaver_sleeping_floating.png`}
            alt=""
          />
          Nothing due right now.
        </p>
        <button onClick={onDone}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          Back
        </button>
      </main>
    );
  }

  // Representative book for asset resolution (`SessionScreen`'s single
  // `bookId` prop): every bundled domain ships exactly one book today, so
  // this always resolves correctly. A future multi-book domain would need
  // per-question book resolution instead — out of scope for this step.
  const bookId = booksContent[0]?.topic.id ?? domainId;

  const onEdit = canEdit
    ? (index: number) => {
        const question: Question | undefined = questions[index];
        // Matching never occurs in ReviewSession (review questions are
        // single-unit only), so that branch doesn't apply here.
        if (question === undefined || question.kind === "matching") {
          return;
        }
        const itemId = itemIdFromUnitId(question.unitId);
        const kind = domainContent.entries.find(
          (entry) => entry.id === itemId,
        )?.kind;
        const resolved = itemEditTarget(itemId, kind, domainId, (id) =>
          itemBookId.get(id),
        );
        if (resolved !== undefined) {
          onOpenEdit(resolved.docId, resolved.target);
        }
      }
    : undefined;

  return (
    <SessionScreen
      title="Daily Review"
      questions={questions}
      bookId={bookId}
      lookup={lookup}
      onEdit={onEdit}
      onGrade={handleGrade}
      onFinished={onDone}
      onExit={onDone}
      loadStreak={() => store.getStreak(domainId)}
    />
  );
}

/** Wires the engine's ad-hoc vocabulary sessions (plan 0004; domain-scoped
 * by plan 0006) to `SessionScreen`. Grading goes through the same
 * `recordGrade` as tasks — per the plan's amendment, a stateless item gets
 * scheduled — and no task attempt is recorded (ad-hoc sessions never mark
 * unit completion). */
function AdhocSession({
  domainContent,
  bookId,
  mode,
  itemIds,
  lookup,
  onDone,
}: {
  domainContent: DomainContent;
  /** Representative book of the domain, for `SessionScreen`'s asset resolution. */
  bookId: string;
  mode: AdhocMode;
  itemIds: string[];
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal surfaces. */
  lookup: TapLookup;
  onDone: () => void;
}) {
  const domainId = domainContent.domain.id;
  const questions = useMemo(
    () => {
      // The domain's full lexicon (plan 0006), not one book's items — a
      // studied list may hold any entry of the domain.
      const itemById = new Map(
        domainContent.entries.map((item) => [item.id, item]),
      );
      const items = itemIds.flatMap((id): Item[] => {
        const item = itemById.get(id);
        return item !== undefined ? [item] : [];
      });
      // Re-based from the deleted `payload.synonyms` onto resolved
      // `synonym`-type links (plan 0006); the engine filters by type itself.
      const resolvedLinks = resolvedLinksByEntryId(domainContent);
      return buildAdhocSession(mode, items, Math.random, resolvedLinks);
    },
    // Keyed by the study selection only, so the session doesn't reshuffle
    // across re-renders (same rule as TaskSession).
    [mode, itemIds, domainContent],
  );
  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(progressStore, unitId, quality, new Date(), domainId);
  }

  return (
    <SessionScreen
      title={ADHOC_MODE_LABELS[mode]}
      questions={questions}
      bookId={bookId}
      readAloudLang={domainContent.domain.readAloudLang}
      lookup={lookup}
      onGrade={handleGrade}
      onFinished={onDone}
      onExit={onDone}
      loadStreak={() => progressStore.getStreak(domainId)}
    />
  );
}

export function App({ contentInit }: { contentInit: ContentInit }) {
  const contentSourceResult: ContentSourceResult = contentInit.result;

  // Opt-in content updates (plan 0012 §6): check in the background, show a
  // notice, change nothing until the user accepts. acceptUpdate reloads the
  // app on success, so `updating` never needs resetting on that path.
  const [update, setUpdate] = useState<ContentUpdate | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  // True from the first `localStorage` write that actually fails (spec 0019
  // §2) — not a boot-time probe. Read from a module-level flag rather than
  // held as state here, because `myBooks.ts` reports failures during
  // `initContentSource()`, before this component ever mounts.
  const storageWarning = useStorageUnwritable();
  async function acceptUpdateNow(target: ContentUpdate) {
    setUpdating(true);
    setUpdateError(null);
    try {
      await contentInit.acceptUpdate(target);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
      setUpdating(false);
    }
  }
  useEffect(() => {
    void contentInit.checkForUpdate().then((result) => {
      // Auto-update only covers an actual content download — an
      // app-shell-only reload still needs the user's say-so.
      if (
        result !== null &&
        result.changed.length > 0 &&
        localStorage.getItem(AUTO_UPDATE_KEY) === "on"
      ) {
        void acceptUpdateNow(result);
        return;
      }
      setUpdate(result);
    });
  }, [contentInit]);
  async function handleAcceptUpdate() {
    if (update === null) {
      return;
    }
    await acceptUpdateNow(update);
  }

  const [screen, setScreen] = useState<Screen>({ screen: "books" });
  // The ✎ Edit button *inside* a practice session opens the editor over the
  // running session instead of navigating to `screen: "edit"`: the session
  // subtree stays mounted (hidden — see `withSessionEdit`), so closing the
  // editor drops the author back on the very question they were on, with
  // the session's shuffle and answers intact. Navigating away and back
  // would rebuild it from question one, which is the opposite of "fix the
  // typo and carry on". `null` = no editor open over the session.
  const [sessionEdit, setSessionEdit] = useState<{
    docId: string;
    target: EditTarget;
    mode?: "maintain" | "propose" | "private";
  } | null>(null);
  // Any screen change ends the session the editor was layered over (the
  // book-load failure path below can force one on its own), so the overlay
  // must not survive it.
  useEffect(() => setSessionEdit(null), [screen]);
  // Holds whatever handler the currently rendered screen would run on its
  // own back button (null at the root, where back should exit normally).
  const backActionRef = useRef<(() => void) | null>(null);
  // Signed-in users get ✎ Edit buttons on the book/lesson/unit screens
  // (plan 0012). Which documents they actually maintain decides where those
  // buttons land: their own open in maintain mode, everything else in
  // propose mode (plan 0012 §5). RLS is still the real enforcement — this
  // only picks the editor the user sees instead of showing them a load
  // error. `null` means "not known yet, or the lookup failed", which falls
  // back to maintain mode, the behaviour before the proposal flow.
  const [isAuthor, setIsAuthor] = useState(false);
  const [maintainedDocIds, setMaintainedDocIds] = useState<Set<string> | null>(
    null,
  );
  useEffect(() => {
    if (getSupabase() === null) {
      return;
    }
    void currentUser().then((user) => {
      if (user === null) {
        return;
      }
      // `isAuthor` flips only once the lookup settles: it gates the ✎
      // buttons, and showing them while `maintainedDocIds` is still null
      // would route a non-maintainer to maintain mode for that window.
      void listMyDocuments()
        .then((docs) => setMaintainedDocIds(new Set(docs.map((doc) => doc.id))))
        .catch(() => setMaintainedDocIds(null))
        .finally(() => setIsAuthor(true));
    });
  }, []);
  // A private Book has no account behind it at all (plan 0017 §3), so its
  // ✎ Edit buttons must render regardless of `isAuthor`, routed to the
  // private editor rather than the maintain/propose fallback.
  function isPrivateBook(bookId: string): boolean {
    return contentInit.privateBookIds.has(bookId);
  }
  // ponytail: welcome cover shows on every load (plan 0009); persist a
  // "seen" flag if the extra tap ever annoys. The one exception is a reload
  // the app itself triggered from My Books (add/remove/archive/restore/
  // update): the cover would read as having lost the tap, so those set
  // `SKIP_COVER_KEY` first. Read in the initializer, cleared in an effect —
  // not in the initializer itself, which StrictMode double-invokes.
  // Both accesses are try/caught: a private-mode webview throws on
  // sessionStorage rather than no-opping, and a throw out of the initializer
  // would render nothing at all — the very failure this batch fixed.
  const [started, setStarted] = useState(() => {
    try {
      return sessionStorage.getItem(SKIP_COVER_KEY) !== null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem(SKIP_COVER_KEY);
    } catch {
      // Nothing was stored either, so nothing to clear.
    }
  }, []);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [content, setContent] = useState<Content | null>(null);
  // The active domain's content and every one of its books (plan 0006):
  // loaded for the review/vocab/adhoc screens, which are domain-scoped and
  // may have no single book in hand (reachable directly from the home
  // screen).
  const [domainContent, setDomainContent] = useState<DomainContent | null>(
    null,
  );
  const [domainBooksContent, setDomainBooksContent] = useState<Content[]>([]);
  // Every book's full content, keyed by book id (plan 0010): loaded
  // unconditionally once `books` is populated, so `MyBooksScreen` can show
  // per-book lesson-completion progress without extending the lightweight
  // `BookSummary`. Bundled content is already fully in memory, so loading
  // every book up front costs nothing (`bundled.ts`'s `loadBook` just wraps
  // an in-memory `Map`).
  const [booksContentMap, setBooksContentMap] = useState<Map<string, Content>>(
    new Map(),
  );
  // Raw (pre-validation) title/description/icon per cached Book, read
  // straight off IndexedDB (plan 0015): covers the two things `books`
  // (validated, added-only) can't — the Archive section's cards, and a
  // broken card's title when the doc is present but failed validation.
  // A book id absent here (e.g. cache lost) falls back to showing its id.
  const [cachedBookSummaries, setCachedBookSummaries] = useState<
    Map<string, { title: string; description: string; icon?: string }>
  >(new Map());
  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    let cancelled = false;
    // Cannot reject: `cache.ts`'s `readCachedDocuments` is try/catch -> `[]`,
    // documented "never to a crash" (spec 0019 §1).
    void readCachedDocuments().then((cached) => {
      if (cancelled) {
        return;
      }
      const map = new Map<
        string,
        { title: string; description: string; icon?: string }
      >();
      for (const record of cached) {
        if (record.kind !== "topic") {
          continue;
        }
        const bookId = contentIdOf(record.id);
        const topic = (record.doc as BookDocument).topic as {
          title?: unknown;
          description?: unknown;
          icon?: unknown;
        };
        map.set(bookId, {
          title: typeof topic.title === "string" ? topic.title : bookId,
          description:
            typeof topic.description === "string" ? topic.description : "",
          icon: typeof topic.icon === "string" ? topic.icon : undefined,
        });
      }
      // Private Books live in their own object store (plan 0017 §2), so
      // `readCachedDocuments` never sees them — without this an archived
      // private Book would vanish from the Archive section entirely, with
      // no way to Restore it even though its id is still in
      // `bb.mybooks.archived`.
      void readPrivateBooks().then((records) => {
        if (cancelled) {
          return;
        }
        for (const record of records) {
          const topic = record.book.topic as {
            title?: unknown;
            description?: unknown;
            icon?: unknown;
          };
          map.set(record.id, {
            title: typeof topic.title === "string" ? topic.title : record.id,
            description:
              typeof topic.description === "string" ? topic.description : "",
            icon: typeof topic.icon === "string" ? topic.icon : undefined,
          });
        }
        setCachedBookSummaries(new Map(map));
      });
      setCachedBookSummaries(map);
    });
    return () => {
      cancelled = true;
    };
  }, [contentSourceResult]);
  // Archived Books (plan 0015): excluded from the built source, so their
  // display info comes from the raw cache map above, keyed by the archived
  // id list — a book whose doc went missing from cache simply doesn't
  // appear (same "harmless" degrade as the rest of this file's cache reads).
  const archivedBooks = useMemo(
    () =>
      readArchived().flatMap((id) => {
        const summary = cachedBookSummaries.get(id);
        return summary !== undefined ? [{ id, ...summary }] : [];
      }),
    [cachedBookSummaries],
  );
  // Every Book id currently in My Books, added or archived — including
  // broken added Books, which `books` (listBooks(), validated) excludes.
  // Drives the Library screen's Add/Added state.
  const memberBookIds = useMemo(
    () =>
      new Set([
        ...books.map((book) => book.id),
        ...contentInit.broken.map((b) => b.bookId),
        ...archivedBooks.map((book) => book.id),
      ]),
    [books, archivedBooks],
  );
  // Book ids that failed to load *after* boot (spec 0019 §3a) — a stale
  // `books`/`domainBookIds` snapshot outliving the source instance it came
  // from (Add/Remove/accept-update swaps the source a commit before the
  // snapshot catches up). Distinct from `contentInit.broken`, which is the
  // boot-time set; merged into `brokenBooks` below so both render the same
  // "This Book can't be loaded" card.
  const [runtimeBrokenBookIds, setRuntimeBrokenBookIds] = useState<string[]>(
    [],
  );
  // Broken cards' titles, resolved from the same raw cache map (falls back
  // to the bare id when the doc is missing entirely — the common case, since
  // that's exactly what makes a Book broken via the "missing cached content"
  // path).
  const brokenBooks = useMemo(
    () => [
      ...contentInit.broken.map((b) => ({
        ...b,
        title: cachedBookSummaries.get(b.bookId)?.title ?? b.bookId,
      })),
      ...runtimeBrokenBookIds
        .filter((id) => !contentInit.broken.some((b) => b.bookId === id))
        .map((id) => ({
          bookId: id,
          errors: ["This Book could not be loaded."],
          title: cachedBookSummaries.get(id)?.title ?? id,
        })),
    ],
    [cachedBookSummaries, runtimeBrokenBookIds],
  );
  const [attemptedTaskIds, setAttemptedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  // Bumped on every navigation to the book screen, so it recomputes its
  // due-review count (which task/review sessions elsewhere may have changed).
  const [bookEpoch, setBookEpoch] = useState(0);
  // Bumped whenever the Vocabulary screen adds/deletes a learner-created
  // word (plan 0006), so the domain-content effect below re-merges the
  // user entry store's current contents without requiring a navigation.
  const [domainEpoch, setDomainEpoch] = useState(0);
  // Bumped whenever a task's pinned state is toggled (plan 0008), so
  // UnitSession re-reads the pin store without requiring a navigation.
  const [pinEpoch, setPinEpoch] = useState(0);
  // Whether the new-Book title sheet is open. Lives here, not in
  // MyBooksScreen, because `createPrivateBook` does — the screen only ever
  // asked for the title and handed it straight back.
  const [namingBook, setNamingBook] = useState(false);
  // The current book's domain's pinned scheduling-unit ids, re-read whenever
  // pinEpoch bumps (plan 0008); only ever consumed by UnitSession (plan
  // 0010: pin moved from UnitScreen's task list into the pooled practice
  // session), but computed here (not inside the screen-specific branch
  // below) since it's a hook.
  const pinnedUnitIds = useMemo(
    () =>
      content !== null
        ? getPinnedUnitIds(content.topic.domainId)
        : new Set<string>(),
    [content, pinEpoch],
  );

  function reloadAttemptedTaskIds() {
    // Cannot reject: `getAttemptedTaskIds` is `Promise.resolve(readJson(...))`
    // — a throw there would be synchronous, not a rejection.
    void progressStore
      .getAttemptedTaskIds()
      .then((ids) => setAttemptedTaskIds(new Set(ids)));
  }

  function goToBook(bookId: string) {
    setBookEpoch((epoch) => epoch + 1);
    setScreen({ screen: "book", bookId });
  }

  /** Which editor a document opens in when the route doesn't pin one (plan
   * 0012 §5): a document the signed-in user maintains is edited directly,
   * anything else goes in through a proposal. Resolved here rather than at
   * each call site so every route into the editor agrees. */
  function editModeFor(docId: string): "maintain" | "propose" {
    return maintainedDocIds?.has(docId) === false ? "propose" : "maintain";
  }

  /**
   * Settings → "Import book/domain…": stores each imported document under
   * the key the editor it will open actually reads, then opens the first.
   *
   * The import used to write `bb.author.draft.*` and pin maintain mode for
   * everyone, so a non-maintainer landed in `MaintainEditScreen`, whose
   * `loadDocument` is a `.single()` over a table RLS shows them no rows of
   * — surfacing as a bare "Cannot coerce the result to a single JSON
   * object". Routing through `editModeFor` is what makes "import a file and
   * submit it as a proposal" reachable at all.
   *
   * A proposal's working copy carries the published version it is based on
   * (`StoredProposal`), which the file cannot know — hence the catalog read
   * per proposed document. An unpublished or unlisted document has no base
   * to propose against; that throws back to the Settings error line.
   */
  async function importDocuments(
    entries: { id: string; doc: unknown }[],
  ): Promise<void> {
    for (const { id, doc } of entries) {
      if (editModeFor(id) === "maintain") {
        localStorage.setItem(draftKey(id), JSON.stringify(doc));
        continue;
      }
      const published = await loadCatalogEntry(id);
      if (published === null) {
        throw new Error(
          `${id} is not published yet — there is nothing to propose an edit against`,
        );
      }
      localStorage.setItem(
        proposalKey(id),
        JSON.stringify({
          baseVersion: published.published_version,
          // Unvalidated, exactly as the draft key above has always been:
          // the file got a shape check only, and `validateForPublish` runs
          // in the editor before anything leaves the device.
          doc: doc as AnyDoc,
        } satisfies StoredProposal),
      );
    }
    const first = entries[0];
    if (first !== undefined) {
      setScreen({
        screen: "edit",
        docId: first.id,
        mode: editModeFor(first.id),
        back: { screen: "settings" },
      });
    }
  }

  /** The added private Book that owns `docId` — either its own Book document
   * or the Domain it exclusively owns (plan 0017 decision 2) — if any.
   * Neither document exists on the server, so both have to be routed to the
   * private editor, which holds the pair. */
  function privateBookForDoc(docId: string): string | undefined {
    const id = contentIdOf(docId);
    if (isPrivateBook(id)) {
      return id;
    }
    const owner = books.find((book) => book.domainId === id);
    return owner !== undefined && isPrivateBook(owner.id)
      ? owner.id
      : undefined;
  }

  /** Opens the session ✎'s editor over the running session. The three
   * session wrappers resolve their own targets (a book item, a domain
   * entry, a whole task) but not which editor holds them — unlike the
   * book/lesson/unit ✎ buttons, they have no private-Book branch of their
   * own, so a private Book's target is re-pointed at its Book document
   * here. */
  function openSessionEdit(docId: string, target: EditTarget) {
    const privateBookId = privateBookForDoc(docId);
    setSessionEdit(
      privateBookId !== undefined
        ? { docId: documentId("topic", privateBookId), target, mode: "private" }
        : { docId, target },
    );
  }

  /** Re-runs the update check after the author publishes. The learner-facing
   * content source is built from the document cache at boot and only a
   * reload swaps it (`content/source.ts`), so a just-published edit does not
   * appear in the running session — this is what turns it into an update
   * offer on My Books rather than leaving the author to wonder why their
   * text didn't change. Deliberately never auto-accepts, even with
   * auto-update on: accepting reloads the page, and the author is
   * mid-session. */
  function recheckForUpdate(): void {
    // Cannot reject: `checkForUpdate` catches its own fetch failures.
    void contentInit.checkForUpdate().then(setUpdate);
  }

  /** Renders a session with the ✎ editor layered over it while one is open.
   * The session is hidden, NOT unmounted — that is the whole point (see
   * `sessionEdit`): React keeps its state, so closing the editor resumes
   * exactly where the author left off. */
  function withSessionEdit(session: ReactElement): ReactElement {
    const close = () => setSessionEdit(null);
    if (sessionEdit !== null) {
      // Hardware back closes the editor and leaves the session running,
      // rather than exiting the session underneath it.
      backActionRef.current = close;
    }
    // The wrapper is unconditional, and so is the session's position inside
    // it: returning the bare session while no editor is open would put a
    // different element type at this position, and React would unmount and
    // rebuild the session on every open and close — the exact thing this
    // whole arrangement exists to avoid.
    return (
      <>
        <div hidden={sessionEdit !== null}>{session}</div>
        {sessionEdit !== null && (
          <EditScreen
            docId={sessionEdit.docId}
            target={sessionEdit.target}
            mode={sessionEdit.mode ?? editModeFor(sessionEdit.docId)}
            onBack={close}
            onPublished={() => {
              close();
              recheckForUpdate();
            }}
          />
        )}
      </>
    );
  }

  // Play (plan 0020 §2): due > 0 → Daily Review, else the next incomplete
  // unit, else nothing to do (the Book is finished — land on BookScreen,
  // which renders the trophy state). No stored "first tap today" flag: due
  // dates are day-granular UTC, so finishing today's review empties the
  // queue and every later tap lands on a unit.
  async function playBook(bookId: string): Promise<void> {
    const bookContent = booksContentMap.get(bookId);
    if (bookContent === undefined) {
      goToBook(bookId);
      return;
    }
    // Book-scoped, matching BookScreen's own badge call (which likewise
    // omits the pinned set) — keep the two identical.
    const due = await dueUnits(bookContent, progressStore, new Date());
    if (due.length > 0) {
      setScreen({ screen: "review", domainId: bookContent.topic.domainId });
      return;
    }
    const next = nextUnit(bookContent, attemptedTaskIds);
    if (next !== null) {
      setScreen({
        screen: "unit",
        bookId,
        lessonId: next.lessonId,
        unitId: next.unitId,
      });
    } else {
      goToBook(bookId);
    }
  }

  // Mobile back button / edge-swipe fix: without any history.pushState calls
  // the browser has nothing to pop, so a hardware/gesture back exits the app
  // entirely instead of moving up a level. `backActionRef` always holds the
  // same handler as the currently rendered screen's visible back (or
  // done/cancel) button; a single trap entry, refilled after every pop,
  // routes hardware back through it. At the root screen the ref is null, so
  // the pop is left alone and back behaves like a normal exit.
  useEffect(() => {
    window.history.pushState({ backTrap: true }, "");
    function onPopState() {
      const goBack = backActionRef.current;
      if (goBack !== null) {
        goBack();
        window.history.pushState({ backTrap: true }, "");
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Re-arms the trap after every commit, because the handler above doesn't
  // refill the one pop it lets through: at the root the ref is null, so that
  // pop consumes the trap entry and nothing replaces it. Navigating back into
  // the app afterwards then left the app with nothing to pop, and the next
  // hardware back walked off the app's own history entry — the reported
  // "back lands on a blank page and you have to restart". Guarded on the ref
  // so the root screen keeps its exit-the-app pop: no back action, no trap.
  useEffect(() => {
    if (
      backActionRef.current !== null &&
      (window.history.state as { backTrap?: boolean } | null)?.backTrap !== true
    ) {
      window.history.pushState({ backTrap: true }, "");
    }
  });

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    // Cannot reject: both are `Promise.resolve` over an in-memory Map.
    void contentSourceResult.source.listBooks().then(setBooks);
    void contentSourceResult.source.listDomains().then(setDomains);
    reloadAttemptedTaskIds();
  }, [contentSourceResult]);

  // `loadBook` rejects for an id the source doesn't know — reachable when a
  // `books`/`domainBookIds` snapshot outlives the source instance it came
  // from (Add/Remove/accept-update swaps the source a commit before the
  // snapshot catches up, spec 0019 §3a). One stale id must not take the
  // whole `Promise.all` down, so each load resolves to `undefined` and the
  // id joins the broken-card list instead.
  function loadBookOrBroken(
    source: ContentSource,
    id: string,
  ): Promise<Content | undefined> {
    return source.loadBook(id).catch(() => {
      setRuntimeBrokenBookIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      return undefined;
    });
  }

  // Loads every book's full content once `books` is populated (plan 0010),
  // for MyBooksScreen's per-book progress bars — unconditional, not gated
  // on the active screen.
  useEffect(() => {
    if (!("source" in contentSourceResult) || books.length === 0) {
      return;
    }
    let cancelled = false;
    // `void`: each load catches per book (`loadBookOrBroken`), so this
    // `Promise.all` cannot reject.
    void Promise.all(
      books.map((book) =>
        loadBookOrBroken(contentSourceResult.source, book.id),
      ),
    ).then((loaded) => {
      if (cancelled) {
        return;
      }
      setBooksContentMap(
        new Map(
          loaded
            .filter(
              (bookContent): bookContent is Content =>
                bookContent !== undefined,
            )
            .map((bookContent) => [bookContent.topic.id, bookContent]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [contentSourceResult, books]);

  // Per-book lesson-completion counts (plan 0010), derived from
  // `booksContentMap` + `attemptedTaskIds` via the same `isLessonComplete`
  // BookScreen already uses.
  const bookProgress = useMemo(() => {
    const result = new Map<string, { completed: number; total: number }>();
    for (const [bookId, bookContent] of booksContentMap) {
      const completed = bookContent.topic.lessonIds.filter((lessonId) => {
        const lesson = bookContent.lessons.find((l) => l.id === lessonId);
        return (
          lesson !== undefined &&
          isLessonComplete(lesson, bookContent.units, attemptedTaskIds)
        );
      }).length;
      result.set(bookId, {
        completed,
        total: bookContent.topic.lessonIds.length,
      });
    }
    return result;
  }, [booksContentMap, attemptedTaskIds]);

  // Loads the active screen's book content and its domain content together
  // (plan 0013 goal 1): both resolve via one `Promise.all(...).then(...)`
  // callback so `setContent`, `setDomainContent`, and `setDomainBooksContent`
  // land in the same React commit instead of two separate ones.
  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    const isBookFamilyScreen =
      screen.screen === "book" ||
      screen.screen === "lesson" ||
      screen.screen === "unit" ||
      screen.screen === "task" ||
      screen.screen === "unit-session" ||
      screen.screen === "recall-session" ||
      screen.screen === "lesson-summary";
    const contentPromise = isBookFamilyScreen
      ? loadBookOrBroken(contentSourceResult.source, screen.bookId)
      : undefined;

    // Domain-scoped screens carry their domainId directly; book/unit/task
    // screens derive it from the already-loaded book summaries (plan
    // 0006's tap-to-lookup, step 4: those screens need the domain's merged
    // entry pool too, for notes and post-answer session reveals).
    const domainId =
      screen.screen === "review" ||
      screen.screen === "vocab" ||
      screen.screen === "adhoc"
        ? screen.domainId
        : isBookFamilyScreen
          ? books.find((book) => book.id === screen.bookId)?.domainId
          : undefined;
    const domainBookIds =
      domainId === undefined
        ? []
        : books
            .filter((book) => book.domainId === domainId)
            .map((book) => book.id);
    const domainPromise =
      domainId === undefined
        ? undefined
        : Promise.all([
            contentSourceResult.source.loadDomain(domainId),
            Promise.all(
              domainBookIds.map((id) =>
                loadBookOrBroken(contentSourceResult.source, id),
              ),
            ),
            userEntryStore.getEntries(domainId),
          ]);

    if (contentPromise === undefined && domainPromise === undefined) {
      return;
    }
    let cancelled = false;
    // `void`: each load catches per book (`loadBookOrBroken`), so this
    // `Promise.all` cannot reject.
    void Promise.all([contentPromise, domainPromise]).then(
      ([loadedContent, loadedDomain]) => {
        if (cancelled) {
          return;
        }
        if (loadedContent !== undefined) {
          setContent(loadedContent);
        } else if (isBookFamilyScreen) {
          // The active book failed to load (stale snapshot, spec 0019 §3a):
          // `content` would otherwise stay whatever it was (or `null`, which
          // renders a permanent "Loading…" on book-family screens) — send
          // the learner back to the books list, where the broken card for
          // this id now shows via `runtimeBrokenBookIds`.
          setScreen({ screen: "books" });
        }
        if (loadedDomain !== undefined) {
          const [loadedDomainContent, loadedBooksContent, userEntries] =
            loadedDomain;
          // Merge the domain's user-created entries into the shipped pool
          // (plan 0006): every downstream consumer (Vocabulary screen,
          // ad-hoc session builder, list pruning, review queue, TTS
          // fallback) only ever sees this merged `DomainContent`, so they
          // all pick up user words for free. Links are re-derived over the
          // merged set too, so a link authored from a user entry to a
          // shipped one resolves correctly.
          const entries = [...loadedDomainContent.entries, ...userEntries];
          setDomainContent({
            ...loadedDomainContent,
            entries,
            linksByEntryId: symmetricLinks(entries),
          });
          setDomainBooksContent(
            loadedBooksContent.filter(
              (bookContent): bookContent is Content =>
                bookContent !== undefined,
            ),
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [contentSourceResult, screen, books, domainEpoch]);

  if ("errors" in contentSourceResult) {
    return <ErrorScreen errors={contentSourceResult.errors} />;
  }

  // Above the cover check on purpose: the legal links live on the cover too,
  // and `started` stays false while they are open — so Back lands the visitor
  // right back on the cover, and a started user back on home.
  if (screen.screen === "impressum") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return <ImpressumScreen onBack={onBack} />;
  }
  if (screen.screen === "privacy") {
    const back = screen.back ?? { screen: "books" as const };
    const onBack = () => setScreen(back);
    backActionRef.current = onBack;
    return <PrivacyScreen onBack={onBack} />;
  }

  if (!started) {
    backActionRef.current = null;
    return (
      <StartScreen
        onStart={() => setStarted(true)}
        onImpressum={() => setScreen({ screen: "impressum" })}
        onPrivacy={() => setScreen({ screen: "privacy" })}
      />
    );
  }

  if (screen.screen === "author") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <AuthorScreen
        // The naming sheet lives on the home screen (it is where the new
        // Book then appears), so this hops back there and opens it.
        onCreateBook={() => {
          setScreen({ screen: "books" });
          setNamingBook(true);
        }}
        onOpenDocument={(docId, mode) =>
          setScreen({ screen: "edit", docId, mode })
        }
        // Pinned back: the note is read from the sign-in form, and losing a
        // half-typed email to a Back tap would be its own little betrayal.
        onPrivacy={() =>
          setScreen({ screen: "privacy", back: { screen: "author" } })
        }
        onBack={onBack}
      />
    );
  }
  if (screen.screen === "edit") {
    const back = screen.back ?? { screen: "author" as const };
    const onBack = () => setScreen(back);
    backActionRef.current = onBack;
    return (
      <EditScreen
        docId={screen.docId}
        target={screen.target}
        // An explicit `mode` still wins; otherwise `editModeFor` decides,
        // the same way every other route into the editor does.
        mode={screen.mode ?? editModeFor(screen.docId)}
        onBack={onBack}
        // Only for the routes that pin a `back` — every learner ✎ button
        // and the settings import. Publishing ends that errand, so the
        // editor closes itself and hands the user back where they came
        // from. Entered from the authoring area instead (no `back`), it
        // stays open: that is a workspace, and its publish confirmation is
        // the feedback there.
        onPublished={
          screen.back !== undefined
            ? () => {
                onBack();
                recheckForUpdate();
              }
            : undefined
        }
      />
    );
  }
  if (screen.screen === "settings") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <SettingsScreen
        onBack={onBack}
        onSignIn={() => setScreen({ screen: "author" })}
        onImportBook={importDocuments}
        importPrivateBook={contentInit.importPrivateBook}
      />
    );
  }

  if (screen.screen === "stats") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return <StatsScreen onBack={onBack} domains={domains} />;
  }

  if (screen.screen === "books") {
    backActionRef.current = () => setStarted(false);
    const hasDownload = update !== null && update.changed.length > 0;
    return (
      <>
        {/* Spec 0019 §2: appears the first time a progress write actually
            fails, reusing the update banner's slot/class/role rather than a
            new component — stays up for the rest of the session. */}
        {storageWarning && (
          <div className="update-banner" role="status">
            <span>
              Your progress can't be saved — this browser's storage is full or
              unavailable. You can keep studying, but results won't be
              remembered.
            </span>
          </div>
        )}
        {/* `isOffline()` re-checked at render, not just when the update was
            found: turning offline mode on afterwards must retract the banner,
            since accepting it would only fail at the first fetch. */}
        {update !== null && !isOffline() && (
          <div className="update-banner" role="status">
            <span>
              {hasDownload
                ? "A content update is available."
                : "Update the app (reload the page) to receive the newest content."}
              {updateError !== null && (
                <>
                  {" "}
                  <strong>{updateError}</strong>
                </>
              )}
            </span>
            {hasDownload && (
              <button
                className="primary"
                disabled={updating}
                onClick={() => void handleAcceptUpdate()}
              >
                {updating ? "Updating…" : "Update now"}
              </button>
            )}
            <button className="plain" onClick={() => setUpdate(null)}>
              Later
            </button>
          </div>
        )}
        <MyBooksScreen
          books={books}
          bookProgress={bookProgress}
          broken={brokenBooks}
          archivedBooks={archivedBooks}
          privateBookIds={contentInit.privateBookIds}
          onSelectBook={(bookId) => goToBook(bookId)}
          onVocabulary={(domainId) => setScreen({ screen: "vocab", domainId })}
          onReview={(domainId) => setScreen({ screen: "review", domainId })}
          // Cannot reject: `playBook` only awaits `dueUnits`, whose reads are
          // `readJson`-backed and degrade to absent (spec 0019 §1).
          onPlay={(bookId) => void playBook(bookId)}
          onArchive={contentInit.archiveBook}
          onRestore={contentInit.restoreBook}
          onRemove={contentInit.removeBook}
          onEdit={(bookId) =>
            setScreen({
              screen: "edit",
              docId: documentId("topic", bookId),
              mode: "private",
              back: { screen: "books" },
            })
          }
          onLibrary={
            getSupabase() !== null
              ? () => setScreen({ screen: "library" })
              : undefined
          }
          onAuthor={() => setScreen({ screen: "author" })}
          onOpenStats={() => setScreen({ screen: "stats" })}
          onOpenSettings={() => setScreen({ screen: "settings" })}
          onImpressum={() => setScreen({ screen: "impressum" })}
          onPrivacy={() => setScreen({ screen: "privacy" })}
        />
        {namingBook && (
          <NewBookSheet
            onCancel={() => setNamingBook(false)}
            onCreate={(title) => {
              setNamingBook(false);
              // Already trimmed and non-blank: the sheet's Create button is
              // disabled until it is.
              void contentInit.createPrivateBook(title);
            }}
          />
        )}
      </>
    );
  }

  if (screen.screen === "library") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <LibraryScreen
        addBook={contentInit.addBook}
        memberBookIds={memberBookIds}
        onBack={onBack}
      />
    );
  }

  if (
    screen.screen === "book" ||
    screen.screen === "lesson" ||
    screen.screen === "unit" ||
    screen.screen === "task" ||
    screen.screen === "unit-session" ||
    screen.screen === "recall-session" ||
    screen.screen === "lesson-summary"
  ) {
    // domainContent is gated here too (not just content): unit notes and
    // task-session post-answer reveals need the domain's merged entry pool
    // for tap-to-lookup (plan 0006 step 4).
    if (content === null || domainContent === null) {
      return <p>Loading&hellip;</p>;
    }
    const lookup: TapLookup = {
      domainContent,
      listStore: vocabListStore,
      userEntryStore,
      onWordsChanged: () => setDomainEpoch((epoch) => epoch + 1),
    };

    if (screen.screen === "book") {
      const onBack = () => setScreen({ screen: "books" });
      backActionRef.current = onBack;
      return (
        <BookScreen
          content={content}
          attemptedTaskIds={attemptedTaskIds}
          store={progressStore}
          epoch={bookEpoch}
          onSelectLesson={(lessonId) =>
            setScreen({ screen: "lesson", bookId: screen.bookId, lessonId })
          }
          onPracticeTask={(target) =>
            setScreen({
              screen: "task",
              bookId: screen.bookId,
              ...target,
            })
          }
          onReview={() =>
            setScreen({ screen: "review", domainId: content.topic.domainId })
          }
          onVocabulary={() =>
            setScreen({ screen: "vocab", domainId: content.topic.domainId })
          }
          // Cannot reject — see the My Books call site.
          onPlay={() => void playBook(screen.bookId)}
          onEdit={
            isAuthor || isPrivateBook(screen.bookId)
              ? () =>
                  setScreen({
                    screen: "edit",
                    docId: documentId("topic", screen.bookId),
                    mode: isPrivateBook(screen.bookId) ? "private" : undefined,
                    back: screen,
                  })
              : undefined
          }
          onBack={onBack}
        />
      );
    }

    if (screen.screen === "lesson") {
      const onBack = () => goToBook(screen.bookId);
      backActionRef.current = onBack;
      return (
        <LessonScreen
          content={content}
          lessonId={screen.lessonId}
          attemptedTaskIds={attemptedTaskIds}
          onSelectUnit={(unitId) =>
            setScreen({
              screen: "unit",
              bookId: screen.bookId,
              lessonId: screen.lessonId,
              unitId,
            })
          }
          onPracticeTask={(target) =>
            setScreen({
              screen: "task",
              bookId: screen.bookId,
              ...target,
            })
          }
          onEdit={
            isAuthor || isPrivateBook(screen.bookId)
              ? () =>
                  setScreen({
                    screen: "edit",
                    docId: documentId("topic", screen.bookId),
                    target: { lessonId: screen.lessonId },
                    mode: isPrivateBook(screen.bookId) ? "private" : undefined,
                    back: screen,
                  })
              : undefined
          }
          onBack={onBack}
        />
      );
    }

    if (screen.screen === "unit") {
      const onBack = () =>
        setScreen({
          screen: "lesson",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
        });
      backActionRef.current = onBack;
      return (
        <UnitScreen
          content={content}
          unitId={screen.unitId}
          lookup={lookup}
          onPractice={() =>
            setScreen({
              screen: "unit-session",
              bookId: screen.bookId,
              lessonId: screen.lessonId,
              unitId: screen.unitId,
            })
          }
          onRecall={(recallUnitId) =>
            setScreen({
              screen: "recall-session",
              bookId: screen.bookId,
              lessonId: screen.lessonId,
              unitId: screen.unitId,
              recallUnitId,
            })
          }
          onPinNote={(noteId) => {
            // Pinning = the note's first grade ("again" → due right away),
            // which is what enters it into the review queue.
            void recordGrade(
              progressStore,
              noteUnitId(noteId),
              recallQuality("again"),
              new Date(),
              content.topic.domainId,
            );
          }}
          isNotePinned={(noteId) =>
            progressStore
              .getItemState(noteUnitId(noteId))
              .then((state) => state !== null)
          }
          onEdit={
            isAuthor || isPrivateBook(screen.bookId)
              ? (target) =>
                  setScreen({
                    screen: "edit",
                    docId: documentId("topic", screen.bookId),
                    target: {
                      lessonId: screen.lessonId,
                      unitId: screen.unitId,
                      ...target,
                    },
                    mode: isPrivateBook(screen.bookId) ? "private" : undefined,
                    back: screen,
                  })
              : undefined
          }
          onBack={onBack}
          startAtEnd={screen.atEnd}
        />
      );
    }

    if (screen.screen === "unit-session") {
      const unit = content.units.find((u) => u.id === screen.unitId);
      if (unit === undefined) {
        return (
          <main>
            <p>Unknown unit: {screen.unitId}</p>
          </main>
        );
      }
      const onDone = () => {
        reloadAttemptedTaskIds();
        setScreen({
          screen: "unit",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
          unitId: screen.unitId,
        });
      };
      backActionRef.current = onDone;
      // Same exit as `onDone`, but lands on the trail's last content page —
      // the one the learner swiped forward from (owner request).
      const onSwipeBack = () => {
        reloadAttemptedTaskIds();
        setScreen({
          screen: "unit",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
          unitId: screen.unitId,
          atEnd: true,
        });
      };
      const lesson = content.lessons.find((l) => l.id === screen.lessonId);
      // Plan 0020 §4: does finishing THIS unit finish the lesson? Every
      // OTHER unit's completion is already accurate in `attemptedTaskIds`
      // (state) — this session only ever marks this unit's own tasks — so
      // unioning this unit's taskIds in lets the existing isLessonComplete
      // answer synchronously, before the summary even renders. No store
      // read needed for the label; `onNext` below still does its own read
      // for the actual navigation.
      // ponytail: assumes every task in `unit` yields >=1 question, so the
      // session's onTaskAnswered really does cover all of unit.taskIds by
      // the time the summary shows. A unit with a zero-question task would
      // never satisfy isUnitComplete via this flow at all — same ceiling
      // `onNext`'s fresh read hits, not one this label computation adds.
      const finishesLesson =
        lesson !== undefined &&
        isLessonComplete(
          lesson,
          content.units,
          new Set([...attemptedTaskIds, ...unit.taskIds]),
        );
      // Plan 0020 §4: resolve the next step from the POST-session attempted
      // set. `attemptedTaskIds` (state) is stale here by exactly this
      // session's own markTaskAttempted calls, and reloadAttemptedTaskIds()
      // can't be awaited (fire-and-forget) — read the store directly.
      const onNext = async () => {
        const ids = new Set(await progressStore.getAttemptedTaskIds());
        setAttemptedTaskIds(ids);
        if (
          lesson !== undefined &&
          isLessonComplete(lesson, content.units, ids)
        ) {
          setScreen({
            screen: "lesson-summary",
            bookId: screen.bookId,
            lessonId: screen.lessonId,
          });
          return;
        }
        // Two branches, and they're total (plan 0020 §4): an incomplete
        // lesson always contains an incomplete unit, so `next` is null here
        // only defensively.
        const next = nextUnit(content, ids);
        // Never send the learner back into the unit they just finished. That
        // happens when `finishesLesson` (optimistic, computed from
        // attemptedTaskIds ∪ unit.taskIds) and this fresh read disagree —
        // a task that yields zero questions never gets marked attempted, and
        // a blocked-storage write is swallowed by design (spec 0019). The
        // button then reads "Lesson complete" and the tap would land right
        // back where it started, with no explanation. The lesson screen is
        // the honest destination: it shows which unit is still open.
        if (next === null || next.unitId === screen.unitId) {
          setScreen({
            screen: "lesson",
            bookId: screen.bookId,
            lessonId: screen.lessonId,
          });
          return;
        }
        setScreen({
          screen: "unit",
          bookId: screen.bookId,
          lessonId: next.lessonId,
          unitId: next.unitId,
        });
      };
      return withSessionEdit(
        <UnitSession
          content={content}
          unit={unit}
          lookup={lookup}
          pinnedUnitIds={pinnedUnitIds}
          onTogglePin={(unitIds) => {
            togglePinnedUnits(content.topic.domainId, unitIds);
            setPinEpoch((epoch) => epoch + 1);
          }}
          canEdit={isAuthor || isPrivateBook(screen.bookId)}
          onOpenEdit={openSessionEdit}
          onDone={onDone}
          onSwipeBack={onSwipeBack}
          nextAction={{
            label: finishesLesson ? "Lesson complete" : "Next unit",
            onClick: () => void onNext(),
          }}
        />,
      );
    }

    if (screen.screen === "lesson-summary") {
      const onBack = () => goToBook(screen.bookId);
      backActionRef.current = onBack;
      return (
        <LessonSummaryScreen
          content={content}
          lessonId={screen.lessonId}
          attemptedTaskIds={attemptedTaskIds}
          store={progressStore}
          onNext={(target) =>
            setScreen({
              screen: "unit",
              bookId: screen.bookId,
              lessonId: target.lessonId,
              unitId: target.unitId,
            })
          }
          onBack={onBack}
        />
      );
    }

    if (screen.screen === "recall-session") {
      const linkedUnit = content.units.find(
        (u) => u.id === screen.recallUnitId,
      );
      if (linkedUnit === undefined) {
        return (
          <main>
            <p>Unknown unit: {screen.recallUnitId}</p>
          </main>
        );
      }
      const onDone = () =>
        setScreen({
          screen: "unit",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
          unitId: screen.unitId,
        });
      backActionRef.current = onDone;
      return (
        <RecallSession
          content={content}
          linkedUnit={linkedUnit}
          lookup={lookup}
          onDone={onDone}
        />
      );
    }

    // screen.screen === "task"
    const task = content.tasks.find((t) => t.id === screen.taskId);
    if (task === undefined) {
      return (
        <main>
          <p>Unknown task: {screen.taskId}</p>
        </main>
      );
    }
    const onTaskDone = () => {
      reloadAttemptedTaskIds();
      setScreen({
        screen: "unit",
        bookId: screen.bookId,
        lessonId: screen.lessonId,
        unitId: screen.unitId,
      });
    };
    backActionRef.current = onTaskDone;
    return withSessionEdit(
      <TaskSession
        content={content}
        lookup={lookup}
        task={task}
        canEdit={isAuthor || isPrivateBook(screen.bookId)}
        onOpenEdit={openSessionEdit}
        onDone={onTaskDone}
      />,
    );
  }

  // screen.screen is "review" | "vocab" | "adhoc" — all domain-scoped.
  if (domainContent === null || domainBooksContent.length === 0) {
    return <p>Loading&hellip;</p>;
  }
  const lookup: TapLookup = {
    domainContent,
    listStore: vocabListStore,
    userEntryStore,
    onWordsChanged: () => setDomainEpoch((epoch) => epoch + 1),
  };

  if (screen.screen === "vocab") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <VocabularyScreen
        booksContent={domainBooksContent}
        domainContent={domainContent}
        listStore={vocabListStore}
        userEntryStore={userEntryStore}
        onWordsChanged={() => setDomainEpoch((epoch) => epoch + 1)}
        onStudy={(mode, itemIds) =>
          setScreen({
            screen: "adhoc",
            domainId: screen.domainId,
            mode,
            itemIds,
          })
        }
        onBack={onBack}
      />
    );
  }

  if (screen.screen === "adhoc") {
    const bookId = domainBooksContent[0]?.topic.id ?? screen.domainId;
    const onDone = () =>
      setScreen({ screen: "vocab", domainId: screen.domainId });
    backActionRef.current = onDone;
    return (
      <AdhocSession
        domainContent={domainContent}
        bookId={bookId}
        mode={screen.mode}
        itemIds={screen.itemIds}
        lookup={lookup}
        onDone={onDone}
      />
    );
  }

  const onReviewDone = () => setScreen({ screen: "books" });
  backActionRef.current = onReviewDone;
  return withSessionEdit(
    <ReviewSession
      domainContent={domainContent}
      booksContent={domainBooksContent}
      store={progressStore}
      lookup={lookup}
      // A private Book owns its Domain exclusively (plan 0017 decision 2),
      // so a review over that Domain pools only that Book's items — the ✎
      // is ungated for it exactly as it is on the Book/Lesson/Unit screens.
      canEdit={
        isAuthor ||
        domainBooksContent.some((bookContent) =>
          isPrivateBook(bookContent.topic.id),
        )
      }
      onOpenEdit={openSessionEdit}
      onDone={onReviewDone}
    />,
  );
}

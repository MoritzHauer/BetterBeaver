import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  BookDocument,
  Content,
  DomainDocument,
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
  skipItem,
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
import { newEntityId } from "./content/entity-ids";
import { newPrivateId } from "./content/private-ids";
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { createLocalStorageVocabListStore } from "./progress/vocab-lists";
import { createLocalStorageUserEntryStore } from "./progress/user-entries";
import { getPinnedUnitIds, togglePinnedUnits } from "./progress/pinned-tasks";
import { AUTO_UPDATE_KEY } from "./autoUpdate";
import { schedulingConfig } from "./learning";
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
import type { EditTarget } from "./screens/edit/types";
import { SessionEditSheet } from "./screens/edit/SessionEditSheet";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { ImpressumScreen } from "./screens/ImpressumScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { armBackTrap, trapDepth } from "./back-trap";
import { recordNav } from "./nav-diary";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { LessonSummaryScreen } from "./screens/LessonSummaryScreen";
import {
  createBookDocuments,
  currentUser,
  getSupabase,
  listMyDocuments,
  loadCatalogEntry,
} from "./backend/supabase";
import {
  type AnyDoc,
  draftKey,
  hasUnpublishedChanges,
  proposalKey,
  type StoredProposal,
} from "./screens/edit/types";
import { EditSession, useEditSessionState } from "./screens/edit/EditSession";
import type { EditMode } from "./screens/edit/EditSessionContext";
import {
  bookScopeChanged,
  lessonScopeChanged,
  unitScopeChanged,
} from "./screens/edit/diffView";

// Edit mode is a flag on the three learner routes, not a screen of its own
// (plan 0021 §8): `✎` sets `editing` on the screen you are already reading,
// and navigating book → lesson → unit carries it through. That is the whole
// point — entering edit mode never moves you, and neither does moving while
// in it.
type Screen =
  | { screen: "books" }
  | {
      screen: "book";
      bookId: string;
      editing?: boolean;
      /** Open the Book settings sheet on arrival — the same "one tap from the
       * thing that caused it" rule `atPage` follows for the Unit trail. A
       * publish error about a resource has nothing to show on the page since
       * slice 14 moved Sources into the sheet. */
      atSettings?: boolean;
    }
  // The lesson level sits between book and unit (plan 0008).
  | { screen: "lesson"; bookId: string; lessonId: string; editing?: boolean }
  | {
      screen: "unit";
      bookId: string;
      lessonId: string;
      unitId: string;
      /** Open the trail on its last content page rather than the Overview —
       * set only by the practice session's back-swipe. */
      atEnd?: boolean;
      /** Open on a named trail page — set by a What-changed row or a publish
       * error deep-link (spec 0021-10 §3). */
      atPage?: string;
      editing?: boolean;
    }
  | {
      screen: "task";
      bookId: string;
      lessonId: string;
      unitId: string;
      taskId: string;
      /** Set only by Preview (spec 0021-9 §1): the session then runs over
       * the draft's own content, against a store that records nothing. */
      editing?: boolean;
    }
  // Pooled unit-level practice (plan 0010): one shuffled session across an
  // entire unit's task set, launched by UnitScreen's sticky Practice bar.
  | {
      screen: "unit-session";
      bookId: string;
      lessonId: string;
      unitId: string;
      editing?: boolean;
    }
  // Cross-unit recall session (plan 0016): practice-only over a sample of
  // the LINKED unit's tasks; onDone returns to the LINKING unit's Overview.
  | {
      screen: "recall-session";
      bookId: string;
      lessonId: string;
      unitId: string; // the linking unit, for onDone back-nav
      recallUnitId: string; // the linked unit whose tasks are sampled
      editing?: boolean;
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
  // The two legal pages (§ 5 DDG, Art. 13 GDPR), reached from the legal links
  // on the cover and the home screen. `back` returns to the sign-in form for
  // the one link that isn't the footer (AuthorScreen's "privacy note").
  | { screen: "privacy"; back?: Screen }
  | { screen: "impressum" }
  // About / app info (version, source, contact), reached from the same footer
  // row as the legal pages and from Settings — hence `back`, which is the
  // only thing that tells those two entry points apart.
  | { screen: "about"; back?: Screen }
  // Learner settings and stats (reached from the home top bar); both are
  // back-button screens over on-device state.
  | { screen: "settings" }
  | { screen: "stats" };

type ContentSourceResult = { source: ContentSource } | { errors: string[] };

const progressStore = createLocalStorageProgressStore();

/** Preview plays the draft's exercises for real and **records nothing**
 * (spec 0021-9 §1) — inspecting your own draft must not schedule half of it
 * into your review queue. Reads are empty rather than delegating: a state
 * read from the real store would show a card as "seen" in a preview of
 * content nobody has published yet. */
const PREVIEW_STORE: ProgressStore = {
  getItemState: async () => null,
  setItemState: async () => {},
  getAttemptedTaskIds: async () => [],
  markTaskAttempted: async () => {},
  getStreak: async () => null,
  setStreak: async () => {},
  incrementReps: async () => {},
};
const vocabListStore = createLocalStorageVocabListStore();
const userEntryStore = createLocalStorageUserEntryStore();

/** Set just before creating a Book adds it to this device (spec 0021-10 §1:
 * "then routes to `{ screen: "book", bookId, editing: true }`"). Adding is a
 * membership change, and every membership change ends in a full
 * `window.location.reload()` — that reload is what makes the new Book
 * resolvable at all, and it throws away any `setScreen` that follows it. So
 * the destination crosses the reload in sessionStorage, the same hand-off
 * `SKIP_COVER_KEY` already makes across the same reload. */
const OPEN_EDITING_KEY = "bb.openEditing";

/** Resolves the author Edit button's scoped-sheet target for one
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

/**
 * A deterministic `rng` for the session builders, seeded from the session's
 * own id. This is what lets the three `useMemo`s below depend on `content`
 * at all.
 *
 * They used to key on the id alone, deliberately — `Math.random` meant any
 * rebuild reshuffled the questions mid-session, so the only safe guard was
 * never to rebuild. The cost was the bug this replaces: edit a word through
 * the question screen's `✎` sheet and the question underneath went on
 * showing the old text, publish or no publish, because its questions were
 * frozen at mount. Seeding removes the reason for the freeze — the same id
 * always yields the same order, so a rebuild is positionally identical and
 * only the *content* of each question moves.
 *
 * mulberry32 over a string hash: not cryptographic, and it does not need to
 * be — it shuffles flashcards.
 */
function rngFor(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  return () => {
    hash = (hash + 0x6d2b79f5) >>> 0;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wires the engine's task-session building and grading to `SessionScreen`.
 * Questions are built once per mount (keyed by `task.id` via `useMemo`), so
 * they don't reshuffle across re-renders. An attempt is recorded only once
 * every question has been answered, matching the plan's completion rule. */
function TaskSession({
  store = progressStore,
  content,
  lookup,
  task,
  canEdit,
  onOpenEdit,
  onDone,
}: {
  /** Preview passes a no-op store so the draft's exercises play for
   * real and record nothing (spec 0021-9 §1). */
  store?: ProgressStore;
  content: Content;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal
   * surfaces (SessionScreen's pinned rules). */
  lookup: TapLookup;
  task: Task;
  /** Whether this content is editable from here (plan 0012 for a signed-in
   * author, plan 0017 §3 for a private Book, which has no account behind it
   * at all); gates the session screen's Edit button. */
  canEdit: boolean;
  /** Opens the scoped edit sheet on the given target (decision 13). */
  onOpenEdit: (docId: string, target: EditTarget) => void;
  onDone: () => void;
}) {
  const domainId = content.topic.domainId;
  const questions = useMemo(
    () => buildTaskSession(task, content, rngFor(task.id)),
    // `content` is reloaded (new reference) on every screen change and
    // changes for real when the `✎` sheet edits the draft — both rebuild,
    // and neither reshuffles, because `rngFor` is seeded by the task id.
    [task.id, content],
  );
  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(
      store,
      unitId,
      quality,
      new Date(),
      domainId,
      schedulingConfig(),
    );
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
      onAllAnswered={() => void store.markTaskAttempted(task.id)}
      onFinished={onDone}
      onExit={onDone}
      loadStreak={() => store.getStreak(domainId)}
    />
  );
}

/** Wires the engine's pooled unit-practice session building to
 * `SessionScreen` (plan 0010): one shuffled session across every task in the
 * unit, tagged per-question so `SessionScreen` can render a pin control and
 * report `onTaskAnswered` granularly (rather than only at session-end, the
 * way `TaskSession`'s single-task `onAllAnswered` does). */
function UnitSession({
  store = progressStore,
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
  /** Preview passes a no-op store so the draft's exercises play for
   * real and record nothing (spec 0021-9 §1). */
  store?: ProgressStore;
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
  /** Opens the scoped edit sheet on the given target (decision 13). */
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
    () => buildUnitSession(unit, content, rngFor(unit.id)),
    // Same seeded-rebuild rule as TaskSession.
    [unit.id, content],
  );
  const questions = useMemo(() => pairs.map((pair) => pair.question), [pairs]);
  const taskIds = useMemo(() => pairs.map((pair) => pair.taskId), [pairs]);

  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(
      store,
      unitId,
      quality,
      new Date(),
      domainId,
      schedulingConfig(),
    );
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
      onTaskAnswered={(taskId) => void store.markTaskAttempted(taskId)}
      onFinished={onDone}
      nextAction={nextAction}
      onExit={onDone}
      onSwipeBack={onSwipeBack}
      loadStreak={() => store.getStreak(domainId)}
    />
  );
}

/** Wires the engine's practice-only cross-unit recall session (plan 0016) to
 * `SessionScreen`: a random sample of up to 5 of the LINKED unit's tasks.
 * Grading routes through the same `recordGrade` (due-gated, so a completed
 * unit isn't rescheduled); no `markTaskAttempted` — the linking unit's
 * completion must stay derived from its own taskIds, not this session. */
function RecallSession({
  store = progressStore,
  content,
  linkedUnit,
  lookup,
  onDone,
}: {
  /** Preview passes a no-op store so the draft's exercises play for
   * real and record nothing (spec 0021-9 §1). */
  store?: ProgressStore;
  content: Content;
  linkedUnit: Unit;
  lookup: TapLookup;
  onDone: () => void;
}) {
  const domainId = content.topic.domainId;
  const pairs = useMemo(
    () => buildRecallSession(linkedUnit, content, rngFor(linkedUnit.id)),
    // Same seeded-rebuild rule as UnitSession.
    [linkedUnit.id, content],
  );
  const questions = useMemo(() => pairs.map((pair) => pair.question), [pairs]);

  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(
      store,
      unitId,
      quality,
      new Date(),
      domainId,
      schedulingConfig(),
    );
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
      loadStreak={() => store.getStreak(domainId)}
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
  /** Opens the scoped edit sheet on the given target (decision 13). */
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
      // `content` used to be unused by the engine — every field the builder
      // needed lived on the units themselves, so any book of the domain
      // satisfied the type. Plan 0022 §6 changed that: a due sentence looks
      // up its own build/scramble/dictation task, and Daily Review pools
      // items across every book of the domain. Handing it one book would
      // silently drop back to the flip-card for every *other* book's
      // sentences. Item ids are unique across Books, so the union is
      // unambiguous.
      const anyBookContent = booksContent[0];
      if (anyBookContent === undefined) {
        setQuestions([]);
        return;
      }
      const pooled = {
        ...anyBookContent,
        units: booksContent.flatMap((book) => book.units),
        items: booksContent.flatMap((book) => book.items),
        tasks: booksContent.flatMap((book) => book.tasks),
      };
      setQuestions(buildReviewSession(due, pooled, Math.random));
    });
    return () => {
      cancelled = true;
    };
  }, [domainContent, booksContent, store]);

  function handleGrade(unitId: string, quality: Quality) {
    return recordGrade(
      store,
      unitId,
      quality,
      new Date(),
      domainId,
      schedulingConfig(),
    ).then(() => undefined);
  }

  /** Skip (plan 0022 §5): push each of the question's scheduling units out by
   * `days`. Plural because a matching board covers several — review never
   * builds one today, but the prop contract is the same as Pin's. */
  async function handleSkip(unitIds: string[], days: number) {
    const now = new Date();
    for (const unitId of unitIds) {
      await skipItem(store, unitId, days, now);
    }
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
      onSkip={handleSkip}
      onFinished={onDone}
      onExit={onDone}
      // Daily Review is the one session that re-shows a failed card (plan
      // 0022 §4): it shows each scheduling unit exactly once, so a failure
      // here is the one that would otherwise vanish for a whole day.
      requeueOnAgain
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
    await recordGrade(
      progressStore,
      unitId,
      quality,
      new Date(),
      domainId,
      schedulingConfig(),
    );
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

  const [screen, setScreen] = useState<Screen>(() => {
    try {
      const bookId = sessionStorage.getItem(OPEN_EDITING_KEY);
      if (bookId !== null) {
        return { screen: "book", bookId, editing: true };
      }
    } catch {
      // Same private-mode-webview throw the cover flag below guards against.
    }
    return { screen: "books" };
  });
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
  /** Who may enter edit mode (plan 0021 §8) — one predicate behind every ✎.
   * `isAuthor` means *signed in at all*, not *maintainer*: it flips once
   * `listMyDocuments()` settles, deliberately, because propose mode exists
   * for everyone else. The name misleads; do not narrow it. */
  function canEdit(bookId: string): boolean {
    return isAuthor || isPrivateBook(bookId);
  }
  /** The Book's own mode. Its lexicon's is resolved separately inside the
   * session (spec 0021-5 §1b): a user can maintain the Book and not it. */
  function bookEditMode(bookId: string): EditMode {
    return isPrivateBook(bookId)
      ? "private"
      : editModeFor(documentId("topic", bookId));
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
      sessionStorage.removeItem(OPEN_EDITING_KEY);
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

  function goToBook(bookId: string, editing?: boolean) {
    setBookEpoch((epoch) => epoch + 1);
    setScreen({ screen: "book", bookId, editing });
  }

  /** Which editor a document opens in when the route doesn't pin one (plan
   * 0012 §5): a document the signed-in user maintains is edited directly,
   * anything else goes in through a proposal. Resolved here rather than at
   * each call site so every route into the editor agrees. */
  function editModeFor(docId: string): "maintain" | "propose" {
    return maintainedDocIds?.has(docId) === false ? "propose" : "maintain";
  }

  /**
   * The Book a document is edited on, now that editing happens on the Book's
   * own screens (spec 0021-5 §2c): a Book document is its own Book, and a
   * **domain** document belongs to whichever Book uses it — those words are
   * never named as a document in the UI. `undefined` when neither resolves
   * to something loadable on this device.
   */
  function editableBookFor(docId: string): string | undefined {
    const id = contentIdOf(docId);
    if (docId.startsWith("domain:")) {
      return books.find((book) => book.domainId === id)?.id;
    }
    // `isPrivateBook` as well as `books` (spec 0021-11 §2): a private Book
    // whose documents don't validate is absent from `books` — that absence
    // *is* what makes its card the broken one — and it is still editable,
    // because the session reads the private store directly and
    // `draftContent` cannot fail. This is the route behind the broken card's
    // Edit, which is the only way back into such a Book.
    return books.some((book) => book.id === id) || isPrivateBook(id)
      ? id
      : undefined;
  }

  /**
   * Why a document cannot be edited here, or `undefined` when it can (spec
   * 0021-11 §3). Every route into the old form editor now ends in one of
   * these two sentences instead: with the form tree gone there is no
   * fallback that can open a document out of context, and slice 10 §2's rule
   * is to **say so** rather than dead-end.
   */
  function noEditorReason(docId: string): string | undefined {
    if (editableBookFor(docId) !== undefined) {
      return undefined;
    }
    return docId.startsWith("domain:")
      ? "add the Book that uses these words to edit them"
      : "add this Book to your books first — editing happens on the Book itself";
  }

  /** Where a document id opens: its Book, in edit mode, or the Library —
   * which is where adding the missing Book actually happens. */
  function editorRouteFor(docId: string): Screen {
    const bookId = editableBookFor(docId);
    return bookId !== undefined
      ? { screen: "book", bookId, editing: true }
      : { screen: "library" };
  }

  /**
   * Settings → "Import book/domain…": stores each imported document under
   * the key the editor it will open actually reads, then opens the first.
   *
   * The import used to write `bb.author.draft.*` and pin maintain mode for
   * everyone, so a non-maintainer landed in the maintainer's editor, whose
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
      // The storage half above is unchanged; only the destination moved
      // (spec 0021-11 §3). An imported document with no Book to open it on
      // — a lexicon whose Book is not here, a Book not in My Books — is
      // reported rather than dropping the author on an unrelated screen.
      // The draft/proposal key is already written either way, so adding the
      // Book afterwards picks the import straight up.
      const reason = noEditorReason(first.id);
      if (reason !== undefined) {
        throw new Error(`${first.id} was imported, but ${reason}`);
      }
      setScreen(editorRouteFor(first.id));
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

  // `recheckForUpdate` lived here, re-running the update check when the form
  // editor reported a publish. Its last two callers were the `forms` route
  // and the session ✎'s full editor, both gone — and `EditSession` has had
  // no publish callback since slice 5, so this had already stopped covering
  // the in-place path. Publishing still leaves the author's own learner view
  // on the cached copy until the next reload; that is the same open gap
  // STATUS records for an unlisted Book, where a recheck would not have
  // helped either (`planUpdate` only considers catalog rows).

  /** Renders a session with the scoped ✎ sheet over it while one is open
   * (plan decision 13). The session stays mounted and, since spec 0021-11
   * §3, stays *visible* too: the sheet is a modal `<dialog>`, so it makes
   * its own backdrop and inerts what is behind it — the `hidden` this
   * wrapper used to need was for a full-screen editor, and hiding the
   * question you are fixing a typo in was never the intent. */
  function withSessionEdit(session: ReactElement): ReactElement {
    const close = () => setSessionEdit(null);
    if (sessionEdit !== null) {
      // Hardware back closes the sheet and leaves the session running,
      // rather than exiting the session underneath it.
      backActionRef.current = close;
    }
    // The wrapper is unconditional, and so is the session's position inside
    // it: returning the bare session while no sheet is open would put a
    // different element type at this position, and React would unmount and
    // rebuild the session on every open and close — the exact thing this
    // whole arrangement exists to avoid.
    return (
      <>
        <div>{session}</div>
        {sessionEdit !== null && editSession.value !== null && (
          <SessionEditSheet
            session={editSession.value}
            target={sessionEdit.target}
            onClose={close}
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
  // done/cancel) button, and `back-trap.ts` keeps a small stack of history
  // entries of our own that a back press lands on instead of leaving.
  //
  // **The trap is unconditional** (third attempt at this bug, 2026-08-21).
  // The two previous versions each let some pop through — the first at every
  // root screen, the second at a root screen when the app was not detected as
  // an installed PWA — and on the owner's phone back still went black from
  // every screen, cover included. At the cover this handler runs no React
  // code at all, so a black screen there can only mean the document itself
  // went away: the pop escaped. Rather than keep betting on which pop is safe
  // to release and on `display-mode` being reported the way the spec says,
  // nothing is released. Back inside the app moves up a screen; back at the
  // root does nothing. Leaving an installed app is Home or the app switcher,
  // and in a browser tab it costs the back button on this one site — a real
  // price, paid deliberately, and cheap next to a black screen.
  // The last link in the boot chain the diary records (boot → content-ready →
  // app-mounted): between them they say how far a launch got before it went
  // dark, which a screenshot of a black screen cannot.
  useEffect(() => {
    recordNav("app-mounted");
  }, []);

  useEffect(() => {
    function onPopState() {
      const goBack = backActionRef.current;
      recordNav(
        "back",
        `handled=${goBack !== null} depth=${trapDepth()} len=${history.length}`,
      );
      if (goBack !== null) {
        goBack();
      }
      // Re-armed synchronously rather than left to the commit effect below:
      // a pop that ran no back action produces no commit at all.
      armBackTrap();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Arms after every commit — including the first, which is why mounting no
  // longer pushes one of its own. Idempotent (it tops up to a fixed depth),
  // so a commit that changes no screen pushes nothing.
  useEffect(() => {
    armBackTrap();
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
        } else if (
          isBookFamilyScreen &&
          !("editing" in screen && screen.editing === true)
        ) {
          // The active book failed to load (stale snapshot, spec 0019 §3a):
          // `content` would otherwise stay whatever it was (or `null`, which
          // renders a permanent "Loading…" on book-family screens) — send
          // the learner back to the books list, where the broken card for
          // this id now shows via `runtimeBrokenBookIds`.
          //
          // Never in edit mode (spec 0021-11 §2): a Book that does not
          // validate is exactly the one you came here to repair, and the
          // session renders it from the draft. Bailing would bounce you off
          // the screen the moment you arrived.
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

  // Edit mode (plan 0021 §8). The session is owned here, not inside the
  // book/lesson/unit branch, because spec 0021-5 §2d resolves what those
  // screens render from the *draft* — and that resolution point is above
  // the branch. Every effect inside returns early while `enabled` is false,
  // so a learner pays nothing for the hook being mounted.
  const editingBookId =
    (screen.screen === "book" ||
      screen.screen === "lesson" ||
      screen.screen === "unit" ||
      // Preview's Practice launches a real session over the draft (spec
      // 0021-9 §1), so the session has to stay mounted across those routes
      // or the task ids it just offered resolve against published content.
      screen.screen === "task" ||
      screen.screen === "unit-session" ||
      screen.screen === "recall-session") &&
    screen.editing === true
      ? screen.bookId
      : null;
  // The scoped session sheet (plan decision 13) needs the same documents,
  // reached from a *learner* route — a question screen carries no `editing`
  // flag. It reuses this one hook rather than mounting a second session
  // underneath the first: two sessions over one Book would each autosave
  // their own copy of it.
  //
  // The Book is the one whose units actually reference the tapped entity,
  // not simply the first that uses its lexicon. `itemEditTarget` points a
  // word at `domain:<id>`, and `ReviewSession` pools items across **every**
  // Book of a domain — so resolving the document alone would open a session
  // over Book A for a word tapped in Book B, and the sheet, walking Book A's
  // units, would report content that plainly exists as gone.
  const sheetTarget =
    sessionEdit === null
      ? undefined
      : (sessionEdit.target.taskId ??
        sessionEdit.target.itemId ??
        sessionEdit.target.entryId);
  const sheetBookId =
    sessionEdit === null
      ? null
      : ([...booksContentMap].find(([, bookContent]) =>
          bookContent.units.some(
            (unit) =>
              unit.itemIds.includes(sheetTarget ?? "") ||
              unit.taskIds.includes(sheetTarget ?? ""),
          ),
        )?.[0] ??
        editableBookFor(sessionEdit.docId) ??
        null);
  /**
   * The Book whose draft a running session renders from, once that session's
   * `✎` has been used — and **after the sheet closes**, which is the part
   * that makes the fix worth anything. `sessionEdit` is the sheet, and it is
   * cleared the moment you tap "Back to the question"; hanging the draft off
   * it meant the edit was visible only while the sheet covered the question,
   * and the question reverted to published content underneath. Sticky until
   * the screen changes: the effect below clears it on exactly the navigation
   * that already ends `sessionEdit`, so leaving the session tears the draft
   * session down with it.
   */
  const [sessionDraftBookId, setSessionDraftBookId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (sheetBookId !== null) {
      setSessionDraftBookId(sheetBookId);
    }
  }, [sheetBookId]);
  useEffect(() => setSessionDraftBookId(null), [screen]);
  const sessionBookId = editingBookId ?? sheetBookId ?? sessionDraftBookId;
  const editSession = useEditSessionState({
    bookId: sessionBookId ?? "",
    mode: sessionBookId === null ? "maintain" : bookEditMode(sessionBookId),
    enabled: sessionBookId !== null,
    resolveMode: editModeFor,
  });
  /** The session **as a route flag** — what the learner screens render from,
   * and what carries Edit/Preview/Diff (spec 0021-5 §2d). Stays null while
   * only the sheet has one open: those three modes belong to a screen you
   * navigated into edit mode on, not to a question you tapped `✎` in. */
  const routeSession = editingBookId === null ? null : editSession.value;
  /**
   * The draft the *content* of a screen resolves against, which the scoped
   * sheet (decision 13) also has to feed. Editing a word through a
   * question's `✎` used to leave the question underneath showing the old
   * text until the author published and took a content update — the session
   * rendered published content and never re-derived.
   *
   * This was previously ruled out as "not swap to the draft mid-answer", and
   * that objection was about *reshuffling*, not about the text: the builders
   * now seed their rng from the session's own id, so re-deriving keeps every
   * question in place and changes only what each one says.
   */
  const sheetContentSession =
    routeSession !== null || sessionDraftBookId === null
      ? null
      : sessionDraftBookId === ("bookId" in screen ? screen.bookId : undefined)
        ? // Only once the lexicon has settled. The Book document loads
          // first, so until the second fetch lands the draft's units
          // reference words it does not yet hold — questions built from it
          // would drop every lexicon-backed one and then get them back a
          // moment later. (Harmless now rather than fatal: `buildTaskSession`
          // no longer asserts those references resolve.) A lexicon that
          // *fails* to load never settles, and this correctly leaves that
          // session showing published content instead of a Book with no words.
          editSession.value?.lexiconLoaded === true
          ? editSession.value
          : null
        : null;

  // Spec 0021-5 §3: leaving edit mode with an unsynced draft used to leave
  // it invisible — the learner screens render published content and nothing
  // said a draft existed. Read from the storage keys at render, not from
  // session state and not once at mount: the whole point is that it shows
  // when no session is open, including the one that just closed.
  const unpublishedBookIds = new Set(
    books
      .map((book) => book.id)
      .filter((id) => hasUnpublishedChanges(documentId("topic", id))),
  );

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
  if (screen.screen === "about") {
    const back = screen.back ?? { screen: "books" as const };
    const onBack = () => setScreen(back);
    backActionRef.current = onBack;
    return <AboutScreen onBack={onBack} />;
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
        onAbout={() => setScreen({ screen: "about" })}
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
        onCreateHostedBook={async (title) => {
          // Ids first, codes derived from them (spec 0021-10 §1b):
          // `validateContentSet` enforces globally unique *domain* codes but
          // never Book codes, so a code derived from a user-chosen title can
          // collide where a duplicate Book code would not — and the
          // collision would surface in somebody else's Book at listing time.
          const bookId = newPrivateId();
          const domainId = newPrivateId();
          const code = bookId.slice(0, 8);
          const book: BookDocument = {
            topic: {
              id: bookId,
              code,
              title,
              domainId,
              lessonIds: [],
              description: "",
            },
            lessons: [],
            units: [],
            items: [],
            tasks: [],
            // §1d, same seed the private path gets: without it the first
            // word an author adds is invalid.
            resources: [{ id: newEntityId(code), title, path: "" }],
            notes: [],
          };
          const domain: DomainDocument = {
            domain: {
              id: domainId,
              code,
              kind: "general",
              title,
              glossLanguage: "en",
            },
            entries: [],
            families: [],
          };
          await createBookDocuments(
            documentId("topic", bookId),
            book,
            documentId("domain", domainId),
            domain,
          );
          // Where to land after the reload `addCreatedBook` ends in. Written
          // first: that reload is synchronous with the call.
          try {
            sessionStorage.setItem(OPEN_EDITING_KEY, bookId);
          } catch {
            // Storage denied — the Book is still created and still added;
            // the author just arrives on My Books and taps it.
          }
          // Adds it to this device so the Book route can resolve it. Not the
          // Library's Add: that reads the catalog, which a Book created a
          // second ago (unlisted, unpublished) is not in.
          await contentInit.addCreatedBook(bookId, book, domainId, domain);
        }}
        // No `mode`: the route carries only the Book, and the session
        // resolves maintain/propose/private from the document itself
        // (`bookEditMode`) — the same answer `editModeFor` gave here.
        onOpenDocument={(docId) => setScreen(editorRouteFor(docId))}
        noEditorReason={noEditorReason}
        // Pinned back: the note is read from the sign-in form, and losing a
        // half-typed email to a Back tap would be its own little betrayal.
        onPrivacy={() =>
          setScreen({ screen: "privacy", back: { screen: "author" } })
        }
        onBack={onBack}
      />
    );
  }
  if (screen.screen === "settings") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <SettingsScreen
        onBack={onBack}
        onAbout={() =>
          // Pinned back: About is a detour from Settings, so Back has to
          // return here rather than to home (the footer-row entry points
          // keep the default).
          setScreen({ screen: "about", back: { screen: "settings" } })
        }
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
          // The only ✎ on a Book that does not load — a broken card is
          // exactly where there is no Book screen to reach ✎ from. It is
          // offered on private Books alone, whose documents live nowhere
          // else, and it now opens the Book screen in edit mode like every
          // other ✎: the session reads the private store directly, so it
          // does not need the Book to validate (spec 0021-11 §2).
          onEdit={(bookId) =>
            setScreen(editorRouteFor(documentId("topic", bookId)))
          }
          unpublishedChanges={unpublishedBookIds}
          onLibrary={
            getSupabase() !== null
              ? () => setScreen({ screen: "library" })
              : undefined
          }
          onAuthor={() => setScreen({ screen: "author" })}
          onOpenStats={() => setScreen({ screen: "stats" })}
          onOpenSettings={() => setScreen({ screen: "settings" })}
          onAbout={() => setScreen({ screen: "about" })}
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
    //
    // Both fall back to the session's own copies (spec 0021-11 §2), and that
    // fallback is the whole editing route for a Book whose published copy
    // does not validate. `content` comes from the validated content source,
    // so a Book with, say, a unit that has no tasks yet — the state `+ unit`
    // leaves behind, per plan §1 — loads as nothing at all, and until now
    // its only way in was the form editor. The draft has no such gate:
    // `draftContent` cannot fail by construction.
    //
    // Spec 0021-5 §2d: in edit mode the screens render the draft through
    // `draftContent` instead of the validated published content. One
    // conditional, here at the resolution point; the screens are unchanged.
    // Resolved *above* the gate now, so the gate can be about what will
    // actually render rather than about what the content source managed.
    const editView = routeSession?.view ?? "edit";
    const preview =
      editView === "preview" ? (routeSession?.preview ?? null) : null;
    const shown =
      preview !== null
        ? preview.content
        : editView === "diff" && routeSession?.diff != null
          ? // The **union** — base ∪ draft (spec 0021-9 §2) — so an entity
            // the draft removed still has a row to tint red.
            routeSession.diff.content
          : (routeSession?.content ?? sheetContentSession?.content ?? content);
    const shownLookup = domainContent ?? routeSession?.domainContent;
    if (shown === null || shownLookup === undefined || shownLookup === null) {
      return <p>Loading&hellip;</p>;
    }
    const lookup: TapLookup = {
      domainContent: shownLookup,
      listStore: vocabListStore,
      userEntryStore,
      onWordsChanged: () => setDomainEpoch((epoch) => epoch + 1),
    };
    // Preview opens everything (§1b): inspecting unit 12 must not cost
    // eleven skip-ahead confirms, and a bad unlock chain is caught
    // structurally anyway. A prop swap, deliberately, not a store change.
    const shownAttempted =
      preview !== null
        ? new Set(shown.tasks.map((task) => task.id))
        : attemptedTaskIds;
    const shownStore = preview !== null ? PREVIEW_STORE : progressStore;
    // In Diff the draft has no copy of a note it deleted, and `UnitScreen`
    // drops any note whose markdown is undefined — so without this fallback
    // the one entity a diff most needs to show never reaches the screen.
    const diffBefore = routeSession?.diff?.before;
    const shownNoteMarkdown =
      preview !== null
        ? preview.noteMarkdown
        : editView === "diff" && diffBefore !== undefined
          ? (stem: string) => {
              const draft = routeSession?.noteMarkdown(stem);
              if (draft !== undefined) {
                return draft;
              }
              const base = (diffBefore.get(stem) as { markdown?: unknown })
                ?.markdown;
              return typeof base === "string" ? base : undefined;
            }
          : routeSession?.noteMarkdown;
    /** Wraps a learner screen in the session while `editing` is set. Exiting
     * clears the flag and leaves you exactly where you were. */
    const inSession = (
      node: ReactElement,
      exitTo: Screen,
      // Whether *this* screen has anything to diff (spec 0021-9 §3a) — only
      // App knows which screen is under the session.
      diffHere = false,
    ): ReactElement =>
      editingBookId === null ? (
        node
      ) : (
        <EditSession
          session={editSession}
          onExit={() => setScreen(exitTo)}
          diffHere={diffHere}
          onNavigate={(target) => {
            if (target.unitId !== undefined && target.lessonId !== undefined) {
              setScreen({
                screen: "unit",
                bookId: editingBookId,
                lessonId: target.lessonId,
                unitId: target.unitId,
                atPage: target.page,
                editing: true,
              });
            } else if (target.lessonId !== undefined) {
              setScreen({
                screen: "lesson",
                bookId: editingBookId,
                lessonId: target.lessonId,
                editing: true,
              });
            } else {
              setScreen({
                screen: "book",
                bookId: editingBookId,
                editing: true,
                ...(target.bookSettings === true ? { atSettings: true } : {}),
              });
            }
          }}
        >
          {node}
        </EditSession>
      );

    if (screen.screen === "book") {
      const onBack = () => setScreen({ screen: "books" });
      backActionRef.current = onBack;
      return inSession(
        <BookScreen
          content={shown}
          atSettings={screen.atSettings === true}
          unpublishedChanges={unpublishedBookIds.has(screen.bookId)}
          attemptedTaskIds={shownAttempted}
          store={shownStore}
          epoch={bookEpoch}
          onSelectLesson={(lessonId) =>
            setScreen({
              screen: "lesson",
              bookId: screen.bookId,
              lessonId,
              editing: screen.editing,
            })
          }
          onPracticeTask={(target) =>
            setScreen({
              screen: "task",
              bookId: screen.bookId,
              ...target,
              // Carried so Preview's Practice plays the draft (§1).
              editing: screen.editing,
            })
          }
          onReview={() =>
            setScreen({ screen: "review", domainId: shown.topic.domainId })
          }
          onVocabulary={() =>
            setScreen({ screen: "vocab", domainId: shown.topic.domainId })
          }
          // Cannot reject — see the My Books call site.
          onPlay={() => void playBook(screen.bookId)}
          onEdit={
            canEdit(screen.bookId)
              ? () => setScreen({ ...screen, editing: true })
              : undefined
          }
          onBack={onBack}
        />,
        { screen: "book", bookId: screen.bookId },
        routeSession !== null && bookScopeChanged(routeSession),
      );
    }

    if (screen.screen === "lesson") {
      const onBack = () => goToBook(screen.bookId, screen.editing);
      backActionRef.current = onBack;
      return inSession(
        <LessonScreen
          content={shown}
          lessonId={screen.lessonId}
          attemptedTaskIds={shownAttempted}
          store={shownStore}
          onSelectUnit={(unitId) =>
            setScreen({
              screen: "unit",
              bookId: screen.bookId,
              lessonId: screen.lessonId,
              unitId,
              editing: screen.editing,
            })
          }
          onPracticeTask={(target) =>
            setScreen({
              screen: "task",
              bookId: screen.bookId,
              ...target,
              // Carried so Preview's Practice plays the draft (§1).
              editing: screen.editing,
            })
          }
          onEdit={
            canEdit(screen.bookId)
              ? () => setScreen({ ...screen, editing: true })
              : undefined
          }
          onBack={onBack}
        />,
        {
          screen: "lesson",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
        },
        routeSession !== null &&
          lessonScopeChanged(routeSession, screen.lessonId),
      );
    }

    if (screen.screen === "unit") {
      const onBack = () =>
        setScreen({
          screen: "lesson",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
          editing: screen.editing,
        });
      backActionRef.current = onBack;
      return inSession(
        <UnitScreen
          content={shown}
          unitId={screen.unitId}
          lookup={lookup}
          // Draft note text in edit mode; the module-global `getNoteMarkdown`
          // only knows what has been published (spec 0021-5 §2d).
          noteMarkdown={shownNoteMarkdown}
          onPractice={() =>
            setScreen({
              screen: "unit-session",
              bookId: screen.bookId,
              lessonId: screen.lessonId,
              unitId: screen.unitId,
              editing: screen.editing,
            })
          }
          onRecall={(recallUnitId) =>
            setScreen({
              screen: "recall-session",
              bookId: screen.bookId,
              lessonId: screen.lessonId,
              unitId: screen.unitId,
              recallUnitId,
              editing: screen.editing,
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
              shown.topic.domainId,
              schedulingConfig(),
            );
          }}
          isNotePinned={(noteId) =>
            progressStore
              .getItemState(noteUnitId(noteId))
              .then((state) => state !== null)
          }
          onEdit={
            canEdit(screen.bookId)
              ? () => setScreen({ ...screen, editing: true })
              : undefined
          }
          onBack={onBack}
          startAtEnd={screen.atEnd}
          startAtPage={screen.atPage}
        />,
        {
          screen: "unit",
          bookId: screen.bookId,
          lessonId: screen.lessonId,
          unitId: screen.unitId,
        },
        routeSession !== null && unitScopeChanged(routeSession, screen.unitId),
      );
    }

    if (screen.screen === "unit-session") {
      const unit = shown.units.find((u) => u.id === screen.unitId);
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
      const lesson = shown.lessons.find((l) => l.id === screen.lessonId);
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
          shown.units,
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
          isLessonComplete(lesson, shown.units, ids)
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
        const next = nextUnit(shown, ids);
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
          store={shownStore}
          content={shown}
          unit={unit}
          lookup={lookup}
          pinnedUnitIds={pinnedUnitIds}
          onTogglePin={(unitIds) => {
            togglePinnedUnits(shown.topic.domainId, unitIds);
            setPinEpoch((epoch) => epoch + 1);
          }}
          canEdit={canEdit(screen.bookId)}
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
          content={shown}
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
      const linkedUnit = shown.units.find((u) => u.id === screen.recallUnitId);
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
          store={shownStore}
          content={shown}
          linkedUnit={linkedUnit}
          lookup={lookup}
          onDone={onDone}
        />
      );
    }

    // screen.screen === "task"
    const task = shown.tasks.find((t) => t.id === screen.taskId);
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
        store={shownStore}
        content={shown}
        lookup={lookup}
        task={task}
        canEdit={canEdit(screen.bookId)}
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

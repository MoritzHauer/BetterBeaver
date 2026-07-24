import { useEffect, useMemo, useRef, useState } from "react";
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
  buildReviewSession,
  buildTaskSession,
  buildUnitSession,
  dueDomainUnits,
  isLessonComplete,
  noteUnitId,
  recordGrade,
  symmetricLinks,
} from "@betterbeaver/engine";
import type { Quality } from "@betterbeaver/srs";
import { recallQuality } from "@betterbeaver/srs";
import type { TapLookup } from "./components/TappableText";
import type { ContentInit, ContentUpdate } from "./content/source";
import { resolvedLinksByEntryId } from "./content/links";
import { readCachedDocuments } from "./content/cache";
import { readArchived } from "./content/myBooks";
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { createLocalStorageVocabListStore } from "./progress/vocab-lists";
import { createLocalStorageUserEntryStore } from "./progress/user-entries";
import { getPinnedTaskIds, togglePinnedTask } from "./progress/pinned-tasks";
import { AUTO_UPDATE_KEY } from "./autoUpdate";
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
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { currentUser, getSupabase } from "./backend/supabase";

type Screen =
  | { screen: "books" }
  | { screen: "book"; bookId: string }
  // The lesson level sits between book and unit (plan 0008).
  | { screen: "lesson"; bookId: string; lessonId: string }
  | { screen: "unit"; bookId: string; lessonId: string; unitId: string }
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
  | { screen: "edit"; docId: string; target?: EditTarget; back?: Screen }
  | { screen: "privacy" }
  // Learner settings and stats (reached from the home top bar); both are
  // back-button screens over on-device state.
  | { screen: "settings" }
  | { screen: "stats" };

type ContentSourceResult = { source: ContentSource } | { errors: string[] };

const progressStore = createLocalStorageProgressStore();
const vocabListStore = createLocalStorageVocabListStore();
const userEntryStore = createLocalStorageUserEntryStore();

/** Wires the engine's task-session building and grading to `SessionScreen`.
 * Questions are built once per mount (keyed by `task.id` via `useMemo`), so
 * they don't reshuffle across re-renders. An attempt is recorded only once
 * every question has been answered, matching the plan's completion rule. */
function TaskSession({
  content,
  lookup,
  task,
  onDone,
}: {
  content: Content;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal
   * surfaces (SessionScreen's pinned rules). */
  lookup: TapLookup;
  task: Task;
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

  return (
    <SessionScreen
      title={task.instructions ?? `${task.type} practice`}
      questions={questions}
      bookId={content.topic.id}
      lookup={lookup}
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
  pinnedTaskIds,
  onTogglePin,
  onDone,
}: {
  content: Content;
  unit: Unit;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal
   * surfaces (SessionScreen's pinned rules). */
  lookup: TapLookup;
  pinnedTaskIds: ReadonlySet<string>;
  onTogglePin: (taskId: string) => void;
  onDone: () => void;
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

  return (
    <SessionScreen
      title={unit.title}
      questions={questions}
      bookId={content.topic.id}
      lookup={lookup}
      taskIds={taskIds}
      pinnedTaskIds={pinnedTaskIds}
      onTogglePin={onTogglePin}
      onGrade={handleGrade}
      onTaskAnswered={(taskId) => void progressStore.markTaskAttempted(taskId)}
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
  onDone,
}: {
  domainContent: DomainContent;
  /** Every book belonging to the domain. */
  booksContent: Content[];
  store: ProgressStore;
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal surfaces. */
  lookup: TapLookup;
  onDone: () => void;
}) {
  const domainId = domainContent.domain.id;
  const [questions, setQuestions] = useState<ReturnType<
    typeof buildReviewSession
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    dueDomainUnits(
      booksContent,
      domainContent.entries,
      store,
      new Date(),
      getPinnedTaskIds(domainId),
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

  return (
    <SessionScreen
      title="Review"
      questions={questions}
      bookId={bookId}
      lookup={lookup}
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
  // Holds whatever handler the currently rendered screen would run on its
  // own back button (null at the root, where back should exit normally).
  const backActionRef = useRef<(() => void) | null>(null);
  // Signed-in authors get ✎ Edit buttons on the book/lesson/unit screens
  // (plan 0012). Whether they actually maintain a given document is the
  // backend's call — a non-maintainer just sees the editor's load error.
  const [isAuthor, setIsAuthor] = useState(false);
  useEffect(() => {
    if (getSupabase() !== null) {
      void currentUser().then((user) => setIsAuthor(user !== null));
    }
  }, []);
  // ponytail: welcome cover shows on every load (plan 0009); persist a
  // "seen" flag if the extra tap ever annoys.
  const [started, setStarted] = useState(false);
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
    readCachedDocuments().then((cached) => {
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
  // Broken cards' titles, resolved from the same raw cache map (falls back
  // to the bare id when the doc is missing entirely — the common case, since
  // that's exactly what makes a Book broken via the "missing cached content"
  // path).
  const brokenBooks = useMemo(
    () =>
      contentInit.broken.map((b) => ({
        ...b,
        title: cachedBookSummaries.get(b.bookId)?.title ?? b.bookId,
      })),
    [cachedBookSummaries],
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
  // The current book's domain's pinned task ids, re-read whenever pinEpoch
  // bumps (plan 0008); only ever consumed by UnitSession (plan 0010: pin
  // moved from UnitScreen's task list into the pooled practice session), but
  // computed here (not inside the screen-specific branch below) since it's a
  // hook.
  const pinnedTaskIds = useMemo(
    () =>
      content !== null
        ? getPinnedTaskIds(content.topic.domainId)
        : new Set<string>(),
    [content, pinEpoch],
  );

  function reloadAttemptedTaskIds() {
    progressStore
      .getAttemptedTaskIds()
      .then((ids) => setAttemptedTaskIds(new Set(ids)));
  }

  function goToBook(bookId: string) {
    setBookEpoch((epoch) => epoch + 1);
    setScreen({ screen: "book", bookId });
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

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    contentSourceResult.source.listBooks().then(setBooks);
    contentSourceResult.source.listDomains().then(setDomains);
    reloadAttemptedTaskIds();
  }, [contentSourceResult]);

  // Loads every book's full content once `books` is populated (plan 0010),
  // for MyBooksScreen's per-book progress bars — unconditional, not gated
  // on the active screen.
  useEffect(() => {
    if (!("source" in contentSourceResult) || books.length === 0) {
      return;
    }
    let cancelled = false;
    Promise.all(
      books.map((book) => contentSourceResult.source.loadBook(book.id)),
    ).then((loaded) => {
      if (cancelled) {
        return;
      }
      setBooksContentMap(
        new Map(
          loaded.map((bookContent) => [bookContent.topic.id, bookContent]),
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
      screen.screen === "unit-session";
    const contentPromise = isBookFamilyScreen
      ? contentSourceResult.source.loadBook(screen.bookId)
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
                contentSourceResult.source.loadBook(id),
              ),
            ),
            userEntryStore.getEntries(domainId),
          ]);

    if (contentPromise === undefined && domainPromise === undefined) {
      return;
    }
    let cancelled = false;
    Promise.all([contentPromise, domainPromise]).then(
      ([loadedContent, loadedDomain]) => {
        if (cancelled) {
          return;
        }
        if (loadedContent !== undefined) {
          setContent(loadedContent);
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
          setDomainBooksContent(loadedBooksContent);
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

  if (!started) {
    backActionRef.current = null;
    return <StartScreen onStart={() => setStarted(true)} />;
  }

  if (screen.screen === "author") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <AuthorScreen
        onOpenDocument={(docId) => setScreen({ screen: "edit", docId })}
        onPrivacy={() => setScreen({ screen: "privacy" })}
        onBack={onBack}
      />
    );
  }
  if (screen.screen === "edit") {
    const back = screen.back ?? { screen: "author" as const };
    const onBack = () => setScreen(back);
    backActionRef.current = onBack;
    return (
      <EditScreen docId={screen.docId} target={screen.target} onBack={onBack} />
    );
  }
  if (screen.screen === "privacy") {
    const onBack = () => setScreen({ screen: "author" });
    backActionRef.current = onBack;
    return <PrivacyScreen onBack={onBack} />;
  }

  if (screen.screen === "settings") {
    const onBack = () => setScreen({ screen: "books" });
    backActionRef.current = onBack;
    return (
      <SettingsScreen
        onBack={onBack}
        onSignIn={() => setScreen({ screen: "author" })}
        onImportBook={(docId) =>
          setScreen({ screen: "edit", docId, back: { screen: "settings" } })
        }
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
        {update !== null && (
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
          onSelectBook={(bookId) => goToBook(bookId)}
          onVocabulary={(domainId) => setScreen({ screen: "vocab", domainId })}
          onReview={(domainId) => setScreen({ screen: "review", domainId })}
          onArchive={contentInit.archiveBook}
          onRestore={contentInit.restoreBook}
          onRemove={contentInit.removeBook}
          onLibrary={
            getSupabase() !== null
              ? () => setScreen({ screen: "library" })
              : undefined
          }
          onAuthor={
            getSupabase() !== null
              ? () => setScreen({ screen: "author" })
              : undefined
          }
          onOpenStats={() => setScreen({ screen: "stats" })}
          onOpenSettings={() => setScreen({ screen: "settings" })}
        />
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
    screen.screen === "unit-session"
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
          onEdit={
            isAuthor
              ? () =>
                  setScreen({
                    screen: "edit",
                    docId: documentId("topic", screen.bookId),
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
            isAuthor
              ? () =>
                  setScreen({
                    screen: "edit",
                    docId: documentId("topic", screen.bookId),
                    target: { lessonId: screen.lessonId },
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
            isAuthor
              ? (target) =>
                  setScreen({
                    screen: "edit",
                    docId: documentId("topic", screen.bookId),
                    target: {
                      lessonId: screen.lessonId,
                      unitId: screen.unitId,
                      ...target,
                    },
                    back: screen,
                  })
              : undefined
          }
          onBack={onBack}
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
      return (
        <UnitSession
          content={content}
          unit={unit}
          lookup={lookup}
          pinnedTaskIds={pinnedTaskIds}
          onTogglePin={(taskId) => {
            togglePinnedTask(content.topic.domainId, taskId);
            setPinEpoch((epoch) => epoch + 1);
          }}
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
    return (
      <TaskSession
        content={content}
        lookup={lookup}
        task={task}
        onDone={onTaskDone}
      />
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
  return (
    <ReviewSession
      domainContent={domainContent}
      booksContent={domainBooksContent}
      store={progressStore}
      lookup={lookup}
      onDone={onReviewDone}
    />
  );
}

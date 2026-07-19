import { useEffect, useMemo, useState } from "react";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import type {
  ContentSource,
  DomainContent,
  DomainSummary,
  ProgressStore,
  TopicSummary,
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
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { createLocalStorageVocabListStore } from "./progress/vocab-lists";
import { createLocalStorageUserEntryStore } from "./progress/user-entries";
import { getPinnedTaskIds, togglePinnedTask } from "./progress/pinned-tasks";
import { TopicListScreen } from "./screens/TopicListScreen";
import { TopicScreen } from "./screens/TopicScreen";
import { LessonScreen } from "./screens/LessonScreen";
import { UnitScreen } from "./screens/UnitScreen";
import { SessionScreen } from "./screens/SessionScreen";
import {
  ADHOC_MODE_LABELS,
  VocabularyScreen,
} from "./screens/VocabularyScreen";
import { ErrorScreen } from "./screens/ErrorScreen";
import { StartScreen } from "./screens/StartScreen";

type Screen =
  | { screen: "topics" }
  | { screen: "topic"; topicId: string }
  // The lesson level sits between topic and unit (plan 0008).
  | { screen: "lesson"; topicId: string; lessonId: string }
  | { screen: "unit"; topicId: string; lessonId: string; unitId: string }
  | {
      screen: "task";
      topicId: string;
      lessonId: string;
      unitId: string;
      taskId: string;
    }
  // Pooled unit-level practice (plan 0010): one shuffled session across an
  // entire unit's task set, launched by UnitScreen's sticky Practice bar.
  | {
      screen: "unit-session";
      topicId: string;
      lessonId: string;
      unitId: string;
    }
  // Review, Vocabulary, and ad-hoc study are domain-scoped (plan 0006): the
  // review queue, lists, and streak all key on the domain now, not the topic.
  | { screen: "review"; domainId: string }
  | { screen: "vocab"; domainId: string }
  | { screen: "adhoc"; domainId: string; mode: AdhocMode; itemIds: string[] };

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
      topicId={content.topic.id}
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
      topicId={content.topic.id}
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
 * to `SessionScreen` (plan 0006: re-scoped from per-topic — the queue is the
 * union of every domain topic's scheduling units plus unreferenced lexicon
 * entries). Grading goes through the same `recordGrade` as tasks; no attempt
 * is recorded (review isn't task completion). */
function ReviewSession({
  domainContent,
  topicsContent,
  store,
  lookup,
  onDone,
}: {
  domainContent: DomainContent;
  /** Every topic belonging to the domain. */
  topicsContent: Content[];
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
      topicsContent,
      domainContent.entries,
      store,
      new Date(),
      getPinnedTaskIds(domainId),
    ).then((due) => {
      if (cancelled) {
        return;
      }
      // buildReviewSession's `content` parameter is unused by the engine
      // (every field it needs lives on the units themselves); any topic
      // of the domain satisfies the type.
      const anyTopicContent = topicsContent[0];
      if (anyTopicContent === undefined) {
        setQuestions([]);
        return;
      }
      setQuestions(buildReviewSession(due, anyTopicContent, Math.random));
    });
    return () => {
      cancelled = true;
    };
  }, [domainContent, topicsContent, store]);

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
        <p>Nothing due right now.</p>
        <button onClick={onDone}>&larr; Back</button>
      </main>
    );
  }

  // Representative topic for asset resolution (`SessionScreen`'s single
  // `topicId` prop): every bundled domain ships exactly one topic today, so
  // this always resolves correctly. A future multi-topic domain would need
  // per-question topic resolution instead — out of scope for this step.
  const topicId = topicsContent[0]?.topic.id ?? domainId;

  return (
    <SessionScreen
      title="Review"
      questions={questions}
      topicId={topicId}
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
  topicId,
  mode,
  itemIds,
  lookup,
  onDone,
}: {
  domainContent: DomainContent;
  /** Representative topic of the domain, for `SessionScreen`'s asset resolution. */
  topicId: string;
  mode: AdhocMode;
  itemIds: string[];
  /** Tap-to-lookup dependencies (plan 0006 step 4), for post-answer reveal surfaces. */
  lookup: TapLookup;
  onDone: () => void;
}) {
  const domainId = domainContent.domain.id;
  const questions = useMemo(
    () => {
      // The domain's full lexicon (plan 0006), not one topic's items — a
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
      topicId={topicId}
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
  useEffect(() => {
    void contentInit.checkForUpdate().then(setUpdate);
  }, [contentInit]);
  async function handleAcceptUpdate() {
    if (update === null) {
      return;
    }
    setUpdating(true);
    setUpdateError(null);
    try {
      await contentInit.acceptUpdate(update);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
      setUpdating(false);
    }
  }

  const [screen, setScreen] = useState<Screen>({ screen: "topics" });
  // ponytail: welcome cover shows on every load (plan 0009); persist a
  // "seen" flag if the extra tap ever annoys.
  const [started, setStarted] = useState(false);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [content, setContent] = useState<Content | null>(null);
  // The active domain's content and every one of its topics (plan 0006):
  // loaded for the review/vocab/adhoc screens, which are domain-scoped and
  // may have no single topic in hand (reachable directly from the home
  // screen).
  const [domainContent, setDomainContent] = useState<DomainContent | null>(
    null,
  );
  const [domainTopicsContent, setDomainTopicsContent] = useState<Content[]>([]);
  // Every topic's full content, keyed by topic id (plan 0010): loaded
  // unconditionally once `topics` is populated, so `TopicListScreen` can show
  // per-topic lesson-completion progress without extending the lightweight
  // `TopicSummary`. Bundled content is already fully in memory, so loading
  // every topic up front costs nothing (`bundled.ts`'s `loadTopic` just wraps
  // an in-memory `Map`).
  const [topicsContentMap, setTopicsContentMap] = useState<
    Map<string, Content>
  >(new Map());
  const [attemptedTaskIds, setAttemptedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  // Bumped on every navigation to the topic screen, so it recomputes its
  // due-review count (which task/review sessions elsewhere may have changed).
  const [topicEpoch, setTopicEpoch] = useState(0);
  // Bumped whenever the Vocabulary screen adds/deletes a learner-created
  // word (plan 0006), so the domain-content effect below re-merges the
  // user entry store's current contents without requiring a navigation.
  const [domainEpoch, setDomainEpoch] = useState(0);
  // Bumped whenever a task's pinned state is toggled (plan 0008), so
  // UnitSession re-reads the pin store without requiring a navigation.
  const [pinEpoch, setPinEpoch] = useState(0);
  // The current topic's domain's pinned task ids, re-read whenever pinEpoch
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

  function goToTopic(topicId: string) {
    setTopicEpoch((epoch) => epoch + 1);
    setScreen({ screen: "topic", topicId });
  }

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    contentSourceResult.source.listTopics().then(setTopics);
    contentSourceResult.source.listDomains().then(setDomains);
    reloadAttemptedTaskIds();
  }, [contentSourceResult]);

  // Loads every topic's full content once `topics` is populated (plan 0010),
  // for TopicListScreen's per-topic progress bars — unconditional, not gated
  // on the active screen.
  useEffect(() => {
    if (!("source" in contentSourceResult) || topics.length === 0) {
      return;
    }
    let cancelled = false;
    Promise.all(
      topics.map((topic) => contentSourceResult.source.loadTopic(topic.id)),
    ).then((loaded) => {
      if (cancelled) {
        return;
      }
      setTopicsContentMap(
        new Map(
          loaded.map((topicContent) => [topicContent.topic.id, topicContent]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [contentSourceResult, topics]);

  // Per-topic lesson-completion counts (plan 0010), derived from
  // `topicsContentMap` + `attemptedTaskIds` via the same `isLessonComplete`
  // TopicScreen already uses.
  const topicProgress = useMemo(() => {
    const result = new Map<string, { completed: number; total: number }>();
    for (const [topicId, topicContent] of topicsContentMap) {
      const completed = topicContent.topic.lessonIds.filter((lessonId) => {
        const lesson = topicContent.lessons.find((l) => l.id === lessonId);
        return (
          lesson !== undefined &&
          isLessonComplete(lesson, topicContent.units, attemptedTaskIds)
        );
      }).length;
      result.set(topicId, {
        completed,
        total: topicContent.topic.lessonIds.length,
      });
    }
    return result;
  }, [topicsContentMap, attemptedTaskIds]);

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    if (
      screen.screen === "topic" ||
      screen.screen === "lesson" ||
      screen.screen === "unit" ||
      screen.screen === "task" ||
      screen.screen === "unit-session"
    ) {
      contentSourceResult.source.loadTopic(screen.topicId).then(setContent);
    }
  }, [contentSourceResult, screen]);

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    // Domain-scoped screens carry their domainId directly; topic/unit/task
    // screens derive it from the already-loaded topic summaries (plan
    // 0006's tap-to-lookup, step 4: those screens need the domain's merged
    // entry pool too, for notes and post-answer session reveals).
    const domainId =
      screen.screen === "review" ||
      screen.screen === "vocab" ||
      screen.screen === "adhoc"
        ? screen.domainId
        : screen.screen === "topic" ||
            screen.screen === "lesson" ||
            screen.screen === "unit" ||
            screen.screen === "task" ||
            screen.screen === "unit-session"
          ? topics.find((topic) => topic.id === screen.topicId)?.domainId
          : undefined;
    if (domainId === undefined) {
      return;
    }
    const domainTopicIds = topics
      .filter((topic) => topic.domainId === domainId)
      .map((topic) => topic.id);
    let cancelled = false;
    Promise.all([
      contentSourceResult.source.loadDomain(domainId),
      Promise.all(
        domainTopicIds.map((id) => contentSourceResult.source.loadTopic(id)),
      ),
      userEntryStore.getEntries(domainId),
    ]).then(([loadedDomainContent, loadedTopicsContent, userEntries]) => {
      if (cancelled) {
        return;
      }
      // Merge the domain's user-created entries into the shipped pool (plan
      // 0006): every downstream consumer (Vocabulary screen, ad-hoc session
      // builder, list pruning, review queue, TTS fallback) only ever sees
      // this merged `DomainContent`, so they all pick up user words for
      // free. Links are re-derived over the merged set too, so a link
      // authored from a user entry to a shipped one resolves correctly.
      const entries = [...loadedDomainContent.entries, ...userEntries];
      setDomainContent({
        ...loadedDomainContent,
        entries,
        linksByEntryId: symmetricLinks(entries),
      });
      setDomainTopicsContent(loadedTopicsContent);
    });
    return () => {
      cancelled = true;
    };
  }, [contentSourceResult, screen, topics, domainEpoch]);

  if ("errors" in contentSourceResult) {
    return <ErrorScreen errors={contentSourceResult.errors} />;
  }

  if (!started) {
    return <StartScreen onStart={() => setStarted(true)} />;
  }

  if (screen.screen === "topics") {
    const hasDownload =
      update !== null &&
      (update.changed.length > 0 || update.removedIds.length > 0);
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
        <TopicListScreen
          domains={domains}
          topics={topics}
          topicProgress={topicProgress}
          onSelectTopic={(topicId) => goToTopic(topicId)}
          onDomainVocabulary={(domainId) =>
            setScreen({ screen: "vocab", domainId })
          }
          onDomainReview={(domainId) =>
            setScreen({ screen: "review", domainId })
          }
        />
      </>
    );
  }

  if (
    screen.screen === "topic" ||
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

    if (screen.screen === "topic") {
      return (
        <TopicScreen
          content={content}
          attemptedTaskIds={attemptedTaskIds}
          store={progressStore}
          epoch={topicEpoch}
          onSelectLesson={(lessonId) =>
            setScreen({ screen: "lesson", topicId: screen.topicId, lessonId })
          }
          onPracticeTask={(target) =>
            setScreen({
              screen: "task",
              topicId: screen.topicId,
              ...target,
            })
          }
          onReview={() =>
            setScreen({ screen: "review", domainId: content.topic.domainId })
          }
          onVocabulary={() =>
            setScreen({ screen: "vocab", domainId: content.topic.domainId })
          }
          onBack={() => setScreen({ screen: "topics" })}
        />
      );
    }

    if (screen.screen === "lesson") {
      return (
        <LessonScreen
          content={content}
          lessonId={screen.lessonId}
          attemptedTaskIds={attemptedTaskIds}
          onSelectUnit={(unitId) =>
            setScreen({
              screen: "unit",
              topicId: screen.topicId,
              lessonId: screen.lessonId,
              unitId,
            })
          }
          onPracticeTask={(target) =>
            setScreen({
              screen: "task",
              topicId: screen.topicId,
              ...target,
            })
          }
          onBack={() => goToTopic(screen.topicId)}
        />
      );
    }

    if (screen.screen === "unit") {
      return (
        <UnitScreen
          content={content}
          unitId={screen.unitId}
          lookup={lookup}
          onPractice={() =>
            setScreen({
              screen: "unit-session",
              topicId: screen.topicId,
              lessonId: screen.lessonId,
              unitId: screen.unitId,
            })
          }
          onGradeNote={(noteId, grade) => {
            void recordGrade(
              progressStore,
              noteUnitId(noteId),
              recallQuality(grade),
              new Date(),
              content.topic.domainId,
            );
          }}
          onBack={() =>
            setScreen({
              screen: "lesson",
              topicId: screen.topicId,
              lessonId: screen.lessonId,
            })
          }
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
          onDone={() => {
            reloadAttemptedTaskIds();
            setScreen({
              screen: "unit",
              topicId: screen.topicId,
              lessonId: screen.lessonId,
              unitId: screen.unitId,
            });
          }}
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
    return (
      <TaskSession
        content={content}
        lookup={lookup}
        task={task}
        onDone={() => {
          reloadAttemptedTaskIds();
          setScreen({
            screen: "unit",
            topicId: screen.topicId,
            lessonId: screen.lessonId,
            unitId: screen.unitId,
          });
        }}
      />
    );
  }

  // screen.screen is "review" | "vocab" | "adhoc" — all domain-scoped.
  if (domainContent === null || domainTopicsContent.length === 0) {
    return <p>Loading&hellip;</p>;
  }
  const lookup: TapLookup = {
    domainContent,
    listStore: vocabListStore,
    userEntryStore,
    onWordsChanged: () => setDomainEpoch((epoch) => epoch + 1),
  };

  if (screen.screen === "vocab") {
    return (
      <VocabularyScreen
        topicsContent={domainTopicsContent}
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
        onBack={() => setScreen({ screen: "topics" })}
      />
    );
  }

  if (screen.screen === "adhoc") {
    const topicId = domainTopicsContent[0]?.topic.id ?? screen.domainId;
    return (
      <AdhocSession
        domainContent={domainContent}
        topicId={topicId}
        mode={screen.mode}
        itemIds={screen.itemIds}
        lookup={lookup}
        onDone={() => setScreen({ screen: "vocab", domainId: screen.domainId })}
      />
    );
  }

  return (
    <ReviewSession
      domainContent={domainContent}
      topicsContent={domainTopicsContent}
      store={progressStore}
      lookup={lookup}
      onDone={() => setScreen({ screen: "topics" })}
    />
  );
}

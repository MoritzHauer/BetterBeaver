import { useEffect, useMemo, useState } from "react";
import type { Content, Item, Task } from "@betterbeaver/schema";
import type {
  ContentSource,
  DomainContent,
  DomainSummary,
  ProgressStore,
  TopicSummary,
} from "@betterbeaver/engine";
import type { AdhocMode } from "@betterbeaver/engine";
import {
  ContentValidationError,
  buildAdhocSession,
  buildReviewSession,
  buildTaskSession,
  dueDomainUnits,
  recordGrade,
  symmetricLinks,
} from "@betterbeaver/engine";
import type { Quality } from "@betterbeaver/srs";
import type { TapLookup } from "./components/TappableText";
import { createBundledContentSource } from "./content/bundled";
import { resolvedLinksByEntryId } from "./content/links";
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { createLocalStorageVocabListStore } from "./progress/vocab-lists";
import { createLocalStorageUserEntryStore } from "./progress/user-entries";
import { TopicListScreen } from "./screens/TopicListScreen";
import { TopicScreen } from "./screens/TopicScreen";
import { UnitScreen } from "./screens/UnitScreen";
import { SessionScreen } from "./screens/SessionScreen";
import {
  ADHOC_MODE_LABELS,
  VocabularyScreen,
} from "./screens/VocabularyScreen";
import { ErrorScreen } from "./screens/ErrorScreen";

type Screen =
  | { screen: "topics" }
  | { screen: "topic"; topicId: string }
  | { screen: "unit"; topicId: string; unitId: string }
  | { screen: "task"; topicId: string; unitId: string; taskId: string }
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

export function App() {
  const contentSourceResult = useMemo((): ContentSourceResult => {
    try {
      return { source: createBundledContentSource() };
    } catch (error) {
      if (error instanceof ContentValidationError) {
        return { errors: error.errors };
      }
      throw error;
    }
  }, []);

  const [screen, setScreen] = useState<Screen>({ screen: "topics" });
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

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    if (
      screen.screen === "topic" ||
      screen.screen === "unit" ||
      screen.screen === "task"
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
            screen.screen === "unit" ||
            screen.screen === "task"
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

  if (screen.screen === "topics") {
    return (
      <TopicListScreen
        domains={domains}
        topics={topics}
        onSelectTopic={(topicId) => goToTopic(topicId)}
        onDomainVocabulary={(domainId) =>
          setScreen({ screen: "vocab", domainId })
        }
        onDomainReview={(domainId) => setScreen({ screen: "review", domainId })}
      />
    );
  }

  if (
    screen.screen === "topic" ||
    screen.screen === "unit" ||
    screen.screen === "task"
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
          onSelectUnit={(unitId) =>
            setScreen({ screen: "unit", topicId: screen.topicId, unitId })
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

    if (screen.screen === "unit") {
      return (
        <UnitScreen
          content={content}
          unitId={screen.unitId}
          attemptedTaskIds={attemptedTaskIds}
          lookup={lookup}
          onPractice={(taskId) =>
            setScreen({
              screen: "task",
              topicId: screen.topicId,
              unitId: screen.unitId,
              taskId,
            })
          }
          onBack={() => goToTopic(screen.topicId)}
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

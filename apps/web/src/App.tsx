import { useEffect, useMemo, useState } from "react";
import type { Content, Task } from "@betterbeaver/schema";
import type {
  ContentSource,
  ProgressStore,
  TopicSummary,
} from "@betterbeaver/engine";
import {
  ContentValidationError,
  buildReviewSession,
  buildTaskSession,
  dueUnits,
  recordGrade,
} from "@betterbeaver/engine";
import type { Quality } from "@betterbeaver/srs";
import { createBundledContentSource } from "./content/bundled";
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { TopicListScreen } from "./screens/TopicListScreen";
import { TopicScreen } from "./screens/TopicScreen";
import { UnitScreen } from "./screens/UnitScreen";
import { SessionScreen } from "./screens/SessionScreen";
import { ErrorScreen } from "./screens/ErrorScreen";

type Screen =
  | { screen: "topics" }
  | { screen: "topic"; topicId: string }
  | { screen: "unit"; topicId: string; unitId: string }
  | { screen: "task"; topicId: string; unitId: string; taskId: string }
  | { screen: "review"; topicId: string };

type ContentSourceResult = { source: ContentSource } | { errors: string[] };

const progressStore = createLocalStorageProgressStore();

/** Wires the engine's task-session building and grading to `SessionScreen`.
 * Questions are built once per mount (keyed by `task.id` via `useMemo`), so
 * they don't reshuffle across re-renders. An attempt is recorded only once
 * every question has been answered, matching the plan's completion rule. */
function TaskSession({
  content,
  task,
  onDone,
}: {
  content: Content;
  task: Task;
  onDone: () => void;
}) {
  const questions = useMemo(
    () => buildTaskSession(task, content, Math.random),
    // Keyed by taskId only: `content` is reloaded (new reference) on every
    // screen change, but the session must not reshuffle across re-renders.
    [task.id],
  );
  async function handleGrade(unitId: string, quality: Quality) {
    await recordGrade(progressStore, unitId, quality, new Date());
  }

  return (
    <SessionScreen
      title={task.instructions ?? `${task.type} practice`}
      questions={questions}
      topicId={content.topic.id}
      onGrade={handleGrade}
      onAllAnswered={() => void progressStore.markTaskAttempted(task.id)}
      onFinished={onDone}
      onExit={onDone}
    />
  );
}

/** Wires the engine's due-item queue and review-session building to
 * `SessionScreen`. Grading goes through the same `recordGrade` as tasks;
 * no attempt is recorded (review isn't task completion). */
function ReviewSession({
  content,
  store,
  onDone,
}: {
  content: Content;
  store: ProgressStore;
  onDone: () => void;
}) {
  const [questions, setQuestions] = useState<ReturnType<
    typeof buildReviewSession
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    dueUnits(content, store, new Date()).then((due) => {
      if (cancelled) {
        return;
      }
      setQuestions(buildReviewSession(due, content, Math.random));
    });
    return () => {
      cancelled = true;
    };
  }, [content, store]);

  function handleGrade(unitId: string, quality: Quality) {
    return recordGrade(store, unitId, quality, new Date()).then(
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

  return (
    <SessionScreen
      title="Review"
      questions={questions}
      topicId={content.topic.id}
      onGrade={handleGrade}
      onFinished={onDone}
      onExit={onDone}
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
  const [content, setContent] = useState<Content | null>(null);
  const [attemptedTaskIds, setAttemptedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  // Bumped on every navigation to the topic screen, so it recomputes its
  // due-review count (which task/review sessions elsewhere may have changed).
  const [topicEpoch, setTopicEpoch] = useState(0);

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
    reloadAttemptedTaskIds();
  }, [contentSourceResult]);

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    if (
      screen.screen === "topic" ||
      screen.screen === "unit" ||
      screen.screen === "task" ||
      screen.screen === "review"
    ) {
      contentSourceResult.source.loadTopic(screen.topicId).then(setContent);
    }
  }, [contentSourceResult, screen]);

  if ("errors" in contentSourceResult) {
    return <ErrorScreen errors={contentSourceResult.errors} />;
  }

  if (screen.screen === "topics") {
    return (
      <TopicListScreen
        topics={topics}
        onSelectTopic={(topicId) => goToTopic(topicId)}
      />
    );
  }

  if (content === null) {
    return <p>Loading&hellip;</p>;
  }

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
          setScreen({ screen: "review", topicId: screen.topicId })
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

  if (screen.screen === "task") {
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

  return (
    <ReviewSession
      content={content}
      store={progressStore}
      onDone={() => goToTopic(screen.topicId)}
    />
  );
}

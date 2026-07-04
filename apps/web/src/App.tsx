import { useEffect, useMemo, useState } from "react";
import type { Content } from "@betterbeaver/schema";
import type { ContentSource, TopicSummary } from "@betterbeaver/engine";
import { ContentValidationError } from "@betterbeaver/engine";
import { createBundledContentSource } from "./content/bundled";
import { createLocalStorageProgressStore } from "./progress/local-storage";
import { TopicListScreen } from "./screens/TopicListScreen";
import { TopicScreen } from "./screens/TopicScreen";
import { UnitScreen } from "./screens/UnitScreen";
import { ErrorScreen } from "./screens/ErrorScreen";

type Screen =
  | { screen: "topics" }
  | { screen: "topic"; topicId: string }
  | { screen: "unit"; topicId: string; unitId: string };

type ContentSourceResult = { source: ContentSource } | { errors: string[] };

const progressStore = createLocalStorageProgressStore();

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

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    contentSourceResult.source.listTopics().then(setTopics);
    progressStore
      .getAttemptedTaskIds()
      .then((ids) => setAttemptedTaskIds(new Set(ids)));
  }, [contentSourceResult]);

  useEffect(() => {
    if (!("source" in contentSourceResult)) {
      return;
    }
    if (screen.screen === "topic" || screen.screen === "unit") {
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
        onSelectTopic={(topicId) => setScreen({ screen: "topic", topicId })}
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
        onSelectUnit={(unitId) =>
          setScreen({ screen: "unit", topicId: screen.topicId, unitId })
        }
        onBack={() => setScreen({ screen: "topics" })}
      />
    );
  }

  return (
    <UnitScreen
      content={content}
      unitId={screen.unitId}
      onBack={() => setScreen({ screen: "topic", topicId: screen.topicId })}
    />
  );
}

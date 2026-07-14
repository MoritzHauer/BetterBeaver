import type { TopicSummary } from "@betterbeaver/engine";

/* ponytail: hardcoded glyph map — move onto the topic schema if topics
 * multiply beyond a handful. */
const TOPIC_GLYPHS: Record<string, string> = {
  kyrgyz: "\u{1F3D4}️",
  demo: "\u{1F9EA}",
};

export function TopicListScreen({
  topics,
  onSelectTopic,
}: {
  topics: TopicSummary[];
  onSelectTopic: (topicId: string) => void;
}) {
  return (
    <main>
      <h1>BetterBeaver</h1>
      <ul className="card-list">
        {topics.map((topic) => (
          <li key={topic.id} className="card">
            <button onClick={() => onSelectTopic(topic.id)}>
              <span className="topic-glyph" aria-hidden="true">
                {TOPIC_GLYPHS[topic.id] ?? "\u{1F4DA}"}
              </span>
              <strong>{topic.title}</strong>
              <p>{topic.description}</p>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

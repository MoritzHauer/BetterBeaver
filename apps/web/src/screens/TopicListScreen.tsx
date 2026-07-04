import type { TopicSummary } from "@betterbeaver/engine";

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
              <strong>{topic.title}</strong>
              <p>{topic.description}</p>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

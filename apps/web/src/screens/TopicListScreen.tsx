import type { DomainSummary, TopicSummary } from "@betterbeaver/engine";
import { ProgressBar } from "../components/ProgressBar";

/* ponytail: hardcoded glyph map — move onto the topic schema if topics
 * multiply beyond a handful. */
const TOPIC_GLYPHS: Record<string, string> = {
  kyrgyz: "\u{1F3D4}️",
  demo: "\u{1F9EA}",
};

/**
 * Home screen (plan 0006): topics grouped by their domain, with domain-level
 * Vocabulary/Review entries alongside the per-domain topic list — lists,
 * the review queue, and the streak are all domain-scoped now, so these are
 * reachable without first drilling into one of the domain's topics.
 */
export function TopicListScreen({
  domains,
  topics,
  topicProgress,
  onSelectTopic,
  onDomainVocabulary,
  onDomainReview,
}: {
  domains: DomainSummary[];
  topics: TopicSummary[];
  /** Per-topic lesson-completion counts (plan 0010), computed in `App.tsx`
   * from full topic content — not derivable from the lightweight
   * `TopicSummary` alone. Absent entries (still loading) render a 0-filled bar. */
  topicProgress: Map<string, { completed: number; total: number }>;
  onSelectTopic: (topicId: string) => void;
  onDomainVocabulary: (domainId: string) => void;
  onDomainReview: (domainId: string) => void;
}) {
  return (
    <main>
      <h1>BetterBeaver</h1>
      {domains.map((domain) => (
        <section key={domain.id}>
          <header className="screen-header">
            <h2>{domain.title}</h2>
            <div className="grade-buttons">
              <button
                className="plain"
                onClick={() => onDomainVocabulary(domain.id)}
              >
                Vocabulary
              </button>
              <button
                className="plain"
                onClick={() => onDomainReview(domain.id)}
              >
                Review
              </button>
            </div>
          </header>
          <ul className="card-list">
            {topics
              .filter((topic) => topic.domainId === domain.id)
              .map((topic) => {
                const progress = topicProgress.get(topic.id) ?? {
                  completed: 0,
                  total: 0,
                };
                return (
                  <li key={topic.id} className="card">
                    <button onClick={() => onSelectTopic(topic.id)}>
                      <span className="topic-glyph" aria-hidden="true">
                        {TOPIC_GLYPHS[topic.id] ?? "\u{1F4DA}"}
                      </span>
                      <strong>{topic.title}</strong>
                      <p>{topic.description}</p>
                      <ProgressBar
                        value={progress.completed}
                        max={progress.total}
                      />
                      <p className="status">
                        {progress.completed}/{progress.total}
                      </p>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </main>
  );
}

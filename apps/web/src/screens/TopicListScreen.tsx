import type { DomainSummary, TopicSummary } from "@betterbeaver/engine";

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
  onSelectTopic,
  onDomainVocabulary,
  onDomainReview,
}: {
  domains: DomainSummary[];
  topics: TopicSummary[];
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
              .map((topic) => (
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
        </section>
      ))}
    </main>
  );
}

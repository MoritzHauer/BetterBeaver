import type { DomainSummary, TopicSummary } from "@betterbeaver/engine";
import { ProgressBar } from "../components/ProgressBar";

/* ponytail: hardcoded glyph map — move onto the topic schema if topics
 * multiply beyond a handful. */
const TOPIC_GLYPHS: Record<string, string> = {
  kyrgyz: "\u{1F3D4}️",
  demo: "\u{1F9AB}",
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
  onAuthor,
  onOpenStats,
  onOpenSettings,
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
  /** Author entry (plan 0012); absent when the backend isn't configured. */
  onAuthor?: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <main>
      <header className="home-bar">
        <h1>BetterBeaver</h1>
        <div className="home-bar-actions">
          <button
            type="button"
            className="plain icon-button"
            onClick={onOpenStats}
            aria-label="Stats"
          >
            📊
          </button>
          <button
            type="button"
            className="plain icon-button"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>
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
                      {TOPIC_GLYPHS[topic.id] !== undefined ? (
                        <span className="topic-glyph" aria-hidden="true">
                          {TOPIC_GLYPHS[topic.id]}
                        </span>
                      ) : (
                        <img
                          className="topic-glyph"
                          src={`${import.meta.env.BASE_URL}art/icons/icon_book_front.png`}
                          alt=""
                        />
                      )}
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
      {onAuthor !== undefined && (
        <p className="author-entry">
          <button className="plain" onClick={onAuthor}>
            ✏️ Edit content
          </button>
        </p>
      )}
    </main>
  );
}

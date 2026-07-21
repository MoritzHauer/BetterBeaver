import type { DomainSummary, BookSummary } from "@betterbeaver/engine";
import { ProgressBar } from "../components/ProgressBar";

/* ponytail: hardcoded glyph map — move onto the book schema if books
 * multiply beyond a handful. */
const BOOK_GLYPHS: Record<string, string> = {
  kyrgyz: "\u{1F3D4}️",
  demo: "\u{1F9AB}",
};

/**
 * Home screen (plan 0006): books grouped by their domain, with domain-level
 * Vocabulary/Review entries alongside the per-domain book list — lists,
 * the review queue, and the streak are all domain-scoped now, so these are
 * reachable without first drilling into one of the domain's books.
 */
export function MyBooksScreen({
  domains,
  books,
  bookProgress,
  onSelectBook,
  onDomainVocabulary,
  onDomainReview,
  onAuthor,
  onOpenStats,
  onOpenSettings,
}: {
  domains: DomainSummary[];
  books: BookSummary[];
  /** Per-book lesson-completion counts (plan 0010), computed in `App.tsx`
   * from full book content — not derivable from the lightweight
   * `BookSummary` alone. Absent entries (still loading) render a 0-filled bar. */
  bookProgress: Map<string, { completed: number; total: number }>;
  onSelectBook: (bookId: string) => void;
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
            {books
              .filter((book) => book.domainId === domain.id)
              .map((book) => {
                const progress = bookProgress.get(book.id) ?? {
                  completed: 0,
                  total: 0,
                };
                return (
                  <li key={book.id} className="card">
                    <button onClick={() => onSelectBook(book.id)}>
                      {BOOK_GLYPHS[book.id] !== undefined ? (
                        <span className="topic-glyph" aria-hidden="true">
                          {BOOK_GLYPHS[book.id]}
                        </span>
                      ) : (
                        <img
                          className="topic-glyph"
                          src={`${import.meta.env.BASE_URL}art/icons/icon_book_front.png`}
                          alt=""
                        />
                      )}
                      <strong>{book.title}</strong>
                      <p>{book.description}</p>
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

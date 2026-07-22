import type { BookSummary } from "@betterbeaver/engine";
import { ProgressBar } from "../components/ProgressBar";

/**
 * Home screen (plan 0015): My Books — added Books only, flat (no domain
 * grouping; Vocabulary/Review live on each Book's own screen). Broken added
 * Books (failed validation, or missing cached documents) get a card here
 * too, offering Remove instead of study. Archived Books collapse into a
 * section at the bottom with Restore/Remove. The Library is the only way
 * in — reachable via the prominent entry card, hidden when unconfigured.
 */
export function MyBooksScreen({
  books,
  bookProgress,
  broken,
  archivedBooks,
  onSelectBook,
  onArchive,
  onRestore,
  onRemove,
  onLibrary,
  onAuthor,
  onOpenStats,
  onOpenSettings,
}: {
  books: BookSummary[];
  /** Per-book lesson-completion counts (plan 0010), computed in `App.tsx`
   * from full book content — not derivable from the lightweight
   * `BookSummary` alone. Absent entries (still loading) render a 0-filled bar. */
  bookProgress: Map<string, { completed: number; total: number }>;
  /** Added Books that failed to load (plan 0015 decision 11a); `title`
   * falls back to the bare id when the cache has no doc to read one from. */
  broken: { bookId: string; errors: string[]; title: string }[];
  archivedBooks: {
    id: string;
    title: string;
    description: string;
    icon?: string;
  }[];
  onSelectBook: (bookId: string) => void;
  onArchive: (bookId: string) => void;
  onRestore: (bookId: string) => void;
  onRemove: (bookId: string) => Promise<void>;
  /** The Library entry point; absent when the backend isn't configured (plan 0015 decision 15). */
  onLibrary?: () => void;
  /** Author entry (plan 0012); absent when the backend isn't configured. */
  onAuthor?: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}) {
  function handleRemove(bookId: string) {
    if (
      !window.confirm(
        "This removes the downloaded book from this device. Your learning progress is kept, and restored if you add it again. Continue?",
      )
    ) {
      return;
    }
    void onRemove(bookId);
  }

  const empty = books.length === 0 && broken.length === 0;

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
      <ul className="card-list">
        {onLibrary !== undefined && (
          <li className="card primary">
            <button onClick={onLibrary}>
              <strong>📚 Library</strong>
              <p className="status">Browse and add Books</p>
            </button>
          </li>
        )}
        {books.map((book) => {
          const progress = bookProgress.get(book.id) ?? {
            completed: 0,
            total: 0,
          };
          return (
            <li key={book.id} className="card">
              <button onClick={() => onSelectBook(book.id)}>
                {book.icon !== undefined && (
                  <span className="topic-glyph" aria-hidden="true">
                    {book.icon}
                  </span>
                )}
                <strong>{book.title}</strong>
                <p>{book.description}</p>
                <ProgressBar value={progress.completed} max={progress.total} />
                <p className="status">
                  {progress.completed}/{progress.total}
                </p>
              </button>
              <details className="card-menu">
                <summary aria-label="More actions">⋯</summary>
                <div className="grade-buttons">
                  <button className="plain" onClick={() => onArchive(book.id)}>
                    Archive
                  </button>
                  <button
                    className="plain danger"
                    onClick={() => handleRemove(book.id)}
                  >
                    Remove
                  </button>
                </div>
              </details>
            </li>
          );
        })}
        {broken.map(({ bookId, errors, title }) => {
          const missingDocs = errors.some((e) =>
            e.includes("missing cached content"),
          );
          return (
            <li key={bookId} className="card">
              <div>
                <strong>{title}</strong>
                <p className="error-text">This Book can't be loaded.</p>
                {missingDocs && (
                  <p className="status">
                    Try removing it and re-adding it from the Library.
                  </p>
                )}
                <button
                  className="plain danger"
                  onClick={() => handleRemove(bookId)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {empty && onLibrary !== undefined && (
        <p className="empty-state">
          Add a Book from the Library to get started.
        </p>
      )}

      {archivedBooks.length > 0 && (
        <details className="archive-section">
          <summary>Archive ({archivedBooks.length})</summary>
          <ul className="card-list">
            {archivedBooks.map((book) => (
              <li key={book.id} className="card">
                <div>
                  {book.icon !== undefined && (
                    <span className="topic-glyph" aria-hidden="true">
                      {book.icon}
                    </span>
                  )}
                  <strong>{book.title}</strong>
                  <p>{book.description}</p>
                  <div className="grade-buttons">
                    <button
                      className="plain"
                      onClick={() => onRestore(book.id)}
                    >
                      Restore
                    </button>
                    <button
                      className="plain danger"
                      onClick={() => handleRemove(book.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

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

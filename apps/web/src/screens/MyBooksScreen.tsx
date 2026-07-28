import type { BookSummary } from "@betterbeaver/engine";
import { ProgressBar } from "../components/ProgressBar";
import { showsCoverArt } from "../components/BookWatermark";
import { readPrivateBook } from "../content/private-store";
import { exportPrivateBook } from "../content/private-transfer";

/**
 * Home screen (plan 0015): My Books — added Books only, flat (no domain
 * grouping — the old per-domain header's Vocabulary/Review buttons move onto
 * each card instead, since there's no header row left to hang them off of).
 * Broken added Books (failed validation, or missing cached documents) get a
 * card here too, offering Remove instead of study/Vocabulary/Review.
 * Archived Books collapse into a section at the bottom with Restore/Remove.
 * The Library is the only way in — reachable via the prominent entry card,
 * hidden when unconfigured.
 */
export function MyBooksScreen({
  books,
  bookProgress,
  broken,
  archivedBooks,
  privateBookIds,
  onSelectBook,
  onVocabulary,
  onReview,
  onPlay,
  onArchive,
  onRestore,
  onRemove,
  onEdit,
  onLibrary,
  onCreateBook,
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
  /** Ids currently in the private store (plan 0017 §3) — drives the card's
   * `private` marker, its Export action, and Remove's branched confirm
   * (spec 0017-5). */
  privateBookIds: Set<string>;
  onSelectBook: (bookId: string) => void;
  /** Domain-scoped (plan 0006); reached per-card now that the front list is
   * flat (no more domain-header row to hang these off of). */
  onVocabulary: (domainId: string) => void;
  onReview: (domainId: string) => void;
  /** Resolves what to study next and navigates there (plan 0020 §2): due
   * review, else the next incomplete unit, else the Book's trophy state. */
  onPlay: (bookId: string) => void;
  onArchive: (bookId: string) => void;
  onRestore: (bookId: string) => void;
  onRemove: (bookId: string) => Promise<void>;
  /** Opens a private Book in the editor — the only way back into one whose
   * card is broken (there is no book screen to reach ✎ from). */
  onEdit?: (bookId: string) => void;
  /** The Library entry point; absent when the backend isn't configured (plan 0015 decision 15). */
  onLibrary?: () => void;
  /** Creates a private Book (plan 0017 §3) — unlike Library/Author, needs no
   * backend, so its card is always shown, offline included. */
  onCreateBook?: () => void;
  /** Author entry (plan 0012); absent when the backend isn't configured. */
  onAuthor?: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}) {
  function handleRemove(bookId: string, title: string) {
    // A private Book has nothing to re-download from (spec 0017-5 §5) — the
    // public copy's "restored if you add it again" promise is false for it.
    const message = privateBookIds.has(bookId)
      ? `"${title}" only exists on this device. Removing it deletes it permanently — it cannot be downloaded again. Your learning progress is kept. Export it first if you want a copy. Continue?`
      : "This removes the downloaded book from this device. Your learning progress is kept, and restored if you add it again. Continue?";
    if (!window.confirm(message)) {
      return;
    }
    void onRemove(bookId);
  }

  async function handleExport(bookId: string) {
    // `readPrivateBook` returns undefined on a miss AND on any IndexedDB
    // failure (it swallows errors, like the rest of private-store.ts). The
    // card only renders Export for an id `privateBookIds` says exists, so
    // undefined here means the store went unreadable — silently doing
    // nothing rather than downloading a broken file.
    const record = await readPrivateBook(bookId);
    if (record !== undefined) {
      await exportPrivateBook(record);
    }
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
            <img
              src={`${import.meta.env.BASE_URL}art/icons/chart.png`}
              alt=""
            />
          </button>
          <button
            type="button"
            className="plain icon-button"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <img
              src={`${import.meta.env.BASE_URL}art/icons/config.png`}
              alt=""
            />
          </button>
        </div>
      </header>
      <ul className="card-list">
        {onLibrary !== undefined && (
          <li className="card primary">
            <button onClick={onLibrary}>
              <strong>
                <img
                  className="card-art"
                  src={`${import.meta.env.BASE_URL}art/icons/beaver_bookshelf.png`}
                  alt=""
                />{" "}
                Library
              </strong>
              <p className="status">Browse and add Books</p>
            </button>
          </li>
        )}
        <li className="card primary">
          <button onClick={onCreateBook}>
            <strong>
              <img
                className="card-art"
                src={`${import.meta.env.BASE_URL}art/icons/beaver_desk.png`}
                alt=""
              />{" "}
              Create a Book
            </strong>
            <p className="status">
              Write your own — stays on this device, no account needed
            </p>
          </button>
        </li>
        {books.map((book) => {
          const progress = bookProgress.get(book.id) ?? {
            completed: 0,
            total: 0,
          };
          const cover = showsCoverArt(book.id, book.hasCoverArt);
          return (
            <li key={book.id} className={cover ? "card card-bg-cover" : "card"}>
              {cover && (
                <img
                  className="card-bg-icon"
                  src={`${import.meta.env.BASE_URL}art/icons/${book.id}.png`}
                  alt=""
                  aria-hidden="true"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <button onClick={() => onSelectBook(book.id)}>
                <span className="book-title-row">
                  {book.icon !== undefined && (
                    <span className="book-icon" aria-hidden="true">
                      {book.icon}
                    </span>
                  )}
                  <strong>{book.title}</strong>
                  {privateBookIds.has(book.id) && (
                    <span className="status">private</span>
                  )}
                </span>
                <p>{book.description}</p>
                <ProgressBar value={progress.completed} max={progress.total} />
                <p className="status">
                  {progress.completed}/{progress.total}
                </p>
              </button>
              <div className="book-actions">
                <button
                  type="button"
                  className="plain icon-button vocab-btn"
                  onClick={() => onVocabulary(book.domainId)}
                  aria-label="Vocabulary"
                >
                  <img
                    src={`${import.meta.env.BASE_URL}art/icons/book_front.png`}
                    alt=""
                  />
                </button>
                <button
                  type="button"
                  className="plain icon-button review-btn"
                  onClick={() => onReview(book.domainId)}
                  aria-label="Daily Review"
                >
                  <img
                    src={`${import.meta.env.BASE_URL}art/icons/repeat.png`}
                    alt=""
                  />
                </button>
                <button
                  type="button"
                  className="plain icon-button play-btn"
                  onClick={() => onPlay(book.id)}
                  aria-label="Continue"
                >
                  <img
                    src={`${import.meta.env.BASE_URL}art/icons/play.png`}
                    alt=""
                  />
                </button>
              </div>
              <details className="card-menu">
                <summary aria-label="More actions">⋯</summary>
                <div className="grade-buttons">
                  {privateBookIds.has(book.id) && (
                    <button
                      className="plain"
                      onClick={() => void handleExport(book.id)}
                    >
                      Export
                    </button>
                  )}
                  <button className="plain" onClick={() => onArchive(book.id)}>
                    Archive
                  </button>
                  <button
                    className="plain danger"
                    onClick={() => handleRemove(book.id, book.title)}
                  >
                    Remove
                  </button>
                </div>
              </details>
            </li>
          );
        })}
        {broken.map(({ bookId, errors, title }) => {
          // A private Book still in the store failed validation, not loading:
          // its only copy is right here, so it gets Export (rescue the data)
          // and Edit (fix the errors) — otherwise Remove, which destroys it
          // permanently, would be the only offered action.
          const isPrivate = privateBookIds.has(bookId);
          const missingDocs = errors.some((e) =>
            e.includes("missing cached content"),
          );
          return (
            <li key={bookId} className="card">
              <div>
                <strong>{title}</strong>
                <p className="error-text">This Book can't be loaded.</p>
                {errors.length > 0 && (
                  <p className="status">{errors.join("; ")}</p>
                )}
                {missingDocs && !isPrivate && (
                  <p className="status">
                    Try removing it and re-adding it from the Library.
                  </p>
                )}
                {isPrivate && (
                  <button
                    className="plain"
                    onClick={() => void handleExport(bookId)}
                  >
                    Export
                  </button>
                )}
                {isPrivate && onEdit !== undefined && (
                  <button className="plain" onClick={() => onEdit(bookId)}>
                    Edit
                  </button>
                )}
                <button
                  className="plain danger"
                  onClick={() => handleRemove(bookId, title)}
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
                      onClick={() => handleRemove(book.id, book.title)}
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
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/edit.png`}
              alt=""
            />{" "}
            Edit content
          </button>
        </p>
      )}
    </main>
  );
}

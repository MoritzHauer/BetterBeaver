import { useEffect, useState } from "react";
import { fetchLibrary, type LibraryBook } from "../content/library";

/**
 * The Library (plan 0015): browse the full catalog and Add a Book into My
 * Books. Live metadata only — the full content downloads on Add. Reached
 * from My Books; hidden entirely when Supabase is unconfigured (App.tsx
 * gates the entry point the same way it gates the author entry).
 */
export function LibraryScreen({
  addBook,
  memberBookIds,
  onBack,
}: {
  addBook: (bookId: string, domainId: string) => Promise<void>;
  /** Already added or archived — rendered as a disabled "Added" state instead of an Add button. */
  memberBookIds: ReadonlySet<string>;
  onBack: () => void;
}) {
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addErrors, setAddErrors] = useState<Map<string, string>>(new Map());

  function load() {
    setBooks(null);
    setError(null);
    fetchLibrary().then(setBooks, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }
  useEffect(load, []);

  async function handleAdd(book: LibraryBook) {
    setAddingId(book.id);
    setAddErrors((prev) => {
      const next = new Map(prev);
      next.delete(book.id);
      return next;
    });
    try {
      await addBook(book.id, book.domainId);
      // Success reloads the app (ContentInit.addBook) — no further state
      // update needed here.
    } catch (e) {
      setAddErrors((prev) =>
        new Map(prev).set(book.id, e instanceof Error ? e.message : String(e)),
      );
      setAddingId(null);
    }
  }

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          My Books
        </button>
        <h1>Library</h1>
      </header>

      {error !== null && (
        <div className="card">
          <p className="error-text">{error}</p>
          <button className="plain" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {books === null && error === null && <p>Loading&hellip;</p>}

      {books !== null && (
        <ul className="card-list">
          {books.map((book) => {
            const isMember = memberBookIds.has(book.id);
            const busy = addingId === book.id;
            const addError = addErrors.get(book.id);
            const showRating = book.upvotes > 0 || book.downvotes > 0;
            return (
              <li key={book.id} className="card">
                <div>
                  {book.icon !== undefined && (
                    <span className="topic-glyph" aria-hidden="true">
                      {book.icon}
                    </span>
                  )}
                  <strong>{book.title}</strong>
                  <p>{book.description}</p>
                  {showRating && (
                    <p className="status">
                      <img
                        className="icon-glyph"
                        src={`${import.meta.env.BASE_URL}art/icons/thumbs_up.png`}
                        alt=""
                      />{" "}
                      {book.upvotes} ·{" "}
                      <img
                        className="icon-glyph"
                        src={`${import.meta.env.BASE_URL}art/icons/thumbs_down.png`}
                        alt=""
                      />{" "}
                      {book.downvotes}
                    </p>
                  )}
                  {addError !== undefined && (
                    <p className="error-text">{addError}</p>
                  )}
                  {isMember ? (
                    <button className="plain" disabled>
                      Added
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void handleAdd(book)}
                    >
                      {busy ? "Adding…" : "Add"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/**
 * Does this Book show its cover art (`art/icons/<id>.png`) behind its card?
 * The `hasCoverArt` flag, plus one legacy id — the live Kyrgyz Book predates
 * the flag and its published document doesn't set it.
 * ponytail: drop the id once that document ticks "Cover art" in the editor.
 */
export function showsCoverArt(bookId: string, flag?: boolean): boolean {
  return flag === true || bookId === "kyrgyz";
}

/**
 * Viewport-pinned decorative watermark, shown on every screen inside the
 * Kyrgyz book. ponytail: per-book id check, not a schema field — promote to
 * a general Book field if more books want this.
 */
export function BookWatermark({ bookId }: { bookId: string }) {
  if (bookId !== "kyrgyz") {
    return null;
  }
  return (
    <img
      className="book-bg-icon"
      src={`${import.meta.env.BASE_URL}art/icons/kyrgyz.png`}
      alt=""
      aria-hidden="true"
    />
  );
}

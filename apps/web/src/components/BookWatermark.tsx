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

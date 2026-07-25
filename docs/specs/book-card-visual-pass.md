# Spec: My Books / BookScreen card visual pass

Four bundled fixes to the book cards on `MyBooksScreen` and `BookScreen`, plus a small palette addition. No open design decisions — all four were resolved by owner grilling; implement as specified.

## Context (read first)

- `apps/web/src/screens/MyBooksScreen.tsx` — the My Books home list, per-book `<li className="card">`, the `.book-actions` Vocabulary/Review icon chips, the Kyrgyz-only background watermark.
- `apps/web/src/screens/BookScreen.tsx` — the per-book screen's own Review/Practice/Vocabulary cards (`<ul className="card-list">`, ~lines 152-194).
- `apps/web/src/styles.css` — `:root`/`:root[data-theme="dark"]` token blocks (~lines 38-97), `.card`/`.card-bg-kyrgyz`/`.card-bg-icon` (~195-226), `.book-actions` (~344-363).
- `packages/schema/src/entities.ts` — `bookSchema`, `BOOK_ICONS` (plan 0015 precedent for an owner-approved enum field).
- `packages/schema/src/documents.ts` — `CONTENT_SCHEMA_VERSION` bump rule and its plan-0015 §6a exemption for additive optional fields.
- `docs/specs/0015-book-icon-field.md` — the closest precedent spec for adding a Book field; mirror its shape (schema, no version bump, no new validator rule).

## 1. Fix `.book-actions` vertical alignment on My Books

**Bug**: `.book-actions` uses a fixed `top: 0.75rem`, independent of the button's own `padding: 1rem` and of whether the book has an icon. `.topic-glyph` (used for the book's emoji icon) is `display: block; margin-bottom: 0.25rem`, stacking the icon _above_ the title — so the title (and the chips meant to align with it) shift down whenever a book has an icon.

Fix by keeping icon and title in one row instead of stacked, so the title's vertical position is constant regardless of icon presence — then the chips can align to a fixed offset that actually matches. Scope this to `MyBooksScreen` only; do not touch the shared `.topic-glyph` class (it's also used, unaffected, by `BookScreen`'s Vocabulary card icon — changing it would regress that card's current look, which nobody asked for).

In `MyBooksScreen.tsx`, wrap the icon + title in a new row span instead of two stacked siblings:

```jsx
<button onClick={() => onSelectBook(book.id)}>
  <span className="book-title-row">
    {book.icon !== undefined && (
      <span className="book-icon" aria-hidden="true">{book.icon}</span>
    )}
    <strong>{book.title}</strong>
  </span>
  <p>{book.description}</p>
  ...
```

New CSS:

```css
.book-title-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.book-icon {
  font-size: 1.5rem;
  line-height: 1;
}
```

Change `.book-actions`'s `top: 0.75rem` to `top: 1rem` (matching the button's own `padding: 1rem`, so the chips sit level with `.book-title-row` regardless of whether an icon is present).

## 2. Promote the book cover watermark to a general field, fix its opacity

Today the watermark (`kyrgyz.png` behind the card, `opacity: 0.16`, `z-index: -1`) is hardcoded to `book.id === "kyrgyz"`, flagged in a `ponytail:` comment as a one-off to promote if more books want it.

The asset-upload pipeline (`docs/specs/0012-asset-pipeline.md`) hasn't landed yet, so authoring stays convention-based, not an editor upload: a book opts in with a boolean field, and the image must already exist in the repo at a fixed path — no new asset directory, reuse today's actual location.

### `packages/schema/src/entities.ts`

```ts
/** Whether a decorative cover-art watermark renders behind this book's My
 * Books card (plan-less UI polish batch, 2026-07-25). The image itself is
 * NOT part of content — it must exist at `art/icons/<book.id>.png` in the
 * web app's public assets (same convention/location the one-off Kyrgyz
 * watermark already used); this field only toggles whether it's shown. */
hasCoverArt: z.boolean().optional(),
```

Add to `bookSchema`, same file/area as the existing `icon` field.

### `packages/schema/src/documents.ts`

Per the plan-0015 §6a exemption already documented in the `CONTENT_SCHEMA_VERSION` comment (additive optional field, non-strict parsing ignores it harmlessly): **do not bump `CONTENT_SCHEMA_VERSION`** for this change. No new validator rule needed — the boolean is the whole rule, same as `icon`'s enum.

### `apps/web/src/screens/EditScreen.tsx` — editor checkbox

The existing book-root field system (`FieldSpec`/`Field`/`getPath`/`setPath`, ~lines 43-169) is string-typed only (used for `title`/`description`/`icon`'s `<select>`) — don't stretch it to cover a boolean. Add one small dedicated checkbox next to the `EntityForm` call in the book-root view (~line 1010-1020), same "absent means unset" convention as the rest of the form (unchecking removes the key rather than writing `false`):

```jsx
<label className="field">
  Cover art
  <input
    type="checkbox"
    checked={book.hasCoverArt === true}
    onChange={(e) => {
      const { hasCoverArt: _drop, ...rest } = book as Record<string, unknown>;
      onChange({
        ...doc,
        topic: e.target.checked ? { ...book, hasCoverArt: true } : rest,
      });
    }}
  />
</label>
```

(Adjust to whatever local typing the surrounding `book`/`doc`/`onChange` already use in that view — match the existing style, this is illustrative.)

### `apps/web/src/screens/MyBooksScreen.tsx`

Replace the hardcoded `book.id === "kyrgyz"` checks with `book.hasCoverArt === true`, and the hardcoded `kyrgyz.png` filename with `${book.id}.png`:

```jsx
<li
  key={book.id}
  className={book.hasCoverArt === true ? "card card-bg-cover" : "card"}
>
  {book.hasCoverArt === true && (
    <img
      className="card-bg-icon"
      src={`${import.meta.env.BASE_URL}art/icons/${book.id}.png`}
      alt=""
      aria-hidden="true"
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  )}
```

The `onError` handler is new and necessary now that the field is data-driven: a book can declare `hasCoverArt` without its PNG actually existing (no upload pipeline to enforce the pairing), so a missing asset must fail silently instead of showing a broken-image icon.

### `apps/web/src/styles.css`

Rename `.card-bg-kyrgyz` → `.card-bg-cover` (drop the per-book name now that it's data-driven; keep the existing `position: relative; z-index: 0; overflow: hidden` and its stacking-context comment). Add a translucent background _scoped to this class only_ — not to `.card` generally, which is shared by Settings sections, `.card.correct`/`.card.incorrect`, `.card.recall`, and every plain list row:

```css
.card-bg-cover {
  position: relative;
  z-index: 0;
  overflow: hidden;
  background: var(--card-bg-translucent);
}
```

Add the new token to both palette blocks, matching the existing convention of explicit `rgba()` literals for translucent surfaces (see `--correct-bg`/`--incorrect-bg`) rather than `color-mix()`:

```css
/* :root (light) */
--card-bg-translucent: rgba(
  248,
  244,
  238,
  0.9
); /* --card-bg (#f8f4ee) at ~90% */
```

```css
/* :root[data-theme="dark"] */
--card-bg-translucent: rgba(34, 30, 23, 0.9); /* --card-bg (#221e17) at ~90% */
```

Bump `.card-bg-icon`'s `opacity` from `0.16` to `0.28` (modest increase, paired with the background translucency rather than relying on either alone).

## 3. Rename "Review" → "Daily Review", add a description

Word-level rename only. Do **not** rename anything in code — `screen: "review"`, `buildReviewSession`, `onReview`, the `.card.review` class, `dueDomainUnits`, etc. all keep their existing identifiers. Grep for the user-facing string `Review` under `apps/web/src` before finishing to make sure every visible instance is caught (expect: `BookScreen.tsx`'s card `<strong>`, `MyBooksScreen.tsx`'s `aria-label`).

### `apps/web/src/screens/BookScreen.tsx`

```jsx
<li className={`card review${dueCount !== 0 ? " primary" : ""}`}>
  <button onClick={onReview} disabled={dueCount === 0}>
    <strong>Daily Review</strong>
    {dueCount !== null && dueCount > 0 ? (
      <span className="badge">{dueCount}</span>
    ) : null}
    <p>Repeat previous units due for review, spaced out over time.</p>
    <p className="status">
      {dueCount === null
        ? "Loading…"
        : dueCount === 0
          ? "Nothing due"
          : `${dueCount} due`}
    </p>
  </button>
</li>
```

The new `<p>` (no class — plain body text, distinct from `.status`'s small-caps styling) is the description; it sits above the existing dynamic due-count status line, which is untouched.

### `apps/web/src/screens/MyBooksScreen.tsx`

Icon-only chip stays icon-only (confirmed: no tooltip/label added here, description lives on `BookScreen` only) — just update the label:

```jsx
aria-label="Daily Review"
```

Leave the `repeat.png` icon as-is — an icon swap wasn't requested and isn't in scope here.

## 4. Distinct background colors: Practice (amber, unchanged) / Daily Review (teal) / Vocabulary (steel blue)

New tokens, both palette blocks, following the existing `--recall`-style pattern (a saturated fill + white/dark text in light mode, a lighter tint + dark text in dark mode):

```css
/* :root (light) */
--review: #2f7a72;
--on-review: #ffffff;
--review-pressed: #24625c;
--vocab: #3a628f;
--on-vocab: #ffffff;
--vocab-pressed: #2c4d70;
```

```css
/* :root[data-theme="dark"] */
--review: #7fd6c9;
--on-review: #123330;
--review-pressed: #a0e8dd;
--vocab: #8ec2ee;
--on-vocab: #16324a;
--vocab-pressed: #b0d8f5;
```

(`-pressed` mirrors `--primary-pressed`'s convention: darker than the base in light mode, lighter in dark mode, for the active/press state.)

### `BookScreen.tsx` / `styles.css`

`.card.review.primary` currently falls through to the generic `.primary` amber fill — add a dedicated rule (higher specificity, so it wins regardless of source order; place near the existing `.card.recall` block):

```css
.card.review.primary {
  background: var(--review);
  border-color: var(--review);
  color: var(--on-review);
}
```

Vocabulary's `BookScreen` card (`<li className="card">`, always available, never gated) gets a permanent fill — add a `vocab` class:

```jsx
<li className="card vocab">
  <button onClick={onVocabulary}>
```

```css
.card.vocab {
  background: var(--vocab);
  border-color: var(--vocab);
  color: var(--on-vocab);
}
```

Practice's card is unchanged — it keeps the plain `.primary` amber fill.

### `MyBooksScreen.tsx` / `styles.css`

Give the two `.book-actions` chips their own classes instead of sharing one amber default:

```jsx
<button ... className="plain icon-button vocab-btn" aria-label="Vocabulary">
...
<button ... className="plain icon-button review-btn" aria-label="Daily Review">
```

Replace the shared `background: var(--primary)` rule with per-class rules:

```css
.book-actions .vocab-btn {
  background: var(--vocab);
  color: var(--on-vocab);
}
.book-actions .vocab-btn:active:not(:disabled) {
  background: var(--vocab-pressed);
}
.book-actions .review-btn {
  background: var(--review);
  color: var(--on-review);
}
.book-actions .review-btn:active:not(:disabled) {
  background: var(--review-pressed);
}
```

(Drop the old shared `.book-actions button { background: var(--primary); ... }` / `:active` rules they replace.)

## Done criteria

1. `corepack pnpm check` green.
2. A schema unit test asserting `hasCoverArt` parses when present (`true`/`false`) and absent — colocate with `packages/schema/src/validate.test.ts`'s existing `describe("bookSchema icon (plan 0015 decision 6)", ...)` block (~line 983), same file, same pattern.
3. Browser pass via the `apps/web:verify` skill, both themes: My Books chips align level with the title row on a book with and without an icon; the (repo's own onboarding/Kyrgyz) cover watermark is visibly more present than before without washing out card text; a book with `hasCoverArt: true` but a missing PNG shows no broken-image icon; BookScreen's Daily Review/Vocabulary cards and My Books' chips show the three distinct colors (amber/teal/steel-blue) with legible text in both light and dark mode; the due-count badge and status text stay legible against the new teal Review fill.

## Out of scope

The asset-upload pipeline (the cover PNG itself is still placed in the repo by hand, at the fixed `art/icons/<book.id>.png` convention path — the new editor control only toggles the boolean flag, it does not upload an image). Changing the Review icon. Any `CONTENT_SCHEMA_VERSION` bump or content republish.

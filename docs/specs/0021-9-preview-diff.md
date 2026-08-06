# Spec 0021-9: Preview, Diff, and the What-changed index

Slice 9 of [plan 0021](../plans/0021-in-place-editing.md) (§10). Depends on **slices 4–8**. Self-contained per the `/delegate` convention; **make no new design choices**.

The second half of the vision: see the draft as a learner will, and see exactly what publishing would change.

## Context (read first)

- `packages/engine/src/documentSource.ts` — `createDocumentContentSource` (166–190) and `AssetStems`.
- `packages/engine/src/documentDiff.ts` (173) — **whole.** Its `canonicalJson` is reused; its output shape is not.
- `packages/engine/src/interfaces.ts` — `ProgressStore` (56–65), for the no-op stub.
- `packages/engine/src/noteBlocks.ts` — slice 1's parser, for block-level note diffing.
- `apps/web/src/backend/publishCheck.ts` (~90) — `validateForPublish`, the assembly pattern Preview mirrors.
- `apps/web/src/backend/storage.ts` — `listDocumentAssets` / `assetStemsFromListing`, for §1a.
- `apps/web/src/screens/edit/EditSession.tsx` — slice 5's context, which gains the mode switch.
- The three learner screens, post-slices 6–7.

~1100 lines. Inside budget.

## Not in this slice

Word-level diffing. Diff in private Books (they have no base — plan decision 10). Publish-error deep-linking (slice 10).

---

## 1. Preview

A mode on all three screens. It builds a real `createDocumentContentSource(draftBooks, draftDomains, assets)` over the session's two working documents and renders the learner screens against it, with a **no-op in-memory `ProgressStore`** — so tasks genuinely play and nothing is recorded.

If the draft does not validate, render the errors instead. Preview of an invalid draft is undefined; the publish panel already renders these messages and this is the same list.

### 1a. The asset trap

`registerRemoteAssets` populates the resolution overlay from **cached** documents at boot. An asset uploaded for an unpublished draft is in Storage and in the session's `assets` list, but **not** in the overlay — so Preview would report a dangling `imageRef` for a file that plainly exists.

Thread the session's live stems into the `AssetStems` argument. `MaintainEditScreen` already fetches them via `listDocumentAssets` and `assetStemsFromListing` exists to shape them; merge those over the boot-time stems the same way `publishCheck.ts` merges `bundledAssetStems`.

Private Books do not have this problem — `private-assets.ts` registers object URLs from the record at load — but take the same path in both modes rather than branching.

### 1b. Everything is unlocked

Preview passes a **full attempted-task set** (`new Set(content.tasks.map(t => t.id))`), so every lesson and unit is reachable in one tap. Preview is for inspecting content, not simulating a learner; checking unit 12 must not cost eleven skip-ahead confirms. A bad unlock chain is caught structurally anyway — cycles by validator class (l), dangling gate refs by the reference checker.

`attemptedTaskIds` is an App-level prop (`App.tsx:1542`), not read from the store inside the screens, so this is a prop swap, not a store change.

**Two consequences that must be handled in this slice**, or Preview looks broken: with a full set, `nextUnit` returns `null` and `dueUnits` returns nothing against a no-op store, so the Book screen's **Play** card shows the trophy "Book complete" and **Daily Review** is permanently disabled. Both are progress affordances with no meaning here — **hide them in Preview**. **Practice stays**: it shuffles over unlocked lessons, which is exactly what Preview wants.

---

## 2. `packages/engine/src/diffContent.ts` (new)

```ts
export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export function diffContent(
  base: BookDocument,
  draft: BookDocument,
  baseDomain: DomainDocument,
  draftDomain: DomainDocument,
): {
  /** The union — base ∪ draft — so a removed entity still has a row to tint. */
  content: Content;
  status: Map<string, DiffStatus>;
  /** Base-side values for changed entities, for the old/new pair. */
  before: Map<string, unknown>;
};
```

**The union is the whole trick.** A removed entity is absent from the draft, so rendering the draft alone gives it nowhere to appear. Build the union by id per collection, take the draft's version where both exist, and classify with `canonicalJson` equality — the same comparison `documentDiff` already uses. Reuse that function; do not write a second deep-equal.

Order in the union: the draft's order, with removed entities re-inserted at their base-side index.

`documentDiff.ts` stays as it is and keeps serving `ProposalReview` — this is an additional view of the same facts, not a replacement.

### 2a. Note diffing is block-level

`documentDiff` compares whole fields, so a note's entire `markdown` is one field and a one-word edit reads as "the whole note changed".

For notes: parse both versions with `parseNoteBlocks` (slice 1), classify blocks by content-set membership — a block present in both is unchanged, otherwise added or removed — and **do no move detection**. About fifteen lines. Compare block _content_, not `raw`, so trailing-whitespace normalisation (slice 1 §1b-bis) never surfaces as a change.

---

## 3. Diff rendering

`EditSessionValue` (slice 5) gains the diff base, the `status` map and the current mode (`edit | preview | diff`) — slice 5 deliberately did not carry them. Widen the context here rather than threading them as props; the screens already read the session.

The same three screens render the union content read-only with per-element tints:

| status      | rendering                                                        |
| ----------- | ---------------------------------------------------------------- |
| `unchanged` | as normal                                                        |
| `added`     | `.diff-new`, light green                                         |
| `removed`   | `.diff-old`, light red                                           |
| `changed`   | old row in `.diff-old` directly above the new row in `.diff-new` |

Granularity is the field and the note block — **no word-level diffing**. A one-word change tints the whole paragraph old-red then new-green, which is what the vision describes.

Style both tints against the existing custom properties so light and dark both work; `.card.correct` / `.card.incorrect` (`styles.css:351–362`) are the pattern.

### 3a. The Diff tab appears only where there are changes

Per screen: Book — its own fields or `lessonIds`; Lesson — its own fields or `unitIds`; Unit — its own fields or any item, task or note it owns. All are one predicate over the Book-wide `status` map, which is computed regardless.

Two things follow, both required:

- **The header must reserve the control's width**, or it jumps as you navigate between a changed and an unchanged screen.
- **The What-changed index cannot live behind the Diff tab** — the tab is absent exactly where you most need to find the changes.

### 3b. Diff's base

What publishing would replace:

| mode            | base                                                |
| --------------- | --------------------------------------------------- |
| maintain        | `record.published`                                  |
| propose         | the catalog version at `StoredProposal.baseVersion` |
| never published | `emptyDocFor(kind)` (`ProposalReview.tsx:18`)       |
| **private**     | **none — no Diff tab at all**                       |

Private Books have no "before". Edit and Preview only.

---

## 4. What changed

Lives in the `[⋮]` menu (slice 5 §1c), always reachable, with the count as a badge — which doubles as the answer to "is there anything to review?".

A per-Book index of every touched entity, **grouped by lesson**, each row deep-linking to the screen that owns it, already in Diff mode. Rows show a title and a status marker, never an id.

No collapsing until real content demands it — the only Book measurable in-repo is the demo seed (1 lesson, 3 units, 3 items, 13 tasks).

Entities with no screen of their own — exercises, resources — group under their unit and the Book respectively, linking to slice 8's pages.

---

## 5. Tests

`packages/engine/src/diffContent.test.ts` (new):

- A removed unit appears in `content` with status `removed` — the union's reason for existing.
- A changed item has `before` holding the base values.
- Reordering `lessonIds` without changing any lesson marks the Book changed and the lessons unchanged.
- Note diffing: editing one paragraph of a five-block note yields one changed block, not five.
- Trailing-whitespace-only difference in a note's last block yields **no** change (slice 1 §1b-bis).
- A never-published base (`emptyDocFor`) marks everything `added`.

`apps/web` (new):

- Preview hides Play and Daily Review and keeps Practice.
- Preview reaches a gated unit in one tap.
- Preview resolves an asset present only in the session's live list.
- The Diff tab is absent on an unchanged screen and present on a changed one.
- A changed row renders old-above-new with both tints.
- The What-changed count matches the number of non-`unchanged` entities.

## Verification

`corepack pnpm check` green.

Browser, **maintain mode with a real account** — this slice cannot be signed off on the private path, which has no Diff:

1. Publish a Book. Edit one word's gloss, add a lesson, delete a unit, edit one paragraph of a note.
2. Diff on the Unit: the gloss shows old-red above new-green; the deleted unit shows red on its Lesson screen.
3. The edited note shows exactly one changed block.
4. Open a note, change nothing, leave: it does **not** appear in What changed.
5. What changed lists 4 items grouped by lesson; each row lands on the right screen in Diff mode.
6. The Diff tab is absent on a Book screen with no Book-level change, and What changed is still reachable from `[⋮]`.
7. Preview: every lesson open, tasks playable, nothing recorded in your own progress afterwards.
8. Upload an image, reference it in a note, Preview: it renders rather than reporting a dangling ref.

## Done-criteria

- Preview plays the draft's exercises for real and records nothing.
- Preview reaches any unit in one tap; Play and Daily Review are hidden there.
- Diff shows added, removed and changed content in place, red for old and green for new.
- A deleted entity is visible in Diff.
- A note edit diffs by block, and opening a note without editing produces no diff.
- The Diff tab appears only where there are changes; What changed is always reachable.
- Private Books have no Diff tab.

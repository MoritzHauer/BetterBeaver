# 0023-B — `proposeSplit`, and the author-only "Suggest breakdown" button

Implements slice **B** of [plan 0023](../plans/0023-morpheme-decomposition.md) (§8). **Slices A1 and A2 have landed**: `components` is `{text, gloss, entryId?}`, affixes are `lexeme` entries carrying `bound` and `variants`, `EntryPopup` renders the breakdown, and `apps/web/src/screens/edit/entryMorphology.tsx` hand-authors the three fields.

## Required reading (~10k tokens)

- `docs/plans/0023-morpheme-decomposition.md` §7 non-goals and §8
- `packages/engine/src/lookup.ts` (88 lines) — the shape to copy: pure, DOM-free, one pinned algorithm with the reasoning in the doc comment
- `packages/engine/src/normalize.ts`
- `packages/engine/src/index.ts` (the export surface)
- `packages/schema/src/entities.ts` — `componentSchema`, `lexemePayloadSchema`
- `apps/web/src/screens/edit/entryMorphology.tsx` (from slice A2) and the `UnitEditOps` interface in `apps/web/src/screens/edit/inPlace.tsx`

## 1. `proposeSplit` (plan §8)

New file `packages/engine/src/proposeSplit.ts`, exported from the package index:

```ts
export function proposeSplit(script: string, entries: Item[]): Component[] | undefined
```

Pinned algorithm — implement exactly this, and put the reasoning in the doc comment the way `lookup.ts` does:

1. **Candidates** are entries with `bound: "suffix"`. Each contributes its surface forms: its `variants` plus its own `payload.script`, each with a **leading/trailing hyphen stripped** (`-луу` is how a dictionary writes it; the word does not contain the hyphen). An empty form after stripping is skipped.
2. **Peel the longest matching form off the right** of the remaining text, and repeat on the residue. Longest match wins outright; ties break the way `lookup.ts` breaks them (shipped id before a `user-` one, then lowest id lexicographically) so the result is deterministic.
3. Peeling stops when no form matches, or when a match would consume the entire remaining text (a word that is nothing but suffixes is not a decomposition).
4. The **residue must resolve as a free entry by exact match** — an entry with no `bound`, compared the same way matching is done below. If it does not, **discard the whole proposal** and return `undefined`: no partial suggestions.
5. Return `undefined` if **no** suffix was peeled — a one-part "breakdown" of the word as itself teaches nothing.
6. Otherwise return the components in **reading order**: the root first, then the suffixes in the order they appear in the word. Each is `{ text, gloss, entryId }` where `text` is the slice of the **original** `script` (not a folded or normalized form — that is what displays), `gloss` is the matched entry's `gloss`, and `entryId` is its `id`.

**Comparison rule**: fold both sides with `.normalize("NFC").toLowerCase()` for the equality test only. Every index and every returned `text` must be computed from lengths of the **original** strings, so folding can never corrupt a slice. Do not use `normalizeToken` — it strips punctuation and apostrophes and is not length-preserving, which would break the index math.

**Non-goals, restated so they are not accidentally built**: no morphotactic ordering model, no phonology, no proof that the parts concatenate back to the word. The matcher will sometimes propose a well-formed nonsense split; the author's confirm tap is the validation, which is why it is a button and never an auto-apply.

## 2. Tests (`packages/engine/src/proposeSplit.test.ts`)

The Kyrgyz suffix table is slice D and does not exist yet, so the fixture is local: a handful of hand-built entries — a few free stems and a few `bound: "suffix"` affixes with their `variants` (e.g. `-луу/-лүү/-дуу/-дүү`, `-чы`, `-сыз`, `-лар/-лер/-дар/-дер`) — built as ordinary `Item` objects in the test file.

Cover, per plan §8's "one runnable check":

- ~10 known words and their expected splits, including at least two suffixes stacked on one stem and at least one match that lands on a `variants` allomorph rather than the entry's own `script`.
- Longest-match wins where a short and a long form both fit.
- A word whose residue is not a known free entry → `undefined`.
- A word with no suffix at all → `undefined`.
- A `bound: "prefix"` entry is never peeled (this matcher is suffix-only).
- Returned `text` slices preserve the original casing/characters of the input.

## 3. The button (plan §8)

In `entryMorphology.tsx`, a **"Suggest breakdown"** button beside the components list. Author-facing only — it lives in the edit surface, so it is already unreachable for a learner; add no flag.

- Pool: `edit.lexicon?.entries ?? []`, each element parsed with `itemSchema.safeParse` and kept only when it succeeds (the draft pool is untrusted). No lexicon → do not render the button.
- **Disabled while the components list is non-empty**, with the reason in its `title`. The plan's "cheap wrong suggestion, expensive wrong auto-commit" asymmetry only holds if the button cannot overwrite work the author already did.
- On click: `proposeSplit(<this entry's script>, pool)`. A result fills the components rows through the same `withPayloadList` write hand-authoring uses, so it is an ordinary edit the author can then correct row by row. `undefined` renders a quiet inline "No breakdown found" next to the button — never a dialog, and never silence.
- Add one render test: a stub lexicon where the split succeeds fills the rows, and one where it fails shows the message and writes nothing.

## Done when

- `corepack pnpm check` is green from the repo root.
- `proposeSplit` is DOM-free and imports nothing from `apps/`.
- Nothing under `content/` changed.

# 0023-B2 — Backtracking, and ranked candidates instead of one answer

Implements slice **B2** of [plan 0023](../plans/0023-morpheme-decomposition.md) §8a, which amends §8 after slice B landed and its own report named the hole. Read §8a before anything else; §8b records what was deliberately _not_ built here and why.

Slices A1, A2 and B are all landed and committed.

## The problem, restated

Greedy peeling with no backtracking destroys valid splits. With both `-луу` and the verbal-noun `-уу` in the pool, `суулуу` peels `-луу`, then peels `-уу` off the stem `суу`, leaving `с` — not a free entry, so §8 step 4's all-or-nothing rule discards the whole thing. The greedy walk committed to a path and the all-or-nothing rule punished it. In an agglutinative language, stems that end in a suffix form are ordinary, not exotic.

## 1. `proposeSplits` replaces `proposeSplit`

`packages/engine/src/proposeSplit.ts`, exported from the package index:

```ts
export function proposeSplits(
  script: string,
  entries: Item[],
  limit?: number,
): Component[][];
```

Best first; `[]` when nothing decomposes. **Replace** `proposeSplit` rather than keeping both — one rule, one home, and the editor is its only caller.

Unchanged from §8, and not to be re-derived: candidates are `bound: "suffix"` lexemes recognised by their `variants` and their own `script`, hyphen-stripped, empty forms skipped; a match may never consume the entire remaining text; the residue must resolve as a free entry (a lexeme with no `bound`) by exact match; at least one suffix must come off; each part's `text` is a slice of the **original** `script`, with folding (`NFC` + lowercase) used only for the equality test and never for index math.

**What changes is only the walk**: instead of peeling the longest match and hoping, enumerate every decomposition. At each position, every matching form is a branch; a residue that resolves as a free entry completes a candidate, and the search **continues past it** — a deeper split of the same word is a different candidate, not a worse one.

Ranking, pinned by §8a:

1. fewer parts first;
2. then the longer root;
3. then the joined entry ids lexicographically, so the order never depends on the pool's order.

Two caps, guards rather than semantics — a pathological pool must not hang the editor. At most **6 suffixes deep**, and at most **64 complete candidates** collected before ranking. `limit` defaults to **5**: it bounds what the caller renders, not what the search explores. Name the constants and say in a comment that they are guards.

Two candidates that produce the same `text` slices through different entries are **different proposals** (different glosses, different links) and both stay; rule 3 orders them.

## 2. Tests

`packages/engine/src/proposeSplit.test.ts` exists with 12 tests over a hand-built fixture. Keep every one of them meaningful: adapt them through a helper that reads the first candidate, so they go on asserting the same behaviour about the _best_ split.

Add:

- **The regression this slice exists for.** Put `-уу` in the pool alongside `-луу` and assert `суулуу` still gives `суу·луу`. Verify it fails against the greedy implementation — if it passes without the new search, the fixture does not reproduce the bug.
- Several candidates come back ranked, fewest parts first, with the deeper analysis of the same word still present further down the list.
- The ranking is stable when the pool is shuffled (rule 3 is what makes this true).
- The depth cap terminates on a word built of many stacked suffixes.
- A word with exactly one decomposition returns a single-element array, and a word with none returns `[]`.

## 3. The chooser

`apps/web/src/screens/edit/entryMorphology.tsx`, in `SuggestBreakdown`. Behaviour by count:

- **none** — the existing quiet "No breakdown found" (`problem-marker`, `role="status"`), unchanged.
- **one** — apply it, exactly as today.
- **several** — render them as a list of buttons, each showing the split as the popup would (`суу · луу`), and **apply nothing until the author taps one**. Tapping applies that candidate and clears the list.

This is what keeps §8's asymmetry intact: the tap is still the validation, and the runner-up costs one tap instead of being lost. The "Suggest breakdown" button stays disabled while any part is authored, unchanged.

Keep the chooser in the existing visual register — no new component file, and reuse `chip`/`editor-add`-family classes rather than inventing a control. Add CSS only if the list is unreadable without it.

Tests, in `UnitScreen.edit.test.tsx` beside the two that already cover the button: a stub lexicon where several candidates exist renders the chooser and writes nothing until a tap, and the tap writes the candidate that was tapped (not the first).

## Done when

- `corepack pnpm check` is green from the repo root.
- `proposeSplits` stays DOM-free and imports nothing from `apps/`.
- Nothing under `content/` or `packages/schema/` changed.
- No scorer, no network call, no FST — §8b defers all three, with reasons.

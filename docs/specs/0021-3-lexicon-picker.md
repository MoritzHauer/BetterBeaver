# Spec 0021-3: Lexicon picker and add-entry

Slice 3 of [plan 0021](../plans/0021-in-place-editing.md) (§6, decision 8). Depends on **slices 1–2** being landed. Self-contained per the `/delegate` convention; **make no new design choices**.

This is the last of the visible-vision slices. Nothing here changes what a lexicon link _stores_ — it stays `*word*`, no new grammar, rendering unchanged on every existing client. What it adds is the author being able to see what they authored: `resolveToken` can silently bind a starred word to the _wrong_ entry, and today nobody can tell until a learner taps it.

## Context (read first)

- `apps/web/src/components/NoteEditor.tsx` — slices 1–2's editor. The `Аү` toolbar button gains a sheet; the component gains one prop group.
- `apps/web/src/components/AddWordForm.tsx` (154) — **the whole file.** Widened, not forked.
- `apps/web/src/components/Sheet.tsx` (160) — the existing sheet primitive; reuse it, do not write another.
- `packages/engine/src/lookup.ts` (88) — `resolveToken`, whose behaviour the readout reports.
- `apps/web/src/screens/edit/PrivateEditScreen.tsx` — `changeDomain` (lines 187–190) and the `book`/`domain` pair it holds. This is the only existing domain write path.
- `apps/web/src/screens/edit/MaintainEditScreen.tsx` — **one range**: the `domainEntries` fetch (lines 101–128). Read-only, and that is the point (§0).
- `apps/web/src/screens/edit/BookEditor.tsx` — the `domainEntries` prop (lines 52–56) and the `view.v === "note"` branch. Threading only.
- `apps/web/src/content/entity-ids.ts` (13) and `packages/schema/src/entities.ts` — `DOMAIN_ENTRY_KIND` (216–219) only.

~1200 lines, inside the design.md budget; ships whole.

## Not in this slice

Explicit entry-id link syntax (decision 8 rejected it). Editing an existing entry from the sheet. Families or links. Anything touching `draftContent`, `checkReferences`, `EditSession` or routing.

---

## 0. The maintain-mode gap — read this before designing anything

**"+ add a new entry" ships private-mode only in this slice.** The resolution readout and lexicon search ship everywhere.

Adding an entry writes the **domain document**, which is a different document from the Book. Today only `PrivateEditScreen` holds both and can write the domain (`changeDomain`). `MaintainEditScreen` fetches `domainEntries` read-only through a separate `loadDocument` and has no domain draft, no domain publish, and no domain read-only guard. `ProposeEditScreen` has no domain path at all — a proposal targets one document.

Giving maintain mode a domain write here would mean a second local draft, a second sync, a second publish and a second schema-skew guard, built ad hoc and then rewritten when `EditSession` lands. That is plan §7–§8's job, and slice 5's.

So: `onAddEntry` is an **optional** prop. Absent (maintain, propose) → the add row is **disabled with a one-line reason**, not hidden, so the author understands why rather than wondering where it went. It lights up for those modes when slice 5 lands, with no change to this slice's code.

This is a deliberate staging decision, not an oversight — say so in the PR description.

---

## 1. What the `Аү` button does

Slice 1 made it wrap the selection in `*…*`. That behaviour is unchanged and happens first, so the button always does its primary job even if the sheet is dismissed.

After wrapping, if the selection was **non-empty**, open a `Sheet` for the wrapped text. With an empty selection, wrap as slice 1 does and open nothing — there is no word to resolve.

The sheet holds three things, in this order: the resolution readout (§2), a lexicon search list (§3), and the add row (§4).

---

## 2. The resolution readout

Run `resolveToken(text, entries)` — the _same_ function `EntryPopup` calls, never a reimplementation — and report one of three outcomes:

| outcome                                         | shown                                        |
| ----------------------------------------------- | -------------------------------------------- |
| exact match                                     | `✓ Рахмат · thanks`                          |
| prefix match, entry text differs from the token | `→ Салам · hello  (prefix match, not exact)` |
| no match                                        | `⚠ no entry for this word`                   |

The middle case is the whole point of this slice. `resolveToken` falls back to the longest entry ≥3 characters that prefixes the token (`lookup.ts:72`), with ties broken by lowest id — so a starred word can bind to a _different_ word than the author meant, invisibly. Distinguish it from an exact match visually; do not collapse the two.

Derive the outcome from the returned entry, not by re-running the matching rules: exact when the entry's normalised script/term equals the normalised token (`normalizeToken` from engine), prefix otherwise.

**Entries must be parsed before `resolveToken` sees them.** `BookEditor`'s `domainEntries` is `unknown[]` — raw draft entities, some of them half-typed. Filter with `itemSchema.safeParse` and keep the successes; a partially-entered entry simply does not appear yet. Three lines, and slice 4's `draftContent` generalises it later.

**One caveat to state in a comment, not to solve here**: at runtime `domainContent.entries` also contains learner-created `user-` entries, which the editor cannot see. `pickBest` prefers non-`user-` entries, so an authored match always wins — the readout can only be over-pessimistic (`⚠ no entry` where a learner's own word would resolve), never wrong about an authored one.

---

## 3. The lexicon search list

A search box filtering the parsed entries by script/term and gloss/definition, rendered as rows of `script · gloss` (or `term · definition` for a `general` domain). Cap the visible rows and say how many are hidden, the way `DomainEditor` already does at 50.

**Tapping a row replaces the wrapped text with that entry's dictionary form**, still wrapped — `*Саламдашуу*` becomes `*Салам*`. This is what makes the list actionable rather than decorative, and it is the common case for starred words in vocabulary tables and lists. In running prose the author simply does not tap a row; the inflected form they typed is usually what they want, and the prefix rule already handles it.

Use the same splice-and-restore-selection mechanism slice 1 built for the toolbar. Re-run the readout afterwards so the author sees it turn into an exact match.

---

## 4. "+ add a new entry"

A row below the list: `⊕ add "Саламдашуу" as new`. Opens `AddWordForm` prefilled with the wrapped text.

### 4a. Widening `AddWordForm`

Two hardcoded locals in `submit()` (lines 44–48) become optional props, defaulted to today's values so **both existing call sites — `VocabularyScreen.tsx:614` and `EntryPopup.tsx:134` — need no edit**:

```ts
export function AddWordForm({
  domain,
  prefill,
  onSubmit,
  onCancel,
  makeId = newUserEntryId,
  /** Authored entries need a resource the Book owns; learner entries never resolve one. */
  sourceRef = "user",
}: {
  /* …existing… */
  makeId?: () => string;
  sourceRef?: string;
});
```

Do not fork the component and do not copy its field logic — the lexeme/concept field split, the `DOMAIN_ENTRY_KIND` lookup and the trim/optional-field handling are all already correct there.

### 4b. What the note editor passes

- `makeId`: `() => newEntityId(domainCode)`. A bare UUID **fails validation** — `validate.ts:772` requires an entry id to start with `<domain.code>-`. This is the same generator `DomainEditor` uses.
- `sourceRef`: the Book's first `resources[]` id if it has one, else `""`.
- `domain`: the `Domain` entity, needed for `DOMAIN_ENTRY_KIND`.

**A newly added entry will fail publish with `dangling sourceRef ""` when the Book has no resources.** That is exactly what `DomainEditor`'s existing "New entry" already produces (`DomainEditor.tsx:168-173`), so it is not a regression, and plan §9's seeded resource fixes the whole class in slice 10. Do not invent a placeholder resource here to paper over it — a fake resource id that resolves to nothing is worse than an honest error.

### 4c. After adding

Call `onAddEntry(item)`. The entry becomes visible to the readout on the next render, so the readout flips from `⚠ no entry` to `✓ exact` without the author doing anything — that is the confirmation the flow needs, so make sure the parsed-entries list is derived from props rather than cached in state.

---

## 5. Threading

`NoteEditor` gains one optional prop group. `markdown` and `onChange` remain exactly as slice 1 pinned them, and slice 2's `assets`/`onUploadAsset` are untouched.

```ts
export interface LexiconAccess {
  /** Raw draft entries; parsed inside (§2). */
  entries: unknown[];
  domain: Domain;
  /** The prefix for generated entry ids — the Domain's own `code`. */
  domainCode: string;
  /** Default sourceRef for a new entry; "" when the Book has no resources. */
  sourceRef: string;
  /** Absent means this mode cannot write the lexicon (§0). */
  onAddEntry?: (entry: Item) => void;
}

// NoteEditor props gain:
lexicon?: LexiconAccess;
```

Absent entirely (`lexicon === undefined`) → the `Аү` button still wraps, and no sheet opens. That keeps `NoteEditor` usable anywhere without a lexicon in hand.

`BookEditor` passes it through. It already receives `domainEntries`; it additionally needs `domain`, `domainCode`, `sourceRef` and `onAddEntry` from its shell:

| mode     | `entries`                   | `onAddEntry`                                                |
| -------- | --------------------------- | ----------------------------------------------------------- |
| private  | the held `domain.entries`   | `(entry) => changeDomain(upsertDomainEntry(domain, entry))` |
| maintain | the fetched `domainEntries` | **omitted** (§0)                                            |
| propose  | the fetched `domainEntries` | **omitted** (§0)                                            |

`upsertDomainEntry` already exists in `packages/engine/src/documentEdit.ts` — `DomainEditor` uses it. Reuse it; do not hand-roll the array splice.

---

## 6. Tests

- **`apps/web/src/components/NoteEditor.test.tsx`** — extend:
  - `Аү` over a non-empty selection wraps **and** opens the sheet; over an empty selection it wraps and opens nothing.
  - Readout: exact match, prefix-match-not-exact, and no-match each render distinctly. The prefix case is the one that must exist.
  - A half-typed entry (missing `gloss`) is excluded from the pool and does not crash the readout.
  - Tapping a search row replaces the wrapped text with that entry's script and leaves the rest of the note byte-identical.
  - With `onAddEntry` absent, the add row is present, disabled, and carries a reason.
  - With `onAddEntry` present, submitting the form calls it with an id prefixed by `domainCode`.
- **`apps/web/src/components/AddWordForm`** — a test asserting the defaults still hold (no `makeId`/`sourceRef` given → `user-` prefixed id and `sourceRef: "user"`), so the widening cannot silently change the learner path.
- Slice 1–2 suites stay green; `NoteView.test.tsx` is untouched by this slice.

## Verification

`corepack pnpm check` green.

In a real browser via the private-Book path (no account, no backend; see the `apps/web:verify` skill):

1. Create a private Book, add a lexicon entry `Салам · hello` through the existing domain editor.
2. In a note, type `Саламдашуу`, select it, press `Аү`.
3. Confirm the readout says it resolves to **Салам** and flags it as a prefix match, not exact — this is the bug the slice exists to surface.
4. Tap the `Салам` row; confirm the text becomes `*Салам*` and the readout flips to exact.
5. Type a word with no entry, star it, and use `⊕ add … as new`; confirm the entry is created, the readout flips to exact, and the word is now tappable in the rendered note.
6. Open the same note in a **maintain**-mode Book: confirm the readout and search work and the add row is disabled with its reason.
7. Zero console errors throughout.

## Done-criteria

- A starred word's actual resolution is visible at authoring time, with prefix matches distinguished from exact ones.
- The lexicon is searchable from the note editor; tapping a row rewrites the starred text.
- A missing entry can be created without leaving the note — in private Books.
- In maintain and propose modes the add row is disabled with a reason, not hidden or missing.
- `AddWordForm` is widened, not forked, and its two existing call sites are unedited.
- No new markdown grammar exists: a lexicon link is still exactly `*word*`.

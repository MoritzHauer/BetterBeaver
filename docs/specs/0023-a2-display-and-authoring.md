# 0023-A2 — Breakdown display, the three editor fields, and the private-Book migration

Implements slice **A2** of [plan 0023](../plans/0023-morpheme-decomposition.md) (§6, plus one gap the plan missed — §4 below). **Slice A1 has already landed**: `components` is `{text, gloss, entryId?}` on both lexicon payloads, `bound`/`variants` exist on `lexemePayloadSchema`, `CONTENT_SCHEMA_VERSION` is 2, and `draftContent` carries all of it. Do not change `packages/schema` or `packages/engine` in this slice.

## Required reading (~20k tokens)

- `docs/plans/0023-morpheme-decomposition.md` §1–§6
- `apps/web/src/components/EntryPopup.tsx` (whole file, 225 lines)
- `apps/web/src/screens/UnitScreen.tsx` — **`RowExtras` only**, lines ~227–322, plus the `⚙` `SettingsSheet` call site for a word row (~lines 1505–1555). The file is 1949 lines; do not read the rest.
- `apps/web/src/screens/edit/inPlace.tsx` — the `UnitEditOps` interface (~lines 65–145) and `withPayload`/`withOptionalKey` (~lines 555–611)
- `apps/web/src/screens/edit/fields.tsx` — `RowActions`, `EntityPicker` signatures
- `apps/web/src/screens/entityPicker.ts` — `PickerOption`, `optionsFrom`
- `apps/web/src/content/private-store.ts`, `apps/web/src/content/private-transfer.ts`
- `apps/web/src/screens/UnitScreen.edit.test.tsx` for the render-test idiom

## 1. `EntryPopup`: the breakdown (plan §6)

Replace the current components block (lines ~111–178). Today it reads `entry.payload.components` for `lexeme` only and guesses each part's target with `resolveToken(component.script, entries)`. Both go.

- Read `components` from **`lexeme` and `concept`** entries — the field now exists on both, and that is what makes `cardio·myo·pathy` work with no language-specific code.
- Render as a **middot-joined breakdown**: `оку · муш · туу`, in reading order, each part showing its `text` with its `gloss` beneath it.
- A part with an `entryId` that resolves against the popup's `entries` pool is a **button** calling the existing `openEntry(id)` — the same local state swap the link chips use, no routing.
- A part with no `entryId`, **or one whose `entryId` does not resolve**, is inert text (a `<span>`, not a disabled button). Never fall back to `resolveToken`: the plan pins "inline text is what displays; the link is what navigates", and a text-based guess is exactly the silent mis-resolution decision 0021 §6 exists to prevent.
- Keep it to existing classes where they fit (`chips`, `chip`, `status`); add CSS to `apps/web/src/styles.css` only if the breakdown is unreadable without it, and keep any addition to the middot separator and the gloss line.

## 2. The three editor fields (plan §6)

The plan says "the entry editor gets the fields … reusing the existing repeated-row primitives in `edit/fields.tsx`". That editor is gone (plan 0021); its replacement is **`RowExtras` in `UnitScreen.tsx`**, the shared per-row edit surface rendered by both the Unit page's word-row `⚙` sheet and `SessionEditSheet`. Putting the fields there gets both surfaces at once.

`UnitScreen.tsx` is over the 1500-line budget, so **do not grow it**: write a new module `apps/web/src/screens/edit/entryMorphology.tsx` exporting

```tsx
export function MorphologyFields({
  item,
  edit,
}: {
  item: Item;
  edit: UnitEditOps;
});
```

and render it from `RowExtras` in a ~4-line insertion, directly after the per-kind example fields and before the asset-ref pickers. It returns `null` for `sentence`/`pair` items. Both `RowExtras` call sites already sit behind `edit.canEditRow(...)`, so add no further gate.

Controls (lexeme gets all three; concept gets **components only** — `bound`/`variants` do not exist on its payload):

- **`bound`** — a `<select>`: `(free-standing word)` / `prefix` / `suffix`. Write through `withPayload(raw, ["bound"], value)`, whose empty-string branch deletes the key, which is what `optional()` needs.
- **`variants`** — a list of text inputs, each with a `RowActions onRemove`, plus a `+ variant` button (`className="editor-add"`, matching the page's `+ word`). Label it so the author knows what it is for: "Allomorphs (vowel harmony)". Show it whether or not `bound` is set — hiding it would make class (ab)'s "variants requires bound" error unfixable from the UI — and rely on the problem marker to explain.
- **`components`** — ordered rows, each with a `text` input, a `gloss` input, and an `EntityPicker` (`multiple: false`) selecting `entryId` from this Book's lexicon; each row gets `RowActions` with `onUp`/`onDown`/`onRemove` (order is meaning here — a decomposition is a sequence), plus a `+ part` button. Build the picker options with `optionsFrom` over `edit.lexicon?.entries ?? []`, keeping only elements that are objects with a string `id` (the pool is raw draft JSON and is untrusted by design). When `edit.lexicon` is undefined, render the text/gloss inputs and omit the picker rather than the whole row.

Add `ProblemMarker`s for `payload.bound`, `payload.variants` and `payload.components`, following `RowExtras`' existing pattern.

**Two helpers, in `inPlace.tsx` next to `withPayload`** (so this module does not reimplement its `obj`/delete-when-empty rules), each exported and doc-commented in that file's voice:

```ts
/** Reads a payload array key off the raw entity — `[]` when absent or not an array. */
export function payloadList(entity: Entity, key: string): unknown[];
/** Writes a payload array key, **deleting** it when the array is empty — the same
 * absent-not-empty rule `withPayload` follows, for the same `optional()` reason. */
export function withPayloadList(
  entity: Entity,
  key: string,
  values: unknown[],
): Entity;
```

## 3. Not in this slice

- The **"Suggest breakdown"** button is slice B. Leave a plain hand-authoring surface here.
- **Republish + seed re-export** (plan §7): impossible in this environment — no Supabase service key — and it is content, not code. Do not write a migration script, do not touch `content/`. Note it in your report as an owner step.
- The **Suffixes family** and the ~150 affix entries are slice D, content authoring.

## 4. The private-Book migration (a gap plan 0023 does not cover)

design.md pins: _"Schema changes must stay additive for anything a private Book can contain, or ship a local migration"_ (plan 0017 decision 5) — there is no admin republish for content that exists on one device. A1's `script` → `text` rename is **not** additive, and a private Book's lexicon entries can carry `components`. Today nothing in the app writes that field, so the realistic carrier is an **imported** export file authored elsewhere, but the rule is pinned and the fix is ten lines.

Ship a pure, exported normalizer — `apps/web/src/content/private-migrations.ts`, or beside the existing helpers if a better home is obvious — that rewrites, for every `lexeme`/`concept` entry in a private Book's documents, any component object carrying a string `script` and **no** `text` into `{ text: <script>, gloss, entryId? }`, dropping the `script` key. Everything else is left byte-identical, and a document with no such component must come back unchanged (identity, so it never dirties a record).

Apply it at both read boundaries:

- `readPrivateBook` / `readPrivateBooks` in `private-store.ts` — records already at rest on the device.
- the import path in `private-transfer.ts` (`readPrivateBookFile`, after the shape check) — files from another device, where `schemaVersion: 1` is still accepted (`<= CONTENT_SCHEMA_VERSION`) and would otherwise validate into a broken Book.

Migrate on read rather than rewriting the store: it is idempotent, it cannot half-apply, and a failed write cannot leave a record in a state neither version understands.

## 5. Tests

- `EntryPopup`: a new render test — a lexeme with three components, one carrying a resolvable `entryId`, one carrying a dangling one, one carrying none. Assert all three `text`s and glosses render, that the resolvable one is a button whose click swaps the popup to that entry, and that the other two are **not** buttons. Add the concept case in the same file.
- `MorphologyFields`: extend `UnitScreen.edit.test.tsx` (or a sibling `UnitScreen.morphology.test.tsx` if that file is already large) — open a word row's `⚙`, set `bound` to `suffix`, add a variant and a component part, and assert the written draft entity, including that clearing `bound` **deletes** the key rather than leaving `""`.
- The migration: unit tests for the rewrite (old shape → new, new shape untouched and identity-equal, non-lexicon entities untouched), plus one asserting the import path applies it.

## Done when

- `corepack pnpm check` is green from the repo root.
- Nothing under `packages/` or `content/` changed.
- Browser verification is **not** required of you — the orchestrator runs it (`apps/web:verify`). Report anything you could not check.

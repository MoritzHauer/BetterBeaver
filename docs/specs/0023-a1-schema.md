# 0023-A1 — Morpheme schema: the component shape, `bound`, `variants`

Implements slice **A1** of [plan 0023](../plans/0023-morpheme-decomposition.md). Design is pinned by that plan (§1–§5, §7) and by the two 0023 rows in [design.md](../design.md) — do not reopen it. This slice is **schema + engine only, no UI**.

## Required reading (~9k tokens)

- `docs/plans/0023-morpheme-decomposition.md` §1–§7 (design; the rest is later slices)
- `packages/schema/src/entities.ts` — `linkSchema`, `lexemePayloadSchema`, `conceptPayloadSchema` (lines ~100–160)
- `packages/schema/src/validate.ts` — `checkReferences`, in particular class (y) and class (z) at lines ~786–855
- `packages/schema/src/documents.ts` line 26 (`CONTENT_SCHEMA_VERSION`)
- `packages/engine/src/draftContent.ts` — `draftLexemePayload` / `draftConceptPayload` (lines ~30–110)
- `packages/engine/src/lookup.ts` (whole file, 88 lines)
- `packages/schema/src/validate.test.ts` — the "accepts a lexeme entry with a components breakdown" test (~line 967) and its `makeFixture` helper

## 1. The component shape (plan §4)

In `entities.ts`, one shape shared by both lexicon payloads:

```ts
/** One part of a hand-authored morpheme breakdown (plan 0023 §4). `text` and
 * `gloss` are what renders; `entryId` is navigation only, so the breakdown
 * displays without resolving anything. */
export const componentSchema = z.object({
  text: z.string(),
  gloss: z.string(),
  /** The part's own lexicon entry, when one exists — navigation only. */
  entryId: slugSchema.optional(),
});
export type Component = z.infer<typeof componentSchema>;
```

- `lexemePayloadSchema.components`: **renamed field shape** from `{script, gloss}` to `componentSchema` (`z.array(componentSchema).optional()`). Update its doc comment — the old one cites plan 0008 step 5 and the `кайнэне` example; keep the example, change `script:` to `text:` and cite plan 0023 §4 as the reshape.
- `conceptPayloadSchema`: gains the same `components` field, same shape, same optionality. (This is what makes `cardio·myo·pathy` work with no language-specific code — plan §Goals.)

On `lexemePayloadSchema` **only**:

```ts
/** A bound morpheme: an affix that only occurs attached (plan 0023 §1–2).
 * Absent = an ordinary free-standing word. */
bound: z.enum(["prefix", "suffix"]).optional(),
/** Vowel-harmony allomorphs, hand-authored and closed (plan 0023 §3) —
 * never generated, and meaningless unless `bound` is set. */
variants: z.array(z.string()).optional(),
```

`text` and `gloss` stay **required** even when `entryId` is present (plan §4, pinned).

## 2. Validation (plan §5)

Both new checks go in `checkReferences` in `validate.ts`, in the per-entry block after class (z), so they fire in the in-place editor as well as at publish (design.md: referential rules come from `checkReferences`). Give them the next free letters — **class (aa)** and **class (ab)**; every letter through (z) is either live in `validate.ts` or retired by an earlier plan, so continue rather than reuse.

- **class (aa)** — every `components[].entryId` must resolve to an entry of the same domain, exactly like class (z)'s dangling-link check. Applies to `lexeme` **and** `concept` entries. Message shape, matching the existing wording: `` `${entry.id}: dangling component entry reference "${c.entryId}"` ``. A component with no `entryId` is fine and is the common case. Self-reference is **not** an error (a word can list itself as its own root; unlike a link it makes no symmetric claim).
- **class (ab)** — `variants` present while `bound` is absent is an **error**: it means nothing on a free word and silently ignoring it hides a typo (plan §5). Message: `` `${entry.id}: "variants" requires "bound"` ``. Lexeme entries only — the fields do not exist on `concept`.

**Deliberately not validated**, and no test may assert it: that `components[].text` concatenated equals the entry's `script` (plan §5 — harmony, elision and citation-vs-surface forms make it false too often; the field is a teaching aid, not a derivation proof).

`bound` on a `concept` payload is not expressible, so there is nothing to check.

## 3. Schema version (plan §7)

`CONTENT_SCHEMA_VERSION`: **1 → 2**, once. The rename is breaking; `entryId`, `bound` and `variants` are additive and ride along free (plan 0015 §6a). Update the comment at `documents.ts:26` to name plan 0023's rename as the reason for version 2.

Do **not** attempt to republish anything or touch `content/` — the seed uses `components` nowhere (verified), and the live-Book republish is an owner step this slice cannot run (no service key in this environment). Say so in your report; do not invent a migration script.

## 4. Engine: the one lookup filter (plan §1's leak table)

`packages/engine/src/lookup.ts` — `resolveToken` must skip entries with `bound: "prefix"`. The table's reasoning is the comment to write: matching is *entry ⊂ token*, so a **suffix** can never false-match (`"тартуу".startsWith("туу")` is false), but a prefix affix (`гидро-`) would win longest-prefix over the real stem. Filter in `entryText` (return `undefined` for a prefix-bound lexeme) or in the `candidates` build — either is one line; pick the one that reads.

**Do not filter `bound` entries out of ad-hoc distractor sampling** (`adhoc.ts`). Plan §1's table rules that leak self-gating — distractors come from the passed item list, not the pool — and excluding affixes there would break MCQ floors for a session studying the Suffixes family deliberately.

## 5. Engine: `draftContent`

`draftLexemePayload` / `draftConceptPayload` in `packages/engine/src/draftContent.ts` are pure, cannot-fail adapters from unvalidated draft JSON. They must carry the new fields, following the file's existing idioms exactly (`str()`, `obj()`, the `...(cond ? {…} : {})` spread, drop-empty-string):

- lexeme + concept: `components` maps `{ text: str(obj(c).text), gloss: str(obj(c).gloss), ...(entryId non-empty string ? { entryId } : {}) }`.
- lexeme: `bound` carried only when it is exactly `"prefix"` or `"suffix"` (an unrecognised string is dropped, like every other malformed value here); `variants` carried when `Array.isArray`, mapping each element through `str()`.

## 6. Tests

In `packages/schema/src/validate.test.ts` (extend the local `makeFixture` payload type where needed):

1. The existing "accepts a lexeme entry with a components breakdown" test — update to the new shape (`text`, not `script`) and add an `entryId` pointing at a real entry.
2. class (aa): a component whose `entryId` does not exist → error mentioning `dangling component entry`. Add the same for a **concept** entry, which is the field's new home.
3. class (ab): `variants` with no `bound` → error; `variants` **with** `bound` → valid.
4. A `bound: "suffix"` entry with `variants` and no `components` validates (the shape slice D will author ~150 of).

In `packages/engine` (`lookup.test.ts`, or a new file if none exists):

5. A `bound: "prefix"` entry that is a prefix of the tapped token is **not** returned, while the free-standing entry it was shadowing is.
6. A `bound: "suffix"` entry is still reachable by **exact** match (a learner tapping the affix in a breakdown must still resolve it), proving the filter is prefix-only.

## Done when

- `corepack pnpm check` is green from the repo root.
- No file under `apps/web/` is touched. `EntryPopup.tsx` still compiles because it reads `component.script`… — if it does **not** compile, fix it minimally (`component.text`) and say so; the real popup rewrite is slice A2's, so do not build the breakdown UI here.
- Your report names: the class letters used, whether `EntryPopup` needed the minimal fix, and confirmation that nothing in `content/` changed.

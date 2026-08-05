# Plan 0023: Morpheme decomposition and the Kyrgyz suffix table

Status: **drafted** · Owner: Moe · Date: 2026-08-05 · Slicing pinned by a grilling session (2026-08-05) after a research pass over the open Kyrgyz lexical resources (kaikki/Wiktionary, apertium-kir, UniMorph `kir`)

## Purpose

Kyrgyz is agglutinative: `окумуштуу` ("scholar") is `оку` (study) + `муш` + `туу`. The lexicon stores it as one opaque string with one gloss, so a learner memorises three unrelated words where there is one root and two suffixes that recur across hundreds of others. The single highest-leverage content object in an agglutinative language — the suffix inventory — currently has nowhere to live.

`lexemePayload.components` (plan 0008 step 5) was built for exactly this and is **used by zero content today**: `{script, gloss}` pairs, no link to the part's own entry, lexemes only. It is the right field, in the wrong shape, and free to reshape right now.

This plan reshapes it (slice A), fills it with a real Kyrgyz suffix table (slice D), then proposes splits automatically (slice B) and turns them into an exercise (slice C).

## Goals

After slice A: an entry carries an ordered decomposition, each part optionally linked to its own lexicon entry; affixes are ordinary entries marked `bound`, carrying their vowel-harmony allomorphs; the entry popup renders the breakdown with every part tappable; concepts get the same field, so `cardio·myo·pathy` and `poly·morph·ism` work with no language-specific code.

After slice D: ~150 Kyrgyz affix entries exist in the published lexicon, studyable as ordinary cards the day they land.

## Non-goals

- **No automatic segmentation in slice A.** The matcher is slice B and is author-facing only.
- **No morphotactic ordering rules, ever.** Kyrgyz suffix order is fixed and greedy longest-match will sometimes produce a plausible wrong split. The author's confirm tap is the validation — that is the whole reason it is a suggestion. See §7.
- **No phonology engine.** Vowel harmony is four authored strings per affix, never a rule. See §3.
- **No derivation proof.** A component list need not concatenate back to the entry's script. See §5.
- **No `forms` field, no FST, no apertium runtime dependency.** Inflected surface forms of stems stay out; `resolveToken`'s prefix matching already covers a suffixing language.
- **No new browse screen for affixes.** A shipped family covers it. See §6.
- **No word-building exercise in this plan.** Slice C, sketched in §8, is its own plan.

## Design

### 1. Affixes are ordinary lexicon entries

Not a parallel `affixes: []` on `DomainDocument`. An affix is a `lexeme` entry with `bound` set — `script: "-туу"`, `transliteration: "-luu"`, `gloss: "having, provided with (N→Adj)"` — and every existing surface then works unchanged: the entry popup, `synonym`/`related` links, audio, families, SRS state, the editor, `EntityPicker`.

The cost of that reuse is the leaks it opens, and I checked each one before committing:

| Surface | Leaks? |
| --- | --- |
| Review queue (`dueDomainUnits`) | **No** — driven by SRS state, so an affix never studied is never due. Self-gating already. |
| Vocabulary browse (`VocabularyScreen`) | **No** — the surfaces are unit groups, "My words", lists and families, all authored. No flat all-lexicon list exists. |
| Tap-to-lookup (`lookup.ts:72`) | **Only for `bound: "prefix"`** — matching is *entry ⊂ token*, so `"тартуу".startsWith("туу")` is false and a suffix can never false-match. A prefix affix (`гидро-`) would win longest-prefix over the real stem. |
| Ad-hoc distractors (`adhoc.ts:106`) | **Only inside a deliberately-studied set** — distractors come from the passed item list, not the pool, so an affix appears only if someone put it in the studied list or family. |

Two filters, both one line, against every surface working for free. A parallel structure would cost a second entity kind, a second editor, a second validator class, and would make an affix unstudyable.

### 2. `bound` is a field, not a hyphen convention

The tempting zero-field version reads bound-ness off a leading/trailing hyphen — `-туу` is a suffix, `гидро-` a prefix — which is how dictionaries and medical-terminology textbooks already write them, so the author types it anyway.

**Rejected.** The matcher (§7) needs the attachment side as *data*, not as a parse of a display string, and `resolveToken` needs the same fact. A string-prefix check on user-entered text, scattered across the engine's sampling and lookup paths, is the thing someone decodes at 3am. Two call sites plus a matcher earns one explicit field.

### 3. `variants` is not the `forms` field

`variants: ["-туу", "-түү", "-дуу", "-дүү"]` looks like the inflected-forms field this plan's non-goals refuse. It is a different object: allomorphs of a bound morpheme are **closed and hand-authored** — four strings, once, forever — while inflected forms of a stem are open-ended and generated. Storing the allomorphs is what lets vowel harmony be a table lookup instead of a phonology implementation, and it is what makes the design port to Turkish, Kazakh and Finnish unchanged. A Latin combining form simply leaves the list empty.

### 4. Schema

One component shape, shared by both payloads:

```ts
const componentSchema = z.object({
  text: z.string(),
  gloss: z.string(),
  /** The part's own lexicon entry, when one exists — navigation only. */
  entryId: slugSchema.optional(),
});
```

On `lexemePayloadSchema`, `components` is **renamed from `{script, gloss}` to this shape** (`script` → `text`), and `conceptPayloadSchema` gains the same field. On `lexemePayloadSchema` only:

```ts
bound: z.enum(["prefix", "suffix"]).optional(),   // absent = free-standing word
variants: z.array(z.string()).optional(),          // allomorphs; ignored unless bound
```

**`text` and `gloss` stay required even when `entryId` is present.** The breakdown must render without resolving anything, and the surface slice genuinely differs from the lemma it points at (`туу` in the word, `-туу` as an entry). Inline text is what displays; the link is what navigates.

### 5. Validation

New validator classes, alongside the existing entry checks in `validate.ts`:

- `components[].entryId` must resolve to an entry of the same domain — the same dangling check `links[].entryId` already gets (class (z)).
- `variants` is an error when `bound` is absent — it means nothing on a free word, and silently ignoring it hides a typo.
- `bound` on a `concept` payload: not expressible (the field is lexeme-only), so nothing to check.

**Deliberately not validated: that `components[].text` concatenated equals the entry's `script`.** Vowel harmony, elision and the difference between citation and surface forms make it false often enough that the check would be noise, and the field is a teaching aid, not a proof of derivation.

### 6. Display, and where affixes surface

`EntryPopup` renders `components` as a middot-joined breakdown — `оку · муш · туу` — each part a button: with an `entryId` it opens that entry's popup (the existing synonym-chip path, `EntryPopup`'s `entryId` prop, already does exactly this); without one it is inert text with its gloss beneath.

Affixes reach a learner through a **shipped family** ("Suffixes") per domain. Families are already a browse surface with a study entry point, so this is content, not code — and it keeps affixes out of every surface nobody placed them in.

The entry editor gets the fields: a `bound` select, a `variants` string list, and a components list reusing the existing repeated-row primitives in `edit/fields.tsx`.

### 7. Schema version

The rename is breaking, so **`CONTENT_SCHEMA_VERSION` bumps 1 → 2 once**, and everything else here — `entryId`, `bound`, `variants`, and slice C's task type if it lands before the republish — is additive and rides along free (plan 0015 §6a). Bump, republish all listed documents, re-export the bundled seed (plan 0012 §8).

**Pre-check before assuming the rename is free:** `content/` uses `components` nowhere, but the Kyrgyz documents live in the backend. Run `pull-book.ts kyrgyz` and grep the pulled tree for `"components"` first. If any published entry uses it, the rename needs a one-off `script` → `text` pass in the same scratch tree before republishing.

## Slices

Each ships independently; the app works after every one.

**A1 — schema.** `packages/schema`: the component shape, the rename, `bound`, `variants`, the validator classes, the version bump. Tests in `validate.test.ts`. No UI.

**A2 — display and authoring.** `EntryPopup` breakdown, the three editor fields, the republish + seed re-export.

**D — the Kyrgyz suffix table.** Content only, no code. §Bootstrapping below.

**B — the matcher.** §8.

**C — word building.** Its own plan; §8 sketches it only.

## Bootstrapping the suffix table (slice D)

~150 entries is content labour, and it is the long pole: A is worthless unfilled, and D is useful on its own the day it lands, because a suffix entry is studyable with the exercise types that already exist.

**Source.** Apertium's [Morphology of Kyrgyz language](https://wiki.apertium.org/wiki/Morphology_of_Kyrgyz_language) lists inflectional *and* derivational suffixes with their harmony allomorphs and example words, in the exact shape needed (`-/LUU/ (N>A) | бакыт → бактылуу`). `apertium-kir.kir.lexc` (850 KB) is the completeness cross-check. **Glosses get written fresh for learners** — partly because the wiki's are linguist-facing and partly because that sidesteps GFDL entirely.

**Step 1 — a reviewable TSV.** I draft `scratch.local/kyrgyz-affixes.tsv`, one row per affix:

```
form	variants	attaches	gloss	transliteration	example	breakdown
-луу	-луу,-лүү,-дуу,-дүү	N→Adj	having, provided with	-luu	бактылуу	бакты·луу
```

TSV because 150 rows is reviewable in one sitting and 150 JSON files are not. Moe edits it in place; a deleted row never becomes an entry.

**Step 2 — into the existing upload path. No new script.** `pull-book.ts kyrgyz` checks the domain out into a scratch tree; a ~20-line throwaway converter (in `scratch.local/`, not `scripts/`) writes one `entries/ky-sfx-<latin>.json` per surviving row plus the "Suffixes" family; then the **existing** validation and push:

```
BB_CONTENT_DIR=<dir> corepack pnpm exec vitest run packages/schema/src/content.test.ts
BB_CONTENT_DIR=<dir> node scripts/republish-content.ts
```

`propose-book.ts` instead of republish if the Kyrgyz Book has an open in-app draft — republish leaves drafts alone and the maintainer's later publish would then lose one side.

The converter stays a throwaway. If it gets run a third time, promote it to `scripts/`.

**Step 3 — ship in two passes.** Author every row in one sitting, but republish the ~40 an early learner actually meets first (plural, the six cases, possessives, negative `-ба`, the common tenses, `-луу`, `-чы`, `-сыз`), so real breakdowns exist while the long tail is still under review.

## Slices B and C

### 8. B — the split matcher

`proposeSplit(script, entries): Component[] | undefined` in `packages/engine`, pure and DOM-free like `lookup.ts`:

1. Candidates = entries with `bound: "suffix"`, matched on `variants` ∪ `script` with the hyphen stripped.
2. Peel the **longest** match off the right, repeat.
3. The residue must resolve as a free entry by exact match, or the whole proposal is discarded — no partial suggestions.

Runs **in the entry editor only**, behind a "Suggest breakdown" button, never learner-facing and never auto-applied. It has no morphotactic model (see Non-goals), so it will sometimes propose a well-formed nonsense split; the author rejects it at zero cost. That asymmetry — cheap wrong suggestion, expensive wrong auto-commit — is why it is a button.

One runnable check: a table of ~10 known words and their expected splits, plus one that must return `undefined`.

### 9. C — the word-building task

A new task kind: the gloss is the prompt, the learner assembles the word from a bank of its parts plus distractor affixes. Two things make it fit the platform rather than the language:

- It **self-gates on data**, exactly as plan 0021 §9's Exercises page already does with `TASK_ALLOWED_ITEM_KINDS` / `TASK_REQUIRED_ASSET`: a unit whose items have no `components` is never offered the task type. No per-language branch, no flag.
- Its distractor bank is the **first place `bound` genuinely drives sampling** — the entries to draw wrong parts from are exactly the affix entries.

Same task type serves a medical-terminology or CS domain unchanged. Its own plan; not designed here.

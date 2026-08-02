# Spec 0021-4: `draftContent`, `checkReferences`, and problem markers

Slice 4 of [plan 0021](../plans/0021-in-place-editing.md) (§1–§3). Independent of slices 1–3. Self-contained per the `/delegate` convention; **make no new design choices**.

Pure code only — no component, no screen, no routing. This slice makes it _possible_ to render a mid-edit draft and to say what is wrong with it; slices 6–7 do the rendering.

## Context (read first)

- `packages/schema/src/validate.ts` (911) — **the whole file.** One function is extracted from it by mechanical move.
- `packages/schema/src/entities.ts` — the entity schemas `draftContent` must produce values for. Skim; you need the payload shapes per `kind` (lines 134–210) and `DOMAIN_ENTRY_KIND` (216).
- `packages/engine/src/documentSource.ts` — **one range**: the `validateContent` call at lines 195–210, the only caller.
- `packages/schema/src/documents.ts` (134) — `BookDocument` / `DomainDocument`.
- `packages/schema/src/validate.test.ts` — the existing suite, which must stay green.

## Not in this slice

Any UI. Any change to what `validateContent` reports or when. Rendering markers.

---

## 1. Extract `checkReferences`

A **pure mechanical move**. Existing behaviour and existing test results must not change.

`validateContent` today runs three phases and returns early twice:

| lines   | phase                                              | early return      |
| ------- | -------------------------------------------------- | ----------------- |
| 173–254 | zod parse of every entity                          | `validate.ts:254` |
| 264–303 | uniqueness (duplicate ids, duplicate list entries) | `validate.ts:303` |
| 305–886 | ~40 referential checks                             | `validate.ts:886` |
| 889–910 | assemble `Content`                                 | —                 |

Move **phases 2 and 3 together** into one exported function:

```ts
export interface ParsedSet {
  book: Book;
  lessons: Lesson[];
  units: Unit[];
  /** Book-owned items ONLY — never the merged pool. See §1a. */
  items: Item[];
  tasks: Task[];
  resources: Resource[];
  notes: { id: string; stem: string }[];
  domain: Domain;
  entries: Item[];
  families: Family[];
  /** Asset stems, carried through unchanged from ValidateContentInput. */
  audioStems: string[];
  imageStems: string[];
  lexiconAudioStems: string[];
  lexiconImageStems: string[];
  noteImageRefs: { noteStem: string; stem: string }[];
}

export function checkReferences(parsed: ParsedSet): string[];
```

`validateContent` becomes: parse → build `ParsedSet` → `checkReferences` → if empty, assemble and return `Content`.

**The uniqueness phase goes inside `checkReferences`, keeping its early return.** It is not cosmetic: the by-id `Map`s built at `validate.ts:306–317` are last-wins and therefore ill-defined when ids collide, so every check below them would report nonsense. With generated UUIDs a collision is vanishingly rare, but the guard is what makes the function safe to call on arbitrary input.

### 1a. The trap that makes this worth specifying

`ParsedSet.items` is **book-owned items only**.

`Content.items` is _post-merge_ — `validate.ts:902` returns `[...items, ...referencedEntries]`. But the `${book.code}-` prefix check at `validate.ts:320–324` iterates the **unmerged** `items`. Hand `checkReferences` a `Content` and every lexicon entry is reported as wrongly prefixed, because entry ids start with the _domain_ code.

This is invisible in the repo today only because the seed Book's code and its lexicon's code are both `dx`. Plan 0021 decision 11 makes a distinct code per document routine, so it would fire immediately.

`ParsedSet` mirrors the local bindings at `validate.ts:305–317`, not `Content`. If the signature you write can accept a `Content`, it is wrong.

### 1b. Asset stems

The reference phase reads `input.audioStems` / `input.imageStems` / `input.lexiconAudioStems` / `input.lexiconImageStems` directly off the input. Those move onto `ParsedSet` — do not leave `checkReferences` reaching for a second parameter.

`noteImageRefs` is slice 2's field. If slice 2 has not landed, omit it here and add it there; if it has, carry it.

---

## 2. `packages/engine/src/draftContent.ts` (new)

```ts
export function draftContent(
  book: BookDocument,
  domain: DomainDocument,
  assets: AssetStems,
): { content: Content; parsed: ParsedSet };
```

It **constructs**; it never parses, never validates and cannot throw. Three helpers do the work:

```ts
const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const obj = (v: unknown) =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
```

### 2a. Why not a lenient `validateContent`

Because dropping an invalid entity makes the row the author is typing into vanish mid-keystroke. Verified failure, not a hypothetical: `BookEditor.tsx:318` creates `{ id, kind, payload: {}, sourceRef: "" }`, and running the real validator on it yields

```
ky-i1: payload.text: expected string, received undefined;
       payload.translation: expected string, received undefined;
       sourceRef: must be a valid slug
```

Every item is invalid the instant it exists. `draftContent` turns that into `{ text: "", translation: "" }` — an empty, focusable input.

### 2b. Per-kind item construction

Switch on `str(e.kind)`; **default to `sentence`** so an unknown or missing kind still yields a renderable row rather than a dropped one.

| kind       | required fields filled with `str(...)` | optional fields                                                                     |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `lexeme`   | `script`, `transliteration`, `gloss`   | `example` (both halves), `usageNote`, `audioRef`, `imageRef`, `links`, `components` |
| `concept`  | `term`, `definition`                   | `example`, `audioRef`, `imageRef`, `links`                                          |
| `sentence` | `text`, `translation`                  | `audioRef`                                                                          |
| `pair`     | `a.script`, `b.script`, `contrast`     | —                                                                                   |

**Optional fields are omitted, never coerced.** `slugSchema` rejects `""`, so `audioRef: ""` would be a value the schema can never accept; spread it in only when `typeof v === "string" && v !== ""`. Same rule the editor's own `setPath` already follows (`fields.tsx:88–95`).

`pair.payload.{a,b}.audioRef` is the one _required_ slug in the schema. Fill it with `str(...)` — `""` renders as "no audio" everywhere that reads it, and the publish gate is what reports it missing. Do not invent a placeholder stem.

### 2c. The merge

`Content.items` must be book items **plus the domain entries this Book's units actually reference**, replicating `validate.ts:892–902`. Skip it and the Vocabulary page is empty in edit mode. `ParsedSet.items` stays unmerged (§1a).

### 2d. Notes

`Content.notes` is `{ id, stem }[]` with `id = \`${book.code}-note-${stem}\``, from `book.notes.map(n => n.stem)`. The markdown itself is not part of `Content` — slice 6 threads it separately.

---

## 3. `packages/engine/src/documentProblems.ts` (new)

```ts
export interface Problem {
  /** Entity id, or "topic" / "domain" for the singletons. */
  entityId: string;
  /** Dotted field path when known ("payload.gloss"); absent for whole-entity problems. */
  path?: string;
  message: string;
}

export function documentProblems(
  book: BookDocument,
  domain: DomainDocument,
  assets: AssetStems,
): {
  all: Problem[];
  /** Same problems, keyed by entityId — built once here, not re-scanned per row. */
  byEntity: Map<string, Problem[]>;
};
```

**Return both shapes.** Slices 6–8 render a marker on every field of every row; a flat array means a linear scan per input per render, and slice 6 §3 additionally needs "problems naming this unit and nothing narrower", which every caller would otherwise re-derive. One `Map` built here removes both.

Two sources, **neither of them a new rule**:

- **Field-level** — run each entity's own zod schema per entity (`itemSchema.safeParse(entity)`, `unitSchema`, `lessonSchema`, `taskSchema`, `resourceSchema`, `bookSchema`, `domainSchema`, `familySchema`). Every `issue` yields one `Problem` with `path = issue.path.join(".")` and `message = issue.message`. This is deliberately per-entity rather than the batched `parseAll`, because batching is what produces the wave-masking below.
- **Entity-level** — `checkReferences(draftContent(...).parsed)`, each string split on its leading `<id>: ` prefix. Strings not matching that shape (`topic.lessonIds: dangling lesson reference "x"`) attach to `topic`.

### 3a. Why this beats calling `validateContent`

`validateContent` returns after the zod phase (`validate.ts:254`), so **the first typo hides every reference error in the document**. Running the two phases separately — per-entity zod for fields, `checkReferences` over the _coerced_ set for references — surfaces both at once, with zero rules duplicated.

Feeding `checkReferences` the coerced `parsed` is what makes this work: it always satisfies the phase-1 shape by construction, so the reference checks always run.

### 3b. Two consequences to expect, not fix

- A freshly created item reports both `payload.text: expected string` (field) and `dangling sourceRef ""` (entity). That is accurate — both are true.
- `checkReferences` over coerced data reports `dangling sourceRef ""` where the raw document had no `sourceRef` at all. Also accurate, and slice 10's seeded resource removes the whole class.

---

## 4. Tests

- **`packages/schema/src/validate.test.ts`** — unchanged and green. That is the proof the extraction was mechanical. If a case needs editing, the move was not a move.
- **`packages/engine/src/draftContent.test.ts` (new)**
  - Verbatim `{ id, kind: "sentence", payload: {}, sourceRef: "" }` yields an item with `payload.text === ""` — the row survives.
  - An entity with an unknown `kind` yields a `sentence` and is not dropped.
  - An absent `audioRef` is **absent** from the output, not `""` (spread-only-when-non-empty).
  - `content.items` includes a referenced domain entry; `parsed.items` does not.
  - Garbage input — `undefined` payloads, arrays where objects belong, numbers where strings belong — does not throw.
  - `checkReferences(draftContent(book, domain).parsed)` runs to completion on a document whose raw form fails phase 1.
- **`packages/engine/src/documentProblems.test.ts` (new)**
  - A document with **both** a field error and a dangling reference reports both — the wave-masking regression test, and the most important case here.
  - A field problem carries the exact `path` (`payload.gloss`).
  - A `topic.lessonIds:`-prefixed reference error attaches to `topic`, not to an entity called `topic.lessonIds`.
  - A valid document reports nothing.

## Verification

`corepack pnpm check` green, with `validate.test.ts` untouched.

Nothing is visible in the app after this slice — that is expected and correct. Confirm by opening the app and seeing no change at all.

## Done-criteria

- `checkReferences` is exported, takes `ParsedSet` (not `Content`), and `validateContent` calls it.
- Every existing validator test passes without edits.
- `draftContent` never throws and never drops an entity, for any input.
- `documentProblems` reports field and reference problems from the same document in one call.
- No UI file changed.

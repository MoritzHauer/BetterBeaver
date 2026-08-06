# Spec 0021-10: Book creation, seeded resource, and publish-error deep-linking

Slice 10 of [plan 0021](../plans/0021-in-place-editing.md) (§7, §9, §11). Depends on **slices 4–9**. Self-contained per the `/delegate` convention; **make no new design choices**.

Three small things that finish the story: a Book you create is immediately editable and immediately valid, and any error publish reports is one tap from the thing that caused it.

## Context (read first)

- `apps/web/src/screens/AuthorScreen.tsx` (264) — **whole.** Gains "New Book"; its two list rows change destination.
- `apps/web/src/backend/supabase.ts` — `loadDocument` / `saveDraft` / `publishDocument` signatures, and the `documents` insert shape. Lines 60–150.
- `supabase/migrations/20260719000000_content_backend.sql` — lines 88–125 and 238–257 only (the insert grant, `documents_insert`, and the creator-maintainer trigger). **No migration is needed** — §1a.
- `packages/schema/src/documents.ts` — `documentId`, `contentIdOf`, `CONTENT_SCHEMA_VERSION`.
- `packages/schema/src/documents.ts` — `validateContentSet` (110–134), for §1b.
- `apps/web/src/screens/edit/types.ts` — `EditTarget` and `initialView` (22–60), for §3.
- `apps/web/src/content/source.ts` — `createPrivateBook` (~905–930), the existing pair-creating path to mirror.
- `docs/specs/0012-editor-long-tail.md` §4 — the original creation spec, which this amends.

~800 lines. Inside budget.

---

## 1. Creating a Book creates its lexicon

`AuthorScreen` gains **New Book**: a form for a title, nothing else. Slug ids are not typed — ids have been generated since spec 0018.

It inserts **two** `documents` rows:

- `documentId("topic", bookId)` — `kind: "topic"`, `draft` = a skeleton `BookDocument`.
- `documentId("domain", domainId)` — `kind: "domain"`, `draft` = a skeleton `DomainDocument`.

Then routes to `{ screen: "book", bookId, editing: true }`.

This fixes something currently broken. Long-tail §4 creates only the Book and says "Domains stay admin-created (dashboard) — no UI", so as written a creator ends up pointing at a lexicon they cannot create. Mirror what `createPrivateBook` already does for the private path: a Book always owns its own lexicon.

### 1a. No migration is needed — verified

```sql
grant insert (id, kind, draft, schema_version, created_by) on public.documents to authenticated;
create policy documents_insert on public.documents
  for insert to authenticated with check (created_by = auth.uid());
```

`kind` is in the grant and unrestricted by the policy; the table's own check constraint permits `'topic'` and `'domain'`; and `documents_creator_maintainer` (line 253) fires on any insert with `created_by not null`, so the creator becomes maintainer of **both**. "Domains stay admin-created" was a product choice, not a backend constraint. **Do not write a migration.** If you believe one is needed, stop and say why rather than adding one.

### 1b. Derive the lexicon code from the generated id, not the title

`validateContentSet` (`documents.ts:110`) enforces globally unique **domain codes** but never checks Book codes. A code derived from a user-chosen title or slug can therefore collide where a duplicate Book code would not, and the collision surfaces only at admin-listing time, in someone else's Book.

Generate both ids first, derive both codes from them. The seed's shape — Book code `dx`, lexicon code `dx` — is fine; codes only need to be unique _among domains_.

### 1c. Two rows, one failure mode

The inserts are not atomic. If the second fails, the author has a Book pointing at a lexicon that does not exist, and every lexicon reference dangles.

Insert the **lexicon first**, then the Book. A lexicon with no Book is inert and harmless; a Book with no lexicon is broken. If the Book insert fails, report it and leave the orphan — do not attempt a rollback delete, which needs a `delete` grant the role does not have.

Duplicate id → surface the PK violation as "that name is taken" rather than the raw Postgres message.

### 1d. Seed one resource

The skeleton `BookDocument` carries **one** resource: `{ id: newEntityId(bookCode), title: <the Book's title>, path: "" }`.

Every item and every lexicon entry requires a `sourceRef` that resolves (`validate.ts:413`, `:785`). Without a seeded resource, the first item an author creates is invalid, which is error wave 1 in the plan's §1 and the reason `EntityPicker.freeTextWhenEmpty` (`fields.tsx:306`) exists at all.

With this seeded, new items default their `sourceRef` to it (slice 8 §2b) and **`freeTextWhenEmpty` is deleted** — the last free-text id field in the editor goes with it.

`createPrivateBook` gets the same seed, so both paths behave identically.

---

## 2. Domain documents in the author list

`AuthorScreen`'s list shows both kinds. A domain row has no learner screen to route to.

Route it to the Book that owns it — find the added Book whose `domainId` matches (`privateBookForDoc` at `App.tsx:1005` already does this shape of lookup) — opening `{ screen: "book", bookId, editing: true }`. When no such Book is added locally, **say so** ("add the Book that uses these words to edit them") rather than dead-ending or silently doing nothing.

After slice 11 there is no form editor to fall back to, which is why this needs handling here rather than being deferred again.

---

## 3. Publish errors deep-link

Ids are hidden everywhere by now. `EntityPicker` used to show them _because validation errors name them_, and spec 0018 made them UUIDs — so without this, `checkReferences` output is unlocatable and hiding ids is a net loss.

Every line in the publish-error list becomes a link. Parse the leading `<id>: ` prefix (the same split slice 4's `documentProblems` already does), resolve the id to the screen that owns it, and navigate there in **Diff** mode when a base exists, otherwise Edit mode.

Resolution reuses the existing machinery — build an `EditTarget` and let `initialView`-equivalent logic pick the level:

| id belongs to       | destination                                      |
| ------------------- | ------------------------------------------------ |
| a lesson            | that Lesson screen                               |
| a unit              | that Unit screen, Overview                       |
| a book item         | its unit's Vocabulary / Concepts / Examples page |
| a lexicon entry     | its unit's Vocabulary page                       |
| a task              | its unit's Exercises page                        |
| a note              | its unit's Theory page                           |
| a resource          | the Book screen's Sources section                |
| `topic` / `topic.*` | the Book screen                                  |

An id that resolves to nothing — a dangling reference to something already deleted — renders as plain text with the id visible. **This is the one place an id may still appear**, and it is correct: there is nothing else to name it by.

Ids remain in the data, in exported files and in the JSON tooling (`scripts/pull-book.ts`). They are hidden, not removed.

---

## 4. Tests

- Creating a Book inserts two rows, lexicon first, and the Book's `domainId` matches the lexicon's id.
- A failed lexicon insert aborts before the Book insert.
- A failed Book insert reports and does not attempt a delete.
- Duplicate id surfaces as "that name is taken".
- A new Book's first item is **valid on creation** — `documentProblems` reports nothing for it. This is the test that proves the seeded resource works.
- `createPrivateBook` seeds the same resource.
- Each error-id shape in §3's table resolves to the right screen.
- An unresolvable id renders as plain text showing the id.
- `freeTextWhenEmpty` no longer exists in the codebase.

## Verification

`corepack pnpm check` green.

Browser, **maintain mode with a real account**:

1. New Book → confirm you land in it in edit mode with nothing to fix.
2. Add a lesson, unit and word; confirm the word carries **no** `sourceRef` problem.
3. Break something deliberately — point an exercise at a word, then delete the word — publish, and confirm the error line navigates to the exercise.
4. Publish successfully; confirm the Book appears for a learner after the admin lists it.
5. Sign in as a second account, open the same Book's lexicon from the author list, and confirm the "add the Book that uses these words" message rather than a dead end.

## Done-criteria

- New Book yields a Book, its lexicon and one seeded resource, with the creator maintaining both.
- No migration was written.
- The lexicon's code comes from the generated id, not the title.
- A new Book's first item is valid on creation.
- Every publish error navigates to the thing it names.
- `freeTextWhenEmpty` is gone.

# Spec 0018: Auto-generated ids and reference pickers in the editor

> **Landed, and its line citations are stale.** `EditScreen.tsx` was split into `apps/web/src/screens/edit/` on 2026-07-28 (see [design.md](../design.md) — the delegation context-budget row). Every `:NNNN` below refers to the pre-split monolith: `AddEntityForm`/`EntityPicker`/`ITEM_FIELDS` are now in `edit/fields.tsx`, `NewItemForm` and the `onAdd` call sites in `edit/BookEditor.tsx`. Kept as written for the record.

No plan doc — an owner-decided editor fix, direction pinned by a 2-question grilling (2026-07-27). Removes hand-typed entity ids from `EditScreen` entirely: ids become generated, and every id _reference_ becomes a picker over real entities.

## The problem

`EditScreen` asks authors to type raw slugs in two unrelated situations, and both are traps:

1. **Creating an entity** — `AddEntityForm` (`:246`) and `NewItemForm` (`:2282`) take a free-text slug. Verified empirically: every lesson/unit/item/task/resource id **must start with `` `${book.code}-` ``**, and ids must be globally unique across every added Book. An author who does not know that rule produces a Book that lands on a "This Book can't be loaded" card, with the reason only visible after the fact.
2. **Referencing an entity** — `IdListField` (`:218`) is a textarea of one id per line. Its own doc comment admits "unknown/invalid ids surface at publish, not here". You cannot see what you are referencing; the ids carry no titles.

## Owner decisions (do not reopen)

1. **UUIDs everywhere.** Ids are generated in every editor mode — maintainer, propose and private alike. No id text field survives. The owner accepted that new backend ids stop being human-readable (`ky-unit-greet-choosing`); already-authored content keeps its ids, since nothing rewrites existing entities.
2. **All reference fields get a picker in this pass**, not just the textareas.
3. **The task editor's item picker is the priority case**, the lexicon inside it must be searchable, and it opens **pre-filtered to the owning unit's own content**.

## 1. Id generation

Every newly created entity gets `` `${book.code}-${crypto.randomUUID()}` ``.

**The `${book.code}-` prefix is mandatory and is the whole point** — a bare UUID fails validation (`validate.ts`, the "id must start with" class). Reuse `newPrivateId()` from `apps/web/src/content/private-ids.ts` for the UUID half rather than calling `crypto.randomUUID()` directly, so there is one generator.

For a **domain** document there is no book in hand — use the domain's own `code` as the prefix, matching how shipped lexicon entry ids are formed (`dx-con-dam` under domain code `dx`).

Remove the id `<input>` from `AddEntityForm` and `NewItemForm`. `AddEntityForm` becomes a single button ("Add lesson", "Add unit", …); `NewItemForm` keeps only its **kind** `<select>` plus the button. Both call the same `onAdd` callbacks that exist today, passing the generated id — so their call sites (`:2023`, `:2027`, `:2061`, `:2099`, `:2168`, `:2256`, `:2434`, `:2462`) keep working with minimal change.

After adding, the new entity should be the one the editor navigates into or scrolls to; do not leave the author hunting for an untitled row.

## 2. `EntityPicker` — one component, three shapes

Add one component used by every reference field. **Do not build a tree widget**: the only hierarchy worth showing is lesson→unit, and a general tree is a lot of code for that single case.

```
EntityPicker({
  label,
  options: { id, title, subtitle?, group?, kind? }[],
  selected: string[],
  multiple: boolean,          // false => single-select (sourceRef, unlocksAfterUnitId)
  ordered?: boolean,          // multi only: keep + reorder selection order
  groupBy?: boolean,          // render `group` headers (units grouped by lesson)
  filters?: { key, label }[], // optional chips, see §3
  onChange,
})
```

Behaviour:

- **Search box always present**, filtering on title, subtitle and id. This is the single most important affordance — `itemIds` resolves against the merged pool of book items **plus the whole domain lexicon** (`validate.ts:313`), which for Kyrgyz is hundreds of rows.
- Options render as a scrollable filtered **checkbox list** (radio when `multiple: false`), each row `Title` with the id as a muted subtitle. Never make the author read or type the id, but never hide it either — it is what validation errors name.
- `ordered: true` keeps the existing up/down reordering behaviour that `RowActions` already provides for unit item lists; selection order is the stored array order.
- `groupBy: true` renders a header per `group` value. Used **only** for unit references.
- An id in `selected` that matches no option still renders, marked as unresolved, and stays selected. Dangling references already exist in authored content and must be visible and removable, not silently dropped.

## 3. Field-by-field wiring

| Field                | Pool                                 | multiple | ordered | groupBy       | filters                     |
| -------------------- | ------------------------------------ | -------- | ------- | ------------- | --------------------------- |
| task `itemIds`       | book items + domain entries (merged) | ✓        | ✓       | –             | **see §4**                  |
| unit `itemIds`       | book items + domain entries (merged) | ✓        | ✓       | –             | "Book items" / "Vocabulary" |
| unit `taskIds`       | book tasks                           | ✓        | ✓       | –             | –                           |
| unit `noteIds`       | book notes                           | ✓        | ✓       | –             | –                           |
| lesson `unitIds`     | book units                           | ✓        | ✓       | –             | –                           |
| book `lessonIds`     | book lessons                         | ✓        | ✓       | –             | –                           |
| family `entryIds`    | domain entries                       | ✓        | –       | –             | –                           |
| `unlocksAfterUnitId` | book units                           | –        | –       | ✓ (by lesson) | –                           |
| `recallUnitIds`      | book units                           | ✓        | –       | ✓ (by lesson) | –                           |
| `sourceRef`          | book resources                       | –        | –       | –             | –                           |

`unlocksAfterUnitId`, `recallUnitIds` and `sourceRef` are currently plain `FieldSpec` text fields (`f("Source ref", "sourceRef")` at `:91`, `:97`, `:107`, `:115`). They need to leave the generic `EntityForm` spec list and be rendered as pickers alongside it — do **not** try to teach the string-typed `FieldSpec`/`Field` machinery about entity references.

Titles: use each entity's own `title`/`name`; for lexicon entries use the headword. Where an entity has no title yet (freshly added), fall back to its id so the row is still selectable.

## 4. The task item picker — the priority case

A task is reached from the unit that owns it, and in practice its items are drawn from that unit's own `itemIds`. So the task's item picker opens with a filter chip row:

- **"This unit" (default, active on open)** — restricted to the owning unit's `itemIds`.
- **"Book items"** — all book-owned items.
- **"Vocabulary"** — the domain lexicon entries, searchable.
- **"All"** — the full merged pool.

The default must be "This unit": it turns the common case into a two-tap operation instead of a search through the whole lexicon. Switching to any other chip must not clear the existing selection.

The owning unit is the unit whose `taskIds` contains this task. Resolve it from the working document; if a task belongs to no unit (legal — an orphan task), fall back to "All" as the default chip and omit "This unit".

## Done criteria

1. `corepack pnpm check` green, except `ToDo.md`, which is dirty in the working tree from the owner — do not touch or reformat it. Every file you touch must be prettier-clean.
2. **Unit tests for the pure logic**, which is genuinely testable here: the id generator (`${code}-${uuid}` matches `slugPattern` and carries the required prefix — assert over 100 generated ids, since UUID segments can start with a digit), and the option-building/filtering helper (search matches title, subtitle and id; the "This unit" filter yields exactly the owning unit's ids; an unresolved selected id survives filtering). Factor those helpers to be pure and DOM-free. Do not add `fake-indexeddb`.
3. Typecheck clean.
4. No id text input remains anywhere in `EditScreen.tsx` — grep it to confirm.

## Out of scope

Rewriting ids of already-authored entities (existing content keeps its ids). Any change to `packages/`. Any change to validation rules. Renaming or migrating the shipped Kyrgyz/demo content. Bulk-select or drag-and-drop reordering — the existing up/down controls stay.

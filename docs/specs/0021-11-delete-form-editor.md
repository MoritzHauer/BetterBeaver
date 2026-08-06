# Spec 0021-11: Delete the form editor

Slice 11 of [plan 0021](../plans/0021-in-place-editing.md) (§12). Depends on **slices 1–10, all landed and browser-verified**. Self-contained per the `/delegate` convention; **make no new design choices**.

The last slice, and the only one that deletes. Everything before it shipped with the form editor still present and reachable.

## Context (read first)

- The files being deleted (below) — enough of each to confirm nothing unique survives in it.
- `apps/web/src/screens/edit/EditSession.tsx` — where the surviving pieces live.
- `apps/web/src/App.tsx` — the remaining `EditScreen` references, and `openSessionEdit` (1024).
- `apps/web/src/screens/SessionScreen.tsx` (~1250) — **the `✎` call sites and the question components**, for §3's scoped sheet.
- `apps/web/src/components/Sheet.tsx` (160) — the sheet primitive that sheet is built on.
- The Unit-page item controls from slice 6 and the exercise controls from slice 8 — the sheet reuses them rather than growing its own.
- `docs/specs/0021-5-edit-session.md` §2c — the routes that were deliberately left pointing at the old editor.

~1800 lines, the largest read of any slice — because **this is not only a deletion**. §3's scoped session sheet is a real component. If that pushes the reading past comfort, split this slice: build the sheet first, delete second.

---

## 0. Do not start this slice early

Every earlier slice ships with both editors present. That is the transition, not the end state. An implementer who deletes a form before its replacement exists strands the surface that used it — and the strandings are not obvious, because the form editor is reachable from `AuthorScreen`, from `importDocuments`, and from the question screen's `✎`.

**Gate**: slices 1–10 are landed _and_ browser-verified, including maintain mode with a real account. If any of that is outstanding, this slice waits.

---

## 1. Delete

| file                                  | lines | why it can go                                                   |
| ------------------------------------- | ----- | --------------------------------------------------------------- |
| `screens/edit/BookEditor.tsx`         | 563   | replaced by slices 6–8                                          |
| `screens/edit/fields.tsx`             | 438   | replaced by the in-place controls — **except `RowActions`**, §2 |
| `screens/edit/DomainEditor.tsx`       | 203   | replaced by the Vocabulary page (slice 6)                       |
| `screens/EditScreen.tsx`              | 67    | the dispatcher; nothing dispatches now                          |
| `screens/edit/MaintainEditScreen.tsx` | 557   | lifecycle moved into `EditSession` (slice 5)                    |
| `screens/edit/ProposeEditScreen.tsx`  | 399   | same                                                            |
| `screens/edit/PrivateEditScreen.tsx`  | 399   | same                                                            |

1271 lines go outright; 1355 were replaced rather than removed, and a meaningful part of those reappeared inside `EditSession` — that is real I/O, not duplication, so do not expect the net to be −2626.

**Survivors, rehomed and unmodified**: `screens/edit/ProposalReview.tsx` (205), `screens/edit/AssetsManager.tsx` (239), `screens/edit/types.ts` (106, minus what became dead).

---

## 2. `RowActions` is not deleted

`fields.tsx` goes, but `RowActions` is used by slices 6–8 for up / down / delete on every editable list, and its 44px hit targets came out of the 2026-07-19 UI audit. Move it — ideally to `components/RowActions.tsx` — before deleting the file it lives in.

Check the same way for anything else in `fields.tsx` that a slice 6–8 surface ended up importing. `setPath` / `getPath` are the likely other survivors; if nothing imports them, they go.

---

## 3. Loose ends the earlier slices deliberately left

Each of these was left pointing at the form editor on purpose. All must be resolved here, and none is a one-line deletion:

- **The question screen's `✎`** (`App.tsx:1024`, `openSessionEdit`) still layers `EditScreen` over the running session. Plan decision 13 replaces it with a **scoped sheet** holding only the tapped item or exercise, using the same field controls the Unit page uses, with the session staying mounted underneath (design.md:115). Build that here, or this slice cannot delete `EditScreen`.
- **`importDocuments`** (`App.tsx:966`) writes a draft or proposal key and opens the editor. The storage half is unchanged; only the destination moves. An imported **domain** document with no added Book hits slice 10 §2's message.
- **`AuthorScreen`'s two lists** route by slice 10 §2.
- **`EditTarget` / `initialView`** (`types.ts:22–60`) exist to seed the old `View` state machine. Slice 10 §3 reuses the _shape_ for error deep-linking; the `View` union and `upView` are dead. Delete what is genuinely unreferenced and keep what deep-linking uses.

---

## 4. Docs

- `docs/design.md` — mark the 0012 §7 form-editor row retired, per the file's own instruction to strike a row when a later plan amends it.
- `docs/STATUS.md` — plan 0021 moves to implemented; the "Editor split + cycle gate (2026-07-28)" entry describes a file layout that no longer exists and needs a closing note.
- `docs/architecture.md` — the "Authoring" bullet says "a form-based editor over the author's documents". Rewrite it.
- `docs/specs/0012-editor-long-tail.md` — §1 and §2 were struck when plan 0021 was written; §3's delete-confirms bullet can now be marked done-by-deletion.

---

## 5. Tests

Delete tests that exercised deleted components; **keep every test that asserts behaviour**, re-pointed at the new surface. Losing coverage is the easy mistake here — a deleted test looks like tidying.

Before finishing, grep the deleted files' export names across the repo and confirm zero hits. `tsc` catches imports; it does not catch a string in a comment or a doc that now lies.

`corepack pnpm check` green, and `lint:cycles` specifically: removing a module can reveal a cycle that was previously broken by the deleted file's import order.

## Verification

Browser, all three modes, because this slice removes the fallback for each:

- **private** — create, edit, add assets, export and re-import.
- **maintain**, real account — load, edit, Sync, Preview, Diff, publish, review and accept a proposal, manage assets.
- **propose**, second account — load, edit, submit; confirm the maintainer sees it.
- The question screen's `✎` opens the scoped sheet mid-session and the session survives it, with its shuffle and answers intact.
- Import a Book file from Settings and land in the right place.

## Done-criteria

- The seven files are gone; `EditScreen` is not importable.
- `RowActions` survives, moved.
- The question screen's `✎` uses the scoped sheet.
- Every route that pointed at the form editor has a destination.
- No test was deleted without its behaviour being asserted somewhere else.
- The four docs no longer describe a form editor.
- `pnpm check` green; all three modes verified in a browser.

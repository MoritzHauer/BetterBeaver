# Spec 0019: Unhandled promise rejections on the storage paths

Closes [STATUS.md](../STATUS.md) handoff backlog item 8. No plan doc — an owner-decided hardening pass, direction pinned by a grilling (2026-07-28) that ran an audit of all 19 flagged sites first.

Line numbers are as of `f071d73` and will drift as you edit; the symbol names are the durable reference.

## The problem, and what the audit actually found

`pnpm lint` reports 10 `@typescript-eslint/no-floating-promises` warnings, and `eslint.config.js` exempts 9 more `no-misused-promises` sites in `SessionScreen` as accepted React idiom. **The warning count is misleading.** Reading each one:

| Site                                                         | Can it actually reject?                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `App.tsx:719` `readCachedDocuments()`                        | **No** — `cache.ts:19` is try/catch → `[]`, documented "never to a crash"  |
| `App.tsx:837` `progressStore.getAttemptedTaskIds()`          | **No** — `Promise.resolve(...)`; a throw is _synchronous_, not a rejection |
| `App.tsx:887` `source.listBooks()`                           | **No** — `Promise.resolve` over an in-memory Map                           |
| `App.tsx:888` `source.listDomains()`                         | **No** — same                                                              |
| `edit/PrivateEditScreen.tsx:60` `readPrivateBook()`          | **No** — `private-store.ts:45` is try/catch → `undefined`                  |
| `App.tsx:900` `Promise.all(books.map(loadBook))`             | **YES**                                                                    |
| `App.tsx:992` `Promise.all([contentPromise, domainPromise])` | **YES** — same `loadBook`/`loadDomain` family                              |
| `App.tsx:422` `dueDomainUnits(...)`                          | Only if `localStorage` itself throws                                       |
| `BookScreen.tsx:83` `dueUnits(...)`                          | Only if `localStorage` itself throws                                       |
| `StatsScreen.tsx:29` `gatherStats(...)`                      | Only if `localStorage` itself throws                                       |
| `SessionScreen` ×9 grade handlers                            | **YES** — `QuotaExceededError` on write                                    |

So there are **two** genuinely independent rejection paths, not ten, plus the grade path, plus one root cause behind the "only if `localStorage` throws" class.

### Why `loadBook` can reject

`documentSource.ts:282`:

```ts
loadBook(id: string): Promise<Content> {
  const content = contentByBookId.get(id);
  if (content === undefined) {
    return Promise.reject(new ContentValidationError([`unknown book: ${id}`]));
  }
  ...
```

This contradicts the module's own contract at `documentSource.ts:160` — _"Never throws; callers inspect `broken`."_ It is reachable because `listBooks()` returns only **validated** books while `App.tsx`'s `domainBookIds` comes from the **membership list**, which can hold a stale id after a Remove. One stale id rejects the whole `Promise.all`, so the books list never loads and the screen stays blank.

### Why the grade path freezes

`SessionScreen.tsx:213`:

```ts
async function grade(selfGrade: SelfGrade) {
  if (graded) return;
  setGraded(true); // every grade button now disabled
  await applySelf(unitId, selfGrade);
  advance(); // never reached if applySelf throws
}
```

The chain is `applySelf` → `onGrade` → `handleGrade` (`App.tsx:193`) → `recordGrade` (`engine/store.ts:89`), which performs five `localStorage` operations including three `setItem` writes. If a write throws, `graded` is already `true` and `advance()` never runs: **all grade buttons stay greyed out, the question never changes, and nothing is displayed.** Reloading is the only escape.

Realistic triggers are narrow but real: **iOS Safari private browsing**, where `setItem` throws `QuotaExceededError` on the first write, and shared-origin quota exhaustion (GitHub Pages puts every project on one origin).

### The root cause behind the third class

`progress/local-storage.ts:14`:

```ts
export function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key); // <- OUTSIDE the try
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
```

The `try` covers only `JSON.parse`. A `SecurityError` from blocked storage escapes, and because `dueUnits`/`dueDomainUnits`/`gatherStats` are `async`, it surfaces as a rejection. Fixing this one line makes that whole class inert.

## Owner decisions (do not reopen)

1. **No boot-time storage probe.** The notice is lazy — it appears the first time a write actually fails, not from a synthetic probe write at startup. A probe that succeeds while the real write later fails is a false negative, and it costs startup work in the overwhelmingly common case where storage is fine.
2. **Reads degrade silently; writes speak up.** After §1 a failed read yields an empty state, which is honest and unremarkable. A failed _write_ means learner progress is being lost, and the learner is told.
3. **`ContentSource` is not touched.** It is one of the two interfaces pinned since plan 0001. The `loadBook` rejection is handled at the call site.
4. **The learner is never trapped.** `advance()` runs even when the grade write fails.

## 1. Root cause: `readJson`

Move `localStorage.getItem` inside the try in `progress/local-storage.ts`, so a blocked-storage `SecurityError` is treated exactly like a corrupt value — absent:

```ts
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}
```

Then guard the one raw read that does not go through it, `stats.ts:64`:

```ts
const itemsInReview = storageKeys().filter((k) =>
  k.startsWith(ITEM_STATE_PREFIX),
).length;
```

where `storageKeys()` is a small local helper returning `Object.keys(localStorage)` inside a try, `[]` on throw. `gatherWordsSaved` needs nothing — it reads through `vocab-lists.ts:49`, which uses `readJson`.

After this, `App.tsx:422`, `BookScreen.tsx:83` and `StatsScreen.tsx:29` **cannot reject**, and join the `void` list in §4.

Do **not** extend this pass to the other raw `localStorage` callers (`theme.ts`, `identity.ts`, `offline.ts`, `sounds.ts`, `MaintainEditScreen`'s draft keys). They are synchronous, not promise sites, and are out of scope — see the bottom of this file.

## 2. The storage notice

One boolean in `App.tsx`: `const [storageWarning, setStorageWarning] = useState(false)`. Once true it stays true for the session; it is not dismissible-and-forgotten, because the condition does not heal.

Render it in the **existing banner slot** beside the content-update banner at `App.tsx:1110`, reusing `className="update-banner"` and `role="status"`. **Add no new CSS and no new component file.**

Copy: **"Your progress can't be saved — this browser's storage is full or unavailable. You can keep studying, but results won't be remembered."**

That wording is deliberate: it states the consequence first, does not blame the learner, and tells them the session still works.

## 3. The two real rejection paths

### 3a. `loadBook` → broken card

At `App.tsx:900` and `App.tsx:992`, attach a per-book `.catch()` so one bad id cannot take the whole `Promise.all` down, and route the failed ids into the **existing** `brokenBooks` path (`App.tsx:802`) so the learner sees the same "This Book can't be loaded" card that a malformed document already produces.

Keep the existing `cancelled` guards exactly as they are.

### 3b. Grade path → never freeze

In **both** `grade` functions in `SessionScreen.tsx` (`:213` and `:272` — they are duplicates; leave the duplication alone, it is out of scope):

```ts
async function grade(selfGrade: SelfGrade) {
  if (graded) return;
  setGraded(true);
  try {
    await applySelf(unitId, selfGrade);
  } catch {
    onStorageUnwritable();
  } finally {
    advance();
  }
}
```

`onStorageUnwritable` is a new optional prop threaded from `App.tsx` to `setStorageWarning(true)`. Check whether the other seven `no-misused-promises` sites in `SessionScreen` (`:175`, `:240`, `:290`, `:293`, `:296`, `:371`, `:502`) share this `setGraded`-then-`advance` shape; **every one that does gets the same treatment.** The nine sites were exempted from lint, not audited — do not assume the two named `grade` functions are the whole set.

## 4. The provably-inert sites

`App.tsx:719`, `:837`, `:887`, `:888`, `edit/PrivateEditScreen.tsx:60`, plus `App.tsx:422`, `BookScreen.tsx:83` and `StatsScreen.tsx:29` once §1 lands.

Prefix each with `void` and a **one-line comment naming why it cannot reject** — "already try/catch → `[]`", "`Promise.resolve` over an in-memory Map", and so on. The comment is the point: a bare `void` reads as "silenced", and the next reader must be able to tell the difference between a proven no-op and a swallowed error.

## 5. Restore the lint rule

In `eslint.config.js`, change `"@typescript-eslint/no-floating-promises"` from `"warn"` back to `"error"` and delete the comment block explaining the deferral.

Leave `no-misused-promises`' `checksVoidReturn: { attributes: false }` exemption in place — but update its comment to note that §3b fixed the then-current handlers and that a **newly added** async attribute handler is still unguarded by lint. That is a known, accepted hole, not an oversight.

## Done criteria

1. `corepack pnpm check` green, with `no-floating-promises` at `"error"` and zero warnings. `ToDo.md` is dirty in the working tree from the owner — do not touch or reformat it. Every file you touch must be prettier-clean.
2. **Unit tests**, in `apps/web/src/progress/local-storage.test.ts` (new) and alongside `stats.ts`:
   - `readJson` returns `null` when `localStorage.getItem` throws (stub `globalThis.localStorage` with a throwing getter), and still returns `null` on malformed JSON — the existing behaviour must not regress.
   - `gatherStats` resolves rather than rejects when `Object.keys(localStorage)` throws.
   - No `fake-indexeddb`; none of this needs it.
3. **Browser-verified**, because no test renders `App.tsx`, `SessionScreen` or `BookScreen`. Simulate a full disk from devtools before starting a session:
   ```js
   Storage.prototype.setItem = function () {
     throw new DOMException("quota", "QuotaExceededError");
   };
   ```
   Then confirm: grading a card **advances** to the next question, the banner appears with the §2 copy, the session can be completed to the summary screen, and reads (book list, stats) still render. Use the `apps/web:verify` skill for the launch/drive recipe.
4. STATUS.md item 8 removed from the handoff backlog, with a landed-work entry recording what the audit found — in particular that 5 of the 10 original warnings were over provably-inert code.

## Out of scope

Hardening the synchronous `localStorage` callers (`theme.ts`, `identity.ts`, `offline.ts`, `sounds.ts`, `MaintainEditScreen` drafts) — they are not promise sites and cannot produce an unhandled rejection. Changing `ContentSource` or any pinned interface. De-duplicating `SessionScreen`'s two identical `grade` functions. Any IndexedDB change. Adding an `ErrorBoundary`. Any telemetry or error reporting — invariant 4 (privacy by default, no telemetry) forbids it, and this notice is local-only.

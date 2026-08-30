# Plan 0024: Focus mode — a high-repetition drill over a small working set

Status: **drafted** · Owner: Moe · Date: 2026-08-24 · Scoped from an owner request ("I miss a focused learning mode. Where you can add content/vocabulary to learn with high repetition") against the code as it stands after plan 0022

## Purpose

Every session in the app today is **one pass**. `buildUnitSession` walks a unit's tasks once. `buildReviewSession` maps one question per due scheduling unit and stops. `buildAdhocSession` maps one question per word in a list. The only repetition inside a sitting is plan 0022's requeue: a single re-show, in Daily Review only, after an *Again*.

That is correct for maintenance and wrong for acquisition. A word you met yesterday and cannot hold needs six or eight retrievals today, spaced by minutes, through different retrieval paths — not one card today and one card in five days. The ladder's first rung is a whole day wide, and there is no verb anywhere in the app for "sit down and hammer these twelve words until they stick".

The ingredients already exist and are not wired together:

- **Sets of words to study**: `VocabList` + `VocabListStore` (per domain), learner-created entries via `UserEntryStore`, and the "My words" / Saved-words surfaces on `VocabularyScreen`.
- **Four ways to ask about a word**: `buildAdhocSession`'s `recall` / `recognize` / `matching` / `listen`, with their floors already enforced at runtime by `availableModes` (ad-hoc sets have no validator behind them).
- **Safety against scheduler damage**: `applyGrade` returns `null` — practice-only, nothing persisted — for any answer on a card that is scheduled and not due. Answer a word thirty times in one afternoon and its ladder rung moves at most once.

What is missing is a loop that keeps asking until the item is actually held, and a reason for that item to come back tomorrow rather than in thirty days.

## Goals

After this plan:

- A learner can put words into a **Focus set** (cap 20, one per domain) from a vocabulary row, from a unit ("focus this unit's words"), from a freshly added "My word", or from a suggestion list of cards they keep failing.
- **Start drill** runs the set until every item has been answered correctly **three times, non-consecutively**, or until a cap is hit. A wrong answer sends the item back into the queue at an expanding gap (2, then 5, then 10 cards). Each repetition of an item uses a **different presentation** — recognize, then listen, then recall — so it is retrieval practice, not a memorised option layout.
- While an item sits in the Focus set, Daily Review shows it **every day**, whatever rung it is on.
- An item **graduates itself** out of the set after three separate days answered Good, keeping the rung it earned; the next Good pays the full ladder interval. Nothing needs manual cleanup.
- The My Books card gains a third chip, **Focus · N**, beside Vocabulary and Daily Review.

## Non-goals

- **No new task types, no new question kinds.** The drill composes `Question`s the engine already builds. See §2.
- **No second scheduler.** `REVIEW_PACES`, `schedule()` and the `ladder`/`sm2` branch are untouched; the daily floor is one clamp on `due` at write time and nothing else. See §3.
- **No leech auto-suspend, no automatic set filling.** Suggestions are a list the learner taps; nothing enters the set on its own. See §4.
- **No named, multiple, or shareable focus sets.** One set per domain. Libraries of word lists are what `VocabList` already is — a second one with a scheduling side effect is a different feature wearing the same clothes. See §1.
- **No `matching` inside a drill.** It grades a whole set in one question, which cannot express a per-item mastery count. It stays a Vocabulary-mode session. See §2.
- **No mistake log.** The suggester derives its candidates from `SrsState` that is already stored. See §4.
- **No server sync.** `bb.focus.*` rides the existing `bb.*` backup sweep, so export/import and "erase all my data" cover it the day it lands; cross-device sync arrives with backlog item 5 or not at all.
- **No cross-domain set**, and no per-Book set. Item ids are globally unique but a learner studies one language at a time; per-domain matches `VocabListStore` and the per-domain streak.

## Design

### 1. The Focus set — one per domain, capped, self-emptying

New store beside the existing two, same shape of interface, same keying:

```ts
interface FocusEntry {
  itemId: string;
  addedAt: string;   // ISO
  goodDays: number;  // separate UTC days answered Good; graduation at 3
  lastGradedDay: string | null; // UTC date, so a second Good today is not a second day
}

interface FocusStore {
  getFocus(domainId: string): Promise<FocusEntry[]>;
  addToFocus(domainId: string, itemId: string): Promise<void>;
  removeFromFocus(domainId: string, itemId: string): Promise<void>;
  setEntry(domainId: string, entry: FocusEntry): Promise<void>;
}
```

Persisted as one `bb.focus.<domainId>` key, JSON, read through the same `readJson` fallback path `learning.ts` uses — absent or corrupt reads as an empty set, never throws, never strands a learner in an unusable screen.

**Cap 20, refused not evicted.** Adding to a full set fails with "Focus is full — graduate or remove a word first". Silent eviction would drop the word you added yesterday exactly when you finally sat down for it, and an uncapped set is the review queue with extra steps: the daily floor (§3) applied to two hundred items is just "study everything every day", which is the thing spaced repetition exists to avoid.

**Why one set and not many.** A second set needs a name, a picker, a default, and an answer to "which set's floor applies to a word in two sets". `VocabList` already covers "I want to keep a themed list of words". Focus is a working bench, not a shelf.

**Dangling ids** are pruned on read, exactly as `VocabularyScreen` already prunes list ids against the merged entry pool — content changes between releases and a focused word can vanish.

### 2. The drill loop

New engine module, `packages/engine/src/drill.ts`, pure and I/O-free like the rest:

```ts
interface DrillItem { itemId: string; correct: number; seen: number; }
interface DrillState { queue: DrillItem[]; done: string[]; answers: number; }

startDrill(itemIds: string[], opts?: { mastery?: number }): DrillState
drillQuestion(state, items, rng, resolvedLinks?): Question | null  // null === finished
advanceDrill(state, correct: boolean): DrillState
```

**Mastery = 3 correct answers per item** (`opts.mastery`, defaulted, not a setting in v1). On the third correct the item leaves the queue for `done`.

**A wrong answer reinserts at an expanding gap** — position 2, then 5, then 10 cards ahead, clamped to the queue length — and resets nothing else: the item's `correct` count drops by one, floored at zero, so a slip costs one retrieval rather than the whole climb. Immediate re-asking is the failure mode to avoid here: answering a card you just saw the answer to is recognition of a screen, not recall of a word.

**Presentation rotates by repetition index**, using each mode's existing floor check from `availableModes` over the drill's own item set, falling back down the list when a mode is unavailable:

| Repetition | Presentation | Falls back to |
| --- | --- | --- |
| 1st | `recognize` (MCQ, auto-graded) | `recall` when the set has < 4 distinct glosses |
| 2nd | `listen` (audio or TTS, auto-graded) | `recognize`, then `recall` |
| 3rd+ | `recall` (self-graded, production) | — always available |

Recognition first, production last: the ordering is the point of the rotation, not variety for its own sake. `matching` is excluded (see Non-goals). Distractors come from the drill set itself, which `sampleAdhocMcq` already does — a five-word set gives thin distractors, which is honest, and the floor refuses below four.

**A cap on length**: the drill ends at `12 × itemCount` answers even if something never masters, and the summary says which items did not graduate. Without it, one impossible word holds a session open forever.

**Grading is the existing path, unchanged.** Every answer goes through the same `recordGrade` → `applyGrade` call site as any other session. That gives the safety property for free, and it is worth stating as a property rather than an accident: **a drill can advance a card's rung at most once per day**, because after the first graded answer the card is no longer due and every later answer returns `null`. Reps counter and per-domain streak both tick — a drill is real work, not a rehearsal.

### 3. The daily floor and graduation

One clamp, at the point where a graded result is persisted:

```
if (itemId is in the domain's focus set) due = min(due, dueAfter(1, gradedAt))
```

`reps` (the rung), `ease` and `intervalDays` are written exactly as the scheduler computed them — only `due` is pulled in. So a focused word climbs the ladder normally while it is being drilled, and on graduation the rung it earned is already there: the next Good pays the full interval with no catch-up.

**Why clamp the stored `due` rather than override the queue.** `reviewQueue` is not the only reader of `due`: `dueCountsByUnit` / `dueCountsByLesson` feed the `· 8 due` badges on Book, Lesson and unit cards. A queue-time override would make the badges disagree with the queue — the counts would say nothing is due while the review offers cards. One source of truth, every surface follows.

**Graduation** advances on the *first* graded answer of each UTC day: Good (quality ≥ 4) increments `goodDays` when `lastGradedDay` is not today, Again (quality < 3) resets it to 0, Hard holds. At `goodDays >= 3` the entry is removed from the set, the clamp stops applying, and the learner sees it in the drill summary as graduated. Three days rather than three answers, because the thing being tested is overnight retention.

**A focused word is pinned in Daily Review**, reusing `reviewQueue`'s existing `pinnedUnitIds` argument — ordering only, no new mechanism.

### 4. Filling the set

Four entry points, all learner-initiated:

1. **A word row / entry popup** on `VocabularyScreen` gains a Focus action beside the existing save action.
2. **A unit** gains "Focus this unit's words" on its Overview — adds the unit's `lexeme`/`concept` items, in order, until the cap.
3. **A freshly added My word** (`AddWordForm`) offers Focus straight after saving, which is the moment the learner is actually thinking about that word.
4. **Suggestions**: a "Struggling with" list on the Focus screen, derived from stored state with no new logging — items whose `SrsState` has `reps <= 1 && intervalDays === 1 && due` in the past or today, i.e. cards that have been graded and are sitting on the bottom rung. Sorted by how long they have been there. Nothing is added without a tap.

### 5. Screens

- **My Books card**: third chip, `Focus · N`, in its own colour beside Vocabulary and Daily Review; hidden at N = 0 so an unused feature costs no pixels.
- **Focus screen**: the set as rows (script / transliteration / gloss, three dots showing `goodDays`), a **Start drill** button, per-row remove, the suggestions list below, and an empty state that explains what the bench is for.
- **The drill itself** runs in `SessionScreen` as a new session kind. It already owns requeueing, grading, the summary, swipe-back and the skip verb; the drill needs its own question source and an end condition, not a second session screen.
- **Summary**: mastered / not mastered / graduated-today counts, in the existing summary layout.

## Slices

Each slice ships on its own and is verifiable in the browser.

- **A — `drill.ts` + tests.** Pure engine: queue, mastery counting, reinsertion gaps, presentation rotation with fallbacks, length cap. No UI, no storage. Deterministic under a seeded `Rng`, as `session.test.ts` does it.
- **B — the bench.** `FocusStore`, the Focus screen, the My Books chip, entry points 1–3, and the drill running in `SessionScreen` over the set. **No scheduler change at all** — grading behaves exactly as it does in an ad-hoc session today. This is the slice that delivers the ask; C and D are the compounding.
- **C — the floor and graduation.** The `due` clamp, `goodDays` bookkeeping, auto-removal, pinning in Daily Review, and the graduated line in the summary.
- **D — suggestions.** Entry point 4, derived from `SrsState`.

## Verification

- **A**: unit tests — an item leaves at exactly 3 correct; a wrong answer at gap 2/5/10 and never adjacent; a 4-item set with 3 distinct glosses falls back off `recognize`; the length cap terminates a never-mastered item; a seeded run is reproducible.
- **B**: browser — add 5 words from three different entry points, drill to completion, confirm the chip count, confirm a removed word leaves immediately, confirm the cap message at 21. Confirm in `bb.*` that a second answer on the same card the same day persists nothing (the practice-only property, observed rather than assumed).
- **C**: browser with a stubbed clock — a focused card at rung 5 comes back tomorrow; three Good days graduate it; the fourth Good pays the ladder interval for its rung; the unit's `· N due` badge and the review queue agree throughout.
- **D**: seed a failed card, confirm it appears in Struggling with, confirm nothing enters the set untapped.
- Every slice ends with `corepack pnpm check`.

## Open questions for the owner

1. **Mastery count and gaps** — 3 correct at gaps 2/5/10 are chosen, not measured. Settings-exposed later, or left pinned?
2. **Cap 20** — right size for a bench, or too small for "I want to learn this whole unit this week"?
3. **Name.** "Focus" reads as calm; the thing is closer to a drill. Chip label is the learner-facing word — Focus, Drill, or Intensive?
4. **Does a drill count toward the daily streak?** §2 says yes. The counter-argument is that it makes the streak cheap to farm.

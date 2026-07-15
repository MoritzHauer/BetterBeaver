# Plan 0004: Vocabulary learning mode

Status: draft, revised after 1 doc-reviewer round (all 9 findings applied) · Owner: Moe · Date: 2026-07-15 · Prerequisite: plan 0002 complete

## Amendments to plan 0001

Plan 0001 pins "an item enters scheduling on its first **task** result". This plan amends that to "first **graded** result": an ad-hoc session answer on a stateless item schedules it, exactly like a task answer (studying vocabulary is studying; the review queue filling from it is intended). The due/practice-only rule is unchanged. Learn-mode viewing still never schedules.

## Purpose

Add a vocabulary-centric study mode: the learner browses all words of a topic, organizes them into groups, and studies any group with a learner-chosen exercise mode — including hearing words read aloud (TTS) and seeing synonyms. Today the only way to practice is author-defined tasks in unit order; this plan adds learner-driven practice over learner-chosen word sets, reusing the existing task machinery.

## Context

- The engine already builds sessions for 10 task types from a `Task` object (`buildTaskSession(task, content, rng)`), grades via the outcome-list contract, and applies the due/practice-only SM-2 rule per scheduling unit. Nothing about session construction requires the task to come from content — except distractor sampling, which is scoped to the task's owning unit.
- Lexeme items already carry optional `audioRef`; most Kyrgyz items have none (audio production is an open question since plan 0001).
- The Web Speech API (`speechSynthesis`) is a native browser feature: zero assets, zero dependencies. Voice availability is per-browser/OS and Kyrgyz coverage is poor — the feature must degrade gracefully (hidden button), not break.

## Goals

The learner can: open a "Vocabulary" screen for a topic listing every lexeme (grouped by unit, searchable); create/edit/delete named word lists from those lexemes (stored locally); pick any unit's vocabulary or any list and study it in a chosen mode — **flashcards** (recall), **multiple choice** (recognize), **matching**, **listening** (listen); tap a speaker icon to hear a word read aloud wherever its script is visible; see a word's synonyms on the word list and on flashcard reveals. Grading feeds SRS exactly like task results.

## Non-goals

- No learner-authored items — lists reference existing topic lexemes only (content stays validator-checked repo JSON).
- No cross-topic lists (a list belongs to one topic; distractor sampling and TTS lang would otherwise mix).
- No synonym quiz mode yet — synonyms are display-only this milestone (quiz added when Kyrgyz content actually has enough synonym data to make one; see open questions).
- No TTS recording/caching — `speechSynthesis` is live-only; `audioRef` assets remain the offline-safe path.
- No changes to SM-2 semantics, grade mappings, task/unit content shapes, or unit completion (ad-hoc sessions never mark task attempts). The scheduling-entry rule *is* amended — see above.

## Design

**Vocab groups.** Two kinds, same study flow: (1) implicit — each unit's lexeme items; (2) learner lists — `{ id, name, itemIds }`, itemIds referencing lexemes of the topic, persisted locally. New pinned interface in `packages/engine`, implemented over `localStorage` in `apps/web` (same pattern as `ProgressStore`):

```ts
interface VocabListStore {
  getLists(topicId: string): Promise<VocabList[]>;
  saveList(topicId: string, list: VocabList): Promise<void>;
  deleteList(topicId: string, listId: string): Promise<void>;
}
```

The web app prunes dangling itemIds on load (content can change between releases); an empty pruned list stays but can't be studied.

**Ad-hoc sessions.** New engine function `buildAdhocSession(type, items, rng)` for `type ∈ {recall, recognize, matching, listen}` over lexeme items. It reuses the existing per-type question builders with one difference: distractors are sampled from the **given item set** instead of the owning unit. Because ad-hoc sets have no validator behind them, the engine enforces floors at runtime via `availableModes(items, opts: { ttsAvailable: boolean })` (the web layer computes `ttsAvailable`; the engine stays I/O-free) and the UI greys out unavailable modes with the reason. Pinned floors — learner lists span units, so class (h)'s per-unit uniqueness cannot be assumed and display-text collisions must be handled here:

- **recall**: any non-empty set.
- **recognize/listen**: ≥4 **distinct display texts** (glosses) in the set; distractor sampling operates over distinct display texts, so no choice ever duplicates another or the correct answer.
- **matching**: 2–8 items with all prompt-side texts unique **and** all answer-side texts unique within the set (mirrors class (p) — `checkMatchingPair` matches by item, so duplicate card texts would make the board undecidable). Sets >8: matching is unavailable; the learner makes a smaller list (no board chunking — cut as needless complexity).
- **listen**: additionally, every item playable — has `audioRef`, or TTS is available (see below).

Grading and SRS application: identical to tasks (outcome list; due/practice-only rule; a stateless item gets scheduled, per the amendment above). No task-attempt marking.

**Read aloud (TTS).** `Topic` gains optional `readAloudLang?: string` (BCP-47, e.g. `"ky"`). This is presentation metadata ("how to speak item text aloud"), not domain leakage — it applies to any topic whose items benefit from being read (species names, terms), and absence simply disables the feature.

Pinned TTS rules (one web-layer helper): **availability** = `readAloudLang` set AND `speechSynthesis.getVoices()` contains a voice whose `lang` matches by case-insensitive BCP-47 prefix (`"en"` matches `"en-US"`) AND that voice has `localService === true` (network-backed voices are ignored — they'd silently break the offline-first invariant). The helper listens for `voiceschanged` before deciding (Chrome returns `[]` from the first `getVoices()` call). **Playback**: if the item has an `audioRef`, play the asset (assets win — they're the offline-guaranteed, pronunciation-correct path); else speak `recognizePrompt(item)`; if neither, render no speaker button. Speaker buttons appear on the vocabulary word list, flashcard reveals, and anywhere the script is already shown post-answer.

`ListenQuestion.audioStem` is currently a required string, so TTS-backed listening **is** a question-shape change: `ListenQuestion` replaces `audioStem` with a required discriminated field `audio: { kind: "stem"; stem: string } | { kind: "speak"; text: string }`. Task construction always emits `kind: "stem"` (class (n) guarantees the asset); the ad-hoc builder emits `stem` when the item has `audioRef`, else `speak` with `recognizePrompt(item)` (the runtime gate guarantees one of the two). `SessionScreen`'s listen arm branches on `audio.kind`.

**Synonyms.** Lexeme payload gains `synonyms?: string[]` (target-language script forms). **Display-only, vocabulary-mode-only**: shown as chips on the word list entry, and the ad-hoc session builder appends an "also: …" line to flashcard (recall) reveals. `recallReveal` in `packages/schema` is untouched — it feeds recall tasks and all review sessions, and quietly changing those flows (plus the "I produced a synonym — Again or Good?" self-grade question) is out of scope; self-grading stays judged against the primary `script`, synonyms are extra information. Validator class (s): a synonym equal to the item's own `script`, or duplicate synonyms within one item.

## Schema changes (`packages/schema`)

- `topicSchema`: optional `readAloudLang` (non-empty string).
- lexeme payload: optional `synonyms: string[]`. Presentation helpers untouched.
- Validator class (s): synonym equal to own `script`, or duplicate synonyms within one item.

## Engine changes (`packages/engine`)

- `buildAdhocSession(type, items, rng)` + `availableModes(items, { ttsAvailable })` with the pinned floors above (distinct-display-text sampling; no chunking).
- `ListenQuestion.audioStem` → discriminated `audio` field per the TTS section (task path always `kind: "stem"`).
- `VocabListStore` interface + `VocabList` type; flashcard-reveal synonym line in the ad-hoc builder.
- Everything else (grading, review queue, scheduling units) unchanged.

## Web changes (`apps/web`)

- `VocabularyScreen`: word list grouped by unit (script, transliteration, gloss, synonyms, speaker button, search filter), list management (create/rename/delete, checkbox item picker), and a study entry point (pick group → pick available mode → existing `SessionScreen` flow fed by `buildAdhocSession`).
- `localStorage` `VocabListStore` impl; TTS helper per the pinned rules (`voiceschanged`, prefix match, `localService`, asset-first); speaker button component; `SessionScreen` listen arm branching on `audio.kind`.
- Route from the topic screen ("Vocabulary" alongside units).

## Implementation order (each step delegable; `pnpm check` green after every step)

1. `packages/schema`: `readAloudLang`, `synonyms`, validator class (s) with seeded fixtures.
2. `packages/engine`: `buildAdhocSession` + `availableModes` + `VocabListStore` interface + `ListenQuestion.audio` migration (incl. web accommodation so the step compiles), RNG-injected tests (group-scoped distinct-text distractors, floor gating incl. duplicate-gloss sets, stateless-item scheduling from an ad-hoc result).
3. `apps/web`: VocabularyScreen, list store, TTS helper, study flow wiring. Set `readAloudLang` on the kyrgyz and demo topics; add `synonyms` to a handful of Kyrgyz lexemes (orchestrator supplies the words).
4. Browser verification pass: word list, list CRUD, all four modes over a learner list, TTS on a browser with a matching voice (demo topic, `en`, is the reliable testbed), graceful hiding without one, SRS state advancing from an ad-hoc session on a due item.

## Done-criteria

- Vocabulary screen usable for both topics; learner lists survive reload.
- All four modes playable over a learner list; recognize/listen refused (greyed with reason) for a 3-item list and for a set with <4 distinct glosses; matching refused for >8 items or duplicate card texts.
- Speaker button audible on the demo topic in Chrome (including after a cold load, i.e. the `voiceschanged` race is handled); absent for Kyrgyz items without `audioRef` when no local `ky` voice exists.
- An ad-hoc answer schedules a stateless item, advances a due item, and changes nothing on a scheduled-but-not-due item; unit completion unaffected.
- `pnpm check` green; class (s) fixture caught.

## Open questions

- **Synonym quiz mode** (MCQ "pick the synonym") — needs enough lexemes with synonyms per group; decide at retro once real synonym data exists. Owner: Moe.
- **TTS for Kyrgyz**: browser voices are unlikely; if read-aloud matters for Kyrgyz, it needs the audio-production pipeline (existing open question from plan 0002), not TTS. Owner: Moe.
- **List export/import**: lists live only in `localStorage` (same durability caveat as progress, plan 0001). Fold into the existing learner-data-durability question. Owner: Moe.

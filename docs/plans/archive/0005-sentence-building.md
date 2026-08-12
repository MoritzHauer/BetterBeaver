# Plan 0005: Sentence-building task type (`build`)

Status: implemented (2026-07-15, steps 1–4; browser-verified per step 4) · Owner: Moe · Date: 2026-07-15 · Prerequisite: plan 0002 complete · Independent of plan 0004

## Purpose

Add the Duolingo-style translation-construction exercise: the learner sees a sentence in their language (L1, the `translation`) and builds the target-language sentence (L2, the `text`) from a word bank of L2 tokens that includes distractor words. This is the production counterpart of `scramble` (which shows the L2 sentence itself and only tests ordering); `build` tests vocabulary selection *and* ordering.

## Context

- `scramble` already ships everything structural: `sentenceTokens()` tokenization (schema), token-shuffle session construction with injected RNG (engine), a token-reorder interaction component (web), and join-equality grading. `build` is a variation: different prompt, extra bank tokens, learner may leave tokens unused.
- The task-type catalogue lives in three exhaustive `Record<TaskType, …>` tables in `packages/schema/src/entities.ts`; adding a member forces every decision (allowed kinds, required asset, distractor need) at compile time.
- Validator class (q) (≥3 tokens) and class (h)/(r)-style uniqueness already exist to reuse.

## Task-type contract (extends the plan 0002 catalogue)

| `Task.type` | Interaction | Grading | Item kind(s) |
|---|---|---|---|
| `build` | see `translation`, assemble the sentence from a shuffled bank of L2 tokens (target tokens + distractors); bank tokens may remain unused | auto (join-equality, same rule as scramble: chosen token strings joined with single spaces must equal the stripped `text`'s tokens joined) | `sentence` |

**Word bank construction** (engine, injected RNG): bank = the sentence's `sentenceTokens()` plus up to `BUILD_DISTRACTOR_COUNT = 3` distractor tokens. Candidate pool: the tokens of the *other* sentence items in the task's owning unit, **deduplicated by token string**, then excluding any candidate **case-insensitively** equal to a target token (a duplicate chip would be visually indistinguishable — or, cased differently, an unfair trap — and gradable either way). Sample without replacement from that pool. Fewer or zero candidates → smaller or empty distractor set; the question is still valid (it degrades toward scramble-with-translation-prompt), so **no new validator minimum** — class (q) extended to `build` is the only floor. The whole bank is then shuffled.

**Review**: unchanged. A due plain-`sentence` scheduling unit still reviews as recall (plan 0002 amendment 3 stands); `build`, like `recognize` and `scramble`, is a task-only interaction.

**Casing/punctuation caveat**: join-equality is exact on token strings (as in scramble — tokens come from the target itself, so the learner can always reproduce them). Distractor tokens keep whatever casing/punctuation they carry in their source sentence; that's acceptable for a word bank (Duolingo does the same).

## Schema changes (`packages/schema`)

- `TASK_TYPES` + `build`; catalogue tables: allowed kinds `["sentence"]`, required asset `null`, needs distractors `false` (the MCQ table — build's bank distractors are its own mechanism, not the MCQ sampler).
- Validator: class (q) applies to `build` items (≥3 whitespace tokens after markup strip). No other new class.

## Engine changes (`packages/engine`)

- `buildTaskSession` grows a `build` arm: new question shape `{ type: "build", prompt: string /* translation */, tokens: string[] /* shuffled bank */, targetTokens: string[] /* sentenceTokens(text) */ }`, one question per item. Bank construction per the contract above (unit-sibling token pool). Carrying `targetTokens` (not stripped text, whose whitespace `sentenceTokens` collapses) makes the reuse below literal: `checkScrambleAnswer` compares against `targetTokens`, and the web verdict detail renders `targetTokens.join(" ")`.
- Grading: reuse `checkScrambleAnswer`'s join-equality on the learner's chosen ordered tokens vs `targetTokens`; outcome list of one `(itemId, quality)` with the auto mapping (wrong → 2, correct → 4).
- Tests: RNG-injected bank determinism, case-insensitive target exclusion, distractor string dedup, the zero-sibling degradation case, grading with unused distractors.

## Web changes (`apps/web`)

- `SessionScreen`: `build` renders the existing token-reorder interaction with two deltas: the prompt line shows the translation, and submission is allowed with tokens left in the bank (scramble requires all tokens placed). Show the standard "tap the words" instruction.

## Demo content

One `build` task in `content/demo/` over the existing demo sentence items (they already satisfy class (q)); extend the disk-loading test expectation. Kyrgyz `build` tasks arrive with the next authored unit (orchestrator work, out of scope here).

## Implementation order (each step delegable; `pnpm check` green after every step)

1. `packages/schema`: type-table entries, class (q) extension, seeded fixture; downstream exhaustiveness accommodation (throwing engine arm, widened web narrowing) so the step compiles.
2. `packages/engine`: session construction + grading + tests.
3. `apps/web` interaction deltas + demo content task; playable in the browser.
4. Browser verification: correct build, wrong-order build, wrong-word build (distractor chosen), unused-distractor correct build.

## Done-criteria

- `build` playable end-to-end from the demo topic; all four verification cases behave (correct → advances SRS as quality 4, any wrong → 2).
- Bank always contains the exact target tokens; no distractor case-insensitively equal to a target token; no two distractors with the same string; ≤3 distractors.
- `pnpm check` green; class (q) fixture for `build` caught.

## Open questions

- **Distractor quality**: random sibling tokens are weak distractors pedagogically (often obviously wrong part-of-speech). If build tasks feel trivial with real Kyrgyz content, consider authored per-item distractor lists (`payload.bankDistractors?: string[]`) — decide when the first Kyrgyz build unit is authored. Owner: Moe.

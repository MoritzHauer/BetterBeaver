# Retro: the L0/L1 card rework (2026-10-17)

Scope: the first real use of the card-authoring skills from [PR 28](https://github.com/MoritzHauer/BetterBeaver/pull/28) (`/card-review`, the `card-reviewer` agent, `/ingest` step 6, [content-practices](content-practices.md) §§7–8, `card-check.py`'s length rule). All 69 live L0/L1 cards of `softwarearchitektur` were reworked in two tasks: a scout run in a scratch tree (69 → 52 cards, two `/card-review` passes per unit, gates green), then a ship run that applied the owner's four calls and republished `topic:softwarearchitektur` and `domain:sa` as v3 ([PR 29](https://github.com/MoritzHauer/BetterBeaver/pull/29), plan 0028's log). The raw review outputs, the verdict ledger and the gate outputs are outside the repo, with the task material.

Trigger: owner, 2026-10-17: a short retro, adjust the skills where needed, and get them ready for L2 onward, which is written from scratch rather than reworked.

## What worked

- **The criteria held up.** Every verdict applied cited a criterion, and none was declined. Cuts and moves landed where the skill says: sets went into `choice` questions (A2), headings into `assign` rows (C1), trivia into the note.
- **The review caught what the gates had passed.** The 69 cards had passed the validator, overlap-check and the browser pass in September. The review still rewrote, moved or cut 63 of them and sent one to the owner, and `card-check.py`'s flag rate fell from 8 of 69 to 2 of 52.
- **OWNER held.** The one doubtful definition (`sa-architekturstil`) went to the owner on every pass, and was never rewritten as a fact.
- **The floors check caught a broken unit before validation.** Pass 1 named 1-4's drop to three concepts, and the owner kept it that way on purpose.
- **Ids stayed stable**, so learners keep their history on all 34 surviving concepts and 14 surviving questions.

## What did not, and what changed

1. **One review run is one sample.** Pass 2, over the reworked units, did not just confirm pass 1. Of the 41 cards pass 1 sent to a rewrite, 23 were still not kept (18 rewrite, 3 cut, 2 move). Five of the 11 cards pass 1 kept were sent to a rewrite on unchanged text (the A/P/K-Frage trio among them). Every pass-2 reason named a defect that pass 1 had missed. `/ingest` step 6 said the opposite: "re-run it only over cards you added; rewrites are checked by the gates". The gates had passed all those rewrites.
   **Change:** `/ingest` step 6 and content-practices §7 now require a second full pass over each unit after its verdicts are applied, then a check of only the cards that pass adds, and no further full passes. Disagreements are settled by the finding, not by a vote. A later verdict that names a concrete defect is applied, even against an earlier KEEP. One that names no new defect is declined, with the reason given. The log's tally is defined as cards kept unchanged across both passes.
2. **card-check churned on text that hadn't changed.** It asks one prompt per unit, so rewording `sa-r2` re-rolled every card in 0-1, and `sa-p-frage`/`sa-k-frage` flagged on text that had passed one run before. Bare labels such as "A-/P-/K-Frage" can't be blind-tested at all: any wording that made them guessable would leak the answer. content-practices §7 said "a flagged card is rewritten, not argued with".
   **Change:** §7 now names the two flags that are declined with a reason: a card unchanged since a run it passed, and a bare-letter label. Per-card calls in `card-check.py` would fix the re-roll at the root. No script change was made, because the cache already limits the churn to one unit, and two declines in 52 don't justify one.
3. **Unit-level owner calls arrived late.** Two of the four owner calls weren't about any one card. The 0-1 goal oversold what the unit tested, and the five `choice` tasks' «Wähle alle Antworten, die zutreffen.» didn't fit their now single-answer questions. Both surfaced only as asides, the instruction one in a single pass on a single unit. The rework also drifted toward single-answer questions: 1-3 lost its only multi-answer one.
   **Change:** `/card-review`'s unit check now covers the goal against what is left, each task's `instructions` against its questions, and the question mix, and reports a mismatch as a unit-level OWNER finding.
4. **The working tree and the staleness check were improvised.** The scout copied an older hand pull because the anon key wasn't in its worktree. The ship task ran its own anon pull to compare versions before publishing, and its post-publish read-back was blocked. `/ingest`'s scratch-tree section still described `scratch.local/<book-id>/` and a pull "only if the tree is lost". Plan 0028 §5 and `supabase/README.md` had moved to `scripts/content-checkout.sh` on 2026-09-18, and the Book has been listed since 2026-09-11, so in-app edits can land at any time.
   **Change:** the scratch-tree section now works in `content.local/<book>/` through `content-checkout.sh`. It runs at the start of each run, again right before the publish as the staleness check (no upstream changes, or stop), and once after it as the read-back. All three runs use the anon key from the main checkout's `apps/web/.env.local`. No new tooling: the script already prints what moved upstream.
5. **The service key was searched for.** The ship brief said the key was "in the .env files". The worker searched, was stopped by the permission check, and the owner placed the key by hand. `/ingest` step 7 already said the key lives with the owner.
   **Change:** step 7 now says not to search for the key. Without it in the environment, the run stops and asks the owner to run the command or to provide the key.
6. **The browser pass didn't run in the scout.** Its brief named `chrome-devtools-axi`, which isn't installed. The repo's recipe (`apps/web:verify`) uses Playwright, a root dev dependency. A headless engine run stood in for it, and the owner did the pass by hand before the publish.
   **Change:** step 6.4 now names Playwright. It also says that a headless run doesn't replace the browser pass: when no browser can run, the pass goes to the owner with the `.bbbook` before step 7.
7. **The skills assumed the rework and the one Book.** The Lehrplan path pointed into a `scratch.local/` that only the main checkout has, nothing said what a new Book needs before its first unit, and nothing covered a rework's id and history rule.
   **Change:** the paths now say where the owner's copies live. The section says that a new Book needs its own plan with the three things plan 0028 provides, and it has one bullet on reworking shipped units.

## Not changed

- **Owner calls stay with the owner.** That the scout's four calls needed a second task is the design: content-practices §8, "facts stay with people".
- **The captain-hold gate failed because `tasks-axi` was missing.** That is orchestrator tooling, not the repo's.
- **The six smaller owner notes** from the scout report are out of scope here and remain open with the owner.

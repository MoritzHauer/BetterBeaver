---
name: verify
description: Build/launch/drive recipe for verifying apps/web changes end-to-end in a real browser.
---

# Verify apps/web

Launch: `corepack pnpm dev --host 127.0.0.1 --port 5199` from the repo root
(Vite, ready in <1s; `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5199/`).

Drive: `playwright` is a root dev dependency (`corepack pnpm exec playwright
install chromium` once per machine). Throwaway scripts go in `scratch.local/`,
which is git-, prettier- and eslint-ignored:

```js
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
```

Use `chromium.launchPersistentContext("scratch.local/profile", …)` when a
check needs state — My Books, drafts, progress — to survive across runs.

To drive the **authoring** half you need a signed-in account. Magic-link
sign-in is scriptable without an inbox: `node scripts/test-session.ts` prints
a one-shot link that lands you in the app as a throwaway author, and an
access token for curling the RPCs. Full recipe in `supabase/README.md`.
Publishing writes to the real backend — that Book is production content.

Flows worth driving: topic list → topic → unit → task session (all question
kinds render under `SessionScreen`; detect the kind from the DOM:
`.matching-board`, `form input[type=text]`, `.token-row`, `Show answer/
transcript` button, else `ul.card-list` MCQ). Review lives on the topic
screen.

Gotchas:

- Progress is `localStorage` (`bb.item.<id>` SM-2 state, `bb.attempted`).
  Clear it for a fresh run. SM-2 is day-granular: any grade schedules due
  for tomorrow, so Review shows "Nothing due" right after practicing — to
  drive Review, backdate every `bb.item.*` `due` to yesterday and reload.
- SVG images are bundled as `data:` URIs (can't `request.get` them; check
  `img.naturalWidth` instead). Audio wavs are real URLs — fetch to assert 200.
- Demo topic answers: cloze blanks are "I" / "like" from "I like tea.";
  dictation target "I like tea."; scramble target "The cat sleeps quietly.";
  matching pairs can be brute-forced (wrong pairs just don't clear).
- Session UI (plan 0003): every post-answer flow goes through the fixed
  bottom action bar — wait for `.action-bar.correct|.incorrect`, then click
  "Continue"; typed/scramble submit is the "Check" button in the bar; the
  summary screen is `text=Session complete!` with `.stat-tile`s and a "Done"
  button. Streak is `localStorage` `bb.streak`
  (`{lastActiveDay: "YYYY-MM-DD" local, length}`); flame shows in the topic
  `.streak` header and a summary tile.

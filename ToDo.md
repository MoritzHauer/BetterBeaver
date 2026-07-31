## ToDo's

- [x] add offline mode in settings. No update, no connection to the db. — landed
      2026-07-26: Settings → "Offline mode / Never go online", enforced at the two
      chokepoints every request goes through (`getSupabase()` returns null,
      `fetchRest()` throws), so the Library, content editing, feedback and chat
      hide themselves. Not covered: the service worker's own app-shell refresh
      (`registerType: "autoUpdate"`), which would need `prompt` registration.
- First chapter with more info / comparison to english
- short history facts within or between chapters
- [x] as non maintainer amendment proposal — landed 2026-07-26 via
      docs/specs/0012-proposal-flow.md. Still needs a two-account browser pass
      (spec's Verification section).

- Matching task: should there be a max error click?

# small changes

- [x] remove feedback on Concepts Tabel — the table is Term/Definition only now;
      the unit-level widget on Overview still takes reports.
- [x] after adding, removing or archiving a book the my Books Screen should show
      not the starting page. — all five self-triggered reloads (add / remove /
      archive / restore / accept-update) now set a session flag that skips the
      welcome cover. A genuine fresh launch, and "erase all my data", still show it.
- [x] The Vocabulary and Repeat Button on My Books site is still to low and not
      aligned with the header. — they were inheriting `.card > div`'s 1rem inset,
      which pushed them a full chip height below the title and onto the
      description text. Title row and chip row now share one height, so their
      centres line up by construction (verified in-browser: 0.0px off).

# bugs

- [x] check the back button. It sometimes sends you to a blank screen, then you
      have to restart the app — reproduced: pressing back on the welcome cover
      consumed the single history "trap" entry without refilling it, so the next
      back from inside the app walked off the app's own history entry to
      `about:blank`. The trap now re-arms on any screen that has a back action.
      Regression test: `apps/web/src/App.back-nav.test.tsx`.

# icons to be generated

## ideas

- language material recommendation / skill
- improve editor flow
- configurable learning setting
  - how many tasks get into the repeat section from prev units?
  - how many tasks getting as default in a unit
  - maybe just get into next unit if last 10 task hit 75% accurancy?
  - think of other ideas
- make learning methods with more algo logic, eg how many tasks, num repetitions, what to review.
- matching task: differentiate between fixed set of items for one question and pool for multiple ones.
- TTS — Kyrgyz voice doesn't work (no matching local browser voice); real fix is a bigger session, deliberately not covered now.

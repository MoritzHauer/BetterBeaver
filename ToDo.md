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
- [ ] the android back button returns to an empty page — **attempt 6: the app
      has URLs now.** Every screen is a fragment route (`#/books/demo`), and
      navigation is a fragment navigation the browser performs rather than a
      `pushState` entry the app fabricates — which is the exact thing the
      back-trapping intervention skips. Deep links and reload-keeps-your-place
      come along with it. Chromium-verified only; the diary decides on the
      device. **History (attempt 5):** The diary after attempt 4 shows
      the boot hang fixed but _still_ no `back` line in ~30 launches, so a
      press has never reached the page as a `popstate` under any trap-based
      build. `history-nav.ts` now puts the view in `history.state`, one entry
      per screen pushed under user activation, and back is an ordinary
      traversal. Working theory for the trap's invisibility is Chrome's
      history-manipulation intervention (skippable entries); **unproven** — no
      desktop Chromium here reproduces it. If the phone still shows no `back`
      lines, it is not page-level: next step is `chrome://inspect` over USB.
      **History (attempt 4):** The diary from attempt 3
      showed 13 boots and zero back presses: `popstate` never fired, so no
      version of the trap ever mattered. `openContentDb` had no `onblocked`
      handler, so a blocked open hung forever; the boot awaited it before
      rendering anything (black screen), and the trap was armed by an effect
      that never ran because of that same hang — so back exited the app and
      the relaunch hung again. Fixed: trap armed at module load, IDB rejects
      on blocked/timeout, a boot splash from the first frame. Reproduced and
      proven in a browser with a stubbed hanging open. **History (attempts
      1–3):** Attempt 2 (2026-08-21) held the trap at the
      root only in standalone display mode; the owner then reported back going
      black from _every_ screen, cover included, on the 0.1.0 build. At the
      cover the handler runs no React code, so only the document going away
      explains it — the pop escaped despite the standalone gate. Attempt 3
      drops the gate entirely (two trap entries, every screen, every display
      mode, no pop released) and adds the instrumentation the first two lacked:
      an error boundary, a boot-failure screen, and an on-device nav diary
      under About → Diagnostics. **Leave this open until the phone confirms
      it** — and if it is still black, the diary says which of the three it is.
- [x] add a link to the GitHub repo — About screen and the Settings → About
      card.
- [x] info / about button including the app version — `AboutScreen`, reached
      from the footer links row (cover + home) and from Settings. Shows version
      and the deployed commit.
- [x] versioning scheme — `0.MINOR.PATCH` (major feature / plan-or-iteration),
      starting at 0.1.0; `apps/web/package.json` is the source of truth. See
      `docs/design.md`, "Versioning".
- [x] README should link betterbeaver.de — done, plus a Releases section.

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

## isues

- workflow create issue, /prototyping, voting in git issue about prototype screenshots, implementation
- multiple maintainers per book
- editor flow on device
  - when entering the editor mode you stay just on that page but can edit the text fields. Get Buttons for Adding new elements (table/boxes/etc/image). You can configure text style and link words to the lexicon. The user does not have to see any uuids or other windows.
  - The local changes can be displayed before proposing / publishing. In this preview window you can toggle between old/new/diff. On diff view the old changed/deleted elements have a light red background and the new changed/added values have a light green background.
- editor flow via AI

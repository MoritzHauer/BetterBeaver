## ToDo's

- [x] on downloaded android app, deactivate refresh via scroll down (`overscroll-behavior-y: contain` in styles.css). Update button on the start screen already existed (the opt-in update banner, only shows when `checkForUpdate` finds something). Added an "Auto-update on startup" toggle in Settings.
- add offline mode in settings. No update, no connection to the db.
- [x] chat deactivated (not removed) — `CHAT_ENABLED = false` in BookScreen.tsx, code kept as-is for later.
- TTS — Kyrgyz voice doesn't work (no matching local browser voice); real fix is a bigger session, deliberately not covered now.
- First chapter with more info / comparison to english
- references between chapters and do you remember quiz
- short history facts within or between chapters
- [~] as non maintainer amendment proposal — implementing now via docs/specs/0012-proposal-flow.md (already fully designed, spec pre-approved)
- creating private book
  - no syncing but ex/import possible

- append enhance icons list for generation

# icons to be generated

🎯 target
🔊 speaker
Mute
lok closed
lok open
Accept (hook)
Deny (X)

## ideas

- language material recommendation / skill
- Tasks are still grouped by type in a unit. Why?

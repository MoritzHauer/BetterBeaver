# Status

One line per plan, plus what deliberately doesn't exist yet. Update when a plan lands or a gap gets a plan. Architecture details: [architecture.md](architecture.md).

## Plans

| Plan                                                                                | Status                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001 Content schema & Kyrgyz slice](plans/0001-content-schema-and-kyrgyz-slice.md) | implemented 2026-07-12 (steps 1–9 incl. PWA)                                                                                                                                          |
| [0002 Exercise-type showcase](plans/0002-exercise-type-showcase.md)                 | implemented 2026-07-09 (steps 1–5, browser-verified)                                                                                                                                  |
| [0003 UI polish](plans/0003-ui-polish.md)                                           | implemented 2026-07-14                                                                                                                                                                |
| [0004 Vocabulary mode](plans/0004-vocabulary-mode.md)                               | implemented 2026-07-15                                                                                                                                                                |
| [0005 Sentence building](plans/0005-sentence-building.md)                           | implemented 2026-07-15                                                                                                                                                                |
| [0006 Domain lexicon](plans/0006-domain-lexicon.md)                                 | implemented 2026-07-15 (steps 1–5 + final verification, browser-verified) — central per-domain vocabulary, tap-to-lookup, own words, links/families, per-domain review, export/import |

## Works today

Offline-first PWA; bundled content (Kyrgyz + demo topics) validated at startup; SM-2 review queue, streak, unit unlock; 10+ task types incl. sentence building; per-domain vocabulary screen with learner lists, shipped word families, ad-hoc study, TTS read-aloud; tap-to-lookup on post-answer session surfaces, vocabulary rows, and note views (best-effort resolve with add-word fallback); learner-created lexicon entries; per-domain review queue built from scheduling units (cloze blanks reviewed individually) and streak; JSON export/import backup. All learner state persists in `localStorage`.

## Not yet built

- **User settings** — no settings screen, no persisted preferences.
- **Remote/selective content download** — all content is build-time bundled (fine at current ~500 KB); the `ContentSource` seam is where a remote source plugs in (`/ingest`, milestone 2 — will emit plan-0006 lexicon entries).
- **Play Store packaging** — PWA installs from the browser; TWA/Bubblewrap when a store listing is wanted.
- **Kyrgyz sentence-building/cloze content** — the Kyrgyz topic only has `recall`/`recognize` tasks; plan 0005's sentence-building and plan 0006's cloze-blank review were browser-verified against the demo domain's content instead. Authoring real Kyrgyz sentence/cloze content is open.

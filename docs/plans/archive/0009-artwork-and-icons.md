# Plan 0009: Artwork and icons

Status: **implemented** (2026-07-17, steps 1–6) · Owner: Moe · Date: 2026-07-17 · Style reference: `docs/plans/assets/0009-style-reference.png`

## Purpose

Give the app a real visual identity: a beaver mascot, an app-icon set, start-screen artwork, and UI icons — replacing the placeholder "B" favicon and the unicode glyphs used today. Mobile appearance is the priority; tablet/desktop are covered by using vector or high-resolution assets that scale, not by separate art.

## Style (locked by the reference image)

- Flat vector illustration, no gradients or outlines, soft rounded shapes.
- Palette: warm cream background `#FBF3E7`, mascot orange `#F0862A`, dark brown `#6B4226`, muted cheek pink `#F2A9A0`, text charcoal `#4A4A55`. Exact hexes get re-sampled from the winning candidate in step 1 and recorded here.
- Mascot: round-bodied beaver, orange body, brown ears/tail, two front teeth, small paws, blush cheeks. Front-facing, friendly, minimal detail.

## Division of labor

- **Generated (image model, run by Moe):** mascot poses, start-screen illustration, app-icon artwork. Claude Code cannot generate raster art; this plan supplies paste-ready prompts and Moe runs them in an image generator of choice, attaching results back into the session.
- **Hand-authored (Claude, SVG in-repo):** all functional UI icons (speaker, check, close, back, plus, flame). These must be single-color, crisp at 16–24 px, and themeable via CSS — generated raster art is the wrong tool for them.

## Process

### Step 1 — three start-screen candidates (user decision gate)

Generate one image per prompt below (portrait, ≥1024×1536, or the generator's closest). All three keep the reference style; each varies one thing so the choice is meaningful. Shared prompt base:

> Flat vector illustration for a mobile language-learning app start screen. Warm cream background (#FBF3E7). A cute round beaver mascot: orange body, dark brown ears and flat tail, two white front teeth, small blush cheeks, tiny paws. Minimal detail, no outlines, no gradients, soft shapes, generous whitespace. Centered composition, room below the mascot for a title and a button. No text in the image.

- **A — classic:** base prompt as-is; mascot sitting front-facing (closest to the reference).
- **B — waving:** base + "the beaver waves with one paw raised, slight head tilt, cheerful".
- **C — with prop:** base + "the beaver holds a small log like a book, as if reading it; a few tiny floating leaves around it".

Moe picks one (or asks for a revision round). The winner defines the canonical mascot; its image is saved as `docs/plans/assets/0009-mascot-canonical.png` and referenced in every later prompt ("same character and style as the attached image") to keep the set consistent.

### Step 2 — generate the remaining artwork (from the winner)

All prompts reuse the canonical image as a style/character reference. Deliverables, each ≥1024×1024, transparent background where noted:

| Asset | Prompt addition | Used for |
|---|---|---|
| Mascot head, tight crop | "head and shoulders only, centered, transparent background" | app icon / favicon |
| Mascot full body, transparent | "full body, transparent background" | start screen, headers |
| Sad/confused pose | "looking sad and apologetic, droopy ears, transparent background" | `ErrorScreen` |
| Celebrating pose | "jumping with joy, confetti shapes, transparent background" | session-complete state |

That's the whole set. More poses (sleeping/streak-lost, thinking, etc.) only when a screen actually needs them.

### Step 3 — app-icon set (raster pipeline)

From the head-crop artwork, produce with ImageMagick (already-installed tooling; no build-time icon plugin):

- `favicon.svg` — replace the "B" placeholder: rounded-rect `#F0862A` background + embedded head PNG, or a simplified hand-traced SVG head if the embed looks muddy at 16 px.
- `pwa-192x192.png`, `pwa-512x512.png` — head on cream background, full bleed.
- `pwa-512x512-maskable.png` — same but head scaled to the central 80% safe zone (maskable spec) so Android shapes don't crop the ears.
- `apple-touch-icon.png` — 180×180, cream background, no transparency (iOS composites black otherwise).

Same filenames as today → no manifest or HTML changes needed.

### Step 4 — UI icon set (hand-authored SVG)

One file `apps/web/src/components/icons.tsx`: small React components, 24×24 viewBox, `fill="currentColor"`, rounded caps/joins to match the mascot's softness. Set:

- speaker (audio playback in Vocabulary/Unit screens)
- check (done badge), close ×, back arrow, plus (add word), flame (streak)

Replace the current unicode glyphs (`&#10003;`, `×`, etc.) where they appear. No icon font, no dependency.

### Step 5 — wire artwork into the app

- Put exported art in `apps/web/public/art/` as PNG at 2× display size (e.g. mascot rendered ~200 px → ship 400 px). That is sharp on 3× phones at these sizes and scales down fine for tablet/desktop, where layout centers with a max-width — no per-breakpoint assets.
- Start screen: the app currently boots into the topic list; add a minimal welcome screen (mascot, title, tagline, "Get Started" button) shown only until first tap, per the reference composition. If Moe prefers no gate screen, the same art goes atop `TopicListScreen` instead — decide at review.
- Error screen: sad mascot above the existing message.

### Step 6 — verify

`corepack pnpm check`, then load the app on a phone-sized viewport: favicon, installed-PWA icon (maskable preview via DevTools), start screen, error screen, and each replaced glyph.

## Non-goals

- No per-domain topic illustrations, no achievement/badge art set, no animated mascot (Lottie/rive) — add when a feature calls for it.
- No dark theme variants — the app has one theme today.
- No design-token system — the five palette hexes go into `styles.css` as CSS variables, nothing more.

## Open questions

- Which image generator Moe uses (affects character-consistency workflow: reference-image support vs. seed reuse). Doesn't block step 1 — the prompts are tool-agnostic.

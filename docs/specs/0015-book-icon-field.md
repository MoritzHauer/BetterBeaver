# Spec 0015-2: Book `icon` field

Normative source: [plan 0015](../plans/0015-library-marketplace.md) decisions 6/6a. Requires spec 0015-1 (rename) landed — this spec uses post-rename identifiers.

## Changes

### `packages/schema`

- `entities.ts`: add to `bookSchema` (né `topicSchema`):
  ```ts
  export const BOOK_ICONS = ["📚", "🦫", "🌍", "🗣️", "💬", "🔤", "🧪", "🧬", "🔬", "🧮", "📐", "💻", "🎵", "🎨", "🏛️", "🌱", "🍄", "⚖️", "🚀", "🌤️", "🐾", "❤️", "🥘", "🚌"] as const;
  // on bookSchema:
  icon: z.enum(BOOK_ICONS).optional(),
  ```
  The exact emoji list above is normative (owner-approved set covering languages + general subjects); keep the `as const` + `z.enum` shape so the editor picker derives from one source. Optional — absent means "no icon", no default.
- `documents.ts`: update the `CONTENT_SCHEMA_VERSION` bump-rule comment (~lines 13–19) to record the plan 0015 §6a exemption: additive _optional_ entity fields that non-strict parsing safely ignores do **not** bump. **Do not bump the version for this change.**
- No new validator rule needed — the zod enum is the whole rule.

### `apps/web` (editor only — learner-card rendering is spec 0015-5)

- The book root editor form (where the book's `title`/`description` are edited, inside the `EditScreen` editor tree): add an icon picker — a native `<select>` whose options are "(none)" plus each `BOOK_ICONS` emoji, following the form's existing field idiom (label + control + autosave wiring identical to the sibling text fields). Clearing back to "(none)" removes the field from the draft (absent, not `""`).

## Done criteria

1. `corepack pnpm check` green.
2. A schema unit test (colocated with existing entity/validator tests) asserting: a book document with a valid `icon` parses; an unknown emoji fails; an absent `icon` parses.
3. Editor: picker renders, autosaves into the draft like sibling fields (no browser round-trip required in this spec; chunk 5's verification covers UI end-to-end).

## Out of scope

Rendering the icon on Library/My Books cards (spec 0015-5), any `CONTENT_SCHEMA_VERSION` bump, republishing content. No design decisions are open.

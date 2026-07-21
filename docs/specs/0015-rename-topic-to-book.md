# Spec 0015-1: Rename `Topic*` → `Book*` (identifiers + UI copy)

Normative source: [plan 0015](../plans/0015-library-marketplace.md) decisions 13–14. Mechanical rename, **zero behavior change**. Lands before every other 0015 chunk.

## Scope

All of `packages/schema`, `packages/srs`, `packages/engine`, `apps/web`, `scripts`.

### Rename (TypeScript identifiers, file names, UI copy)

- Types: `Topic` → `Book`, `TopicDocument` → `BookDocument`, `TopicDocumentNote` → `BookDocumentNote`, `TopicSummary` → `BookSummary`, `TopicCollection` → `BookCollection`, and any other `Topic*`/`*Topic*` type.
- Functions/values: `loadTopic` → `loadBook`, `listTopics` → `listBooks`, `writeTopicDocument` → `writeBookDocument`, `bundledTopicDocuments` → `bundledBookDocuments`, `bundledTopicDomainIds` → `bundledBookDomainIds`, `topicSchema` → `bookSchema`, and every other function/const/variable/parameter with `topic` in the name (`topicId` → `bookId`, `domainTopicIds` → `domainBookIds`, `setTopics` → `setBooks`, `anyTopicContent` → `anyBookContent`, …). Local variables included — the rename is full, not exported-only.
- Screens/files: `TopicScreen.tsx` → `BookScreen.tsx` (component `TopicScreen` → `BookScreen`), `TopicListScreen.tsx` → `MyBooksScreen.tsx` (component → `MyBooksScreen`) — **file/identifier rename only; its behavior/UI stays the show-everything list for now** (chunk 5 reworks it). Rename any `TopicEditor`-style editor components to `BookEditor` etc. Update imports, lazy-route names, and any screen-name string unions accordingly.
- Learner- and author-facing UI copy: "topic"/"Topics" → "Book"/"Books" wherever it names the studiable course (screen titles, buttons, aria-labels, error messages, settings copy). German/other-language copy does not exist; English only.
- `SettingsScreen` maintainer export/import section (~line 258–290): split the umbrella "Books" copy so document export/import distinguishes **"Books"** (topic documents) from **"Domains"** (domain documents) explicitly — two labeled subsections or clearly split labels/filenames. Keep the exported JSON file _content_ byte-compatible (see invariants); only human-facing labels/headings/filenames may change.

### DO NOT touch (wire-format string literals — the app must read yesterday's caches and backend rows unchanged)

- JSON/document field names: `doc.topic`, `topic:` inside `TopicDocument`'s shape (`interface BookDocument { topic: Book; … }` is the correct end state), zod object _keys_, `validateContent` input keys.
- `kind: "topic"` values anywhere (catalog rows, cached documents, export files, `content_kind` strings).
- `topic:<id>` / `domain:<id>` document-id prefixes and `contentIdOf` semantics.
- IndexedDB database/store names, `localStorage` keys (`bb.*`).
- PostgREST paths/queries (`published->topic->>…` etc.), Supabase table/view/RPC names.
- `content/` directory layout and JSON file contents (including `topic.json` filenames and their contents).
- CSS class names may stay as-is (not learner-visible); renaming them is optional and not required.

A find in the final diff for `"topic"`/`'topic'`/`` `topic`` string literals must show them all surviving in wire-format positions.

## Done criteria

1. `corepack pnpm check` green (format + lint + typecheck + tests). Test names/fixtures rename with the code; fixture _data_ (JSON documents) does not.
2. `grep -rn "Topic" packages apps/web/src scripts --include="*.ts" --include="*.tsx"` shows **no remaining `Topic` identifier** except inside wire-format string literals, comments explaining the wire format, and doc references. Comments referring to the concept rename to Book.
3. `grep -rn '"topic"\|topic:' …` confirms wire literals intact: `kind === "topic"` comparisons, `topic:` prefixes, `.topic` property accesses on documents still present.
4. No behavior change: no logic, markup structure, or styling edits beyond copy strings. The app boots and behaves identically (a smoke `pnpm dev` boot check is enough here; full browser verification happens with chunk 5).

## Out of scope

Everything else in plan 0015 (icon field, Library screen, fetch-on-add, seed shrink). No design decisions are open; if something seems ambiguous, the wire-format DO-NOT-TOUCH list wins over rename completeness.

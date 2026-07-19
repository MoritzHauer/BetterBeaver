# Spec: Asset pipeline (Supabase Storage)

Implements the plan 0012 §2 deferral: assets leave the frozen bundled state so editing can add audio/images. Self-contained per the `/delegate` convention; make no new design choices.

## Goal

Maintainers upload audio/image assets for their documents in the editor; published content may reference them; learners receive them with the same offline and all-or-nothing guarantees as documents. Bundled assets keep working unchanged (they remain the seed's assets).

## Context (read first)

- `docs/plans/0012-content-backend-and-editing.md` §2 (assets frozen), §6 (update flow).
- `apps/web/src/content/bundled.ts` (`bundledAssetStems`, `getAssetUrl`/`getLexiconAssetUrl` — the resolution points), `apps/web/src/content/source.ts` + `cache.ts` (update accept path), `packages/engine/src/documentSource.ts` (`AssetStems` feeds validation), `apps/web/src/backend/publishCheck.ts`.
- Validator rules consuming stems: `packages/schema/src/validate.ts` (`TASK_REQUIRED_ASSET`, audio/image ref checks).

## Pinned design

### Storage layout and policies

- One public-read bucket **`assets`**. Object path: `topic/<contentId>/audio/<stem>.<ext>` and `topic/<contentId>/img/<stem>.<ext>`; `domain/<contentId>/…` likewise. (Path uses `/` instead of the row id's `:` — storage keys with colons are avoided; the mapping is `<kind>/<contentId> ↔ documentId(kind, contentId)`.)
- New migration `supabase/migrations/<date>_assets.sql`: create the bucket (public); RLS on `storage.objects` for bucket `assets`: `insert`/`update`/`delete` for authenticated where `public.is_maintainer((storage.foldername(name))[1] || ':' || (storage.foldername(name))[2])`; public read comes from the bucket being public. File size cap 10 MB, allowed MIME prefixes `audio/` and `image/` (bucket-level `file_size_limit` / `allowed_mime_types`).
- Never modify the already-applied migration file; new migrations only.

### Stems: where validation gets its inventory

- `AssetStems` for any validation involving remote content = **bundled stems ∪ storage listing**. The storage listing for a document is fetched by listing `assets/<kind>/<contentId>/audio` and `/img` (Supabase Storage `list` endpoint works with the anon key on a public bucket).
- **Publish path** (`validateForPublish`): fetch listings for every document in the assembled set (authors are online by definition; on listing failure, fail validation with a clear message rather than publishing blind).
- **Learner accept path** (`source.ts acceptUpdate`): same union, fetched during accept (accepting an update already requires network). The offline invariant covers serving, never accepting.
- **Startup/cache path** (`initContentSource`): must not touch the network. The cache record therefore stores each document's asset manifest (below); startup validates against bundled ∪ cached-manifest stems.

### Learner delivery: cached, all-or-nothing

- Extend `CachedDocument` (`apps/web/src/content/cache.ts`) with `assets: { kind: "audio" | "img"; stem: string; path: string }[]` — the document's storage listing at accept time. Existing caches without the field mean "no remote assets" (back-compatible; no cache-version bump).
- During `acceptUpdate`, after document validation succeeds: download every asset of every changed document (public URL fetch) and put the responses into a Cache API cache **`bb-remote-assets`** keyed by the public URL. Any asset download failure fails the whole accept (all-or-nothing, same as documents), cache untouched.
- Prune: after a successful accept, delete `bb-remote-assets` entries whose URL belongs to no current document manifest.
- **Resolution order** in `getAssetUrl`/`getLexiconAssetUrl`: remote manifest of the active content set first (public URL — served from the Cache API via a fetch handler or by checking `caches.match` in an async resolution path), then bundled URL, then `undefined`. Note: today's resolution is synchronous; making it async ripples into every call site — do the mechanical ripple, do not introduce a sync cache mirror.

### Editor upload UI

- In `EditScreen` (maintain mode only), a per-document **Assets** section: list current storage objects (stem, kind, size), upload control (file input; stem = slugified filename base; reject non-slug stems and non-audio/image MIME client-side for a clear message — the bucket rules are the real enforcement), delete button per asset with confirm.
- Deleting an asset that content still references is allowed (storage and drafts are independent); the dangling ref then fails the next publish validation with the existing human-readable rule message. State this in the UI copy on delete.
- Upload/delete go through `backend/supabase.ts` helpers using the authenticated client (`supabase.storage.from("assets")`).

### Task types unblocked

This spec only delivers the pipeline. The task-type editors that need it (listen/dictation/shadowing/minimal-pair/picture) are in `0012-editor-long-tail.md` and depend on this spec landing first.

### Out of scope

Asset versioning/history (storage is live-mutable; version history covers documents only — accepted), image resizing/transcoding, seed re-export of remote assets (`scripts/export-content.ts` keeps exporting documents only; remote assets are not part of the git seed — a fresh offline install lacks them until first sync, accepted and documented in STATUS).

## Verification

- Maintainer uploads an audio file, references it from a new `listen`-capable item/task, publish validates and succeeds; learner accepts the update, then in **airplane mode** plays that audio (Cache API hit).
- Accept with one asset URL made unreachable (delete the object between check and accept) → whole update rejected, old content + assets intact.
- Non-maintainer upload to another doc's path → storage RLS rejects (browser console check).
- Oversized (>10 MB) and wrong-MIME uploads rejected.
- Bundled assets still play/display for the seed content with an empty storage bucket.
- `corepack pnpm check` green.

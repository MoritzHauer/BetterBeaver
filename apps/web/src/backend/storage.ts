import { contentIdOf } from "@betterbeaver/schema";
import type { AssetStems } from "@betterbeaver/engine";
import { getSupabase } from "./supabase";

/**
 * Storage listing, public URLs, and the object-key parse (spec 0012-B).
 * Object key layout: `<kind>/<contentId>/audio/<objectName>` and
 * `<kind>/<contentId>/img/<objectName>`, where `<kind>` is `topic` or
 * `domain` — the same values `CachedDocument.kind` uses, and the row id's
 * `<kind>:<contentId>` with `/` in place of `:`.
 */

export interface RemoteAsset {
  stem: string;
  name: string;
  kind: "audio" | "img";
  path: string; // full object key
  url: string; // public URL
  size: number | undefined;
  lastModified: string | undefined;
}

/** A file's basename without its extension — used only when an object name
 * carries no `__`-separated display name (see `parseObjectName`). */
function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/**
 * Splits an object name into its stem (what content references) and its
 * display name (shown in the UI). Exactly the parse spec 0012-B §2 pins —
 * nothing inferred from the display name's shape, because it is
 * unconstrained. Safe because `slugPattern` forbids underscores, so the
 * stem side of a real object name never contains one.
 */
export function parseObjectName(objectName: string): {
  stem: string;
  name: string;
} {
  const i = objectName.indexOf("__");
  const stem = i === -1 ? stripExtension(objectName) : objectName.slice(0, i);
  const name = i === -1 ? objectName : objectName.slice(i + 2);
  return { stem, name };
}

/** `<kind>:<contentId>` (a `CachedDocument.id`) -> `<kind>/<contentId>`, the
 * object-key prefix (spec 0012-B §2). The row id has exactly one `:`. */
function objectPrefix(documentId: string): string {
  return documentId.replace(":", "/");
}

/**
 * Buckets an object by its MIME type: `"img"` for `image/*`, `"audio"` for
 * everything else, including an empty/unknown MIME (spec 0012-C §1). This is
 * the sole writer of an object's folder, which is load-bearing rather than
 * cosmetic: `assetStemsFromListing` above buckets a *listed* asset by the
 * folder it was found in, while `remote-assets.ts`'s runtime overlay buckets
 * by `blob.type`. The two bucketings only ever agree because every object
 * this function names lands in the folder its own MIME type says it should.
 */
export function assetFolder(mimeType: string): "audio" | "img" {
  return mimeType.startsWith("image/") ? "img" : "audio";
}

/**
 * Sanitises `fileName` to `[A-Za-z0-9._-]` (every other character becomes
 * `-`) and appends it to `stem` behind a `__` separator — the exact inverse
 * of `parseObjectName` above; the two must round-trip. An empty `fileName`
 * sanitises to nothing, so the key is `stem` alone with no trailing `__`,
 * which `parseObjectName`'s no-`__` branch already reads back as both stem
 * and name.
 */
export function buildObjectName(stem: string, fileName: string): string {
  const sanitised = fileName.replace(/[^A-Za-z0-9._-]/g, "-");
  return sanitised === "" ? stem : `${stem}__${sanitised}`;
}

/**
 * Uploads a file to `<kind>/<contentId>/<folder>/<objectName>` using the
 * authenticated client (spec 0012-C §1), then returns the `RemoteAsset` for
 * it. The stem is generated, never derived from the filename — the same
 * `` `${bookCode}-${crypto.randomUUID()}` `` rule `AssetsManager.tsx:149`
 * already uses for private Books, collision-proof and always a valid
 * `slugPattern` slug. Rejects a non-`audio/`/`image/` MIME type client-side
 * for a clear message; the bucket's RLS/`allowed_mime_types` is the real
 * enforcement.
 */
export async function uploadAsset(
  documentId: string,
  bookCode: string,
  file: File,
): Promise<RemoteAsset> {
  if (!file.type.startsWith("audio/") && !file.type.startsWith("image/")) {
    throw new Error(`unsupported file type: ${file.type || "(none)"}`);
  }
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const folder = assetFolder(file.type);
  const stem = `${bookCode}-${crypto.randomUUID()}`;
  const objectName = buildObjectName(stem, file.name);
  const path = `${objectPrefix(documentId)}/${folder}/${objectName}`;
  const { error } = await supabase.storage.from("assets").upload(path, file);
  if (error) {
    throw new Error(error.message);
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from("assets").getPublicUrl(path);
  // `name` is re-derived via `parseObjectName` rather than reused from
  // `file.name` directly, so a freshly-uploaded asset reports exactly what a
  // subsequent listing would (e.g. the sanitised-to-nothing fallback).
  const { name } = parseObjectName(objectName);
  return {
    stem,
    name,
    kind: folder,
    path,
    url: publicUrl,
    size: file.size,
    lastModified: new Date(file.lastModified).toISOString(),
  };
}

/** Removes one object by its full path (spec 0012-C §1). */
export async function deleteAsset(path: string): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.storage.from("assets").remove([path]);
  if (error) {
    throw new Error(error.message);
  }
}

/** Lists both the audio/ and img/ folders for one document (by its
 * `<kind>:<contentId>` id). Throws on failure — callers decide. */
export async function listDocumentAssets(
  documentId: string,
): Promise<RemoteAsset[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const prefix = objectPrefix(documentId);
  const assets: RemoteAsset[] = [];
  for (const kind of ["audio", "img"] as const) {
    const { data, error } = await supabase.storage
      .from("assets")
      .list(`${prefix}/${kind}`);
    if (error) {
      throw new Error(error.message);
    }
    for (const entry of data) {
      if (entry.id === null) {
        continue; // a folder placeholder, not a file
      }
      const path = `${prefix}/${kind}/${entry.name}`;
      const { stem, name } = parseObjectName(entry.name);
      const {
        data: { publicUrl },
      } = supabase.storage.from("assets").getPublicUrl(path);
      assets.push({
        stem,
        name,
        kind,
        path,
        url: publicUrl,
        size: entry.metadata?.size,
        // `FileObject` (the `list()` v1 shape) carries no `last_modified`
        // field of its own — only `metadata.lastModified` and the
        // top-level `updated_at` — so try both, per §2's "whichever the
        // response actually provides".
        lastModified:
          entry.metadata?.lastModified ?? entry.updated_at ?? undefined,
      });
    }
  }
  return assets;
}

/** Downloads one asset's bytes, wrapped in a `File` carrying the listing's
 * `lastModified` (when known) so `canReuseBlob` can compare against it on a
 * later accept — a plain `Blob` has no `lastModified` of its own, and
 * `CachedDocument.assets` stores exactly `Record<string, Blob>` with no
 * side channel for it (spec 0012-B §4). Falls back to a plain `Blob` when
 * the listing didn't report a usable `lastModified`, so the next accept
 * simply re-downloads it — the same fail-towards-re-downloading rule. */
export async function downloadRemoteAsset(asset: RemoteAsset): Promise<Blob> {
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`asset download failed: ${response.status}`);
  }
  const raw = await response.blob();
  if (asset.lastModified === undefined) {
    return raw;
  }
  const ms = Date.parse(asset.lastModified);
  if (Number.isNaN(ms)) {
    return raw;
  }
  return new File([raw], asset.name, { type: raw.type, lastModified: ms });
}

/**
 * Decides whether a stem's previously-downloaded blob can be reused instead
 * of re-downloading it (spec 0012-B §4). Fails towards re-downloading: an
 * `undefined` size/lastModified on either side never counts as a match — a
 * hollow comparison key would silently serve stale bytes after a maintainer
 * replaces a file with a different one of the same size, which is a
 * wrong-content bug rather than a slow one.
 *
 * `previous.lastModified` is epoch milliseconds (a `File`'s native
 * representation, see `previousAssetMeta`), not the listing's raw ISO
 * string — comparing two independently-formatted ISO strings for the same
 * instant would be a second hollow key (Postgres/Storage don't guarantee
 * one canonical spelling: `+00:00` vs `Z`, second vs microsecond
 * precision), so both sides are normalised to a number before comparing.
 */
export function canReuseBlob(
  listing: { size: number | undefined; lastModified: string | undefined },
  previous:
    { size: number | undefined; lastModified: number | undefined } | undefined,
): boolean {
  if (previous === undefined) {
    return false;
  }
  if (listing.size === undefined || listing.lastModified === undefined) {
    return false;
  }
  if (previous.size === undefined || previous.lastModified === undefined) {
    return false;
  }
  const listingMs = Date.parse(listing.lastModified);
  if (Number.isNaN(listingMs)) {
    return false;
  }
  return listing.size === previous.size && listingMs === previous.lastModified;
}

/** The `{size, lastModified}` pair `canReuseBlob` wants for a previously
 * downloaded blob — `lastModified` only survives on a `File` (see
 * `downloadRemoteAsset`), as its native epoch-milliseconds number, so a
 * plain `Blob` (or no blob at all) reads as `undefined`, which
 * `canReuseBlob` already treats as "download it". */
export function previousAssetMeta(blob: Blob | undefined): {
  size: number | undefined;
  lastModified: number | undefined;
} {
  return {
    size: blob?.size,
    lastModified: blob instanceof File ? blob.lastModified : undefined,
  };
}

/**
 * Buckets a Storage listing into `AssetStems` shape for validation (spec
 * 0012-B §6), keyed by each document's `kind` (a `topic:` doc's stems land
 * in `*ByBook`, a `domain:` doc's in `*ByDomain`) and by the listing's
 * `audio`/`img` folder — not MIME type, because the listing is the source
 * of truth for where an asset lives. This intentionally diverges from the
 * runtime overlay (`remote-assets.ts`), which buckets by `blob.type`
 * because it only ever sees the blob, never the folder it came from.
 */
export function assetStemsFromListing(
  entries: { documentId: string; assets: RemoteAsset[] }[],
): AssetStems {
  const audioByBook = new Map<string, string[]>();
  const imageByBook = new Map<string, string[]>();
  const audioByDomain = new Map<string, string[]>();
  const imageByDomain = new Map<string, string[]>();
  for (const { documentId, assets } of entries) {
    const isTopic = documentId.startsWith("topic:");
    const id = contentIdOf(documentId);
    for (const asset of assets) {
      const target =
        asset.kind === "img"
          ? isTopic
            ? imageByBook
            : imageByDomain
          : isTopic
            ? audioByBook
            : audioByDomain;
      target.set(id, [...(target.get(id) ?? []), asset.stem]);
    }
  }
  return { audioByBook, imageByBook, audioByDomain, imageByDomain };
}

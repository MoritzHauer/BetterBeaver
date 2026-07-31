import { useState } from "react";
import { type BookDocument, type DomainDocument } from "@betterbeaver/schema";
import { type Entity } from "./types";

/** Kind label for display, from the blob's MIME type — same "image vs.
 * audio" split `content/private-assets.ts`'s runtime overlay uses. Exported
 * for `PrivateEditScreen`, which still holds raw blobs and uses this to
 * build each `AssetView.kind`. */
export function assetKind(blob: Blob): "audio" | "image" {
  return blob.type.startsWith("image/") ? "image" : "audio";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ponytail: a flat per-file ceiling, not real IndexedDB quota detection —
// quota isn't reliably queryable across browsers, and a private Book is
// later serialised into one JSON string at export time (plan 0017 §7: "fine
// to roughly 20 MB"), so keeping each asset well under that keeps the export
// small too. Upgrade path if real files need to exceed this: chunked/zip
// export, at which point a dependency is worth it.
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** Item/entry ids (book items and domain entries) whose audioRef/imageRef —
 * including a pair item's nested a/b sides — points at `stem`, so the Assets
 * manager's delete confirm can name what a deletion would break (plan
 * 0017 §4: "the author should hear that before it happens, not after"). */
export function assetReferences(
  book: BookDocument,
  domain: DomainDocument,
  stem: string,
): string[] {
  const refs: string[] = [];
  const check = (entity: Entity) => {
    const payload = entity.payload;
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = payload as Record<string, unknown>;
    if (p.audioRef === stem || p.imageRef === stem) {
      refs.push(entity.id);
      return;
    }
    for (const side of ["a", "b"] as const) {
      const sidePayload = p[side];
      if (
        typeof sidePayload === "object" &&
        sidePayload !== null &&
        (sidePayload as Record<string, unknown>).audioRef === stem
      ) {
        refs.push(entity.id);
        return;
      }
    }
  };
  for (const item of book.items as Entity[]) {
    check(item);
  }
  for (const entry of domain.entries as Entity[]) {
    check(entry);
  }
  return refs;
}

/**
 * One asset as `AssetsManager` renders it — a view model both a private
 * Book (blob-backed, object URLs) and a maintainer document (Storage-backed,
 * public URLs) can build, so this component never forks on which mode it's
 * in (spec 0012-C §2).
 */
export interface AssetView {
  stem: string;
  name: string; // display name; falls back to `stem`
  kind: "audio" | "image";
  size: number;
  // Object URL (private) or public URL (maintain). Private mode may pass
  // `""` for the one render tick before its object URL exists yet (right
  // after mount or after an add) — the card still renders, just without a
  // preview; see `PrivateEditScreen`'s `assetViews`.
  url: string;
}

/** Asset manager for a Book's audio/image assets (plan 0017 §4, widened by
 * spec 0012-C for maintainer documents): list/add/delete assets and show
 * each stem as copyable text. Deliberately NOT a per-field file picker —
 * that would mean changing `EntityForm`/`Field`, which the maintainer and
 * propose paths share, for a feature only this manager needs. The author
 * copies a stem here and pastes it into an item's audioRef/imageRef field by
 * hand; the stems are the contract between this view and the book/domain
 * forms.
 *
 * `onAdd`/`onDelete` own the actual persistence (private: write-through to
 * IndexedDB + the runtime overlay; maintain: Storage upload/delete + a
 * listing refresh) — this component only owns the file-size gate, the
 * delete confirm/block, and the error line. */
export function AssetsManager({
  book,
  domain,
  assets,
  onAdd,
  onDelete,
  deleteBlockedBy,
}: {
  book: BookDocument;
  domain: DomainDocument;
  bookId: string;
  assets: AssetView[];
  onAdd: (file: File) => Promise<void>;
  onDelete: (stem: string) => Promise<void>;
  /** Present only in maintain mode (spec 0012-C §2/§8): checked before the
   * confirm, against the *published* document. A non-empty result blocks
   * the delete outright — under slice B's eager all-or-nothing download, a
   * deleted-but-published object 404s during another learner's Add and
   * rolls back that whole Book, and the maintainer never sees it since
   * their own copy is already cached. Absent in private mode, where no
   * other device is involved and today's warn-and-allow confirm is correct
   * as-is. */
  deleteBlockedBy?: (stem: string) => string[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (file === undefined) {
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setError(
        `"${file.name}" is too large: ${formatBytes(file.size)} (max ${formatBytes(MAX_ASSET_BYTES)}).`,
      );
      return;
    }
    setError(null);
    try {
      await onAdd(file);
    } catch (e) {
      // Maintain mode's `onAdd` (uploadAsset) throws specific, useful
      // messages — a rejected MIME type, an RLS/network failure (spec
      // 0012-C §1: "reject … with a clear message"). Private mode's
      // `onAdd` (an IndexedDB write) throws browser exceptions with no
      // author-facing wording, so it keeps the generic fallback exactly as
      // before — `deleteBlockedBy` (present only in maintain mode) is the
      // existing signal this component already uses to tell the two apart.
      setError(
        deleteBlockedBy !== undefined && e instanceof Error
          ? e.message
          : "failed to save the asset — storage may be full",
      );
    }
  }

  async function handleDelete(stem: string) {
    if (deleteBlockedBy !== undefined) {
      const blockedBy = deleteBlockedBy(stem);
      if (blockedBy.length > 0) {
        setError(
          `✗ Published content references this: ${blockedBy.join(", ")}. Remove the references and publish first, then delete.`,
        );
        return;
      }
      if (!window.confirm(`Delete asset "${stem}"?`)) {
        return;
      }
    } else {
      const refs = assetReferences(book, domain, stem);
      const warning =
        refs.length > 0
          ? `Still referenced by: ${refs.join(", ")}. Deleting it will make this Book invalid until those references are fixed.\n\n`
          : "";
      if (!window.confirm(`${warning}Delete asset "${stem}"?`)) {
        return;
      }
    }
    setError(null);
    try {
      await onDelete(stem);
    } catch {
      setError("failed to delete the asset — storage may be full");
    }
  }

  return (
    <section>
      <h2>Assets</h2>
      {error !== null && <p className="error-text">{error}</p>}
      <label className="field">
        Add audio or image
        <input
          type="file"
          accept="audio/*,image/*"
          onChange={(e) => void handleFileSelect(e)}
        />
      </label>
      {assets.length === 0 ? (
        <p className="status">No assets yet.</p>
      ) : (
        <ul className="card-list asset-list">
          {assets.map((asset) => (
            <li key={asset.stem} className="card">
              <h3>{asset.name}</h3>
              <p className="status">
                {asset.kind} · {formatBytes(asset.size)}
              </p>
              {asset.url !== "" &&
                (asset.kind === "image" ? (
                  <img src={asset.url} alt="" />
                ) : (
                  <audio controls src={asset.url} />
                ))}
              <label className="field">
                Stem (copy into an audioRef/imageRef field)
                <input
                  type="text"
                  readOnly
                  value={asset.stem}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <button
                className="plain danger"
                onClick={() => void handleDelete(asset.stem)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

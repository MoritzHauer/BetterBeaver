import { useEffect, useState } from "react";
import { type BookDocument, type DomainDocument } from "@betterbeaver/schema";
import { registerPrivateAssets } from "../../content/private-assets";
import { newPrivateId } from "../../content/private-ids";
import { putPrivateBook, readPrivateBooks } from "../../content/private-store";
import { type Entity } from "./types";

/** Kind label for display, from the blob's MIME type — same "image vs.
 * audio" split `content/private-assets.ts`'s runtime overlay uses. */
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

/** Asset manager for a private Book (plan 0017 §4): list/add/delete blobs
 * and show each stem as copyable text. Deliberately NOT a per-field file
 * picker — that would mean changing `EntityForm`/`Field`, which the
 * maintainer and propose paths share, for a feature only private Books use.
 * The author copies a stem here and pastes it into an item's
 * audioRef/imageRef field by hand; the stems are the contract between this
 * view and the book/domain forms. */
export function AssetsManager({
  book,
  domain,
  bookId,
  assets,
  onAssetsChange,
}: {
  book: BookDocument;
  domain: DomainDocument;
  bookId: string;
  assets: Record<string, Blob>;
  onAssetsChange: (next: Record<string, Blob>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(
    new Map(),
  );

  // One object URL per current stem. The cleanup revokes exactly what this
  // run's setup created, and runs both on the next `assets` change and on
  // unmount (plan 0017 §4: "Revoke those URLs on unmount") — a plain
  // effect+cleanup pair rather than manual prev/next diffing, so it stays
  // correct under StrictMode's double-invoke too.
  useEffect(() => {
    const urls = new Map<string, string>();
    for (const [stem, blob] of Object.entries(assets)) {
      urls.set(stem, URL.createObjectURL(blob));
    }
    setPreviewUrls(urls);
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assets]);

  const bookCode =
    typeof (book.topic as Entity).code === "string"
      ? ((book.topic as Entity).code as string)
      : "";

  /** Persists the full record, then re-registers the runtime overlay
   * (`content/private-assets.ts`) before notifying the parent — an asset
   * added or removed mid-session is otherwise invisible to
   * `registerPrivateAssets` until reload (plan 0017 §4 point 3). Ordered
   * before `onAssetsChange` so the dangling-ref check in `PrivateEditScreen`
   * re-renders against the fresh overlay, not the stale one. */
  async function writeThrough(nextAssets: Record<string, Blob>) {
    await putPrivateBook({ id: bookId, book, domain, assets: nextAssets });
    registerPrivateAssets(await readPrivateBooks());
    onAssetsChange(nextAssets);
  }

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
    // Never the filename (plan 0017 §4 point 2): filenames contain spaces
    // and other characters `slugPattern` rejects, so the stem is always
    // generated, never derived from what the author picked.
    const stem = `${bookCode}-${newPrivateId()}`;
    try {
      await writeThrough({ ...assets, [stem]: file });
    } catch {
      setError("failed to save the asset — storage may be full");
    }
  }

  async function handleDelete(stem: string) {
    const refs = assetReferences(book, domain, stem);
    const warning =
      refs.length > 0
        ? `Still referenced by: ${refs.join(", ")}. Deleting it will make this Book invalid until those references are fixed.\n\n`
        : "";
    if (!window.confirm(`${warning}Delete asset "${stem}"?`)) {
      return;
    }
    const next = { ...assets };
    delete next[stem];
    try {
      await writeThrough(next);
    } catch {
      setError("failed to delete the asset — storage may be full");
    }
  }

  const stems = Object.entries(assets);

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
      {stems.length === 0 ? (
        <p className="status">No assets yet.</p>
      ) : (
        <ul className="card-list asset-list">
          {stems.map(([stem, blob]) => {
            const url = previewUrls.get(stem);
            const kind = assetKind(blob);
            return (
              <li key={stem} className="card">
                <p className="status">
                  {kind} · {formatBytes(blob.size)}
                </p>
                {url !== undefined &&
                  (kind === "image" ? (
                    <img src={url} alt="" />
                  ) : (
                    <audio controls src={url} />
                  ))}
                <label className="field">
                  Stem (copy into an audioRef/imageRef field)
                  <input
                    type="text"
                    readOnly
                    value={stem}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                <button
                  className="plain danger"
                  onClick={() => void handleDelete(stem)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import type { AssetStems } from "@betterbeaver/engine";
import type { BookDocument } from "@betterbeaver/schema";
import type { PrivateBookRecord } from "./private-store";

/**
 * Runtime asset overlay for private Books (plan 0017 §4). Bundled assets are
 * resolved at build time via `import.meta.glob`; a private Book's assets are
 * blobs in IndexedDB, so they become object URLs here and are merged into the
 * same `AssetStems` / `getAssetUrl` lookups the screens already use.
 *
 * ponytail: a per-session map with no eviction — a private library is small.
 * Revisit if a real user hits memory pressure.
 */

/** A private Book's declared domain id, read raw off its topic — same pattern as `content/source.ts`'s `rawDomainId`. */
function rawDomainId(book: BookDocument): string {
  return typeof (book.topic as { domainId?: unknown }).domainId === "string"
    ? (book.topic as { domainId: string }).domainId
    : "";
}

let audioByBook = new Map<string, Map<string, string>>();
let imageByBook = new Map<string, Map<string, string>>();
let audioByDomain = new Map<string, Map<string, string>>();
let imageByDomain = new Map<string, Map<string, string>>();
let createdUrls: string[] = [];

function addStem(
  byId: Map<string, Map<string, string>>,
  id: string,
  stem: string,
  url: string,
): void {
  const stems = byId.get(id) ?? new Map<string, string>();
  stems.set(stem, url);
  byId.set(id, stems);
}

/** Revokes any previously-created URLs, then creates one object URL per asset. Called once per boot, before the content source is built. */
export function registerPrivateAssets(records: PrivateBookRecord[]): void {
  for (const url of createdUrls) {
    URL.revokeObjectURL(url);
  }
  createdUrls = [];
  audioByBook = new Map();
  imageByBook = new Map();
  audioByDomain = new Map();
  imageByDomain = new Map();

  for (const record of records) {
    const domainId = rawDomainId(record.book);
    for (const [stem, blob] of Object.entries(record.assets)) {
      const kind = blob.type.startsWith("image/") ? "img" : "audio";
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      const byBook = kind === "img" ? imageByBook : audioByBook;
      addStem(byBook, record.id, stem, url);
      if (domainId !== "") {
        const byDomain = kind === "img" ? imageByDomain : audioByDomain;
        addStem(byDomain, domainId, stem, url);
      }
    }
  }
}

/** The registered stems, in `AssetStems` shape. */
export function privateAssetStems(): AssetStems {
  const stems = (byId: Map<string, Map<string, string>>) =>
    new Map([...byId].map(([id, urls]) => [id, [...urls.keys()]]));
  return {
    audioByBook: stems(audioByBook),
    imageByBook: stems(imageByBook),
    audioByDomain: stems(audioByDomain),
    imageByDomain: stems(imageByDomain),
  };
}

/** Object URL, or `undefined`. `id` may be a book id or a domain id — checks both maps. */
export function getPrivateAssetUrl(
  id: string,
  kind: "audio" | "img",
  stem: string,
): string | undefined {
  const byBook = kind === "img" ? imageByBook : audioByBook;
  const byDomain = kind === "img" ? imageByDomain : audioByDomain;
  return byBook.get(id)?.get(stem) ?? byDomain.get(id)?.get(stem);
}

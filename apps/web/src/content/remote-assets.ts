import { contentIdOf, type BookDocument } from "@betterbeaver/schema";
import type { AssetStems } from "@betterbeaver/engine";
import type { CachedDocument } from "./cache";

/** A book document's declared domain id, read raw (before validation) —
 * duplicated from `source.ts`'s `rawDomainId` rather than imported: this
 * module is imported BY `source.ts` (via `registerRemoteAssets`), so
 * importing back would be a cycle (`lint:cycles`). */
function rawDomainId(doc: BookDocument): string {
  return typeof (doc.topic as { domainId?: unknown }).domainId === "string"
    ? (doc.topic as { domainId: string }).domainId
    : "";
}

/**
 * Runtime asset overlay for remote Books (spec 0012-A/B), mirroring
 * `private-assets.ts` exactly (plan 0017 §4's pattern). A remote Book's or
 * domain's assets are downloaded into `CachedDocument.assets`
 * (`content/source.ts`'s `addBook`/`acceptUpdate`, spec 0012-B) as blobs in
 * IndexedDB, so they become object URLs here and are merged into the same
 * `AssetStems` / `getAssetUrl` lookups the screens already use.
 *
 * ponytail: a per-session map with no eviction — the same tradeoff
 * `private-assets.ts` makes, for the same reason.
 */

let audioByBook = new Map<string, Map<string, string>>();
let imageByBook = new Map<string, Map<string, string>>();
let audioByDomain = new Map<string, Map<string, string>>();
let imageByDomain = new Map<string, Map<string, string>>();
let createdUrls: string[] = [];
let domainIdByBookId = new Map<string, string>();

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
export function registerRemoteAssets(docs: CachedDocument[]): void {
  for (const url of createdUrls) {
    URL.revokeObjectURL(url);
  }
  createdUrls = [];
  audioByBook = new Map();
  imageByBook = new Map();
  audioByDomain = new Map();
  imageByDomain = new Map();
  domainIdByBookId = new Map();

  for (const doc of docs) {
    if (doc.kind === "topic") {
      // Recorded for every topic doc, not just ones with assets of their
      // own: a book with no remote assets can still reference a *domain's*
      // remote lexicon assets, which needs this map too (spec 0012-B §5).
      const domainId = rawDomainId(doc.doc as BookDocument);
      if (domainId !== "") {
        domainIdByBookId.set(contentIdOf(doc.id), domainId);
      }
    }
    if (doc.assets === undefined) {
      continue;
    }
    const id = contentIdOf(doc.id);
    const imageMap = doc.kind === "topic" ? imageByBook : imageByDomain;
    const audioMap = doc.kind === "topic" ? audioByBook : audioByDomain;
    for (const [stem, blob] of Object.entries(doc.assets)) {
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      const target = blob.type.startsWith("image/") ? imageMap : audioMap;
      addStem(target, id, stem, url);
    }
  }
}

/** The registered stems, in `AssetStems` shape. */
export function remoteAssetStems(): AssetStems {
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
export function getRemoteAssetUrl(
  id: string,
  kind: "audio" | "img",
  stem: string,
): string | undefined {
  const byBook = kind === "img" ? imageByBook : audioByBook;
  const byDomain = kind === "img" ? imageByDomain : audioByDomain;
  return byBook.get(id)?.get(stem) ?? byDomain.get(id)?.get(stem);
}

/** A remote book id's domain id, or `undefined` — the domain-fallback gap
 * `bundled.ts`'s `getAssetUrl` needs (spec 0012-B §5): `domainIdByBookId`
 * over there is built only from bundled content, so a Library-fetched Book
 * is absent from it. */
export function remoteDomainIdForBook(bookId: string): string | undefined {
  return domainIdByBookId.get(bookId);
}

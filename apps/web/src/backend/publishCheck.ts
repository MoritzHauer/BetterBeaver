import {
  CONTENT_SCHEMA_VERSION,
  contentIdOf,
  type DomainDocument,
  type BookDocument,
} from "@betterbeaver/schema";
import { createDocumentContentSource } from "@betterbeaver/engine";
import { bundledAssetStems, mergeAssetStems } from "../content/bundled";
import {
  listDocumentAssets,
  assetStemsFromListing,
  type RemoteAsset,
} from "./storage";
import { getSupabase } from "./supabase";

/**
 * Publish-time validation (plan 0012 §3): the draft, assembled with the
 * published rest of the catalog, must form a valid content set. Symmetric
 * by construction — a book draft is checked against its published domain,
 * a domain draft against every published book of that domain — because the
 * whole listed set is always assembled. Returns human-readable errors;
 * empty means publishable.
 *
 * `also` overlays further documents on that set, and covers the two ways
 * the catalog alone is not enough. The catalog is `where listed` — a Book
 * an admin has not listed yet is not in it, so a lexicon publish would be
 * checked against a set containing nothing that references it. And a Book
 * whose own draft is not part of this publish still has to be *present*,
 * at whatever version this publish would leave it at, or a deleted word
 * cannot be seen to break the task that points at it.
 */
export async function validateForPublish(
  docId: string,
  kind: "topic" | "domain",
  draft: BookDocument | DomainDocument,
  also: {
    docId: string;
    kind: "topic" | "domain";
    doc: BookDocument | DomainDocument;
  }[] = [],
): Promise<string[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return ["backend not configured"];
  }
  const { data, error } = await supabase
    .from("catalog")
    .select("id,kind,published,schema_version");
  if (error) {
    return [`could not load the published catalog: ${error.message}`];
  }
  const books = new Map<string, BookDocument>();
  const domains = new Map<string, DomainDocument>();
  for (const row of data as {
    id: string;
    kind: "topic" | "domain";
    published: unknown;
    schema_version: number;
  }[]) {
    if (row.schema_version > CONTENT_SCHEMA_VERSION) {
      return [
        `the published catalog contains newer-schema content (${row.id}) — update the app before publishing`,
      ];
    }
    // Backend document ids are kind-prefixed; the builder keys on content ids.
    if (row.kind === "topic") {
      books.set(contentIdOf(row.id), row.published as BookDocument);
    } else {
      domains.set(contentIdOf(row.id), row.published as DomainDocument);
    }
  }
  for (const entry of [{ docId, kind, doc: draft }, ...also]) {
    if (entry.kind === "topic") {
      books.set(contentIdOf(entry.docId), entry.doc as BookDocument);
    } else {
      domains.set(contentIdOf(entry.docId), entry.doc as DomainDocument);
    }
  }

  // Storage listing for every document in the assembled set (spec 0012-B
  // §6) — never publish blind against an unknown asset inventory. The
  // draft's own id is included even when it wasn't already in the
  // published catalog (a not-yet-published document).
  const assembledDocIds = new Set(
    (data as { id: string }[]).map((row) => row.id),
  );
  assembledDocIds.add(docId);
  for (const entry of also) {
    assembledDocIds.add(entry.docId);
  }
  let listingEntries: { documentId: string; assets: RemoteAsset[] }[];
  try {
    listingEntries = await Promise.all(
      [...assembledDocIds].map(async (id) => ({
        documentId: id,
        assets: await listDocumentAssets(id),
      })),
    );
  } catch (err) {
    return [
      `could not check the published assets: ${err instanceof Error ? err.message : String(err)}`,
    ];
  }
  const assetStems = mergeAssetStems(
    bundledAssetStems(),
    assetStemsFromListing(listingEntries),
  );

  // createDocumentContentSource no longer throws (plan 0015 decision 11a):
  // per-Book failures land in `broken` instead. Publish-time validation
  // still wants an all-or-nothing verdict, so any broken Book — the draft
  // itself or, on a cross-Book collision, an existing published Book —
  // fails the publish.
  const built = createDocumentContentSource(books, domains, assetStems);
  // The Book being published is the subject of the whole panel, so naming it
  // adds nothing — and it actively breaks spec 0021-10 §3: the deep-link
  // resolver takes the first id in the message it can own, and a leading
  // Book id shadows the entity id after it, sending every error to the Book
  // screen. It also puts a bare UUID in front of every line. Other Books —
  // a cross-Book collision — still need naming.
  const publishing = new Set(
    [{ docId }, ...also].map((entry) => contentIdOf(entry.docId)),
  );
  return built.broken.flatMap((b) =>
    b.errors.map((error) =>
      publishing.has(b.bookId) ? error : `${b.bookId}: ${error}`,
    ),
  );
}

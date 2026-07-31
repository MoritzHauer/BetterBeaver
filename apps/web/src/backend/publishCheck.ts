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
 */
export async function validateForPublish(
  docId: string,
  kind: "topic" | "domain",
  draft: BookDocument | DomainDocument,
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
  if (kind === "topic") {
    books.set(contentIdOf(docId), draft as BookDocument);
  } else {
    domains.set(contentIdOf(docId), draft as DomainDocument);
  }

  // Storage listing for every document in the assembled set (spec 0012-B
  // §6) — never publish blind against an unknown asset inventory. The
  // draft's own id is included even when it wasn't already in the
  // published catalog (a not-yet-published document).
  const assembledDocIds = new Set(
    (data as { id: string }[]).map((row) => row.id),
  );
  assembledDocIds.add(docId);
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
  return built.broken.flatMap((b) =>
    b.errors.map((error) => `${b.bookId}: ${error}`),
  );
}

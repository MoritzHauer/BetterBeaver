// Refreshes the frozen bundled seed from the backend's published catalog
// (plan 0012 §6/§8): run after publishes worth seeding and as part of every
// CONTENT_SCHEMA_VERSION bump, then `corepack pnpm exec prettier --write content`
// and commit. Reads only the public catalog view, so the anon key suffices.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=... \
//   node scripts/export-content.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentIdOf,
  documentId,
  type DomainDocument,
  type BookDocument,
} from "../packages/schema/src/documents.ts";
import {
  CONTENT_DIR,
  writeDomainDocument,
  writeBookDocument,
} from "./content-fs.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("set SUPABASE_URL and SUPABASE_ANON_KEY");
  process.exit(1);
}

const response = await fetch(
  `${url}/rest/v1/catalog?select=id,kind,published,published_version`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!response.ok) {
  throw new Error(`catalog: ${response.status} ${await response.text()}`);
}
const rows = (await response.json()) as {
  id: string;
  kind: "topic" | "domain";
  published: unknown;
  published_version: number;
}[];

// Scoped to the onboarding Book only (plan 0015 decision 10): the bundled
// seed is a frozen first-run mirror, not a full backend export — every
// other Book is Library-fetched-on-add and must never resurrect here.
const ONBOARDING_BOOK_ID = "demo";
const ONBOARDING_DOMAIN_ID = "demo";

const seededVersions: Record<string, number> = {};
for (const row of rows) {
  const id = contentIdOf(row.id);
  if (row.kind === "topic") {
    if (id === ONBOARDING_BOOK_ID) {
      writeBookDocument(id, row.published as BookDocument);
      seededVersions[row.id] = row.published_version;
    }
  } else if (id === ONBOARDING_DOMAIN_ID) {
    writeDomainDocument(id, row.published as DomainDocument);
    seededVersions[row.id] = row.published_version;
  }
}

// The version each seeded document was exported at, read back by
// `content/bundled.ts`'s `seedDocumentVersions` and reported by
// `seedCatalogRows`. Without it the first-run cache claims version 0 and
// `planUpdate` offers a content update on the first boot of every fresh
// install. Written last, so a failed export never leaves versions claiming
// to describe documents that were not written. A file, not a directory, so
// `loadContentDocuments`' `isDirectory()` walk skips it — same trick
// `base-versions.json` already uses.
writeFileSync(
  join(CONTENT_DIR, "seed-versions.json"),
  `${JSON.stringify(seededVersions, null, 2)}\n`,
);

// Seed assets (spec 0012-C §5): the onboarding Book is pre-added from the
// bundle and never fetched, so a remote-only asset reference in it would put
// it into the broken-Books card on a fresh offline install with no network
// path to repair. Storage's REST API is used directly rather than
// apps/web/src/backend/storage.ts, which this plain-node script can't import
// — that module's `getSupabase` reads `import.meta.env`, a Vite-only global.
//
// Written named by stem, not by display name, because `bundled.ts`'s
// build-time globs key on the file stem — the bucket layout
// (`<kind>/<contentId>/audio|img/<objectName>`) and the parse of
// `<objectName>` into `{stem, name}` mirror `backend/storage.ts`'s
// `parseObjectName`/`objectPrefix` exactly; keep the two in sync by hand if
// either changes.
async function listAssets(
  docId: string,
): Promise<{ name: string; kind: "audio" | "img" }[]> {
  const prefix = docId.replace(":", "/");
  const out: { name: string; kind: "audio" | "img" }[] = [];
  for (const kind of ["audio", "img"] as const) {
    const res = await fetch(`${url}/storage/v1/object/list/assets`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: `${prefix}/${kind}`,
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!res.ok) {
      throw new Error(`storage list: ${res.status} ${await res.text()}`);
    }
    const entries = (await res.json()) as { id: string | null; name: string }[];
    for (const entry of entries) {
      if (entry.id === null) {
        continue; // a folder placeholder, not a file
      }
      out.push({ name: entry.name, kind });
    }
  }
  return out;
}

/** Same split `backend/storage.ts`'s `parseObjectName` uses, stem side only. */
function stemOf(objectName: string): string {
  const i = objectName.indexOf("__");
  return i === -1 ? objectName.replace(/\.[^.]+$/, "") : objectName.slice(0, i);
}

/** The object name's extension (after its final `.`); `""` when it has none. */
function extensionOf(objectName: string): string {
  const i = objectName.lastIndexOf(".");
  return i === -1 ? "" : objectName.slice(i + 1);
}

async function downloadSeedAssets(
  docId: string,
  destDir: string,
): Promise<void> {
  const prefix = docId.replace(":", "/");
  for (const { name, kind } of await listAssets(docId)) {
    const res = await fetch(
      `${url}/storage/v1/object/public/assets/${prefix}/${kind}/${name}`,
    );
    if (!res.ok) {
      throw new Error(
        `asset download: ${res.status} ${prefix}/${kind}/${name}`,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const stem = stemOf(name);
    const ext = extensionOf(name);
    const dir = join(destDir, kind);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ext === "" ? stem : `${stem}.${ext}`), bytes);
  }
}

await downloadSeedAssets(
  documentId("topic", ONBOARDING_BOOK_ID),
  join(CONTENT_DIR, ONBOARDING_BOOK_ID, "assets"),
);
await downloadSeedAssets(
  documentId("domain", ONBOARDING_DOMAIN_ID),
  join(CONTENT_DIR, "lexicon", ONBOARDING_DOMAIN_ID, "assets"),
);

console.log(
  `exported ${rows.length} document(s) into content/ — now run: corepack pnpm exec prettier --write content && corepack pnpm check`,
);

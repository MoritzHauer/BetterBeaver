// Refreshes the frozen bundled seed from the backend's published catalog
// (plan 0012 §6/§8): run after publishes worth seeding and as part of every
// CONTENT_SCHEMA_VERSION bump, then `corepack pnpm exec prettier --write content`
// and commit. Reads only the public catalog view, so the anon key suffices.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=... \
//   node scripts/export-content.ts
import {
  contentIdOf,
  type DomainDocument,
  type BookDocument,
} from "../packages/schema/src/documents.ts";
import { writeDomainDocument, writeBookDocument } from "./content-fs.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("set SUPABASE_URL and SUPABASE_ANON_KEY");
  process.exit(1);
}

const response = await fetch(
  `${url}/rest/v1/catalog?select=id,kind,published`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!response.ok) {
  throw new Error(`catalog: ${response.status} ${await response.text()}`);
}
const rows = (await response.json()) as {
  id: string;
  kind: "topic" | "domain";
  published: unknown;
}[];

// Scoped to the onboarding Book only (plan 0015 decision 10): the bundled
// seed is a frozen first-run mirror, not a full backend export — every
// other Book is Library-fetched-on-add and must never resurrect here.
const ONBOARDING_BOOK_ID = "demo";
const ONBOARDING_DOMAIN_ID = "demo";

for (const row of rows) {
  const id = contentIdOf(row.id);
  if (row.kind === "topic") {
    if (id === ONBOARDING_BOOK_ID) {
      writeBookDocument(id, row.published as BookDocument);
    }
  } else if (id === ONBOARDING_DOMAIN_ID) {
    writeDomainDocument(id, row.published as DomainDocument);
  }
}

console.log(
  `exported ${rows.length} document(s) into content/ — now run: corepack pnpm exec prettier --write content && corepack pnpm check`,
);

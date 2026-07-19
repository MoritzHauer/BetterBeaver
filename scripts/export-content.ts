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
  type TopicDocument,
} from "../packages/schema/src/documents.ts";
import { writeDomainDocument, writeTopicDocument } from "./content-fs.ts";

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

for (const row of rows) {
  if (row.kind === "topic") {
    writeTopicDocument(contentIdOf(row.id), row.published as TopicDocument);
  } else {
    writeDomainDocument(contentIdOf(row.id), row.published as DomainDocument);
  }
}

console.log(
  `exported ${rows.length} document(s) into content/ — now run: corepack pnpm exec prettier --write content && corepack pnpm check`,
);

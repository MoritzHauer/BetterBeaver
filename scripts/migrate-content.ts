// One-time seeding of the Supabase content backend from the content/ tree
// (plan 0012 step 1). Refuses to run against a non-empty documents table
// unless --force is given, because re-seeding clobbers published versions.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/migrate-content.ts [--force]
import { CONTENT_SCHEMA_VERSION } from "../packages/schema/src/documents.ts";
import { loadContentDocuments } from "./content-fs.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function rest(
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<Response> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key!,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.prefer !== undefined ? { Prefer: init.prefer } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
  return response;
}

const existing = (await (
  await rest("documents?select=id&limit=1")
).json()) as unknown[];
if (existing.length > 0 && !process.argv.includes("--force")) {
  console.error(
    "documents table is not empty — this would clobber published versions; rerun with --force if you mean it",
  );
  process.exit(1);
}

const { topics, domains } = loadContentDocuments();
const rows = [
  ...[...topics].map(([id, doc]) => ({ id, kind: "topic", doc })),
  ...[...domains].map(([id, doc]) => ({ id, kind: "domain", doc })),
];

await rest("documents?on_conflict=id", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: JSON.stringify(
    rows.map(({ id, kind, doc }) => ({
      id,
      kind,
      published: doc,
      published_version: 1,
      schema_version: CONTENT_SCHEMA_VERSION,
      draft: null,
      listed: true,
    })),
  ),
});

await rest("versions?on_conflict=doc_id,version", {
  method: "POST",
  prefer: "resolution=ignore-duplicates,return=minimal",
  body: JSON.stringify(
    rows.map(({ id, doc }) => ({ doc_id: id, version: 1, doc })),
  ),
});

console.log(
  `seeded ${topics.size} topic(s) + ${domains.size} domain(s) at schema version ${CONTENT_SCHEMA_VERSION}, all listed`,
);

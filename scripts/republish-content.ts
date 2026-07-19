// Republishes the content/ tree into the backend (plan 0012 §8 step 2 of
// the schema-bump procedure, and the post-ingest shipping step): for every
// document whose content/ version differs from the published row, bump
// published_version, stamp CONTENT_SCHEMA_VERSION, and append the versions
// history row — the same semantics as the publish_document RPC, done with
// direct service-key writes because the RPC's maintainer check needs a
// signed-in user (auth.uid() is null under the service key). Unlike
// `migrate-content.ts --force`, this never resets version history.
//
// Drafts are left untouched: a maintainer's in-app draft stays, and their
// later publish hits the RPC's optimistic version check ("reload") — the
// designed conflict path.
//
// Run `corepack pnpm check` FIRST — it validates the content/ tree; this
// script pushes it verbatim. New documents are inserted unlisted (an admin
// lists them via set_listed after review).
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/republish-content.ts
import {
  CONTENT_SCHEMA_VERSION,
  documentId,
} from "../packages/schema/src/documents.ts";
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

/** jsonb does not preserve key order, so equality needs a canonical form. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const { topics, domains } = loadContentDocuments();
const local = [
  ...[...topics].map(([id, doc]) => ({
    id: documentId("topic", id),
    kind: "topic",
    doc,
  })),
  ...[...domains].map(([id, doc]) => ({
    id: documentId("domain", id),
    kind: "domain",
    doc,
  })),
];

const remote = new Map(
  (
    (await (
      await rest("documents?select=id,published,published_version")
    ).json()) as { id: string; published: unknown; published_version: number }[]
  ).map((row) => [row.id, row]),
);

let updated = 0;
let inserted = 0;
let unchanged = 0;
for (const { id, kind, doc } of local) {
  const row = remote.get(id);
  if (row === undefined) {
    await rest("documents", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        id,
        kind,
        published: doc,
        published_version: 1,
        schema_version: CONTENT_SCHEMA_VERSION,
        listed: false,
      }),
    });
    await rest("versions", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ doc_id: id, version: 1, doc }),
    });
    inserted += 1;
    console.log(`inserted ${id} (unlisted — an admin lists it via set_listed)`);
    continue;
  }
  if (canonical(row.published) === canonical(doc)) {
    unchanged += 1;
    continue;
  }
  const nextVersion = row.published_version + 1;
  // Optimistic guard, same as the publish RPC: only patch the version we
  // read, so a concurrent in-app publish makes this fail loudly, not clobber.
  const patched = (await (
    await rest(
      `documents?id=eq.${encodeURIComponent(id)}&published_version=eq.${row.published_version}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({
          published: doc,
          published_version: nextVersion,
          schema_version: CONTENT_SCHEMA_VERSION,
        }),
      },
    )
  ).json()) as unknown[];
  if (patched.length !== 1) {
    throw new Error(`${id}: published concurrently — rerun to rebase on it`);
  }
  await rest("versions", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({ doc_id: id, version: nextVersion, doc }),
  });
  updated += 1;
  console.log(`published ${id} version ${nextVersion}`);
}

console.log(
  `${updated} updated, ${inserted} inserted, ${unchanged} unchanged, at schema version ${CONTENT_SCHEMA_VERSION}`,
);

// One-shot: rewrites every ENTITY id in the live Kyrgyz Book and its domain
// to `ky-<uuid>`, matching the ids the editor now generates (spec 0018).
// Owner-requested 2026-07-27 after being told the tradeoff.
//
// NOT renamed: the document identities themselves — book id `kyrgyz`, domain
// id `ky`, and the book/domain `code` fields. Those are backend row keys,
// `bb.mybooks` membership entries and the mandatory entity-id prefix; renaming
// them would break the catalog, membership and every remaining reference.
//
// Learner progress is keyed `bb.item.<itemId>` in localStorage, so this
// orphans SRS state for every renamed item and lexicon entry. The script
// writes an old->new mapping to `scripts/kyrgyz-id-map.json` so that state can
// be remapped on-device afterwards; without it, progress on this Book resets.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   node scripts/rename-kyrgyz-ids.ts [--write]
//
// Without --write it is a dry run: it transforms, validates, reports, and
// touches nothing.
import { writeFileSync } from "node:fs";
import { CONTENT_SCHEMA_VERSION } from "../packages/schema/src/documents.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const WRITE = process.argv.includes("--write");

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

const rows = (await (
  await rest(
    "documents?select=id,published,published_version&id=in.(topic:kyrgyz,domain:ky)",
  )
).json()) as {
  id: string;
  published: Record<string, unknown>;
  published_version: number;
}[];

const topicRow = rows.find((r) => r.id === "topic:kyrgyz");
const domainRow = rows.find((r) => r.id === "domain:ky");
if (!topicRow || !domainRow) {
  throw new Error("topic:kyrgyz or domain:ky missing from the backend");
}
const book = topicRow.published;
const domain = domainRow.published;
const CODE = book.topic.code as string;

// --- build the old -> new map -------------------------------------------
const map = new Map<string, string>();
const add = (oldId: unknown) => {
  if (typeof oldId === "string" && oldId !== "" && !map.has(oldId)) {
    map.set(oldId, `${CODE}-${crypto.randomUUID()}`);
  }
};
for (const list of [
  book.lessons,
  book.units,
  book.items,
  book.tasks,
  book.resources,
  domain.entries,
  domain.families,
]) {
  for (const entity of list as { id?: unknown }[]) {
    add(entity.id);
  }
}
// Notes are keyed by `stem`, and referenced as `<code>-note-<stem>` — both
// forms must move together.
const noteStemMap = new Map<string, string>();
for (const note of book.notes as { stem: string }[]) {
  noteStemMap.set(note.stem, crypto.randomUUID());
}

// --- apply ---------------------------------------------------------------
// Whole-quoted-token replacement over the serialised documents. Safe by
// construction: a JSON string value only matches when it is *exactly* the id,
// so an id mentioned inside note prose (a longer string) can never be hit,
// and no id can partially match another.
function rewrite(doc: unknown): unknown {
  let text = JSON.stringify(doc);
  const pairs: [string, string][] = [
    ...[...map].map(([o, n]) => [o, n] as [string, string]),
    ...[...noteStemMap].map(
      ([o, n]) =>
        [`${CODE}-note-${o}`, `${CODE}-note-${n}`] as [string, string],
    ),
    ...[...noteStemMap].map(([o, n]) => [o, n] as [string, string]),
  ];
  for (const [oldId, newId] of pairs) {
    text = text.split(`"${oldId}"`).join(`"${newId}"`);
  }
  return JSON.parse(text);
}

const newBook = rewrite(book) as Record<string, never>;
const newDomain = rewrite(domain) as Record<string, never>;

// The document identities and the code prefix must survive untouched.
for (const [label, got, want] of [
  ["book id", newBook.topic.id, book.topic.id],
  ["book code", newBook.topic.code, book.topic.code],
  ["book domainId", newBook.topic.domainId, book.topic.domainId],
  ["domain id", newDomain.domain.id, domain.domain.id],
  ["domain code", newDomain.domain.code, domain.domain.code],
] as const) {
  if (got !== want) {
    throw new Error(`${label} changed (${want} -> ${got}) — aborting`);
  }
}

// --- validation happens in the test suite ---------------------------------
// Same pattern as `republish-content.ts` ("Run `corepack pnpm check` FIRST"):
// the engine/schema packages import each other with `.js` specifiers that bare
// Node cannot resolve, so a script cannot call the validator directly. The dry
// run writes the transformed documents out; `packages/engine/src/*.test.ts`
// validates that file, and only then is `--write` safe.
writeFileSync(
  new URL("./kyrgyz-renamed.json", import.meta.url),
  JSON.stringify({ book: newBook, domain: newDomain }, null, 2),
);
console.log("wrote scripts/kyrgyz-renamed.json (validate it before --write)");

const remaining = JSON.stringify([newBook, newDomain]).match(
  new RegExp(`"${CODE}-(?!note-)[a-z]+-[a-z0-9-]*"`, "g"),
);
console.log(`renamed ${map.size} entities + ${noteStemMap.size} note stems`);
console.log(
  `old-style ids still present: ${remaining ? remaining.length : 0}` +
    (remaining ? ` e.g. ${remaining.slice(0, 3).join(", ")}` : ""),
);

const mapping = {
  bookId: "kyrgyz",
  domainId: "ky",
  entities: Object.fromEntries(map),
  noteStems: Object.fromEntries(noteStemMap),
};
writeFileSync(
  new URL("./kyrgyz-id-map.json", import.meta.url),
  JSON.stringify(mapping, null, 2),
);
console.log("wrote scripts/kyrgyz-id-map.json");

if (!WRITE) {
  console.log(
    "\nDRY RUN — nothing written. Validate with `corepack pnpm test`, then re-run with --write.",
  );
  process.exit(0);
}

for (const [row, doc] of [
  [topicRow, newBook],
  [domainRow, newDomain],
] as const) {
  const next = row.published_version + 1;
  const patched = (await (
    await rest(
      `documents?id=eq.${encodeURIComponent(row.id)}&published_version=eq.${row.published_version}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({
          published: doc,
          published_version: next,
          schema_version: CONTENT_SCHEMA_VERSION,
        }),
      },
    )
  ).json()) as unknown[];
  if (patched.length !== 1) {
    throw new Error(`${row.id}: published concurrently — rerun to rebase`);
  }
  await rest("versions", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({ doc_id: row.id, version: next, doc }),
  });
  console.log(`published ${row.id} v${row.published_version} -> v${next}`);
}

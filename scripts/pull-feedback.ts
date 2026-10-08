// Lists the 👎 votes and open reports learners left on one checked-out
// Book's cards (plan 0014), next to each card's text — the weekly input of
// the authoring loop: read them, rewrite the cards, and when one mistake
// keeps recurring, add a rule to `docs/content-practices.md`.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... BB_AUTHOR_TOKEN=... \
//     node scripts/pull-feedback.ts content.local/softwarearchitektur
//
// Votes and reports are readable by the document's maintainers only (RLS),
// so this needs a maintainer's author token or the service key.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { documentId } from "../packages/schema/src/documents.ts";
import { resolveBackendOrExit } from "./author-auth.ts";

const tree = process.argv[2];
if (tree === undefined) {
  console.error(
    "usage: SUPABASE_URL=... {SUPABASE_ANON_KEY + BB_AUTHOR_TOKEN | SUPABASE_SERVICE_ROLE_KEY} node scripts/pull-feedback.ts <content tree>",
  );
  process.exit(1);
}

function readJsonDir(dir: string): Record<string, unknown>[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    : [];
}

// Every Book in the tree plus the domains under `lexicon/`: lexeme and
// concept votes sit on the domain document, everything else on the Book's.
const docIds: string[] = [];
const byId = new Map<string, Record<string, unknown>>();
for (const name of readdirSync(tree)) {
  if (existsSync(join(tree, name, "topic.json"))) {
    docIds.push(documentId("topic", name));
    for (const kind of ["items", "tasks", "units"]) {
      for (const e of readJsonDir(join(tree, name, kind))) {
        byId.set(e.id as string, e);
      }
    }
  }
}
for (const domain of existsSync(join(tree, "lexicon"))
  ? readdirSync(join(tree, "lexicon"))
  : []) {
  docIds.push(documentId("domain", domain));
  for (const e of readJsonDir(join(tree, "lexicon", domain, "entries"))) {
    byId.set(e.id as string, e);
  }
}

/** One line a reviewer can judge the card from. */
function describe(id: string): string {
  const e = byId.get(id) as
    | { payload?: Record<string, unknown>; type?: string; itemIds?: string[] }
    | undefined;
  if (e === undefined) {
    return "(not in this tree — deleted or renamed since)";
  }
  if (e.type !== undefined) {
    return `${e.type} task over ${e.itemIds?.join(", ")}`;
  }
  const p = e.payload ?? {};
  const front = p.definition ?? p.gloss ?? p.stem ?? p.text;
  const back = p.term ?? p.script ?? p.translation ?? "";
  return `${String(front)}  →  ${String(back)}`;
}

const backend = await resolveBackendOrExit();
if (backend.mode === "anon") {
  // RLS answers an anonymous read with zero rows, not an error, which would
  // print a clean "0 flagged" for a Book full of 👎.
  console.error(
    "feedback is maintainer-only: set BB_AUTHOR_TOKEN or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}
const docFilter = `doc_id=in.(${docIds.map((d) => `"${d}"`).join(",")})`;

async function rows<T>(query: string): Promise<T[]> {
  const response = await fetch(`${backend.url}/rest/v1/${query}`, {
    headers: backend.headers(),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T[];
}

const votes = await rows<{
  content_kind: string;
  content_id: string;
  value: number;
}>(`feedback_votes?select=content_kind,content_id,value&${docFilter}`);
const reports = await rows<{
  content_kind: string;
  content_id: string;
  category: string;
  message: string | null;
  created_at: string;
}>(
  `feedback_reports?select=content_kind,content_id,category,message,created_at&resolved=is.false&${docFilter}`,
);

interface Entry {
  kind: string;
  up: number;
  down: number;
  reports: string[];
}
const entries = new Map<string, Entry>();
function entry(kind: string, id: string): Entry {
  const key = `${kind}:${id}`;
  if (!entries.has(key)) {
    entries.set(key, { kind, up: 0, down: 0, reports: [] });
  }
  return entries.get(key)!;
}
for (const v of votes) {
  const e = entry(v.content_kind, v.content_id);
  if (v.value === 1) e.up += 1;
  else e.down += 1;
}
for (const r of reports) {
  entry(r.content_kind, r.content_id).reports.push(
    `${r.created_at.slice(0, 10)} ${r.category}${r.message ? `: ${r.message}` : ""}`,
  );
}

// Only what needs a look: a 👎 or an open report. 👍-only cards are fine.
const flagged = [...entries]
  .filter(([, e]) => e.down > 0 || e.reports.length > 0)
  .sort(
    ([, a], [, b]) => b.down - a.down || b.reports.length - a.reports.length,
  );
for (const [key, e] of flagged) {
  const id = key.slice(e.kind.length + 1);
  console.log(`\n${key}  👎 ${e.down}  👍 ${e.up}`);
  if (e.kind === "item" || e.kind === "task") {
    console.log(`  ${describe(id)}`);
  }
  for (const r of e.reports) {
    console.log(`  - ${r}`);
  }
}
const voted = [...entries.values()].filter((e) => e.up + e.down > 0).length;
console.log(
  `\n${flagged.length} flagged of ${voted} voted-on (${docIds.join(", ")})`,
);

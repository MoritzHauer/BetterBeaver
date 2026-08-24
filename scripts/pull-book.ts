// Checks one published Book (and its domain) out of the backend into a
// scratch content tree, so it can be edited as plain JSON files and pushed
// back with `republish-content.ts` — the inverse of that script, and the
// editing path for anything that is not the onboarding Book.
//
// `BB_CONTENT_DIR` is REQUIRED: a pull must never land in the repo's
// `content/`, which is a frozen first-run seed holding the onboarding Book
// only (plan 0015 decision 10) — a Library Book resurrected there would be
// bundled into the app.
//
// Three identities work (`author-auth.ts`): the service key reads the
// `documents` table, so it can pull an unlisted or never-listed Book;
// `BB_AUTHOR_TOKEN` and a bare `SUPABASE_ANON_KEY` read the `catalog` view,
// which is listed + published rows only. A proposal-only author pulls with
// the anon path and pushes back with `propose-book.ts`.
//
//   BB_CONTENT_DIR=/tmp/bb-edit \
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=... BB_AUTHOR_TOKEN=... \
//   node scripts/pull-book.ts kyrgyz
//
// Then edit the files, validate, and push:
//
//   BB_CONTENT_DIR=/tmp/bb-edit corepack pnpm exec vitest run \
//     packages/schema/src/content.test.ts
//   BB_CONTENT_DIR=/tmp/bb-edit SUPABASE_URL=... \
//     SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts
//
// Only the published document is pulled. A maintainer's in-app draft is
// left alone by republish, so their later publish hits the RPC's version
// check and one side's edits lose — don't edit a Book in-app while it is
// checked out here.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  documentId,
  type DomainDocument,
  type BookDocument,
} from "../packages/schema/src/documents.ts";
import {
  BASE_VERSIONS_FILE,
  CONTENT_DIR,
  writeDomainDocument,
  writeBookDocument,
} from "./content-fs.ts";
import { publishedFrom, resolveBackendOrExit } from "./author-auth.ts";

/** The repo's frozen tree — the source of the assets a pull links in, and
 * never a pull destination (that is `CONTENT_DIR`). */
const REPO_CONTENT_DIR = new URL("../content", import.meta.url).pathname;

const bookId = process.argv[2];
if (bookId === undefined) {
  console.error(
    "usage: BB_CONTENT_DIR=<scratch dir> SUPABASE_URL=... {SUPABASE_ANON_KEY [+ BB_AUTHOR_TOKEN] | SUPABASE_SERVICE_ROLE_KEY} node scripts/pull-book.ts <book-id>",
  );
  process.exit(1);
}
if (process.env.BB_CONTENT_DIR === undefined) {
  console.error(
    `set BB_CONTENT_DIR to a scratch directory — pulling into ${CONTENT_DIR} would resurrect a Book in the frozen bundled seed`,
  );
  process.exit(1);
}
// Empty, not merely set: `writeEntityDir` deletes the directories it writes
// (so a wrong BB_CONTENT_DIR destroys whatever it points at), and
// `republish-content.ts` pushes EVERY book under the tree — a second pull
// into the same dir would silently republish the first one too.
mkdirSync(CONTENT_DIR, { recursive: true });
if (readdirSync(CONTENT_DIR).length > 0) {
  console.error(`${CONTENT_DIR} is not empty — clear it or pick another dir`);
  process.exit(1);
}

const backend = resolveBackendOrExit();
const source = publishedFrom(backend);

/** The version each document was pulled at — `propose-book.ts` stamps it as
 * the proposal's `base_version`. Reading it live at propose time instead
 * would silently rebase onto a publish that landed meanwhile, and the
 * reviewer's stale-base banner would never fire. */
const baseVersions: Record<string, number> = {};

async function published(id: string): Promise<unknown> {
  const response = await fetch(
    `${backend.url}/rest/v1/${source}?select=published,published_version&id=eq.${encodeURIComponent(id)}`,
    { headers: backend.headers() },
  );
  if (!response.ok) {
    throw new Error(`${id}: ${response.status} ${await response.text()}`);
  }
  const rows = (await response.json()) as {
    published: unknown;
    published_version: number;
  }[];
  if (rows.length !== 1) {
    throw new Error(
      source === "catalog"
        ? `${id}: not in the catalog — it is unlisted, never published, or misspelled; an unlisted Book needs SUPABASE_SERVICE_ROLE_KEY`
        : `${id}: expected 1 document, got ${rows.length}`,
    );
  }
  if (rows[0].published === null) {
    throw new Error(`${id}: never published — nothing to pull`);
  }
  baseVersions[id] = rows[0].published_version;
  return rows[0].published;
}

const book = (await published(documentId("topic", bookId))) as BookDocument;
const domainId = (book.topic as { domainId?: unknown }).domainId;
if (typeof domainId !== "string") {
  throw new Error(`${bookId}: topic.domainId missing — cannot pull its domain`);
}
// The domain comes along unconditionally: `validateContent` folds a Book's
// domain entries into its item pool, so validating without it reports every
// lexicon reference as dangling.
const domain = (await published(
  documentId("domain", domainId),
)) as DomainDocument;

writeBookDocument(bookId, book);
writeDomainDocument(domainId, domain);
// Assets are not part of a document (plan 0012 §2): they stay frozen in the
// repo until the asset pipeline lands. Without them every audioRef/imageRef
// in the pulled tree validates as dangling, so link the repo's in. A Book
// whose assets are NOT in the repo (today: everything except the onboarding
// Book) validates against empty stem lists — fine while those Books have no
// assets, and a dangling-ref failure once they do. Reported, because that
// failure otherwise reads as bad content rather than a missing link.
const linked: string[] = [];
for (const rel of [bookId, join("lexicon", domainId)]) {
  const assets = join(REPO_CONTENT_DIR, rel, "assets");
  if (existsSync(assets)) {
    symlinkSync(assets, join(CONTENT_DIR, rel, "assets"));
    linked.push(rel);
  }
}
console.log(
  linked.length > 0
    ? `linked repo assets for ${linked.join(", ")}`
    : "no repo assets for this Book — any audioRef/imageRef it carries will validate as dangling",
);
// A plain file at the tree root, invisible to `loadContentDocuments()` and
// `content.test.ts` — both iterate directories only.
writeFileSync(
  join(CONTENT_DIR, BASE_VERSIONS_FILE),
  `${JSON.stringify(baseVersions, null, 2)}\n`,
);
console.log(
  `pulled ${bookId} (domain ${domainId}) into ${CONTENT_DIR} — validate with: BB_CONTENT_DIR=${CONTENT_DIR} corepack pnpm exec vitest run packages/schema/src/content.test.ts`,
);

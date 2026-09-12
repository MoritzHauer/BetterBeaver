// Packs a scratch content tree holding exactly one Book and one lexicon
// domain into a `.bbbook` file — the private-Book import format the web app
// accepts in Settings (plan 0017; `PrivateBookExportFile` in
// apps/web/src/content/private-transfer.ts). Used by plan 0028 to load an
// unlisted Book into a fresh browser profile for review, without going
// through the backend at all.
//
// `BB_CONTENT_DIR` is REQUIRED: the repo's `content/` is the frozen
// onboarding seed (plan 0015 decision 10) and must never be packed.
//
// VALIDATE FIRST — this script packs the tree verbatim:
//
//   BB_CONTENT_DIR=<dir> corepack pnpm exec vitest run \
//     packages/schema/src/content.test.ts
//
//   BB_CONTENT_DIR=scratch.local/softwarearchitektur node scripts/pack-bbbook.ts <out.bbbook>
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CONTENT_SCHEMA_VERSION } from "../packages/schema/src/documents.ts";
import { CONTENT_DIR, loadContentDocuments } from "./content-fs.ts";

if (process.env.BB_CONTENT_DIR === undefined) {
  console.error(
    `set BB_CONTENT_DIR to a scratch directory — packing ${CONTENT_DIR}, the frozen bundled seed, would ship the onboarding Book instead`,
  );
  process.exit(1);
}

const outPath = process.argv[2];
if (outPath === undefined || process.argv.length > 3) {
  console.error(
    "usage: BB_CONTENT_DIR=<scratch dir> node scripts/pack-bbbook.ts <out.bbbook>",
  );
  process.exit(1);
}

const { books, domains } = loadContentDocuments();
if (books.size !== 1 || domains.size !== 1) {
  console.error(
    `expected exactly one book and one domain, found ${books.size} book(s) [${[...books.keys()].join(", ")}] and ${domains.size} domain(s) [${[...domains.keys()].join(", ")}]`,
  );
  process.exit(1);
}
const [bookId, book] = [...books.entries()][0];
const [domainId, domain] = [...domains.entries()][0];

const assetsDir = join(CONTENT_DIR, bookId, "assets");
if (existsSync(assetsDir) && readdirSync(assetsDir).length > 0) {
  // ponytail: assets would be data-URI encoded into `assets` (the shape
  // `privateBookExportFile` in private-transfer.ts produces) — add when a
  // packed Book needs them.
  console.error(
    `${assetsDir} has files — this script does not support Books with assets`,
  );
  process.exit(1);
}

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      kind: "bb-private-book",
      formatVersion: 1,
      schemaVersion: CONTENT_SCHEMA_VERSION,
      book,
      domain,
      assets: {},
    },
    null,
    2,
  )}\n`,
);

const count = (arr: unknown[]) => arr.length;
console.log(
  `packed ${(book.topic as { id?: unknown }).id} (domain ${domainId}) — ` +
    `${count(book.lessons)} lessons, ${count(book.units)} units, ${count(book.items)} items, ` +
    `${count(book.tasks)} tasks, ${count(book.notes)} notes, ${count(domain.entries)} entries -> ${outPath}`,
);

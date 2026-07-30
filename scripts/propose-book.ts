// Uploads the content tree as a PROPOSAL against each document's published
// version (plan 0012 §5) instead of publishing it (`republish-content.ts`).
// A proposal carries the whole edited document, not a patch: the maintainer
// reviews the structural diff in `MaintainEditScreen`, and accepting lands
// it in their DRAFT — so nothing reaches learners without a second look.
//
// This is the safe counterpart to republish for edits made outside the app:
// it cannot clobber a maintainer's open draft, and a stale base version
// shows up as a banner in review rather than as lost work.
//
// VALIDATE FIRST — the app's propose flow validates client-side and this
// script does not:
//
//   BB_CONTENT_DIR=<dir> corepack pnpm exec vitest run \
//     packages/schema/src/content.test.ts
//
// Then:
//
//   BB_CONTENT_DIR=/tmp/bb-edit \
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/propose-book.ts "what changed and why"
//
// The service key bypasses RLS, so rows land with `author: null`: they
// appear in the maintainer's review queue (that policy keys on
// `is_maintainer(doc_id)`), but they belong to no account — nobody can
// withdraw them in the app, and they never show under "My proposals".
// Hence the open-proposal guard below: a rerun would otherwise pile up
// un-withdrawable duplicates. Decide the open one first, or delete it with
// the service key.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { documentId } from "../packages/schema/src/documents.ts";
import {
  BASE_VERSIONS_FILE,
  CONTENT_DIR,
  loadContentDocuments,
} from "./content-fs.ts";

const note = process.argv[2];
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (note === undefined || note.trim() === "" || !url || !key) {
  console.error(
    'usage: BB_CONTENT_DIR=<pull-book tree> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/propose-book.ts "<note for the reviewer>"',
  );
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

// The version each document was pulled at — NOT the version live right now.
// Stamping the live one would rebase the proposal onto whatever landed
// since the pull, hiding the reviewer's stale-base banner and making accept
// silently revert that publish.
const baseVersionsPath = join(CONTENT_DIR, BASE_VERSIONS_FILE);
if (!existsSync(baseVersionsPath)) {
  console.error(
    `no ${BASE_VERSIONS_FILE} in ${CONTENT_DIR} — propose only works on a tree produced by pull-book.ts`,
  );
  process.exit(1);
}
const baseVersions = JSON.parse(
  readFileSync(baseVersionsPath, "utf-8"),
) as Record<string, number>;

const { books, domains } = loadContentDocuments();
const local = [
  ...[...books].map(([id, doc]) => ({ id: documentId("topic", id), doc })),
  ...[...domains].map(([id, doc]) => ({ id: documentId("domain", id), doc })),
];

let proposed = 0;
let unchanged = 0;
for (const { id, doc } of local) {
  const eq = `id=eq.${encodeURIComponent(id)}`;
  const rows = (await (
    await rest(`documents?select=published&${eq}`)
  ).json()) as { published: unknown }[];
  if (rows.length !== 1) {
    throw new Error(
      `${id}: not in the backend — a new document cannot be proposed against nothing; publish it with republish-content.ts`,
    );
  }
  // Compared against what is published *now* — "is there anything to
  // propose" is a question about the current state, unlike `base_version`.
  if (canonical(rows[0].published) === canonical(doc)) {
    unchanged += 1;
    continue;
  }
  const baseVersion = baseVersions[id];
  if (baseVersion === undefined) {
    throw new Error(
      `${id}: no entry in ${BASE_VERSIONS_FILE} — it was not pulled into this tree, so its base version is unknown`,
    );
  }
  const open = (await (
    await rest(
      `proposals?select=id&doc_id=eq.${encodeURIComponent(id)}&status=eq.open&author=is.null`,
    )
  ).json()) as { id: string }[];
  if (open.length > 0) {
    throw new Error(
      `${id}: an authorless proposal is already open (${open[0].id}) — decide it in the app first, or delete it with the service key`,
    );
  }
  await rest("proposals", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({
      doc_id: id,
      base_version: baseVersion,
      proposed_doc: doc,
      note: note.trim(),
    }),
  });
  proposed += 1;
  console.log(`proposed ${id} against base version ${baseVersion}`);
}

console.log(
  `${proposed} proposed, ${unchanged} unchanged — review them in the app under Edit → the document → open proposals`,
);

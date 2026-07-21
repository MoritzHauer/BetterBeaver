/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  CONTENT_SCHEMA_VERSION,
  contentIdOf,
  type DomainDocument,
  type BookDocument,
} from "@betterbeaver/schema";
import {
  createDocumentContentSource,
  type AssetStems,
} from "./documentSource.js";
import { ContentValidationError } from "./interfaces.js";

// The deployment guardrail (companion to the fs-tree assembly test above):
// the *live published catalog* — what learners actually pull — must assemble
// against the *deployed asset bundle* (the git content/ tree, since assets
// stay bundled and frozen, plan 0012 §2). This is the check that catches a
// backend/bundle divergence — e.g. a content/ rewrite that never got
// republished — before a learner's update is rejected. Point-in-time publish
// validation (validateForPublish) can't see a later bundle change; this can.
//
// Env-gated: without Supabase creds it skips (offline dev, no-backend build).
// CI passes SUPABASE_URL/SUPABASE_ANON_KEY so it runs and gates the deploy.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const configured = Boolean(url && key);

const CONTENT_DIR = fileURLToPath(new URL("../../../content", import.meta.url));

function readAssetStems(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).map((name) => name.replace(/\.[^.]+$/, ""));
}

/** Bundled asset stems from the git tree — the deployed app's asset truth. */
function loadBundledAssetStems(): AssetStems {
  const assets: AssetStems = {
    audioByBook: new Map(),
    imageByBook: new Map(),
    audioByDomain: new Map(),
    imageByDomain: new Map(),
  };
  for (const entry of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "lexicon") {
      continue;
    }
    const dir = join(CONTENT_DIR, entry.name);
    assets.audioByBook.set(
      entry.name,
      readAssetStems(join(dir, "assets", "audio")),
    );
    assets.imageByBook.set(
      entry.name,
      readAssetStems(join(dir, "assets", "img")),
    );
  }
  const lexiconDir = join(CONTENT_DIR, "lexicon");
  for (const name of existsSync(lexiconDir) ? readdirSync(lexiconDir) : []) {
    const dir = join(lexiconDir, name);
    assets.audioByDomain.set(
      name,
      readAssetStems(join(dir, "assets", "audio")),
    );
    assets.imageByDomain.set(name, readAssetStems(join(dir, "assets", "img")));
  }
  return assets;
}

interface CatalogEntry {
  id: string;
  kind: "topic" | "domain";
  published: unknown;
  schema_version: number;
}

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const response = await fetch(
    `${url}/rest/v1/catalog?select=id,kind,published,schema_version`,
    { headers: { apikey: key!, Authorization: `Bearer ${key}` } },
  );
  if (!response.ok) {
    throw new Error(`catalog request failed: ${response.status}`);
  }
  return (await response.json()) as CatalogEntry[];
}

// Skips entirely when unconfigured — never turns a no-backend run red.
(configured ? describe : describe.skip)("published catalog", () => {
  it("assembles against the deployed asset bundle", async () => {
    const rows = await fetchCatalog();
    expect(rows.length).toBeGreaterThan(0);

    const ahead = rows.filter((r) => r.schema_version > CONTENT_SCHEMA_VERSION);
    expect(
      ahead.map((r) => r.id),
      "backend has newer-schema content than this bundle — bump + deploy the app before it can serve them",
    ).toEqual([]);

    const books = new Map<string, BookDocument>();
    const domains = new Map<string, DomainDocument>();
    for (const r of rows) {
      // Catalog ids are kind-prefixed; the builder keys on bare content ids.
      if (r.kind === "topic") {
        books.set(contentIdOf(r.id), r.published as BookDocument);
      } else {
        domains.set(contentIdOf(r.id), r.published as DomainDocument);
      }
    }

    try {
      createDocumentContentSource(books, domains, loadBundledAssetStems());
    } catch (e) {
      if (e instanceof ContentValidationError) {
        // Surface every problem — this is the actionable message.
        throw new Error(
          `published catalog does not validate against the deployed bundle:\n  ${e.errors.join("\n  ")}\n(republish the content/ tree, or fix the backend, before deploying)`,
          { cause: e },
        );
      }
      throw e;
    }
  }, 30000);
});

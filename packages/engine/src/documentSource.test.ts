/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { DomainDocument, TopicDocument } from "@betterbeaver/schema";
import {
  createDocumentContentSource,
  planUpdate,
  type AssetStems,
  type CatalogRow,
} from "./documentSource.js";

// --- createDocumentContentSource over the real shipped content ------------
// content.test.ts (schema) validates each topic in isolation; this is the
// cross-document companion: the whole shipped tree must assemble into one
// valid content set through the same builder the app boots with.

const CONTENT_DIR = fileURLToPath(new URL("../../../content", import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readJsonFilesIn(dir: string): unknown[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(join(dir, name)));
}

function readAssetStems(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).map((name) => name.replace(/\.[^.]+$/, ""));
}

function loadFromFs(): {
  topics: Map<string, TopicDocument>;
  domains: Map<string, DomainDocument>;
  assets: AssetStems;
} {
  const topics = new Map<string, TopicDocument>();
  const domains = new Map<string, DomainDocument>();
  const assets: AssetStems = {
    audioByTopic: new Map(),
    imageByTopic: new Map(),
    audioByDomain: new Map(),
    imageByDomain: new Map(),
  };
  const topicDirNames = readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "lexicon")
    .map((entry) => entry.name);
  for (const name of topicDirNames) {
    const dir = join(CONTENT_DIR, name);
    const notesDir = join(dir, "notes");
    topics.set(name, {
      topic: readJson(join(dir, "topic.json")),
      lessons: readJsonFilesIn(join(dir, "lessons")),
      units: readJsonFilesIn(join(dir, "units")),
      items: readJsonFilesIn(join(dir, "items")),
      tasks: readJsonFilesIn(join(dir, "tasks")),
      resources: readJson(join(dir, "resources.json")) as unknown[],
      notes: (existsSync(notesDir) ? readdirSync(notesDir) : [])
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({
          stem: file.slice(0, -".md".length),
          markdown: readFileSync(join(notesDir, file), "utf-8"),
        })),
    });
    assets.audioByTopic.set(name, readAssetStems(join(dir, "assets", "audio")));
    assets.imageByTopic.set(name, readAssetStems(join(dir, "assets", "img")));
  }
  const lexiconDir = join(CONTENT_DIR, "lexicon");
  for (const name of existsSync(lexiconDir) ? readdirSync(lexiconDir) : []) {
    const dir = join(lexiconDir, name);
    domains.set(name, {
      domain: readJson(join(dir, "domain.json")),
      entries: readJsonFilesIn(join(dir, "entries")),
      families: readJsonFilesIn(join(dir, "families")),
    });
    assets.audioByDomain.set(
      name,
      readAssetStems(join(dir, "assets", "audio")),
    );
    assets.imageByDomain.set(name, readAssetStems(join(dir, "assets", "img")));
  }
  return { topics, domains, assets };
}

describe("createDocumentContentSource", () => {
  it("assembles the shipped content tree into a valid set", async () => {
    const { topics, domains, assets } = loadFromFs();
    expect(topics.size).toBeGreaterThan(0);
    const built = createDocumentContentSource(topics, domains, assets);
    expect((await built.source.listTopics()).length).toBe(topics.size);
    expect((await built.source.listDomains()).length).toBe(domains.size);
  });

  it("serves note markdown from the documents", () => {
    const { topics, domains, assets } = loadFromFs();
    const built = createDocumentContentSource(topics, domains, assets);
    const [topicId, doc] = [...topics].find(
      ([, candidate]) => candidate.notes.length > 0,
    )!;
    const note = doc.notes[0]!;
    expect(built.noteMarkdown(topicId, note.stem)).toBe(note.markdown);
    expect(built.noteMarkdown(topicId, "no-such-stem")).toBeUndefined();
  });
});

// --- planUpdate -----------------------------------------------------------

function row(id: string, version: number, schemaVersion = 1): CatalogRow {
  return {
    id,
    kind: "topic",
    published_version: version,
    schema_version: schemaVersion,
  };
}

describe("planUpdate", () => {
  it("reports nothing when cache matches catalog", () => {
    const update = planUpdate(new Map([["kyrgyz", 3]]), [row("kyrgyz", 3)]);
    expect(update).toEqual({ changed: [], removedIds: [], appOutdated: false });
  });

  it("flags version bumps and uncached documents", () => {
    const update = planUpdate(new Map([["kyrgyz", 3]]), [
      row("kyrgyz", 4),
      row("new-topic", 1),
    ]);
    expect(update.changed.map((r) => r.id)).toEqual(["kyrgyz", "new-topic"]);
  });

  it("skips documents needing a newer app and flags appOutdated", () => {
    const update = planUpdate(new Map(), [row("kyrgyz", 1, 999)]);
    expect(update.changed).toEqual([]);
    expect(update.appOutdated).toBe(true);
  });

  it("reports cached documents that left the catalog", () => {
    const update = planUpdate(new Map([["gone", 2]]), []);
    expect(update.removedIds).toEqual(["gone"]);
  });
});

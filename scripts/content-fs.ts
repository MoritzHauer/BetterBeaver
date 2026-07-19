// Reads/writes the content/ tree in document form (plan 0012). Runs under
// plain `node` (type stripping) — keep this file free of package imports;
// only direct .ts-path imports work here.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  DomainDocument,
  TopicDocument,
  TopicDocumentNote,
} from "../packages/schema/src/documents.ts";

export const CONTENT_DIR = new URL("../content", import.meta.url).pathname;

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

function readNotes(dir: string): TopicDocumentNote[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({
      stem: name.slice(0, -".md".length),
      markdown: readFileSync(join(dir, name), "utf-8"),
    }));
}

/** Loads every topic and domain document from the content/ tree. */
export function loadContentDocuments(): {
  topics: Map<string, TopicDocument>;
  domains: Map<string, DomainDocument>;
} {
  const topics = new Map<string, TopicDocument>();
  const domains = new Map<string, DomainDocument>();
  for (const entry of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "lexicon") {
      continue;
    }
    const dir = join(CONTENT_DIR, entry.name);
    topics.set(entry.name, {
      topic: readJson(join(dir, "topic.json")),
      lessons: readJsonFilesIn(join(dir, "lessons")),
      units: readJsonFilesIn(join(dir, "units")),
      items: readJsonFilesIn(join(dir, "items")),
      tasks: readJsonFilesIn(join(dir, "tasks")),
      resources: readJson(join(dir, "resources.json")) as unknown[],
      notes: readNotes(join(dir, "notes")),
    });
  }
  const lexiconDir = join(CONTENT_DIR, "lexicon");
  for (const name of existsSync(lexiconDir) ? readdirSync(lexiconDir) : []) {
    const dir = join(lexiconDir, name);
    domains.set(name, {
      domain: readJson(join(dir, "domain.json")),
      entries: readJsonFilesIn(join(dir, "entries")),
      families: readJsonFilesIn(join(dir, "families")),
    });
  }
  return { topics, domains };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** One entity per file, named `<id>.json` (the content/ convention). */
function writeEntityDir(dir: string, entities: unknown[]): void {
  rmSync(dir, { recursive: true, force: true });
  if (entities.length === 0) {
    return;
  }
  mkdirSync(dir, { recursive: true });
  for (const entity of entities) {
    const id = (entity as { id?: unknown }).id;
    if (typeof id !== "string") {
      throw new Error(`entity without string id in ${dir}`);
    }
    writeJson(join(dir, `${id}.json`), entity);
  }
}

/**
 * Writes a topic document back to `content/<id>/`, replacing the JSON/md
 * files but leaving `assets/` untouched (assets are frozen in-repo — plan
 * 0012 §2).
 */
export function writeTopicDocument(id: string, doc: TopicDocument): void {
  const dir = join(CONTENT_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "topic.json"), doc.topic);
  writeJson(join(dir, "resources.json"), doc.resources);
  writeEntityDir(join(dir, "lessons"), doc.lessons);
  writeEntityDir(join(dir, "units"), doc.units);
  writeEntityDir(join(dir, "items"), doc.items);
  writeEntityDir(join(dir, "tasks"), doc.tasks);
  const notesDir = join(dir, "notes");
  rmSync(notesDir, { recursive: true, force: true });
  if (doc.notes.length > 0) {
    mkdirSync(notesDir, { recursive: true });
    for (const note of doc.notes) {
      writeFileSync(join(notesDir, `${note.stem}.md`), note.markdown);
    }
  }
}

/** Domain-document counterpart of `writeTopicDocument` (`content/lexicon/<id>/`). */
export function writeDomainDocument(id: string, doc: DomainDocument): void {
  const dir = join(CONTENT_DIR, "lexicon", id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "domain.json"), doc.domain);
  writeEntityDir(join(dir, "entries"), doc.entries);
  writeEntityDir(join(dir, "families"), doc.families);
}

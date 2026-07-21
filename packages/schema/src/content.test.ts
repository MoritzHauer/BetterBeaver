/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateContent } from "./validate.js";

const CONTENT_DIR = fileURLToPath(new URL("../../../content", import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Parses every `*.json` file directly in `dir`. Returns `[]` if `dir` doesn't exist. */
function readJsonFilesIn(dir: string): unknown[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(join(dir, name)));
}

/** Basenames (without `.md`) of every `*.md` file in `dir`. Returns `[]` if `dir` doesn't exist. */
function readNoteStems(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length));
}

/** Basenames (without extension) of every file in `dir`. Returns `[]` if `dir` doesn't exist. */
function readAssetStems(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).map((name) => name.replace(/\.[^.]+$/, ""));
}

// "lexicon" holds domain data (content/lexicon/<domainId>/...), not a book
// (plan 0006) — every other content/ subdirectory is still a book dir.
const bookDirNames = existsSync(CONTENT_DIR)
  ? readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "lexicon")
      .map((entry) => entry.name)
  : [];

const LEXICON_DIR = join(CONTENT_DIR, "lexicon");

describe("content on disk", () => {
  it("finds at least one book directory under content/", () => {
    // A wrong CONTENT_DIR resolution (or an emptied content/) must fail this
    // test loudly rather than let the per-book tests below vacuously pass
    // by iterating zero times.
    expect(bookDirNames.length).toBeGreaterThan(0);
  });

  for (const bookDirName of bookDirNames) {
    it(`validates content/${bookDirName}`, () => {
      const dir = join(CONTENT_DIR, bookDirName);

      const book = readJson(join(dir, "topic.json"));
      const lessons = readJsonFilesIn(join(dir, "lessons"));
      const units = readJsonFilesIn(join(dir, "units"));
      const items = readJsonFilesIn(join(dir, "items"));
      const tasks = readJsonFilesIn(join(dir, "tasks"));
      const resources = readJson(join(dir, "resources.json")) as unknown[];
      const noteStems = readNoteStems(join(dir, "notes"));
      const audioStems = readAssetStems(join(dir, "assets", "audio"));
      const imageStems = readAssetStems(join(dir, "assets", "img"));

      const domainId = (book as { domainId?: unknown }).domainId;
      if (typeof domainId !== "string") {
        throw new Error(`content/${bookDirName}/topic.json: missing domainId`);
      }
      const domainDir = join(LEXICON_DIR, domainId);
      const domain = readJson(join(domainDir, "domain.json"));
      const entries = readJsonFilesIn(join(domainDir, "entries"));
      const families = readJsonFilesIn(join(domainDir, "families"));
      const lexiconAudioStems = readAssetStems(
        join(domainDir, "assets", "audio"),
      );
      const lexiconImageStems = readAssetStems(
        join(domainDir, "assets", "img"),
      );

      const result = validateContent({
        topic: book,
        lessons,
        units,
        items,
        tasks,
        resources,
        noteStems,
        audioStems,
        imageStems,
        domain,
        entries,
        families,
        lexiconAudioStems,
        lexiconImageStems,
      });

      if ("errors" in result) {
        throw new Error(
          `content/${bookDirName} failed validation:\n${result.errors.join("\n")}`,
        );
      }
      expect(result.content).toBeDefined();
    });
  }
});

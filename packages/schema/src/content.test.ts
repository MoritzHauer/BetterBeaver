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

const topicDirNames = existsSync(CONTENT_DIR)
  ? readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

describe("content on disk", () => {
  it("finds at least one topic directory under content/", () => {
    // A wrong CONTENT_DIR resolution (or an emptied content/) must fail this
    // test loudly rather than let the per-topic tests below vacuously pass
    // by iterating zero times.
    expect(topicDirNames.length).toBeGreaterThan(0);
  });

  for (const topicDirName of topicDirNames) {
    it(`validates content/${topicDirName}`, () => {
      const dir = join(CONTENT_DIR, topicDirName);

      const topic = readJson(join(dir, "topic.json"));
      const units = readJsonFilesIn(join(dir, "units"));
      const items = readJsonFilesIn(join(dir, "items"));
      const tasks = readJsonFilesIn(join(dir, "tasks"));
      const resources = readJson(join(dir, "resources.json")) as unknown[];
      const noteStems = readNoteStems(join(dir, "notes"));
      const audioStems = readAssetStems(join(dir, "assets", "audio"));
      const imageStems = readAssetStems(join(dir, "assets", "img"));

      const result = validateContent({
        topic,
        units,
        items,
        tasks,
        resources,
        noteStems,
        audioStems,
        imageStems,
      });

      if ("errors" in result) {
        throw new Error(
          `content/${topicDirName} failed validation:\n${result.errors.join("\n")}`,
        );
      }
      expect(result.content).toBeDefined();
    });
  }
});

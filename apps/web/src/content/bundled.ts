import { validateContent } from "@betterbeaver/schema";
import type { Content } from "@betterbeaver/schema";
import { ContentValidationError } from "@betterbeaver/engine";
import type { ContentSource, TopicSummary } from "@betterbeaver/engine";

// Eager globs so every bundled topic is statically included and available
// synchronously (no network fetch, no async import) — this is what makes
// the app work offline after first load.
const topicFiles = import.meta.glob("../../../../content/*/topic.json", {
  eager: true,
  import: "default",
});
const unitFiles = import.meta.glob("../../../../content/*/units/*.json", {
  eager: true,
  import: "default",
});
const itemFiles = import.meta.glob("../../../../content/*/items/*.json", {
  eager: true,
  import: "default",
});
const taskFiles = import.meta.glob("../../../../content/*/tasks/*.json", {
  eager: true,
  import: "default",
});
const resourceFiles = import.meta.glob("../../../../content/*/resources.json", {
  eager: true,
  import: "default",
});
const noteFiles = import.meta.glob("../../../../content/*/notes/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** Extracts the topic directory name (the path segment after `content/`). */
function topicDirOf(path: string): string {
  const match = /\/content\/([^/]+)\//.exec(path);
  if (match === null || match[1] === undefined) {
    throw new Error(`unexpected content glob path: ${path}`);
  }
  return match[1];
}

/** Extracts a file's basename without its extension. */
function stemOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

/** Groups glob entries by topic directory name. */
function groupByTopicDir(
  files: Record<string, unknown>,
): Map<string, unknown[]> {
  const byDir = new Map<string, unknown[]>();
  for (const [path, value] of Object.entries(files)) {
    const dir = topicDirOf(path);
    const list = byDir.get(dir) ?? [];
    list.push(value);
    byDir.set(dir, list);
  }
  return byDir;
}

/** Groups note markdown glob entries by topic directory name, keyed by stem. */
function groupNotesByTopicDir(
  files: Record<string, unknown>,
): Map<string, Map<string, string>> {
  const byDir = new Map<string, Map<string, string>>();
  for (const [path, value] of Object.entries(files)) {
    const dir = topicDirOf(path);
    const stems = byDir.get(dir) ?? new Map<string, string>();
    stems.set(stemOf(path), value as string);
    byDir.set(dir, stems);
  }
  return byDir;
}

const topicsByDir = groupByTopicDir(topicFiles);
const unitsByDir = groupByTopicDir(unitFiles);
const itemsByDir = groupByTopicDir(itemFiles);
const tasksByDir = groupByTopicDir(taskFiles);
const resourcesByDir = groupByTopicDir(resourceFiles);
const notesByDir = groupNotesByTopicDir(noteFiles);

/**
 * Creates a `ContentSource` backed by content bundled into the app at build
 * time (`content/<topicId>/...`, loaded via `import.meta.glob`). Validates
 * every topic synchronously at construction time; throws
 * `ContentValidationError` on any failure so the app can show a startup
 * error screen instead of serving broken content.
 */
export function createBundledContentSource(): ContentSource {
  const contentByTopicId = new Map<string, Content>();
  const allErrors: string[] = [];

  for (const [dir, topicFileValues] of topicsByDir) {
    // Each topic directory has exactly one topic.json; the glob still
    // yields an array, so take its single entry.
    const topic = topicFileValues[0];
    const noteStemMap = notesByDir.get(dir) ?? new Map<string, string>();
    const result = validateContent({
      topic,
      units: unitsByDir.get(dir) ?? [],
      items: itemsByDir.get(dir) ?? [],
      tasks: tasksByDir.get(dir) ?? [],
      // resources.json's default export is itself the array of resources,
      // so the grouped glob value is one level too deep — flatten it.
      resources: (resourcesByDir.get(dir) ?? []).flat(),
      noteStems: [...noteStemMap.keys()],
    });
    if ("errors" in result) {
      allErrors.push(...result.errors.map((error) => `${dir}: ${error}`));
      continue;
    }
    contentByTopicId.set(result.content.topic.id, result.content);
  }

  if (allErrors.length > 0) {
    throw new ContentValidationError(allErrors);
  }

  return {
    listTopics(): Promise<TopicSummary[]> {
      return Promise.resolve(
        [...contentByTopicId.values()].map((content) => ({
          id: content.topic.id,
          title: content.topic.title,
          description: content.topic.description,
        })),
      );
    },
    loadTopic(id: string): Promise<Content> {
      const content = contentByTopicId.get(id);
      if (content === undefined) {
        return Promise.reject(
          new ContentValidationError([`unknown topic: ${id}`]),
        );
      }
      return Promise.resolve(content);
    },
  };
}

/**
 * Returns the raw markdown for a bundled note, given the topic's directory
 * name (equal to the topic id in bundled content) and the note's file stem.
 */
export function getNoteMarkdown(
  topicDir: string,
  stem: string,
): string | undefined {
  return notesByDir.get(topicDir)?.get(stem);
}

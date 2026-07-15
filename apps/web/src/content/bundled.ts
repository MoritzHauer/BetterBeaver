import { validateContent } from "@betterbeaver/schema";
import type { Content } from "@betterbeaver/schema";
import { ContentValidationError, symmetricLinks } from "@betterbeaver/engine";
import type {
  ContentSource,
  DomainContent,
  DomainSummary,
  TopicSummary,
} from "@betterbeaver/engine";

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
// Extension lists only (`.wav`/`.svg` for now) — real content later adds
// more (png/jpg/opus/…) additively; see plan 0002. Any new extension must
// also be added to the PWA precache globPatterns in vite.config.ts, or the
// asset won't be available offline.
const audioFiles = import.meta.glob("../../../../content/*/assets/audio/*", {
  eager: true,
  import: "default",
});
const imageFiles = import.meta.glob("../../../../content/*/assets/img/*", {
  eager: true,
  import: "default",
});

// Lexicon globs (plan 0006): `content/lexicon/<domainId>/...`, a sibling
// layout to the topic dirs above, not itself a topic.
const domainFiles = import.meta.glob(
  "../../../../content/lexicon/*/domain.json",
  { eager: true, import: "default" },
);
const entryFiles = import.meta.glob(
  "../../../../content/lexicon/*/entries/*.json",
  { eager: true, import: "default" },
);
const familyFiles = import.meta.glob(
  "../../../../content/lexicon/*/families/*.json",
  { eager: true, import: "default" },
);
const lexiconAudioFiles = import.meta.glob(
  "../../../../content/lexicon/*/assets/audio/*",
  { eager: true, import: "default" },
);
const lexiconImageFiles = import.meta.glob(
  "../../../../content/lexicon/*/assets/img/*",
  { eager: true, import: "default" },
);

/** Extracts the topic directory name (the path segment after `content/`). */
function topicDirOf(path: string): string {
  const match = /\/content\/([^/]+)\//.exec(path);
  if (match === null || match[1] === undefined) {
    throw new Error(`unexpected content glob path: ${path}`);
  }
  return match[1];
}

/** Extracts the domain directory name (the path segment after `content/lexicon/`). */
function domainDirOf(path: string): string {
  const match = /\/content\/lexicon\/([^/]+)\//.exec(path);
  if (match === null || match[1] === undefined) {
    throw new Error(`unexpected lexicon glob path: ${path}`);
  }
  return match[1];
}

/** Extracts a file's basename without its extension. */
function stemOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

/** Groups glob entries by directory name (as extracted by `dirOf`), mapping each entry through `valueOf`. */
function groupByDir<V>(
  files: Record<string, unknown>,
  dirOf: (path: string) => string,
  valueOf: (path: string, value: unknown) => V,
): Map<string, V[]> {
  const byDir = new Map<string, V[]>();
  for (const [path, value] of Object.entries(files)) {
    const dir = dirOf(path);
    const list = byDir.get(dir) ?? [];
    list.push(valueOf(path, value));
    byDir.set(dir, list);
  }
  return byDir;
}

const groupByTopicDir = <V>(
  files: Record<string, unknown>,
  valueOf: (path: string, value: unknown) => V,
): Map<string, V[]> => groupByDir(files, topicDirOf, valueOf);

const groupByDomainDir = <V>(
  files: Record<string, unknown>,
  valueOf: (path: string, value: unknown) => V,
): Map<string, V[]> => groupByDir(files, domainDirOf, valueOf);

const identity = (_path: string, value: unknown): unknown => value;

/** Groups glob entries by directory into stem -> string maps (glob values
 * are raw strings for notes, URL strings for assets). The single source for
 * both stem lists (validation) and lookups (rendering). */
function stemMapByDir(
  files: Record<string, unknown>,
  dirOf: (path: string) => string,
): Map<string, Map<string, string>> {
  return new Map(
    [
      ...groupByDir(
        files,
        dirOf,
        (path, value) => [stemOf(path), value as string] as const,
      ),
    ].map(([dir, entries]) => [dir, new Map(entries)]),
  );
}

const topicsByDir = groupByTopicDir(topicFiles, identity);
const unitsByDir = groupByTopicDir(unitFiles, identity);
const itemsByDir = groupByTopicDir(itemFiles, identity);
const tasksByDir = groupByTopicDir(taskFiles, identity);
const resourcesByDir = groupByTopicDir(resourceFiles, identity);
const notesByDir = stemMapByDir(noteFiles, topicDirOf);
const audioUrlsByDir = stemMapByDir(audioFiles, topicDirOf);
const imageUrlsByDir = stemMapByDir(imageFiles, topicDirOf);

const domainsByDir = groupByDomainDir(domainFiles, identity);
const entriesByDir = groupByDomainDir(entryFiles, identity);
const familiesByDir = groupByDomainDir(familyFiles, identity);
const lexiconAudioUrlsByDir = stemMapByDir(lexiconAudioFiles, domainDirOf);
const lexiconImageUrlsByDir = stemMapByDir(lexiconImageFiles, domainDirOf);

// A topic's domain (for the `getAssetUrl` fallback, plan 0006's pinned asset
// resolution): read straight off the raw topic.json, so it's available even
// before `createBundledContentSource` validates anything. If content is
// malformed, validation fails startup before any screen calls `getAssetUrl`.
const domainIdByTopicId = new Map<string, string>(
  [...topicsByDir].map(([dir, values]) => [
    dir,
    typeof (values[0] as { domainId?: unknown }).domainId === "string"
      ? (values[0] as { domainId: string }).domainId
      : "",
  ]),
);

/** Reports ids occurring more than once in `ids` by pushing formatted messages into `errors`. */
function reportDuplicates(ids: string[], noun: string, errors: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  for (const id of duplicates) {
    errors.push(`${id}: duplicate ${noun} id across the bundle`);
  }
}

/**
 * Creates a `ContentSource` backed by content bundled into the app at build
 * time (`content/<topicId>/...` plus `content/lexicon/<domainId>/...`,
 * loaded via `import.meta.glob`). Validates every topic (together with its
 * domain) synchronously at construction time; throws
 * `ContentValidationError` on any failure so the app can show a startup
 * error screen instead of serving broken content.
 */
export function createBundledContentSource(): ContentSource {
  const contentByTopicId = new Map<string, Content>();
  const domainContentById = new Map<string, DomainContent>();
  const allErrors: string[] = [];

  for (const [dir, topicFileValues] of topicsByDir) {
    // Each topic directory has exactly one topic.json; the glob still
    // yields an array, so take its single entry.
    const topic = topicFileValues[0];
    const domainId = domainIdByTopicId.get(dir) ?? "";
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
      audioStems: [...(audioUrlsByDir.get(dir)?.keys() ?? [])],
      imageStems: [...(imageUrlsByDir.get(dir)?.keys() ?? [])],
      domain: (domainsByDir.get(domainId) ?? [])[0],
      entries: entriesByDir.get(domainId) ?? [],
      families: familiesByDir.get(domainId) ?? [],
      lexiconAudioStems: [
        ...(lexiconAudioUrlsByDir.get(domainId)?.keys() ?? []),
      ],
      lexiconImageStems: [
        ...(lexiconImageUrlsByDir.get(domainId)?.keys() ?? []),
      ],
    });
    if ("errors" in result) {
      allErrors.push(...result.errors.map((error) => `${dir}: ${error}`));
      continue;
    }
    // Note/asset lookups are keyed by directory name but called with the
    // topic id (getNoteMarkdown/getAssetUrl), so the two must coincide.
    if (result.content.topic.id !== dir) {
      allErrors.push(
        `${dir}: topic id "${result.content.topic.id}" must equal its directory name`,
      );
      continue;
    }
    contentByTopicId.set(result.content.topic.id, result.content);
    if (!domainContentById.has(result.domain.id)) {
      domainContentById.set(result.domain.id, {
        domain: result.domain,
        entries: result.entries,
        families: result.families,
        linksByEntryId: symmetricLinks(result.entries),
      });
    }
  }

  // Cross-domain checks (plan 0006): duplicate domain codes, and any item id
  // (topic-owned or entry) appearing twice across the whole bundle — every
  // `bb.item.<id>` key must be globally unambiguous.
  reportDuplicates(
    [...domainContentById.values()].map((d) => d.domain.code),
    "domain code",
    allErrors,
  );
  const entryIdsByDomain = new Map(
    [...domainContentById.values()].map((d) => [
      d.domain.id,
      new Set(d.entries.map((e) => e.id)),
    ]),
  );
  const allItemIds = [
    ...[...contentByTopicId].flatMap(([topicId, content]) => {
      const entryIds =
        entryIdsByDomain.get(domainIdByTopicId.get(topicId) ?? "") ??
        new Set<string>();
      return content.items
        .map((item) => item.id)
        .filter((id) => !entryIds.has(id));
    }),
    ...[...entryIdsByDomain.values()].flatMap((ids) => [...ids]),
  ];
  reportDuplicates(allItemIds, "item", allErrors);

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
          domainId: content.topic.domainId,
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
    listDomains(): Promise<DomainSummary[]> {
      return Promise.resolve(
        [...domainContentById.values()].map(({ domain }) => ({
          id: domain.id,
          title: domain.title,
          kind: domain.kind,
        })),
      );
    },
    loadDomain(id: string): Promise<DomainContent> {
      const domainContent = domainContentById.get(id);
      if (domainContent === undefined) {
        return Promise.reject(
          new ContentValidationError([`unknown domain: ${id}`]),
        );
      }
      return Promise.resolve(domainContent);
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

/**
 * Returns the URL for a bundled topic asset, given the topic's directory
 * name (equal to the topic id in bundled content), its kind, and the
 * asset's file stem. Domain-aware (plan 0006's pinned asset resolution):
 * tries the topic's own asset dir first, then falls back to its domain's
 * lexicon asset dir (where lexicon entries' assets now live).
 * `undefined` if no such asset was bundled either place.
 */
export function getAssetUrl(
  topicDir: string,
  kind: "audio" | "img",
  stem: string,
): string | undefined {
  const byDir = kind === "audio" ? audioUrlsByDir : imageUrlsByDir;
  const direct = byDir.get(topicDir)?.get(stem);
  if (direct !== undefined) {
    return direct;
  }
  const domainId = domainIdByTopicId.get(topicDir);
  return domainId !== undefined
    ? getLexiconAssetUrl(domainId, kind, stem)
    : undefined;
}

/**
 * Returns the URL for a bundled lexicon asset, given the domain id, its
 * kind, and the asset's file stem (plan 0006). Used by domain-level screens
 * (Vocabulary, entry popup, domain review) that have no topic in hand.
 */
export function getLexiconAssetUrl(
  domainId: string,
  kind: "audio" | "img",
  stem: string,
): string | undefined {
  const byDir =
    kind === "audio" ? lexiconAudioUrlsByDir : lexiconImageUrlsByDir;
  return byDir.get(domainId)?.get(stem);
}

/**
 * Every bundled topic's id and its domain id, read straight off the raw
 * topic.json (like `domainIdByTopicId`) so it's available before
 * `createBundledContentSource` validates anything. Feeds the startup
 * localStorage migrations (plan 0006), which must run before any screen
 * reads `bb.vocablists.<domainId>`.
 */
export function bundledTopicDomainIds(): {
  topicId: string;
  domainId: string;
}[] {
  return [...domainIdByTopicId].map(([topicId, domainId]) => ({
    topicId,
    domainId,
  }));
}

/** Every bundled domain's directory name (== its id by convention). Feeds the startup streak migration's fan-out (plan 0006). */
export function bundledDomainIds(): string[] {
  return [...domainsByDir.keys()];
}

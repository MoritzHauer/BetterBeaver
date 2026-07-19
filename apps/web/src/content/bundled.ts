import type { DomainDocument, TopicDocument } from "@betterbeaver/schema";
import type { AssetStems } from "@betterbeaver/engine";

// Eager globs so every bundled topic is statically included and available
// synchronously (no network fetch, no async import) — this is what makes
// the app work offline after first load. Since plan 0012 this tree is the
// frozen first-run seed (refreshed by scripts/export-content.ts, never
// hand-edited); the live content lives in the backend.
const topicFiles = import.meta.glob("../../../../content/*/topic.json", {
  eager: true,
  import: "default",
});
const lessonFiles = import.meta.glob("../../../../content/*/lessons/*.json", {
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
// asset won't be available offline. Assets are NOT part of the content
// documents (plan 0012 §2): they stay bundled and frozen until the asset
// pipeline lands, so these maps are the asset truth for remote content too.
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
const lessonsByDir = groupByTopicDir(lessonFiles, identity);
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
// before the content source validates anything. If content is malformed,
// validation fails startup before any screen calls `getAssetUrl`.
const domainIdByTopicId = new Map<string, string>(
  [...topicsByDir].map(([dir, values]) => [
    dir,
    typeof (values[0] as { domainId?: unknown }).domainId === "string"
      ? (values[0] as { domainId: string }).domainId
      : "",
  ]),
);

/**
 * The bundled content assembled as content documents (plan 0012): the
 * frozen first-run seed, in exactly the shape the backend stores and the
 * IndexedDB cache holds. Validation happens in
 * `createDocumentContentSource`, never here.
 */
export function bundledTopicDocuments(): Map<string, TopicDocument> {
  return new Map(
    [...topicsByDir].map(([dir, topicFileValues]) => [
      dir,
      {
        // Each topic directory has exactly one topic.json; the glob still
        // yields an array, so take its single entry.
        topic: topicFileValues[0],
        lessons: lessonsByDir.get(dir) ?? [],
        units: unitsByDir.get(dir) ?? [],
        items: itemsByDir.get(dir) ?? [],
        tasks: tasksByDir.get(dir) ?? [],
        // resources.json's default export is itself the array of resources,
        // so the grouped glob value is one level too deep — flatten it.
        resources: (resourcesByDir.get(dir) ?? []).flat(),
        notes: [...(notesByDir.get(dir) ?? new Map<string, string>())].map(
          ([stem, markdown]) => ({ stem, markdown }),
        ),
      },
    ]),
  );
}

export function bundledDomainDocuments(): Map<string, DomainDocument> {
  return new Map(
    [...domainsByDir].map(([dir, domainFileValues]) => [
      dir,
      {
        domain: domainFileValues[0],
        entries: entriesByDir.get(dir) ?? [],
        families: familiesByDir.get(dir) ?? [],
      },
    ]),
  );
}

/** Asset stem inventories for validation — always bundled (plan 0012 §2). */
export function bundledAssetStems(): AssetStems {
  const stems = (byDir: Map<string, Map<string, string>>) =>
    new Map([...byDir].map(([dir, urls]) => [dir, [...urls.keys()]]));
  return {
    audioByTopic: stems(audioUrlsByDir),
    imageByTopic: stems(imageUrlsByDir),
    audioByDomain: stems(lexiconAudioUrlsByDir),
    imageByDomain: stems(lexiconImageUrlsByDir),
  };
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
 * topic.json so it's available before any validation. Feeds the startup
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

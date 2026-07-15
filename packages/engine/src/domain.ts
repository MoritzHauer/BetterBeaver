import type { Domain, Family, Item, LinkType } from "@betterbeaver/schema";

/** One resolved link, as consumed by `buildAdhocSession`'s `resolvedLinks` and future link-chip UI (plan 0006). */
export interface ResolvedLink {
  type: LinkType;
  entryId: string;
}

/**
 * A domain's loaded content: metadata, its merged entry pool (shipped only
 * in step 1; user entries merge in later steps), its families, and the
 * symmetric closure of every entry's `links` keyed by entry id.
 */
export interface DomainContent {
  domain: Domain;
  entries: Item[];
  families: Family[];
  linksByEntryId: Map<string, ResolvedLink[]>;
}

/**
 * Computes the symmetric closure of every entry's `links` (plan 0006,
 * pinned): a link authored on entry A -> B contributes both A's authored
 * forward link and B's derived reverse link, keyed by entry id. Pure and
 * I/O-free so `ContentSource` implementations (e.g. `apps/web`'s bundled
 * source) can call it directly at load.
 */
export function symmetricLinks(entries: Item[]): Map<string, ResolvedLink[]> {
  const byEntryId = new Map<string, ResolvedLink[]>();
  const add = (id: string, link: ResolvedLink): void => {
    const list = byEntryId.get(id) ?? [];
    list.push(link);
    byEntryId.set(id, list);
  };
  for (const entry of entries) {
    if (entry.kind !== "lexeme" && entry.kind !== "concept") {
      continue;
    }
    for (const link of entry.payload.links ?? []) {
      add(entry.id, { type: link.type, entryId: link.entryId });
      add(link.entryId, { type: link.type, entryId: entry.id });
    }
  }
  return byEntryId;
}

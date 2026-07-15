import type { DomainContent } from "@betterbeaver/engine";
import type { ResolvedItemLink } from "@betterbeaver/engine";
import type { Item } from "@betterbeaver/schema";

/** An entry's displayable script/term, or undefined (only possible if a link
 * target resolves to something with neither, which can't currently happen —
 * link resolution stays best-effort and just drops it). */
function displayScript(entry: Item): string | undefined {
  return entry.kind === "lexeme"
    ? entry.payload.script
    : entry.kind === "concept"
      ? entry.payload.term
      : undefined;
}

/**
 * Resolves every entry's links (plan 0006's symmetric closure,
 * `domainContent.linksByEntryId`) to `{ type, script }`, keyed by entry id —
 * the shared input for `buildAdhocSession`'s `resolvedLinks` parameter (the
 * "also: ..." recall line), re-based from the deleted `payload.synonyms`
 * field. A link target with no displayable script (i.e. a `concept` entry
 * with no `term`, which can't happen, or a link resolving to nothing) is
 * dropped rather than thrown on — link resolution is best-effort by design
 * (plan 0006). This also covers a dangling link (target entry id absent from
 * the merged pool, e.g. a deleted user entry): it's silently dropped here,
 * never surfaced as a broken chip.
 */
export function resolvedLinksByEntryId(
  domainContent: DomainContent,
): Map<string, ResolvedItemLink[]> {
  const entryById = new Map(domainContent.entries.map((e) => [e.id, e]));
  const result = new Map<string, ResolvedItemLink[]>();
  for (const [entryId, links] of domainContent.linksByEntryId) {
    const resolved = links.flatMap((link): ResolvedItemLink[] => {
      const target = entryById.get(link.entryId);
      if (target === undefined) {
        return [];
      }
      const script = displayScript(target);
      return script !== undefined ? [{ type: link.type, script }] : [];
    });
    if (resolved.length > 0) {
      result.set(entryId, resolved);
    }
  }
  return result;
}

/** A `synonym`-type link's target, resolved for display + navigation: the
 * target entry's id (so the Vocabulary screen can open that exact entry's
 * popup, rather than re-resolving its script as a lookup token — which risks
 * a homograph tie-break picking the wrong entry) and its script. */
export interface SynonymLink {
  entryId: string;
  script: string;
}

/** Just the `synonym`-type links of the domain's link closure, resolved to
 * `{entryId, script}` pairs, for the Vocabulary screen's chips/search (both
 * re-based from the deleted `payload.synonyms` field). Dangling targets are
 * dropped the same way `resolvedLinksByEntryId` drops them. */
export function synonymScriptsByEntryId(
  domainContent: DomainContent,
): Map<string, SynonymLink[]> {
  const entryById = new Map(domainContent.entries.map((e) => [e.id, e]));
  const result = new Map<string, SynonymLink[]>();
  for (const [entryId, links] of domainContent.linksByEntryId) {
    const resolved = links.flatMap((link): SynonymLink[] => {
      if (link.type !== "synonym") {
        return [];
      }
      const target = entryById.get(link.entryId);
      const script = target !== undefined ? displayScript(target) : undefined;
      return script !== undefined ? [{ entryId: link.entryId, script }] : [];
    });
    if (resolved.length > 0) {
      result.set(entryId, resolved);
    }
  }
  return result;
}

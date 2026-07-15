import type { VocabList } from "@betterbeaver/engine";
import { readJson } from "./local-storage";

const VOCABLISTS_PREFIX = "bb.vocablists.";
const LEGACY_STREAK_KEY = "bb.streak";
const STREAK_PREFIX = "bb.streak.";

/** Union-by-list-id merge: `existing` wins on a colliding list id (list ids
 * are `crypto.randomUUID()`s, so a real collision never happens in practice —
 * this only decides a tie-break, never loses a list wholesale). */
function mergeVocabLists(
  existing: VocabList[],
  legacy: VocabList[],
): VocabList[] {
  const byId = new Map(existing.map((list) => [list.id, list]));
  for (const list of legacy) {
    if (!byId.has(list.id)) {
      byId.set(list.id, list);
    }
  }
  return [...byId.values()];
}

/**
 * `bb.vocablists.<topicId>` -> `bb.vocablists.<topic's domainId>` (plan
 * 0006, pinned rule): presence-based and self-erasing — a legacy key that
 * exists is transformed, written to the new key, and deleted; an absent one
 * is left alone. Identity no-op when `topicId === domainId` (the demo topic
 * and domain share the id "demo" — transform-then-delete would otherwise
 * destroy the key it just wrote). If the target key already has content,
 * the legacy lists are merged into it rather than overwriting.
 */
function migrateVocabLists(
  topicDomainIds: { topicId: string; domainId: string }[],
): void {
  for (const { topicId, domainId } of topicDomainIds) {
    if (topicId === domainId) {
      continue;
    }
    const legacyKey = `${VOCABLISTS_PREFIX}${topicId}`;
    const legacy = readJson<VocabList[]>(legacyKey);
    if (legacy === null) {
      continue;
    }
    const targetKey = `${VOCABLISTS_PREFIX}${domainId}`;
    const existing = readJson<VocabList[]>(targetKey) ?? [];
    const merged =
      existing.length > 0 ? mergeVocabLists(existing, legacy) : legacy;
    localStorage.setItem(targetKey, JSON.stringify(merged));
    localStorage.removeItem(legacyKey);
  }
}

/**
 * `bb.streak` (old singular key) -> `bb.streak.<domainId>` for every bundled
 * domain (plan 0006, pinned rule): the streak records "you showed up", so
 * every domain inheriting it is harmless, losing it is not. Presence-based
 * and self-erasing, same as `migrateVocabLists`.
 */
function migrateStreak(bundledDomainIds: string[]): void {
  const legacy = localStorage.getItem(LEGACY_STREAK_KEY);
  if (legacy === null) {
    return;
  }
  for (const domainId of bundledDomainIds) {
    localStorage.setItem(`${STREAK_PREFIX}${domainId}`, legacy);
  }
  localStorage.removeItem(LEGACY_STREAK_KEY);
}

/**
 * Runs every startup localStorage migration (plan 0006). Call once, before
 * any screen reads `bb.vocablists.<domainId>` or `bb.streak.<domainId>` —
 * idempotent and safe to call on every launch (a completed migration leaves
 * no legacy key behind, so re-running is a no-op).
 */
export function runStorageMigrations(
  topicDomainIds: { topicId: string; domainId: string }[],
  bundledDomainIds: string[],
): void {
  migrateVocabLists(topicDomainIds);
  migrateStreak(bundledDomainIds);
}

import { readJson } from "./local-storage";

const PINNED_PREFIX = "bb.pinned.";

/**
 * Reads the pinned scheduling-unit id set for `domainId`: units pinned here
 * surface first in that domain's review queue (`dueDomainUnits`'s
 * `pinnedUnitIds` parameter), ordering only.
 *
 * Note: ids stored under the old task-id pinning scheme (pre this fix)
 * become inert once read here — a stale task id matches no scheduling-unit
 * id, and pinning is ordering-only (see `reviewQueue`'s doc comment), so
 * this is a harmless soft reset, not something that needs a migration.
 */
export function getPinnedUnitIds(domainId: string): Set<string> {
  return new Set(readJson<string[]>(`${PINNED_PREFIX}${domainId}`) ?? []);
}

/** Toggles `unitIds` pinned together for `domainId` (a matching question's
 * several ids, or one id for every other kind), persisting the result.
 * "Pinned" means every id in `unitIds` is present; toggling removes all of
 * them if already all pinned, otherwise adds all of them. */
export function togglePinnedUnits(domainId: string, unitIds: string[]): void {
  const ids = getPinnedUnitIds(domainId);
  const allPinned = unitIds.length > 0 && unitIds.every((id) => ids.has(id));
  for (const id of unitIds) {
    if (allPinned) ids.delete(id);
    else ids.add(id);
  }
  localStorage.setItem(`${PINNED_PREFIX}${domainId}`, JSON.stringify([...ids]));
}

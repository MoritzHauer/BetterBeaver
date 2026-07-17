import { readJson } from "./local-storage";

const PINNED_PREFIX = "bb.pinned.";

/**
 * Reads the pinned task-id set for `domainId` (plan 0008): tasks pinned here
 * surface their scheduling units first in that domain's review queue
 * (`dueDomainUnits`'s `pinnedTaskIds` parameter), ordering only.
 */
export function getPinnedTaskIds(domainId: string): Set<string> {
  return new Set(readJson<string[]>(`${PINNED_PREFIX}${domainId}`) ?? []);
}

/** Toggles `taskId`'s pinned state for `domainId`, persisting the result. */
export function togglePinnedTask(domainId: string, taskId: string): void {
  const ids = getPinnedTaskIds(domainId);
  if (ids.has(taskId)) {
    ids.delete(taskId);
  } else {
    ids.add(taskId);
  }
  localStorage.setItem(`${PINNED_PREFIX}${domainId}`, JSON.stringify([...ids]));
}

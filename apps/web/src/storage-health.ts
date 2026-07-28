import { useSyncExternalStore } from "react";

/**
 * One module-level flag for "a `localStorage` write actually failed" (spec
 * 0019 §2). Write paths report into it from wherever they are — `myBooks.ts`
 * runs during `initContentSource()`, before React mounts, and `SessionScreen`
 * grades from six components deep — so a prop or a context would not reach
 * both. `useSyncExternalStore` reads the flag on first render, which is what
 * makes a boot-time failure visible at all.
 *
 * Write-once by design: the condition (storage full, or blocked outright)
 * does not heal mid-session, so there is no reset and the notice is not
 * dismissible.
 */
let unwritable = false;
const listeners = new Set<() => void>();

/** Called from a write path's catch — idempotent, safe during module init. */
export function noteStorageUnwritable(): void {
  if (unwritable) {
    return;
  }
  unwritable = true;
  for (const listener of listeners) {
    listener();
  }
}

/** Non-React read, for callers outside a component (and for tests). */
export function isStorageUnwritable(): boolean {
  return unwritable;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Re-renders once, when the first write failure is reported. */
export function useStorageUnwritable(): boolean {
  return useSyncExternalStore(subscribe, isStorageUnwritable);
}

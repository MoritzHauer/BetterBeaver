import { type DiffStatus, anyChanged } from "@betterbeaver/engine";
import type { EditSessionValue } from "./EditSessionContext";

/**
 * What a screen needs to render the diff (spec 0021-9 §3), or `null` in
 * every other view. The same shape as `unitEditOps` and friends: resolved
 * during render off the session, holding no state, so a screen asks once and
 * every branch below reads `diff === null ? … : …`.
 */
export interface DiffView {
  status: (id: string) => DiffStatus;
  /** The tint class for a row, or `undefined` when nothing changed. */
  className: (id: string) => string | undefined;
  /** The base-side entity for a `changed` id — the old row that renders
   * directly above the new one. `undefined` for anything else, including
   * `removed`, whose only row *is* the base one (it is in the union). */
  changedFrom: <T>(id: string) => T | undefined;
}

export function diffView(session: EditSessionValue | null): DiffView | null {
  if (session === null || session.view !== "diff" || session.diff === null) {
    return null;
  }
  const { status, before } = session.diff;
  const of = (id: string) => status.get(id) ?? "unchanged";
  return {
    status: of,
    className: (id) => {
      switch (of(id)) {
        case "added":
          return "diff-new";
        case "removed":
          return "diff-old";
        // A `changed` row is the *new* half of an old/new pair; its partner
        // carries `.diff-old` and is rendered from `changedFrom`.
        case "changed":
          return "diff-new";
        case "unchanged":
          return undefined;
      }
    },
    changedFrom: <T>(id: string) =>
      of(id) === "changed" ? (before.get(id) as T) : undefined,
  };
}

/**
 * Which ids a screen answers for, so the Diff tab appears only where there
 * is something to see (§3a). Deliberately narrow: a lesson whose *title*
 * changed is the Lesson screen's business, not the Book's — which is
 * exactly why What-changed cannot live behind this tab.
 */
export function bookScopeChanged(session: EditSessionValue): boolean {
  // The Book's own fields *and* `lessonIds` both live on `topic`, so adding
  // or reordering a lesson lights the tab and renaming one does not.
  return session.diff !== null && anyChanged(session.diff.status, ["topic"]);
}

export function lessonScopeChanged(
  session: EditSessionValue,
  lessonId: string,
): boolean {
  return session.diff !== null && anyChanged(session.diff.status, [lessonId]);
}

export function unitScopeChanged(
  session: EditSessionValue,
  unitId: string,
): boolean {
  if (session.diff === null) {
    return false;
  }
  // The union unit, not the draft's: a unit whose only change is a deleted
  // item has a draft `itemIds` that no longer mentions it.
  const unit = session.diff.content.units.find((u) => u.id === unitId);
  if (unit === undefined) {
    return anyChanged(session.diff.status, [unitId]);
  }
  const noteById = new Map(session.diff.content.notes.map((n) => [n.id, n]));
  return anyChanged(session.diff.status, [
    unitId,
    ...unit.itemIds,
    ...unit.taskIds,
    // Notes are keyed by stem, never by the derived `<code>-note-<stem>` id.
    ...unit.noteIds.map((id) => noteById.get(id)?.stem),
  ]);
}

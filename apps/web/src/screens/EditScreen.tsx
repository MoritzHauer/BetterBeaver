import { MaintainEditScreen } from "./edit/MaintainEditScreen";
import { ProposeEditScreen } from "./edit/ProposeEditScreen";
import { PrivateEditScreen } from "./edit/PrivateEditScreen";
import type { EditTarget } from "./edit/types";

export type { EditTarget };

/**
 * Form-based document editor (plan 0012 §7, the "common 80%"): book
 * structure (lessons/units/items/tasks/notes) and domain lexicons, editing
 * the raw draft document. Entities are loosely typed on purpose — a draft
 * mid-edit may be invalid; zod + validateContent gate at publish, and their
 * per-rule messages render in the publish panel.
 *
 * The pieces live in `./edit/`: `types.ts` (view state + shared helpers),
 * `fields.tsx` (form primitives and the entity pickers), `BookEditor` /
 * `DomainEditor` (the pure, controlled forms every mode shares), and one
 * module per I/O shell plus `AssetsManager` / `ProposalReview`.
 */

/** Dispatches on `mode` (plan 0012 §5): a maintainer edits their own draft
 * through `documents`/publish; a non-maintainer edits a local-only working
 * copy and submits a proposal instead. Splitting into two components (both
 * sharing the `BookEditor`/`DomainEditor` forms) keeps the two very
 * different load/save/persist lifecycles from tangling inside one set of
 * conditional hooks. */
export function EditScreen({
  docId,
  target,
  mode = "maintain",
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  mode?: "maintain" | "propose" | "private";
  onBack: () => void;
}) {
  if (mode === "propose") {
    return <ProposeEditScreen docId={docId} target={target} onBack={onBack} />;
  }
  if (mode === "private") {
    return <PrivateEditScreen docId={docId} target={target} onBack={onBack} />;
  }
  return <MaintainEditScreen docId={docId} target={target} onBack={onBack} />;
}

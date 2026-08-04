import type { Item } from "@betterbeaver/schema";
import { Sheet } from "../../components/Sheet";
import { ExerciseCard, RowExtras } from "../UnitScreen";
import {
  EditSessionProvider,
  type EditSessionValue,
} from "./EditSessionContext";
import { ProblemMarker, unitEditOps, withPayload } from "./inPlace";
import type { EditTarget, Entity } from "./types";

/**
 * The question screen's `✎`, scoped (plan 0021 decision 13, spec 0021-11
 * §3): one sheet holding **only** the tapped item or exercise, over a
 * session that stays mounted — design.md:115. Before this it layered the
 * whole form editor over the session, which is the thing slice 11 deletes.
 *
 * A sheet rather than a screen, and that is what keeps the promise: `Sheet`
 * portals to `document.body`, so nothing in the session's element tree
 * moves and React has no reason to rebuild it. Being a modal `<dialog>`, it
 * inerts the background itself, so the session need not even be hidden —
 * the question you are fixing a typo in stays on screen behind it.
 *
 * Deliberately **not** rendered through the `EditSession` component. That
 * one carries the `[⋮]` menu, the panels and the edit bar — none of which
 * belong over a live session — and its propose-mode resume prompt takes over
 * the whole screen, which here would swallow the session behind it.
 */
export function SessionEditSheet({
  session,
  target,
  onClose,
}: {
  session: EditSessionValue;
  target: EditTarget;
  onClose: () => void;
}) {
  // `entryId` and `itemId` are the same thing to every surface below: which
  // document owns it is `unitEditOps`' business, not this component's.
  const entityId = target.taskId ?? target.itemId ?? target.entryId;
  const units = session.book.units as Entity[];
  const owner = units.find((unit) => {
    const ids =
      target.taskId !== undefined
        ? (unit.taskIds as unknown[])
        : (unit.itemIds as unknown[]);
    return Array.isArray(ids) && ids.includes(entityId);
  });
  const edit = owner === undefined ? null : unitEditOps(session, owner.id);

  return (
    <Sheet label="Edit this content" onDismiss={onClose}>
      <EditSessionProvider value={session}>
        <div className="sheet-prompt">
          {entityId === undefined || edit === null ? (
            // A question whose item no longer sits in any unit of this Book:
            // routine only mid-edit, and there is nothing scoped to show.
            <p className="status">
              This isn&rsquo;t part of this Book any more — edit it from the
              unit that holds it.
            </p>
          ) : (
            <SheetBody edit={edit} session={session} entityId={entityId} />
          )}
          <div className="sheet-actions">
            <button className="primary" onClick={onClose}>
              Back to the question
            </button>
          </div>
        </div>
      </EditSessionProvider>
    </Sheet>
  );
}

/** The kind's own fields. The row expand below carries everything shared
 * (source, asset refs, the example) — this is only what a row's own cells
 * show, which the Unit page lays out as table cells and a sheet cannot. */
const FIELDS: Record<
  string,
  { label: string; path: [string] | [string, string]; multiline?: boolean }[]
> = {
  lexeme: [
    { label: "Script", path: ["script"] },
    { label: "Transliteration", path: ["transliteration"] },
    { label: "Gloss", path: ["gloss"] },
  ],
  concept: [
    { label: "Term", path: ["term"] },
    { label: "Definition", path: ["definition"], multiline: true },
  ],
  sentence: [
    { label: "Text", path: ["text"], multiline: true },
    { label: "Translation", path: ["translation"], multiline: true },
  ],
  pair: [
    { label: "First", path: ["a", "script"] },
    { label: "Second", path: ["b", "script"] },
    { label: "Contrast", path: ["contrast"], multiline: true },
  ],
};

function SheetBody({
  edit,
  session,
  entityId,
}: {
  edit: NonNullable<ReturnType<typeof unitEditOps>>;
  session: EditSessionValue;
  entityId: string;
}) {
  const itemById = new Map(
    session.content.items.map((item) => [item.id, item]),
  );
  const item = itemById.get(entityId);

  if (edit.rawTask(entityId) !== undefined) {
    const unitItems = (edit.rawUnit.itemIds as unknown[] | undefined)
      ?.flatMap((id) =>
        typeof id === "string" ? (itemById.get(id) ?? []) : [],
      )
      .filter((candidate): candidate is Item => candidate !== undefined);
    return (
      <>
        <h2>Edit this exercise</h2>
        <ul className="card-list">
          {/* The same controls the Exercises page uses (§3), minus its
              delete: removing the exercise you are practising would leave
              the session running over something that no longer exists. */}
          <ExerciseCard
            taskId={entityId}
            edit={edit}
            itemById={itemById}
            unitItems={unitItems ?? []}
          />
        </ul>
      </>
    );
  }

  if (item === undefined) {
    // The Book's own slot settles before the lexicon's, so a word opens here
    // at least once before its entry exists — saying it is gone would be a
    // lie for exactly as long as the second fetch takes.
    return (
      <p className="status">
        {session.lexiconLoaded
          ? "This isn’t part of this Book any more."
          : "Loading…"}
      </p>
    );
  }

  if (!edit.canEditRow(entityId)) {
    return (
      <p className="status">
        These words come from somewhere else — you can use them, but not change
        them.
      </p>
    );
  }

  const raw = edit.raw(entityId) ?? { id: entityId };
  return (
    <>
      <h2>Edit this {item.kind === "lexeme" ? "word" : "card"}</h2>
      {(FIELDS[item.kind] ?? []).map((field) => (
        <div key={field.path.join(".")}>
          <label className="field">
            {field.label}
            {field.multiline === true ? (
              <textarea
                rows={2}
                value={edit.payloadValue(entityId, ...field.path)}
                onChange={(e) =>
                  edit.patchEntity(withPayload(raw, field.path, e.target.value))
                }
              />
            ) : (
              <input
                type="text"
                value={edit.payloadValue(entityId, ...field.path)}
                onChange={(e) =>
                  edit.patchEntity(withPayload(raw, field.path, e.target.value))
                }
              />
            )}
          </label>
          <ProblemMarker
            problems={edit.fieldProblems(
              entityId,
              `payload.${field.path.join(".")}`,
            )}
          />
        </div>
      ))}
      <RowExtras item={item} edit={edit} />
      <ProblemMarker problems={edit.entityProblems(entityId)} />
    </>
  );
}

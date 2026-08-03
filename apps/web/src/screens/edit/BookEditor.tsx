import { useState } from "react";
import {
  BOOK_ICONS,
  type BookDocument,
  TASK_TYPES,
} from "@betterbeaver/schema";
import {
  type BookCollection,
  removeEntity,
  removeNote,
  setNote,
  upsertEntity,
} from "@betterbeaver/engine";
import { NoteEditor, type NoteAsset } from "../../components/NoteEditor";
import { newEntityId } from "../../content/entity-ids";
import { noteTitle } from "../../content/noteTitle";
import { newPrivateId } from "../../content/private-ids";
import {
  type PickerFilter,
  type PickerOption,
  notePoolOptions,
  optionsFrom,
  unitPoolOptionsGroupedByLesson,
} from "../entityPicker";
import {
  AddEntityForm,
  EntityForm,
  EntityPicker,
  ITEM_FIELDS,
  f,
  fm,
} from "./fields";
import { type Entity, type View, byId } from "./types";

export function BookEditor({
  doc,
  view,
  setView,
  onChange,
  hideCoverArt,
  domainEntries = [],
  assets,
  onUploadAsset,
}: {
  doc: BookDocument;
  view: View;
  setView: (view: View) => void;
  onChange: (doc: BookDocument) => void;
  /** Private Books only (plan 0017 §3, open-questions resolution): the
   * cover-art convention writes into the app's *public* assets, which a
   * private Book can never reach, so the toggle is hidden rather than
   * offered as a control that could only ever silently fail. Additive and
   * unused by the maintainer/propose paths, which never pass it. */
  hideCoverArt?: boolean;
  /** The Book's domain lexicon entries (spec 0018 §3): the itemIds pickers'
   * merged pool is book items plus these (validate.ts:313's own merge
   * rule). Default `[]` degrades gracefully — an empty Vocabulary filter —
   * when a shell hasn't (or couldn't) fetch the domain doc. */
  domainEntries?: unknown[];
  /** Threaded straight through to `NoteEditor`'s `+ image` picker (spec
   * 0021-2 §2f) — passed as-is per mode: maintain and private each supply
   * their own asset list/uploader, propose supplies neither (undefined
   * degrades to `NoteEditor`'s own `assets = []` default, which disables
   * the picker with a reason). */
  assets?: NoteAsset[];
  onUploadAsset?: (file: File) => Promise<void>;
}) {
  const book = doc.topic as Entity;
  const bookCode = typeof book.code === "string" ? book.code : "";
  const upsert = (collection: BookCollection, entity: Entity) =>
    onChange(upsertEntity(doc, collection, entity));
  const bookItems = doc.items as Entity[];
  const lexiconEntries = domainEntries as Entity[];
  const bookItemIds = new Set(bookItems.map((i) => i.id));
  const lexiconIds = new Set(lexiconEntries.map((e) => e.id));
  const itemPool: PickerOption[] = [
    ...optionsFrom(bookItems, "book item"),
    ...optionsFrom(lexiconEntries, "lexicon entry"),
  ];
  /** Owned book items get an Edit button + hard-delete; a merely-referenced
   * lexicon entry doesn't (it's edited in its own domain) and is unlinked,
   * not deleted — the exact distinction the old itemIds `<ul>` drew. */
  const itemOnOpen = (id: string) =>
    bookItemIds.has(id)
      ? () => setView({ v: "item", backTo: view, id })
      : undefined;

  if (view.v === "item" || view.v === "task") {
    const collection = view.v === "item" ? "items" : "tasks";
    const entity = byId(doc[collection], view.id);
    if (entity === undefined) {
      return (
        <p className="error-text">
          unknown {view.v}: {view.id}
        </p>
      );
    }
    // The task's owning unit (spec 0018 §4): the unit whose taskIds
    // contains this task. An orphan task (legal) has none — "This unit"
    // is omitted and "All" is the default chip instead.
    const owningUnit =
      view.v === "task"
        ? (doc.units as Entity[]).find(
            (u) =>
              Array.isArray(u.taskIds) &&
              (u.taskIds as string[]).includes(view.id),
          )
        : undefined;
    const taskItemFilters: PickerFilter[] = [
      ...(owningUnit !== undefined
        ? [
            {
              key: "this-unit",
              label: "This unit",
              ids: new Set((owningUnit.itemIds as string[] | undefined) ?? []),
            },
          ]
        : []),
      { key: "book", label: "Book items", ids: bookItemIds },
      { key: "vocabulary", label: "Vocabulary", ids: lexiconIds },
      { key: "all", label: "All", ids: null },
    ];
    return (
      <section>
        <h2>
          {view.v} · {view.id}
        </h2>
        {view.v === "item" ? (
          <>
            <EntityForm
              entity={entity}
              specs={ITEM_FIELDS[String(entity.kind)] ?? []}
              onChange={(next) => upsert("items", next)}
            />
            <EntityPicker
              label="Source ref"
              freeTextWhenEmpty
              options={optionsFrom(doc.resources as Entity[])}
              selected={
                typeof entity.sourceRef === "string" && entity.sourceRef !== ""
                  ? [entity.sourceRef]
                  : []
              }
              onChange={(ids) =>
                upsert("items", { ...entity, sourceRef: ids[0] ?? "" })
              }
              multiple={false}
            />
          </>
        ) : (
          <>
            <label className="field">
              Type
              <select
                value={String(entity.type ?? "recognize")}
                onChange={(e) =>
                  upsert("tasks", { ...entity, type: e.target.value })
                }
              >
                {TASK_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <EntityForm
              entity={entity}
              specs={[f("Instructions", "instructions")]}
              onChange={(next) => upsert("tasks", next)}
            />
            <EntityPicker
              label="Item ids"
              options={itemPool}
              selected={
                Array.isArray(entity.itemIds)
                  ? (entity.itemIds as string[])
                  : []
              }
              onChange={(ids) => upsert("tasks", { ...entity, itemIds: ids })}
              onOpen={itemOnOpen}
              multiple
              ordered
              filters={taskItemFilters}
              defaultFilterKey={owningUnit !== undefined ? "this-unit" : "all"}
            />
          </>
        )}
        <button
          className="plain danger"
          onClick={() => {
            onChange(removeEntity(doc, collection, view.id));
            setView(view.backTo);
          }}
        >
          Delete this {view.v}
        </button>
      </section>
    );
  }

  if (view.v === "note") {
    const note = doc.notes.find((n) => n.stem === view.stem);
    if (note === undefined) {
      return <p className="error-text">unknown note: {view.stem}</p>;
    }
    return (
      <section>
        <h2>note · {noteTitle(note.markdown, note.stem)}</h2>
        <NoteEditor
          markdown={note.markdown}
          onChange={(markdown) => onChange(setNote(doc, note.stem, markdown))}
          assets={assets}
          onUploadAsset={onUploadAsset}
        />
        <button
          className="plain danger"
          onClick={() => {
            onChange(removeNote(doc, note.stem));
            setView(view.backTo);
          }}
        >
          Delete this note
        </button>
      </section>
    );
  }

  if (view.v === "unit") {
    const unit = byId(doc.units, view.unitId);
    if (unit === undefined) {
      return <p className="error-text">unknown unit: {view.unitId}</p>;
    }
    const itemIds = (unit.itemIds as string[] | undefined) ?? [];
    const taskIds = (unit.taskIds as string[] | undefined) ?? [];
    const noteIds = (unit.noteIds as string[] | undefined) ?? [];
    const setList = (field: string, ids: string[]) =>
      upsert("units", { ...unit, [field]: ids });
    // Lessons in `book.lessonIds` order (the same order the root view lists
    // them), units excluding this one — a unit unlocking/recalling itself
    // is already a known-invalid selection (validate.ts class (l)), so it's
    // simplest not to offer it.
    const orderedLessons = ((book.lessonIds as string[] | undefined) ?? [])
      .map((id) => byId(doc.lessons, id))
      .filter((l): l is Entity => l !== undefined);
    const otherUnits = (doc.units as Entity[]).filter((u) => u.id !== unit.id);
    const unitPool = unitPoolOptionsGroupedByLesson(orderedLessons, otherUnits);
    return (
      <section>
        <h2>unit · {unit.id}</h2>
        <EntityForm
          entity={unit}
          specs={[f("Title", "title"), fm("Goal", "goal")]}
          onChange={(next) => upsert("units", next)}
        />

        <EntityPicker
          label="Unlocks after unit"
          options={unitPool}
          selected={
            typeof unit.unlocksAfterUnitId === "string"
              ? [unit.unlocksAfterUnitId]
              : []
          }
          onChange={(ids) => {
            // A cleared single-select must delete the key, not set it to
            // `undefined` (mirrors `setPath`'s own "" -> delete rule in ./fields,
            // and the Cover-art checkbox below) — zod's `optional()` expects
            // the key absent, and an `undefined` value would also survive
            // in-memory while silently vanishing across a JSON round-trip
            // (localStorage/proposal/private-store), leaving the live doc
            // and its persisted copy disagree.
            const next = { ...unit };
            if (ids[0] === undefined) {
              delete next.unlocksAfterUnitId;
            } else {
              next.unlocksAfterUnitId = ids[0];
            }
            upsert("units", next);
          }}
          multiple={false}
          groupBy
        />
        <EntityPicker
          label="Recall units"
          options={unitPool}
          selected={(unit.recallUnitIds as string[] | undefined) ?? []}
          onChange={(ids) => setList("recallUnitIds", ids)}
          multiple
          groupBy
        />

        <h3>Items</h3>
        <EntityPicker
          label="Item ids"
          options={itemPool}
          selected={itemIds}
          onChange={(ids) => setList("itemIds", ids)}
          onRemove={(id) =>
            bookItemIds.has(id)
              ? onChange(removeEntity(doc, "items", id))
              : setList(
                  "itemIds",
                  itemIds.filter((x) => x !== id),
                )
          }
          removeLabel={(id) => (bookItemIds.has(id) ? "Delete" : "Unlink")}
          onOpen={itemOnOpen}
          multiple
          ordered
          filters={[
            { key: "book", label: "Book items", ids: bookItemIds },
            { key: "vocabulary", label: "Vocabulary", ids: lexiconIds },
          ]}
        />
        <NewItemForm
          makeId={() => newEntityId(bookCode)}
          onAdd={(id, kind) => {
            onChange(
              upsertEntity(
                {
                  ...doc,
                  units: (doc.units as Entity[]).map((u) =>
                    u.id === unit.id ? { ...u, itemIds: [...itemIds, id] } : u,
                  ),
                },
                "items",
                { id, kind, payload: {}, sourceRef: "" },
              ),
            );
            setView({ v: "item", backTo: view, id });
          }}
        />

        <h3>Tasks</h3>
        <EntityPicker
          label="Task ids"
          options={optionsFrom(doc.tasks as Entity[])}
          selected={taskIds}
          onChange={(ids) => setList("taskIds", ids)}
          onRemove={(id) => onChange(removeEntity(doc, "tasks", id))}
          onOpen={(id) => () => setView({ v: "task", backTo: view, id })}
          multiple
          ordered
        />
        <AddEntityForm
          label="New task"
          makeId={() => newEntityId(bookCode)}
          onAdd={(id) => {
            onChange(
              upsertEntity(
                {
                  ...doc,
                  units: (doc.units as Entity[]).map((u) =>
                    u.id === unit.id ? { ...u, taskIds: [...taskIds, id] } : u,
                  ),
                },
                "tasks",
                { id, type: "recognize", itemIds: [] },
              ),
            );
            setView({ v: "task", backTo: view, id });
          }}
        />

        <h3>Notes</h3>
        <EntityPicker
          label="Note ids"
          options={notePoolOptions(doc.notes, bookCode)}
          selected={noteIds}
          onChange={(ids) => setList("noteIds", ids)}
          onRemove={(id) => {
            const stem = id.startsWith(`${bookCode}-note-`)
              ? id.slice(`${bookCode}-note-`.length)
              : id;
            onChange(removeNote(doc, stem));
          }}
          onOpen={(id) => {
            const stem = id.startsWith(`${bookCode}-note-`)
              ? id.slice(`${bookCode}-note-`.length)
              : id;
            return () => setView({ v: "note", backTo: view, stem });
          }}
          multiple
          ordered
        />
        <AddEntityForm
          label="New note"
          makeId={() => newPrivateId()}
          onAdd={(stem) => {
            onChange(
              setNote(
                {
                  ...doc,
                  units: (doc.units as Entity[]).map((u) =>
                    u.id === unit.id
                      ? {
                          ...u,
                          noteIds: [...noteIds, `${bookCode}-note-${stem}`],
                        }
                      : u,
                  ),
                },
                stem,
                // Seed the heading a note is titled by. Without it a brand-new
                // note has no `# ` line, so every list would label it by its
                // stem — a UUID since spec 0018 generated ids.
                "# New note\n\n",
              ),
            );
            setView({ v: "note", backTo: view, stem });
          }}
        />
      </section>
    );
  }

  if (view.v === "lesson") {
    const lesson = byId(doc.lessons, view.lessonId);
    if (lesson === undefined) {
      return <p className="error-text">unknown lesson: {view.lessonId}</p>;
    }
    const unitIds = (lesson.unitIds as string[] | undefined) ?? [];
    return (
      <section>
        <h2>lesson · {lesson.id}</h2>
        <EntityForm
          entity={lesson}
          specs={[f("Title", "title"), fm("Goal", "goal")]}
          onChange={(next) => upsert("lessons", next)}
        />
        <h3>Units</h3>
        <EntityPicker
          label="Unit ids"
          options={optionsFrom(doc.units as Entity[])}
          selected={unitIds}
          onChange={(ids) => upsert("lessons", { ...lesson, unitIds: ids })}
          onRemove={(id) => onChange(removeEntity(doc, "units", id))}
          onOpen={(id) => () =>
            setView({ v: "unit", lessonId: lesson.id, unitId: id })
          }
          multiple
          ordered
        />
        <AddEntityForm
          label="New unit"
          makeId={() => newEntityId(bookCode)}
          onAdd={(id) => {
            onChange(
              upsertEntity(
                {
                  ...doc,
                  lessons: (doc.lessons as Entity[]).map((l) =>
                    l.id === lesson.id
                      ? { ...l, unitIds: [...unitIds, id] }
                      : l,
                  ),
                },
                "units",
                {
                  id,
                  lessonId: lesson.id,
                  title: "",
                  goal: "",
                  itemIds: [],
                  taskIds: [],
                  noteIds: [],
                },
              ),
            );
            setView({ v: "unit", lessonId: lesson.id, unitId: id });
          }}
        />
      </section>
    );
  }

  const lessonIds = (book.lessonIds as string[] | undefined) ?? [];
  return (
    <section>
      <EntityForm
        entity={book}
        specs={[
          f("Title", "title"),
          fm("Description", "description"),
          { label: "Icon", path: ["icon"], options: BOOK_ICONS },
        ]}
        onChange={(next) => onChange({ ...doc, topic: next })}
      />
      {hideCoverArt !== true && (
        <label className="field">
          Cover art
          <input
            type="checkbox"
            checked={book.hasCoverArt === true}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({ ...doc, topic: { ...book, hasCoverArt: true } });
                return;
              }
              const next = { ...book };
              delete next.hasCoverArt;
              onChange({ ...doc, topic: next });
            }}
          />
        </label>
      )}
      <h3>Lessons</h3>
      <EntityPicker
        label="Lesson ids"
        options={optionsFrom(doc.lessons as Entity[])}
        selected={lessonIds}
        onChange={(ids) =>
          onChange({ ...doc, topic: { ...book, lessonIds: ids } })
        }
        onRemove={(id) => onChange(removeEntity(doc, "lessons", id))}
        onOpen={(id) => () => setView({ v: "lesson", lessonId: id })}
        multiple
        ordered
      />
      <AddEntityForm
        label="New lesson"
        makeId={() => newEntityId(bookCode)}
        onAdd={(id) => {
          onChange(
            upsertEntity(
              {
                ...doc,
                topic: { ...book, lessonIds: [...lessonIds, id] },
              },
              "lessons",
              {
                id,
                topicId: book.id,
                title: "",
                goal: "",
                unitIds: [],
              },
            ),
          );
          setView({ v: "lesson", lessonId: id });
        }}
      />
    </section>
  );
}

export function NewItemForm({
  makeId,
  onAdd,
}: {
  makeId: () => string;
  onAdd: (id: string, kind: string) => void;
}) {
  const [kind, setKind] = useState("sentence");
  return (
    <form
      className="editor-add"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(makeId(), kind);
      }}
    >
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {/* Book-owned kinds only — lexemes live in the domain lexicon. */}
        <option value="sentence">sentence</option>
        <option value="concept">concept</option>
        <option value="pair">pair</option>
      </select>
      <button type="submit">New item</button>
    </form>
  );
}

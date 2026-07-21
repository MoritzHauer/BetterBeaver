import { useEffect, useRef, useState } from "react";
import {
  BOOK_ICONS,
  CONTENT_SCHEMA_VERSION,
  TASK_TYPES,
  type DomainDocument,
  type BookDocument,
} from "@betterbeaver/schema";
import {
  moveId,
  removeDomainEntry,
  removeEntity,
  removeFamily,
  removeNote,
  setNote,
  upsertDomainEntry,
  upsertEntity,
  upsertFamily,
  type BookCollection,
} from "@betterbeaver/engine";
import {
  loadDocument,
  publishDocument,
  saveDraft,
  type AuthorDoc,
} from "../backend/supabase";
import { validateForPublish } from "../backend/publishCheck";
import { FeedbackPanel } from "../components/FeedbackPanel";

/**
 * Form-based document editor (plan 0012 §7, the "common 80%"): book
 * structure (lessons/units/items/tasks/notes) and domain lexicons, editing
 * the raw draft document. Entities are loosely typed on purpose — a draft
 * mid-edit may be invalid; zod + validateContent gate at publish, and their
 * per-rule messages render in the publish panel.
 */

type Entity = { id: string } & Record<string, unknown>;
type AnyDoc = BookDocument | DomainDocument;

// ---------------------------------------------------------------- fields

interface FieldSpec {
  label: string;
  path: string[];
  multiline?: boolean;
  hint?: string;
  /** Renders a native `<select>` over these options plus "(none)" instead of a text input/textarea. */
  options?: readonly string[];
}

const f = (label: string, ...path: string[]): FieldSpec => ({ label, path });
const fm = (label: string, ...path: string[]): FieldSpec => ({
  label,
  path,
  multiline: true,
});

const ITEM_FIELDS: Record<string, FieldSpec[]> = {
  sentence: [
    {
      label: "Text",
      path: ["payload", "text"],
      multiline: true,
      hint: "Cloze blanks: {{c1::word}}, {{c2::word}}, …",
    },
    fm("Translation", "payload", "translation"),
    f("Audio ref", "payload", "audioRef"),
    f("Source ref", "sourceRef"),
  ],
  concept: [
    f("Term", "payload", "term"),
    fm("Definition", "payload", "definition"),
    fm("Example", "payload", "example"),
    f("Source ref", "sourceRef"),
  ],
  lexeme: [
    f("Script", "payload", "script"),
    f("Transliteration", "payload", "transliteration"),
    f("Gloss", "payload", "gloss"),
    f("Example text", "payload", "example", "text"),
    f("Example translation", "payload", "example", "translation"),
    fm("Usage note", "payload", "usageNote"),
    f("Audio ref", "payload", "audioRef"),
    f("Source ref", "sourceRef"),
  ],
  pair: [
    f("A script", "payload", "a", "script"),
    f("A audio ref", "payload", "a", "audioRef"),
    f("B script", "payload", "b", "script"),
    f("B audio ref", "payload", "b", "audioRef"),
    fm("Contrast", "payload", "contrast"),
    f("Source ref", "sourceRef"),
  ],
};

function getPath(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

/** Immutable deep set; an empty string deletes the key (so zod `optional()` fields stay absent, not ""). */
function setPath(value: unknown, path: string[], next: string): unknown {
  const [head, ...rest] = path;
  if (head === undefined) {
    return next;
  }
  const obj =
    typeof value === "object" && value !== null
      ? { ...(value as Record<string, unknown>) }
      : {};
  if (rest.length === 0) {
    if (next === "") {
      delete obj[head];
    } else {
      obj[head] = next;
    }
    return obj;
  }
  obj[head] = setPath(obj[head], rest, next);
  return obj;
}

function Field({
  spec,
  entity,
  onChange,
}: {
  spec: FieldSpec;
  entity: Entity;
  onChange: (next: Entity) => void;
}) {
  const value = getPath(entity, spec.path);
  const set = (next: string) =>
    onChange(setPath(entity, spec.path, next) as Entity);
  return (
    <label className="field">
      {spec.label}
      {spec.options !== undefined ? (
        <select value={value} onChange={(e) => set(e.target.value)}>
          <option value="">(none)</option>
          {spec.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : spec.multiline ? (
        <textarea
          value={value}
          rows={3}
          onChange={(e) => set(e.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
      {spec.hint !== undefined && <span className="status">{spec.hint}</span>}
    </label>
  );
}

function EntityForm({
  entity,
  specs,
  onChange,
}: {
  entity: Entity;
  specs: FieldSpec[];
  onChange: (next: Entity) => void;
}) {
  return (
    <div className="editor-form">
      {specs.map((spec) => (
        <Field
          key={spec.path.join(".")}
          spec={spec}
          entity={entity}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

/** One id per line; unknown/invalid ids surface at publish, not here. */
function IdListField({
  label,
  ids,
  onChange,
}: {
  label: string;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <label className="field">
      {label}
      <textarea
        rows={Math.min(8, ids.length + 2)}
        value={ids.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          )
        }
      />
    </label>
  );
}

function AddEntityForm({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (id: string) => void;
}) {
  const [id, setId] = useState("");
  return (
    <form
      className="editor-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (id.trim() !== "") {
          onAdd(id.trim());
          setId("");
        }
      }}
    >
      <input
        type="text"
        placeholder="new-id-in-slug-form"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
      <button type="submit">{label}</button>
    </form>
  );
}

function RowActions({
  onUp,
  onDown,
  onOpen,
  onRemove,
  removeLabel = "Delete",
}: {
  onUp?: () => void;
  onDown?: () => void;
  onOpen?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="editor-row-actions">
      {onUp !== undefined && (
        <button className="plain" aria-label="Move up" onClick={onUp}>
          ↑
        </button>
      )}
      {onDown !== undefined && (
        <button className="plain" aria-label="Move down" onClick={onDown}>
          ↓
        </button>
      )}
      {onOpen !== undefined && (
        <button className="plain" onClick={onOpen}>
          Edit
        </button>
      )}
      {onRemove !== undefined && (
        <button className="plain danger" onClick={onRemove}>
          {removeLabel}
        </button>
      )}
    </span>
  );
}

// ------------------------------------------------------------ main screen

type View =
  | { v: "root" }
  | { v: "lesson"; lessonId: string }
  | { v: "unit"; lessonId: string; unitId: string }
  | { v: "item"; backTo: View; id: string }
  | { v: "task"; backTo: View; id: string }
  | { v: "note"; backTo: View; stem: string }
  | { v: "entry"; id: string }
  | { v: "family"; id: string };

/** Deep-link target from the learner screens' Edit buttons: the editor
 * opens directly at the matching level (book/lesson/unit/note). */
export interface EditTarget {
  lessonId?: string;
  unitId?: string;
  noteStem?: string;
}

function initialView(target: EditTarget | undefined): View {
  if (target?.lessonId !== undefined && target.unitId !== undefined) {
    const unitView: View = {
      v: "unit",
      lessonId: target.lessonId,
      unitId: target.unitId,
    };
    return target.noteStem !== undefined
      ? { v: "note", backTo: unitView, stem: target.noteStem }
      : unitView;
  }
  if (target?.lessonId !== undefined) {
    return { v: "lesson", lessonId: target.lessonId };
  }
  return { v: "root" };
}

/** Local-first draft storage (one key per document). The draft lives here
 * until the author explicitly syncs it from the root (book) view. */
const draftKey = (docId: string) => `bb.author.draft.${docId}`;

export function EditScreen({
  docId,
  target,
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  onBack: () => void;
}) {
  const [record, setRecord] = useState<AuthorDoc | null>(null);
  const [working, setWorking] = useState<AnyDoc | null>(null);
  const [view, setView] = useState<View>(() => initialView(target));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [publishState, setPublishState] = useState<
    | { s: "idle" }
    | { s: "checking" }
    | { s: "publishing" }
    | { s: "errors"; errors: string[] }
    | { s: "done" }
  >({ s: "idle" });
  const [syncState, setSyncState] = useState<
    "synced" | "unsynced" | "syncing" | "error"
  >("synced");
  const dirtyRef = useRef(false);
  const workingRef = useRef<AnyDoc | null>(null);
  workingRef.current = working;

  // Local-first (plan 0012 §7 amended): every edit lands in localStorage;
  // the backend sees it only through the explicit Sync/Publish actions on
  // the root (book) view. A pending debounced write must survive leaving
  // the editor or closing the tab, so flush it on both.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && workingRef.current !== null) {
        localStorage.setItem(
          draftKey(docId),
          JSON.stringify(workingRef.current),
        );
        dirtyRef.current = false;
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [docId]);

  useEffect(() => {
    loadDocument(docId).then(
      (doc) => {
        setRecord(doc);
        // A local draft always wins over the server copy: it is the
        // author's newest work, possibly written offline.
        const local = localStorage.getItem(draftKey(docId));
        if (local !== null) {
          try {
            setWorking(JSON.parse(local) as AnyDoc);
            setSyncState("unsynced");
            return;
          } catch {
            localStorage.removeItem(draftKey(docId));
          }
        }
        setWorking((doc.draft ?? doc.published) as AnyDoc | null);
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, [docId]);

  // Draft autosave to localStorage, debounced.
  useEffect(() => {
    if (!dirtyRef.current || working === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(docId), JSON.stringify(working));
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [working, docId]);

  async function handleSync() {
    if (workingRef.current === null) {
      return;
    }
    localStorage.setItem(draftKey(docId), JSON.stringify(workingRef.current));
    dirtyRef.current = false;
    setSyncState("syncing");
    try {
      await saveDraft(docId, workingRef.current);
      localStorage.removeItem(draftKey(docId));
      setSyncState("synced");
    } catch {
      setSyncState("error");
    }
  }

  if (loadError !== null) {
    return (
      <main>
        <p className="error-text">{loadError}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (record === null) {
    return <main>Loading…</main>;
  }
  const readOnly = record.schema_version > CONTENT_SCHEMA_VERSION;
  if (working === null) {
    return (
      <main>
        <p className="error-text">
          This document has no draft or published content to edit.
        </p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }

  const change = (next: AnyDoc) => {
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    setPublishState({ s: "idle" });
    setSyncState("unsynced");
    setWorking(next);
  };

  async function handlePublish() {
    if (working === null || record === null) {
      return;
    }
    setPublishState({ s: "checking" });
    const errors = await validateForPublish(docId, record.kind, working);
    if (errors.length > 0) {
      setPublishState({ s: "errors", errors });
      return;
    }
    setPublishState({ s: "publishing" });
    try {
      await publishDocument(
        docId,
        record.published_version,
        working,
        CONTENT_SCHEMA_VERSION,
      );
      const reloaded = await loadDocument(docId);
      setRecord(reloaded);
      setWorking((reloaded.draft ?? reloaded.published) as AnyDoc);
      dirtyRef.current = false;
      // Publishing pushed the local work to the server — the local copy is
      // no longer ahead of it.
      localStorage.removeItem(draftKey(docId));
      setSyncState("synced");
      setPublishState({ s: "done" });
    } catch (e) {
      setPublishState({
        s: "errors",
        errors: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  async function handleDiscardDraft() {
    if (record === null || record.published === null) {
      return;
    }
    await saveDraft(docId, null);
    dirtyRef.current = false;
    localStorage.removeItem(draftKey(docId));
    setSyncState("synced");
    setWorking(record.published as AnyDoc);
    setSaveState("saved");
  }

  const body =
    record.kind === "topic" ? (
      <BookEditor
        doc={working as BookDocument}
        view={view}
        setView={setView}
        onChange={change}
      />
    ) : (
      <DomainEditor
        doc={working as DomainDocument}
        view={view}
        setView={setView}
        onChange={change}
      />
    );

  return (
    <main className={readOnly ? "editor read-only" : "editor"}>
      <header className="screen-header">
        <button className="plain" onClick={onBack} title="Back to learning">
          ←
        </button>
        {view.v !== "root" && (
          <button
            className="plain"
            onClick={() => setView(upView(view))}
            title="Up one level"
          >
            ↑
          </button>
        )}
        <h1>{docId}</h1>
      </header>
      <p className="status">
        Version {record.published_version}
        {record.listed ? "" : " · not listed"} ·{" "}
        {readOnly
          ? "read-only: this document needs a newer app"
          : saveState === "saving"
            ? "saving…"
            : saveState === "error"
              ? "local save failed — storage may be full"
              : "saved on this device"}
      </p>
      {view.v === "root" && !readOnly && (
        <p className="status">
          {syncState === "synced"
            ? "in sync with the server"
            : syncState === "syncing"
              ? "syncing…"
              : syncState === "error"
                ? "sync failed — check your connection"
                : "local changes not on the server yet"}{" "}
          {syncState !== "synced" && (
            <button
              className="plain"
              disabled={syncState === "syncing"}
              onClick={() => void handleSync()}
            >
              Sync to server
            </button>
          )}
        </p>
      )}
      {view.v === "root" && <FeedbackPanel docId={docId} />}
      {body}
      <div className="editor-publish card">
        {publishState.s === "errors" && (
          <ul className="error-text">
            {publishState.errors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {publishState.errors.length > 20 && (
              <li>…and {publishState.errors.length - 20} more</li>
            )}
          </ul>
        )}
        {publishState.s === "done" && (
          <p className="status">Published — learners will be offered it.</p>
        )}
        <button
          className="primary"
          disabled={
            readOnly ||
            publishState.s === "checking" ||
            publishState.s === "publishing"
          }
          onClick={() => void handlePublish()}
        >
          {publishState.s === "checking"
            ? "Validating…"
            : publishState.s === "publishing"
              ? "Publishing…"
              : "Validate & publish"}
        </button>
        {record.published !== null && !readOnly && (
          <button
            className="plain danger"
            onClick={() => void handleDiscardDraft()}
          >
            Discard draft
          </button>
        )}
      </div>
    </main>
  );
}

function upView(view: View): View {
  switch (view.v) {
    case "lesson":
    case "entry":
    case "family":
      return { v: "root" };
    case "unit":
      return { v: "lesson", lessonId: view.lessonId };
    case "item":
    case "task":
    case "note":
      return view.backTo;
    case "root":
      return view;
  }
}

// ------------------------------------------------------------ book editor

function byId(list: unknown[], id: string): Entity | undefined {
  return (list as Entity[]).find((e) => e.id === id);
}

function BookEditor({
  doc,
  view,
  setView,
  onChange,
}: {
  doc: BookDocument;
  view: View;
  setView: (view: View) => void;
  onChange: (doc: BookDocument) => void;
}) {
  const book = doc.topic as Entity;
  const upsert = (collection: BookCollection, entity: Entity) =>
    onChange(upsertEntity(doc, collection, entity));

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
    return (
      <section>
        <h2>
          {view.v} · {view.id}
        </h2>
        {view.v === "item" ? (
          <EntityForm
            entity={entity}
            specs={ITEM_FIELDS[String(entity.kind)] ?? []}
            onChange={(next) => upsert("items", next)}
          />
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
            <IdListField
              label="Item ids (one per line)"
              ids={
                Array.isArray(entity.itemIds)
                  ? (entity.itemIds as string[])
                  : []
              }
              onChange={(ids) => upsert("tasks", { ...entity, itemIds: ids })}
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
        <h2>note · {note.stem}</h2>
        <label className="field">
          Markdown
          <textarea
            rows={14}
            value={note.markdown}
            onChange={(e) => onChange(setNote(doc, note.stem, e.target.value))}
          />
        </label>
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
    const bookCode = typeof book.code === "string" ? book.code : "";
    const setList = (field: string, ids: string[]) =>
      upsert("units", { ...unit, [field]: ids });
    return (
      <section>
        <h2>unit · {unit.id}</h2>
        <EntityForm
          entity={unit}
          specs={[f("Title", "title"), fm("Goal", "goal")]}
          onChange={(next) => upsert("units", next)}
        />

        <h3>Items</h3>
        <ul className="editor-list">
          {itemIds.map((id) => {
            const owned = byId(doc.items, id) !== undefined;
            return (
              <li key={id}>
                <span>
                  {id}
                  {owned ? "" : " · lexicon entry (edit in its domain)"}
                </span>
                <RowActions
                  onUp={() => setList("itemIds", moveId(itemIds, id, -1))}
                  onDown={() => setList("itemIds", moveId(itemIds, id, 1))}
                  onOpen={
                    owned
                      ? () => setView({ v: "item", backTo: view, id })
                      : undefined
                  }
                  onRemove={
                    owned
                      ? () => onChange(removeEntity(doc, "items", id))
                      : () =>
                          setList(
                            "itemIds",
                            itemIds.filter((x) => x !== id),
                          )
                  }
                  removeLabel={owned ? "Delete" : "Unlink"}
                />
              </li>
            );
          })}
        </ul>
        <AddEntityForm
          label="Link existing id"
          onAdd={(id) => setList("itemIds", [...itemIds, id])}
        />
        <NewItemForm
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
        <ul className="editor-list">
          {taskIds.map((id) => (
            <li key={id}>
              <span>
                {id} · {String(byId(doc.tasks, id)?.type ?? "?")}
              </span>
              <RowActions
                onUp={() => setList("taskIds", moveId(taskIds, id, -1))}
                onDown={() => setList("taskIds", moveId(taskIds, id, 1))}
                onOpen={() => setView({ v: "task", backTo: view, id })}
                onRemove={() => onChange(removeEntity(doc, "tasks", id))}
              />
            </li>
          ))}
        </ul>
        <AddEntityForm
          label="New task"
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
        <ul className="editor-list">
          {noteIds.map((noteId) => {
            const stem = noteId.startsWith(`${bookCode}-note-`)
              ? noteId.slice(`${bookCode}-note-`.length)
              : noteId;
            return (
              <li key={noteId}>
                <span>{stem}</span>
                <RowActions
                  onUp={() => setList("noteIds", moveId(noteIds, noteId, -1))}
                  onDown={() => setList("noteIds", moveId(noteIds, noteId, 1))}
                  onOpen={() => setView({ v: "note", backTo: view, stem })}
                  onRemove={() => onChange(removeNote(doc, stem))}
                />
              </li>
            );
          })}
        </ul>
        <AddEntityForm
          label="New note (stem)"
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
                "",
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
        <ul className="editor-list">
          {unitIds.map((id) => (
            <li key={id}>
              <span>
                {id} · {String(byId(doc.units, id)?.title ?? "?")}
              </span>
              <RowActions
                onUp={() =>
                  upsert("lessons", {
                    ...lesson,
                    unitIds: moveId(unitIds, id, -1),
                  })
                }
                onDown={() =>
                  upsert("lessons", {
                    ...lesson,
                    unitIds: moveId(unitIds, id, 1),
                  })
                }
                onOpen={() =>
                  setView({ v: "unit", lessonId: lesson.id, unitId: id })
                }
                onRemove={() => onChange(removeEntity(doc, "units", id))}
              />
            </li>
          ))}
        </ul>
        <AddEntityForm
          label="New unit"
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
      <h3>Lessons</h3>
      <ul className="editor-list">
        {lessonIds.map((id) => (
          <li key={id}>
            <span>
              {id} · {String(byId(doc.lessons, id)?.title ?? "?")}
            </span>
            <RowActions
              onUp={() =>
                onChange({
                  ...doc,
                  topic: { ...book, lessonIds: moveId(lessonIds, id, -1) },
                })
              }
              onDown={() =>
                onChange({
                  ...doc,
                  topic: { ...book, lessonIds: moveId(lessonIds, id, 1) },
                })
              }
              onOpen={() => setView({ v: "lesson", lessonId: id })}
              onRemove={() => onChange(removeEntity(doc, "lessons", id))}
            />
          </li>
        ))}
      </ul>
      <AddEntityForm
        label="New lesson"
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

function NewItemForm({ onAdd }: { onAdd: (id: string, kind: string) => void }) {
  const [id, setId] = useState("");
  const [kind, setKind] = useState("sentence");
  return (
    <form
      className="editor-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (id.trim() !== "") {
          onAdd(id.trim(), kind);
          setId("");
        }
      }}
    >
      <input
        type="text"
        placeholder="new-item-id"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
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

// ----------------------------------------------------------- domain editor

function DomainEditor({
  doc,
  view,
  setView,
  onChange,
}: {
  doc: DomainDocument;
  view: View;
  setView: (view: View) => void;
  onChange: (doc: DomainDocument) => void;
}) {
  const [filter, setFilter] = useState("");
  const domain = doc.domain as Entity;
  const entryKind = domain.kind === "general" ? "concept" : "lexeme";

  if (view.v === "entry") {
    const entry = byId(doc.entries, view.id);
    if (entry === undefined) {
      return <p className="error-text">unknown entry: {view.id}</p>;
    }
    return (
      <section>
        <h2>entry · {entry.id}</h2>
        <EntityForm
          entity={entry}
          specs={ITEM_FIELDS[String(entry.kind)] ?? []}
          onChange={(next) => onChange(upsertDomainEntry(doc, next))}
        />
        <button
          className="plain danger"
          onClick={() => {
            onChange(removeDomainEntry(doc, entry.id));
            setView({ v: "root" });
          }}
        >
          Delete this entry
        </button>
      </section>
    );
  }

  if (view.v === "family") {
    const family = byId(doc.families, view.id);
    if (family === undefined) {
      return <p className="error-text">unknown family: {view.id}</p>;
    }
    return (
      <section>
        <h2>family · {family.id}</h2>
        <EntityForm
          entity={family}
          specs={[f("Name", "name")]}
          onChange={(next) => onChange(upsertFamily(doc, next))}
        />
        <IdListField
          label="Entry ids (one per line)"
          ids={
            Array.isArray(family.entryIds) ? (family.entryIds as string[]) : []
          }
          onChange={(ids) =>
            onChange(upsertFamily(doc, { ...family, entryIds: ids }))
          }
        />
        <button
          className="plain danger"
          onClick={() => {
            onChange(removeFamily(doc, family.id));
            setView({ v: "root" });
          }}
        >
          Delete this family
        </button>
      </section>
    );
  }

  const entries = (doc.entries as Entity[]).filter(
    (entry) =>
      filter === "" ||
      entry.id.includes(filter) ||
      JSON.stringify(entry.payload ?? {})
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  return (
    <section>
      <EntityForm
        entity={domain}
        specs={[
          f("Title", "title"),
          f("Gloss language", "glossLanguage"),
          f("Read-aloud language (BCP-47)", "readAloudLang"),
        ]}
        onChange={(next) => onChange({ ...doc, domain: next })}
      />
      <h3>Entries ({doc.entries.length})</h3>
      <label className="field">
        Filter
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <ul className="editor-list">
        {entries.slice(0, 50).map((entry) => (
          <li key={entry.id}>
            <span>{entry.id}</span>
            <RowActions
              onOpen={() => setView({ v: "entry", id: entry.id })}
              onRemove={() => onChange(removeDomainEntry(doc, entry.id))}
            />
          </li>
        ))}
        {entries.length > 50 && (
          <li>…{entries.length - 50} more — filter to narrow</li>
        )}
      </ul>
      <AddEntityForm
        label="New entry"
        onAdd={(id) => {
          onChange(
            upsertDomainEntry(doc, {
              id,
              kind: entryKind,
              payload: {},
              sourceRef: "",
            }),
          );
          setView({ v: "entry", id });
        }}
      />
      <h3>Families</h3>
      <ul className="editor-list">
        {(doc.families as Entity[]).map((family) => (
          <li key={family.id}>
            <span>
              {family.id} · {String(family.name ?? "")}
            </span>
            <RowActions
              onOpen={() => setView({ v: "family", id: family.id })}
              onRemove={() => onChange(removeFamily(doc, family.id))}
            />
          </li>
        ))}
      </ul>
      <AddEntityForm
        label="New family"
        onAdd={(id) => {
          onChange(upsertFamily(doc, { id, name: "", entryIds: [] }));
          setView({ v: "family", id });
        }}
      />
    </section>
  );
}

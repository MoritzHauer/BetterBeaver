import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  BOOK_ICONS,
  CONTENT_SCHEMA_VERSION,
  TASK_TYPES,
  contentIdOf,
  documentId,
  type DomainDocument,
  type BookDocument,
} from "@betterbeaver/schema";
import {
  createDocumentContentSource,
  diffBookDocument,
  diffDomainDocument,
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
  type CollectionDiff,
} from "@betterbeaver/engine";
import {
  decideProposal,
  loadCatalogEntry,
  loadDocument,
  loadVersion,
  listOpenProposals,
  publishDocument,
  saveDraft,
  submitProposal,
  type AuthorDoc,
  type CatalogEntry,
  type Proposal,
} from "../backend/supabase";
import { validateForPublish } from "../backend/publishCheck";
import { FeedbackPanel } from "../components/FeedbackPanel";
import {
  readPrivateBook,
  readPrivateBooks,
  putPrivateBook,
} from "../content/private-store";
import {
  privateAssetStems,
  registerPrivateAssets,
} from "../content/private-assets";
import { newPrivateId } from "../content/private-ids";
import { noteTitle } from "../content/noteTitle";
import { newEntityId } from "../content/entity-ids";
import {
  visiblePickerRows,
  groupPickerRows,
  optionsFrom,
  notePoolOptions,
  unitPoolOptionsGroupedByLesson,
  type PickerOption,
  type PickerFilter,
} from "./entityPicker";

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

// `sourceRef` used to live here as a free-text FieldSpec; spec 0018 §3 moves
// it out to an `EntityPicker` rendered alongside `EntityForm` at each of
// this record's two call sites (item view, domain entry view) instead —
// `FieldSpec`/`Field` stay string-only, on purpose (§3).
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
  ],
  concept: [
    f("Term", "payload", "term"),
    fm("Definition", "payload", "definition"),
    fm("Example", "payload", "example"),
  ],
  lexeme: [
    f("Script", "payload", "script"),
    f("Transliteration", "payload", "transliteration"),
    f("Gloss", "payload", "gloss"),
    f("Example text", "payload", "example", "text"),
    f("Example translation", "payload", "example", "translation"),
    fm("Usage note", "payload", "usageNote"),
    f("Audio ref", "payload", "audioRef"),
  ],
  pair: [
    f("A script", "payload", "a", "script"),
    f("A audio ref", "payload", "a", "audioRef"),
    f("B script", "payload", "b", "script"),
    f("B audio ref", "payload", "b", "audioRef"),
    fm("Contrast", "payload", "contrast"),
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

/** Creates one new entity, id auto-generated (spec 0018 §1) — no more
 * hand-typed slugs. `makeId` lets each call site pick the right shape
 * (`${bookCode/domainCode}-${uuid}` for most entities, a bare uuid for a
 * note's stem — the call site already wraps that as
 * `${bookCode}-note-${stem}`), while `onAdd`'s signature stays the one
 * every call site already had. */
function AddEntityForm({
  label,
  makeId,
  onAdd,
}: {
  label: string;
  makeId: () => string;
  onAdd: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="editor-add"
      onClick={() => onAdd(makeId())}
    >
      {label}
    </button>
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
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_N.png`}
            alt=""
          />
        </button>
      )}
      {onDown !== undefined && (
        <button className="plain" aria-label="Move down" onClick={onDown}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_S.png`}
            alt=""
          />
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

/**
 * One component behind every id-reference field (spec 0018 §2): a search
 * box, optional filter chips, and a scrollable checkbox/radio list of
 * `options` — never raw id text, but the id is always shown as a muted
 * subtitle since that's what validation errors name. For `multiple`
 * pickers, the current selection also renders as its own reorderable list
 * (reusing `RowActions`, exactly as the pre-picker itemIds/taskIds/etc.
 * lists already did) so removal/reordering/navigation keep working
 * regardless of the search box's current filter.
 *
 * `onOpen`/`onRemove`/`removeLabel` are per-id callbacks, not spec'd on the
 * abstract component (§2 lists only `onChange`) — added because the five
 * existing reference lists this replaces (unit itemIds/taskIds/noteIds,
 * lesson unitIds, book lessonIds) each has its own navigate-to-edit
 * affordance and its own removal semantics (hard-delete the owned entity vs.
 * unlink a shared reference); dropping either here would be a functional
 * regression, not a UI simplification.
 */
function EntityPicker({
  label,
  options,
  selected,
  onChange,
  multiple,
  ordered = false,
  groupBy = false,
  filters,
  defaultFilterKey,
  onRemove,
  removeLabel,
  onOpen,
  freeTextWhenEmpty = false,
}: {
  label: string;
  options: PickerOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple: boolean;
  /** Multi only: up/down reordering, selection order is the array order. */
  ordered?: boolean;
  /** Renders a header per `group` value — unit references only (§2). */
  groupBy?: boolean;
  filters?: PickerFilter[];
  defaultFilterKey?: string;
  /** Defaults to a plain array filter (no side effect beyond unselecting). */
  onRemove?: (id: string) => void;
  removeLabel?: (id: string) => string;
  /** Returns a handler to navigate to that entity's own edit view, or
   * `undefined` when this row isn't separately editable (e.g. a lexicon
   * entry referenced from a unit's items — edited in its own domain). */
  onOpen?: (id: string) => (() => void) | undefined;
  /**
   * Single-select only: fall back to a text input when the pool is empty, so
   * the field never becomes unsettable. `sourceRef` is REQUIRED on every item
   * and lexicon entry (`entities.ts:182-203`), but its pool is a Book's
   * `resources` — empty on a freshly-created Book, and absent entirely from a
   * `DomainDocument`, which has no resources field at all. Without this an
   * author could not produce one valid item.
   */
  freeTextWhenEmpty?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [activeFilterKey, setActiveFilterKey] = useState(defaultFilterKey);
  const activeFilter = filters?.find(
    (filter) => filter.key === activeFilterKey,
  );
  if (freeTextWhenEmpty && !multiple && options.length === 0) {
    return (
      <label className="field">
        {label}
        <input
          type="text"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={selected[0] ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? [] : [e.target.value])
          }
        />
        <span className="status">
          Nothing to pick from yet — add a resource to this Book, or type its
          id.
        </span>
      </label>
    );
  }
  const rows = visiblePickerRows(options, selected, search, activeFilter);
  const groups = groupBy ? groupPickerRows(rows) : [{ group: undefined, rows }];
  const selectedSet = new Set(selected);
  const byId = new Map(options.map((option) => [option.id, option]));

  const remove = (id: string) =>
    onRemove !== undefined
      ? onRemove(id)
      : onChange(selected.filter((x) => x !== id));

  const toggle = (id: string) => {
    if (!multiple) {
      onChange(selectedSet.has(id) ? [] : [id]);
      return;
    }
    if (selectedSet.has(id)) {
      remove(id);
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="field entity-picker">
      <span>{label}</span>
      {multiple && selected.length > 0 && (
        <ul className="editor-list">
          {selected.map((id) => {
            const option = byId.get(id);
            return (
              <li key={id}>
                <span>
                  {option?.title ?? id}
                  {option === undefined && " · unresolved"}
                  {option?.kind !== undefined && ` · ${option.kind}`}
                  <span className="status"> {id}</span>
                </span>
                <RowActions
                  onUp={
                    ordered
                      ? () => onChange(moveId(selected, id, -1))
                      : undefined
                  }
                  onDown={
                    ordered
                      ? () => onChange(moveId(selected, id, 1))
                      : undefined
                  }
                  onOpen={onOpen?.(id)}
                  onRemove={() => remove(id)}
                  removeLabel={removeLabel?.(id)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {filters !== undefined && filters.length > 0 && (
        <div className="entity-picker-filters">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={filter.key === activeFilterKey ? "active" : undefined}
              onClick={() =>
                setActiveFilterKey((current) =>
                  current === filter.key ? undefined : filter.key,
                )
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        aria-label={`Search ${label}`}
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="entity-picker-options">
        {groups.map(({ group, rows: groupRows }, groupIndex) => (
          <Fragment key={groupIndex}>
            {groupBy && (
              <li className="entity-picker-group-header">
                {group ?? "(no lesson)"}
              </li>
            )}
            {groupRows
              .filter((row) => !multiple || !selectedSet.has(row.id))
              .map((row) => (
                <li key={row.id}>
                  <label>
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={multiple ? undefined : label}
                      checked={selectedSet.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                    {row.title}
                    {row.unresolved && " · unresolved"}
                    {row.kind !== undefined && ` · ${row.kind}`}
                    <span className="status"> {row.id}</span>
                  </label>
                </li>
              ))}
          </Fragment>
        ))}
      </ul>
    </div>
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
  | { v: "family"; id: string }
  // Maintainer-only (plan 0012 §5): reviewing one open proposal.
  | { v: "proposal"; id: string };

/** Deep-link target from the learner screens' Edit buttons: the editor
 * opens directly at the matching level (book/lesson/unit/note/item/entry/
 * task). */
export interface EditTarget {
  lessonId?: string;
  unitId?: string;
  noteStem?: string;
  itemId?: string;
  entryId?: string;
  taskId?: string;
}

function initialView(target: EditTarget | undefined): View {
  if (target?.entryId !== undefined) {
    return { v: "entry", id: target.entryId };
  }
  if (target?.itemId !== undefined) {
    return { v: "item", backTo: { v: "root" }, id: target.itemId };
  }
  if (target?.taskId !== undefined) {
    return { v: "task", backTo: { v: "root" }, id: target.taskId };
  }
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

/** Dispatches on `mode` (plan 0012 §5): a maintainer edits their own draft
 * through `documents`/publish; a non-maintainer edits a local-only working
 * copy and submits a proposal instead. Splitting into two components (both
 * sharing the `BookEditor`/`DomainEditor` forms below) keeps the two very
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

/** Non-maintainer editing (plan 0012 §5): there is no `draft` column to
 * autosave to, so the working copy lives entirely in localStorage under
 * `bb.proposal.<docId>` until "Submit proposal" turns it into a `proposals`
 * row. Same forms (`BookEditor`/`DomainEditor`) as the maintainer path,
 * loaded from the learner-facing `catalog` view instead of `documents` —
 * RLS gives a non-maintainer no other way to read this document. */
const proposalKey = (docId: string) => `bb.proposal.${docId}`;

interface StoredProposal {
  baseVersion: number;
  doc: AnyDoc;
}

function ProposeEditScreen({
  docId,
  target,
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  onBack: () => void;
}) {
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [working, setWorking] = useState<AnyDoc | null>(null);
  const [view, setView] = useState<View>(() => initialView(target));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localChoice, setLocalChoice] = useState<
    | { s: "none" }
    | { s: "offer-resume"; local: AnyDoc }
    | { s: "offer-stale"; localBaseVersion: number }
  >({ s: "none" });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  // Named to avoid shadowing the engine's `setNote` (note-editing op), which
  // `BookEditor` below still calls unshadowed.
  const [proposalNote, setProposalNote] = useState("");
  const [proposeState, setProposeState] = useState<
    | { s: "idle" }
    | { s: "checking" }
    | { s: "confirm-errors"; errors: string[] }
    | { s: "submitting" }
    | { s: "done" }
    | { s: "error"; message: string }
  >({ s: "idle" });
  // The book's domain lexicon entries (spec 0018 §3), same as
  // MaintainEditScreen below — best-effort, from the published catalog
  // since a non-maintainer has no draft to read.
  const [domainEntries, setDomainEntries] = useState<unknown[]>([]);
  const dirtyRef = useRef(false);
  const workingRef = useRef<AnyDoc | null>(null);
  workingRef.current = working;

  // Same debounce + unmount-flush pattern as the maintainer path's
  // localStorage autosave, just against a different key and value shape
  // (baseVersion travels with the doc so a stale local copy can be told
  // apart from a resumable one on the next load).
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && workingRef.current !== null && entry !== null) {
        localStorage.setItem(
          proposalKey(docId),
          JSON.stringify({
            baseVersion: entry.published_version,
            doc: workingRef.current,
          } satisfies StoredProposal),
        );
        dirtyRef.current = false;
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [docId, entry]);

  useEffect(() => {
    loadCatalogEntry(docId).then(
      (loaded) => {
        if (loaded === null) {
          setLoadError("this document isn't published/listed");
          return;
        }
        setEntry(loaded);
        const raw = localStorage.getItem(proposalKey(docId));
        if (raw !== null) {
          try {
            const stored = JSON.parse(raw) as StoredProposal;
            if (stored.baseVersion === loaded.published_version) {
              setLocalChoice({ s: "offer-resume", local: stored.doc });
            } else {
              setLocalChoice({
                s: "offer-stale",
                localBaseVersion: stored.baseVersion,
              });
            }
            return;
          } catch {
            localStorage.removeItem(proposalKey(docId));
          }
        }
        setWorking(loaded.published as AnyDoc);
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, [docId]);

  // Same reasoning as MaintainEditScreen's identical effect: `domainId` is
  // stable once `entry` loads, so this only fires once, not on every edit.
  const domainId =
    entry?.kind === "topic" && working !== null
      ? rawPrivateDomainId(working as BookDocument)
      : "";
  useEffect(() => {
    if (domainId === "") {
      setDomainEntries([]);
      return;
    }
    let cancelled = false;
    loadCatalogEntry(documentId("domain", domainId)).then(
      (loaded) => {
        if (!cancelled) {
          setDomainEntries(
            loaded !== null
              ? ((loaded.published as DomainDocument).entries ?? [])
              : [],
          );
        }
      },
      () => {
        if (!cancelled) {
          setDomainEntries([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [domainId]);

  // Draft autosave to localStorage, debounced (same 400ms pattern as the
  // maintainer path).
  useEffect(() => {
    if (!dirtyRef.current || working === null || entry === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          proposalKey(docId),
          JSON.stringify({
            baseVersion: entry.published_version,
            doc: working,
          } satisfies StoredProposal),
        );
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [working, docId, entry]);

  function resumeLocal(local: AnyDoc) {
    setWorking(local);
    setLocalChoice({ s: "none" });
  }

  function startOver() {
    localStorage.removeItem(proposalKey(docId));
    if (entry !== null) {
      setWorking(entry.published as AnyDoc);
    }
    setLocalChoice({ s: "none" });
  }

  if (loadError !== null) {
    return (
      <main>
        <p className="error-text">{loadError}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (entry === null) {
    return <main>Loading…</main>;
  }
  const readOnly = entry.schema_version > CONTENT_SCHEMA_VERSION;

  if (localChoice.s !== "none") {
    return (
      <main>
        <header className="screen-header">
          <button className="plain" onClick={onBack}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
              alt=""
            />
          </button>
          <h1>{docId}</h1>
        </header>
        {localChoice.s === "offer-resume" ? (
          <div className="card">
            <p>You have a saved suggestion for the current version.</p>
            <button
              className="primary"
              onClick={() => resumeLocal(localChoice.local)}
            >
              Resume your suggestion
            </button>
            <button className="plain danger" onClick={startOver}>
              Start over
            </button>
          </div>
        ) : (
          <div className="card">
            <p>
              Your saved suggestion was based on version{" "}
              {localChoice.localBaseVersion}; the current version is{" "}
              {entry.published_version}.
            </p>
            <button className="plain danger" onClick={startOver}>
              Start over
            </button>
          </div>
        )}
      </main>
    );
  }
  if (working === null) {
    return <main>Loading…</main>;
  }

  const change = (next: AnyDoc) => {
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    setProposeState({ s: "idle" });
    setWorking(next);
  };

  async function handleSubmit() {
    if (working === null || entry === null) {
      return;
    }
    if (proposeState.s !== "confirm-errors") {
      setProposeState({ s: "checking" });
      const errors = await validateForPublish(docId, entry.kind, working);
      if (errors.length > 0) {
        setProposeState({ s: "confirm-errors", errors });
        return;
      }
    }
    setProposeState({ s: "submitting" });
    try {
      await submitProposal(
        docId,
        entry.published_version,
        working,
        proposalNote,
      );
      localStorage.removeItem(proposalKey(docId));
      dirtyRef.current = false;
      setProposeState({ s: "done" });
    } catch (e) {
      setProposeState({
        s: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const body =
    entry.kind === "topic" ? (
      <BookEditor
        doc={working as BookDocument}
        view={view}
        setView={setView}
        onChange={change}
        domainEntries={domainEntries}
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
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt="Back to learning"
          />
        </button>
        {view.v !== "root" && (
          <button
            className="plain"
            onClick={() => setView(upView(view))}
            title="Up one level"
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_N.png`}
              alt="Up one level"
            />
          </button>
        )}
        <h1>{docId}</h1>
      </header>
      <p className="status">
        Suggesting edits to version {entry.published_version}
        {readOnly
          ? " · read-only: this document needs a newer app"
          : saveState === "saving"
            ? " · saving…"
            : saveState === "error"
              ? " · local save failed — storage may be full"
              : " · saved on this device"}
      </p>
      {body}
      <div className="editor-publish card">
        {proposeState.s === "confirm-errors" && (
          <ul className="error-text">
            {proposeState.errors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {proposeState.errors.length > 20 && (
              <li>…and {proposeState.errors.length - 20} more</li>
            )}
          </ul>
        )}
        {proposeState.s === "error" && (
          <p className="error-text">{proposeState.message}</p>
        )}
        {proposeState.s === "done" && (
          <p className="status">
            Proposal submitted — the maintainer will review it.
          </p>
        )}
        <label className="field">
          Note (optional)
          <textarea
            rows={3}
            value={proposalNote}
            onChange={(e) => setProposalNote(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={
            readOnly ||
            proposeState.s === "checking" ||
            proposeState.s === "submitting"
          }
          onClick={() => void handleSubmit()}
        >
          {proposeState.s === "checking"
            ? "Validating…"
            : proposeState.s === "submitting"
              ? "Submitting…"
              : proposeState.s === "confirm-errors"
                ? `Submit with ${proposeState.errors.length} validation issue${proposeState.errors.length === 1 ? "" : "s"}`
                : "Submit proposal"}
        </button>
      </div>
    </main>
  );
}

function MaintainEditScreen({
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
  // Open proposals against this document (plan 0012 §5 point 6).
  const [openProposals, setOpenProposals] = useState<Proposal[] | null>(null);
  // The book's domain lexicon entries (spec 0018 §3): BookEditor's itemIds
  // pickers merge book items with these. Best-effort — a fetch failure just
  // leaves the Vocabulary side of the picker empty, it never blocks editing.
  const [domainEntries, setDomainEntries] = useState<unknown[]>([]);
  const dirtyRef = useRef(false);
  const workingRef = useRef<AnyDoc | null>(null);
  workingRef.current = working;

  const refreshProposals = () => {
    listOpenProposals(docId).then(setOpenProposals, () => setOpenProposals([]));
  };
  useEffect(refreshProposals, [docId]);

  // `domainId` is metadata the book form never edits (BookEditor's own
  // EntityForm specs don't include it), so it's stable after the initial
  // load — recomputed each render (cheap) but only fires the fetch below
  // when its *value* changes, not on every keystroke elsewhere in `working`.
  const domainId =
    record?.kind === "topic" && working !== null
      ? rawPrivateDomainId(working as BookDocument)
      : "";
  useEffect(() => {
    if (domainId === "") {
      setDomainEntries([]);
      return;
    }
    let cancelled = false;
    loadDocument(documentId("domain", domainId)).then(
      (d) => {
        if (!cancelled) {
          setDomainEntries(
            ((d.draft ?? d.published) as DomainDocument | null)?.entries ?? [],
          );
        }
      },
      () => {
        if (!cancelled) {
          setDomainEntries([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [domainId]);

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

  // Accepting a proposal writes `documents.draft` on the server (plan 0012
  // §5 point 9, via ProposalReview below). The maintainer's own
  // `bb.author.draft.<docId>` localStorage entry otherwise always wins over
  // the server draft on load (see the load effect above) and would shadow
  // the just-accepted proposal — clear it and pull the fresh server state in,
  // exactly like the post-publish tail below.
  async function handleProposalAccepted() {
    const reloaded = await loadDocument(docId);
    setRecord(reloaded);
    setWorking((reloaded.draft ?? reloaded.published) as AnyDoc);
    dirtyRef.current = false;
    localStorage.removeItem(draftKey(docId));
    setSyncState("synced");
    refreshProposals();
    setView({ v: "root" });
  }

  function handleProposalRejected() {
    refreshProposals();
    setView({ v: "root" });
  }

  const reviewingProposal =
    view.v === "proposal"
      ? (openProposals?.find((p) => p.id === view.id) ?? null)
      : undefined;

  const body =
    record.kind === "topic" ? (
      <BookEditor
        doc={working as BookDocument}
        view={view}
        setView={setView}
        onChange={change}
        domainEntries={domainEntries}
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
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt="Back to learning"
          />
        </button>
        {view.v !== "root" && (
          <button
            className="plain"
            onClick={() => setView(upView(view))}
            title="Up one level"
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_N.png`}
              alt="Up one level"
            />
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
      {view.v === "root" &&
        openProposals !== null &&
        openProposals.length > 0 && (
          <section className="card">
            <h2>
              {openProposals.length} open proposal
              {openProposals.length === 1 ? "" : "s"}
            </h2>
            <ul className="card-list">
              {openProposals.map((proposal) => (
                <li key={proposal.id} className="card">
                  <p>{proposal.note ?? "(no note)"}</p>
                  <button
                    className="plain"
                    onClick={() => setView({ v: "proposal", id: proposal.id })}
                  >
                    Review
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      {reviewingProposal !== undefined ? (
        reviewingProposal === null ? (
          <p className="error-text">
            unknown proposal: {view.v === "proposal" ? view.id : ""}
          </p>
        ) : (
          <ProposalReview
            docId={docId}
            kind={record.kind}
            publishedVersion={record.published_version}
            hasDraft={record.draft !== null}
            proposal={reviewingProposal}
            onBack={() => setView({ v: "root" })}
            onAccepted={() => void handleProposalAccepted()}
            onRejected={handleProposalRejected}
          />
        )
      ) : (
        <>
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
        </>
      )}
    </main>
  );
}

/** A Book's declared domain id, read raw off its topic — same pattern
 * `content/source.ts`'s and `content/private-assets.ts`'s own `rawDomainId`
 * use (each file keeps its own tiny copy rather than sharing one across
 * module boundaries). Despite the name (this predates spec 0018), it's not
 * private-path-specific: Maintain/ProposeEditScreen below reuse it to look
 * up the domain doc for `BookEditor`'s itemIds pickers' merged pool. */
function rawPrivateDomainId(book: BookDocument): string {
  return typeof (book.topic as { domainId?: unknown }).domainId === "string"
    ? (book.topic as { domainId: string }).domainId
    : "";
}

/** Item/entry ids (book items and domain entries) whose audioRef/imageRef —
 * including a pair item's nested a/b sides — points at `stem`, so the Assets
 * manager's delete confirm can name what a deletion would break (plan
 * 0017 §4: "the author should hear that before it happens, not after"). */
function assetReferences(
  book: BookDocument,
  domain: DomainDocument,
  stem: string,
): string[] {
  const refs: string[] = [];
  const check = (entity: Entity) => {
    const payload = entity.payload;
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = payload as Record<string, unknown>;
    if (p.audioRef === stem || p.imageRef === stem) {
      refs.push(entity.id);
      return;
    }
    for (const side of ["a", "b"] as const) {
      const sidePayload = p[side];
      if (
        typeof sidePayload === "object" &&
        sidePayload !== null &&
        (sidePayload as Record<string, unknown>).audioRef === stem
      ) {
        refs.push(entity.id);
        return;
      }
    }
  };
  for (const item of book.items as Entity[]) {
    check(item);
  }
  for (const entry of domain.entries as Entity[]) {
    check(entry);
  }
  return refs;
}

/** On-device editing for a private Book (plan 0017 §3): no account, no
 * network, no draft/published distinction — every edit autosaves straight
 * into the private store (`content/private-store.ts`) on the same
 * debounce/flush idiom the maintainer path uses for its localStorage
 * autosave. Unlike the other two shells, this one owns BOTH of the Book's
 * documents (its topic and the Domain it exclusively owns, plan 0017
 * decision 2) and toggles which one `BookEditor`/`DomainEditor` renders via
 * `editingDomain` — a private Book has no catalog list to reach its Domain
 * from otherwise, so the book root view grows a link to it (plan 0017 §3's
 * "a link/tab on the root view is enough"). */
function PrivateEditScreen({
  docId,
  target,
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  onBack: () => void;
}) {
  const bookId = contentIdOf(docId);
  const [book, setBook] = useState<BookDocument | null>(null);
  const [domain, setDomain] = useState<DomainDocument | null>(null);
  const [assets, setAssets] = useState<Record<string, Blob>>({});
  const [view, setView] = useState<View>(() => initialView(target));
  const [editingDomain, setEditingDomain] = useState(false);
  const [editingAssets, setEditingAssets] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const dirtyRef = useRef(false);
  const bookRef = useRef<BookDocument | null>(null);
  const domainRef = useRef<DomainDocument | null>(null);
  const assetsRef = useRef<Record<string, Blob>>({});
  bookRef.current = book;
  domainRef.current = domain;
  assetsRef.current = assets;

  useEffect(() => {
    readPrivateBook(bookId).then((record) => {
      if (record === undefined) {
        setLoadError("this private book no longer exists on this device");
        return;
      }
      setBook(record.book);
      setDomain(record.domain);
      setAssets(record.assets);
    });
  }, [bookId]);

  // Same debounce + unmount-flush idiom as the maintainer path's localStorage
  // autosave, writing straight to the private store instead — there is no
  // server draft to sync to, so no separate Sync action. Unlike that
  // localStorage write, `putPrivateBook` opens an IndexedDB transaction and
  // can't be awaited from `beforeunload` (the page is already tearing down),
  // so the tab-close path is best-effort: `visibilitychange` fires earlier
  // and more reliably (especially on mobile, where `beforeunload` may not
  // fire at all) and is registered alongside it; worst case is losing up to
  // the 400ms debounce window's edit.
  useEffect(() => {
    const flush = () => {
      if (
        dirtyRef.current &&
        bookRef.current !== null &&
        domainRef.current !== null
      ) {
        putPrivateBook({
          id: bookId,
          book: bookRef.current,
          domain: domainRef.current,
          assets: assetsRef.current,
        }).catch(() => {
          // Exit-time write; there is no UI left to show the failure on.
        });
        dirtyRef.current = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [bookId]);

  // Debounced autosave (same 400ms pattern as the maintainer path). Reads
  // the refs, not the closed-over `book`/`domain`/`assets`, when the timer
  // fires: the Assets manager (plan 0017 §4) writes straight through
  // `putPrivateBook` outside this debounce, and if that write's `await`
  // straddles this timer firing, a closure-captured `assets` would be
  // stale — overwriting the just-added/deleted asset with the pre-change
  // map. The refs are current as of the timer's actual fire time instead.
  useEffect(() => {
    if (!dirtyRef.current || book === null || domain === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      putPrivateBook({
        id: bookId,
        book: bookRef.current ?? book,
        domain: domainRef.current ?? domain,
        assets: assetsRef.current,
      }).then(
        () => {
          dirtyRef.current = false;
          setSaveState("saved");
        },
        () => setSaveState("error"),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [book, domain, assets, bookId]);

  const changeBook = (next: BookDocument) => {
    dirtyRef.current = true;
    setBook(next);
  };
  const changeDomain = (next: DomainDocument) => {
    dirtyRef.current = true;
    setDomain(next);
  };

  // Inline validation only (plan 0017 §3): a half-built private Book is a
  // normal intermediate state, so this never gates the autosave above —
  // it only surfaces the same `validateContent` errors the maintainer editor
  // shows before publish. A private Book stands alone (it owns its Domain
  // exclusively, plan 0017 decision 2), so — unlike `validateForPublish` —
  // there is no wider catalog to assemble it against and no backend call.
  const validationErrors = useMemo(() => {
    if (book === null || domain === null) {
      return [];
    }
    const domainId = rawPrivateDomainId(book);
    const built = createDocumentContentSource(
      new Map([[bookId, book]]),
      domainId === "" ? new Map() : new Map([[domainId, domain]]),
      privateAssetStems(),
    );
    return built.broken.find((b) => b.bookId === bookId)?.errors ?? [];
    // `assets` isn't read directly here, but adding/deleting one re-runs
    // `registerPrivateAssets` (AssetsManager below) before notifying this
    // component, so it's the signal this memo needs to re-check dangling
    // audioRef/imageRef against the fresh overlay in `privateAssetStems()`.
  }, [book, domain, bookId, assets]);

  if (loadError !== null) {
    return (
      <main>
        <p className="error-text">{loadError}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (book === null || domain === null) {
    return <main>Loading…</main>;
  }

  function goUp() {
    if (view.v !== "root") {
      setView(upView(view));
      return;
    }
    if (editingDomain) {
      setEditingDomain(false);
      return;
    }
    if (editingAssets) {
      setEditingAssets(false);
    }
  }

  return (
    <main className="editor">
      <header className="screen-header">
        <button className="plain" onClick={onBack} title="Back to learning">
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt="Back to learning"
          />
        </button>
        {(view.v !== "root" || editingDomain || editingAssets) && (
          <button className="plain" onClick={goUp} title="Up one level">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_N.png`}
              alt="Up one level"
            />
          </button>
        )}
        <h1>{docId}</h1>
      </header>
      <p className="status">
        {saveState === "saving"
          ? "saving…"
          : saveState === "error"
            ? "local save failed — storage may be full"
            : "saved on this device"}
      </p>
      {!editingDomain && !editingAssets && view.v === "root" && (
        <p>
          <button
            className="plain"
            onClick={() => {
              setEditingDomain(true);
              setView({ v: "root" });
            }}
          >
            Edit this Book's lexicon (Domain) →
          </button>
        </p>
      )}
      {!editingDomain && !editingAssets && view.v === "root" && (
        <p>
          <button
            className="plain"
            onClick={() => {
              setEditingAssets(true);
              setView({ v: "root" });
            }}
          >
            Manage assets →
          </button>
        </p>
      )}
      {editingAssets ? (
        <AssetsManager
          book={book}
          domain={domain}
          bookId={bookId}
          assets={assets}
          onAssetsChange={setAssets}
        />
      ) : editingDomain ? (
        <DomainEditor
          doc={domain}
          view={view}
          setView={setView}
          onChange={changeDomain}
        />
      ) : (
        <BookEditor
          doc={book}
          view={view}
          setView={setView}
          onChange={changeBook}
          hideCoverArt
          domainEntries={domain.entries}
        />
      )}
      {validationErrors.length > 0 && (
        <div className="editor-publish card">
          <ul className="error-text">
            {validationErrors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {validationErrors.length > 20 && (
              <li>…and {validationErrors.length - 20} more</li>
            )}
          </ul>
        </div>
      )}
    </main>
  );
}

// ----------------------------------------------------------- asset manager

/** Kind label for display, from the blob's MIME type — same "image vs.
 * audio" split `content/private-assets.ts`'s runtime overlay uses. */
function assetKind(blob: Blob): "audio" | "image" {
  return blob.type.startsWith("image/") ? "image" : "audio";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ponytail: a flat per-file ceiling, not real IndexedDB quota detection —
// quota isn't reliably queryable across browsers, and a private Book is
// later serialised into one JSON string at export time (plan 0017 §7: "fine
// to roughly 20 MB"), so keeping each asset well under that keeps the export
// small too. Upgrade path if real files need to exceed this: chunked/zip
// export, at which point a dependency is worth it.
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** Asset manager for a private Book (plan 0017 §4): list/add/delete blobs
 * and show each stem as copyable text. Deliberately NOT a per-field file
 * picker — that would mean changing `EntityForm`/`Field`, which the
 * maintainer and propose paths share, for a feature only private Books use.
 * The author copies a stem here and pastes it into an item's
 * audioRef/imageRef field by hand; the stems are the contract between this
 * view and the book/domain forms. */
function AssetsManager({
  book,
  domain,
  bookId,
  assets,
  onAssetsChange,
}: {
  book: BookDocument;
  domain: DomainDocument;
  bookId: string;
  assets: Record<string, Blob>;
  onAssetsChange: (next: Record<string, Blob>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(
    new Map(),
  );

  // One object URL per current stem. The cleanup revokes exactly what this
  // run's setup created, and runs both on the next `assets` change and on
  // unmount (plan 0017 §4: "Revoke those URLs on unmount") — a plain
  // effect+cleanup pair rather than manual prev/next diffing, so it stays
  // correct under StrictMode's double-invoke too.
  useEffect(() => {
    const urls = new Map<string, string>();
    for (const [stem, blob] of Object.entries(assets)) {
      urls.set(stem, URL.createObjectURL(blob));
    }
    setPreviewUrls(urls);
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assets]);

  const bookCode =
    typeof (book.topic as Entity).code === "string"
      ? ((book.topic as Entity).code as string)
      : "";

  /** Persists the full record, then re-registers the runtime overlay
   * (`content/private-assets.ts`) before notifying the parent — an asset
   * added or removed mid-session is otherwise invisible to
   * `registerPrivateAssets` until reload (plan 0017 §4 point 3). Ordered
   * before `onAssetsChange` so the dangling-ref check in `PrivateEditScreen`
   * re-renders against the fresh overlay, not the stale one. */
  async function writeThrough(nextAssets: Record<string, Blob>) {
    await putPrivateBook({ id: bookId, book, domain, assets: nextAssets });
    registerPrivateAssets(await readPrivateBooks());
    onAssetsChange(nextAssets);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (file === undefined) {
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setError(
        `"${file.name}" is too large: ${formatBytes(file.size)} (max ${formatBytes(MAX_ASSET_BYTES)}).`,
      );
      return;
    }
    setError(null);
    // Never the filename (plan 0017 §4 point 2): filenames contain spaces
    // and other characters `slugPattern` rejects, so the stem is always
    // generated, never derived from what the author picked.
    const stem = `${bookCode}-${newPrivateId()}`;
    try {
      await writeThrough({ ...assets, [stem]: file });
    } catch {
      setError("failed to save the asset — storage may be full");
    }
  }

  async function handleDelete(stem: string) {
    const refs = assetReferences(book, domain, stem);
    const warning =
      refs.length > 0
        ? `Still referenced by: ${refs.join(", ")}. Deleting it will make this Book invalid until those references are fixed.\n\n`
        : "";
    if (!window.confirm(`${warning}Delete asset "${stem}"?`)) {
      return;
    }
    const next = { ...assets };
    delete next[stem];
    try {
      await writeThrough(next);
    } catch {
      setError("failed to delete the asset — storage may be full");
    }
  }

  const stems = Object.entries(assets);

  return (
    <section>
      <h2>Assets</h2>
      {error !== null && <p className="error-text">{error}</p>}
      <label className="field">
        Add audio or image
        <input
          type="file"
          accept="audio/*,image/*"
          onChange={(e) => void handleFileSelect(e)}
        />
      </label>
      {stems.length === 0 ? (
        <p className="status">No assets yet.</p>
      ) : (
        <ul className="card-list asset-list">
          {stems.map(([stem, blob]) => {
            const url = previewUrls.get(stem);
            const kind = assetKind(blob);
            return (
              <li key={stem} className="card">
                <p className="status">
                  {kind} · {formatBytes(blob.size)}
                </p>
                {url !== undefined &&
                  (kind === "image" ? (
                    <img src={url} alt="" />
                  ) : (
                    <audio controls src={url} />
                  ))}
                <label className="field">
                  Stem (copy into an audioRef/imageRef field)
                  <input
                    type="text"
                    readOnly
                    value={stem}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                <button
                  className="plain danger"
                  onClick={() => void handleDelete(stem)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function upView(view: View): View {
  switch (view.v) {
    case "lesson":
    case "entry":
    case "family":
    case "proposal":
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

// -------------------------------------------------------- proposal review

/** A never-published document, for diffing a proposal whose `base_version`
 * is 0 or whose `versions` row is otherwise missing (plan 0012 §5 point 7). */
function emptyDocFor(kind: "topic" | "domain"): AnyDoc {
  return kind === "topic"
    ? {
        topic: {},
        lessons: [],
        units: [],
        items: [],
        tasks: [],
        resources: [],
        notes: [],
      }
    : { domain: {}, entries: [], families: [] };
}

function collectionDiffIsEmpty(diff: CollectionDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  );
}

function CollectionDiffView({ diff }: { diff: CollectionDiff }) {
  return (
    <>
      {diff.added.length > 0 && <p>Added: {diff.added.join(", ")}</p>}
      {diff.removed.length > 0 && <p>Removed: {diff.removed.join(", ")}</p>}
      {diff.changed.map((entity) => (
        <div key={entity.id}>
          <strong>{entity.id}</strong>
          <ul>
            {entity.fields.map((field) => (
              <li key={field.path}>
                {field.path}: "{field.before}" → "{field.after}"
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The maintainer's review of one open proposal (plan 0012 §5 points 7–9):
 * diffs the proposal's full document against the `versions` row for its
 * `base_version`, flags staleness, and decides accept-into-draft or reject. */
function ProposalReview({
  docId,
  kind,
  publishedVersion,
  hasDraft,
  proposal,
  onBack,
  onAccepted,
  onRejected,
}: {
  docId: string;
  kind: "topic" | "domain";
  publishedVersion: number;
  hasDraft: boolean;
  proposal: Proposal;
  onBack: () => void;
  onAccepted: () => void;
  onRejected: () => void;
}) {
  const [base, setBase] = useState<AnyDoc | "loading">("loading");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBase("loading");
    if (proposal.base_version === 0) {
      setBase(emptyDocFor(kind));
      return;
    }
    loadVersion(docId, proposal.base_version).then(
      (doc) => setBase((doc as AnyDoc | null) ?? emptyDocFor(kind)),
      () => setBase(emptyDocFor(kind)),
    );
  }, [docId, proposal.base_version, kind]);

  async function handleAccept() {
    if (
      hasDraft &&
      !window.confirm("This replaces your current draft. Continue?")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Order pinned (plan 0012 §5 point 9): draft first, then status — if
      // the status update fails the proposal just stays open, harmless.
      await saveDraft(docId, proposal.proposed_doc);
      await decideProposal(
        proposal.id,
        "accepted",
        decisionNote.trim() === "" ? null : decisionNote.trim(),
      );
      onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (decisionNote.trim() === "") {
      setError("A reason is required to reject a proposal.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await decideProposal(proposal.id, "rejected", decisionNote.trim());
      onRejected();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (base === "loading") {
    return <p>Loading base version…</p>;
  }
  const diff =
    kind === "topic"
      ? diffBookDocument(
          base as BookDocument,
          proposal.proposed_doc as BookDocument,
        )
      : diffDomainDocument(
          base as DomainDocument,
          proposal.proposed_doc as DomainDocument,
        );

  return (
    <section>
      <h2>Proposal review</h2>
      {proposal.note !== null && proposal.note !== "" && (
        <p>Note: {proposal.note}</p>
      )}
      {proposal.base_version < publishedVersion && (
        <p className="error-text">
          based on version {proposal.base_version}; current is{" "}
          {publishedVersion} — review against current content before accepting.
        </p>
      )}
      {Object.entries(diff).map(([name, collectionDiff]) =>
        collectionDiffIsEmpty(collectionDiff) ? null : (
          <div key={name} className="card">
            <h3>{name}</h3>
            <CollectionDiffView diff={collectionDiff} />
          </div>
        ),
      )}
      {error !== null && <p className="error-text">{error}</p>}
      <label className="field">
        Decision note (required to reject)
        <textarea
          rows={3}
          value={decisionNote}
          onChange={(e) => setDecisionNote(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy}
        onClick={() => void handleAccept()}
      >
        Accept into draft
      </button>
      <button
        className="plain danger"
        disabled={busy}
        onClick={() => void handleReject()}
      >
        Reject
      </button>
      <button className="plain" onClick={onBack}>
        Back
      </button>
    </section>
  );
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
  hideCoverArt,
  domainEntries = [],
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
            // `undefined` (mirrors `setPath`'s own "" -> delete rule above,
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

function NewItemForm({
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
  const domainCode = typeof domain.code === "string" ? domain.code : "";
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
        {/* A DomainDocument carries no `resources` of its own (only a Book
         * does — validate.ts's ValidateContentInput.resources is a Book
         * field, shared with its entries at validation time). So this
         * picker's pool is always empty here; see spec 0018 implementation
         * report for the gap this opens (sourceRef becomes unsettable for a
         * domain entry via the UI). */}
        <EntityPicker
          label="Source ref"
          freeTextWhenEmpty
          options={[]}
          selected={
            typeof entry.sourceRef === "string" && entry.sourceRef !== ""
              ? [entry.sourceRef]
              : []
          }
          onChange={(ids) =>
            onChange(
              upsertDomainEntry(doc, { ...entry, sourceRef: ids[0] ?? "" }),
            )
          }
          multiple={false}
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
        <EntityPicker
          label="Entry ids"
          options={optionsFrom(doc.entries as Entity[])}
          selected={
            Array.isArray(family.entryIds) ? (family.entryIds as string[]) : []
          }
          onChange={(ids) =>
            onChange(upsertFamily(doc, { ...family, entryIds: ids }))
          }
          multiple
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
        makeId={() => newEntityId(domainCode)}
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
        makeId={() => newEntityId(domainCode)}
        onAdd={(id) => {
          onChange(upsertFamily(doc, { id, name: "", entryIds: [] }));
          setView({ v: "family", id });
        }}
      />
    </section>
  );
}

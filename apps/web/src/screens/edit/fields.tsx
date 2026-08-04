import { Fragment, useState } from "react";
import { moveId } from "@betterbeaver/engine";
import {
  type PickerFilter,
  type PickerOption,
  groupPickerRows,
  visiblePickerRows,
} from "../entityPicker";
import { type Entity } from "./types";
import type { AssetView } from "./AssetsManager";

export interface FieldSpec {
  label: string;
  path: string[];
  multiline?: boolean;
  hint?: string;
  /** Renders a native `<select>` over these options plus "(none)" instead of a text input/textarea. */
  options?: readonly string[];
}

export const f = (label: string, ...path: string[]): FieldSpec => ({
  label,
  path,
});

export const fm = (label: string, ...path: string[]): FieldSpec => ({
  label,
  path,
  multiline: true,
});

// `sourceRef` used to live here as a free-text FieldSpec; spec 0018 §3 moves
// it out to an `EntityPicker` rendered alongside `EntityForm` at each of
// this record's two call sites (item view, domain entry view) instead —
// `FieldSpec`/`Field` stay string-only, on purpose (§3).
export const ITEM_FIELDS: Record<string, FieldSpec[]> = {
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

export function getPath(value: unknown, path: string[]): string {
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
export function setPath(value: unknown, path: string[], next: string): unknown {
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

export function Field({
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

export function EntityForm({
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
export function AddEntityForm({
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

export function RowActions({
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
 * One asset ref slot — `audioRef`, `imageRef`, or a pair side's — picked
 * from what is already uploaded (spec 0021-8 §2c). A stem is never typed,
 * which is the whole point: `slugPattern` rejects most filenames, and a
 * hand-typed stem that resolves to nothing fails at publish.
 *
 * A native `<select>` over asset *names* rather than slice 2's toggled
 * thumbnail grid: these render inside a table row, and the grid's job there
 * (browse a pool of images) is not this control's (fill one slot). The image
 * thumbnail below keeps the one thing the grid gave that a name does not.
 *
 * Clearing sends `""`, which every caller routes through `withPayload` —
 * so the key is deleted, never left as `""`, which `slugSchema` rejects.
 */
export function AssetRefPicker({
  label,
  assets,
  selected,
  onChange,
  onUpload,
  required = false,
}: {
  label: string;
  /** Already filtered to this slot's kind, and to the pool belonging to
   * whichever document owns the row (§2c's two pools). */
  assets: AssetView[];
  selected: string;
  onChange: (stem: string) => void;
  /** Absent on a lexicon entry's row: uploads land in the Book's prefix. */
  onUpload?: (file: File) => Promise<void>;
  /** A `pair` side's audio is the only mandatory slug in the schema, so its
   * "(none)" option would author an unpublishable item. */
  required?: boolean;
}) {
  const chosen = assets.find((asset) => asset.stem === selected);
  return (
    <label className="field">
      {label}
      <select value={selected} onChange={(e) => onChange(e.target.value)}>
        {/* Kept even when required and unset: dropping it would silently
            select the first asset for a row the author never touched. */}
        {(!required || selected === "") && <option value="">(none)</option>}
        {assets.map((asset) => (
          <option key={asset.stem} value={asset.stem}>
            {asset.name}
          </option>
        ))}
        {/* A ref pointing at something not in this pool — a lexicon entry
            borrowed from elsewhere, or an asset since deleted — would
            otherwise render as "(none)" and be silently overwritten on the
            next change. */}
        {selected !== "" && chosen === undefined && (
          <option value={selected}>{selected} · not in this pool</option>
        )}
      </select>
      {chosen?.kind === "image" && chosen.url !== "" && (
        <img className="asset-thumb" src={chosen.url} alt="" />
      )}
      {assets.length === 0 && (
        <span className="status">
          {onUpload !== undefined
            ? "Nothing uploaded yet."
            : "This lexicon has no assets — they are uploaded where it is maintained."}
        </span>
      )}
      {onUpload !== undefined && (
        <input
          type="file"
          aria-label={`Upload ${label}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file !== undefined) {
              void onUpload(file);
            }
          }}
        />
      )}
    </label>
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
export function EntityPicker({
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
  hideIds = false,
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
  /** Hides the raw id shown beside every title. In-place editing shows no
   * entity ids at all (plan 0021 §11) — but the form editor still must,
   * because its validation errors name ids and spec 0018 made those
   * generated UUIDs, so hiding them there without slice 10's deep-linking
   * would make an error unlocatable. Hence opt-in, not the default. */
  hideIds?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [activeFilterKey, setActiveFilterKey] = useState(defaultFilterKey);
  const activeFilter = filters?.find(
    (filter) => filter.key === activeFilterKey,
  );
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
                  {!hideIds && <span className="status"> {id}</span>}
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
                      // A single-select clears by tapping its own selected
                      // row — and clicking an already-checked radio changes
                      // nothing, so `change` never fires and `toggle`'s
                      // clear branch was unreachable. `click` fires either
                      // way (keyboard activation included). The checkbox
                      // keeps `change`, where it works.
                      {...(multiple
                        ? { onChange: () => toggle(row.id) }
                        : {
                            onClick: () => toggle(row.id),
                            onChange: () => {},
                          })}
                    />
                    {row.title}
                    {row.unresolved && " · unresolved"}
                    {row.kind !== undefined && ` · ${row.kind}`}
                    {!hideIds && <span className="status"> {row.id}</span>}
                  </label>
                </li>
              ))}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}

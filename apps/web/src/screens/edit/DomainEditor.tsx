import { useState } from "react";
import { type DomainDocument } from "@betterbeaver/schema";
import {
  removeDomainEntry,
  removeFamily,
  upsertDomainEntry,
  upsertFamily,
} from "@betterbeaver/engine";
import { newEntityId } from "../../content/entity-ids";
import { optionsFrom } from "../entityPicker";
import {
  AddEntityForm,
  EntityForm,
  EntityPicker,
  ITEM_FIELDS,
  RowActions,
  f,
} from "./fields";
import { type Entity, type View, byId } from "./types";

export function DomainEditor({
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

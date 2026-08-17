import type { Item } from "@betterbeaver/schema";
import { type PickerOption, optionsFrom } from "../entityPicker";
import { EntityPicker, RowActions } from "./fields";
import {
  ProblemMarker,
  type UnitEditOps,
  payloadList,
  withPayload,
  withPayloadList,
} from "./inPlace";

/**
 * The three morphology fields (plan 0023 §6): `bound`, the `variants`
 * allomorph list, and the `components` breakdown `EntryPopup` renders. Its
 * own module rather than more of `RowExtras`: `UnitScreen.tsx` is already
 * past the repo's per-file budget, and these are the first per-row controls
 * that edit *lists* instead of scalars, so they carry their own row
 * machinery.
 *
 * Rendered from `RowExtras`, so both surfaces that mount it — the Vocabulary
 * row's `⚙` sheet and `SessionEditSheet` — get the fields at once, already
 * behind that component's `edit.canEditRow(...)` gate.
 */
export function MorphologyFields({
  item,
  edit,
}: {
  item: Item;
  edit: UnitEditOps;
}) {
  // `sentence`/`pair` payloads carry no breakdown; only the two lexicon
  // kinds do.
  if (item.kind !== "lexeme" && item.kind !== "concept") {
    return null;
  }
  const raw = edit.raw(item.id) ?? { id: item.id };
  const variants = payloadList(raw, "variants");
  const components = payloadList(raw, "components");

  /** The pool is raw draft JSON (`LexiconAccess.entries` is `unknown[]`), so
   * an element that is not an object with an id would break `optionsFrom`'s
   * `titleOf` — a half-typed entry is simply not offerable yet. */
  const entryOptions: PickerOption[] = optionsFrom(
    (edit.lexicon?.entries ?? []).filter(
      (entry): entry is { id: string } & Record<string, unknown> =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === "string",
    ),
  );

  const partField = (index: number, key: string): string => {
    const part = components[index];
    const value =
      typeof part === "object" && part !== null
        ? (part as Record<string, unknown>)[key]
        : undefined;
    return typeof value === "string" ? value : "";
  };

  const setComponents = (next: unknown[]) =>
    edit.patchEntity(withPayloadList(raw, "components", next));

  /** One key of one part. Empty **deletes** the key, exactly as `withPayload`
   * does for a scalar field: `entryId` is `slugSchema.optional()`, which
   * rejects `""`, and `draftContent` drops an empty one anyway — leaving it
   * stored would only be a key the author cannot get rid of. */
  const setPart = (index: number, key: string, value: string) =>
    setComponents(
      components.map((part, i) => {
        if (i !== index) {
          return part;
        }
        const next = {
          ...(typeof part === "object" && part !== null
            ? (part as Record<string, unknown>)
            : {}),
        };
        if (value === "") {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      }),
    );

  const movePart = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= components.length) {
      return;
    }
    const next = [...components];
    [next[index], next[to]] = [next[to], next[index]];
    setComponents(next);
  };

  return (
    <>
      {item.kind === "lexeme" && (
        <>
          <label className="field">
            Bound morpheme
            <select
              value={edit.payloadValue(item.id, "bound")}
              // Through `withPayload`, so "(free-standing word)" **deletes**
              // the key: `bound` is an enum, and `""` is not one of its
              // members.
              onChange={(e) =>
                edit.patchEntity(withPayload(raw, ["bound"], e.target.value))
              }
            >
              <option value="">(free-standing word)</option>
              <option value="prefix">prefix</option>
              <option value="suffix">suffix</option>
            </select>
          </label>
          <ProblemMarker
            problems={edit.fieldProblems(item.id, "payload.bound")}
          />
          {/* Offered whether or not `bound` is set. Hiding it on a free word
              would make validator class (ab) — "variants" requires "bound" —
              unfixable from the UI, on the one entry that has it; the problem
              marker below explains it instead. */}
          <div className="field">
            <span>Allomorphs (vowel harmony)</span>
            {variants.length > 0 && (
              <ul className="editor-list">
                {variants.map((variant, index) => (
                  <li key={index}>
                    <input
                      type="text"
                      aria-label={`Allomorph ${index + 1}`}
                      value={typeof variant === "string" ? variant : ""}
                      onChange={(e) =>
                        edit.patchEntity(
                          withPayloadList(
                            raw,
                            "variants",
                            variants.map((v, i) =>
                              i === index ? e.target.value : v,
                            ),
                          ),
                        )
                      }
                    />
                    <RowActions
                      onRemove={() =>
                        edit.patchEntity(
                          withPayloadList(
                            raw,
                            "variants",
                            variants.filter((_, i) => i !== index),
                          ),
                        )
                      }
                      removeLabel={`Remove allomorph ${index + 1}`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="editor-add"
              onClick={() =>
                edit.patchEntity(
                  withPayloadList(raw, "variants", [...variants, ""]),
                )
              }
            >
              + variant
            </button>
          </div>
          <ProblemMarker
            problems={edit.fieldProblems(item.id, "payload.variants")}
          />
        </>
      )}
      <div className="field">
        <span>Breakdown</span>
        {components.map((_, index) => (
          // Not an `.editor-list li`: a part is three stacked fields plus its
          // rail, not a one-line row. Order is meaning here — a decomposition
          // is a sequence — so every part gets ↑/↓, unlike the allomorph list
          // above, where the four harmony forms are a set.
          <div className="morphology-part" key={index}>
            <label className="field">
              Part {index + 1}
              <input
                type="text"
                value={partField(index, "text")}
                onChange={(e) => setPart(index, "text", e.target.value)}
              />
            </label>
            <label className="field">
              Part {index + 1} gloss
              <input
                type="text"
                value={partField(index, "gloss")}
                onChange={(e) => setPart(index, "gloss", e.target.value)}
              />
            </label>
            {/* Absent when the lexicon could not be parsed: the text and gloss
                are still authorable, and they are what the breakdown renders
                — dropping the whole part would cost the author more than the
                link is worth. */}
            {edit.lexicon !== undefined && (
              <EntityPicker
                label={`Part ${index + 1} entry`}
                options={entryOptions}
                selected={
                  partField(index, "entryId") !== ""
                    ? [partField(index, "entryId")]
                    : []
                }
                onChange={(ids) => setPart(index, "entryId", ids[0] ?? "")}
                multiple={false}
              />
            )}
            <RowActions
              onUp={() => movePart(index, -1)}
              onDown={() => movePart(index, 1)}
              upLabel={`Move part ${index + 1} up`}
              downLabel={`Move part ${index + 1} down`}
              onRemove={() =>
                setComponents(components.filter((_, i) => i !== index))
              }
              removeLabel={`Remove part ${index + 1}`}
            />
          </div>
        ))}
        <button
          type="button"
          className="editor-add"
          onClick={() => setComponents([...components, {}])}
        >
          + part
        </button>
      </div>
      <ProblemMarker
        problems={edit.fieldProblems(item.id, "payload.components")}
      />
    </>
  );
}

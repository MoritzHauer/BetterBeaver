import { useEffect, useMemo, useState } from "react";
import type { Content, Item } from "@betterbeaver/schema";
import type {
  AdhocMode,
  VocabList,
  VocabListStore,
} from "@betterbeaver/engine";
import { ADHOC_MODES, availableModes } from "@betterbeaver/engine";
import { getAssetUrl } from "../content/bundled";
import { SpeakerButton, useTtsAvailable } from "../tts";

export const ADHOC_MODE_LABELS: Record<AdhocMode, string> = {
  recall: "Flashcards",
  recognize: "Multiple choice",
  matching: "Matching",
  listen: "Listening",
};

type Lexeme = Extract<Item, { kind: "lexeme" }>;

/** Case-insensitive search over a lexeme's script, transliteration, gloss, and synonyms. */
function matchesSearch(lexeme: Lexeme, query: string): boolean {
  const q = query.toLowerCase();
  return [
    lexeme.payload.script,
    lexeme.payload.transliteration,
    lexeme.payload.gloss,
    ...(lexeme.payload.synonyms ?? []),
  ].some((text) => text.toLowerCase().includes(q));
}

/** One word-list row: script + transliteration + gloss, synonym chips, speaker button, optional picker checkbox. */
function WordRow({
  lexeme,
  topicId,
  readAloudLang,
  picker,
}: {
  lexeme: Lexeme;
  topicId: string;
  readAloudLang: string | undefined;
  picker?: { checked: boolean; toggle: () => void } | undefined;
}) {
  const audioRef = lexeme.payload.audioRef;
  return (
    <li className="word-row">
      {picker !== undefined ? (
        <input
          type="checkbox"
          checked={picker.checked}
          onChange={picker.toggle}
          aria-label={`Include ${lexeme.payload.script}`}
        />
      ) : null}
      <div className="word-text">
        <strong>{lexeme.payload.script}</strong>{" "}
        <span className="status">{lexeme.payload.transliteration}</span>
        <p>{lexeme.payload.gloss}</p>
        {lexeme.payload.synonyms !== undefined &&
        lexeme.payload.synonyms.length > 0 ? (
          <p className="chips">
            {lexeme.payload.synonyms.map((synonym) => (
              <span key={synonym} className="chip">
                {synonym}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <SpeakerButton
        text={lexeme.payload.script}
        lang={readAloudLang}
        assetUrl={
          audioRef !== undefined
            ? getAssetUrl(topicId, "audio", audioRef)
            : undefined
        }
      />
    </li>
  );
}

/** The learner-chosen exercise-mode picker for one word group; unavailable
 * modes are greyed out with the engine's reason (plan 0004's runtime floors). */
function ModePicker({
  name,
  items,
  readAloudLang,
  onPick,
  onCancel,
}: {
  name: string;
  items: Item[];
  readAloudLang: string | undefined;
  onPick: (mode: AdhocMode) => void;
  onCancel: () => void;
}) {
  const ttsAvailable = useTtsAvailable(readAloudLang);
  const modes = availableModes(items, { ttsAvailable });
  return (
    <section className="mode-picker">
      <h2>
        Study {name} ({items.length} words)
      </h2>
      <ul className="card-list">
        {ADHOC_MODES.map((mode) => (
          <li
            key={mode}
            className={`card${modes[mode] !== null ? " locked" : ""}`}
          >
            <button
              disabled={modes[mode] !== null}
              onClick={() => onPick(mode)}
            >
              <strong>{ADHOC_MODE_LABELS[mode]}</strong>
              {modes[mode] !== null ? (
                <p className="status">{modes[mode]}</p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <button className="plain" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}

/**
 * Vocabulary screen (plan 0004): every lexeme of the topic grouped by unit
 * (searchable, with synonyms and speaker buttons), learner word lists
 * (create/rename/delete with a checkbox item picker), and a study entry
 * point per group (unit vocabulary or list) via the mode picker.
 */
export function VocabularyScreen({
  content,
  listStore,
  onStudy,
  onBack,
}: {
  content: Content;
  listStore: VocabListStore;
  onStudy: (mode: AdhocMode, itemIds: string[]) => void;
  onBack: () => void;
}) {
  const topicId = content.topic.id;
  const readAloudLang = content.topic.readAloudLang;

  const lexemeById = useMemo(
    () =>
      new Map(
        content.items
          .filter((item): item is Lexeme => item.kind === "lexeme")
          .map((item) => [item.id, item]),
      ),
    [content],
  );
  const unitGroups = useMemo(
    () =>
      content.units
        .map((unit) => ({
          unit,
          lexemes: unit.itemIds.flatMap((id) => {
            const lexeme = lexemeById.get(id);
            return lexeme !== undefined ? [lexeme] : [];
          }),
        }))
        .filter((group) => group.lexemes.length > 0),
    [content, lexemeById],
  );

  const [lists, setLists] = useState<VocabList[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    itemIds: Set<string>;
  } | null>(null);
  const [studyTarget, setStudyTarget] = useState<{
    name: string;
    items: Lexeme[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listStore.getLists(topicId).then((stored) => {
      if (!cancelled) {
        // Prune dangling itemIds (content can change between releases). An
        // empty pruned list stays but can't be studied.
        setLists(
          stored.map((list) => ({
            ...list,
            itemIds: list.itemIds.filter((id) => lexemeById.has(id)),
          })),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [listStore, topicId, lexemeById]);

  function listItems(list: VocabList): Lexeme[] {
    return list.itemIds.flatMap((id) => {
      const lexeme = lexemeById.get(id);
      return lexeme !== undefined ? [lexeme] : [];
    });
  }

  async function saveEditing() {
    if (editing === null) {
      return;
    }
    const list: VocabList = {
      id: editing.id,
      name: editing.name.trim(),
      itemIds: [...editing.itemIds],
    };
    await listStore.saveList(topicId, list);
    setLists((current) => {
      const index = current.findIndex((l) => l.id === list.id);
      return index === -1
        ? [...current, list]
        : current.map((l) => (l.id === list.id ? list : l));
    });
    setEditing(null);
  }

  async function deleteList(listId: string) {
    await listStore.deleteList(topicId, listId);
    setLists((current) => current.filter((l) => l.id !== listId));
  }

  if (studyTarget !== null) {
    return (
      <main>
        <ModePicker
          name={studyTarget.name}
          items={studyTarget.items}
          readAloudLang={readAloudLang}
          onPick={(mode) =>
            onStudy(
              mode,
              studyTarget.items.map((item) => item.id),
            )
          }
          onCancel={() => setStudyTarget(null)}
        />
      </main>
    );
  }

  const picking = editing !== null;

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          &larr; {content.topic.title}
        </button>
      </header>
      <h1>Vocabulary</h1>

      <section>
        <h2>Your lists</h2>
        {editing !== null ? (
          <div className="list-editor">
            <input
              type="text"
              placeholder="List name"
              value={editing.name}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
            />
            <p className="status">
              {editing.itemIds.size} words selected — tick words below
            </p>
            <div className="grade-buttons">
              <button
                className="primary"
                disabled={editing.name.trim() === ""}
                onClick={() => void saveEditing()}
              >
                Save
              </button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <ul className="card-list">
              {lists.map((list) => (
                <li key={list.id} className="card">
                  <div>
                    <strong>{list.name}</strong>
                    <p className="status">{list.itemIds.length} words</p>
                    <div className="grade-buttons">
                      <button
                        disabled={list.itemIds.length === 0}
                        onClick={() =>
                          setStudyTarget({
                            name: `“${list.name}”`,
                            items: listItems(list),
                          })
                        }
                      >
                        Study
                      </button>
                      <button
                        onClick={() =>
                          setEditing({
                            id: list.id,
                            name: list.name,
                            itemIds: new Set(list.itemIds),
                          })
                        }
                      >
                        Edit
                      </button>
                      <button onClick={() => void deleteList(list.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={() =>
                setEditing({
                  id: crypto.randomUUID(),
                  name: "",
                  itemIds: new Set(),
                })
              }
            >
              New list
            </button>
          </>
        )}
      </section>

      <input
        type="text"
        placeholder="Search words"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {unitGroups.map(({ unit, lexemes }) => {
        const visible =
          search.trim() === ""
            ? lexemes
            : lexemes.filter((lexeme) => matchesSearch(lexeme, search.trim()));
        if (visible.length === 0) {
          return null;
        }
        return (
          <section key={unit.id}>
            <header className="screen-header">
              <h2>{unit.title}</h2>
              {!picking ? (
                <button
                  className="plain"
                  onClick={() =>
                    setStudyTarget({ name: unit.title, items: lexemes })
                  }
                >
                  Study
                </button>
              ) : null}
            </header>
            <ul className="word-list">
              {visible.map((lexeme) => (
                <WordRow
                  key={lexeme.id}
                  lexeme={lexeme}
                  topicId={topicId}
                  readAloudLang={readAloudLang}
                  picker={
                    editing !== null
                      ? {
                          checked: editing.itemIds.has(lexeme.id),
                          toggle: () =>
                            setEditing((current) => {
                              if (current === null) {
                                return current;
                              }
                              const itemIds = new Set(current.itemIds);
                              if (itemIds.has(lexeme.id)) {
                                itemIds.delete(lexeme.id);
                              } else {
                                itemIds.add(lexeme.id);
                              }
                              return { ...current, itemIds };
                            }),
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

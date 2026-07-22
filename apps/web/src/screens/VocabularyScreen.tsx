import { useEffect, useMemo, useState } from "react";
import type { Content, Family, Item } from "@betterbeaver/schema";
import { itemDisplayText, recognizePrompt } from "@betterbeaver/schema";
import type {
  AdhocMode,
  DomainContent,
  UserEntryStore,
  VocabList,
  VocabListStore,
} from "@betterbeaver/engine";
import { ADHOC_MODES, availableModes, shuffle } from "@betterbeaver/engine";
import { AddWordForm } from "../components/AddWordForm";
import { EntryPopup } from "../components/EntryPopup";
import type { TapLookup } from "../components/TappableText";
import { TappableText } from "../components/TappableText";
import { getLexiconAssetUrl } from "../content/bundled";
import type { SynonymLink } from "../content/links";
import { synonymScriptsByEntryId } from "../content/links";
import { exportBackup, importBackup } from "../progress/backup";
import { ITEM_STATE_PREFIX } from "../progress/local-storage";
import { SAVED_LIST_ID, saveWordToSavedList } from "../progress/vocab-lists";
import { USER_ENTRY_ID_PREFIX } from "../progress/user-entries";
import { SpeakerButton, useTtsAvailable } from "../tts";

export const ADHOC_MODE_LABELS: Record<AdhocMode, string> = {
  recall: "Flashcards",
  recognize: "Multiple choice",
  matching: "Matching",
  listen: "Listening",
};

type Lexeme = Extract<Item, { kind: "lexeme" }>;

/** Case-insensitive search over a lexeme's script, transliteration, gloss, and (link-resolved) synonyms. */
function matchesSearch(
  lexeme: Lexeme,
  synonyms: SynonymLink[],
  query: string,
): boolean {
  const q = query.toLowerCase();
  return [
    lexeme.payload.script,
    lexeme.payload.transliteration,
    lexeme.payload.gloss,
    ...synonyms.map((synonym) => synonym.script),
  ].some((text) => text.toLowerCase().includes(q));
}

/** One word-list row: script + transliteration + gloss, synonym chips
 * (resolved from `synonym`-type links, plan 0006), speaker button, optional
 * picker checkbox. */
function WordRow({
  lexeme,
  synonyms,
  domainId,
  readAloudLang,
  lookup,
  onOpenEntry,
  picker,
}: {
  lexeme: Lexeme;
  synonyms: SynonymLink[];
  domainId: string;
  readAloudLang: string | undefined;
  lookup: TapLookup;
  /** Opens the given entry's popup (plan 0006 step 5): shared screen-level
   * state, since only one popup can be open at a time. */
  onOpenEntry: (entryId: string) => void;
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
        <strong>
          <TappableText text={lexeme.payload.script} lookup={lookup} />
        </strong>{" "}
        <span className="status">{lexeme.payload.transliteration}</span>
        <p>{lexeme.payload.gloss}</p>
        {synonyms.length > 0 ? (
          <p className="chips">
            {synonyms.map((synonym) => (
              <button
                key={synonym.entryId}
                type="button"
                className="plain chip"
                onClick={() => onOpenEntry(synonym.entryId)}
              >
                {synonym.script}
              </button>
            ))}
          </p>
        ) : null}
      </div>
      <SpeakerButton
        text={lexeme.payload.script}
        lang={readAloudLang}
        assetUrl={
          audioRef !== undefined
            ? getLexiconAssetUrl(domainId, "audio", audioRef)
            : undefined
        }
      />
    </li>
  );
}

/** One row in the "My words" section (plan 0006). Generic over the domain's
 * entry kind (lexeme or concept — a general domain's user words are
 * concepts) unlike `WordRow`, which only ever renders shipped lexemes. */
function MyWordRow({
  entry,
  domainId,
  readAloudLang,
  lookup,
  onSave,
  onDelete,
}: {
  entry: Item;
  domainId: string;
  readAloudLang: string | undefined;
  lookup: TapLookup;
  onSave: () => void;
  onDelete: () => void;
}) {
  const audioRef =
    entry.kind === "lexeme" || entry.kind === "concept"
      ? entry.payload.audioRef
      : undefined;
  return (
    <li className="word-row">
      <div className="word-text">
        <strong>
          <TappableText text={recognizePrompt(entry)} lookup={lookup} />
        </strong>
        <p>{itemDisplayText(entry)}</p>
      </div>
      <SpeakerButton
        text={recognizePrompt(entry)}
        lang={readAloudLang}
        assetUrl={
          audioRef !== undefined
            ? getLexiconAssetUrl(domainId, "audio", audioRef)
            : undefined
        }
      />
      <div className="grade-buttons">
        <button onClick={onSave}>&#9733; Save</button>
        <button onClick={onDelete}>Delete</button>
      </div>
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
 * Vocabulary screen (plan 0004; re-scoped to the domain by plan 0006): every
 * lexeme of the domain grouped by unit across all of the domain's books
 * (searchable, with synonyms and speaker buttons), learner word lists
 * (create/rename/delete with a checkbox item picker), a "My words" section
 * for learner-created entries (add/save/delete), and a study entry point
 * per group (unit vocabulary, list, or My words) via the mode picker. Also
 * hosts the JSON backup export/import (plan 0006's durability floor).
 */
export function VocabularyScreen({
  booksContent,
  domainContent,
  listStore,
  userEntryStore,
  onWordsChanged,
  onStudy,
  onBack,
}: {
  /** Every book belonging to the domain (plan 0006's per-domain grouping). */
  booksContent: Content[];
  /** The domain's merged entry pool (shipped + user, plan 0006). */
  domainContent: DomainContent;
  listStore: VocabListStore;
  userEntryStore: UserEntryStore;
  /** Called after a learner-created word is added or deleted, so the caller
   * can re-merge the domain's entry pool (the entry store is the source of
   * truth; this screen only mutates it). */
  onWordsChanged: () => void;
  onStudy: (mode: AdhocMode, itemIds: string[]) => void;
  onBack: () => void;
}) {
  const domainId = domainContent.domain.id;
  const readAloudLang = domainContent.domain.readAloudLang;
  // Bundled tap-to-lookup dependencies (plan 0006 step 4), passed down to
  // every `TappableText` on this screen's vocabulary rows.
  const lookup: TapLookup = {
    domainContent,
    listStore,
    userEntryStore,
    onWordsChanged,
  };

  const synonymsByItemId = useMemo(
    () => synonymScriptsByEntryId(domainContent),
    [domainContent],
  );

  // The domain's full lexicon (plan 0006): every lexeme entry, whether or
  // not any book's unit references it — lists may hold any of them.
  const lexemeById = useMemo(
    () =>
      new Map(
        domainContent.entries
          .filter((item): item is Lexeme => item.kind === "lexeme")
          .map((item) => [item.id, item]),
      ),
    [domainContent],
  );
  // Learner-created entries (plan 0006), regardless of unit reference —
  // that's the point of "My words": a freshly added word has no unit yet.
  const userEntries = useMemo(
    () =>
      domainContent.entries.filter((entry) =>
        entry.id.startsWith(USER_ENTRY_ID_PREFIX),
      ),
    [domainContent],
  );
  const unitGroups = useMemo(
    () =>
      booksContent.flatMap((bookContent) =>
        bookContent.units
          .map((unit) => ({
            unit,
            lexemes: unit.itemIds.flatMap((id) => {
              const lexeme = lexemeById.get(id);
              return lexeme !== undefined ? [lexeme] : [];
            }),
          }))
          .filter((group) => group.lexemes.length > 0),
      ),
    [booksContent, lexemeById],
  );
  // Dangling-id pruning pool (plan 0006, pinned): book-owned items across
  // every domain book, union the domain's *merged* (shipped + user)
  // lexicon entries — never shipped alone, or a saved user word would be
  // pruned away on every load. Broader than `lexemeById` (lexemes only, for
  // display) so a list never loses an itemId the domain still actually owns.
  const entryPoolIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bookContent of booksContent) {
      for (const item of bookContent.items) {
        ids.add(item.id);
      }
    }
    for (const entry of domainContent.entries) {
      ids.add(entry.id);
    }
    return ids;
  }, [booksContent, domainContent]);

  const [lists, setLists] = useState<VocabList[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    itemIds: Set<string>;
  } | null>(null);
  const [addingWord, setAddingWord] = useState(false);
  const [studyTarget, setStudyTarget] = useState<{
    name: string;
    items: Item[];
  } | null>(null);
  // Which entry's popup is open, if any (plan 0006 step 5's synonym-chip
  // navigation) — shared across all rows, since only one can be open at once.
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listStore.getLists(domainId).then((stored) => {
      if (!cancelled) {
        // Prune dangling itemIds (content can change between releases). An
        // empty pruned list stays but can't be studied.
        setLists(
          stored.map((list) => ({
            ...list,
            itemIds: list.itemIds.filter((id) => entryPoolIds.has(id)),
          })),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [listStore, domainId, entryPoolIds]);

  /** Resolves itemIds to shipped lexemes against the domain's lexicon —
   * shared by "Your lists" and the families section below (both study a
   * plain id list). */
  function resolveLexemes(itemIds: string[]): Lexeme[] {
    return itemIds.flatMap((id) => {
      const lexeme = lexemeById.get(id);
      return lexeme !== undefined ? [lexeme] : [];
    });
  }

  function listItems(list: VocabList): Lexeme[] {
    return resolveLexemes(list.itemIds);
  }

  /** Copies a shipped family into a new learner list (plan 0006 step 5's
   * "copy to my lists" action) — read-only families aren't editable, so
   * "copying" is the only way to build on one. */
  async function copyFamilyToLists(family: Family) {
    const list: VocabList = {
      id: crypto.randomUUID(),
      name: family.name,
      itemIds: [...family.entryIds],
    };
    await listStore.saveList(domainId, list);
    setLists((current) => [...current, list]);
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
    await listStore.saveList(domainId, list);
    setLists((current) => {
      const index = current.findIndex((l) => l.id === list.id);
      return index === -1
        ? [...current, list]
        : current.map((l) => (l.id === list.id ? list : l));
    });
    setEditing(null);
  }

  async function deleteList(listId: string) {
    await listStore.deleteList(domainId, listId);
    setLists((current) => current.filter((l) => l.id !== listId));
  }

  /** One-tap save into the built-in "Saved words" list (plan 0006):
   * idempotent — saving an already-saved word id is a no-op, not a
   * duplicate entry. Never touches SRS state (saving isn't learning). Shared
   * with the tap-to-lookup popup via `saveWordToSavedList`. */
  async function saveWord(itemId: string) {
    const updated = await saveWordToSavedList(listStore, domainId, itemId);
    setLists((current) => {
      const index = current.findIndex((l) => l.id === SAVED_LIST_ID);
      return index === -1
        ? [...current, updated]
        : current.map((l) => (l.id === SAVED_LIST_ID ? updated : l));
    });
  }

  /** Fresh 5-random-word matching session over the saved-words pool (plan
   * 0008 point 9/10) — resampled on every press, so unlike the other study
   * entry points this skips the mode picker and calls `onStudy` directly. */
  function practiceMatching(list: VocabList) {
    const pool = listItems(list);
    const sample = shuffle(pool, Math.random).slice(
      0,
      Math.min(5, pool.length),
    );
    onStudy(
      "matching",
      sample.map((item) => item.id),
    );
  }

  /** Adds a learner-created word (plan 0006): creates the entry only — no
   * list membership, no SRS state. It becomes studyable simply by existing
   * in the merged pool once the caller re-merges via `onWordsChanged`. */
  async function addWord(item: Item) {
    await userEntryStore.saveEntry(domainId, item);
    setAddingWord(false);
    onWordsChanged();
  }

  /** Deletes a learner-created word and its SRS state (plan 0006). List
   * memberships and inbound links disappear via the existing dangling-id
   * pruning above once the merged pool no longer contains the id. */
  async function deleteWord(entryId: string) {
    await userEntryStore.deleteEntry(domainId, entryId);
    localStorage.removeItem(`${ITEM_STATE_PREFIX}${entryId}`);
    onWordsChanged();
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
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          Books
        </button>
      </header>
      <h1>Vocabulary &mdash; {domainContent.domain.title}</h1>

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
                      {list.id === SAVED_LIST_ID && list.itemIds.length >= 2 ? (
                        <button onClick={() => practiceMatching(list)}>
                          Practice matching
                        </button>
                      ) : null}
                      {list.id !== SAVED_LIST_ID ? (
                        <button onClick={() => void deleteList(list.id)}>
                          Delete
                        </button>
                      ) : null}
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

      <section>
        <h2>Word families</h2>
        {domainContent.families.length > 0 ? (
          <ul className="card-list">
            {domainContent.families.map((family) => (
              <li key={family.id} className="card">
                <div>
                  <strong>{family.name}</strong>
                  <p className="status">{family.entryIds.length} words</p>
                  <div className="grade-buttons">
                    <button
                      disabled={family.entryIds.length === 0}
                      onClick={() =>
                        setStudyTarget({
                          name: `“${family.name}”`,
                          items: resolveLexemes(family.entryIds),
                        })
                      }
                    >
                      Study
                    </button>
                    <button onClick={() => void copyFamilyToLists(family)}>
                      Copy to my lists
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="status">No word families yet.</p>
        )}
      </section>

      <section>
        <header className="screen-header">
          <h2>My words</h2>
          {!addingWord && userEntries.length > 0 ? (
            <button
              className="plain"
              onClick={() =>
                setStudyTarget({ name: "My words", items: userEntries })
              }
            >
              Study
            </button>
          ) : null}
        </header>
        {addingWord ? (
          <AddWordForm
            domain={domainContent.domain}
            onSubmit={(item) => void addWord(item)}
            onCancel={() => setAddingWord(false)}
          />
        ) : (
          <button onClick={() => setAddingWord(true)}>Add word</button>
        )}
        {userEntries.length > 0 ? (
          <ul className="word-list">
            {userEntries.map((entry) => (
              <MyWordRow
                key={entry.id}
                entry={entry}
                domainId={domainId}
                readAloudLang={readAloudLang}
                lookup={lookup}
                onSave={() => void saveWord(entry.id)}
                onDelete={() => void deleteWord(entry.id)}
              />
            ))}
          </ul>
        ) : null}
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
            : lexemes.filter((lexeme) =>
                matchesSearch(
                  lexeme,
                  synonymsByItemId.get(lexeme.id) ?? [],
                  search.trim(),
                ),
              );
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
                  synonyms={synonymsByItemId.get(lexeme.id) ?? []}
                  domainId={domainId}
                  readAloudLang={readAloudLang}
                  lookup={lookup}
                  onOpenEntry={setOpenEntryId}
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

      <section>
        <h2>Backup</h2>
        <p className="status">
          Export every list, saved word, and review state to a JSON file, or
          restore from one.
        </p>
        <div className="grade-buttons">
          <button onClick={exportBackup}>Export</button>
          <label className="card" style={{ cursor: "pointer" }}>
            Import
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file === undefined) {
                  return;
                }
                if (
                  window.confirm(
                    "Importing replaces all current learner data (lists, saved/my words, and review progress) with the file's contents. Continue?",
                  )
                ) {
                  void importBackup(file).then(() => window.location.reload());
                }
              }}
            />
          </label>
        </div>
      </section>

      {openEntryId !== null ? (
        <EntryPopup
          token={openEntryId}
          entryId={openEntryId}
          lookup={lookup}
          onClose={() => setOpenEntryId(null)}
        />
      ) : null}
    </main>
  );
}

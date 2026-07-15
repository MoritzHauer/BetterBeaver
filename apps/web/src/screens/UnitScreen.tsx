import { useState } from "react";
import type { Content, Item, Task } from "@betterbeaver/schema";
import { stripClozeMarkup } from "@betterbeaver/schema";
import type { TapLookup } from "../components/TappableText";
import { TappableText } from "../components/TappableText";
import { NoteView } from "../components/NoteView";
import { EntryPopup } from "../components/EntryPopup";
import { getLexiconAssetUrl, getNoteMarkdown } from "../content/bundled";
import { SpeakerButton } from "../tts";

type LexemeItem = Extract<Item, { kind: "lexeme" }>;
type ConceptItem = Extract<Item, { kind: "concept" }>;
type ExampleItem = Extract<Item, { kind: "sentence" | "pair" }>;

/** An "Examples" card: `sentence` and `pair` items only (kind-partitioned
 * unit restructure) — `lexeme`/`concept` now render as table rows instead.
 * The target-language script is wrapped in `TappableText` (full-string
 * whitespace tokenization is correct here, unlike notes: a sentence/pair's
 * script is pure target-language text, not mixed prose); translation/contrast
 * text stays plain. */
function ExampleCard({
  item,
  lookup,
}: {
  item: ExampleItem;
  lookup: TapLookup;
}) {
  if (item.kind === "sentence") {
    return (
      <li className="card">
        <strong>{item.payload.translation}</strong>
        <p>
          <TappableText
            text={stripClozeMarkup(item.payload.text)}
            lookup={lookup}
          />
        </p>
      </li>
    );
  }
  return (
    <li className="card">
      <strong>
        <TappableText text={item.payload.a.script} lookup={lookup} /> /{" "}
        <TappableText text={item.payload.b.script} lookup={lookup} />
      </strong>
      <p>{item.payload.contrast}</p>
    </li>
  );
}

function TaskCard({
  task,
  attempted,
  onPractice,
}: {
  task: Task;
  attempted: boolean;
  onPractice: () => void;
}) {
  return (
    <li className="card">
      <div>
        <strong>{task.type}</strong>
        {attempted ? <span className="badge done"> &#10003; done</span> : null}
        {task.instructions !== undefined ? <p>{task.instructions}</p> : null}
        <button className="primary" onClick={onPractice}>
          Practice
        </button>
      </div>
    </li>
  );
}

export function UnitScreen({
  content,
  unitId,
  attemptedTaskIds,
  lookup,
  onPractice,
  onBack,
}: {
  content: Content;
  unitId: string;
  attemptedTaskIds: ReadonlySet<string>;
  /** Tap-to-lookup dependencies (plan 0006 step 4): note views are a pinned
   * non-graded surface. */
  lookup: TapLookup;
  onPractice: (taskId: string) => void;
  onBack: () => void;
}) {
  // Which shipped lexicon entry's popup is open, if any (kind-partitioned
  // restructure's Vocabulary table): opened by id directly, same
  // "open a known entry" pattern as VocabularyScreen's synonym chips —
  // never re-resolved by token, since the table row already is the entry.
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const unit = content.units.find((u) => u.id === unitId);
  if (unit === undefined) {
    return (
      <main>
        <button onClick={onBack}>&larr; Back</button>
        <p>Unknown unit: {unitId}</p>
      </main>
    );
  }

  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const taskById = new Map(content.tasks.map((task) => [task.id, task]));
  const noteById = new Map(content.notes.map((note) => [note.id, note]));

  const domainId = lookup.domainContent.domain.id;
  const readAloudLang = lookup.domainContent.domain.readAloudLang;

  const notes = unit.noteIds.flatMap((noteId) => {
    const note = noteById.get(noteId);
    if (note === undefined) {
      return [];
    }
    const markdown = getNoteMarkdown(content.topic.id, note.stem);
    return markdown === undefined ? [] : [{ noteId, markdown }];
  });

  const items = unit.itemIds.flatMap((itemId) => {
    const item = itemById.get(itemId);
    return item !== undefined ? [item] : [];
  });
  const lexemes = items.filter(
    (item): item is LexemeItem => item.kind === "lexeme",
  );
  const concepts = items.filter(
    (item): item is ConceptItem => item.kind === "concept",
  );
  const examples = items.filter(
    (item): item is ExampleItem =>
      item.kind === "sentence" || item.kind === "pair",
  );

  return (
    <main>
      <button onClick={onBack}>&larr; {content.topic.title}</button>
      <h1>{unit.title}</h1>
      <p>{unit.goal}</p>

      {notes.length > 0 ? (
        <details open className="unit-section">
          <summary>Theory</summary>
          {notes.map(({ noteId, markdown }) => (
            <section key={noteId} className="note">
              <NoteView markdown={markdown} lookup={lookup} />
            </section>
          ))}
        </details>
      ) : null}

      {lexemes.length > 0 ? (
        <details open className="unit-section">
          <summary>Vocabulary</summary>
          <table className="vocab-table">
            <thead>
              <tr>
                <th>Script</th>
                <th>Transliteration</th>
                <th>Gloss</th>
                <th>Audio</th>
              </tr>
            </thead>
            <tbody>
              {lexemes.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      type="button"
                      className="plain tappable-token"
                      onClick={() => setOpenEntryId(item.id)}
                    >
                      {item.payload.script}
                    </button>
                  </td>
                  <td>{item.payload.transliteration}</td>
                  <td>{item.payload.gloss}</td>
                  <td>
                    <SpeakerButton
                      text={item.payload.script}
                      lang={readAloudLang}
                      assetUrl={
                        item.payload.audioRef !== undefined
                          ? getLexiconAssetUrl(
                              domainId,
                              "audio",
                              item.payload.audioRef,
                            )
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {concepts.length > 0 ? (
        <details open className="unit-section">
          <summary>Concepts</summary>
          <table className="vocab-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((item) => (
                <tr key={item.id}>
                  <td>{item.payload.term}</td>
                  <td>{item.payload.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {examples.length > 0 ? (
        <details open className="unit-section">
          <summary>Examples</summary>
          <ul className="card-list">
            {examples.map((item) => (
              <ExampleCard key={item.id} item={item} lookup={lookup} />
            ))}
          </ul>
        </details>
      ) : null}

      <details open className="unit-section">
        <summary>Quiz</summary>
        <ul className="card-list">
          {unit.taskIds.map((taskId) => {
            const task = taskById.get(taskId);
            return task === undefined ? null : (
              <TaskCard
                key={taskId}
                task={task}
                attempted={attemptedTaskIds.has(taskId)}
                onPractice={() => onPractice(taskId)}
              />
            );
          })}
        </ul>
      </details>

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

import { useState } from "react";
import type { Content, Item, Task } from "@betterbeaver/schema";
import { stripClozeMarkup } from "@betterbeaver/schema";
import type { SelfGrade } from "@betterbeaver/srs";
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
  const [showTranslation, setShowTranslation] = useState(false);

  if (item.kind === "sentence") {
    return (
      <li className="card">
        <p>
          <TappableText
            text={stripClozeMarkup(item.payload.text)}
            lookup={lookup}
          />
        </p>
        {showTranslation ? (
          <strong>{item.payload.translation}</strong>
        ) : (
          <button
            type="button"
            className="plain tappable-token"
            onClick={() => setShowTranslation(true)}
          >
            Show translation
          </button>
        )}
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

/** One Theory note plus its self-grade row (plan 0008 step 7): a note has no
 * separate "study it once" action, so grading is offered right here —
 * reviewing *is* how a note first gets SRS state, same self-grade vocabulary
 * (Again/Hard/Good) as `SessionScreen`'s `NoteReview`. */
function NoteCard({
  markdown,
  lookup,
  onGrade,
}: {
  markdown: string;
  lookup: TapLookup;
  onGrade: (grade: SelfGrade) => void;
}) {
  return (
    <section className="note">
      <NoteView markdown={markdown} lookup={lookup} />
      <p>Review this note:</p>
      <div className="grade-buttons">
        <button onClick={() => onGrade("again")}>Again</button>
        <button onClick={() => onGrade("hard")}>Hard</button>
        <button onClick={() => onGrade("good")}>Good</button>
      </div>
    </section>
  );
}

function TaskCard({
  task,
  attempted,
  pinned,
  onPractice,
  onTogglePin,
}: {
  task: Task;
  attempted: boolean;
  pinned: boolean;
  onPractice: () => void;
  onTogglePin: () => void;
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
        <button className="plain" onClick={onTogglePin}>
          {pinned ? "📌 Pinned" : "📌 Pin"}
        </button>
      </div>
    </li>
  );
}

export function UnitScreen({
  content,
  unitId,
  attemptedTaskIds,
  pinnedTaskIds,
  lookup,
  onPractice,
  onTogglePin,
  onGradeNote,
  onBack,
}: {
  content: Content;
  unitId: string;
  attemptedTaskIds: ReadonlySet<string>;
  /** Task ids pinned for priority in this domain's review queue (plan 0008). */
  pinnedTaskIds: ReadonlySet<string>;
  /** Tap-to-lookup dependencies (plan 0006 step 4): note views are a pinned
   * non-graded surface. */
  lookup: TapLookup;
  onPractice: (taskId: string) => void;
  onTogglePin: (taskId: string) => void;
  /** Self-grades a note (plan 0008 step 7) — first grading schedules it,
   * entering it into the domain's review queue like any other unit. */
  onGradeNote: (noteId: string, grade: SelfGrade) => void;
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
      <button onClick={onBack}>
        &larr;{" "}
        {content.lessons.find((l) => l.id === unit.lessonId)?.title ??
          content.topic.title}
      </button>
      <h1>{unit.title}</h1>
      <p>{unit.goal}</p>

      {notes.length > 0 ? (
        <details open className="unit-section">
          <summary>Theory</summary>
          {notes.map(({ noteId, markdown }) => (
            <NoteCard
              key={noteId}
              markdown={markdown}
              lookup={lookup}
              onGrade={(grade) => onGradeNote(noteId, grade)}
            />
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
                pinned={pinnedTaskIds.has(taskId)}
                onPractice={() => onPractice(taskId)}
                onTogglePin={() => onTogglePin(taskId)}
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

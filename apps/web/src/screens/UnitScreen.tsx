import type { Content, Item, Task } from "@betterbeaver/schema";
import { getNoteMarkdown } from "../content/bundled";

/** Splits a note's raw markdown into its display title and body paragraphs. */
function parseNote(markdown: string): { title: string; paragraphs: string[] } {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("# "));
  const title =
    headingIndex === -1 ? "" : (lines[headingIndex] ?? "").slice(2).trim();
  const bodyLines = headingIndex === -1 ? lines : lines.slice(headingIndex + 1);
  const paragraphs = bodyLines
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
  return { title, paragraphs };
}

function ItemCard({ item }: { item: Item }) {
  switch (item.kind) {
    case "concept":
      return (
        <li className="card">
          <strong>{item.payload.term}</strong>
          <p>{item.payload.definition}</p>
        </li>
      );
    case "lexeme":
      return (
        <li className="card">
          <strong>{item.payload.script}</strong>
          <p>{item.payload.transliteration}</p>
          <p>{item.payload.gloss}</p>
          {item.payload.usageNote !== undefined ? (
            <p className="usage-note">{item.payload.usageNote}</p>
          ) : null}
        </li>
      );
    case "sentence":
    case "pair":
      // New item kinds from plan 0002; a rendering component lands in plan
      // 0002 step 4.
      throw new Error("not implemented: plan 0002 step 4");
  }
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
      <strong>{task.type}</strong>
      {attempted ? <span className="done-mark"> &#10003; done</span> : null}
      {task.instructions !== undefined ? <p>{task.instructions}</p> : null}
      <button onClick={onPractice}>
        {task.type === "recognize" ? "Practice" : "Recall practice"}
      </button>
    </li>
  );
}

export function UnitScreen({
  content,
  unitId,
  attemptedTaskIds,
  onPractice,
  onBack,
}: {
  content: Content;
  unitId: string;
  attemptedTaskIds: ReadonlySet<string>;
  onPractice: (taskId: string) => void;
  onBack: () => void;
}) {
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

  return (
    <main>
      <button onClick={onBack}>&larr; {content.topic.title}</button>
      <h1>{unit.title}</h1>
      <p>{unit.goal}</p>

      {unit.noteIds.map((noteId) => {
        const note = noteById.get(noteId);
        if (note === undefined) {
          return null;
        }
        const markdown = getNoteMarkdown(content.topic.id, note.stem);
        if (markdown === undefined) {
          return null;
        }
        const { title, paragraphs } = parseNote(markdown);
        return (
          <section key={noteId} className="note">
            <h2>{title}</h2>
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </section>
        );
      })}

      <h2>Items</h2>
      <ul className="card-list">
        {unit.itemIds.map((itemId) => {
          const item = itemById.get(itemId);
          return item === undefined ? null : (
            <ItemCard key={itemId} item={item} />
          );
        })}
      </ul>

      <h2>Tasks</h2>
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
    </main>
  );
}

/**
 * A note's human-readable title: its leading `# ` heading, which every
 * authored note already carries and which `NoteView`'s parser has always used
 * as the rendered `<h2>`.
 *
 * Lives here rather than in `NoteView.tsx` because the editor's pickers need
 * the same label and `entityPicker.ts` is deliberately DOM-free. A note's
 * `stem` is an id, and since ids became generated (spec 0018) a stem is a
 * UUID — useless as a list label. Falls back to the stem so an untitled note
 * is still selectable.
 */
export function noteTitle(markdown: string, stem: string): string {
  const heading = markdown
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  return heading !== undefined && heading !== "" ? heading : stem;
}

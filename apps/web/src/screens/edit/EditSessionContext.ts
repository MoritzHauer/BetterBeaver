import { createContext, useContext } from "react";
import type {
  BookDocument,
  Content,
  DomainDocument,
} from "@betterbeaver/schema";
import type { Problem } from "@betterbeaver/engine";
import type { AssetView } from "./AssetsManager";

/** Which lifecycle a document is edited through (plan 0012 §5, plan 0017
 * §3) — the same three `EditScreen` dispatches on, now branches inside one
 * session rather than three components. */
export type EditMode = "maintain" | "propose" | "private";

export type SaveState = "saved" | "saving" | "error";

export type PublishState =
  | { s: "idle" }
  | { s: "checking" }
  | { s: "publishing" }
  | { s: "errors"; errors: string[] }
  | { s: "done"; message: string };

/**
 * What an in-place editing surface reads (spec 0021-5 §1). Exposed through
 * context rather than props because slices 6-7 need it three levels down
 * inside `UnitScreen`'s sub-pages, and threading a dozen props through
 * `BookScreen`/`LessonScreen`/`UnitScreen` for something only edit mode
 * reads would distort every learner signature.
 */
export interface EditSessionValue {
  mode: EditMode;
  book: BookDocument;
  /** The Book's own lexicon. An empty stand-in when it hasn't loaded — a
   * failed lexicon load leaves the Book editable rather than blocking the
   * session (spec 0021-5 §5), and `canEditLexicon` is false in that case. */
  domain: DomainDocument;
  changeBook: (next: BookDocument) => void;
  changeDomain: (next: DomainDocument) => void;
  /** What the learner screens render in edit mode (§2d): the draft through
   * `draftContent`, which cannot fail on a mid-edit document. */
  content: Content;
  /** Raw note markdown from the draft, for `UnitScreen`'s `noteMarkdown`
   * prop — the module-global `getNoteMarkdown` only knows published text. */
  noteMarkdown: (stem: string) => string | undefined;
  /** From slice 4; recomputed on change. Slices 6-8 render these. */
  problems: Problem[];
  /** The same problems keyed by entity, so a per-entity surface doesn't
   * re-scan the flat list once per input per render. */
  problemsByEntity: Map<string, Problem[]>;
  /** True when this build's CONTENT_SCHEMA_VERSION is behind the document's. */
  readOnly: boolean;
  /** False when the signed-in user does not maintain the lexicon (§4). */
  canEditLexicon: boolean;
  /** The **Book's** Storage objects. A book item's `audioRef`/`imageRef`
   * validates against these (`validate.ts:601`). */
  assets: AssetView[];
  /** The **lexicon's** own, which a lexicon entry's refs validate against
   * instead (`validate.ts:768`). Two pools, not one (spec 0021-8 §2c):
   * offering the Book's images for a lexicon entry authors a ref that passes
   * the picker and fails publish. */
  lexiconAssets: AssetView[];
  /** Uploads into the **Book's** prefix, so it is offered on a book item's
   * row and never on a lexicon entry's (§2c). */
  uploadAsset?: (file: File) => Promise<void>;
  save: SaveState;
  publish: PublishState;
}

const EditSessionContext = createContext<EditSessionValue | null>(null);

export const EditSessionProvider = EditSessionContext.Provider;

/** `null` outside a session, so a learner-mode screen calls it safely and
 * renders read-only. */
export function useEditSession(): EditSessionValue | null {
  return useContext(EditSessionContext);
}

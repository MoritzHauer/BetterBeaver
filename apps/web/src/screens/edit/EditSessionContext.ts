import { createContext, useContext } from "react";
import type {
  BookDocument,
  Content,
  DomainDocument,
} from "@betterbeaver/schema";
import type { ContentDiff, DomainContent, Problem } from "@betterbeaver/engine";
import type { AssetView } from "./AssetsManager";

/** Which lifecycle a document is edited through (plan 0012 §5, plan 0017
 * §3) — the three the form editor dispatched on, now branches inside one
 * session rather than three components. */
export type EditMode = "maintain" | "propose" | "private";

export type SaveState = "saved" | "saving" | "error";

/** Edit / Preview / Diff are modes on the same three screens (spec 0021-9
 * §1, §3), never separate routes — which is why this lives on the session
 * the screens already read rather than in the route. */
export type EditView = "edit" | "preview" | "diff";

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
  /** The draft's own lexicon, in the shape tap-to-lookup takes. Needed
   * because a Book whose *published* copy does not validate has no
   * `domainContent` at all (spec 0021-11 §2), and that is precisely the
   * Book you have entered edit mode to repair. */
  domainContent: DomainContent;
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
  /** Whether the lexicon document is in hand at all. Distinct from
   * `canEditLexicon`, which is also false while it is still loading — the
   * Book's own slot settles first, so a surface that reads a lexicon entry
   * renders at least once before the entry exists (spec 0021-11 §3). */
  lexiconLoaded: boolean;
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
  /** Which of the three modes this screen is showing (spec 0021-9). */
  view: EditView;
  setView: (view: EditView) => void;
  /** False for a private Book (§3b): it has no published "before", so there
   * is no Diff tab and the diff is never computed. */
  canDiff: boolean;
  /** The union content, per-entity status and base-side values — `null`
   * whenever `canDiff` is false. */
  diff: ContentDiff | null;
  /** The draft assembled as a real, validated `ContentSource` (§1), or the
   * errors that stopped it. Preview of an invalid draft is undefined, so the
   * errors are rendered instead — the same list the publish panel shows. */
  preview: {
    content: Content;
    noteMarkdown: (stem: string) => string | undefined;
  } | null;
  previewErrors: string[];
}

const EditSessionContext = createContext<EditSessionValue | null>(null);

export const EditSessionProvider = EditSessionContext.Provider;

/** `null` outside a session, so a learner-mode screen calls it safely and
 * renders read-only. */
export function useEditSession(): EditSessionValue | null {
  return useContext(EditSessionContext);
}

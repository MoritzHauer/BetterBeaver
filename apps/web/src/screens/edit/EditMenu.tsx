import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import type {
  EditMode,
  EditView,
  PublishState,
  SaveState,
} from "./EditSessionContext";

/** Which full-screen editing panel is open over the learner screen, if any.
 * `forms`/`lexicon` are the transitional form tree (spec 0021-5 §0) — slices
 * 6-8 move their fields onto the screens and slice 11 deletes them. */
export type EditPanel =
  | null
  | "forms"
  | "lexicon"
  | "assets"
  | "proposals"
  | "feedback"
  // The What-changed index (spec 0021-9 §4). A panel, not a tab: it has to
  // be reachable from a screen with no Diff tab, which is exactly where you
  // most need to find the changes.
  | "changed";

/**
 * The `[⋮]` menu (spec 0021-5 §1c): everything edit mode needs that has no
 * in-place home yet — Publish / Suggest changes, Sync, Discard draft,
 * Assets, open proposals, Feedback — plus the way out of edit mode.
 * Available from all three screens, because it is rendered by `EditSession`
 * rather than by any one of them.
 *
 * Per mode: propose shows "Suggest changes" and no Sync/Assets/proposals;
 * private shows none of Publish/Sync/Discard/proposals — a private Book has
 * no such moment, every keystroke is already saved.
 */
export function EditMenu({
  mode,
  panel,
  onPanel,
  onUp,
  onExit,
  save,
  readOnly,
  loading,
  publishState,
  onPublish,
  note,
  onNote,
  syncState,
  onSync,
  onDiscardDraft,
  proposalCount,
  problemCount,
  hasLexicon,
  view,
  onView,
  canDiff,
  diffHere,
  changedCount,
}: {
  mode: EditMode;
  panel: EditPanel;
  onPanel: (panel: EditPanel) => void;
  /** Up one level inside an open form panel; null at its root. */
  onUp: (() => void) | null;
  onExit: () => void;
  save: SaveState;
  readOnly: boolean;
  loading: boolean;
  publishState: PublishState;
  onPublish: () => void;
  note: string;
  onNote: (note: string) => void;
  syncState: "synced" | "unsynced" | "syncing" | "error";
  onSync: (() => Promise<void>) | null;
  onDiscardDraft: (() => Promise<void>) | null;
  proposalCount: number;
  problemCount: number;
  hasLexicon: boolean;
  view: EditView;
  onView: (view: EditView) => void;
  /** False for a private Book (spec 0021-9 §3b): no published "before", so
   * no Diff at all. */
  canDiff: boolean;
  /** Whether *this* screen has anything to diff (§3a). The slot keeps its
   * width either way, or the bar jumps as you walk between a changed and an
   * unchanged screen. */
  diffHere: boolean;
  changedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const busy = publishState.s === "checking" || publishState.s === "publishing";

  const status = loading
    ? "opening…"
    : readOnly
      ? "read-only: this document needs a newer app"
      : save === "saving"
        ? "saving…"
        : save === "error"
          ? "local save failed — storage may be full"
          : "saved on this device";

  const choose = (next: EditPanel) => {
    setOpen(false);
    onPanel(next);
  };

  return (
    <>
      <div className="edit-bar">
        {panel !== null && (
          <button
            className="plain"
            onClick={() => (onUp !== null ? onUp() : onPanel(null))}
            title="Back"
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
              alt="Back"
            />
          </button>
        )}
        {panel === null && (
          <span className="edit-view-tabs">
            <button
              type="button"
              className={view === "edit" ? "active" : undefined}
              onClick={() => onView("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              className={view === "preview" ? "active" : undefined}
              onClick={() => onView("preview")}
            >
              Preview
            </button>
            {/* The slot is always here; only its contents come and go. */}
            <span className="edit-view-diff-slot">
              {canDiff && diffHere && (
                <button
                  type="button"
                  className={view === "diff" ? "active" : undefined}
                  onClick={() => onView("diff")}
                >
                  Diff
                </button>
              )}
            </span>
          </span>
        )}
        <span className="status">
          {view === "preview"
            ? "Preview · nothing you do here is recorded"
            : view === "diff"
              ? "What publishing would change"
              : `Editing · ${status}`}
          {view === "edit" && problemCount > 0 && ` · ${problemCount} to fix`}
        </span>
        <button
          className="plain edit-bar-menu"
          onClick={() => setOpen(true)}
          aria-label="Editing menu"
        >
          ⋮
        </button>
      </div>
      {open && (
        <Sheet label="Editing menu" onDismiss={() => setOpen(false)}>
          <h2>Editing</h2>
          {publishState.s === "errors" && (
            <ul className="error-text">
              {publishState.errors.slice(0, 20).map((error) => (
                <li key={error}>{error}</li>
              ))}
              {publishState.errors.length > 20 && (
                <li>…and {publishState.errors.length - 20} more</li>
              )}
            </ul>
          )}
          {publishState.s === "done" && (
            <p className="status">{publishState.message}</p>
          )}
          {mode === "propose" && (
            <label className="field">
              Note (optional)
              <textarea
                rows={3}
                value={note}
                onChange={(e) => onNote(e.target.value)}
              />
            </label>
          )}
          {mode !== "private" && (
            <button
              className="primary"
              disabled={readOnly || busy || loading}
              onClick={onPublish}
            >
              {publishState.s === "checking"
                ? "Validating…"
                : publishState.s === "publishing"
                  ? mode === "propose"
                    ? "Sending…"
                    : "Publishing…"
                  : mode === "propose"
                    ? "Suggest changes"
                    : "Publish"}
            </button>
          )}
          <ul className="card-list">
            {canDiff && (
              <li className="card">
                <button className="plain" onClick={() => choose("changed")}>
                  What changed
                  {changedCount > 0 && (
                    <span className="badge">{changedCount}</span>
                  )}
                  <span className="status">
                    {changedCount === 0
                      ? "nothing yet"
                      : "everything publishing would change"}
                  </span>
                </button>
              </li>
            )}
            <li className="card">
              <button className="plain" onClick={() => choose("forms")}>
                Edit all fields
                <span className="status">
                  the full form editor, until every field is editable in place
                </span>
              </button>
            </li>
            {hasLexicon && (
              <li className="card">
                <button className="plain" onClick={() => choose("lexicon")}>
                  Words
                </button>
              </li>
            )}
            {mode === "maintain" &&
              onSync !== null &&
              syncState !== "synced" && (
                <li className="card">
                  <button
                    className="plain"
                    disabled={syncState === "syncing"}
                    onClick={() => {
                      setOpen(false);
                      void onSync();
                    }}
                  >
                    {syncState === "syncing"
                      ? "Syncing…"
                      : syncState === "error"
                        ? "Sync failed — try again"
                        : "Sync to server"}
                    <span className="status">
                      local changes are not on the server yet
                    </span>
                  </button>
                </li>
              )}
            {(mode === "maintain" || mode === "private") && (
              <li className="card">
                <button className="plain" onClick={() => choose("assets")}>
                  Assets
                </button>
              </li>
            )}
            {mode === "maintain" && proposalCount > 0 && (
              <li className="card">
                <button className="plain" onClick={() => choose("proposals")}>
                  {proposalCount} open proposal{proposalCount === 1 ? "" : "s"}
                </button>
              </li>
            )}
            {mode === "maintain" && (
              <li className="card">
                <button className="plain" onClick={() => choose("feedback")}>
                  Feedback
                </button>
              </li>
            )}
            {mode === "maintain" && onDiscardDraft !== null && (
              <li className="card">
                <button
                  className="plain danger"
                  onClick={() => {
                    setOpen(false);
                    void onDiscardDraft();
                  }}
                >
                  Discard draft
                </button>
              </li>
            )}
          </ul>
          <button
            onClick={() => {
              setOpen(false);
              onExit();
            }}
          >
            Done editing
          </button>
        </Sheet>
      )}
    </>
  );
}

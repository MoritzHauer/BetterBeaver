import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Modal bottom sheet, and the app's only dialog surface (plan-less dialog
 * pass, 2026-07-29). A real `<dialog>` opened with `showModal()`, which is
 * where Escape-to-dismiss, the focus trap, the inert background, the top
 * layer (so there is no `z-index` to negotiate with the watermark or the
 * action bar) and the `::backdrop` scrim all come from — none of it
 * hand-written. It replaces both the former `.popup-overlay` portal, which
 * had none of those behaviours, and the `window.confirm`/`window.prompt`
 * boxes, which had them but could not be styled or worded.
 *
 * Mount it conditionally; unmounting closes it. `onDismiss` fires for Escape
 * and for a backdrop click — a cancel by any other name — so callers can pass
 * the same handler they give their own cancel button.
 *
 * Portalled to `document.body` for the reason the popup was: pinned
 * tap-to-lookup surfaces mount this from inside `<p>`/`<strong>`, which
 * cannot legally contain a `<dialog>`.
 */
export function Sheet({
  label,
  onDismiss,
  children,
}: {
  /** The dialog's accessible name — normally its own heading text. */
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className="sheet"
      aria-label={label}
      onClose={onDismiss}
      // There is no backdrop element to hang a handler on — `::backdrop` is a
      // pseudo-element. A click whose target is the dialog box itself rather
      // than anything inside `.sheet-body` therefore *is* the backdrop, which
      // is why `.sheet` carries no padding of its own.
      onClick={(event) => {
        if (event.target === ref.current) {
          onDismiss();
        }
      }}
    >
      <div className="sheet-body">{children}</div>
    </dialog>,
    document.body,
  );
}

/**
 * Confirmation sheet: the in-app replacement for `window.confirm`. Both
 * current callers are soft, skippable locks, so the icon is required and the
 * confirming action is the primary one. A destructive variant (no icon, the
 * `--error-text` outline rather than a primary fill, so a mis-tap lands on
 * cancel) is designed but not built — nothing destructive has migrated yet.
 */
export function ConfirmSheet({
  icon,
  title,
  body,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  /** Icon stem under `art/icons`, shown in the 96px `.summary-icon` slot. */
  icon: string;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet label={title} onDismiss={onCancel}>
      <div className="sheet-prompt">
        <img
          className="summary-icon"
          src={`${import.meta.env.BASE_URL}art/icons/${icon}.png`}
          alt=""
        />
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="sheet-actions">
          <button onClick={onCancel}>{cancelLabel}</button>
          <button className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Title entry for a new private Book: the in-app replacement for
 * `window.prompt`. Create stays disabled until the title is non-blank, so the
 * prompt path's silent no-op on an empty or whitespace-only string — the
 * caller checked for it and simply returned — can no longer be reached.
 */
export function NewBookSheet({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const trimmed = title.trim();

  return (
    <Sheet label="Name your Book" onDismiss={onCancel}>
      <form
        className="sheet-prompt"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(trimmed);
        }}
      >
        <img
          className="summary-icon"
          src={`${import.meta.env.BASE_URL}art/icons/beaver_pencil.png`}
          alt=""
        />
        <h2>Name your Book</h2>
        <label className="field">
          Title
          <input
            type="text"
            autoFocus
            placeholder="Kyrgyz for travel"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <p className="status">You can rename it later in the editor.</p>
        <div className="sheet-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={trimmed === ""}>
            Create
          </button>
        </div>
      </form>
    </Sheet>
  );
}

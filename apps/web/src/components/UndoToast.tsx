import { useCallback, useEffect, useRef, useState } from "react";

const DISMISS_MS = 6000;

interface Pending {
  message: string;
  restore: () => void;
}

/**
 * One-snapshot undo (spec 0021-12 §5): holds the single most recently
 * deleted thing, not a stack — a second delete replaces whatever was
 * pending. `capture` takes what to call it (`"Row"`, `"Block"`, `"Table
 * row"`…) and a `restore` closure the caller already has everything for: the
 * draft is a plain object in `EditSession` state (`session.book` /
 * `session.domain`), so `restore` is typically `() =>
 * session.changeBook(bookBeforeTheDelete)` — captured *before* the mutation
 * that follows `capture()`, not after.
 *
 * ponytail: one step of history, not a stack. Upgrade path is a stack, if a
 * second undo is ever actually asked for.
 */
export function useUndoSnapshot() {
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const capture = useCallback((thing: string, restore: () => void) => {
    clearTimer();
    setPending({ message: `${thing} deleted`, restore });
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(null);
    }, DISMISS_MS);
  }, []);

  // `pending` in the dep array, not the updater-function form: React
  // StrictMode double-invokes a `setState` updater in development to catch
  // impure ones, and `restore()` is a caller-supplied side effect, not a
  // pure state transition — calling it from inside the updater would run it
  // twice per Undo.
  const undo = useCallback(() => {
    clearTimer();
    pending?.restore();
    setPending(null);
  }, [pending]);

  return { message: pending?.message ?? null, capture, undo };
}

/**
 * The toast itself (spec 0021-12 §5): `"<Thing> deleted"` and an Undo
 * button. `role="status"`/`aria-live="polite"` so it's announced without
 * moving focus — the author is still typing, so this steals neither focus
 * nor keyboard. Render conditionally on `useUndoSnapshot`'s `message`.
 */
export function UndoToast({
  message,
  onUndo,
}: {
  message: string;
  onUndo: () => void;
}) {
  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="plain" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

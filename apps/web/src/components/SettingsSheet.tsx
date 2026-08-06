import type { ReactNode } from "react";
import { Sheet } from "./Sheet";

/**
 * Settings sheet (spec 0021-12 §4): a title, the caller's own fields, and a
 * "Done" button that dismisses. Nothing more — this owns the chrome, not the
 * fields. Built on `Sheet` rather than an inline expansion so that opening
 * it never reflows the page underneath: tapping a block's ⚙ must not move
 * the block.
 */
export function SettingsSheet({
  title,
  onDismiss,
  children,
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet label={title} onDismiss={onDismiss}>
      <h2>{title}</h2>
      {children}
      <button onClick={onDismiss}>Done</button>
    </Sheet>
  );
}

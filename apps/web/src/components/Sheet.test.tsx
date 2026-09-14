import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmSheet } from "./Sheet";

/**
 * The destructive `ConfirmSheet` variant (ui-review 2026-09-13). The file had
 * described this variant as designed-but-unbuilt; what the tests below pin is
 * the reason it was designed that way — the loud button must be the *safe*
 * one, so a mis-tap on an irreversible action lands on "keep". A test that
 * only checked "a dialog appears" would pass with the emphasis backwards.
 */
afterEach(cleanup);

describe("ConfirmSheet", () => {
  it("gives cancel the primary fill and confirm the danger outline when destructive", () => {
    render(
      <ConfirmSheet
        destructive
        title="Delete “кел”?"
        body="Its review history goes with it."
        cancelLabel="Keep it"
        confirmLabel="Delete"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const cancel = screen.getByRole("button", { name: "Keep it" });
    expect(cancel.classList.contains("primary")).toBe(true);
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm.classList.contains("danger-outline")).toBe(true);
    expect(confirm.classList.contains("primary")).toBe(false);
  });

  it("shows no icon when destructive — there is no reassuring picture of data loss", () => {
    render(
      <ConfirmSheet
        destructive
        icon="beaver_pencil"
        title="Discard your draft?"
        body="3 unpublished changes go back to the published version."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    // Queried off `document`, not RTL's container: `Sheet` portals to
    // document.body, so a container query here would pass no matter what.
    expect(document.querySelector(".summary-icon")).toBeNull();
  });

  it("keeps the soft variant's emphasis: confirm is primary, and its icon renders", () => {
    render(
      <ConfirmSheet
        icon="beaver_pencil"
        title="Skip ahead?"
        body="This unit is not unlocked yet."
        cancelLabel="Not now"
        confirmLabel="Skip ahead"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Skip ahead" });
    expect(confirm.classList.contains("primary")).toBe(true);
    const cancel = screen.getByRole("button", { name: "Not now" });
    expect(cancel.classList.contains("primary")).toBe(false);
    expect(document.querySelector(".summary-icon")).not.toBeNull();
  });

  it("routes each button to its own handler, and never confirms on cancel", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmSheet
        destructive
        title="Delete “кел”?"
        body="Its review history goes with it."
        cancelLabel="Keep it"
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("treats a backdrop click as cancel, not as confirm", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmSheet
        destructive
        title="Delete “кел”?"
        body="Its review history goes with it."
        cancelLabel="Keep it"
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    // A click landing on the dialog box itself rather than `.sheet-body` is
    // the backdrop; `Sheet` routes it to onDismiss.
    const dialog = document.querySelector("dialog.sheet");
    expect(dialog).not.toBeNull();
    fireEvent.click(dialog as Element);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

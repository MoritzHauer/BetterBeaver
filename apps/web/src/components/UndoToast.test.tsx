import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { UndoToast, useUndoSnapshot } from "./UndoToast";

/** Exercises the hook through a real component tree, the way slices 12b/13/14
 * will: a "draft" value, a Delete that snapshots it before mutating, and the
 * toast rendered only while a snapshot is pending. */
function Harness() {
  const { message, capture, undo } = useUndoSnapshot();
  const [value, setValue] = useState("first");

  return (
    <div>
      <span data-testid="value">{value}</span>
      <button
        onClick={() => {
          const before = value;
          capture("Row", () => setValue(before));
          setValue(`${value}-deleted`);
        }}
      >
        Delete
      </button>
      {message !== null && <UndoToast message={message} onUndo={undo} />}
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useUndoSnapshot / UndoToast", () => {
  it("shows the toast on delete and Undo restores the snapshot", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("value").textContent).toBe("first-deleted");
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Row deleted");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("value").textContent).toBe("first");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses itself after ~6s without restoring anything", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("status")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByRole("status")).toBeNull();
    // The auto-dismiss is not an undo: the mutation stands.
    expect(screen.getByTestId("value").textContent).toBe("first-deleted");
  });

  it("a second delete replaces the pending snapshot, not stacks it", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("value").textContent).toBe(
      "first-deleted-deleted",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // One step back, not two: undo lands on the value before the *second*
    // delete, and the first delete is not separately recoverable.
    expect(screen.getByTestId("value").textContent).toBe("first-deleted");
  });

  it("clears its pending timer on unmount", () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const { unmount } = render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    clearSpy.mockClear();
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});

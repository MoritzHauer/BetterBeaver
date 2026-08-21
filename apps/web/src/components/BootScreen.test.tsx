import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BootScreen } from "./BootScreen";
import { readNavDiary } from "../nav-diary";

/**
 * The splash exists for the case where the boot never finishes: before it,
 * `main.tsx` rendered nothing until `initContentSource()` settled, so a stall
 * was an empty root — a black screen on the dark theme, with no way out but
 * killing the app.
 */
describe("BootScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the app's name from the first frame", () => {
    render(<BootScreen />);

    expect(screen.getByText("BetterBeaver")).toBeTruthy();
    expect(screen.getByText("Starting…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("offers a way out, and says so in the diary, once the boot stalls", () => {
    render(<BootScreen />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(readNavDiary().map((entry) => entry.event)).toContain(
      "boot-stalled",
    );
  });
});

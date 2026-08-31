import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { readNavDiary } from "../nav-diary";

/**
 * Before this existed, a render throw unmounted the whole root and left a
 * bare `<body>` — a black screen on the dark theme, indistinguishable from
 * the navigation bug and from a failed boot. The point of the boundary is
 * that a crash is *legible*, so that is what is asserted: the message on
 * screen, and the same message left in the diary for afterwards.
 */
function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    localStorage.clear();
    // React logs the caught error itself; the boundary adds one more. Neither
    // is a test failure, and both would drown the run's output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the error instead of unmounting to a blank page", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "Something broke" }),
    ).toBeTruthy();
    expect(screen.getByText("kaboom")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload the app" })).toBeTruthy();
  });

  it("records the crash in the nav diary", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(readNavDiary().filter((entry) => entry.event === "crash")).toEqual([
      expect.objectContaining({ detail: "kaboom" }),
    ]);
  });

  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("all good")).toBeTruthy();
  });
});

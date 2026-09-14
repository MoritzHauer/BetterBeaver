import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AboutScreen } from "./AboutScreen";
import { APP_VERSION, REPO_URL } from "../version";

/**
 * The About page exists to answer two questions from a screenshot: which
 * build is this, and where is the source. Both are easy to break silently —
 * the version comes through a `define` that only the app's own vite config
 * sets, and a stale repo URL still renders fine.
 */
// This file had no cleanup and only one test, so nothing noticed; a second
// render then found the first test's DOM still mounted.
afterEach(cleanup);

describe("AboutScreen", () => {
  it("shows the build version and links the repository", () => {
    render(
      <AboutScreen
        onBack={() => {}}
        onImpressum={() => {}}
        onPrivacy={() => {}}
      />,
    );

    expect(screen.getByText(new RegExp(`Version ${APP_VERSION}`))).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Source code on GitHub" })
        .getAttribute("href"),
    ).toBe(REPO_URL);
  });

  /* Before this, About named both pages in prose and offered no way to reach
     them — the reader had to back out to home and find the footer row
     (ui-review 2026-09-13, finding sc-legal). */
  it("navigates to the Impressum and Datenschutz pages it names", () => {
    const onImpressum = vi.fn();
    const onPrivacy = vi.fn();
    render(
      <AboutScreen
        onBack={() => {}}
        onImpressum={onImpressum}
        onPrivacy={onPrivacy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Impressum" }));
    expect(onImpressum).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Datenschutz" }));
    expect(onPrivacy).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutScreen } from "./AboutScreen";
import { APP_VERSION, REPO_URL } from "../version";

/**
 * The About page exists to answer two questions from a screenshot: which
 * build is this, and where is the source. Both are easy to break silently —
 * the version comes through a `define` that only the app's own vite config
 * sets, and a stale repo URL still renders fine.
 */
describe("AboutScreen", () => {
  it("shows the build version and links the repository", () => {
    render(<AboutScreen onBack={() => {}} />);

    expect(screen.getByText(new RegExp(`Version ${APP_VERSION}`))).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Source code on GitHub" })
        .getAttribute("href"),
    ).toBe(REPO_URL);
  });
});

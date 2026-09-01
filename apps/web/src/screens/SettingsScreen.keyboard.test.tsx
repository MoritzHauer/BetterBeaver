import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";
import { getLearning } from "../learning";

/**
 * The Settings half of plan 0025 §10: the key-row toggle, and the setup card
 * re-opened after it was dismissed in a session. Both render only for a
 * domain that declares `extraChars` — a learner whose script has no missing
 * characters has nothing to set up and no row to want.
 */

function renderSettings(extraChars?: string[]) {
  render(
    <SettingsScreen
      onBack={() => {}}
      onAbout={() => {}}
      onSignIn={() => {}}
      onImportBook={() => Promise.resolve()}
      importPrivateBook={() => Promise.resolve()}
      refreshContent={() => Promise.resolve()}
      extraChars={extraChars}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("Settings: the keyboard rows", () => {
  it("shows neither row for a domain that declares no extra characters", () => {
    renderSettings();
    expect(screen.queryByText(/under typed answers/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "How to add the keyboard" }),
    ).toBeNull();
  });

  it("toggles the key row, off by default", () => {
    renderSettings(["ң", "ө", "ү"]);
    const toggle = screen.getByLabelText(/under typed answers/);
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(getLearning().extraKeys).toBe(true);
  });

  it("re-opens the walkthrough a session dismissed", () => {
    renderSettings(["ң", "ө", "ү"]);
    expect(screen.queryByText("Typing ң ө ү")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "How to add the keyboard" }),
    );
    expect(screen.getByText("Typing ң ө ү")).toBeTruthy();
    // Opened deliberately, so there is nothing to dismiss — Back is the way
    // out, and dismissing again would be a no-op on a flag already set.
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
  });
});

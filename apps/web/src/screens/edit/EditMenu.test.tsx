import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EditMenu } from "./EditMenu";
import type { EditMode } from "./EditSessionContext";

/**
 * Spec 0021-5 §1c pins what the `[⋮]` menu carries per mode. Private is the
 * one worth a test of its own: a private Book has no account, no server and
 * no draft/published split, so Publish, Sync, Discard draft and open
 * proposals are not "disabled" there — they have no meaning at all, and
 * offering any of them would promise something the mode cannot do.
 */
async function open(
  mode: EditMode,
  extra: Partial<Parameters<typeof EditMenu>[0]> = {},
) {
  render(
    <EditMenu
      mode={mode}
      panel={null}
      onPanel={() => {}}
      onUp={null}
      onExit={() => {}}
      save="saved"
      readOnly={false}
      loading={false}
      publishState={{ s: "idle" }}
      onPublish={() => {}}
      note=""
      onNote={() => {}}
      syncState="unsynced"
      onSync={async () => {}}
      onDiscardDraft={async () => {}}
      proposalCount={2}
      problemCount={0}
      hasLexicon
      view="edit"
      onView={() => {}}
      canDiff={mode !== "private"}
      diffHere={false}
      changedCount={0}
      {...extra}
    />,
  );
  screen.getByRole("button", { name: "Editing menu" }).click();
  await screen.findByRole("heading", { name: "Editing" });
}

describe("the [⋮] editing menu", () => {
  afterEach(cleanup);

  it("offers a private Book no Publish, Sync, Discard or proposals", async () => {
    // The three that make no sense without a server are passed as *present*
    // on purpose: the mode, not a missing callback, is what has to hide them.
    await open("private");

    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sync/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: /open proposal/ })).toBeNull();
    // What it does have: the editing surfaces and the way out.
    expect(
      screen.getByRole("button", { name: /Edit all fields/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done editing" })).toBeTruthy();
  });

  it("offers a maintainer Publish, Sync, Discard and the open proposals", async () => {
    await open("maintain");

    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sync to server/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /2 open proposals/ }),
    ).toBeTruthy();
  });

  it("offers a proposer only Suggest changes", async () => {
    await open("propose");

    expect(
      screen.getByRole("button", { name: "Suggest changes" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sync/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assets" })).toBeNull();
    expect(screen.queryByRole("button", { name: /open proposal/ })).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Domain, Item } from "@betterbeaver/schema";
import { AddWordForm } from "./AddWordForm";

const languageDomain: Domain = {
  id: "ky",
  code: "ky",
  kind: "language",
  title: "Kyrgyz",
  glossLanguage: "en",
};

afterEach(() => {
  cleanup();
});

describe("AddWordForm", () => {
  // Spec 0021-3 §4a widens this component with optional `makeId`/`sourceRef`
  // props, defaulted so the two existing call sites (VocabularyScreen,
  // EntryPopup) need no edit. This test is what proves the widening didn't
  // silently change the learner path: with neither prop given, a submitted
  // entry must still get a `user-`-prefixed id and `sourceRef: "user"` —
  // exactly what the old hardcoded locals produced.
  it("with no makeId/sourceRef given, submits a user- prefixed id and sourceRef 'user'", () => {
    const onSubmit = vi.fn<(item: Item) => void>();
    render(
      <AddWordForm
        domain={languageDomain}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Script"), {
      target: { value: "Салам" },
    });
    fireEvent.change(screen.getByPlaceholderText("Transliteration"), {
      target: { value: "Salam" },
    });
    fireEvent.change(screen.getByPlaceholderText("Gloss (meaning)"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const item = onSubmit.mock.calls[0]![0];
    expect(item.id.startsWith("user-")).toBe(true);
    expect(item.sourceRef).toBe("user");
  });

  it("with makeId/sourceRef given, submits those instead", () => {
    const onSubmit = vi.fn<(item: Item) => void>();
    render(
      <AddWordForm
        domain={languageDomain}
        onSubmit={onSubmit}
        onCancel={() => {}}
        makeId={() => "ky-fixed-id"}
        sourceRef="ky-book-1"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Script"), {
      target: { value: "Салам" },
    });
    fireEvent.change(screen.getByPlaceholderText("Transliteration"), {
      target: { value: "Salam" },
    });
    fireEvent.change(screen.getByPlaceholderText("Gloss (meaning)"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const item = onSubmit.mock.calls[0]![0];
    expect(item.id).toBe("ky-fixed-id");
    expect(item.sourceRef).toBe("ky-book-1");
  });
});

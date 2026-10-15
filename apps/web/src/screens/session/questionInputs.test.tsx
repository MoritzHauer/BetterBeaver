import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AssignQuestion, ChoiceQuestion } from "@betterbeaver/engine";
import { AssignBoard, ChoiceBoard } from "./questionInputs";

/**
 * The boards shuffle what they display and nothing else (owner, 2026-10-15):
 * authored content lists the correct options first, so the authored order
 * gave the answer away, while every index a caller sees stays authored.
 */

const choices = ["A", "B", "C", "D", "E", "F", "G", "H"];
const choice: ChoiceQuestion = {
  kind: "choice",
  unitId: "q",
  stem: "Pick three",
  choices,
  correctIndices: [0, 1, 2],
  selectCount: 3,
  whys: choices.map(() => undefined),
  explanationGenerated: false,
};

function shownOrder(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

afterEach(cleanup);

describe("ChoiceBoard", () => {
  it("is stable for a salt, varies across salts, and reports authored indices", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ChoiceBoard question={choice} selected={[]} onChange={onChange} />,
    );
    const first = shownOrder();
    expect([...first].sort()).toEqual(choices);
    rerender(
      <ChoiceBoard question={choice} selected={[]} onChange={onChange} />,
    );
    expect(shownOrder()).toEqual(first);

    const orders = new Set([first.join("")]);
    for (let salt = 0; salt < 10; salt++) {
      rerender(
        <ChoiceBoard
          question={choice}
          selected={[]}
          onChange={onChange}
          shuffleSalt={String(salt)}
        />,
      );
      orders.add(shownOrder().join(""));
    }
    expect(orders.size).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });
});

describe("AssignBoard", () => {
  it("keeps rows answered by authored index", () => {
    const rows = ["r0", "r1", "r2", "r3", "r4", "r5"];
    const question: AssignQuestion = {
      kind: "assign",
      unitId: "q",
      stem: "Assign",
      rows,
      labels: ["yes", "no"],
      correctLabelIndex: [0, 1, 0, 1, 0, 1],
      whys: rows.map(() => undefined),
      explanationGenerated: false,
    };
    const onChange = vi.fn();
    render(
      <AssignBoard
        question={question}
        chosen={rows.map(() => null)}
        onChange={onChange}
      />,
    );
    const row = screen.getByText("r4").parentElement!;
    fireEvent.click(row.querySelectorAll("button")[1]!);
    expect(onChange).toHaveBeenLastCalledWith([
      null,
      null,
      null,
      null,
      1,
      null,
    ]);
  });
});

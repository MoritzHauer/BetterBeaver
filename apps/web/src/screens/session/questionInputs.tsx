/**
 * The two authored-question inputs (plan 0027 §6), as presentational
 * components: selection state lives with the caller.
 *
 * That split is what lets the practice session and the exam runner share one
 * renderer despite disagreeing about everything else. Practice grades on the
 * spot and reveals the answer; the exam grades nothing until Submit and
 * keeps its answers in an attempt record. Both need the same board, the same
 * selection cap, and the same row picker — so the board is here and the two
 * policies are in their own screens.
 *
 * `reveal` is the only concession to the difference: absent, nothing is
 * marked; present, the authored truth is shown against what was chosen.
 */
import type { AssignQuestion, ChoiceQuestion } from "@betterbeaver/engine";

/**
 * A select-n board. Selection is capped at `selectCount` (plan 0027 §4):
 * over-selection is unreachable rather than penalised, which is the one
 * deliberate deviation from the iSAQB paper rules — every reachable state
 * scores identically, and what is lost is the strategy of marking
 * everything to guarantee a hit.
 *
 * Tapping a selected option always deselects it, so a full board is never a
 * dead end.
 */
export function ChoiceBoard({
  question,
  selected,
  onChange,
  reveal = false,
  disabled = false,
}: {
  question: ChoiceQuestion;
  selected: readonly number[];
  onChange: (next: number[]) => void;
  reveal?: boolean;
  disabled?: boolean;
}) {
  const correct = new Set(question.correctIndices);

  function toggle(index: number) {
    if (selected.includes(index)) {
      onChange(selected.filter((i) => i !== index));
      return;
    }
    if (selected.length >= question.selectCount) {
      return;
    }
    onChange([...selected, index]);
  }

  return (
    <>
      <p className="prompt">{question.stem}</p>
      <p className="status">
        {question.selectCount === 1
          ? "Choose one."
          : `Choose ${question.selectCount}. (${selected.length}/${question.selectCount})`}
      </p>
      <ul className="card-list">
        {question.choices.map((choice, index) => {
          const isSelected = selected.includes(index);
          const state = reveal
            ? correct.has(index)
              ? " correct"
              : isSelected
                ? " incorrect"
                : ""
            : isSelected
              ? " selected"
              : "";
          return (
            <li key={index} className={`card${state}`}>
              <button
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => toggle(index)}
              >
                <span className="option-mark">{isSelected ? "✓" : ""}</span>
                {choice}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * A row-wise assignment board: one row per option, two label buttons each.
 *
 * Every row is judged independently and elimination never helps — the reason
 * plan 0027 §2a puts `assign` a rung above `choice`. A row may be left
 * unanswered (`null`); what that costs is the caller's rule, not the
 * board's.
 */
export function AssignBoard({
  question,
  chosen,
  onChange,
  reveal = false,
  disabled = false,
}: {
  question: AssignQuestion;
  chosen: readonly (number | null)[];
  onChange: (next: (number | null)[]) => void;
  reveal?: boolean;
  disabled?: boolean;
}) {
  function choose(row: number, labelIndex: number) {
    const next = question.rows.map((_, index) => chosen[index] ?? null);
    // Tapping the chosen label again clears the row, which is the only way
    // back to "unanswered" — and in an exam a blank row costs nothing while
    // a wrong one can, so it has to be reachable.
    next[row] = next[row] === labelIndex ? null : labelIndex;
    onChange(next);
  }

  return (
    <>
      <p className="prompt">{question.stem}</p>
      <ul className="card-list assign-rows">
        {question.rows.map((row, rowIndex) => {
          const answer = chosen[rowIndex] ?? null;
          const correct = question.correctLabelIndex[rowIndex];
          const state = !reveal
            ? ""
            : answer === correct
              ? " correct"
              : " incorrect";
          return (
            <li key={rowIndex} className={`card assign-row${state}`}>
              <div>
                <p className="assign-row-text">{row}</p>
                <div className="assign-row-labels">
                  {question.labels.map((label, labelIndex) => (
                    <button
                      key={labelIndex}
                      type="button"
                      className={
                        answer === labelIndex
                          ? "assign-label chosen"
                          : "assign-label"
                      }
                      aria-pressed={answer === labelIndex}
                      disabled={disabled}
                      onClick={() => choose(rowIndex, labelIndex)}
                    >
                      {label}
                      {reveal && labelIndex === correct ? " ✓" : ""}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

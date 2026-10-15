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
import { useMemo, type CSSProperties } from "react";
import {
  shuffle,
  type AssignQuestion,
  type ChoiceQuestion,
} from "@betterbeaver/engine";

/**
 * The order a board lists its options in, as authored indices.
 *
 * Authored content tends to put the correct options first (owner,
 * 2026-10-15: "the first k are correct, the others false"; an `assign`
 * task alternates its labels the same way), so the authored order leaks
 * the answer. The board therefore shuffles what it *shows* — and only that:
 * selection, grading, `whys` and stored exam answers all stay in authored
 * indices, so nothing persisted depends on the shuffle.
 *
 * Seeded from the stem plus `salt`, not drawn fresh: the same question with
 * the same salt lists its options in the same order on every render and
 * every visit, which keeps an exam stable across navigation, reload and its
 * review. Practice passes a per-card random salt so repeats reorder.
 */
function useDisplayOrder(stem: string, length: number, salt: string): number[] {
  return useMemo(() => {
    // FNV-1a over the seed text, then mulberry32 as the shuffle's rng.
    let hash = 0x811c9dc5;
    for (const char of `${salt}\u0000${stem}`) {
      hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
    }
    let state = hash >>> 0;
    const rng = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return shuffle(
      Array.from({ length }, (_, index) => index),
      rng,
    );
  }, [stem, length, salt]);
}

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

/**
 * A question stem, sized down as it gets longer (owner, 2026-09-18: a 180-
 * character exam stem at the prompt's 1.5rem fills a phone screen before the
 * options start).
 *
 * Length, not measured height: the character count is handed to CSS and a
 * `clamp()` does the rest, so there is no ResizeObserver, no measure-then-
 * reflow loop, and the same question is the same size on every device. It is
 * an approximation of height — a stem with a long unbreakable word wraps
 * worse than its count suggests — and the clamp's floor is what keeps that
 * from mattering.
 */
function QuestionStem({ stem }: { stem: string }) {
  return (
    <p
      className="prompt prompt-stem"
      style={{ "--stem-len": stem.length } as CSSProperties}
    >
      {stem}
    </p>
  );
}

export function ChoiceBoard({
  question,
  selected,
  onChange,
  reveal = false,
  disabled = false,
  whys,
  shuffleSalt = "",
}: {
  question: ChoiceQuestion;
  selected: readonly number[];
  onChange: (next: number[]) => void;
  reveal?: boolean;
  disabled?: boolean;
  /** Per-option reasons, aligned with `question.choices` (plan 0027 §5).
   * Rendered only once `reveal` is true — before that, the answer itself is
   * still hidden, so its reasoning has to be too. */
  whys?: readonly (string | undefined)[];
  /** Varies the displayed option order; see `useDisplayOrder`. */
  shuffleSalt?: string;
}) {
  const correct = new Set(question.correctIndices);
  const order = useDisplayOrder(
    question.stem,
    question.choices.length,
    shuffleSalt,
  );

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
      <QuestionStem stem={question.stem} />
      <p className="status">
        {question.selectCount === 1
          ? "Choose one."
          : `Choose ${question.selectCount}. (${selected.length}/${question.selectCount})`}
      </p>
      <ul className="card-list">
        {order.map((index) => {
          const choice = question.choices[index]!;
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
          const why = whys?.[index];
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
              {reveal && why !== undefined ? (
                <p className="option-why">{why}</p>
              ) : null}
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
  whys,
  shuffleSalt = "",
}: {
  question: AssignQuestion;
  chosen: readonly (number | null)[];
  onChange: (next: (number | null)[]) => void;
  reveal?: boolean;
  disabled?: boolean;
  /** Per-row reasons, aligned with `question.rows` (plan 0027 §5). Rendered
   * only once `reveal` is true, same as `ChoiceBoard`'s. */
  whys?: readonly (string | undefined)[];
  /** Varies the displayed row order; see `useDisplayOrder`. */
  shuffleSalt?: string;
}) {
  const order = useDisplayOrder(
    question.stem,
    question.rows.length,
    shuffleSalt,
  );

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
      <QuestionStem stem={question.stem} />
      <ul className="card-list assign-rows">
        {order.map((rowIndex) => {
          const row = question.rows[rowIndex]!;
          const answer = chosen[rowIndex] ?? null;
          const correct = question.correctLabelIndex[rowIndex];
          const state = !reveal
            ? ""
            : answer === correct
              ? " correct"
              : " incorrect";
          const why = whys?.[rowIndex];
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
                {reveal && why !== undefined ? (
                  <p className="option-why">{why}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * A question's explanation, shown once it is graded (plan 0027 §5) —
 * practice, the Check, Review, exam review mode and the exam report all
 * share this one rendering, rather than each drawing its own.
 *
 * `generated` carries the same "KI-generiert" badge the exam card and intro
 * use, for a model-written explanation with no expert review.
 */
export function QuestionFeedback({
  explanation,
  generated,
}: {
  explanation: string | undefined;
  generated: boolean;
}) {
  if (explanation === undefined) {
    return null;
  }
  return (
    <div className="question-feedback">
      <p>{explanation}</p>
      {generated ? <p className="badge-generated">KI-generiert</p> : null}
    </div>
  );
}

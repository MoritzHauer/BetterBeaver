import type { Content, Exercise, Item, Unit } from "@betterbeaver/schema";
import { MAX_EXERCISE_LEVEL, MIN_EXERCISE_LEVEL } from "@betterbeaver/schema";
import {
  authoredExercises,
  itemCoverage,
  targetLevel,
  type LevelCoverage,
} from "@betterbeaver/engine";
import { itemLabel } from "./exerciseOffers";

/**
 * The (item × level) coverage grid (plan 0026 §8) — the Exercises page's
 * answer to what generation costs.
 *
 * Constructed exercises make content problems go quiet: "your unit has three
 * items, so this MCQ is invalid" used to fail the build and is now a
 * silently missing exercise (§7). Per-item level coverage is the
 * compensating control, and the plan promotes it from nice-to-have to
 * required — an author has to be able to see the highest level a unit's
 * content can actually reach, and which words no exercise reaches at all,
 * or the silence is the whole experience.
 *
 * It is literally §1's function run over every cell, which is the point of
 * having built the constructor per (item, level): the grid and the session's
 * draw read the same answer, so what an author sees here is what a learner
 * gets.
 */
export function CoverageGrid({
  unit,
  content,
  itemById,
}: {
  unit: Unit;
  content: Content;
  itemById: Map<string, Item>;
}) {
  const items = unit.itemIds.flatMap((id) => itemById.get(id) ?? []);
  if (items.length === 0) {
    return null;
  }
  const optedIn = content.topic.generatedExercises === true;
  const levels = Array.from(
    { length: MAX_EXERCISE_LEVEL - MIN_EXERCISE_LEVEL + 1 },
    (_, i) => MIN_EXERCISE_LEVEL + i,
  );

  return (
    <section className="coverage">
      <p className="eyebrow">Coverage</p>
      <p className="coverage-lede">
        {optedIn
          ? "Every word, and how far up the ladder this unit can ask it."
          : "Every word, and how far up the ladder this unit can ask it. This Book has not turned generated exercises on, so the filled cells are a preview of what it would gain."}
      </p>
      <div className="coverage-scroll">
        <table className="coverage-grid">
          <thead>
            <tr>
              <th scope="col">Word</th>
              {levels.map((level) => (
                <th key={level} scope="col">
                  {level}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <CoverageRow
                key={item.id}
                item={item}
                content={content}
                optedIn={optedIn}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="coverage-legend">
        <li>
          <span className="coverage-cell is-authored" /> you authored it
        </li>
        <li>
          <span className="coverage-cell is-constructed" /> built from the word
        </li>
        <li>
          <span className="coverage-cell is-beyond" /> past this word&rsquo;s
          target
        </li>
      </ul>
    </section>
  );
}

function CoverageRow({
  item,
  content,
  optedIn,
}: {
  item: Item;
  content: Content;
  optedIn: boolean;
}) {
  const authored = authoredExercises(item, content);
  const rows = itemCoverage(item, content, authored);
  const target = targetLevel(item, content);
  return (
    <tr>
      <th scope="row">
        <span className="coverage-word">{itemLabel(item)}</span>
        <span className="coverage-reach">{reachSummary(rows, optedIn)}</span>
        {target < MAX_EXERCISE_LEVEL && (
          <span className="coverage-target">stops at {target}</span>
        )}
      </th>
      {rows.map((row) => (
        <td key={row.level} className="coverage-slot">
          {/* The chip is a span inside the cell, not the cell itself: a `td`
              with `display: block` leaves the table row, and the grid
              collapses into one column. */}
          <span
            className={`coverage-cell ${cellClass(row)}`}
            title={cellTitle(row, optedIn)}
          />
        </td>
      ))}
    </tr>
  );
}

/** Which of the four things an (item, level) cell is. */
function cellClass(row: LevelCoverage): string {
  if (row.authored.length > 0) {
    return "is-authored";
  }
  if (row.beyondTarget) {
    return "is-beyond";
  }
  // A cell the constructor could fill is shown filled even before the Book
  // opts in — that is the preview half of "preview with overrides", and
  // hiding it would leave the author unable to see what the switch buys.
  return row.constructed.length > 0 ? "is-constructed" : "is-empty";
}

function cellTitle(row: LevelCoverage, optedIn: boolean): string {
  const named = (exercises: readonly Exercise[]) => exercises.join(", ");
  if (row.authored.length > 0) {
    return `Level ${row.level}: your ${named(row.authored)} exercise`;
  }
  if (row.beyondTarget) {
    return `Level ${row.level}: past this word's target`;
  }
  if (row.constructed.length === 0) {
    return `Level ${row.level}: nothing reaches this word here`;
  }
  return optedIn
    ? `Level ${row.level}: built from the word (${named(row.constructed)})`
    : `Level ${row.level}: ${named(row.constructed)}, once this Book turns generated exercises on`;
}

/**
 * The one sentence §7 asks for per word: the highest level this content can
 * actually reach, or that nothing reaches it at all.
 *
 * Before the Book opts in the two numbers differ, and both are worth saying
 * — the second is the whole argument for ticking the switch.
 */
function reachSummary(
  rows: readonly LevelCoverage[],
  optedIn: boolean,
): string {
  const top = (reached: readonly LevelCoverage[]) => reached.at(-1)?.level;
  const authored = top(rows.filter((row) => row.authored.length > 0));
  const generated = top(
    rows.filter((row) => row.authored.length > 0 || row.constructed.length > 0),
  );
  if (optedIn) {
    return generated === undefined
      ? "no exercise reaches this word"
      : `reaches level ${generated}`;
  }
  if (authored === undefined) {
    return generated === undefined
      ? "no exercise reaches this word"
      : `no exercise reaches this word — level ${generated} if generated`;
  }
  return generated === undefined || generated === authored
    ? `reaches level ${authored}`
    : `reaches level ${authored} — ${generated} if generated`;
}

/**
 * The injected randomness every session builder shares.
 *
 * Its own module rather than a corner of `session.ts` because the exercise
 * draw (plan 0025 §4) needs it too, and `session.ts` imports the draw — one
 * of them had to move or the two would form an import cycle, which
 * typechecks fine and leaves a `const` undefined at module init.
 */

/** Uniform random number in [0, 1), injected so sessions are reproducible in tests. */
export type Rng = () => number;

/**
 * Fisher-Yates shuffle of a copy of `items`, using `rng` for the swap index
 * at each step. Pinned algorithm: iterate `i` from `length - 1` down to 1,
 * `j = Math.floor(rng() * (i + 1))`, swap `i` and `j`. Exported for the
 * ad-hoc session builder (plan 0004) — the one shuffle everywhere.
 */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i >= 1; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

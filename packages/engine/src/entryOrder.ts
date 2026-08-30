/**
 * Tie-break for multiple equally-good entry matches (plan 0006, pinned):
 * shipped entries win over learner-created (`user-`-prefixed) ones, then the
 * lowest id lexicographically — deterministic, and the popup's link chips
 * make the runner-up reachable.
 *
 * Its own module, and not re-exported from the package index: `lookup.ts` and
 * `proposeSplit.ts` both resolve text against the same entry pool, so they
 * have to break a tie the same way, but the rule is engine-internal and no
 * caller outside it picks winners.
 */
export function pickBest<T extends { id: string }>(candidates: T[]): T {
  return [...candidates].sort((a, b) => {
    const aUser = a.id.startsWith("user-");
    const bUser = b.id.startsWith("user-");
    if (aUser !== bUser) {
      return aUser ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;
}

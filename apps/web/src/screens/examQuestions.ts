import type { Content } from "@betterbeaver/schema";
import { buildFixedSession, type Question } from "@betterbeaver/engine";

/** `choice`/`assign` questions never consume the rng — `questionItemQuestion`
 * (session.ts) builds them straight from the item payload — so a constant
 * stands in for the seeded one every other `buildFixedSession` caller uses. */
export const NO_RNG = () => 0;

export type PickedQuestion = Extract<Question, { kind: "choice" | "assign" }>;

/**
 * `taskId` → its `choice`/`assign` question, for the given tasks (plan 0027
 * §6): the runner and the report both need one question per `taskId`, not
 * `buildFixedSession`'s position-keyed list, and an exam's own tasks resolve
 * to exactly one question each once content has validated.
 */
export function examQuestionsByTaskId(
  taskIds: readonly string[],
  content: Content,
): Map<string, PickedQuestion> {
  const pairs = buildFixedSession(taskIds, content, NO_RNG);
  const map = new Map<string, PickedQuestion>();
  for (const pair of pairs) {
    if (pair.question.kind === "choice" || pair.question.kind === "assign") {
      map.set(pair.taskId, pair.question);
    }
  }
  return map;
}

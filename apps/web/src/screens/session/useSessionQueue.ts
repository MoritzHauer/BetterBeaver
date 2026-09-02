/**
 * The running order of a session: which question is on screen, what happens
 * when one is answered, and when the session is over.
 *
 * Its own hook because it is the one part of a session that is genuinely
 * stateful — everything else in `SessionScreen` is either a prop or a
 * render. Keeping it here means the screen reads as a screen, and a change
 * to how a session sequences its questions has exactly one place to land.
 */
import { useEffect, useRef, useState } from "react";
import type { Question } from "@betterbeaver/engine";

/** One question's outcome, as the drill needs to hear it (plan 0025 §6). */
export interface SessionOutcome {
  unitId: string;
  correct: boolean;
}

export interface SessionQueue {
  /** The question on screen, or `undefined` when there is nothing to show. */
  question: Question | undefined;
  /** Its index in `questions`, for the caller's parallel arrays. */
  source: number | undefined;
  /** True once the last question has been answered. */
  done: boolean;
  /** Moves to the next question, or ends the session. */
  advance: () => void;
  /** How many questions have been answered, for the progress bar. */
  position: number;
  /** How many the session holds as of now — a requeue lengthens it. */
  length: number;
}

export function useSessionQueue(
  questions: Question[],
  /**
   * Extends a session whose questions are decided as it goes (plan 0025 §6):
   * called when the last question has been answered, and returns true when
   * it appended another to `questions`. Absent for a session that knows
   * every question before it starts — review and ad-hoc study.
   */
  extend?: () => boolean,
): SessionQueue {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);

  /**
   * The live queue, as positions into `questions` rather than copies of
   * them. Positions, not copies, because `questions` is a live prop — the
   * scoped `✎` sheet re-derives it from the draft mid-session, and a
   * snapshot would freeze the session on the pre-edit text.
   *
   * Re-showing a missed card is no longer done here (plan 0025 §11 retired
   * plan 0022 §4's same-session requeue): the drill decides that, and its
   * replacement comes back a level lower and in every session type rather
   * than Daily Review alone. This queue only ever walks forward.
   */
  const [queue, setQueue] = useState<{ source: number }[]>(() =>
    questions.map((_, source) => ({ source })),
  );

  /**
   * The queue's length as of *now*, including an insertion made earlier in
   * this same tick. `advance()` runs immediately after the grade handler
   * that requeues, in the same closure, where `queue` is still the
   * pre-insertion array — without this, failing the last card of a review
   * would end the session on the spot and the requeued card would never be
   * shown. Re-synced on every render, so it can never drift.
   */
  const queueLength = useRef(queue.length);
  queueLength.current = queue.length;

  // Keep the queue in step with a `questions` prop that changed under us:
  // drop entries whose question is gone, append ones that appeared. Requeued
  // visits of surviving questions are preserved. Returning `current`
  // unchanged when nothing moved is what keeps this from looping.
  useEffect(() => {
    setQueue((current) => {
      const kept = current.filter((entry) => entry.source < questions.length);
      const seen = new Set(kept.map((entry) => entry.source));
      const added = questions
        .map((_, source) => source)
        .filter((source) => !seen.has(source))
        .map((source) => ({ source }));
      return kept.length === current.length && added.length === 0
        ? current
        : [...kept, ...added];
    });
  }, [questions.length]);

  // Clamped, not a bare `queue[index]`: the questions now re-derive from
  // the draft while the scoped `✎` sheet is open, and the sheet's exercise
  // card can drop an item — shrinking the list under a session already past
  // that point. `index` would then read past the end and the body rendered
  // blank with no way forward. Empty list still lands on `undefined`, which
  // the render below already handles.
  const entry = queue[Math.min(index, queue.length - 1)];
  const source = entry?.source;
  const question = source === undefined ? undefined : questions[source];

  function advance() {
    // Asked at the end, not on every answer: a drill decides whether there
    // is more to do only once the current card is done with. `queueLength`
    // is bumped for the same reason the requeue used to bump it — this runs
    // in the closure where `questions` is still the pre-append array.
    if (extend !== undefined && index + 1 >= queueLength.current) {
      if (extend()) {
        queueLength.current += 1;
      }
    }
    if (index + 1 >= queueLength.current) {
      setDone(true);
    } else {
      // Snapshot form (not a functional updater) so a stray double-call
      // within one render advances once, never skipping a question.
      setIndex(index + 1);
    }
  }

  return {
    question,
    source,
    done,
    advance,
    position: index,
    length: queue.length,
  };
}

/**
 * Learning settings (plan 0022 §8): review pace, skip length, and the typed
 * key row. The scheduler row is gone — plan 0025 §11 removed classic SM-2,
 * so there is nothing left to choose between.
 *
 * One `bb.learning` key holding one JSON object, which is what makes this
 * free of migration and export work — `progress/backup.ts` sweeps every
 * `bb.*` key, so export/import and "erase all my data" already cover it.
 * Absent, corrupt, or partially-written values fall back per field rather
 * than wholesale, so an unrecognised pace can never strand the scheduler.
 *
 * Global by force, not by choice: design.md pins "one word = one SRS state
 * across topics" and `bb.item.*` is keyed by item id with no Book scope, so
 * a per-Book pace would have two schedulers writing contradictory intervals
 * into one lexeme's single state.
 */
import {
  DEFAULT_SCHEDULING,
  REVIEW_PACES,
  type ReviewPace,
  type SchedulingConfig,
} from "@betterbeaver/srs";
import { readJson } from "./progress/local-storage";

export const LEARNING_KEY = "bb.learning";

/** How far a Skip pushes a card out (plan 0022 §5). Every length expires by
 * itself, which is why there is no indefinite option and no un-skip surface. */
export type SkipLength = "week" | "month" | "year";

export const SKIP_DAYS: Record<SkipLength, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export interface LearningSettings extends SchedulingConfig {
  skip: SkipLength;
  /** Whether typed exercises show the key row for a domain's `extraChars`
   * (plan 0025 §10). **Default off**: the real fix is the platform keyboard
   * layout, and three keys under every answer are clutter for a learner who
   * installed one. The setup card offers this to anyone who cannot. */
  extraKeys: boolean;
  /** Whether the keyboard setup card has been dismissed (plan 0025 §10).
   * One flag, not one per domain: the card teaches a device-wide skill, and
   * a learner who has added one layout knows where the setting lives. */
  keyboardHelpDismissed: boolean;
}

export const DEFAULT_LEARNING: LearningSettings = {
  ...DEFAULT_SCHEDULING,
  skip: "week",
  extraKeys: false,
  keyboardHelpDismissed: false,
};

function isPace(value: unknown): value is ReviewPace {
  return typeof value === "string" && value in REVIEW_PACES;
}

function isSkip(value: unknown): value is SkipLength {
  return value === "week" || value === "month" || value === "year";
}

/** The stored settings, each field falling back to its default. Never throws:
 * `readJson` treats a blocked `localStorage` as absent. */
export function getLearning(): LearningSettings {
  const stored = readJson<Partial<LearningSettings>>(LEARNING_KEY);
  return {
    pace: isPace(stored?.pace) ? stored.pace : DEFAULT_LEARNING.pace,
    skip: isSkip(stored?.skip) ? stored.skip : DEFAULT_LEARNING.skip,
    extraKeys:
      typeof stored?.extraKeys === "boolean"
        ? stored.extraKeys
        : DEFAULT_LEARNING.extraKeys,
    keyboardHelpDismissed:
      typeof stored?.keyboardHelpDismissed === "boolean"
        ? stored.keyboardHelpDismissed
        : DEFAULT_LEARNING.keyboardHelpDismissed,
  };
}

/** Writes one field, leaving the others as stored. Swallows a write failure
 * the way every other settings toggle does — the setting simply doesn't
 * stick, and `storage-health.ts` already tells the learner storage is
 * unwritable when it matters (their progress isn't being saved either). */
export function setLearning(patch: Partial<LearningSettings>): void {
  const next = { ...getLearning(), ...patch };
  try {
    localStorage.setItem(LEARNING_KEY, JSON.stringify(next));
  } catch {
    // Deliberately ignored — see the doc comment.
  }
}

/** The scheduler half of the settings, for `recordGrade`. Read at grade time
 * rather than cached, so a change in Settings applies to the next answer
 * without any invalidation path. */
export function schedulingConfig(): SchedulingConfig {
  const { pace } = getLearning();
  return { pace };
}

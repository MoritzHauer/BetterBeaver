import { useEffect, useState } from "react";
import type { Content, Lesson, Unit } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import {
  countUnitQuestions,
  localDay,
  nextUnit,
  schedulingUnits,
  type ProgressStore,
  type SchedulingUnit,
  type Streak,
  type UnitProgress,
} from "@betterbeaver/engine";

/** The scheduling units that belong to `lesson`'s own units (plan 0020 §5):
 * filters the content-wide `schedulingUnits(content)` down to whatever a
 * unit's `itemIds`/`noteIds` reach. Reuses `schedulingUnits`' own id
 * construction (never hand-rolls a blank/note id) — class (f) of the content
 * validator guarantees every task item is listed in its owning unit's
 * `itemIds`, so filtering on `itemIds` alone can't under-count. Exported for
 * `LessonSummaryScreen.test.ts`. */
export function lessonSchedulingUnits(
  content: Content,
  lesson: Lesson,
): SchedulingUnit[] {
  const units = lesson.unitIds
    .map((id) => content.units.find((u) => u.id === id))
    .filter((u): u is Unit => u !== undefined);
  const itemIds = new Set(units.flatMap((u) => u.itemIds));
  const noteIds = new Set(units.flatMap((u) => u.noteIds));
  return schedulingUnits(content).filter(
    (su) =>
      (su.item !== undefined && itemIds.has(su.item.id)) ||
      (su.note !== undefined && noteIds.has(su.note.id)),
  );
}

/** "Today" / "Tomorrow" / a formatted date for the earliest due date, in the
 * learner's local calendar (the same day-granularity `SummaryPanel`'s streak
 * check uses) even though `due` itself is stored UTC (plan 0001). Exported
 * for `LessonSummaryScreen.test.ts`. */
export function formatDue(due: Date, now: Date): string {
  const day = localDay(due);
  // `<=`, not `===`: an item that went overdue days ago (this session only
  // graded the other unit's items) is the earliest due date, and rendering
  // its past date under "Next review" would be a lie — it is due *now*.
  // `localDay` is zero-padded YYYY-MM-DD, so string order is date order.
  if (day <= localDay(now)) {
    return "Today";
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day === localDay(tomorrow)) {
    return "Tomorrow";
  }
  return due.toLocaleDateString();
}

interface LessonTiles {
  units: number;
  questions: number;
  inReview: number;
  nextReviewLabel: string | null;
  streak: Streak | null;
}

async function gatherLessonTiles(
  content: Content,
  lesson: Lesson,
  store: ProgressStore,
  now: Date,
): Promise<LessonTiles> {
  const units = lesson.unitIds
    .map((id) => content.units.find((u) => u.id === id))
    .filter((u): u is Unit => u !== undefined);
  const questions = units.reduce(
    (total, unit) => total + countUnitQuestions(unit, content),
    0,
  );
  const schedUnits = lessonSchedulingUnits(content, lesson);
  const states = await Promise.all(
    schedUnits.map((su) => store.getItemState(su.id)),
  );
  const dueMs = states
    .filter((s): s is SrsState => s !== null)
    .map((s) => new Date(s.due).getTime())
    .filter((t) => !Number.isNaN(t));
  const streak = await store.getStreak(content.topic.domainId);
  return {
    units: lesson.unitIds.length,
    questions,
    inReview: states.filter((s) => s !== null).length,
    nextReviewLabel:
      dueMs.length > 0 ? formatDue(new Date(Math.min(...dueMs)), now) : null,
    streak,
  };
}

/** Lesson summary (plan 0020 §5): shown after a unit-practice session that
 * finished the last unit of its lesson. Modeled on `StatsScreen` — an async
 * gather effect over derived, on-device state, nothing persisted here. */
export function LessonSummaryScreen({
  content,
  lessonId,
  unitProgress,
  store,
  onNext,
  onBack,
}: {
  content: Content;
  lessonId: string;
  unitProgress: ReadonlyMap<string, UnitProgress>;
  store: ProgressStore;
  onNext: (target: { lessonId: string; unitId: string }) => void;
  onBack: () => void;
}) {
  const [tiles, setTiles] = useState<LessonTiles | null>(null);
  const lesson = content.lessons.find((l) => l.id === lessonId);

  useEffect(() => {
    if (lesson === undefined) {
      return;
    }
    void gatherLessonTiles(content, lesson, store, new Date()).then(setTiles);
  }, [content, lesson, store]);

  if (lesson === undefined) {
    // Unreachable in practice: App.tsx only routes here once the lesson's
    // own completion has just been confirmed. Defensive fallback matching
    // the "Unknown unit" shape the session branches use.
    return (
      <main>
        <p>Unknown lesson: {lessonId}</p>
      </main>
    );
  }

  if (tiles === null) {
    return (
      <main>
        <p>Loading&hellip;</p>
      </main>
    );
  }

  const next = nextUnit(content, unitProgress);

  return (
    <main>
      {next === null ? (
        <img
          className="summary-icon"
          src={`${import.meta.env.BASE_URL}art/icons/trophy.png`}
          alt=""
        />
      ) : null}
      <h2>{next === null ? "Book complete!" : "Lesson complete!"}</h2>
      {next !== null ? <p>{lesson.title}</p> : null}

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-value">{tiles.units}</span>
          <span className="status">Units</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{tiles.questions}</span>
          <span className="status">Questions</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{tiles.inReview}</span>
          <span className="status">In review</span>
        </div>
        {tiles.nextReviewLabel !== null ? (
          <div className="stat-tile">
            <span className="stat-value">{tiles.nextReviewLabel}</span>
            <span className="status">Next review</span>
          </div>
        ) : null}
        {tiles.streak !== null ? (
          // ponytail: no flame-tick pulse (SummaryPanel's `extendedToday`
          // animation) — that means "this session extended the streak",
          // which only the grading session knows. Add it here by comparing
          // `localDay(new Date())` to `tiles.streak.lastActiveDay` if wanted.
          <div className="stat-tile">
            <span className="stat-value">
              <img
                className="icon-glyph"
                src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
                alt=""
              />{" "}
              {tiles.streak.length}
            </span>
            <span className="status">Day streak</span>
          </div>
        ) : null}
      </div>

      {next !== null ? (
        <button className="primary" onClick={() => onNext(next)}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/play.png`}
            alt=""
          />{" "}
          Next lesson
        </button>
      ) : null}
      <button className={next !== null ? "plain" : "primary"} onClick={onBack}>
        Back to Book
      </button>
    </main>
  );
}

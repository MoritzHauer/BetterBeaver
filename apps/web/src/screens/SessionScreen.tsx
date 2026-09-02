import { useRef, useState } from "react";
import type { Question, QuestionOutcome, Streak } from "@betterbeaver/engine";
import type { Quality, SelfGrade } from "@betterbeaver/srs";
import { recallQuality, recognizeQuality } from "@betterbeaver/srs";
import type { TapLookup } from "../components/TappableText";
import { playCorrect, playWrong } from "../sounds";
import { noteStorageUnwritable } from "../storage-health";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { BookWatermark } from "../components/BookWatermark";
import { Sheet } from "../components/Sheet";
import { SKIP_DAYS, getLearning, type SkipLength } from "../learning";
import { SWIPE_THRESHOLD } from "./UnitScreen";
import { renderInteraction } from "./session/interactions";
import { useSessionQueue } from "./session/useSessionQueue";
import {
  SummaryPanel,
  emptySummary,
  type SessionSummary,
} from "./session/SummaryPanel";

export type { SessionSummary };

/** The scheduling-unit id(s) a question resolves to for pinning purposes: a
 * matching board's several ids (every prompt's and answer's unitId — a
 * matching board is one question), or the single `unitId` of every other
 * kind. */
function questionUnitIds(q: Question): string[] {
  return q.kind === "matching"
    ? [...q.prompts, ...q.answers].map((p) => p.unitId)
    : [q.unitId];
}

/** The three skip lengths (plan 0022 §5), opened by long-press/right-click on
 * Skip. Every one of them expires by itself, which is why there is no
 * indefinite option here and no un-skip screen anywhere: a card the learner
 * genuinely never wants is an authoring problem (delete the item), not a
 * scheduling one. */
function SkipSheet({
  onCancel,
  onSkip,
}: {
  onCancel: () => void;
  onSkip: (skip: SkipLength) => void;
}) {
  return (
    <Sheet label="Skip this card" onDismiss={onCancel}>
      <div className="sheet-prompt">
        <img
          className="summary-icon"
          src={`${import.meta.env.BASE_URL}art/icons/pause.png`}
          alt=""
        />
        <h2>Skip this card</h2>
        <p>It comes back on its own — pick how long to rest it.</p>
        <div className="sheet-actions">
          {SKIP_SHEET_OPTIONS.map(({ skip, label }) => (
            <button key={skip} onClick={() => onSkip(skip)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

const SKIP_SHEET_OPTIONS: { skip: SkipLength; label: string }[] = [
  { skip: "week", label: "1 week" },
  { skip: "month", label: "1 month" },
  { skip: "year", label: "1 year" },
];

/**
 * Runs one task, review, or pooled unit-practice session: presents
 * `questions` one at a time, grades each answer via `onGrade`, and shows a
 * summary panel after the last question. Shared by the task-practice,
 * review, and unit-practice flows; the caller decides what happens after
 * (`onFinished`) and on early exit (`onExit`).
 *
 * Every question resolves to a list of `(unitId, quality)` outcomes (the
 * outcome-list contract, plan 0002): single-unit questions apply one, a
 * cleared matching board applies N, and `onGrade` is applied once per
 * outcome. That is the whole of what a session reports now: the
 * task-attempt callbacks it used to fire went with the attempted-task set
 * plan 0025 §8 replaced, and completion is read from the levels those
 * grades write. `taskIds` stays, because Pin and Edit still need to know
 * which task produced a question.
 */
export function SessionScreen({
  title,
  questions,
  bookId,
  readAloudLang,
  lookup,
  taskIds,
  pinnedUnitIds,
  onTogglePin,
  onSkip,
  onEdit,
  onGrade,
  onFinished,
  nextAction,
  onExit,
  onSwipeBack,
  requeueOnAgain,
  loadStreak,
}: {
  title: string;
  questions: Question[];
  bookId: string;
  /** The book's `readAloudLang`, for TTS-backed listen questions (plan 0004). */
  readAloudLang?: string | undefined;
  /** The domain's tap-to-lookup dependencies (plan 0006 step 4), threaded to
   * every post-answer reveal surface the pinned rules cover (recognize's
   * prompt, the cloze/build/scramble revealed sentence, matching's matched
   * cards) — never to a not-yet-answered question. */
  lookup: TapLookup;
  /** Parallel array to `questions` (plan 0010): index *i*'s task, if the
   * question at index *i* came from one. Only the pooled unit-practice
   * session passes this — `TaskSession`/`ReviewSession` omit it, so the pin
   * control never renders there. */
  taskIds?: (string | undefined)[];
  pinnedUnitIds?: ReadonlySet<string>;
  onTogglePin?: (unitIds: string[]) => void;
  /** Push this card's next due date out (plan 0022 §5), the mirror of Pin:
   * surface later rather than surface first. **Review sessions only** — only
   * they are due-driven, so only there does a skip do anything visible, and
   * a card with no SRS state is not in a queue to be annoyed by. Passing the
   * prop is what renders the control. */
  onSkip?: (unitIds: string[], days: number) => Promise<void>;
  /** Edit affordance for whoever may edit this content (a maintainer, a
   * proposer, or a private Book's owner): opens the scoped sheet on the
   * current question's item/entry/task, over this session rather than
   * navigating away, so closing it resumes right here. Hidden on
   * `NoteQuestion` (no resolvable target) but otherwise independent of
   * `taskIds` — unlike Pin, it renders in `TaskSession`/`ReviewSession` too,
   * not just pooled unit sessions. */
  onEdit?: (index: number) => void;
  onGrade: (unitId: string, quality: Quality) => Promise<void>;
  onFinished: (summary: SessionSummary) => void;
  /** Plan 0020 §4: an optional forward step shown as the summary's primary
   * button. Only the pooled unit-practice session passes this — every other
   * session type (review, ad-hoc, recall, single-task) keeps a bare `Done`,
   * because "next unit" is not what follows them. */
  nextAction?: { label: string; onClick: () => void };
  onExit: () => void;
  /** Back-swipe target, in the same direction the Unit trail's `goPrev` uses
   * (owner request): only the unit-practice session passes it, to land back
   * on the trail's last content page. Ignored on the summary panel — leaving
   * there must go through Done/`nextAction`, which is what advances the
   * lesson. */
  onSwipeBack?: () => void;
  /** Re-show a failed card later in this same session (plan 0022 §4).
   * **Daily Review only.** Unit practice drives `onTaskAnswered` and plan
   * 0020's lesson chaining off its answer counts, and its own completion is
   * what unlocks the next unit — a queue that grows under it would be
   * reasoning about a moving target. Pedagogically the restriction costs
   * little: a unit session already drills each item across several task
   * types, whereas Daily Review shows each scheduling unit exactly once,
   * which is where a failure genuinely disappears for a day. */
  requeueOnAgain?: boolean;
  /** Fetches the current streak for the summary panel (plan 0003). */
  loadStreak?: () => Promise<Streak | null>;
}) {
  const [summary, setSummary] = useState<SessionSummary>(emptySummary);
  const { question, source, done, advance, requeueCurrent, position, length } =
    useSessionQueue(questions, requeueOnAgain);
  const [skipSheetOpen, setSkipSheetOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  function tallyAuto(corrects: boolean[]) {
    setSummary((s) => ({
      ...s,
      autoCorrect: s.autoCorrect + corrects.filter(Boolean).length,
      autoTotal: s.autoTotal + corrects.length,
    }));
  }

  // Every interaction component's answer/grade handler funnels through one
  // of these three (spec 0019 §3b) — wrapping here, once, covers all nine
  // `pick`/`grade`/`handleSubmit`/`submit`/`resolvePair` call sites at once.
  // The guard wraps the ENTIRE body, not just the `onGrade` await: a
  // blocked-storage throw out of `playCorrect`/`playWrong` (both synchronous
  // `localStorage` reads) would otherwise escape before `onGrade` ever runs
  // and trap the learner exactly like an unguarded `onGrade` rejection would
  // (owner decision 4: the learner is never trapped). Swallowing here,
  // rather than in the two `grade` functions that call `advance()` after,
  // means every caller — including the five
  // `pick`/`handleSubmit`/`submit`/`resolvePair` sites that never call
  // `advance()` themselves — still runs its own follow-up.
  async function applyAuto(unitId: string, correct: boolean) {
    try {
      tallyAuto([correct]);
      if (correct) {
        playCorrect();
      } else {
        playWrong();
        requeueCurrent();
      }
      await onGrade(unitId, recognizeQuality(correct));
    } catch {
      noteStorageUnwritable();
    }
  }

  async function applySelf(unitId: string, grade: SelfGrade) {
    try {
      if (grade === "again") {
        requeueCurrent();
      }
      setSummary((s) => ({
        ...s,
        recallCounts: {
          ...s.recallCounts,
          [grade]: s.recallCounts[grade] + 1,
        },
      }));
      await onGrade(unitId, recallQuality(grade));
    } catch {
      noteStorageUnwritable();
    }
  }

  async function applyMatchingOutcomes(outcomes: QuestionOutcome[]) {
    try {
      tallyAuto(
        outcomes.map(([, quality]) => quality === recognizeQuality(true)),
      );
      for (const [unitId, quality] of outcomes) {
        await onGrade(unitId, quality);
      }
    } catch {
      noteStorageUnwritable();
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }
  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null || done) {
      return;
    }
    const endX = event.changedTouches[0]?.clientX ?? startX;
    if (endX - startX > SWIPE_THRESHOLD) {
      onSwipeBack?.();
    }
  }

  const currentTaskId = source === undefined ? undefined : taskIds?.[source];
  // No longer gated on `currentTaskId`: Pin still is (it is a unit-practice
  // control), but Skip lives in review sessions, which pass no `taskIds`.
  const currentUnitIds =
    question === undefined ? [] : questionUnitIds(question);
  const isPinned =
    currentUnitIds.length > 0 &&
    currentUnitIds.every((id) => pinnedUnitIds?.has(id));

  /** Pushes the current card out and moves on. Skipping is not an answer, so
   * nothing is tallied and nothing is graded — `advance()` alone. */
  async function skipCurrent(skip: SkipLength) {
    setSkipSheetOpen(false);
    if (onSkip === undefined || currentUnitIds.length === 0) {
      return;
    }
    try {
      await onSkip(currentUnitIds, SKIP_DAYS[skip]);
    } catch {
      noteStorageUnwritable();
    }
    advance();
  }

  return (
    <main
      className="session"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <BookWatermark bookId={bookId} />
      <header className="session-header">
        <button className="plain exit" aria-label="Exit" onClick={onExit}>
          &#10005;
        </button>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={length}
          aria-valuenow={done ? length : position}
        >
          <div
            className="progress-fill"
            style={{
              width: `${((done ? length : position) / Math.max(length, 1)) * 100}%`,
            }}
          />
        </div>
        {currentTaskId !== undefined ? (
          <button
            className="plain"
            onClick={() => onTogglePin?.(currentUnitIds)}
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/pin.png`}
              alt=""
            />{" "}
            {isPinned ? "Pinned" : "Pin"}
          </button>
        ) : null}
        {onSkip !== undefined && !done && currentUnitIds.length > 0 ? (
          <button
            className="plain skip"
            onClick={() => void skipCurrent(getLearning().skip)}
            // Long-press on Android Chrome and right-click on desktop are the
            // same native event, so one handler covers both — and it cannot
            // collide with the back-swipe detector bound to `main`, which
            // listens for touchstart/touchend rather than this. The CSS
            // `-webkit-touch-callout: none` on `.skip` stops iOS opening its
            // own callout menu over the sheet.
            onContextMenu={(event) => {
              event.preventDefault();
              setSkipSheetOpen(true);
            }}
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/pause.png`}
              alt=""
            />{" "}
            Skip
          </button>
        ) : null}
        {skipSheetOpen ? (
          <SkipSheet
            onCancel={() => setSkipSheetOpen(false)}
            onSkip={(skip) => void skipCurrent(skip)}
          />
        ) : null}
        {onEdit !== undefined &&
        question !== undefined &&
        question.kind !== "note" ? (
          <button className="plain" onClick={() => onEdit(source ?? 0)}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/edit.png`}
              alt=""
            />{" "}
            Edit
          </button>
        ) : null}
        {currentTaskId !== undefined ? (
          <FeedbackWidget
            docId={`topic:${bookId}`}
            contentKind="task"
            contentId={currentTaskId}
          />
        ) : null}
      </header>
      <h1>{title}</h1>

      {done ? (
        <SummaryPanel
          summary={summary}
          loadStreak={loadStreak}
          onFinished={onFinished}
          nextAction={nextAction}
        />
      ) : question === undefined ? null : (
        <div key={position} className="question">
          {renderInteraction(
            question,
            bookId,
            readAloudLang,
            lookup,
            applyAuto,
            applySelf,
            applyMatchingOutcomes,
            advance,
          )}
        </div>
      )}
    </main>
  );
}

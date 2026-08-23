import { ADHOC_MODES, type AdhocMode } from "@betterbeaver/engine";

/**
 * The app's routes, and the URL they read and write.
 *
 * **Why URLs at all.** Six attempts at hardware back failed because the app
 * had exactly one URL and faked its history with `pushState`. Browsers police
 * that: entries a script inserts without user interaction are skipped by a
 * real back press, to stop sites trapping the back button
 * (whatwg/html#7832; Firefox for Android's report is fenix#25328, which names
 * `pushState`/`replaceState` specifically). A fragment navigation is not the
 * History API — it is a navigation the browser performs — and hash routing is
 * old enough and common enough that a browser skipping *those* entries would
 * be a famous bug. That is the bet, and it is a far better one than the five
 * before it.
 *
 * Deep links and a meaningful address bar come along for free; in the
 * installed app there is no address bar, so none of it is visible there.
 *
 * **Shape.** Path segments carry identity, the query carries the transient
 * flags a screen can be opened with:
 *
 *   #/                                     the welcome cover
 *   #/books                                My Books
 *   #/books/demo                           a Book
 *   #/books/demo/lessons/dx-lesson-intro   a lesson
 *   #/books/demo/lessons/l1/units/u1       a unit  (?end=1, ?page=…)
 *   #/books/demo/lessons/l1/units/u1/practice
 *   #/books/demo/lessons/l1/units/u1/recall/u2
 *   #/books/demo/lessons/l1/units/u1/tasks/t1
 *   #/books/demo/lessons/l1/summary
 *   #/domains/demo/review | /vocab | /study?mode=recall&items=a,b
 *   #/library #/author #/settings #/stats #/about #/impressum #/privacy
 *
 * `?edit=1` rides on the three learner routes (edit mode is a flag on the
 * route, not a screen — plan 0021 §8). `?sheet=1` marks the session's edit
 * sheet, so that closing it is its own back step.
 */

// Edit mode is a flag on the three learner routes, not a screen of its own
// (plan 0021 §8): `✎` sets `editing` on the screen you are already reading,
// and navigating book → lesson → unit carries it through. That is the whole
// point — entering edit mode never moves you, and neither does moving while
// in it.
export type Screen =
  | { screen: "books" }
  | {
      screen: "book";
      bookId: string;
      editing?: boolean;
      /** Open the Book settings sheet on arrival — the same "one tap from the
       * thing that caused it" rule `atPage` follows for the Unit trail. A
       * publish error about a resource has nothing to show on the page since
       * slice 14 moved Sources into the sheet. */
      atSettings?: boolean;
    }
  // The lesson level sits between book and unit (plan 0008).
  | { screen: "lesson"; bookId: string; lessonId: string; editing?: boolean }
  | {
      screen: "unit";
      bookId: string;
      lessonId: string;
      unitId: string;
      /** Open the trail on its last content page rather than the Overview —
       * set only by the practice session's back-swipe. */
      atEnd?: boolean;
      /** Open on a named trail page — set by a What-changed row or a publish
       * error deep-link (spec 0021-10 §3). */
      atPage?: string;
      editing?: boolean;
    }
  | {
      screen: "task";
      bookId: string;
      lessonId: string;
      unitId: string;
      taskId: string;
      /** Set only by Preview (spec 0021-9 §1): the session then runs over
       * the draft's own content, against a store that records nothing. */
      editing?: boolean;
    }
  // Pooled unit-level practice (plan 0010): one shuffled session across an
  // entire unit's task set, launched by UnitScreen's sticky Practice bar.
  | {
      screen: "unit-session";
      bookId: string;
      lessonId: string;
      unitId: string;
      editing?: boolean;
    }
  // Cross-unit recall session (plan 0016): practice-only over a sample of
  // the LINKED unit's tasks; onDone returns to the LINKING unit's Overview.
  | {
      screen: "recall-session";
      bookId: string;
      lessonId: string;
      unitId: string; // the linking unit, for onDone back-nav
      recallUnitId: string; // the linked unit whose tasks are sampled
      editing?: boolean;
    }
  // Lesson summary (plan 0020 §5): shown after the unit session that
  // completed the lesson. Derived tiles only — nothing is persisted for it.
  | { screen: "lesson-summary"; bookId: string; lessonId: string }
  // Review, Vocabulary, and ad-hoc study are domain-scoped (plan 0006): the
  // review queue, lists, and streak all key on the domain now, not the book.
  | { screen: "review"; domainId: string }
  | { screen: "vocab"; domainId: string }
  | { screen: "adhoc"; domainId: string; mode: AdhocMode; itemIds: string[] }
  // Library (plan 0015): browse the full catalog and Add a Book. Entered
  // from My Books; back returns there.
  | { screen: "library" }
  // Authoring (plan 0012 step 2): sign-in + document list, the editor, and
  // the static privacy note. Learner flows never route here.
  | { screen: "author" }
  // The two legal pages (§ 5 DDG, Art. 13 GDPR), reached from the legal links
  // on the cover and the home screen. `back` is a hint only now: with real
  // history entries the browser already knows where the visitor came from.
  | { screen: "privacy"; back?: Screen }
  | { screen: "impressum" }
  // About / app info (version, source, contact).
  | { screen: "about"; back?: Screen }
  // Learner settings and stats (reached from the home top bar); both are
  // back-button screens over on-device state.
  | { screen: "settings" }
  | { screen: "stats" };

/** Everything the URL has to be able to restore. `started` is not a flag in
 * the URL: `#/` *is* the cover, and every other route implies the cover has
 * been dismissed. */
export type View = {
  started: boolean;
  screen: Screen;
  /** Whether the session's edit sheet is open. Only ever serialised as a
   * boolean: going forward into a sheet is a tap, and all a back press has to
   * do is close whatever is open. */
  sheet: boolean;
};

function flags(parts: Record<string, string | undefined>): string {
  const query = Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join("&");
  return query === "" ? "" : `?${query}`;
}

const on = (value: boolean | undefined): string | undefined =>
  value === true ? "1" : undefined;

/** The hash path for a view, without the leading `#`. */
export function toPath(view: View): string {
  const { screen } = view;
  const sheet = on(view.sheet);
  const e = (editing?: boolean) => on(editing);

  switch (screen.screen) {
    case "books":
      return view.started ? "/books" : "/";
    case "book":
      return `/books/${screen.bookId}${flags({ edit: e(screen.editing), settings: on(screen.atSettings), sheet })}`;
    case "lesson":
      return `/books/${screen.bookId}/lessons/${screen.lessonId}${flags({ edit: e(screen.editing), sheet })}`;
    case "unit":
      return `/books/${screen.bookId}/lessons/${screen.lessonId}/units/${screen.unitId}${flags(
        {
          edit: e(screen.editing),
          end: on(screen.atEnd),
          page: screen.atPage,
          sheet,
        },
      )}`;
    case "task":
      return `/books/${screen.bookId}/lessons/${screen.lessonId}/units/${screen.unitId}/tasks/${screen.taskId}${flags({ edit: e(screen.editing), sheet })}`;
    case "unit-session":
      return `/books/${screen.bookId}/lessons/${screen.lessonId}/units/${screen.unitId}/practice${flags({ edit: e(screen.editing), sheet })}`;
    case "recall-session":
      return `/books/${screen.bookId}/lessons/${screen.lessonId}/units/${screen.unitId}/recall/${screen.recallUnitId}${flags({ edit: e(screen.editing), sheet })}`;
    case "lesson-summary":
      return `/books/${screen.bookId}/lessons/${screen.lessonId}/summary`;
    case "review":
      return `/domains/${screen.domainId}/review${flags({ sheet })}`;
    case "vocab":
      return `/domains/${screen.domainId}/vocab`;
    case "adhoc":
      return `/domains/${screen.domainId}/study${flags({
        mode: screen.mode,
        items: screen.itemIds.join(","),
        sheet,
      })}`;
    default:
      return `/${screen.screen}`;
  }
}

const SIMPLE = new Set([
  "library",
  "author",
  "privacy",
  "impressum",
  "about",
  "settings",
  "stats",
]);

function isAdhocMode(value: string): value is AdhocMode {
  return (ADHOC_MODES as readonly string[]).includes(value);
}

/**
 * The view a hash path describes, or `null` when it describes nothing this
 * build knows — a link from a newer version, or a typo. The caller decides
 * what to do with that; silently rewriting the URL would hide the fact.
 */
export function fromPath(path: string): View | null {
  const [rawPath = "", rawQuery = ""] = path.replace(/^#/, "").split("?", 2);
  const query = new URLSearchParams(rawQuery);
  const segments = rawPath.split("/").filter((segment) => segment !== "");
  const sheet = query.get("sheet") === "1";
  const editing = query.get("edit") === "1" ? true : undefined;
  const view = (screen: Screen): View => ({ started: true, screen, sheet });

  if (segments.length === 0) {
    return { started: false, screen: { screen: "books" }, sheet: false };
  }

  const [head, ...rest] = segments;

  if (head === "books" && rest.length === 0) {
    return view({ screen: "books" });
  }

  if (head === "books" && rest[0] !== undefined) {
    const bookId = rest[0];
    if (rest.length === 1) {
      return view({
        screen: "book",
        bookId,
        editing,
        atSettings: query.get("settings") === "1" ? true : undefined,
      });
    }
    if (rest[1] !== "lessons" || rest[2] === undefined) {
      return null;
    }
    const lessonId = rest[2];
    if (rest.length === 3) {
      return view({ screen: "lesson", bookId, lessonId, editing });
    }
    if (rest[3] === "summary" && rest.length === 4) {
      return view({ screen: "lesson-summary", bookId, lessonId });
    }
    if (rest[3] !== "units" || rest[4] === undefined) {
      return null;
    }
    const unitId = rest[4];
    if (rest.length === 5) {
      return view({
        screen: "unit",
        bookId,
        lessonId,
        unitId,
        editing,
        atEnd: query.get("end") === "1" ? true : undefined,
        atPage: query.get("page") ?? undefined,
      });
    }
    if (rest[5] === "practice" && rest.length === 6) {
      return view({
        screen: "unit-session",
        bookId,
        lessonId,
        unitId,
        editing,
      });
    }
    if (rest[5] === "tasks" && rest[6] !== undefined && rest.length === 7) {
      return view({
        screen: "task",
        bookId,
        lessonId,
        unitId,
        taskId: rest[6],
        editing,
      });
    }
    if (rest[5] === "recall" && rest[6] !== undefined && rest.length === 7) {
      return view({
        screen: "recall-session",
        bookId,
        lessonId,
        unitId,
        recallUnitId: rest[6],
        editing,
      });
    }
    return null;
  }

  if (head === "domains" && rest[0] !== undefined && rest.length === 2) {
    const domainId = rest[0];
    if (rest[1] === "review") {
      return view({ screen: "review", domainId });
    }
    if (rest[1] === "vocab") {
      return view({ screen: "vocab", domainId });
    }
    if (rest[1] === "study") {
      const mode = query.get("mode") ?? "";
      if (!isAdhocMode(mode)) {
        return null;
      }
      const items = query.get("items");
      return view({
        screen: "adhoc",
        domainId,
        mode,
        itemIds: items === null || items === "" ? [] : items.split(","),
      });
    }
    return null;
  }

  if (head !== undefined && SIMPLE.has(head) && rest.length === 0) {
    return view({ screen: head } as Screen);
  }

  return null;
}

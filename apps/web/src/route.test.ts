import { describe, expect, it } from "vitest";
import { fromPath, toPath, type View } from "./route";

/**
 * The URL is the app's navigation state now, so a route that serialises one
 * way and parses back another is a screen the learner cannot return to with
 * the back button. Every variant round-trips.
 */
const started = (screen: View["screen"], sheet = false): View => ({
  started: true,
  screen,
  sheet,
});

const CASES: [string, View][] = [
  ["/", { started: false, screen: { screen: "books" }, sheet: false }],
  ["/books", started({ screen: "books" })],
  ["/books/demo", started({ screen: "book", bookId: "demo" })],
  [
    "/books/demo?edit=1",
    started({ screen: "book", bookId: "demo", editing: true }),
  ],
  [
    "/books/demo?settings=1",
    started({ screen: "book", bookId: "demo", atSettings: true }),
  ],
  [
    "/books/kyrgyz/lessons/l1",
    started({ screen: "lesson", bookId: "kyrgyz", lessonId: "l1" }),
  ],
  [
    "/books/kyrgyz/lessons/l1/units/u1",
    started({ screen: "unit", bookId: "kyrgyz", lessonId: "l1", unitId: "u1" }),
  ],
  [
    "/books/demo/lessons/l1/units/u1?end=1&page=p2",
    started({
      screen: "unit",
      bookId: "demo",
      lessonId: "l1",
      unitId: "u1",
      atEnd: true,
      atPage: "p2",
    }),
  ],
  [
    "/books/demo/lessons/l1/units/u1/practice",
    started({
      screen: "unit-session",
      bookId: "demo",
      lessonId: "l1",
      unitId: "u1",
    }),
  ],
  [
    "/books/demo/lessons/l1/units/u1/tasks/t1",
    started({
      screen: "task",
      bookId: "demo",
      lessonId: "l1",
      unitId: "u1",
      taskId: "t1",
    }),
  ],
  [
    "/books/demo/lessons/l1/units/u1/recall/u2",
    started({
      screen: "recall-session",
      bookId: "demo",
      lessonId: "l1",
      unitId: "u1",
      recallUnitId: "u2",
    }),
  ],
  [
    "/books/demo/lessons/l1/summary",
    started({ screen: "lesson-summary", bookId: "demo", lessonId: "l1" }),
  ],
  ["/domains/demo/review", started({ screen: "review", domainId: "demo" })],
  ["/domains/demo/vocab", started({ screen: "vocab", domainId: "demo" })],
  [
    "/domains/demo/study?mode=recall&items=a%2Cb",
    started({
      screen: "adhoc",
      domainId: "demo",
      mode: "recall",
      itemIds: ["a", "b"],
    }),
  ],
  ["/library", started({ screen: "library" })],
  ["/author", started({ screen: "author" })],
  ["/settings", started({ screen: "settings" })],
  ["/stats", started({ screen: "stats" })],
  ["/about", started({ screen: "about" })],
  ["/impressum", started({ screen: "impressum" })],
  ["/privacy", started({ screen: "privacy" })],
  [
    "/books/demo/lessons/l1/units/u1/practice?sheet=1",
    started(
      {
        screen: "unit-session",
        bookId: "demo",
        lessonId: "l1",
        unitId: "u1",
      },
      true,
    ),
  ],
];

describe("route", () => {
  it.each(CASES)("round-trips %s", (path, view) => {
    expect(toPath(view)).toBe(path);
    expect(fromPath(path)).toEqual(view);
  });

  it("reads a path with or without the leading #", () => {
    expect(fromPath("#/books/demo")).toEqual(
      started({ screen: "book", bookId: "demo" }),
    );
  });

  it("treats the empty hash as the cover", () => {
    expect(fromPath("")).toEqual({
      started: false,
      screen: { screen: "books" },
      sheet: false,
    });
  });

  it("returns null for a route this build does not know", () => {
    // A link from a newer version, or a typo. The caller decides; silently
    // rewriting the URL would hide that anything was wrong.
    expect(fromPath("/books/demo/chapters/7")).toBeNull();
    expect(fromPath("/nonsense")).toBeNull();
    expect(fromPath("/domains/demo/study?mode=telepathy")).toBeNull();
  });

  it("keeps ids that need escaping intact", () => {
    const view = started({
      screen: "unit",
      bookId: "b",
      lessonId: "l",
      unitId: "u",
      atPage: "a b&c",
    });
    expect(fromPath(toPath(view))).toEqual(view);
  });
});

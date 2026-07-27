import { describe, it, expect } from "vitest";
import {
  visiblePickerRows,
  groupPickerRows,
  titleOf,
  optionsFrom,
  notePoolOptions,
  unitPoolOptionsGroupedByLesson,
  type PickerOption,
  type PickerFilter,
} from "./entityPicker";

describe("visiblePickerRows", () => {
  const options: PickerOption[] = [
    { id: "a-1", title: "Hello", subtitle: "greeting" },
    { id: "a-2", title: "World", subtitle: "noun" },
    { id: "a-3", title: "Bye", subtitle: "farewell greeting" },
  ];

  it("search matches title, subtitle and id (case-insensitive)", () => {
    expect(
      visiblePickerRows(options, [], "hello", undefined).map((r) => r.id),
    ).toEqual(["a-1"]);
    expect(
      visiblePickerRows(options, [], "greeting", undefined)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a-1", "a-3"]);
    expect(
      visiblePickerRows(options, [], "A-2", undefined).map((r) => r.id),
    ).toEqual(["a-2"]);
  });

  it("an active filter narrows to exactly its id set (e.g. 'This unit')", () => {
    const thisUnit: PickerFilter = {
      key: "this-unit",
      label: "This unit",
      ids: new Set(["a-2"]),
    };
    expect(
      visiblePickerRows(options, [], "", thisUnit).map((r) => r.id),
    ).toEqual(["a-2"]);
  });

  it("a filter with ids: null (All) is unrestricted", () => {
    const all: PickerFilter = { key: "all", label: "All", ids: null };
    expect(
      visiblePickerRows(options, [], "", all)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("an unresolved selected id survives both the filter and the search", () => {
    const thisUnit: PickerFilter = {
      key: "this-unit",
      label: "This unit",
      ids: new Set(["a-2"]),
    };
    const rows = visiblePickerRows(
      options,
      ["missing-id"],
      "nomatch",
      thisUnit,
    );
    expect(rows).toContainEqual({
      id: "missing-id",
      title: "missing-id",
      unresolved: true,
    });
  });

  it("a resolved option is marked unresolved: false", () => {
    const rows = visiblePickerRows(options, ["a-1"], "", undefined);
    const row = rows.find((r) => r.id === "a-1");
    expect(row?.unresolved).toBe(false);
  });
});

describe("groupPickerRows", () => {
  it("groups rows by group, preserving first-seen group order and row order within a group", () => {
    const rows = [
      { id: "1", title: "A", unresolved: false, group: "Lesson 2" },
      { id: "2", title: "B", unresolved: false, group: "Lesson 1" },
      { id: "3", title: "C", unresolved: false, group: "Lesson 2" },
    ];
    const grouped = groupPickerRows(rows);
    expect(grouped.map((g) => g.group)).toEqual(["Lesson 2", "Lesson 1"]);
    expect(grouped[0]?.rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(grouped[1]?.rows.map((r) => r.id)).toEqual(["2"]);
  });

  it("collects ungrouped rows under undefined", () => {
    const rows = [{ id: "1", title: "A", unresolved: false }];
    expect(groupPickerRows(rows)).toEqual([{ group: undefined, rows }]);
  });
});

describe("titleOf", () => {
  it("falls back to id when nothing else is present", () => {
    expect(titleOf({ id: "x-1" })).toBe("x-1");
  });

  it("prefers title, then name, then kind-specific payload fields", () => {
    expect(titleOf({ id: "x-1", title: "T" })).toBe("T");
    expect(titleOf({ id: "x-1", name: "N" })).toBe("N");
    expect(titleOf({ id: "x-1", payload: { script: "жакшы" } })).toBe("жакшы");
    expect(titleOf({ id: "x-1", payload: { term: "concept" } })).toBe(
      "concept",
    );
    expect(titleOf({ id: "x-1", payload: { text: "a sentence" } })).toBe(
      "a sentence",
    );
    expect(titleOf({ id: "x-1", payload: { a: { script: "аба" } } })).toBe(
      "аба",
    );
  });
});

describe("optionsFrom", () => {
  it("builds one option per entity, tagged with the given kind", () => {
    expect(optionsFrom([{ id: "i-1", title: "One" }], "book item")).toEqual([
      { id: "i-1", title: "One", kind: "book item" },
    ]);
  });
});

describe("notePoolOptions", () => {
  it("derives note ids from the book code + stem convention", () => {
    expect(
      notePoolOptions([{ stem: "greetings", markdown: "# hi" }], "ky"),
    ).toEqual([
      { id: "ky-note-greetings", title: "hi", subtitle: "greetings" },
    ]);
  });

  // A stem is a generated id (spec 0018), so labelling a note by its stem
  // would show a UUID. The `# ` heading every authored note already carries
  // is the title; the stem stays as searchable subtitle.
  it("labels a note by its heading, keeping the stem searchable", () => {
    const [option] = notePoolOptions(
      [
        {
          stem: "4836cb88-e9d1-4be3-a8a0-2103dbc7ca49",
          markdown: "# Greetings\n\nbody",
        },
      ],
      "ky",
    );
    expect(option?.title).toBe("Greetings");
    expect(option?.subtitle).toBe("4836cb88-e9d1-4be3-a8a0-2103dbc7ca49");
  });

  it("falls back to the stem when a note has no heading yet", () => {
    const [option] = notePoolOptions(
      [{ stem: "untitled", markdown: "" }],
      "ky",
    );
    expect(option?.title).toBe("untitled");
  });
});

describe("unitPoolOptionsGroupedByLesson", () => {
  it("orders by lesson then by the lesson's own unitIds, grouping by lesson title", () => {
    const lessons = [
      { id: "l-1", title: "Lesson One", unitIds: ["u-2", "u-1"] },
      { id: "l-2", title: "Lesson Two", unitIds: ["u-3"] },
    ];
    const units = [
      { id: "u-1", title: "Unit 1" },
      { id: "u-2", title: "Unit 2" },
      { id: "u-3", title: "Unit 3" },
    ];
    expect(unitPoolOptionsGroupedByLesson(lessons, units)).toEqual([
      { id: "u-2", title: "Unit 2", group: "Lesson One" },
      { id: "u-1", title: "Unit 1", group: "Lesson One" },
      { id: "u-3", title: "Unit 3", group: "Lesson Two" },
    ]);
  });

  it("omits units not listed under any given lesson (e.g. pre-filtered self)", () => {
    const lessons = [{ id: "l-1", title: "Lesson", unitIds: ["u-1", "u-2"] }];
    const units = [{ id: "u-1", title: "Unit 1" }]; // u-2 filtered out by the caller
    expect(unitPoolOptionsGroupedByLesson(lessons, units)).toEqual([
      { id: "u-1", title: "Unit 1", group: "Lesson" },
    ]);
  });
});

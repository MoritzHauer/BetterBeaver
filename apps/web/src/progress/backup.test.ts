import { describe, expect, it, beforeEach } from "vitest";
import { importBackup } from "./backup";

/**
 * The localStorage half of restore, which is where the `privateBooks` key
 * added alongside it could do damage: it must not land in localStorage, and
 * a backup file written before that key existed must still restore. The
 * private half needs IndexedDB and has no fake here.
 */
describe("importBackup", () => {
  beforeEach(() => localStorage.clear());

  it("restores bb.* keys, ignores the privateBooks key, and drops stale keys", async () => {
    localStorage.setItem("bb.stale", "1");
    const file = new File(
      [
        JSON.stringify({
          "bb.kept": '{"a":1}',
          notBb: "ignored",
          privateBooks: [{ kind: "bb-private-book" }],
        }),
      ],
      "backup.json",
    );
    await importBackup(file);
    expect(localStorage.getItem("bb.kept")).toBe('{"a":1}');
    expect(localStorage.getItem("bb.stale")).toBeNull();
    expect(localStorage.getItem("privateBooks")).toBeNull();
    expect(localStorage.getItem("notBb")).toBeNull();
  });

  it("restores a backup file written before privateBooks existed", async () => {
    const file = new File([JSON.stringify({ "bb.old": "x" })], "backup.json");
    await importBackup(file);
    expect(localStorage.getItem("bb.old")).toBe("x");
  });
});

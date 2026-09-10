import { describe, expect, it, beforeEach } from "vitest";
import { importBackup } from "./backup";
import { examKey, readExamRecord } from "./exam-attempts";

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

  it("carries an in-flight exam attempt through a restore", async () => {
    // Plan 0027 §6 requires the `bb.exam.<examId>` key to ride the backup:
    // an in-flight attempt is learner state, and learner state on-device
    // with export/import is the durability floor. It needs no code — the
    // sweep is over every `bb.*` key — so this pins that it stays that way.
    const attempt = JSON.stringify({
      attempt: { startedAt: 1, deadlineAt: 2, answers: {} },
    });
    const file = new File(
      [JSON.stringify({ [examKey("t-exam-1")]: attempt })],
      "backup.json",
    );
    await importBackup(file);
    expect(readExamRecord("t-exam-1").attempt).toEqual({
      startedAt: 1,
      deadlineAt: 2,
      answers: {},
    });
  });

  it("restores a backup file written before privateBooks existed", async () => {
    const file = new File([JSON.stringify({ "bb.old": "x" })], "backup.json");
    await importBackup(file);
    expect(localStorage.getItem("bb.old")).toBe("x");
  });
});

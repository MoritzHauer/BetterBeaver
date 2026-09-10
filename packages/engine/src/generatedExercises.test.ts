import { describe, expect, it } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import { advanceDrill, nextVisit, startDrill } from "./drill.js";
import { buildVisitQuestion } from "./session.js";
import type { Question } from "./session.js";
import type { Rng } from "./rng.js";

/**
 * Plan 0026's done-criteria, run through the real loop rather than asserted
 * against a helper: `startDrill` plans the visits, `buildVisitQuestion`
 * builds each card, `advanceDrill` credits the answer. If construction and
 * the drill disagree about which scheduling unit a question grades, a
 * session here stalls — which is the failure these are here to catch.
 */

/** Deterministic Rng, walked so successive draws differ. */
function seeded(): Rng {
  let n = 0;
  return () => ((n = (n * 1103515245 + 12345) % 2147483648), n / 2147483648);
}

function word(n: number): Item {
  return {
    id: `t-item-w${n}`,
    kind: "lexeme",
    payload: {
      script: `сөз${n}`,
      transliteration: `soz${n}`,
      gloss: `word ${n}`,
    },
    sourceRef: "t-resource-1",
  };
}

function bookOf(
  items: Item[],
  tasks: Task[],
  generatedExercises: boolean,
): { content: Content; unit: Unit } {
  const unit: Unit = {
    id: "t-unit-1",
    lessonId: "t-lesson-1",
    title: "Unit",
    goal: "Goal",
    itemIds: items.map((i) => i.id),
    taskIds: tasks.map((t) => t.id),
    noteIds: [],
  };
  const content: Content = {
    topic: {
      id: "t",
      code: "t",
      title: "Book",
      description: "",
      lessonIds: ["t-lesson-1"],
      domainId: "t",
      ...(generatedExercises && { generatedExercises }),
    },
    lessons: [],
    units: [unit],
    items,
    tasks,
    notes: [],
    resources: [],
  };
  return { content, unit };
}

/**
 * Plays a whole session: every visit the drill hands out, answered
 * correctly, until it says stop. Returns the cards actually shown and
 * whether the session finished what it owed.
 */
function play(
  content: Content,
  unit: Unit,
  levels: Map<string, number> = new Map(),
  repetitions = 2,
): { cards: Question[]; owed: number; answered: number } {
  const rng = seeded();
  let state = startDrill([...unit.itemIds], repetitions);
  const cards: Question[] = [];
  // Accumulated exactly as `App.tsx` accumulates it: a word a board already
  // answered for draws its next exercise up rather than summoning an
  // identical board.
  const covered = new Set<string>();
  let answered = 0;
  for (let guard = 0; guard < 200; guard++) {
    const visit = nextVisit(state);
    if (visit === null) {
      break;
    }
    const card = buildVisitQuestion(
      visit,
      unit,
      content,
      (id) => levels.get(id) ?? 0,
      rng,
      covered,
    );
    if (card === null) {
      // Nothing to show. The drill would sit here forever, so stop and let
      // the assertion below report the shortfall rather than hanging.
      break;
    }
    cards.push(card.question);
    answered += 1;
    if (card.question.kind === "matching") {
      for (const prompt of card.question.prompts) {
        covered.add(prompt.unitId);
      }
    }
    const credited =
      card.question.kind === "matching"
        ? card.question.prompts.map((p) => ({
            unitId: p.unitId,
            correct: true,
          }))
        : [{ unitId: card.question.unitId, correct: true }];
    state = advanceDrill(state, credited);
  }
  return { cards, owed: state.remaining, answered };
}

/** Every scheduling unit the shown cards actually asked about. */
function wordsAsked(cards: readonly Question[]): Set<string> {
  return new Set(
    cards.flatMap((card) =>
      card.kind === "matching"
        ? card.prompts.map((p) => p.unitId)
        : [card.unitId],
    ),
  );
}

const FIVE_WORDS = [1, 2, 3, 4, 5].map((n) => word(n));

describe("plan 0026 done-criteria", () => {
  it("a unit with items and zero authored tasks produces a full session", () => {
    const { content, unit } = bookOf(FIVE_WORDS, [], true);
    const { cards, owed } = play(content, unit);
    // Every owed answer paid off, and every word actually asked.
    expect(owed).toBe(0);
    expect(wordsAsked(cards)).toEqual(new Set(unit.itemIds));
  });

  it("and a session over five words is more than five identical boards", () => {
    // A board answers for every word on it, so without the covered set the
    // whole session would be two boards. `App.tsx` passes it; so does `play`.
    const { content, unit } = bookOf(FIVE_WORDS, [], true);
    const { cards } = play(content, unit);
    expect(new Set(cards.map((card) => card.kind)).size).toBeGreaterThan(1);
  });

  it("that session is ladder-ordered: a new word opens at the bottom", () => {
    const { content, unit } = bookOf(FIVE_WORDS, [], true);
    const { cards } = play(content, unit, new Map(), 1);
    // Level 0 + the `new` slot asks level 1, which for five same-kind words
    // is the matching board — the comprehension end, never `write`.
    expect(cards[0]?.kind).toBe("matching");
    expect(cards.some((card) => card.kind === "write")).toBe(false);
  });

  it("and climbs with the word: a word at level 8 is asked to produce", () => {
    const { content, unit } = bookOf(FIVE_WORDS, [], true);
    const levels = new Map(unit.itemIds.map((id) => [id, 8]));
    const { cards } = play(content, unit, levels, 1);
    expect(cards.every((card) => card.kind === "write")).toBe(true);
  });

  it("adding an item to a unit puts it in the session with no other edit", () => {
    const grown = [...FIVE_WORDS, word(6)];
    const { content, unit } = bookOf(grown, [], true);
    const { cards } = play(content, unit, new Map(), 1);
    expect(wordsAsked(cards).has("t-item-w6")).toBe(true);
  });

  it("one authored board over five of twenty words leaves the other fifteen level 1", () => {
    // The case the retired per-type rule got wrong.
    const twenty = Array.from({ length: 20 }, (_, i) => word(i + 1));
    const board: Task = {
      id: "t-task-board",
      type: "matching",
      itemIds: twenty.slice(0, 5).map((i) => i.id),
    };
    const { content, unit } = bookOf(twenty, [board], true);
    const { cards, owed } = play(content, unit, new Map(), 1);
    expect(owed).toBe(0);
    const asked = wordsAsked(cards);
    for (const item of twenty.slice(5)) {
      expect(asked.has(item.id)).toBe(true);
    }
  });

  it("session length is identical whether the Book is opted in or not", () => {
    const recall: Task = {
      id: "t-task-recall",
      type: "recall",
      itemIds: FIVE_WORDS.map((i) => i.id),
    };
    const off = bookOf(FIVE_WORDS, [recall], false);
    const on = bookOf(FIVE_WORDS, [recall], true);
    expect(startDrill([...off.unit.itemIds], 2).remaining).toBe(
      startDrill([...on.unit.itemIds], 2).remaining,
    );
    // And both actually finish what they owe — only *which* exercise fills
    // a slot changes.
    expect(play(off.content, off.unit).owed).toBe(0);
    expect(play(on.content, on.unit).owed).toBe(0);
  });

  it("a constructed cloze credits the word the drill planned", () => {
    // The stall this plan had to avoid: a cloze question that graded
    // `<itemId>::c1` would leave the session owing answers forever.
    const sentence: Item = {
      id: "t-item-s1",
      kind: "sentence",
      payload: {
        text: "Кундуздар {{c1::бөгөт}} курушат бул жерде",
        translation: "Beavers build dams here",
      },
      sourceRef: "t-resource-1",
    };
    const { content, unit } = bookOf([sentence], [], true);
    const levels = new Map([[sentence.id, 6]]);
    const { cards, owed } = play(content, unit, levels, 1);
    expect(cards[0]?.kind).toBe("cloze");
    expect(cards[0]?.kind === "cloze" && cards[0].unitId).toBe(sentence.id);
    expect(owed).toBe(0);
  });
});

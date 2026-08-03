import {
  bookSchema,
  lessonSchema,
  unitSchema,
  itemSchema,
  taskSchema,
  resourceSchema,
  domainSchema,
  familySchema,
  checkReferences,
  type BookDocument,
  type DomainDocument,
  type ParsedSet,
} from "@betterbeaver/schema";
import { arr, draftContent, obj } from "./draftContent.js";
import type { AssetStems } from "./documentSource.js";

export interface Problem {
  /** Entity id, or "topic" / "domain" for the singletons. */
  entityId: string;
  /** Dotted field path when known ("payload.gloss"); absent for whole-entity problems. */
  path?: string;
  message: string;
}

const entityIdOf = (raw: unknown): string => {
  const id =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).id
      : undefined;
  return typeof id === "string" ? id : "";
};

/** Structural subset of zod's `SafeParseReturnType` — avoids adding a direct
 * `zod` dependency to this package just to name the type. */
type SafeParseResult =
  | { success: true }
  | {
      success: false;
      error: { issues: { path: PropertyKey[]; message: string }[] };
    };

function pushFieldProblems(
  problems: Problem[],
  entityId: string,
  result: SafeParseResult,
): void {
  if (result.success) {
    return;
  }
  for (const issue of result.error.issues) {
    // `path` is omitted, not empty-string, for a whole-entity problem — a
    // non-object entity yields `issue.path === []`, and `Problem`'s contract
    // is that the field is absent in that case so callers can distinguish
    // "this field is wrong" from "this entity is wrong".
    const path = issue.path.join(".");
    problems.push({
      entityId,
      ...(path !== "" && { path }),
      message: issue.message,
    });
  }
}

/**
 * Field-level problems: each entity's own zod schema, run per-entity
 * (deliberately not the batched `parseAll` — batching is what causes the
 * wave-masking `documentProblems` exists to avoid, spec 0021-4 §3a).
 */
function fieldProblems(book: BookDocument, domain: DomainDocument): Problem[] {
  const problems: Problem[] = [];
  // Same `obj`/`arr` guards as `draftContent`, and imported from it rather
  // than re-declared: this walks the same untrusted document, where a list
  // field can be missing or of the wrong type, and an unguarded `for…of`
  // throws "is not iterable" on the editor's own working document.
  const b = obj(book);
  const d = obj(domain);

  pushFieldProblems(problems, "topic", bookSchema.safeParse(b.topic));
  for (const raw of arr(b.lessons)) {
    pushFieldProblems(problems, entityIdOf(raw), lessonSchema.safeParse(raw));
  }
  for (const raw of arr(b.units)) {
    pushFieldProblems(problems, entityIdOf(raw), unitSchema.safeParse(raw));
  }
  for (const raw of arr(b.items)) {
    pushFieldProblems(problems, entityIdOf(raw), itemSchema.safeParse(raw));
  }
  for (const raw of arr(b.tasks)) {
    pushFieldProblems(problems, entityIdOf(raw), taskSchema.safeParse(raw));
  }
  for (const raw of arr(b.resources)) {
    pushFieldProblems(problems, entityIdOf(raw), resourceSchema.safeParse(raw));
  }
  pushFieldProblems(problems, "domain", domainSchema.safeParse(d.domain));
  for (const raw of arr(d.entries)) {
    pushFieldProblems(problems, entityIdOf(raw), itemSchema.safeParse(raw));
  }
  for (const raw of arr(d.families)) {
    pushFieldProblems(problems, entityIdOf(raw), familySchema.safeParse(raw));
  }

  return problems;
}

/** Every real id in `parsed` — the membership test `splitReferenceError`
 * uses to recognize a `checkReferences` message's leading `<id>: ` prefix,
 * rather than guessing from string shape (a mid-edit id may not even be a
 * valid slug yet — see `splitReferenceError`). */
function knownIdsOf(parsed: ParsedSet): Set<string> {
  return new Set([
    parsed.book.id,
    parsed.domain.id,
    ...parsed.lessons.map((e) => e.id),
    ...parsed.units.map((e) => e.id),
    ...parsed.items.map((e) => e.id),
    ...parsed.tasks.map((e) => e.id),
    ...parsed.resources.map((e) => e.id),
    ...parsed.entries.map((e) => e.id),
    ...parsed.families.map((e) => e.id),
    ...parsed.notes.map((e) => e.id),
  ]);
}

/**
 * Splits one `checkReferences` string on its leading `<id>: ` prefix (spec
 * 0021-4 §3), recognizing a real id by membership in `knownIds` — not by
 * string shape. A shape test (e.g. "looks like a slug") mis-keys two real
 * cases: `book.id`/`domain.id` themselves are valid-looking prefixes on
 * class (y)'s reserved-prefix messages but must still map to the `topic`/
 * `domain` singletons (matching the `Problem.entityId` doc comment), and a
 * mid-edit entity id may not be a valid slug yet, which would otherwise
 * misfile that entity's own reference problems away from its field
 * problems. A message with no `<id>: ` prefix at all (class (t)'s
 * `topic.domainId` message) or a dotted non-id prefix (`topic.lessonIds`)
 * isn't in `knownIds` either, and also attaches to `topic`, unsplit.
 */
function splitReferenceError(
  message: string,
  knownIds: Set<string>,
  bookId: string,
  domainId: string,
): Problem {
  const separator = message.indexOf(": ");
  if (separator !== -1) {
    const prefix = message.slice(0, separator);
    if (knownIds.has(prefix)) {
      const entityId =
        prefix === bookId ? "topic" : prefix === domainId ? "domain" : prefix;
      return { entityId, message: message.slice(separator + 2) };
    }
  }
  return { entityId: "topic", message };
}

/**
 * Entity-level problems: `checkReferences` over the coerced, always-valid
 * `parsed` set (`draftContent`'s second return shape), never the raw
 * document — that's what lets reference checks run even when phase-1 zod
 * parsing would have failed on the first typo (spec 0021-4 §3a).
 */
function referenceProblems(
  book: BookDocument,
  domain: DomainDocument,
  assets: AssetStems,
): Problem[] {
  const { parsed } = draftContent(book, domain, assets);
  const knownIds = knownIdsOf(parsed);
  return checkReferences(parsed).map((message) =>
    splitReferenceError(message, knownIds, parsed.book.id, parsed.domain.id),
  );
}

/**
 * Every problem in `book`/`domain`, from two sources that duplicate zero
 * rules (spec 0021-4 §3): each entity's own zod schema (field-level) plus
 * `checkReferences` over the drafted, coerced set (entity-level). Returns
 * both a flat list and the same problems keyed by `entityId`, built once
 * here so slices 6-8 don't re-scan a flat array per input per render.
 */
export function documentProblems(
  book: BookDocument,
  domain: DomainDocument,
  assets: AssetStems,
): { all: Problem[]; byEntity: Map<string, Problem[]> } {
  const all = [
    ...fieldProblems(book, domain),
    ...referenceProblems(book, domain, assets),
  ];

  const byEntity = new Map<string, Problem[]>();
  for (const problem of all) {
    const bucket = byEntity.get(problem.entityId);
    if (bucket === undefined) {
      byEntity.set(problem.entityId, [problem]);
    } else {
      bucket.push(problem);
    }
  }

  return { all, byEntity };
}

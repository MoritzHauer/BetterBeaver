import { newPrivateId } from "./private-ids";

/**
 * Ids for newly-created content entities in the editor (spec 0018 §1):
 * `${prefix}-${uuid}`. `prefix` must be the owning Book's `code` for a
 * book-scoped entity (lesson/unit/item/task/resource) or the Domain's own
 * `code` for a domain-scoped entity (entry/family) — validate.ts's "id must
 * start with" classes (c)/(u) require it; a bare UUID fails validation.
 * Reuses `newPrivateId()` for the UUID half so there is one generator.
 */
export function newEntityId(prefix: string): string {
  return `${prefix}-${newPrivateId()}`;
}

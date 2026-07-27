/**
 * Ids for private content (plan 0017 decision 4). A bare `crypto.randomUUID()`
 * — lowercase hex in hyphen-separated segments, so it satisfies `slugPattern`
 * (`packages/schema/src/entities.ts:7`) and needs no schema change; and since
 * it does not start with `user-`, it passes validate.ts's class (y) check
 * untouched. UUIDs rather than readable slugs because two people can author
 * private Books independently and swap the exported files — slugs collide
 * there, UUIDs do not.
 */
export function newPrivateId(): string {
  return crypto.randomUUID();
}

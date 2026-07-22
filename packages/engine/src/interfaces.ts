import type { Content, DomainKind, Item } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import type { Streak } from "./streak.js";
import type { DomainContent } from "./domain.js";

/** Thrown by `ContentSource.loadBook` when the loaded content fails validation. */
export class ContentValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Content validation failed:\n${errors.join("\n")}`);
    this.name = "ContentValidationError";
    this.errors = errors;
  }
}

/** Summary of a book, as listed before its full content is loaded. */
export interface BookSummary {
  id: string;
  title: string;
  description: string;
  /** The domain this book belongs to (plan 0006), for grouping the home screen. */
  domainId: string;
  /** Library/My Books card icon (plan 0015 decision 6); absent means no icon, no default. */
  icon?: string;
}

/** Summary of a domain, as listed before its full content is loaded (plan 0006). */
export interface DomainSummary {
  id: string;
  title: string;
  kind: DomainKind;
}

/**
 * Source of learning content. Async from day 1 so a future remote or
 * SQLite-backed source is a swap, not a rewrite.
 */
export interface ContentSource {
  listBooks(): Promise<BookSummary[]>;
  /** Rejects with `ContentValidationError` if the loaded content is invalid. */
  loadBook(id: string): Promise<Content>;
  listDomains(): Promise<DomainSummary[]>;
  /** Rejects with `ContentValidationError` if the loaded domain is invalid. */
  loadDomain(id: string): Promise<DomainContent>;
}

/**
 * Store of learner progress. Unit completion is not stored here: it is
 * derived by the engine from the attempted-task-id set (every task id of
 * the unit is a member). The streak is per-domain (plan 0006): item state
 * and attempted tasks stay global (item ids are unique across the whole
 * bundle), but "showed up today" is tracked separately per domain.
 */
export interface ProgressStore {
  getItemState(itemId: string): Promise<SrsState | null>;
  setItemState(itemId: string, state: SrsState): Promise<void>;
  getAttemptedTaskIds(): Promise<string[]>;
  markTaskAttempted(taskId: string): Promise<void>;
  getStreak(domainId: string): Promise<Streak | null>;
  setStreak(domainId: string, streak: Streak): Promise<void>;
  /** Bumps the lifetime graded-answer count by one (plan: Stats rep counter). */
  incrementReps(): Promise<void>;
}

/** A learner-authored named word list (plan 0004): itemIds reference entries of one domain. */
export interface VocabList {
  id: string;
  name: string;
  itemIds: string[];
}

/**
 * Store of learner vocab lists, keyed by domain (plan 0006: re-scoped from
 * book — a list never spans domains). The web layer prunes dangling
 * itemIds on load — content can change between releases.
 */
export interface VocabListStore {
  getLists(domainId: string): Promise<VocabList[]>;
  saveList(domainId: string, list: VocabList): Promise<void>;
  deleteList(domainId: string, listId: string): Promise<void>;
}

/**
 * Store of learner-created lexicon entries (plan 0006), keyed by domain —
 * same pattern as `VocabListStore`. Entries are lexeme/concept shaped like
 * shipped content (matching the domain's kind) but are not
 * validator-checked (runtime data, not build-time content); ids are
 * `user-<uuid>`. At load, the web layer merges these into
 * `ContentSource.loadDomain`'s entry pool.
 */
export interface UserEntryStore {
  getEntries(domainId: string): Promise<Item[]>;
  saveEntry(domainId: string, entry: Item): Promise<void>;
  deleteEntry(domainId: string, entryId: string): Promise<void>;
}

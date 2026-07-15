import type { Content } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import type { Streak } from "./streak.js";

/** Thrown by `ContentSource.loadTopic` when the loaded content fails validation. */
export class ContentValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Content validation failed:\n${errors.join("\n")}`);
    this.name = "ContentValidationError";
    this.errors = errors;
  }
}

/** Summary of a topic, as listed before its full content is loaded. */
export interface TopicSummary {
  id: string;
  title: string;
  description: string;
}

/**
 * Source of learning content. Async from day 1 so a future remote or
 * SQLite-backed source is a swap, not a rewrite.
 */
export interface ContentSource {
  listTopics(): Promise<TopicSummary[]>;
  /** Rejects with `ContentValidationError` if the loaded content is invalid. */
  loadTopic(id: string): Promise<Content>;
}

/**
 * Store of learner progress. Unit completion is not stored here: it is
 * derived by the engine from the attempted-task-id set (every task id of
 * the unit is a member).
 */
export interface ProgressStore {
  getItemState(itemId: string): Promise<SrsState | null>;
  setItemState(itemId: string, state: SrsState): Promise<void>;
  getAttemptedTaskIds(): Promise<string[]>;
  markTaskAttempted(taskId: string): Promise<void>;
  getStreak(): Promise<Streak | null>;
  setStreak(streak: Streak): Promise<void>;
}

/** A learner-authored named word list (plan 0004): itemIds reference lexeme items of one topic. */
export interface VocabList {
  id: string;
  name: string;
  itemIds: string[];
}

/**
 * Store of learner vocab lists, keyed by topic (a list never spans topics).
 * The web layer prunes dangling itemIds on load — content can change
 * between releases.
 */
export interface VocabListStore {
  getLists(topicId: string): Promise<VocabList[]>;
  saveList(topicId: string, list: VocabList): Promise<void>;
  deleteList(topicId: string, listId: string): Promise<void>;
}

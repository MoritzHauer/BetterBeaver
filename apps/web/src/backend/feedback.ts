import { getSupabase } from "./supabase";
import { getDeviceId, getDisplayName } from "../identity";

/** Content feedback (plan 0014): votes, reports, and a public per-topic
 * chat. Learners are account-free, so every write carries the device
 * id/display name from `identity.ts` instead of a Supabase Auth user.
 * All functions no-op (or return empty) when the backend isn't configured,
 * matching the rest of `backend/` — feedback is best-effort, never
 * required for the app to work. */

export type ContentKind =
  "topic" | "lesson" | "unit" | "item" | "task" | "note";
export type ReportCategory = "error" | "explicit" | "spam" | "feedback";

export interface ChatMessage {
  id: string;
  doc_id: string;
  display_name: string;
  message: string;
  created_at: string;
}

export interface FeedbackReport {
  id: string;
  doc_id: string;
  content_kind: ContentKind | "chat_message";
  content_id: string;
  device_id: string;
  display_name: string;
  category: ReportCategory;
  message: string | null;
  resolved: boolean;
  created_at: string;
}

// ------------------------------------------------------------ vote cache
// The device's own vote lives only in localStorage (no server read-back —
// the server copy exists purely for the maintainer view).

function voteCacheKey(
  docId: string,
  contentKind: ContentKind,
  contentId: string,
): string {
  return `bb.feedback.vote.${docId}.${contentKind}.${contentId}`;
}

/** The device's own cached vote, or null if it hasn't voted (or cleared its vote). */
export function getMyVote(
  docId: string,
  contentKind: ContentKind,
  contentId: string,
): 1 | -1 | null {
  const raw = localStorage.getItem(voteCacheKey(docId, contentKind, contentId));
  return raw === "1" ? 1 : raw === "-1" ? -1 : null;
}

/** Casts, changes, or clears (`value: null`) a vote. Tapping the already-set
 * value clears it — callers pass null themselves to do that. */
export async function castVote(
  docId: string,
  contentKind: ContentKind,
  contentId: string,
  value: 1 | -1 | null,
): Promise<void> {
  const key = voteCacheKey(docId, contentKind, contentId);
  if (value === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, String(value));
  }
  const supabase = getSupabase();
  if (supabase === null) {
    return;
  }
  const { error } = await supabase.rpc("cast_vote", {
    p_doc_id: docId,
    p_content_kind: contentKind,
    p_content_id: contentId,
    p_device_id: getDeviceId(),
    p_value: value,
  });
  if (error) {
    throw new Error(error.message);
  }
}

// ---------------------------------------------------------------- reports

export async function submitReport(
  docId: string,
  contentKind: ContentKind | "chat_message",
  contentId: string,
  category: ReportCategory,
  message?: string,
): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.from("feedback_reports").insert({
    doc_id: docId,
    content_kind: contentKind,
    content_id: contentId,
    device_id: getDeviceId(),
    display_name: getDisplayName(),
    category,
    message: message?.trim() || null,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Maintainer-only: reports against `docId`'s content (RLS scopes this). */
export async function listReports(docId: string): Promise<FeedbackReport[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return [];
  }
  const { data, error } = await supabase
    .from("feedback_reports")
    .select("*")
    .eq("doc_id", docId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data as FeedbackReport[];
}

export async function setReportResolved(
  id: string,
  resolved: boolean,
): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase
    .from("feedback_reports")
    .update({ resolved })
    .eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

// ------------------------------------------------------------------- chat
// One public thread per topic (`docId` is the topic doc id) — every
// learner who opens it sees every message.

export async function sendChatMessage(
  docId: string,
  message: string,
): Promise<void> {
  const trimmed = message.trim();
  if (trimmed === "") {
    return;
  }
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.from("chat_messages").insert({
    doc_id: docId,
    device_id: getDeviceId(),
    display_name: getDisplayName(),
    message: trimmed,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Public read (via `chat_messages_public`, which strips `device_id`). */
export async function listChatMessages(docId: string): Promise<ChatMessage[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return [];
  }
  const { data, error } = await supabase
    .from("chat_messages_public")
    .select("*")
    .eq("doc_id", docId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data as ChatMessage[];
}

/** Maintainer-only moderation: delete a chat message (RLS scopes this to
 * the doc's maintainers) — the only moderation action, reached via the
 * same report flow as any other content. */
export async function deleteChatMessage(id: string): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.from("chat_messages").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

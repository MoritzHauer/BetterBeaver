import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import type { DomainDocument, BookDocument } from "@betterbeaver/schema";
import { isOffline } from "../offline";

/**
 * The authoring client (plan 0012 step 2). Learners never touch this
 * module: the learner read path is plain fetch against the catalog view in
 * content/source.ts. Everything here requires a signed-in author, and the
 * backend's RLS/RPC boundary (plan 0012 §4) is what actually enforces
 * permissions — this module is just transport.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  string | undefined;

let client: SupabaseClient | undefined;

/** Null when the backend isn't configured, or when the learner has turned on
 * offline mode — author UI, feedback and chat all hide entirely either way. */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || isOffline()) {
    return null;
  }
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export async function currentUser(): Promise<User | null> {
  const supabase = getSupabase();
  if (supabase === null) {
    return null;
  }
  return (await supabase.auth.getSession()).data.session?.user ?? null;
}

/** Sends the magic link; the redirect returns to this app, where supabase-js picks the session out of the URL. */
export async function signInWithEmail(email: string): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

export interface AuthorDocSummary {
  id: string;
  kind: "topic" | "domain";
  published_version: number;
  schema_version: number;
  listed: boolean;
}

export interface AuthorDoc extends AuthorDocSummary {
  draft: BookDocument | DomainDocument | null;
  published: BookDocument | DomainDocument | null;
}

/** Documents the signed-in author maintains (RLS scopes the select). */
export async function listMyDocuments(): Promise<AuthorDocSummary[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return [];
  }
  const { data, error } = await supabase
    .from("documents")
    .select("id,kind,published_version,schema_version,listed")
    .order("id");
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function loadDocument(id: string): Promise<AuthorDoc> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { data, error } = await supabase
    .from("documents")
    .select("id,kind,published_version,schema_version,listed,draft,published")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function saveDraft(
  id: string,
  draft: BookDocument | DomainDocument | null,
): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase
    .from("documents")
    .update({ draft })
    .eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

/** The atomic publish RPC (plan 0012 §3); raises on version conflict or missing maintainership. */
export async function publishDocument(
  id: string,
  expectedVersion: number,
  doc: BookDocument | DomainDocument,
  schemaVersion: number,
): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.rpc("publish_document", {
    doc_id: id,
    expected_version: expectedVersion,
    new_doc: doc,
    new_schema_version: schemaVersion,
  });
  if (error) {
    throw new Error(error.message);
  }
}

// ------------------------------------------------------------- proposals
// Non-maintainer edits (plan 0012 §5). A proposer can't read `documents`
// (RLS) — the base document comes from the same `catalog` view learners
// read, not from `loadDocument` above.

export interface CatalogSummary {
  id: string;
  kind: "topic" | "domain";
  published_version: number;
  schema_version: number;
}

export interface CatalogEntry extends CatalogSummary {
  published: BookDocument | DomainDocument;
}

/** Every listed+published document, for the "suggest edits" list — light
 * columns only, no document bodies. */
export async function listCatalogSummaries(): Promise<CatalogSummary[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return [];
  }
  const { data, error } = await supabase
    .from("catalog")
    .select("id,kind,published_version,schema_version")
    .order("id");
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** One catalog row with its full published document — the propose-mode
 * editor's load path. Null if the id isn't listed/published. */
export async function loadCatalogEntry(
  id: string,
): Promise<CatalogEntry | null> {
  const supabase = getSupabase();
  if (supabase === null) {
    return null;
  }
  const { data, error } = await supabase
    .from("catalog")
    .select("id,kind,published,published_version,schema_version")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export interface Proposal {
  id: string;
  doc_id: string;
  base_version: number;
  proposed_doc: BookDocument | DomainDocument;
  author: string | null;
  note: string | null;
  status: "open" | "accepted" | "rejected";
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Submits a proposal (insert only — RLS forces `author`/`status`). */
export async function submitProposal(
  docId: string,
  baseVersion: number,
  proposedDoc: BookDocument | DomainDocument,
  note: string,
): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const user = await currentUser();
  if (user === null) {
    throw new Error("sign in to propose an edit");
  }
  const { error } = await supabase.from("proposals").insert({
    doc_id: docId,
    base_version: baseVersion,
    proposed_doc: proposedDoc,
    author: user.id,
    note: note.trim() === "" ? null : note.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** The signed-in user's own proposals (not the ones they maintain and could
 * decide — RLS's select would return both, so this filters to authored). */
export async function listMyProposals(): Promise<Proposal[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return [];
  }
  const user = await currentUser();
  if (user === null) {
    return [];
  }
  const { data, error } = await supabase
    .from("proposals")
    .select("*")
    .eq("author", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data as Proposal[];
}

/** Open proposals against one document — the maintainer's review queue. */
export async function listOpenProposals(docId: string): Promise<Proposal[]> {
  const supabase = getSupabase();
  if (supabase === null) {
    return [];
  }
  const { data, error } = await supabase
    .from("proposals")
    .select("*")
    .eq("doc_id", docId)
    .eq("status", "open")
    .order("created_at");
  if (error) {
    throw new Error(error.message);
  }
  return data as Proposal[];
}

/** Withdraws (deletes) one of the caller's own open proposals — RLS scopes
 * both the ownership and the open-only rule. */
export async function withdrawProposal(id: string): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const { error } = await supabase.from("proposals").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

/** The base document a proposal's `base_version` was drafted against, from
 * `versions` (maintainers have `select` there). Null if never published
 * (`base_version = 0`) or the row is otherwise missing — callers diff
 * against an empty document in that case. */
export async function loadVersion(
  docId: string,
  version: number,
): Promise<BookDocument | DomainDocument | null> {
  const supabase = getSupabase();
  if (supabase === null) {
    return null;
  }
  const { data, error } = await supabase
    .from("versions")
    .select("doc")
    .eq("doc_id", docId)
    .eq("version", version)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data?.doc as BookDocument | DomainDocument | undefined) ?? null;
}

/**
 * Maintainer decision on a proposal (plan 0012 §5 point 9): status +
 * decided_by/decided_at/decision_note only — the column grant forbids
 * touching anything else, RLS forbids anyone but a maintainer. Accepting
 * into a draft is `saveDraft` followed by this call (draft first, so a
 * failed status update just leaves the proposal open — harmless, retry).
 */
export async function decideProposal(
  proposalId: string,
  status: "accepted" | "rejected",
  decisionNote: string | null,
): Promise<void> {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error("backend not configured");
  }
  const user = await currentUser();
  if (user === null) {
    throw new Error("sign in to decide a proposal");
  }
  const { error } = await supabase
    .from("proposals")
    .update({
      status,
      decided_by: user.id,
      decision_note: decisionNote,
      decided_at: new Date().toISOString(),
    })
    .eq("id", proposalId);
  if (error) {
    throw new Error(error.message);
  }
}

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import type { DomainDocument, BookDocument } from "@betterbeaver/schema";

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

/** Null when the backend isn't configured — author UI hides entirely. */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
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
  return data as AuthorDocSummary[];
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
  return data as AuthorDoc;
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

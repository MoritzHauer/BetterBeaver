import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  currentUser,
  listMyDocuments,
  signInWithEmail,
  signOut,
  type AuthorDocSummary,
} from "../backend/supabase";

/**
 * Author entry point (plan 0012 step 2): magic-link sign-in, then the list
 * of documents the account maintains. Reachable only when the backend is
 * configured; learners never need this screen.
 */
export function AuthorScreen({
  onOpenDocument,
  onPrivacy,
  onBack,
}: {
  onOpenDocument: (docId: string) => void;
  onPrivacy: () => void;
  onBack: () => void;
}) {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [docs, setDocs] = useState<AuthorDocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void currentUser().then(setUser);
  }, []);
  useEffect(() => {
    if (user === "loading" || user === null) {
      return;
    }
    listMyDocuments().then(setDocs, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [user]);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          ← Home
        </button>
        <h1>Authoring</h1>
      </header>

      {error !== null && <p className="error-text">{error}</p>}

      {user === "loading" && <p>Loading…</p>}

      {user === null && !sent && (
        <form onSubmit={(e) => void handleSignIn(e)} className="card">
          <p>
            Sign in to edit content. Learners don't need an account — this is
            for authors only. See the{" "}
            <button
              type="button"
              className="plain link-button"
              onClick={onPrivacy}
            >
              privacy note
            </button>
            .
          </p>
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <button className="primary" type="submit">
            Send sign-in link
          </button>
        </form>
      )}

      {user === null && sent && (
        <p className="card">
          Check your email — the sign-in link brings you back here.
        </p>
      )}

      {user !== "loading" && user !== null && (
        <>
          <p className="status">
            Signed in as {user.email}{" "}
            <button
              className="plain"
              onClick={() => {
                void signOut().then(() => {
                  setUser(null);
                  setDocs(null);
                  setSent(false);
                });
              }}
            >
              Sign out
            </button>
          </p>
          {docs === null && <p>Loading your documents…</p>}
          {docs !== null && docs.length === 0 && (
            <p className="card">
              No documents yet. Maintainership is assigned by the admin for now
              — ask to be added, or wait for in-app topic creation (coming
              later).
            </p>
          )}
          {docs !== null && docs.length > 0 && (
            <ul className="card-list">
              {docs.map((doc) => (
                <li key={doc.id} className="card">
                  <button onClick={() => onOpenDocument(doc.id)}>
                    <strong>{doc.id}</strong>
                    <span className="status">
                      {doc.kind === "topic" ? "Topic" : "Domain lexicon"} ·
                      version {doc.published_version}
                      {doc.listed ? "" : " · not listed yet"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
